import { db, equipmentTable, nodesTable, alertsTable, auditLogsTable, proxmoxServersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMikroTikResource } from "./mikrotik.service";
import { getUbiquitiStatus } from "./ubiquiti.service";
import { getProxmoxTicket, getProxmoxNodeStatus } from "./proxmox.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

let io: SocketServer | null = null;
let monitoringInterval: ReturnType<typeof setInterval> | null = null;

export function setSocketServer(socketServer: SocketServer): void {
  io = socketServer;
}

export function startMonitoring(): void {
  if (monitoringInterval) return;
  logger.info("Starting multi-brand network monitoring service (60s interval)");
  void runHeartbeat();
  monitoringInterval = setInterval(() => { void runHeartbeat(); }, 60_000);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

async function runHeartbeat(): Promise<void> {
  try {
    await Promise.all([
      checkAllEquipment(),
      checkAllProxmox(),
    ]);
  } catch (err) {
    logger.error({ err }, "Heartbeat cycle failed");
  }
}

async function checkAllEquipment(): Promise<void> {
  const allEquipment = await db
    .select({
      id: equipmentTable.id,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      password: equipmentTable.password,
      model: equipmentTable.model,
      connectionType: equipmentTable.connectionType,
      equipmentRole: equipmentTable.equipmentRole,
      lastSeenStatus: equipmentTable.lastSeenStatus,
      nodeId: equipmentTable.nodeId,
    })
    .from(equipmentTable);

  for (const equip of allEquipment) {
    let reachable = false;

    if (equip.connectionType === "ubiquiti_airos") {
      const result = await getUbiquitiStatus(equip.ip, equip.username, equip.password);
      reachable = result.reachable;
    } else {
      const result = await getMikroTikResource(equip.ip, equip.username, equip.password);
      reachable = result.reachable;
    }

    const newStatus = reachable ? "ONLINE" : "OFFLINE";
    const previousStatus = equip.lastSeenStatus;

    await db
      .update(equipmentTable)
      .set({ lastSeenStatus: newStatus, lastCheckedAt: new Date() })
      .where(eq(equipmentTable.id, equip.id));

    if (io) {
      io.emit("equipment:status", { equipmentId: equip.id, status: newStatus, ip: equip.ip });
    }

    if (newStatus === "OFFLINE" && previousStatus !== "OFFLINE") {
      const [nodeRow] = await db
        .select({ name: nodesTable.name })
        .from(nodesTable)
        .where(eq(nodesTable.id, equip.nodeId));
      const nodeName = nodeRow?.name ?? "Desconocido";
      const brand = equip.connectionType === "ubiquiti_airos" ? "Ubiquiti" : "MikroTik";
      const alertMessage = `Alerta: El equipo ${equip.model} [${brand}] (${equip.ip}) del nodo ${nodeName} ha dejado de responder`;

      await db.insert(alertsTable).values({
        equipmentId: equip.id,
        equipmentIp: equip.ip,
        equipmentModel: equip.model,
        nodeName,
        message: alertMessage,
      });
      await db.insert(auditLogsTable).values({
        entity: "Equipment",
        action: "HEARTBEAT_FAIL",
        commandSent: `ping ${equip.ip}`,
        result: "Fail",
        details: alertMessage,
        equipmentId: equip.id,
      });

      if (io) io.emit("alert:new", { equipmentId: equip.id, message: alertMessage });
      logger.warn({ ip: equip.ip, brand }, "Equipment went OFFLINE");
    }

    if (newStatus === "ONLINE" && previousStatus === "OFFLINE") {
      const brand = equip.connectionType === "ubiquiti_airos" ? "Ubiquiti" : "MikroTik";
      await db.insert(auditLogsTable).values({
        entity: "Equipment",
        action: "HEARTBEAT_RECOVER",
        commandSent: `ping ${equip.ip}`,
        result: "Success",
        details: `Equipo ${equip.model} [${brand}] (${equip.ip}) se ha recuperado`,
        equipmentId: equip.id,
      });
      if (io) io.emit("equipment:recovered", { equipmentId: equip.id, ip: equip.ip });
      logger.info({ ip: equip.ip, brand }, "Equipment recovered");
    }
  }
}

async function checkAllProxmox(): Promise<void> {
  const servers = await db.select().from(proxmoxServersTable);
  for (const server of servers) {
    const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
    const isOnline = ticket !== null;
    const newStatus = isOnline ? "ONLINE" : "OFFLINE";
    const previousStatus = server.lastSeenStatus;

    await db
      .update(proxmoxServersTable)
      .set({ lastSeenStatus: newStatus, lastCheckedAt: new Date() })
      .where(eq(proxmoxServersTable.id, server.id));

    if (isOnline && ticket) {
      try {
        await getProxmoxNodeStatus(server.ip, server.port, ticket, server.nodeName);
      } catch { /* optional enrichment */ }
    }

    if (newStatus === "OFFLINE" && previousStatus !== "OFFLINE") {
      logger.warn({ ip: server.ip, name: server.name }, "Proxmox server went OFFLINE");
      if (io) io.emit("proxmox:offline", { serverId: server.id, name: server.name });
    }
    if (newStatus === "ONLINE" && previousStatus === "OFFLINE") {
      logger.info({ ip: server.ip, name: server.name }, "Proxmox server recovered");
    }
  }
}
