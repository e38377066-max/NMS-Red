import { Router, type IRouter } from "express";
import {
  listTasks,
  getTask,
  cancelTask,
  getQueueStats,
  enqueueTask,
  enqueueSpeedChange,
  enqueueDhcpLease,
  type TaskStatus,
} from "../services/task-queue.service";

const router: IRouter = Router();

// GET /api/tasks — list tasks (with optional filters)
router.get("/tasks", (req, res): void => {
  const status = req.query.status as TaskStatus | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  void listTasks({ status, limit }).then((all) => res.json({
    stats: getQueueStats(),
    tasks: all.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  })).catch(() => res.status(500).json({ error: "No se pudo leer la cola de tareas" }));
});

// GET /api/tasks/stats — queue stats only
router.get("/tasks/stats", (_req, res): void => {
  res.json(getQueueStats());
});

// GET /api/tasks/:id — single task
router.get("/tasks/:id", async (req, res): Promise<void> => {
  const task = await getTask(req.params.id);
  if (!task) { res.status(404).json({ error: "Tarea no encontrada" }); return; }
  res.json({
    ...task,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  });
});

// DELETE /api/tasks/:id — cancel a pending task
router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const ok = await cancelTask(req.params.id);
  if (!ok) { res.status(400).json({ error: "La tarea no está en cola o ya fue procesada" }); return; }
  res.json({ success: true, message: "Tarea cancelada" });
});

// POST /api/tasks/speed-change — enqueue a speed change via task queue
router.post("/tasks/speed-change", async (req, res): Promise<void> => {
  const { clientId, newLimit } = req.body as { clientId?: number; newLimit?: string };
  if (!clientId || !newLimit) { res.status(400).json({ error: "clientId y newLimit son requeridos" }); return; }

  try {
    const task = await enqueueSpeedChange(clientId, newLimit, res.locals.user?.id ?? null);
    res.status(202).json({
      taskId: task.id,
      message: `Cambio de velocidad encolado: ${newLimit}. Se procesará en breve.`,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/tasks/dhcp-lease — enqueue a DHCP static lease via task queue
router.post("/tasks/dhcp-lease", async (req, res): Promise<void> => {
  const { clientId, fixedIp, dhcpServer } = req.body as { clientId?: number; fixedIp?: string; dhcpServer?: string };
  if (!clientId || !fixedIp) { res.status(400).json({ error: "clientId y fixedIp son requeridos" }); return; }

  try {
    const task = await enqueueDhcpLease(clientId, fixedIp, dhcpServer, res.locals.user?.id ?? null);
    res.status(202).json({
      taskId: task.id,
      message: `Lease DHCP encolado para IP ${fixedIp}. Se procesará en breve.`,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/tasks — generic enqueue (for AI or advanced use)
router.post("/tasks", async (req, res): Promise<void> => {
  const { type, description, payload, equipmentId, equipmentLabel, maxRetries } = req.body as {
    type?: string;
    description?: string;
    payload?: Record<string, unknown>;
    equipmentId?: number;
    equipmentLabel?: string;
    maxRetries?: number;
  };

  if (!type || !description || !payload) {
    res.status(400).json({ error: "type, description y payload son requeridos" });
    return;
  }

  const validTypes = ["speed_change","dhcp_lease_create","dhcp_lease_delete","dhcp_make_static","address_list_add","address_list_remove","billing_suspend","billing_reactivate"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `Tipo inválido. Tipos válidos: ${validTypes.join(", ")}` });
    return;
  }

  const task = await enqueueTask(
    type as Parameters<typeof enqueueTask>[0],
    description,
    payload,
    equipmentId ?? null,
    equipmentLabel ?? "",
    maxRetries ?? 3,
    res.locals.user?.id ?? null,
  );

  res.status(202).json({
    taskId: task.id,
    message: `Tarea encolada: ${description}`,
  });
});

export default router;
