import { Router, type IRouter } from "express";
import { db, nodesTable, equipmentTable, clientsTable, alertsTable, auditLogsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/monitoring/summary", async (_req, res): Promise<void> => {
  const [nodeStat] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nodesTable);

  const equipStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${equipmentTable.lastSeenStatus} = 'ONLINE')::int`,
      offline: sql<number>`count(*) filter (where ${equipmentTable.lastSeenStatus} = 'OFFLINE')::int`,
    })
    .from(equipmentTable);

  const [clientStat] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${clientsTable.status} = 'ACTIVE')::int`,
    })
    .from(clientsTable);

  const [auditStat] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(sql`${auditLogsTable.timestamp} > now() - interval '24 hours'`);

  res.json({
    totalNodes: nodeStat?.count ?? 0,
    totalEquipment: equipStats[0]?.total ?? 0,
    onlineEquipment: equipStats[0]?.online ?? 0,
    offlineEquipment: equipStats[0]?.offline ?? 0,
    totalClients: clientStat?.total ?? 0,
    activeClients: clientStat?.active ?? 0,
    recentAuditCount: auditStat?.count ?? 0,
  });
});

router.get("/monitoring/alerts", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(alertsTable)
    .orderBy(desc(alertsTable.timestamp))
    .limit(50);
  res.json(rows);
});

export default router;
