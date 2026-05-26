import { Router, type IRouter } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/audit-logs", async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const limit = parsed.data.limit ?? 100;

  const rows = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(limit);

  res.json(rows);
});

export default router;
