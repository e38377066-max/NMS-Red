import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return createHash("sha256").update(`isp-cockpit-credentials:${secret}`).digest();
}

export function encryptSecret(value: string): string {
  if (value.startsWith(PREFIX)) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

/**
 * Plaintext values are accepted only for a backwards-compatible read of
 * imported installations. All new writes use encryptSecret.
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new Error("Stored credential is invalid");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptBuffer(value: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([Buffer.from(PREFIX), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBuffer(value: Buffer): Buffer {
  const prefix = Buffer.from(PREFIX);
  if (!value.subarray(0, prefix.length).equals(prefix)) return value;
  const payload = value.subarray(prefix.length);
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function redactSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = key.toLowerCase().includes("password") || key.toLowerCase().includes("token")
      ? "[redacted]"
      : redactSecrets(entry);
  }
  return result;
}