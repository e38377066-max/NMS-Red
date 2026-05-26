import { db, equipmentTable, nodesTable, alertsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMikroTikResource } from "./mikrotik.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

let io: SocketServer | null = null;
let monitoringInterval: ReturnType<typeof setInterval> | null = null;

export function setSocketServer(socketServer: SocketServer): void {
  io = socketServer;
}

export function startMonitoring(): void {
  if (monitoringInterval) return;

  logger.info("Starting network monitoring service (60s interval)");

  // Run immediately on start
  void runHeartbeat();

  monitoringInterval = setInterval(() => {
    void runHeartbeat();
  }, 60_000);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

async function runHeartbeat(): Promise<void> {
  try {
    const allEquipment = await db
      .select({
        id: equipmentTable.id,
        ip: equipmentTable.ip,
        username: equipmentTable.username,
        password: equipmentTable.password,
        model: equipmentTable.model,
        lastSeenStatus: equipmentTable.lastSeenStatus,
        nodeId: equipmentTable.nodeId,
      })
      .from(equipmentTable);

    for (const equip of allEquipment) {
      const result = await getMikroTikResource(equip.ip, equip.username, equip.password);
      const newStatus = result.reachable ? "ONLINE" : "OFFLINE";
      const previousStatus = equip.lastSeenStatus;

      await db
        .update(equipmentTable)
        .set({
          lastSeenStatus: newStatus,
          lastCheckedAt: new Date(),
        })
        .where(eq(equipmentTable.id, equip.id));

      // Emit real-time update via WebSocket
      if (io) {
        io.emit("equipment:status", {
          equipmentId: equip.id,
          status: newStatus,
          ip: equip.ip,
        });
      }

      // If went from ONLINE/UNKNOWN to OFFLINE, create alert + audit log
      if (newStatus === "OFFLINE" && previousStatus !== "OFFLINE") {
        // Get node name for alert message
        const [nodeRow] = await db
          .select({ name: nodesTable.name })
          .from(nodesTable)
          .where(eq(nodesTable.id, equip.nodeId));

        const nodeName = nodeRow?.name ?? "Desconocido";
        const alertMessage = `Alerta: El equipo ${equip.model} (${equip.ip}) del nodo ${nodeName} ha dejado de responder`;

        await db.insert(alertsTable).values({
          equipmentId: equip.id,
          equipmentIp: equip.ip,
          equipmentModel: equip.model,
          nodeName,
          message: alertMessage,
        });

        await db.insert(auditLogsTable).values({
          equipmentId: equip.id,
          entity: "Equipment",
          action: "HEARTBEAT_FAIL",
          commandSent: `ping ${equip.ip}`,
          result: "Fail",
          details: alertMessage,
          username: "monitoring-service",
        });

        // Emit alert via WebSocket
        if (io) {
          io.emit("alert:new", { equipmentId: equip.id, message: alertMessage });
        }

        logger.warn({ equipmentId: equip.id, ip: equip.ip }, alertMessage);
      }

      // If recovered from OFFLINE, log the recovery
      if (newStatus === "ONLINE" && previousStatus === "OFFLINE") {
        await db.insert(auditLogsTable).values({
          equipmentId: equip.id,
          entity: "Equipment",
          action: "HEARTBEAT_RECOVERED",
          commandSent: `ping ${equip.ip}`,
          result: "Success",
          details: `Equipo ${equip.model} (${equip.ip}) recuperado y respondiendo`,
          username: "monitoring-service",
        });

        if (io) {
          io.emit("equipment:recovered", { equipmentId: equip.id, ip: equip.ip });
        }

        logger.info({ equipmentId: equip.id, ip: equip.ip }, "Equipment recovered");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error during heartbeat cycle");
  }
}
