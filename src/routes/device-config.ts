import { Router, type IRouter } from "express";
import { Equipment, AuditLog, Backup } from "../db";
import {
  ApplyEquipmentConfigurationBody,
  ApplyEquipmentConfigurationResponse,
  GetEquipmentConfigurationResponse,
  PreviewEquipmentConfigurationFileBody,
  PreviewEquipmentConfigurationFileResponse,
  PreviewEquipmentConfigurationSettingsBody,
  PreviewEquipmentConfigurationSettingsResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";
import {
  applyDeviceConfiguration,
  getDeviceConfiguration,
  previewAirosSettings,
  previewDeviceConfiguration,
} from "../services/device-config.service";

const router: IRouter = Router();

async function findEquipment(id: number) {
  return await Equipment.findByPk(id, { attributes: ["id", "ip", "username", "password", "model", "connectionType"] });
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/equipment/:id/configuration", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  try {
    res.json(GetEquipmentConfigurationResponse.parse(await getDeviceConfiguration(equipment)));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "No se pudo leer la configuración" });
  }
});

router.post("/equipment/:id/configuration/preview", requireRole("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  const parsedBody = PreviewEquipmentConfigurationFileBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const userId = Number(res.locals.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }
  try {
    const discovery = await getDeviceConfiguration(equipment);
    if (!discovery.controlPolicy.canApply) {
      res.status(409).json({ error: discovery.controlPolicy.reason, identity: discovery.identity });
      return;
    }
    res.json(PreviewEquipmentConfigurationFileResponse.parse(previewDeviceConfiguration(
      equipment,
      parsedBody.data,
      userId,
      discovery.identity,
    )));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo previsualizar el archivo" });
  }
});

router.post("/equipment/:id/configuration/settings/preview", requireRole("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  const parsedBody = PreviewEquipmentConfigurationSettingsBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const userId = Number(res.locals.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }
  try {
    const discovery = await getDeviceConfiguration(equipment);
    if (!discovery.controlPolicy.canApply) {
      res.status(409).json({ error: discovery.controlPolicy.reason, identity: discovery.identity });
      return;
    }
    res.json(PreviewEquipmentConfigurationSettingsResponse.parse(await previewAirosSettings(
      equipment,
      parsedBody.data.changes,
      userId,
    )));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "No se pudo revisar la configuración" });
  }
});

router.post("/equipment/:id/configuration/apply", requireRole("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID inválido" }); return; }
  const equipment = await findEquipment(id);
  if (!equipment) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  const parsedBody = ApplyEquipmentConfigurationBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const { previewId, confirmed } = parsedBody.data;
  const userId = Number(res.locals.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }

  try {
    const discovery = await getDeviceConfiguration(equipment);
    if (!discovery.controlPolicy.canApply) {
      res.status(409).json({ error: discovery.controlPolicy.reason, identity: discovery.identity });
      return;
    }
    const result = await applyDeviceConfiguration(
      equipment,
      previewId,
      userId,
      discovery.identity,
      async (backup) => {
        await Backup.create({
        type: equipment.connectionType === "mikrotik_routeros" ? "mikrotik_script" : "airos_config",
        name: backup.fileName,
        filePath: backup.filePath,
        sizeBytes: backup.sizeBytes,
        equipmentId: equipment.id,
      });
      },
    );
    await AuditLog.create({
      userId,
      username: res.locals.user?.username ?? "admin",
      equipmentId: equipment.id,
      entity: "EquipmentConfiguration",
      action: "CONFIG_APPLY",
      commandSent: `configuration:${previewId}`,
      result: "Success",
      details: `${equipment.model}: ${result.message}`,
    }).catch((err) => {
      req.log.error({ err, equipmentId: equipment.id }, "Configuration applied but audit event could not be recorded");
    });
    res.json(ApplyEquipmentConfigurationResponse.parse({ success: true, ...result }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo aplicar la configuración";
    await AuditLog.create({
      userId,
      username: res.locals.user?.username ?? "admin",
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