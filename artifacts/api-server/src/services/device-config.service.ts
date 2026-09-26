import { NodeSSH } from "node-ssh";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import { decryptSecret } from "./credentials.service";

const SSH_TIMEOUT_MS = 12_000;
const MAX_CONFIG_BYTES = 12 * 1024 * 1024;
const pendingConfigs = new Map<string, PendingConfig>();

export type ManagedEquipment = {
  id: number;
  ip: string;
  username: string;
  password: string;
  model: string;
  connectionType: string;
};

type PendingConfig = {
  id: string;
  equipmentId: number;
  fileName: string;
  content: Buffer;
  format: "text" | "mikrotik_backup" | "airos_binary";
  createdAt: number;
};

type DeviceConfigInput = {
  fileName: string;
  contentBase64: string;
};

function sshOptions(equipment: ManagedEquipment) {
  return {
    host: equipment.ip,
    username: equipment.username,
    password: decryptSecret(equipment.password),
    readyTimeout: SSH_TIMEOUT_MS,
    algorithms: {
      kex: [
        "ecdh-sha2-nistp256",
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group1-sha1",
      ],
      cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"],
      hmac: ["hmac-sha2-256", "hmac-sha1"],
      serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256"],
    },
  };
}

function cleanFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "config";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "config";
}

function redactSecrets(text: string): string {
  return text
    .replace(/((?:password|passphrase|wpa2-pre-shared-key|secret|private-key|token)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1<redacted>")
    .replace(/(key\s*=\s*)([^\s,;]+)/gi, "$1<redacted>");
}

function isPrintable(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let printable = 0;
  for (const byte of buffer.subarray(0, Math.min(buffer.length, 4096))) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable++;
  }
  return printable / Math.min(buffer.length, 4096) > 0.9;
}

function decodeInput(input: DeviceConfigInput): { fileName: string; content: Buffer } {
  const fileName = cleanFileName(input.fileName);
  if (!input.contentBase64 || typeof input.contentBase64 !== "string") {
    throw new Error("El archivo de configuración está vacío");
  }
  const content = Buffer.from(input.contentBase64, "base64");
  if (content.length === 0 || content.length > MAX_CONFIG_BYTES) {
    throw new Error(`El archivo debe tener entre 1 byte y ${MAX_CONFIG_BYTES / 1024 / 1024} MB`);
  }
  return { fileName, content };
}

function classifyConfig(equipment: ManagedEquipment, fileName: string, content: Buffer): PendingConfig["format"] {
  const lower = fileName.toLowerCase();
  if (equipment.connectionType === "mikrotik_routeros" && lower.endsWith(".backup")) return "mikrotik_backup";
  if (equipment.connectionType === "ubiquiti_airos" && (lower.endsWith(".bin") || lower.endsWith(".cfg"))) return "airos_binary";
  return "text";
}

function compatibilityWarning(equipment: ManagedEquipment, fileName: string, format: PendingConfig["format"]): string | null {
  const lower = fileName.toLowerCase();
  if (equipment.connectionType === "mikrotik_routeros" && (lower.endsWith(".cfg") || lower.endsWith(".bin"))) {
    return "Este archivo parece de airOS; para RouterOS usa .rsc o .backup.";
  }
  if (equipment.connectionType === "ubiquiti_airos" && lower.endsWith(".rsc")) {
    return "Este archivo parece un export de RouterOS; para airOS usa .cfg/.bin o un script compatible.";
  }
  if (format !== "text") return "El contenido binario no se puede mostrar línea por línea; se conservará el archivo y se aplicará con el mecanismo nativo del equipo.";
  return null;
}

export async function getDeviceConfiguration(equipment: ManagedEquipment) {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(sshOptions(equipment));
    const command = equipment.connectionType === "mikrotik_routeros"
      ? "/export terse"
      : "cat /tmp/system.cfg 2>/dev/null || mca-cli-op info 2>/dev/null || true";
    const result = await ssh.execCommand(command);
    const content = redactSecrets(result.stdout || result.stderr || "");
    const source = content.toLowerCase();
    const capabilities = equipment.connectionType === "mikrotik_routeros"
      ? {
        wireless: source.includes("/interface/wifi") ? "routeros_wifi" : source.includes("/interface/wireless") ? "routeros_wireless" : "unknown",
        network: source.includes("/ip/address") || source.includes("/ip/route") ? "routeros_ip" : "unknown",
        dhcp: source.includes("/ip/dhcp-server") ? "detected" : "not_detected",
        queues: source.includes("/queue/") ? "detected" : "not_detected",
        nativeRestore: true,
      }
      : {
        wireless: source.includes("wireless.") ? "airos_wireless" : "unknown",
        network: source.includes("netconf.") || source.includes("network.") ? "airos_network" : "unknown",
        airMax: source.includes("airmax") ? "detected" : "unknown",
        nativeRestore: true,
      };
    return {
      reachable: result.code === 0 || Boolean(result.stdout),
      connectionType: equipment.connectionType,
      model: equipment.model,
      exportedAt: new Date().toISOString(),
      content,
      capabilities,
      note: equipment.connectionType === "mikrotik_routeros"
        ? "Export RouterOS protegido: las credenciales y secretos se ocultan en la vista."
        : "Configuración airOS protegida: las claves se ocultan en la vista. El archivo nativo se conserva solo al hacer un respaldo o importación.",
    };
  } finally {
    try { ssh.dispose(); } catch { /* no-op */ }
  }
}

