import { db, backupsTable, equipmentTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger";

const execAsync = promisify(exec);

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

    const equipment = await db
      .select()
      .from(equipmentTable)
      .where(eq(equipmentTable.connectionType, "mikrotik_routeros"));

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
    const fileName = `postgres_${timestamp}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);

    await execAsync(`pg_dump "${databaseUrl}" > "${filePath}"`);

    const stats = await stat(filePath);

    await db.insert(backupsTable).values({
      type: "postgres",
      name: fileName,
      filePath,
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

async function backupMikroTik(equip: { id: number; ip: string; username: string; password: string; model: string }): Promise<boolean[]> {
  const results: boolean[] = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeModel = equip.model.replace(/[^a-zA-Z0-9-]/g, "_");

  try {
    const auth = Buffer.from(`${equip.username}:${equip.password}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
    const baseUrl = `http://${equip.ip}/rest`;

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
          const { writeFile } = await import("node:fs/promises");
          const binaryData = Buffer.from(await fileContent.arrayBuffer());
          const localPath = path.join(BACKUP_DIR, `${backupName}.backup`);
          await writeFile(localPath, binaryData);
          const stats = await stat(localPath);
          await db.insert(backupsTable).values({
            type: "mikrotik_backup",
            name: `${backupName}.backup`,
            filePath: localPath,
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
      const { writeFile } = await import("node:fs/promises");
      const scriptContent = await exportResp.text();
      const localPath = path.join(BACKUP_DIR, `${backupName}.rsc`);
      await writeFile(localPath, scriptContent, "utf-8");
      const stats = await stat(localPath);
      await db.insert(backupsTable).values({
        type: "mikrotik_script",
        name: `${backupName}.rsc`,
        filePath: localPath,
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
  const rows = await db
    .select({
      id: backupsTable.id,
      type: backupsTable.type,
      name: backupsTable.name,
      filePath: backupsTable.filePath,
      sizeBytes: backupsTable.sizeBytes,
      equipmentId: backupsTable.equipmentId,
      equipmentModel: equipmentTable.model,
      createdAt: backupsTable.createdAt,
    })
    .from(backupsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, backupsTable.equipmentId))
    .orderBy(backupsTable.createdAt);

  return rows
    .filter(r => !type || r.type === type)
    .filter(r => !equipmentId || r.equipmentId === equipmentId)
    .map(r => ({
      ...r,
      filePath: undefined,
      equipmentModel: r.equipmentModel ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
}
