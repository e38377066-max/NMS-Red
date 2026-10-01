import { NodeSSH } from "node-ssh";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import { decryptSecret, encryptBuffer } from "./credentials.service";
import { uploadPrivateObject } from "./object-storage.service";
import {
  discoverDeviceCapabilities,
  extractAirosConfigurationParameters,
  isSensitiveConfigurationKey,
  type DeviceIdentity,
} from "./device-capabilities.service";

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
  createdByUserId: number;
  deviceFingerprint: string;
  fileName: string;
  content: Buffer;
  format: "text" | "mikrotik_backup" | "airos_binary";
  createdAt: number;
};

type DeviceConfigInput = {
  fileName: string;
  contentBase64: string;
};

type DeviceSettingChange = {
  key: string;
  value: string;
};

function deviceFingerprint(equipment: ManagedEquipment, identity: DeviceIdentity): string {
  return [
    equipment.id,
    equipment.ip,
    equipment.connectionType,
    identity.profileId,
    identity.model ?? "",
    identity.firmware ?? "",
  ].join("\u001f");
}

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
  return text.split(/\r?\n/).map(line => {
    return line.replace(
      /(^|\s)([a-zA-Z0-9_.-]{1,160})(\s*=\s*)("[^"]*"|'[^']*'|[^\s,;]+)/g,
      (assignment, boundary: string, key: string, separator: string) =>
        isSensitiveConfigurationKey(key) ? `${boundary}${key}${separator}<redacted>` : assignment,
    );
  }).join("\n");
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
      : "cat /tmp/system.cfg 2>/dev/null";
    const result = await ssh.execCommand(command);
    const rawContent = result.stdout || result.stderr || "";
    const deviceInfoCommand = equipment.connectionType === "mikrotik_routeros"
      ? "/system/resource/print"
      : "mca-status 2>/dev/null || mca-cli-op info 2>/dev/null || true";
    const deviceInfoResult = await ssh.execCommand(deviceInfoCommand);
    const discovery = discoverDeviceCapabilities({
      connectionType: equipment.connectionType,
      declaredModel: equipment.model,
      deviceInfo: deviceInfoResult.stdout || deviceInfoResult.stderr || "",
      configuration: rawContent,
    });
    return {
      reachable: result.code === 0
        || Boolean(result.stdout)
        || deviceInfoResult.code === 0
        || Boolean(deviceInfoResult.stdout),
      connectionType: equipment.connectionType,
      model: equipment.model,
      exportedAt: new Date().toISOString(),
      content: redactSecrets(rawContent),
      identity: discovery.identity,
      controlPolicy: discovery.controlPolicy,
      capabilities: discovery.capabilities,
      parameters: equipment.connectionType === "ubiquiti_airos"
        ? extractAirosConfigurationParameters(rawContent)
        : [],
      note: discovery.controlPolicy.canApply
        ? "Identidad y firmware detectados. Revisa cada cambio; el CMS exige respaldo previo y confirmación antes de aplicar."
        : "La configuración se puede leer, pero los cambios permanecen bloqueados hasta que el modelo y firmware tengan un perfil validado.",
    };
  } finally {
    try { ssh.dispose(); } catch { /* no-op */ }
  }
}

