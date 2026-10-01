import { Router, type IRouter } from "express";
import { AuditLog } from "../db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
const router: IRouter = Router();
router.get("/audit-logs", async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const where = parsed.data.equipmentId == null ? undefined : { equipmentId: parsed.data.equipmentId };
  const rows = await AuditLog.findAll({ where, order: [["timestamp", "DESC"]], limit: parsed.data.limit ?? 100, raw: true });
  res.json((rows as any[]).map(row => ({ ...row, timestamp: new Date(row.timestamp).toISOString() })));
});
export default router;