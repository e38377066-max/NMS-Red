import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, equipmentTable, auditLogsTable, backupsTable } from "@workspace/db";
import {
  applyDeviceConfiguration,
  getDeviceConfiguration,
  previewDeviceConfiguration,
} from "../services/device-config.service";

const router: IRouter = Router();

async function findEquipment(id: number) {
  const [equipment] = await db
    .select({
      id: equipmentTable.id,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      password: equipmentTable.password,
      model: equipmentTable.model,
      connectionType: equipmentTable.connectionType,
    })
    .from(equipmentTable)
    .where(eq(equipmentTable.id, id));
  return equipment ?? null;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/equipment/:id/configuration", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  try {
    res.json(await getDeviceConfiguration(equipment));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "No se pudo leer la configuración" });
  }
});

router.post("/equipment/:id/configuration/preview", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  const { fileName, contentBase64 } = req.body as { fileName?: string; contentBase64?: string };
  if (!fileName || !contentBase64) {
    res.status(400).json({ error: "fileName y contentBase64 son requeridos" });
    return;
  }
  try {
    res.json(previewDeviceConfiguration(equipment, { fileName, contentBase64 }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo previsualizar el archivo" });
  }
});

router.post("/equipment/:id/configuration/apply", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  const { previewId } = req.body as { previewId?: string };
  if (!previewId) { res.status(400).json({ error: "previewId es requerido" }); return; }

  try {
    const result = await applyDeviceConfiguration(equipment, previewId);
    if (result.backupPath) {
      await db.insert(backupsTable).values({
        type: equipment.connectionType === "mikrotik_routeros" ? "mikrotik_script" : "airos_config",
        name: result.backupName ?? `prechange_${equipment.id}`,
        filePath: result.backupPath,
        sizeBytes: result.backupSizeBytes ?? 0,
        equipmentId: equipment.id,
      });
    }
    await db.insert(auditLogsTable).values({
      equipmentId: equipment.id,
      entity: "EquipmentConfiguration",
      action: "CONFIG_APPLY",
      commandSent: `configuration:${previewId}`,
      result: "Success",
      details: `${equipment.model}: ${result.message}`,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo aplicar la configuración";
    await db.insert(auditLogsTable).values({
      equipmentId: equipment.id,
      entity: "EquipmentConfiguration",
      action: "CONFIG_APPLY",
      commandSent: `configuration:${previewId}`,
      result: "Fail",
      details: `${equipment.model}: ${message}`,
    }).catch(() => undefined);
    res.status(400).json({ success: false, error: message });
  }
});

export default router;