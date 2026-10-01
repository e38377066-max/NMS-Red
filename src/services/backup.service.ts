import { Backup, Equipment } from "../db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";
import { decryptSecret, encryptBuffer } from "./credentials.service";
import { uploadPrivateObject } from "./object-storage.service";

const execFileAsync = promisify(execFile);

const BACKUP_DIR = path.resolve(process.cwd(), "data/backups");

let backupInterval: ReturnType<typeof setInterval> | null = null;

export function startBackupCron(): void {
  if (backupInterval) return;
  logger.info("Starting backup cron service (daily at 02:00)");
  scheduleNextBackup();
}

export function stopBackupCron(): void {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

function scheduleNextBackup(): void {
  const now = new Date();
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntil = next.getTime() - now.getTime();
  setTimeout(() => {
    void runAllBackups();
    backupInterval = setInterval(() => { void runAllBackups(); }, 24 * 60 * 60 * 1000);
  }, msUntil);
  logger.info({ nextBackupAt: next.toISOString() }, "Next backup scheduled");
}

export async function runAllBackups(): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  try {
    await mkdir(BACKUP_DIR, { recursive: true });

    const pgResult = await backupPostgres();
    if (pgResult) success++;
    else failed++;

    const equipment = await Equipment.findAll({ where: { connectionType: "mikrotik_routeros" }, raw: true }) as any[];

    for (const equip of equipment) {
      const results = await backupMikroTik(equip);
      success += results.filter(Boolean).length;
      failed += results.filter(r => !r).length;
    }

    logger.info({ success, failed }, "Backup cycle completed");
  } catch (err) {
    logger.error({ err }, "Backup cycle failed");
  }

  return { success, failed };
}

async function backupPostgres(): Promise<boolean> {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      logger.warn("DATABASE_URL not set, skipping postgres backup");
      return false;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `postgres_${timestamp}.sql.enc`;
    const tempPath = path.join(BACKUP_DIR, `${fileName}.tmp`);
    await execFileAsync("pg_dump", [databaseUrl, "--no-owner", "--no-privileges", "--format=plain", "--file", tempPath], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const encrypted = encryptBuffer(await readFile(tempPath));
    const objectPath = await uploadPrivateObject(encrypted, "application/octet-stream", ".sql.enc");
    const stats = { size: encrypted.byteLength };
    await unlink(tempPath).catch(() => undefined);

    await Backup.create({
      type: "postgres",
      name: fileName,
      filePath: objectPath,
      sizeBytes: stats.size,
      equipmentId: null,
    });

    logger.info({ fileName, size: stats.size }, "PostgreSQL backup created");
    return true;
  } catch (err) {
    logger.error({ err }, "PostgreSQL backup failed");
    return false;
  }
}

async function backupMikroTik(equip: {
  id: number;
  ip: string;
  username: string;
  password: string;
  model: string;
  apiPort: number | null;
}): Promise<boolean[]> {
  const results: boolean[] = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeModel = equip.model.replace(/[^a-zA-Z0-9-]/g, "_");

  try {
    const auth = Buffer.from(`${equip.username}:${decryptSecret(equip.password)}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
    const scheme = process.env.MIKROTIK_API_SCHEME
      ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    const port = equip.apiPort ?? (process.env.MIKROTIK_API_PORT ? Number(process.env.MIKROTIK_API_PORT) : undefined);
    const baseUrl = `${scheme}://${equip.ip}${port ? `:${port}` : ""}/rest`;

    const backupName = `${safeModel}_${timestamp}`;
    await fetch(`${baseUrl}/system/backup/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: backupName, "dont-encrypt": "yes" }),
    });

    await new Promise(r => setTimeout(r, 3000));

    const filesResp = await fetch(`${baseUrl}/file?name=${backupName}.backup`, { headers });
    if (filesResp.ok) {
      const files = await filesResp.json() as Array<{ ".id": string; name: string; size: number }>;
      if (files.length > 0) {
        const fileContent = await fetch(`${baseUrl}/file/${files[0][".id"]}/contents`, { headers });
        if (fileContent.ok) {
           const binaryData = encryptBuffer(Buffer.from(await fileContent.arrayBuffer()));
           const objectPath = await uploadPrivateObject(binaryData, "application/octet-stream", ".backup.enc");
           const stats = { size: binaryData.byteLength };
           await Backup.create({
            type: "mikrotik_backup",
            name: `${backupName}.backup`,
             filePath: objectPath,
            sizeBytes: stats.size,
            equipmentId: equip.id,
          });
          results.push(true);
          logger.info({ ip: equip.ip, file: `${backupName}.backup` }, "MikroTik .backup created");
        }
      }
    }

    const exportResp = await fetch(`${baseUrl}/export`, { method: "POST", headers, body: JSON.stringify({}) });
    if (exportResp.ok) {
      const scriptContent = await exportResp.text();
       const encrypted = encryptBuffer(Buffer.from(scriptContent, "utf8"));
       const objectPath = await uploadPrivateObject(encrypted, "application/octet-stream", ".rsc.enc");
       const stats = { size: encrypted.byteLength };
      await Backup.create({
        type: "mikrotik_script",
        name: `${backupName}.rsc`,
         filePath: objectPath,
        sizeBytes: stats.size,
        equipmentId: equip.id,
      });
      results.push(true);
      logger.info({ ip: equip.ip, file: `${backupName}.rsc` }, "MikroTik .rsc export created");
    }
  } catch (err) {
    logger.warn({ err, ip: equip.ip }, "MikroTik backup failed");
    results.push(false);
  }

  return results.length > 0 ? results : [false];
}

export async function listBackups(type?: string, equipmentId?: number) {
  const rows = await Backup.findAll({
    attributes: ["id","type","name","filePath","sizeBytes","equipmentId","createdAt"],
    include: [], order: [["createdAt", "ASC"]], raw: true,
  }) as any[];
  const equipment = await Equipment.findAll({ attributes: ["id","model"], raw: true }) as any[];
  const models = new Map(equipment.map(e => [e.id, e.model]));

  return rows
    .filter(r => !type || r.type === type)
    .filter(r => !equipmentId || r.equipmentId === equipmentId)
    .map(r => ({
      ...r,
      filePath: undefined,
       equipmentModel: models.get(r.equipmentId) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
}
