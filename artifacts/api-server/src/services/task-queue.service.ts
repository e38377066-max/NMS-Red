/**
 * In-memory Task Queue
 *
 * - Tasks for different equipments run in parallel.
 * - Tasks for the same equipment run serially (one at a time).
 * - Each task retries up to maxRetries times (default 3) with exponential backoff.
 * - Results are written to the Audit Log.
 * - WebSocket events: task:queued, task:started, task:completed, task:failed, task:retrying
 */

import { randomUUID } from "node:crypto";
import { db, equipmentTable, clientsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  setClientSpeedLimit,
  addToAddressList,
  removeFromAddressList,
  createStaticDhcpLease,
  deleteDhcpLease,
  makeLeaseStatic,
} from "./mikrotik.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskType =
  | "speed_change"
  | "dhcp_lease_create"
  | "dhcp_lease_delete"
  | "dhcp_make_static"
  | "address_list_add"
  | "address_list_remove"
  | "billing_suspend"
  | "billing_reactivate";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  equipmentId: number | null;
  equipmentLabel: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  retries: number;
  maxRetries: number;
  error: string | null;
  result: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

// ─── State ───────────────────────────────────────────────────────────────────

const MAX_HISTORY = 500;
const RETRY_BASE_DELAY_MS = 5_000;
const TICK_INTERVAL_MS = 500;

const tasks = new Map<string, Task>();
const pendingQueue: string[] = [];
const busyEquipments = new Set<number | null>();

let io: SocketServer | null = null;
let workerInterval: ReturnType<typeof setInterval> | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export function setTaskQueueSocket(socketServer: SocketServer): void {
  io = socketServer;
}

export function startTaskQueue(): void {
  if (workerInterval) return;
  logger.info("Task queue worker started");
  workerInterval = setInterval(() => { void processTick(); }, TICK_INTERVAL_MS);
}

export function stopTaskQueue(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function enqueueTask(
  type: TaskType,
  description: string,
  payload: Record<string, unknown>,
  equipmentId: number | null = null,
  equipmentLabel = "",
  maxRetries = 3
): Task {
  const task: Task = {
    id: randomUUID(),
    type,
    description,
    equipmentId,
    equipmentLabel,
    payload,
    status: "pending",
    retries: 0,
    maxRetries,
    error: null,
    result: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };

  tasks.set(task.id, task);
  pendingQueue.push(task.id);
  evictOldTasks();

  emit("task:queued", serializeTask(task));
  logger.info({ taskId: task.id, type, equipmentId, description }, "Task enqueued");
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(opts?: { status?: TaskStatus; limit?: number }): Task[] {
  const all = Array.from(tasks.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const filtered = opts?.status ? all.filter(t => t.status === opts.status) : all;
  return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
}

export function cancelTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== "pending") return false;

  const idx = pendingQueue.indexOf(id);
  if (idx !== -1) pendingQueue.splice(idx, 1);

  task.status = "failed";
  task.error = "Cancelada por el usuario";
  task.completedAt = new Date();
  tasks.set(id, task);
  emit("task:failed", serializeTask(task));
  return true;
}

export function getQueueStats() {
  const all = Array.from(tasks.values());
  return {
    pending: all.filter(t => t.status === "pending").length,
    running: all.filter(t => t.status === "running").length,
    completed: all.filter(t => t.status === "completed").length,
    failed: all.filter(t => t.status === "failed").length,
    total: all.length,
  };
}

// ─── Worker ──────────────────────────────────────────────────────────────────

async function processTick(): Promise<void> {
  // Find next pending task whose equipment slot is free
  for (let i = 0; i < pendingQueue.length; i++) {
    const taskId = pendingQueue[i];
    const task = tasks.get(taskId);
    if (!task || task.status !== "pending") {
      pendingQueue.splice(i, 1);
      i--;
      continue;
    }

    const slotKey = task.equipmentId;
    if (busyEquipments.has(slotKey)) continue;

    // Take this task
    pendingQueue.splice(i, 1);
    busyEquipments.add(slotKey);
    void runTask(task).finally(() => busyEquipments.delete(slotKey));
    break; // process one task per tick
  }
}

async function runTask(task: Task): Promise<void> {
  task.status = "running";
  task.startedAt = new Date();
  tasks.set(task.id, task);
  emit("task:started", serializeTask(task));
  logger.info({ taskId: task.id, type: task.type, attempt: task.retries + 1 }, "Task started");

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= task.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn({ taskId: task.id, attempt, delay }, "Retrying task");
      emit("task:retrying", { ...serializeTask(task), attempt, delay });
      await sleep(delay);
    }

    try {
      const result = await executeTask(task);
      task.status = "completed";
      task.result = result;
      task.error = null;
      task.completedAt = new Date();
      tasks.set(task.id, task);

      await logAudit(task, "Success", result);
      emit("task:completed", serializeTask(task));
      logger.info({ taskId: task.id, result }, "Task completed");
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      task.retries = attempt + 1;
      logger.warn({ taskId: task.id, attempt, err: lastError }, "Task attempt failed");
    }
  }

  // All retries exhausted
  task.status = "failed";
  task.error = lastError;
  task.completedAt = new Date();
  tasks.set(task.id, task);

  await logAudit(task, "Fail", lastError ?? "Unknown error");
  emit("task:failed", serializeTask(task));
  logger.error({ taskId: task.id, error: lastError }, "Task failed after all retries");
}

