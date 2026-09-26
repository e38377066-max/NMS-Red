import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authSessionsTable, db } from "@workspace/db";
import { hashSessionToken } from "./credentials.service";

const SALT_ROUNDS = 10;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function getJwtSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

export type AuthUser = { id: number; username: string; role: string };
export type AuthToken = AuthUser & { jti: string };

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: AuthUser): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, getJwtSecret(), { expiresIn: "8h" });
}

export function verifyToken(token: string): AuthToken | null {
  try {
    return jwt.verify(token, getJwtSecret()) as unknown as AuthToken;
  } catch {
    return null;
  }
}

export async function createSession(
  token: string,
  user: AuthUser,
  metadata: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent?.slice(0, 512) ?? null,
  });
}

export async function revokeSession(token: string): Promise<void> {
  await db.update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
}

export async function extractUserFromRequest(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const tokenPayload = verifyToken(token);
  if (!tokenPayload) return null;
  const [session] = await db.select({ userId: authSessionsTable.userId })
    .from(authSessionsTable)
    .where(and(
      eq(authSessionsTable.tokenHash, hashSessionToken(token)),
      eq(authSessionsTable.userId, tokenPayload.id),
      isNull(authSessionsTable.revokedAt),
      gt(authSessionsTable.expiresAt, new Date()),
    ));
  if (!session) return null;
  await db.update(authSessionsTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
  return { id: tokenPayload.id, username: tokenPayload.username, role: tokenPayload.role };
}