export function previewDeviceConfiguration(equipment: ManagedEquipment, input: DeviceConfigInput) {
  const { fileName, content } = decodeInput(input);
  const format = classifyConfig(equipment, fileName, content);
  const previewId = randomUUID();
  const rawText = format === "text" && isPrintable(content) ? content.toString("utf8") : "";
  const lines = rawText.split(/\r?\n/).filter(Boolean);
  const dangerousLines = lines.filter((line) => /reset-configuration|\/system shutdown|\/system reboot|format|rm\s+-rf|wget\s|curl\s|fetch\s/i.test(line));
  const preview: PendingConfig = {
    id: previewId,
    equipmentId: equipment.id,
    fileName,
    content,
    format,
    createdAt: Date.now(),
  };
  pendingConfigs.set(previewId, preview);

  for (const [id, item] of pendingConfigs) {
    if (Date.now() - item.createdAt > 30 * 60 * 1000) pendingConfigs.delete(id);
  }

  return {
    previewId,
    fileName,
    format,
    sizeBytes: content.length,
    lineCount: lines.length,
    commands: lines.slice(0, 80).map((line) => redactSecrets(line)),
    warning: compatibilityWarning(equipment, fileName, format),
    dangerousLines: dangerousLines.map((line) => redactSecrets(line)),
    requiresConfirmation: true,
  };
}

async function savePreChangeBackup(equipment: ManagedEquipment, ssh: NodeSSH): Promise<string | null> {
  try {
    const command = equipment.connectionType === "mikrotik_routeros"
      ? "/export terse"
      : "cat /tmp/system.cfg 2>/dev/null || mca-cli-op info 2>/dev/null || true";
    const result = await ssh.execCommand(command);
    const content = result.stdout || result.stderr;
    if (!content) return null;
    const dir = join(process.cwd(), "data", "backups");
    await mkdir(dir, { recursive: true });
    const extension = equipment.connectionType === "mikrotik_routeros" ? "rsc" : "cfg";
    const fileName = `prechange_${equipment.id}_${Date.now()}.${extension}`;
    const filePath = join(dir, fileName);
    // This file stays in the private server backup directory so it can be
    // restored. The redacted version is only returned by the read endpoint.
    await writeFile(filePath, content, "utf8");
    return fileName;
  } catch (err) {
    logger.warn({ equipmentId: equipment.id, err }, "Could not create pre-change configuration backup");
    return null;
  }
}

async function uploadAndApplyNative(
  equipment: ManagedEquipment,
  ssh: NodeSSH,
  pending: PendingConfig,
): Promise<{ message: string; needsReboot: boolean }> {
  const remoteName = `/tmp/nms-${randomUUID()}-${pending.fileName}`;
  const localPath = join("/tmp", `nms-${randomUUID()}-${pending.fileName}`);
  await writeFile(localPath, pending.content);
  try {
    await ssh.putFile(localPath, remoteName);
    if (equipment.connectionType === "mikrotik_routeros") {
      if (pending.format === "mikrotik_backup") {
        const result = await ssh.execCommand(`/system backup load name=${remoteName}`);
        if (result.code && result.stderr) throw new Error(result.stderr);
        return { message: "Backup RouterOS cargado. El equipo puede reiniciarse para completar la restauración.", needsReboot: true };
      }
      const result = await ssh.execCommand(`/import file-name=${remoteName}`);
      if (result.code && result.stderr) throw new Error(result.stderr);
      return { message: "Export RouterOS importado correctamente.", needsReboot: false };
    }

    const result = await ssh.execCommand(`cfgmtd -f ${remoteName} -w`);
    if (result.code && result.stderr) throw new Error(result.stderr);
    return { message: "Configuración nativa airOS escrita con cfgmtd. Puede requerir reinicio para activarse.", needsReboot: true };
  } finally {
    await unlink(localPath).catch(() => undefined);
    await ssh.execCommand(`rm -f ${remoteName}`).catch(() => undefined);
  }
}

export async function applyDeviceConfiguration(equipment: ManagedEquipment, previewId: string) {
  const pending = pendingConfigs.get(previewId);
  if (!pending || pending.equipmentId !== equipment.id) {
    throw new Error("La previsualización expiró; vuelve a cargar el archivo");
  }

  const ssh = new NodeSSH();
  try {
    await ssh.connect(sshOptions(equipment));
    const backupPath = await savePreChangeBackup(equipment, ssh);
    let result: { message: string; needsReboot: boolean };

    if (pending.format !== "text") {
      result = await uploadAndApplyNative(equipment, ssh, pending);
    } else if (equipment.connectionType === "mikrotik_routeros") {
      const command = pending.content.toString("utf8");
      if (/reset-configuration|\/system shutdown|format|rm\s+-rf/i.test(command)) {
        throw new Error("El script contiene una operación destructiva bloqueada por seguridad");
      }
      const response = await ssh.execCommand(command);
      if (response.code && response.stderr) throw new Error(response.stderr);
      result = { message: "Script RouterOS aplicado correctamente.", needsReboot: false };
    } else {
      const command = pending.content.toString("utf8");
      if (/rm\s+-rf|wget\s|curl\s|reboot/i.test(command)) {
        throw new Error("El script airOS contiene una operación bloqueada por seguridad");
      }
      const response = await ssh.execCommand(command);
      if (response.code && response.stderr) throw new Error(response.stderr);
      result = { message: "Script airOS aplicado correctamente. Revisa si el equipo requiere reinicio.", needsReboot: false };
    }

    pendingConfigs.delete(previewId);
    return { ...result, backupPath };
  } finally {
    try { ssh.dispose(); } catch { /* no-op */ }
  }
}