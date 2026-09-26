import { randomUUID } from "node:crypto";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function privateDir(): string {
  const value = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return value.replace(/\/+$/, "");
}

function splitObjectPath(path: string): { bucketName: string; objectName: string } {
  const parts = path.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.length === 0) throw new Error("Invalid private object path");
  return { bucketName, objectName: parts.join("/") };
}

async function signedUrl(
  bucketName: string,
  objectName: string,
  method: "GET" | "PUT",
  ttlSeconds = 900,
): Promise<string> {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage signing failed (${response.status})`);
  const body = await response.json() as { signed_url?: string };
  if (!body.signed_url) throw new Error("Object storage returned no signed URL");
  return body.signed_url;
}

export async function uploadPrivateObject(
  data: Buffer,
  contentType: string,
  extension: string,
): Promise<string> {
  const objectPath = `${privateDir()}/backups/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  const { bucketName, objectName } = splitObjectPath(objectPath);
  const url = await signedUrl(bucketName, objectName, "PUT");
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: data,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Object storage upload failed (${response.status})`);
  return `/objects/${objectName}`;
}

export async function downloadPrivateObject(objectPath: string): Promise<Response> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private object path");
  const { bucketName, objectName } = splitObjectPath(`${privateDir()}/${objectPath.slice("/objects/".length)}`);
  const url = await signedUrl(bucketName, objectName, "GET");
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Object storage download failed (${response.status})`);
  return response;
}