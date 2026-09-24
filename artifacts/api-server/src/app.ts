import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
app.use(cors());
app.use(express.json({ limit: "16mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Portal de Suspensión ──────────────────────────────────────────────────
// Sirve la página de aviso de suspensión para el captive portal de MikroTik.
// El CHR redirige clientes en Address List "Clientes_Cortados" con una regla NAT:
//   /ip firewall nat add chain=dstnat src-address-list=Clientes_Cortados \
//     protocol=tcp dst-port=80 action=dst-nat \
//     to-addresses=<IP_DEL_SERVIDOR> to-ports=<PORT> \
//     comment="Portal de Suspensión"
let portalHtml: string | null = null;
try {
  portalHtml = readFileSync(join(import.meta.dirname, "portal", "suspension.html"), "utf-8");
} catch {
  logger.warn("Portal HTML not found — /portal route will return 404");
}

app.get("/portal", (_req, res) => {
  if (!portalHtml) { res.status(404).send("Portal not configured"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(portalHtml);
});

app.get("/portal/suspendido", (_req, res) => {
  if (!portalHtml) { res.status(404).send("Portal not configured"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(portalHtml);
});
// ──────────────────────────────────────────────────────────────────────────

app.use("/api", router);

export default app;
