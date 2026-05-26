import { Router, type IRouter } from "express";
import { db, equipmentTable, clientsTable, alertsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { AiChatBody } from "@workspace/api-zod";
import { askOllama } from "../services/ai.service";

const router: IRouter = Router();

router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Build network context from DB
  const equipStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${equipmentTable.lastSeenStatus} = 'ONLINE')::int`,
      offline: sql<number>`count(*) filter (where ${equipmentTable.lastSeenStatus} = 'OFFLINE')::int`,
    })
    .from(equipmentTable);

  const [clientStat] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(clientsTable);

  const recentAlerts = await db
    .select({ message: alertsTable.message })
    .from(alertsTable)
    .orderBy(desc(alertsTable.timestamp))
    .limit(5);

  const context = {
    totalEquipment: equipStats[0]?.total ?? 0,
    onlineEquipment: equipStats[0]?.online ?? 0,
    offlineEquipment: equipStats[0]?.offline ?? 0,
    totalClients: clientStat?.total ?? 0,
    recentAlerts: recentAlerts.map((a) => a.message),
  };

  const reply = await askOllama(parsed.data.message, context);

  res.json({
    reply,
    context: `Red: ${context.onlineEquipment}/${context.totalEquipment} online, ${context.totalClients} clientes`,
  });
});

export default router;
