import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type StorageProvider = "s3" | "filesystem";

function config(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for backup storage`);
  return value;
}

function provider(): StorageProvider {
  const value = process.env.BACKUP_STORAGE_PROVIDER?.trim().toLowerCase();
  if (value !== "s3" && value !== "filesystem") {
    throw new Error("BACKUP_STORAGE_PROVIDER must be either s3 or filesystem");
  }
  return value;
}

function objectKey(pathValue: string): string {
  const key = pathValue.replace(/^\/+/, "");
  if (!key || key.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new Error("Invalid private object key");
  }
  return key;
}

function contentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsSigningKey(secret: string, date: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function encodePath(key: string): string {
  return `/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function s3RequestUrl(key: string): URL {
  const endpoint = process.env.S3_ENDPOINT?.trim()
    || `https://s3.${config("AWS_REGION")}.amazonaws.com`;
  const url = new URL(endpoint);
  const bucket = config("S3_BUCKET");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}${encodePath(key)}`;
  return url;
}

async function s3Request(
  method: "GET" | "PUT",
  key: string,
  body?: Buffer,
  contentType = "application/octet-stream",
): Promise<Response> {
  const region = config("AWS_REGION");
  const accessKey = config("AWS_ACCESS_KEY_ID");
  const secret = config("AWS_SECRET_ACCESS_KEY");
  const url = s3RequestUrl(key);
  const payloadHash = contentHash(body ?? Buffer.alloc(0));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const host = url.host.toLowerCase();
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", awsSigningKey(secret, shortDate, region))
    .update(stringToSign)
    .digest("hex");

  return fetch(url, {
    method,
    headers: {
      Host: host,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });
}

function filesystemRoot(): string {
  const root = process.env.BACKUP_STORAGE_DIR?.trim();
  if (!root) throw new Error("BACKUP_STORAGE_DIR must be configured for filesystem backup storage");
  if (!path.isAbsolute(root)) throw new Error("BACKUP_STORAGE_DIR must be an absolute path");
  return path.resolve(root);
}

function filesystemPath(key: string): string {
  const root = filesystemRoot();
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid private object path");
  }
  return target;
}

export async function uploadPrivateObject(
  data: Buffer,
  contentType: string,
  extension: string,
): Promise<string> {
  const key = `backups/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  if (provider() === "filesystem") {
    const target = filesystemPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { mode: 0o600 });
    return `fs://${key}`;
  }
  const response = await s3Request("PUT", key, data, contentType);
  if (!response.ok) throw new Error(`Object storage upload failed (${response.status})`);
  return `s3://${config("S3_BUCKET")}/${key}`;
}

export async function downloadPrivateObject(objectPath: string): Promise<Response> {
  if (objectPath.startsWith("fs://")) {
    const data = await readFile(filesystemPath(objectKey(objectPath.slice("fs://".length))));
    return new Response(data, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  }
  if (!objectPath.startsWith("s3://")) throw new Error("Invalid private object path");
  const prefix = `s3://${config("S3_BUCKET")}/`;
  if (!objectPath.startsWith(prefix)) throw new Error("Backup belongs to another storage bucket");
  const response = await s3Request("GET", objectKey(objectPath.slice(prefix.length)));
  if (!response.ok) throw new Error(`Object storage download failed (${response.status})`);
  return response;
}