// ─── Task Executors ───────────────────────────────────────────────────────────

async function executeTask(task: Task): Promise<string> {
  const p = task.payload as Record<string, string>;

  switch (task.type) {
    case "speed_change": {
      const res = await setClientSpeedLimit(p.ip, p.username, p.password, p.mac, p.newLimit);
      if (!res.success) throw new Error(res.message);
      // Update the client's planLimit in the DB
      if (p.clientId) {
        await db.update(clientsTable).set({ planLimit: p.newLimit }).where(eq(clientsTable.id, Number(p.clientId)));
      }
      return res.message;
    }

    case "address_list_add": {
      const ok = await addToAddressList(p.ip, p.username, p.password, p.address, p.listName, p.comment);
      if (!ok) throw new Error(`No se pudo agregar ${p.address} a la lista ${p.listName}`);
      return `${p.address} agregado a ${p.listName}`;
    }

    case "address_list_remove": {
      const ok = await removeFromAddressList(p.ip, p.username, p.password, p.address, p.listName);
      if (!ok) throw new Error(`No se pudo remover ${p.address} de la lista ${p.listName}`);
      return `${p.address} removido de ${p.listName}`;
    }

    case "dhcp_lease_create": {
      const res = await createStaticDhcpLease(p.ip, p.username, p.password, p.mac, p.fixedIp, p.comment, p.dhcpServer);
      if (!res.success) throw new Error(res.message);
      return res.message;
    }

    case "dhcp_lease_delete": {
      const ok = await deleteDhcpLease(p.ip, p.username, p.password, p.leaseId);
      if (!ok) throw new Error(`No se pudo eliminar lease ${p.leaseId}`);
      return `Lease ${p.leaseId} eliminado`;
    }

    case "dhcp_make_static": {
      const ok = await makeLeaseStatic(p.ip, p.username, p.password, p.leaseId);
      if (!ok) throw new Error(`No se pudo convertir lease ${p.leaseId} a estático`);
      return `Lease ${p.leaseId} convertido a estático`;
    }

    case "billing_suspend": {
      const auth = Buffer.from(`${p.username}:${p.password}`).toString("base64");
      const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
      const baseUrl = `http://${p.ip}/rest`;

      const queuesResp = await fetch(`${baseUrl}/queue/simple`, { headers });
      if (!queuesResp.ok) throw new Error("No se pudo consultar las colas de MikroTik");
      const queues = await queuesResp.json() as Array<{ ".id": string; target: string }>;
      const queue = queues.find(q => q.target?.includes(p.mac));
      if (queue) {
        const r = await fetch(`${baseUrl}/queue/simple/${queue[".id"]}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ "max-limit": "64k/64k", comment: `SUSPENDIDO-${p.clientName}` }),
        });
        if (!r.ok) throw new Error("No se pudo actualizar la cola de velocidad");
      }
      if (p.clientIp) {
        await addToAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Cortados", `SUSPENDIDO: ${p.clientName}`);
      }
      return `Cliente ${p.clientName} suspendido`;
    }

    case "billing_reactivate": {
      const auth = Buffer.from(`${p.username}:${p.password}`).toString("base64");
      const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
      const baseUrl = `http://${p.ip}/rest`;

      const queuesResp = await fetch(`${baseUrl}/queue/simple`, { headers });
      if (!queuesResp.ok) throw new Error("No se pudo consultar las colas de MikroTik");
      const queues = await queuesResp.json() as Array<{ ".id": string; target: string }>;
      const queue = queues.find(q => q.target?.includes(p.mac));
      if (queue) {
        const r = await fetch(`${baseUrl}/queue/simple/${queue[".id"]}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ "max-limit": p.planLimit, comment: p.clientName }),
        });
        if (!r.ok) throw new Error("No se pudo actualizar la cola de velocidad");
      }
      if (p.clientIp) {
        await removeFromAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Cortados");
      }
      return `Cliente ${p.clientName} reactivado`;
    }

    default:
      throw new Error(`Tipo de tarea no soportado: ${task.type}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(task: Task, result: "Success" | "Fail", details: string): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      entity: "TaskQueue",
      action: task.type.toUpperCase(),
      commandSent: `task:${task.type} payload=${JSON.stringify(task.payload).slice(0, 200)}`,
      result,
      details: `[Intento ${task.retries}/${task.maxRetries}] ${task.description}: ${details}`,
      equipmentId: task.equipmentId,
    });
  } catch (err) {
    logger.warn({ err, taskId: task.id }, "Failed to write task result to audit log");
  }
}

function emit(event: string, data: unknown): void {
  if (io) io.emit(event, data);
}

function serializeTask(task: Task): object {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function evictOldTasks(): void {
  if (tasks.size <= MAX_HISTORY) return;
  const sorted = Array.from(tasks.values())
    .filter(t => t.status === "completed" || t.status === "failed")
    .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));
  for (const t of sorted.slice(0, tasks.size - MAX_HISTORY)) {
    tasks.delete(t.id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Helpers for route handlers ───────────────────────────────────────────────

export async function enqueueSpeedChange(
  clientId: number,
  newLimit: string
): Promise<Task> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) throw new Error("Cliente no encontrado");

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, client.equipmentId));
  if (!equip) throw new Error("Equipo no encontrado");

  return enqueueTask(
    "speed_change",
    `Cambiar velocidad de ${client.name} a ${newLimit}`,
    {
      ip: equip.ip,
      username: equip.username,
      password: equip.password,
      mac: client.mac,
      newLimit,
      clientId: String(clientId),
      clientName: client.name,
    },
    equip.id,
    `${equip.model} (${equip.ip})`
  );
}

export async function enqueueDhcpLease(
  clientId: number,
  fixedIp: string,
  dhcpServer?: string
): Promise<Task> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) throw new Error("Cliente no encontrado");

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, client.equipmentId));
  if (!equip) throw new Error("Equipo no encontrado");

  return enqueueTask(
    "dhcp_lease_create",
    `Lease DHCP estático para ${client.name}: ${client.mac} → ${fixedIp}`,
    {
      ip: equip.ip,
      username: equip.username,
      password: equip.password,
      mac: client.mac,
      fixedIp,
      comment: `Cliente: ${client.name}`,
      dhcpServer: dhcpServer ?? "",
    },
    equip.id,
    `${equip.model} (${equip.ip})`
  );
}