export function previewDeviceConfiguration(
  equipment: ManagedEquipment,
  input: DeviceConfigInput,
  createdByUserId: number,
  identity: DeviceIdentity,
) {
  const { fileName, content } = decodeInput(input);
  const format = classifyConfig(equipment, fileName, content);
  const previewId = randomUUID();
  const rawText = format === "text" && isPrintable(content) ? content.toString("utf8") : "";
  const lines = rawText.split(/\r?\n/).filter(Boolean);
  const dangerousLines = lines.filter((line) => /reset-configuration|\/system shutdown|\/system reboot|format|rm\s+-rf|wget\s|curl\s|fetch\s/i.test(line));
  const preview: PendingConfig = {
    id: previewId,
    equipmentId: equipment.id,
    createdByUserId,
    deviceFingerprint: deviceFingerprint(equipment, identity),
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

function encodeConfigValue(previousRaw: string, value: string): string {
  const previous = previousRaw.trim();
  if (previous.startsWith('"') && previous.endsWith('"')) return JSON.stringify(value);
  if (previous.startsWith("'") && previous.endsWith("'")) {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  if (/[\s#=\\"]/.test(value)) return JSON.stringify(value);
  return value;
}

export async function previewAirosSettings(
  equipment: ManagedEquipment,
  inputChanges: unknown,
  createdByUserId: number,
) {
  if (equipment.connectionType !== "ubiquiti_airos") {
    throw new Error("La edición estructurada solo está disponible para perfiles airOS compatibles");
  }
  if (!Array.isArray(inputChanges) || inputChanges.length === 0 || inputChanges.length > 100) {
    throw new Error("Indica entre 1 y 100 opciones para revisar");
  }
  const changes: DeviceSettingChange[] = inputChanges.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Una o más opciones tienen un nombre o valor no válido");
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.key !== "string" || typeof candidate.value !== "string") {
      throw new Error("Una o más opciones tienen un nombre o valor no válido");
    }
    return { key: candidate.key, value: candidate.value };
  });
  if (changes.some(change =>
    !/^[a-zA-Z0-9_.-]{1,160}$/.test(change.key)
    || change.value.length > 1024
    || /[\r\n\0]/.test(change.value)
  )) {
    throw new Error("Una o más opciones tienen un nombre o valor no válido");
  }
  if (new Set(changes.map(change => change.key)).size !== changes.length) {
    throw new Error("Una opción aparece más de una vez");
  }

  const ssh = new NodeSSH();
  try {
    await ssh.connect(sshOptions(equipment));
    const configResult = await ssh.execCommand("cat /tmp/system.cfg 2>/dev/null");
    if (configResult.code !== 0 || !configResult.stdout.trim()) {
      throw new Error("No se pudo leer el archivo nativo system.cfg del equipo");
    }
    const infoResult = await ssh.execCommand("mca-status 2>/dev/null || mca-cli-op info 2>/dev/null || true");
    const discovery = discoverDeviceCapabilities({
      connectionType: equipment.connectionType,
      declaredModel: equipment.model,
      deviceInfo: infoResult.stdout || infoResult.stderr || "",
      configuration: configResult.stdout,
    });
    if (!discovery.controlPolicy.canApply || discovery.identity.profileId !== "ubiquiti-airos-m-series") {
      throw new Error(discovery.controlPolicy.reason);
    }

    const parameters = extractAirosConfigurationParameters(configResult.stdout);
    const parameterByKey = new Map(parameters.map(parameter => [parameter.key, parameter]));
    const originalLines = configResult.stdout.split(/\r?\n/);
    const changedValues = new Map(changes.map(change => [change.key, change.value]));
    const seen = new Map<string, number>();
    const nextLines = originalLines.map(line => {
      const match = line.match(/^(\s*[a-zA-Z0-9_.-]{1,160}\s*=\s*)(.*?)(\s*)$/);
      if (!match || !changedValues.has(line.match(/^\s*([a-zA-Z0-9_.-]{1,160})\s*=/)?.[1] ?? "")) {
        return line;
      }
      const key = line.match(/^\s*([a-zA-Z0-9_.-]{1,160})\s*=/)?.[1];
      if (!key) return line;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      return `${match[1]}${encodeConfigValue(match[2], changedValues.get(key)!)}${match[3]}`;
    });

    const changed: Array<{ key: string; before: string | null; after: string; sensitive: boolean }> = [];
    for (const change of changes) {
      const parameter = parameterByKey.get(change.key);
      if (!parameter || (seen.get(change.key) ?? 0) !== 1) {
        throw new Error(`La opción ${change.key} no existe de forma única en la configuración actual`);
      }
      if (parameter.sensitive && !change.value.trim()) {
        throw new Error(`Para cambiar ${change.key}, escribe un valor nuevo; el valor actual no se mostrará`);
      }
      if (!parameter.sensitive && parameter.value === change.value) continue;
      changed.push({
        key: change.key,
        before: parameter.value,
        after: change.value,
        sensitive: parameter.sensitive,
      });
    }
    if (changed.length === 0) throw new Error("No hay cambios distintos para revisar");

    const content = Buffer.from(nextLines.join("\n"), "utf8");
    const previewId = randomUUID();
    const fileName = "airOS-settings.cfg";
    pendingConfigs.set(previewId, {
      id: previewId,
      equipmentId: equipment.id,
      createdByUserId,
      deviceFingerprint: deviceFingerprint(equipment, discovery.identity),
      fileName,
      content,
      format: "airos_binary",
      createdAt: Date.now(),
    });
    for (const [id, item] of pendingConfigs) {
      if (Date.now() - item.createdAt > 30 * 60 * 1000) pendingConfigs.delete(id);
    }

    return {
      previewId,
      fileName,
      format: "airOS native configuration",
      sizeBytes: content.length,
      lineCount: changed.length,
      commands: changed.map(change => change.sensitive
        ? `${change.key}: secreto actualizado (valor oculto)`
        : `${change.key}: ${change.before ?? ""} → ${change.after}`),
      warning: changed.some(change => /ssid|mode|channel|freq|airmax|netconf|network|ip/i.test(change.key))
        ? "Cambiar radio, SSID, AirMax o red puede desconectar el equipo. Revisa la conectividad antes de confirmar."
        : null,
      dangerousLines: [],
      requiresConfirmation: true,
    };
  } finally {
    try { ssh.dispose(); } catch { /* no-op */ }
  }
}

async function savePreChangeBackup(
  equipment: ManagedEquipment,
  ssh: NodeSSH,
): Promise<{ filePath: string; fileName: string; sizeBytes: number } | null> {
  try {
    const command = equipment.connectionType === "mikrotik_routeros"
      ? "/export terse"
      : "cat /tmp/system.cfg 2>/dev/null";
    const result = await ssh.execCommand(command);
    const content = result.stdout;
    if (result.code !== 0 || !content?.trim()) return null;
    const looksLikeRestorableExport = equipment.connectionType === "mikrotik_routeros"
      ? /(?:^|\n)\/(?:interface|ip|system|queue|tool|user|routing)\b/m.test(content.toLowerCase())
      : /(?:^|\n)\s*(?:wireless|radio|netconf|network|system)\.\S+\s*[=:]/im.test(content);
    if (!looksLikeRestorableExport) return null;
    const extension = equipment.connectionType === "mikrotik_routeros" ? "rsc" : "cfg";
    const fileName = `prechange_${equipment.id}_${Date.now()}.${extension}`;
    const encrypted = encryptBuffer(Buffer.from(content, "utf8"));
    const filePath = await uploadPrivateObject(
      encrypted,
      "application/octet-stream",
      `.${extension}.enc`,
    );
    return { filePath, fileName, sizeBytes: encrypted.byteLength };
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

export async function applyDeviceConfiguration(
  equipment: ManagedEquipment,
  previewId: string,
  userId: number,
  identity: DeviceIdentity,
  persistBackup: (backup: { filePath: string; fileName: string; sizeBytes: number }) => Promise<void>,
) {
  const pending = pendingConfigs.get(previewId);
  if (
    !pending
    || pending.equipmentId !== equipment.id
    || pending.createdByUserId !== userId
    || pending.deviceFingerprint !== deviceFingerprint(equipment, identity)
    || Date.now() - pending.createdAt > 30 * 60 * 1000
  ) {
    throw new Error("La previsualización expiró; vuelve a cargar el archivo");
  }
  pendingConfigs.delete(previewId);

  const ssh = new NodeSSH();
  try {
    await ssh.connect(sshOptions(equipment));
    const backup = await savePreChangeBackup(equipment, ssh);
    if (!backup) throw new Error("No se pudo crear el backup previo; el cambio fue cancelado");
    await persistBackup(backup);
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

    return {
      ...result,
      backupPath: backup.filePath,
      backupName: backup.fileName,
      backupSizeBytes: backup.sizeBytes,
    };
  } finally {
    try { ssh.dispose(); } catch { /* no-op */ }
  }
}