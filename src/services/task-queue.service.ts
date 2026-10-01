/**
 * Persistent Task Queue
 *
 * - Tasks for different equipments run in parallel.
 * - Tasks for the same equipment run serially (one at a time).
 * - Each task retries up to maxRetries times (default 3) with exponential backoff.
 * - Results are written to the Audit Log.
 * - WebSocket events: task:queued, task:started, task:completed, task:failed, task:retrying
 */

import { randomUUID } from "node:crypto";
import { Equipment, Client, AuditLog, TaskQueue } from "../db";
import { Op } from "sequelize";
type TaskQueueRow = any;
import {
  setClientSpeedLimit,
  addToAddressList,
  removeFromAddressList,
  createStaticDhcpLease,
  deleteDhcpLease,
  getMikroTikAddressList,
  getMikroTikDhcpLeases,
  makeLeaseStatic,
} from "./mikrotik.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";
import { redactSecrets } from "./credentials.service";

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
  nextAttemptAt: Date | null;
  requestedByUserId: number | null;
}

// ─── State ───────────────────────────────────────────────────────────────────

const MAX_HISTORY = 500;
const RETRY_BASE_DELAY_MS = 5_000;
const TICK_INTERVAL_MS = 500;
const OPERATION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.NETWORK_OPERATION_TIMEOUT_MS ?? 30_000),
);

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
  void hydrateQueue();
  workerInterval = setInterval(() => { void processTick(); }, TICK_INTERVAL_MS);
}

export function stopTaskQueue(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export async function enqueueTask(
  type: TaskType,
  description: string,
  payload: Record<string, unknown>,
  equipmentId: number | null = null,
  equipmentLabel = "",
  maxRetries = 3,
  requestedByUserId: number | null = null,
): Promise<Task> {
  const activeTasks = await TaskQueue.findAll({ where: {
    equipmentId: equipmentId === null ? { [Op.is]: null } : equipmentId,
    status: { [Op.in]: ["pending", "running"] },
  }, raw: true }) as any[];
  const payloadFingerprint = stableJson(payload);
  const duplicate = activeTasks.find(row => row.type === type && stableJson(row.payload) === payloadFingerprint);
  if (duplicate) {
    const existing = fromDbTask(duplicate);
    tasks.set(existing.id, existing);
    if (existing.status === "pending" && !pendingQueue.includes(existing.id)) pendingQueue.push(existing.id);
    logger.info({ taskId: existing.id, type, equipmentId }, "Duplicate active task reused");
    return existing;
  }

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
    nextAttemptAt: null,
    requestedByUserId,
  };

  tasks.set(task.id, task);
  pendingQueue.push(task.id);
  await TaskQueue.create(toDbTask(task) as any);
  evictOldTasks();

  emit("task:queued", serializeTask(task));
  logger.info({ taskId: task.id, type, equipmentId, description }, "Task enqueued");
  return task;
}

export async function getTask(id: string): Promise<Task | undefined> {
  const memoryTask = tasks.get(id);
  if (memoryTask) return memoryTask;
  const row = await TaskQueue.findByPk(id, { raw: true }) as any;
  if (!row) return undefined;
  const task = fromDbTask(row);
  tasks.set(task.id, task);
  return task;
}

export async function listTasks(opts?: { status?: TaskStatus; limit?: number }): Promise<Task[]> {
  const rows = await TaskQueue.findAll({ order: [["createdAt", "ASC"]], raw: true }) as any[];
  const all = rows.map(fromDbTask).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const task of all) tasks.set(task.id, task);

  const filtered = opts?.status ? all.filter(t => t.status === opts.status) : all;
  return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
}

