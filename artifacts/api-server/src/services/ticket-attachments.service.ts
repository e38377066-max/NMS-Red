import path from "node:path";
import { createHash } from "node:crypto";
import { db, ticketAttachmentsTable } from "@workspace/db";
import { deletePrivateObject, uploadPrivateObject } from "./object-storage.service";

const supportedTypes = new Map<string, { extension: string; signature: (data: Buffer) => boolean }>([
  ["image/jpeg", { extension: ".jpg", signature: data => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff }],
  ["image/png", { extension: ".png", signature: data => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ["image/webp", { extension: ".webp", signature: data => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" }],
  ["application/pdf", { extension: ".pdf", signature: data => data.subarray(0, 5).toString("ascii") === "%PDF-" }],
]);
const maxBytes = 2 * 1024 * 1024;

function safeFileName(value: string, extension: string): string {
  const normalized = path.basename(value.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return normalized || `evidencia${extension}`;
}

function decodeBase64(value: string, mimeType: string): { data: Buffer; extension: string } | null {
  const type = supportedTypes.get(mimeType.trim().toLowerCase());
  if (!type) return null;
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const data = Buffer.from(base64, "base64");
  if (data.length === 0 || data.length > maxBytes || !type.signature(data)) return null;
  return { data, extension: type.extension };
}

export async function createTicketAttachment(input: {
  ticketId: number;
  fileName: string;
  mimeType: string;
  dataBase64: string;
  visibleToClient: boolean;
  uploadedByUserId?: number | null;
  uploadedByClientId?: number | null;
}) {
  const decoded = decodeBase64(input.dataBase64, input.mimeType);
  if (!decoded) return null;
  const storagePath = await uploadPrivateObject(
    decoded.data,
    input.mimeType,
    decoded.extension,
    `support-tickets/${input.ticketId}`,
  );
  try {
    const [attachment] = await db.insert(ticketAttachmentsTable).values({
      ticketId: input.ticketId,
      uploadedByUserId: input.uploadedByUserId ?? null,
      uploadedByClientId: input.uploadedByClientId ?? null,
      fileName: safeFileName(input.fileName, decoded.extension),
      mimeType: input.mimeType,
      sizeBytes: decoded.data.length,
      sha256: createHash("sha256").update(decoded.data).digest("hex"),
      storagePath,
      visibleToClient: input.visibleToClient,
    }).returning();
    return attachment;
  } catch (error) {
    try {
      await deletePrivateObject(storagePath);
    } catch {
      // Keep the original database error; orphaned objects can be cleaned up operationally.
    }
    throw error;
  }
}