import { db, equipmentTable, nodesTable, alertsTable, auditLogsTable, proxmoxServersTable, clientsTable, metricHistoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getMikroTikResource } from "./mikrotik.service";
import { getUbiquitiStatus, getWirelessTable } from "./ubiquiti.service";
import { getProxmoxTicket, getProxmoxNodeStatus } from "./proxmox.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

let io: SocketServer | null = null;
let monitoringInterval: ReturnType<typeof setInterval> | null = null;
let metricsInterval: ReturnType<typeof setInterval> | null = null;

const prevReadings = new Map<number, { signalDbm: number; ccq: number; ts: number }>();

export function setSocketServer(socketServer: SocketServer): void {
  io = socketServer;
}

export function startMonitoring(): void {
  if (monitoringInterval) return;
  logger.info("Starting Imperio AP network monitoring service (60s interval)");
  void runHeartbeat();
  monitoringInterval = setInterval(() => { void runHeartbeat(); }, 60_000);

  logger.info("Starting 5-min metrics collection");
  setTimeout(() => {
    void collectMetrics();
    metricsInterval = setInterval(() => { void collectMetrics(); }, 5 * 60_000);
  }, 30_000);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
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
        await getProxmoxNodeStatus(server.ip, server.port, ticket, server.nodeName ?? "pve");
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

async function collectMetrics(): Promise<void> {
  try {
    const ubiquitiEquipment = await db
      .select({
        id: equipmentTable.id,
        ip: equipmentTable.ip,
        username: equipmentTable.username,
        password: equipmentTable.password,
        model: equipmentTable.model,
        lastSeenStatus: equipmentTable.lastSeenStatus,
      })
      .from(equipmentTable)
      .where(eq(equipmentTable.connectionType, "ubiquiti_airos"));

    const allClients = await db
      .select({ id: clientsTable.id, mac: clientsTable.mac, equipmentId: clientsTable.equipmentId })
      .from(clientsTable);

    for (const equip of ubiquitiEquipment) {
      if (equip.lastSeenStatus === "OFFLINE") continue;

      try {
        const stations = await getWirelessTable(equip.ip, equip.username, equip.password, "ubiquiti_airos");
        if (!stations || stations.length === 0) continue;

        const validSignals = stations.map(s => parseFloat(s.signalDbm)).filter(v => !isNaN(v));
        const validCcq = stations.map(s => parseFloat(s.ccq)).filter(v => !isNaN(v));

        const avgSignal = validSignals.length > 0
          ? validSignals.reduce((a, b) => a + b, 0) / validSignals.length
          : null;
        const avgCcq = validCcq.length > 0
          ? validCcq.reduce((a, b) => a + b, 0) / validCcq.length
          : null;

        await db.insert(metricHistoryTable).values({
          equipmentId: equip.id,
          clientId: null,
          signalDbm: avgSignal !== null ? String(avgSignal.toFixed(1)) : null,
          ccq: avgCcq !== null ? String(avgCcq.toFixed(1)) : null,
        });

        detectDegradation(equip.id, equip.model, equip.ip, avgSignal, avgCcq);

        const equipClients = allClients.filter(c => c.equipmentId === equip.id);
        for (const client of equipClients) {
          const sta = stations.find(s => s.mac.toLowerCase() === client.mac.toLowerCase());
          if (!sta) continue;
          const clientSignal = parseFloat(sta.signalDbm);
          const clientCcq = parseFloat(sta.ccq);
          if (!isNaN(clientSignal) || !isNaN(clientCcq)) {
            await db.insert(metricHistoryTable).values({
              equipmentId: null,
              clientId: client.id,
              signalDbm: !isNaN(clientSignal) ? String(clientSignal) : null,
              ccq: !isNaN(clientCcq) ? String(clientCcq) : null,
            });
          }
        }
      } catch (err) {
        logger.warn({ err, ip: equip.ip }, "Metrics collection failed for equipment");
      }
    }
  } catch (err) {
    logger.error({ err }, "Metrics collection cycle failed");
  }
}

function detectDegradation(
  equipmentId: number,
  model: string,
  ip: string,
  signalDbm: number | null,
  ccq: number | null
): void {
  const prev = prevReadings.get(equipmentId);

  if (prev && signalDbm !== null && ccq !== null) {
    const signalDrop = prev.signalDbm - signalDbm;
    const ccqDrop = prev.ccq - ccq;

    if (signalDrop >= 4 || ccqDrop >= 15) {
      const msg = `⚠ Degradación detectada en ${model} (${ip}): señal ${signalDrop >= 4 ? `bajó ${signalDrop.toFixed(1)}dBm` : ""} ${ccqDrop >= 15 ? `CCQ cayó ${ccqDrop.toFixed(0)}%` : ""}. Revisar alineación o interferencia.`;
      logger.warn({ equipmentId, signalDrop, ccqDrop, ip }, "Network degradation detected");
      if (io) {
        io.emit("ai:degradation", {
          equipmentId,
          model,
          ip,
          message: msg,
          signalDbm,
          prevSignalDbm: prev.signalDbm,
          ccq,
          prevCcq: prev.ccq,
        });
      }
    }
  }

  if (signalDbm !== null && ccq !== null) {
    prevReadings.set(equipmentId, { signalDbm, ccq, ts: Date.now() });
  }
}
