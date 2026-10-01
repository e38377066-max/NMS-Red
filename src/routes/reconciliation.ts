import { Router, type IRouter } from "express";
import { AuditLog } from "../db";
import { applyReconciliationDifference, reconcileEquipment } from "../services/reconciliation.service";

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

    const applied: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const difference of selected) {
      const result = await applyReconciliationDifference(equipmentId, difference);
      if (result.applied) {
        applied.push(difference.id);
      } else {
        skipped.push({ id: difference.id, reason: result.message });
      }
    }

   await AuditLog.create({
      userId: res.locals.user?.id ?? null,
      username: res.locals.user?.username ?? "operador",
      entity: "Reconciliation",
      action: "APPLY_APPROVED",
      result: "Success",
      details: `Equipo ${equipmentId}; aplicadas: ${applied.join(",")}; omitidas: ${skipped.map(item => `${item.id} (${item.reason})`).join(", ")}`,
      equipmentId,
    });
    const verification = await reconcileEquipment(equipmentId);
    res.json({
      success: skipped.length === 0,
      applied,
      skipped,
      verification,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudieron aplicar las diferencias" });
  }
});

export default router;