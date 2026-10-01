import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { Op, Transaction } from "sequelize";
import { AuthSession, sequelize, User } from "../db";
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

/**
 * Creates the first administrator only when both explicit bootstrap variables
 * are present. There is intentionally no default username or password.
 */
export async function bootstrapInitialAdmin(): Promise<void> {
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) return;
  if (password.length < 8) throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 8 characters");
  await sequelize.transaction(async (transaction) => {
    const count = await User.count({ transaction });
    if (count > 0) return;
    await User.create({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
    }, { transaction });
  });
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
  transaction?: Transaction,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await AuthSession.create({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent?.slice(0, 512) ?? null,
  }, { transaction });
}

export async function revokeSession(token: string): Promise<void> {
  await AuthSession.update(
    { revokedAt: new Date() },
    { where: { tokenHash: hashSessionToken(token) } },
  );
}

export async function extractUserFromRequest(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const tokenPayload = verifyToken(token);
  if (!tokenPayload) return null;
  const session = await AuthSession.findOne({
    attributes: ["userId"],
    where: {
      tokenHash: hashSessionToken(token),
      userId: tokenPayload.id,
      revokedAt: { [Op.is]: null },
      expiresAt: { [Op.gt]: new Date() },
    },
  });
  if (!session) return null;
  await AuthSession.update(
    { lastUsedAt: new Date() },
    { where: { tokenHash: hashSessionToken(token) } },
  );
  return { id: tokenPayload.id, username: tokenPayload.username, role: tokenPayload.role };
}
