import { Router, type IRouter } from "express";
import { db, nodesTable, equipmentTable, clientsTable, alertsTable, auditLogsTable, proxmoxServersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { getNetworkMonitoringSnapshot } from "../services/network-monitoring.service";

const router: IRouter = Router();

router.get("/monitoring/overview", async (_req, res): Promise<void> => {
  const snapshot = await getNetworkMonitoringSnapshot();
  res.json(snapshot);
});

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

  const [proxmoxStat] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(proxmoxServersTable);

  res.json({
    totalNodes: nodeStat?.count ?? 0,
    totalEquipment: equipStats[0]?.total ?? 0,
    onlineEquipment: equipStats[0]?.online ?? 0,
    offlineEquipment: equipStats[0]?.offline ?? 0,
    totalClients: clientStat?.total ?? 0,
    activeClients: clientStat?.active ?? 0,
    recentAuditCount: auditStat?.count ?? 0,
    totalProxmoxServers: proxmoxStat?.count ?? 0,
  });
});

router.get("/monitoring/alerts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: alertsTable.id,
      equipmentId: alertsTable.equipmentId,
      equipmentIp: equipmentTable.ip,
      equipmentModel: equipmentTable.model,
      nodeName: nodesTable.name,
      message: alertsTable.message,
      timestamp: alertsTable.timestamp,
    })
    .from(alertsTable)
    .leftJoin(equipmentTable, eq(alertsTable.equipmentId, equipmentTable.id))
    .leftJoin(nodesTable, eq(equipmentTable.nodeId, nodesTable.id))
    .orderBy(desc(alertsTable.timestamp))
    .limit(50);

  res.json(rows.map(r => ({
    ...r,
    equipmentIp: r.equipmentIp ?? "N/A",
    timestamp: r.timestamp?.toISOString() ?? new Date().toISOString(),
  })));
});

// Full topology view: nodes + equipment with roles + proxmox servers
router.get("/monitoring/topology", async (_req, res): Promise<void> => {
  const allNodes = await db.select().from(nodesTable).orderBy(nodesTable.name);

  const allEquipment = await db
    .select({
      id: equipmentTable.id,
      nodeId: equipmentTable.nodeId,
      nodeName: nodesTable.name,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      model: equipmentTable.model,
      connectionType: equipmentTable.connectionType,
      equipmentRole: equipmentTable.equipmentRole,
      snmpCommunity: equipmentTable.snmpCommunity,
      apiPort: equipmentTable.apiPort,
      lastSeenStatus: equipmentTable.lastSeenStatus,
      lastCheckedAt: equipmentTable.lastCheckedAt,
      createdAt: equipmentTable.createdAt,
      clientCount: sql<number>`count(${clientsTable.id})::int`,
    })
    .from(equipmentTable)
    .leftJoin(nodesTable, eq(nodesTable.id, equipmentTable.nodeId))
    .leftJoin(clientsTable, eq(clientsTable.equipmentId, equipmentTable.id))
    .groupBy(equipmentTable.id, nodesTable.name)
    .orderBy(equipmentTable.equipmentRole);

  const proxmoxList = await db
    .select({
      id: proxmoxServersTable.id,
      name: proxmoxServersTable.name,
      ip: proxmoxServersTable.ip,
      port: proxmoxServersTable.port,
      username: proxmoxServersTable.username,
      nodeName: proxmoxServersTable.nodeName,
      lastSeenStatus: proxmoxServersTable.lastSeenStatus,
      lastCheckedAt: proxmoxServersTable.lastCheckedAt,
      createdAt: proxmoxServersTable.createdAt,
    })
    .from(proxmoxServersTable)
    .orderBy(proxmoxServersTable.name);

  // Group equipment by nodeId
  const equipByNode = new Map<number, typeof allEquipment>();
  for (const eq_ of allEquipment) {
    if (!equipByNode.has(eq_.nodeId)) equipByNode.set(eq_.nodeId, []);
    equipByNode.get(eq_.nodeId)!.push(eq_);
  }

  const topologyNodes = allNodes.map((node) => ({
    id: node.id,
    name: node.name,
    location: node.location,
    role: node.role,
    equipment: equipByNode.get(node.id) ?? [],
  }));

  res.json({ nodes: topologyNodes, proxmoxServers: proxmoxList });
});

export default router;
