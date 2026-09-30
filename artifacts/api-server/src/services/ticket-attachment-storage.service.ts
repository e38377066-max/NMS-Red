import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const storagePrefix = "ticketfs://";

export class TicketAttachmentStorageNotConfiguredError extends Error {
  constructor(message = "Configure TICKET_ATTACHMENT_STORAGE_DIR para habilitar los adjuntos.") {
    super(message);
    this.name = "TicketAttachmentStorageNotConfiguredError";
  }
}

function configuredRoot(): string {
  const root = process.env.TICKET_ATTACHMENT_STORAGE_DIR?.trim();
  if (!root) throw new TicketAttachmentStorageNotConfiguredError();
  if (!path.isAbsolute(root)) {
    throw new TicketAttachmentStorageNotConfiguredError("TICKET_ATTACHMENT_STORAGE_DIR debe ser una ruta absoluta.");
  }
  return path.resolve(root);
}

async function canonicalRoot(): Promise<string> {
  const root = configuredRoot();
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    return await realpath(root);
  } catch {
    throw new TicketAttachmentStorageNotConfiguredError("El directorio de adjuntos no está disponible.");
  }
}

function isWithinRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function keyFromStoragePath(storagePath: string): string {
  if (!storagePath.startsWith(storagePrefix)) throw new Error("Ruta de adjunto local inválida");
  const key = storagePath.slice(storagePrefix.length);
  const parts = key.split("/");
  if (
    parts.length < 4 ||
    parts[0] !== "support-tickets" ||
    parts.some(part => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))
  ) {
    throw new Error("Ruta de adjunto local inválida");
  }
  return parts.join("/");
}

function targetPath(root: string, key: string): string {
  const target = path.resolve(root, ...key.split("/"));
  if (!isWithinRoot(root, target)) throw new Error("Ruta de adjunto local fuera del directorio permitido");
  return target;
}

async function ensureDirectoryTree(root: string, parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    const candidate = path.join(current, part);
    try {
      await mkdir(candidate, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const canonicalCandidate = await realpath(candidate);
    if (!isWithinRoot(root, canonicalCandidate)) {
      throw new Error("Directorio de adjunto fuera del almacenamiento permitido");
    }
    current = canonicalCandidate;
  }
  return current;
}

export async function uploadTicketAttachmentFile(
  data: Buffer,
  ticketId: number,
  extension: string,
): Promise<string> {
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) throw new Error("Ticket inválido para almacenamiento");
  if (![".jpg", ".png", ".webp", ".pdf"].includes(extension)) throw new Error("Extensión de adjunto inválida");

  const root = await canonicalRoot();
  const key = `support-tickets/${ticketId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  const parts = key.split("/");
  const fileName = parts.pop();
  if (!fileName) throw new Error("Nombre de adjunto inválido");
  const parent = await ensureDirectoryTree(root, parts);
  const target = path.join(parent, fileName);
  await writeFile(target, data, { flag: "wx", mode: 0o600 });
  return `${storagePrefix}${key}`;
}

export async function downloadTicketAttachmentFile(storagePath: string): Promise<Response> {
  const root = await canonicalRoot();
  const target = targetPath(root, keyFromStoragePath(storagePath));
  const canonicalTarget = await realpath(target);
  if (!isWithinRoot(root, canonicalTarget)) throw new Error("Archivo fuera del almacenamiento permitido");
  const data = await readFile(canonicalTarget);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function deleteTicketAttachmentFile(storagePath: string): Promise<void> {
  const root = await canonicalRoot();
  const target = targetPath(root, keyFromStoragePath(storagePath));
  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!isWithinRoot(root, canonicalTarget)) throw new Error("Archivo fuera del almacenamiento permitido");
  try {
    await unlink(canonicalTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}