import { Router, type IRouter } from "express";
import { db, equipmentTable, clientsTable, alertsTable, nodesTable, proxmoxServersTable } from "@workspace/db";
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

  // Build rich multi-brand network context
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
    .limit(8);

  // Offline equipment with full context (role + brand + node)
  const offlineEquipmentList = await db
    .select({
      model: equipmentTable.model,
      ip: equipmentTable.ip,
      role: equipmentTable.equipmentRole,
      brand: equipmentTable.connectionType,
      node: nodesTable.name,
    })
    .from(equipmentTable)
    .leftJoin(nodesTable, eq(nodesTable.id, equipmentTable.nodeId))
    .where(eq(equipmentTable.lastSeenStatus, "OFFLINE"));

  // Proxmox servers status
  const proxmoxServers = await db
    .select({
      name: proxmoxServersTable.name,
      ip: proxmoxServersTable.ip,
      status: proxmoxServersTable.lastSeenStatus,
    })
    .from(proxmoxServersTable);

  const context = {
    totalEquipment: equipStats[0]?.total ?? 0,
    onlineEquipment: equipStats[0]?.online ?? 0,
    offlineEquipment: equipStats[0]?.offline ?? 0,
    totalClients: clientStat?.total ?? 0,
    recentAlerts: recentAlerts.map((a) => a.message),
    offlineEquipmentList: offlineEquipmentList.map(e => ({
      model: e.model,
      ip: e.ip,
      role: e.role,
      brand: e.brand === "ubiquiti_airos" ? "Ubiquiti" : "MikroTik",
      node: e.node ?? "Desconocido",
    })),
    proxmoxServers,
  };

  const reply = await askOllama(parsed.data.message, context);

  res.json({
    reply,
    context: `Red: ${context.onlineEquipment}/${context.totalEquipment} online, ${context.totalClients} clientes, ${proxmoxServers.length} Proxmox`,
  });
});

export default router;
