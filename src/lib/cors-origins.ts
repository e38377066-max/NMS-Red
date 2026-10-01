function normalizeOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return parsed.origin === "null" ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  } catch {
    return null;
  }
}

export const allowedCorsOrigins = [
  ...(process.env.CORS_ORIGINS ?? "").split(","),
  ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  process.env.REPLIT_DEV_DOMAIN ?? "",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]
  .map(normalizeOrigin)
  .filter((origin): origin is string => origin !== null);

export function isAllowedCorsOrigin(origin?: string): boolean {
  return !origin || allowedCorsOrigins.includes(origin);
}

export function corsOriginCallback(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  callback(null, isAllowedCorsOrigin(origin));
}