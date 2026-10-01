import { Router, type IRouter } from "express";
import { sequelize, Equipment, Client, Alert, Node, ProxmoxServer } from "../db";
import { AiChatBody } from "@workspace/api-zod";
import { askOllama } from "../services/ai.service";

const router: IRouter = Router();
router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [stats] = await sequelize.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE last_seen_status = 'ONLINE')::int AS online,
            count(*) FILTER (WHERE last_seen_status = 'OFFLINE')::int AS offline FROM equipment`);
  const [clientRows] = await sequelize.query(`SELECT count(*)::int AS total FROM clients`);
  const recentAlerts = await Alert.findAll({ order: [["timestamp", "DESC"]], limit: 8, raw: true });
  const offline = await sequelize.query(
    `SELECT e.model, e.ip, e.equipment_role AS role, e.connection_type AS brand, n.name AS node
     FROM equipment e LEFT JOIN nodes n ON n.id=e.node_id WHERE e.last_seen_status = :status`,
    { replacements: { status: "OFFLINE" }, type: "SELECT" });
  const proxmoxServers = await ProxmoxServer.findAll({ attributes: ["name", "ip", ["last_seen_status", "status"]], raw: true });
  const context = {
    totalEquipment: Number((stats as any[])[0]?.total ?? 0), onlineEquipment: Number((stats as any[])[0]?.online ?? 0),
    offlineEquipment: Number((stats as any[])[0]?.offline ?? 0), totalClients: Number((clientRows as any[])[0]?.total ?? 0),
    recentAlerts: (recentAlerts as any[]).map(a => a.message),
    offlineEquipmentList: (offline as any[]).map(e => ({ ...e, brand: e.brand === "ubiquiti_airos" ? "Ubiquiti" : "MikroTik", node: e.node ?? "Desconocido" })),
    proxmoxServers,
  };
  const reply = await askOllama(parsed.data.message, context);
  res.json({ reply, context: `Red: ${context.onlineEquipment}/${context.totalEquipment} online, ${context.totalClients} clientes, ${proxmoxServers.length} Proxmox` });
});
export default router;