export async function cancelTask(id: string): Promise<boolean> {
  const task = await getTask(id);
  if (!task || task.status !== "pending") return false;

  const idx = pendingQueue.indexOf(id);
  if (idx !== -1) pendingQueue.splice(idx, 1);

  task.status = "failed";
  task.error = "Cancelada por el usuario";
  task.completedAt = new Date();
  tasks.set(id, task);
  await TaskQueue.update(toDbTask(task) as any, { where: { id } });
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

async function hydrateQueue(): Promise<void> {
  try {
    const rows = await TaskQueue.findAll({ where: { [Op.or]: [
      { status: "pending" },
      { status: "running", startedAt: { [Op.lte]: new Date(Date.now() - 15 * 60_000) } },
    ] }, raw: true }) as any[];
    for (const row of rows) {
      const task = fromDbTask(row);
      if (task.status === "running") {
        task.status = "pending";
        task.startedAt = null;
        task.nextAttemptAt = null;
        await TaskQueue.update(toDbTask(task) as any, { where: { id: task.id } });
      }
      if (!tasks.has(task.id)) {
        tasks.set(task.id, task);
        if (!pendingQueue.includes(task.id)) pendingQueue.push(task.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Could not hydrate persistent task queue");
  }
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
    const claimed = await claimTask(task);
    if (!claimed) {
      busyEquipments.delete(slotKey);
      continue;
    }
    void runTask(task, true).finally(() => busyEquipments.delete(slotKey));
    break; // process one task per tick
  }
}

async function claimTask(task: Task): Promise<boolean> {
  const [count] = await TaskQueue.update({ status: "running", startedAt: new Date(), nextAttemptAt: null }, { where: { id: task.id, status: "pending" } });
  if (!count) return false;
  task.status = "running";
  task.startedAt = new Date();
  task.nextAttemptAt = null;
  return true;
}

async function runTask(task: Task, alreadyClaimed = false): Promise<void> {
  task.status = "running";
  task.startedAt = task.startedAt ?? new Date();
  task.nextAttemptAt = null;
  if (!alreadyClaimed) {
    const [count] = await TaskQueue.update(toDbTask(task) as any, { where: { id: task.id, status: "pending" } });
    if (!count) return;
  }
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
      const result = await withTimeout(executeTask(task), OPERATION_TIMEOUT_MS, `La operación superó el límite de ${OPERATION_TIMEOUT_MS} ms`);
      task.status = "completed";
      task.result = result;
      task.error = null;
      task.completedAt = new Date();
      task.nextAttemptAt = null;
      await TaskQueue.update(toDbTask(task) as any, { where: { id: task.id } });

      await logAudit(task, "Success", result);
      emit("task:completed", serializeTask(task));
      logger.info({ taskId: task.id, result }, "Task completed");
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      task.retries = attempt + 1;
      task.nextAttemptAt = attempt < task.maxRetries
        ? new Date(Date.now() + RETRY_BASE_DELAY_MS * Math.pow(2, attempt))
        : null;
      await TaskQueue.update(toDbTask(task) as any, { where: { id: task.id } });
      logger.warn({ taskId: task.id, attempt, err: lastError }, "Task attempt failed");
    }
  }

  // All retries exhausted
  task.status = "failed";
  task.error = lastError;
  task.completedAt = new Date();
  await TaskQueue.update(toDbTask(task) as any, { where: { id: task.id } });

  await logAudit(task, "Fail", lastError ?? "Unknown error");
  emit("task:failed", serializeTask(task));
  logger.error({ taskId: task.id, error: lastError }, "Task failed after all retries");
}

// ─── Task Executors ───────────────────────────────────────────────────────────

async function executeTask(task: Task): Promise<string> {
  const p = task.payload as Record<string, string>;

  switch (task.type) {
    case "speed_change": {
      const res = await setClientSpeedLimit(p.ip, p.username, p.password, p.mac, p.newLimit, p.clientIp, p.clientName);
      if (!res.success) throw new Error(res.message);
      // Update the client's planLimit in the DB
      if (p.clientId) {
        await Client.update({ planLimit: p.newLimit }, { where: { id: Number(p.clientId) } });
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
      const res = await createStaticDhcpLease(p.ip, p.username, p.password, p.mac, p.fixedIp, p.comment, p.dhcpServer, p.rateLimit);
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
      const limit = await setClientSpeedLimit(p.ip, p.username, p.password, p.mac, "64k/64k", p.clientIp, p.clientName);
      if (!limit.success) throw new Error(limit.message);
      if (p.clientIp) {
        const suspended = await addToAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Cortados", `SUSPENDIDO: ${p.clientName}`);
        if (!suspended) throw new Error(`No se pudo agregar ${p.clientIp} a Clientes_Cortados`);
        const active = await removeFromAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Activos");
        if (!active) throw new Error(`No se pudo retirar ${p.clientIp} de Clientes_Activos`);
      }
      await verifyBillingState(p.ip, p.username, p.password, p.mac, p.clientIp, "suspended");
      return `Cliente ${p.clientName} suspendido`;
    }

    case "billing_reactivate": {
      const limit = await setClientSpeedLimit(p.ip, p.username, p.password, p.mac, p.planLimit, p.clientIp, p.clientName);
      if (!limit.success) throw new Error(limit.message);
      if (p.clientIp) {
        const suspended = await removeFromAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Cortados");
        if (!suspended) throw new Error(`No se pudo retirar ${p.clientIp} de Clientes_Cortados`);
        const active = await addToAddressList(p.ip, p.username, p.password, p.clientIp, "Clientes_Activos", `ACTIVO: ${p.clientName}`);
        if (!active) throw new Error(`No se pudo agregar ${p.clientIp} a Clientes_Activos`);
      }
      await verifyBillingState(p.ip, p.username, p.password, p.mac, p.clientIp, "active");
      return `Cliente ${p.clientName} reactivado`;
    }

    default:
      throw new Error(`Tipo de tarea no soportado: ${task.type}`);
  }
}

async function verifyBillingState(
  ip: string,
  username: string,
  password: string,
  mac: string,
  clientIp: string,
  expected: "suspended" | "active",
): Promise<void> {
  const leases = await getMikroTikDhcpLeases(ip, username, password);
  const lease = leases.find(item =>
    (clientIp && item.address === clientIp) ||
    item.macAddress.replace(/[^0-9a-f]/gi, "").toLowerCase() === mac.replace(/[^0-9a-f]/gi, "").toLowerCase(),
  );
  if (!lease) throw new Error(`No se pudo verificar el lease DHCP de ${mac}`);
  const suspended = clientIp
    ? (await getMikroTikAddressList(ip, username, password, "Clientes_Cortados", clientIp)).length > 0
    : false;
  const active = clientIp
    ? (await getMikroTikAddressList(ip, username, password, "Clientes_Activos", clientIp)).length > 0
    : false;
  if (expected === "suspended" && (!suspended || active)) {
    throw new Error("El estado suspendido no coincide con las address-lists del MikroTik");
  }
  if (expected === "active" && (suspended || !active)) {
    throw new Error("El estado activo no coincide con las address-lists del MikroTik");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(task: Task, result: "Success" | "Fail", details: string): Promise<void> {
  try {
    await AuditLog.create({
      entity: "TaskQueue",
      action: task.type.toUpperCase(),
      commandSent: `task:${task.type} payload=${JSON.stringify(redactSecrets(task.payload)).slice(0, 200)}`,
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
    nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toDbTask(task: Task) {
  return {
    id: task.id,
    type: task.type,
    description: task.description,
    equipmentId: task.equipmentId,
    equipmentLabel: task.equipmentLabel,
    payload: task.payload,
    status: task.status,
    retries: task.retries,
    maxRetries: task.maxRetries,
    error: task.error,
    result: task.result,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    nextAttemptAt: task.nextAttemptAt,
    cancelledAt: task.status === "failed" && task.error === "Cancelada por el usuario" ? task.completedAt : null,
    requestedByUserId: task.requestedByUserId,
  };
}

function fromDbTask(row: TaskQueueRow): Task {
  return {
    id: row.id,
    type: row.type as TaskType,
    description: row.description,
    equipmentId: row.equipmentId,
    equipmentLabel: row.equipmentLabel,
    payload: row.payload,
    status: row.status as TaskStatus,
    retries: row.retries,
    maxRetries: row.maxRetries,
    error: row.error,
    result: row.result,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    nextAttemptAt: row.nextAttemptAt,
    requestedByUserId: row.requestedByUserId,
  };
}

// ─── Helpers for route handlers ───────────────────────────────────────────────

export async function enqueueSpeedChange(
  clientId: number,
  newLimit: string,
  requestedByUserId: number | null = null,
): Promise<Task> {
  const client = await Client.findByPk(clientId, { raw: true }) as any;
  if (!client) throw new Error("Cliente no encontrado");

  const equip = await Equipment.findByPk(client.equipmentId, { raw: true }) as any;
  if (!equip || equip.equipmentRole !== "core_router" || equip.connectionType !== "mikrotik_routeros") {
    throw new Error("El cliente debe estar asociado al Router central MikroTik");
  }

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
      clientIp: client.ip ?? "",
    },
    equip.id,
    `${equip.model} (${equip.ip})`,
    3,
    requestedByUserId,
  );
}

export async function enqueueDhcpLease(
  clientId: number,
  fixedIp: string,
  dhcpServer?: string,
  requestedByUserId: number | null = null,
): Promise<Task> {
  const client = await Client.findByPk(clientId, { raw: true }) as any;
  if (!client) throw new Error("Cliente no encontrado");

  const equip = await Equipment.findByPk(client.equipmentId, { raw: true }) as any;
  if (!equip || equip.equipmentRole !== "core_router" || equip.connectionType !== "mikrotik_routeros") {
    throw new Error("El cliente debe estar asociado al Router central MikroTik");
  }

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
      rateLimit: client.planLimit,
    },
    equip.id,
    `${equip.model} (${equip.ip})`,
    3,
    requestedByUserId,
  );
}
