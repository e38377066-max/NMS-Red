import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sequelize } from "../db";
const router: IRouter = Router();
router.get("/healthz", (_req, res) => res.json(HealthCheckResponse.parse({ status: "ok" })));
router.get("/readyz", async (_req, res): Promise<void> => {
  try { await sequelize.query("SELECT 1"); res.json({ status: "ready", database: "ok" }); }
  catch { res.status(503).json({ status: "not_ready", database: "unavailable" }); }
});
export default router;