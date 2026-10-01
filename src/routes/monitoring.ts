import { Router, type IRouter } from "express";
import { sequelize } from "../db";
import { getNetworkMonitoringSnapshot } from "../services/network-monitoring.service";
const router: IRouter = Router();
router.get("/monitoring/overview", async (_req,res)=>res.json(await getNetworkMonitoringSnapshot()));
router.get("/monitoring/summary", async (_req,res)=>{
  const [rows] = await sequelize.query(`SELECT
    (SELECT count(*)::int FROM nodes) AS "totalNodes",
    (SELECT count(*)::int FROM equipment) AS "totalEquipment",
    (SELECT count(*) FILTER(WHERE last_seen_status='ONLINE')::int FROM equipment) AS "onlineEquipment",
    (SELECT count(*) FILTER(WHERE last_seen_status='OFFLINE')::int FROM equipment) AS "offlineEquipment",
    (SELECT count(*)::int FROM clients) AS "totalClients",
    (SELECT count(*) FILTER(WHERE status='ACTIVE')::int FROM clients) AS "activeClients",
    (SELECT count(*)::int FROM audit_logs WHERE timestamp > now() - interval '24 hours') AS "recentAuditCount",
    (SELECT count(*)::int FROM proxmox_servers) AS "totalProxmoxServers"`);
  res.json((rows as any[])[0]);
});
router.get("/monitoring/alerts", async (_req,res)=>{
  const [rows] = await sequelize.query(`SELECT a.id,a.equipment_id AS "equipmentId",e.ip AS "equipmentIp",e.model AS "equipmentModel",
    n.name AS "nodeName",a.message,a.timestamp FROM alerts a LEFT JOIN equipment e ON e.id=a.equipment_id
    LEFT JOIN nodes n ON n.id=e.node_id ORDER BY a.timestamp DESC LIMIT 50`);
  res.json((rows as any[]).map(r=>({...r,equipmentIp:r.equipmentIp??"N/A",timestamp:r.timestamp?new Date(r.timestamp).toISOString():new Date().toISOString()})));
});
router.get("/monitoring/topology", async (_req,res)=>{
  const [nodes] = await sequelize.query(`SELECT id,name,location,role,created_at AS "createdAt" FROM nodes ORDER BY name`);
  const [equipment] = await sequelize.query(`SELECT e.id,e.node_id AS "nodeId",n.name AS "nodeName",e.ip,e.username,e.model,e.connection_type AS "connectionType",
    e.equipment_role AS "equipmentRole",e.snmp_community AS "snmpCommunity",e.api_port AS "apiPort",e.last_seen_status AS "lastSeenStatus",
    e.last_checked_at AS "lastCheckedAt",e.created_at AS "createdAt",count(c.id)::int AS "clientCount" FROM equipment e
    LEFT JOIN nodes n ON n.id=e.node_id LEFT JOIN clients c ON c.equipment_id=e.id GROUP BY e.id,n.name ORDER BY e.equipment_role`);
  const [proxmoxServers] = await sequelize.query(`SELECT id,name,ip,port,username,node_name AS "nodeName",last_seen_status AS "lastSeenStatus",
    last_checked_at AS "lastCheckedAt",created_at AS "createdAt" FROM proxmox_servers ORDER BY name`);
  const byNode=new Map<number,any[]>(); for(const e of equipment as any[]) {if(!byNode.has(e.nodeId))byNode.set(e.nodeId,[]);byNode.get(e.nodeId)!.push(e);}
  res.json({nodes:(nodes as any[]).map(n=>({...n,equipment:byNode.get(n.id)??[]})),proxmoxServers});
});
export default router;