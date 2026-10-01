import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const normalizeOrigin = (value: string): string | null => {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(candidate.includes("://") ? candidate : `https://${candidate}`).origin;
  } catch {
    return null;
  }
};
const configuredOrigins = [
  ...(process.env.CORS_ORIGINS ?? "").split(","),
  ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  process.env.REPLIT_DEV_DOMAIN ?? "",
  process.env.REPLIT_EXPO_DEV_DOMAIN ?? "",
].map(normalizeOrigin).filter((origin): origin is string => origin !== null);

app.use(cors({
  origin: configuredOrigins.length > 0
    ? (origin, callback) => {
        if (!origin || configuredOrigins.includes(origin)) callback(null, true);
        else callback(null, false);
      }
    : false,
}));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use("/api/equipment/:id/configuration/preview", express.json({ limit: "18mb" }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "4mb" }));
app.use(express.urlencoded({ extended: true }));

// The customer-facing React portal owns /portal. Keep the captive suspension
// page on its explicit existing alias to avoid colliding with that SPA route.
let portalHtml: string | null = null;
try {
  portalHtml = readFileSync(join(import.meta.dirname, "portal", "suspension.html"), "utf-8");
} catch {
  logger.warn("Portal HTML not found — /portal/suspendido route will return 404");
}

app.get("/portal/suspendido", (_req, res) => {
  if (!portalHtml) { res.status(404).send("Portal not configured"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(portalHtml);
});
// ──────────────────────────────────────────────────────────────────────────

app.use("/api", router);

const frontendDist = resolve(import.meta.dirname, "../dist");
if (existsSync(join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist, { index: false }));
  app.get("*path", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/api" || req.path.startsWith("/ws/")) {
      next();
      return;
    }
    if (!req.accepts("html")) {
      next();
      return;
    }
    res.sendFile(join(frontendDist, "index.html"), error => {
      if (error) next(error);
    });
  });
} else {
  logger.warn({ frontendDist }, "Frontend build not found; serving API only");
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, "Unhandled API error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Error interno del servidor" });
});

export default app;
