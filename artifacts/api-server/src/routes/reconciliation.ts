import { Router, type IRouter } from "express";
import { db, clientsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { enqueueDhcpLease, enqueueSpeedChange } from "../services/task-queue.service";
import { reconcileEquipment } from "../services/reconciliation.service";

const router: IRouter = Router();

router.get("/reconciliation/equipment/:id", async (req, res): Promise<void> => {
  const equipmentId = Number(req.params.id);
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
    res.status(400).json({ error: "ID de equipo inválido" });
    return;
  }
  try {
    res.json(await reconcileEquipment(equipmentId));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo reconciliar el equipo" });
  }
});

router.post("/reconciliation/equipment/:id/apply", async (req, res): Promise<void> => {
  const equipmentId = Number(req.params.id);
  const body = req.body as { confirm?: boolean; differenceIds?: unknown };
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
    res.status(400).json({ error: "ID de equipo inválido" });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({ error: "La aplicación de diferencias requiere confirmación explícita" });
    return;
  }
  if (!Array.isArray(body.differenceIds) || body.differenceIds.length === 0 || body.differenceIds.some(id => typeof id !== "string")) {
    res.status(400).json({ error: "differenceIds debe ser una lista no vacía de diferencias aprobadas" });
    return;
  }
  const differenceIds = body.differenceIds as string[];

  try {
    const report = await reconcileEquipment(equipmentId);
    const selected = report.differences.filter(item => differenceIds.includes(item.id));
    if (selected.length !== differenceIds.length) {
      res.status(409).json({ error: "La lista de diferencias está desactualizada; vuelve a reconciliar antes de aplicar" });
      return;
    }

    const tasks: string[] = [];
    const applied: string[] = [];
    for (const difference of selected) {
      if (difference.kind === "rate_mismatch" && difference.clientId && difference.routerRateLimit) {
        const task = await enqueueSpeedChange(difference.clientId, difference.routerRateLimit, res.locals.user?.id ?? null);
        tasks.push(task.id);
        applied.push(difference.id);
      } else if (difference.kind === "crm_only" && difference.clientId && difference.ip) {
        const task = await enqueueDhcpLease(difference.clientId, difference.ip, undefined, res.locals.user?.id ?? null);
        tasks.push(task.id);
        applied.push(difference.id);
      } else if (difference.kind === "ip_mismatch" && difference.clientId && difference.routerIp) {
        await db.update(clientsTable).set({ ip: difference.routerIp }).where(eq(clientsTable.id, difference.clientId));
        applied.push(difference.id);
      }
    }

    await db.insert(auditLogsTable).values({
      userId: res.locals.user?.id ?? null,
      username: res.locals.user?.username ?? "operador",
      entity: "Reconciliation",
      action: "APPLY_APPROVED",
      result: "Success",
      details: `Equipo ${equipmentId}; diferencias aprobadas: ${applied.join(",")}; tareas: ${tasks.join(",")}`,
      equipmentId,
    });
    res.json({ success: true, applied, taskIds: tasks, skipped: selected.filter(item => !applied.includes(item.id)).map(item => item.id) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudieron aplicar las diferencias" });
  }
});

export default router;