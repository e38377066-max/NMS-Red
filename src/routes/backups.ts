import { Router, type IRouter } from "express";
import { Backup } from "../db";
import { listBackups, runAllBackups } from "../services/backup.service";
import { decryptBuffer } from "../services/credentials.service";
import { downloadPrivateObject } from "../services/object-storage.service";
import { requireRole } from "../middlewares/auth";
const router: IRouter = Router(); router.use(requireRole("admin"));
router.get("/backups", async (req, res): Promise<void> => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const equipmentId = req.query.equipmentId ? Number(req.query.equipmentId) : undefined;
  res.json(await listBackups(type, equipmentId));
});
router.post("/backups/run", async (_req, res): Promise<void> => {
  const result = await runAllBackups(); res.json({ success: true, message: `Respaldo completado: ${result.success} exitosos, ${result.failed} fallidos.` });
});
router.get("/backups/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id); if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const backup = await Backup.findByPk(id, { raw: true }) as any;
  if (!backup) { res.status(404).json({ error: "Respaldo no encontrado" }); return; }
  try {
    const encrypted = Buffer.from(await (await downloadPrivateObject(backup.filePath)).arrayBuffer());
    const decrypted = decryptBuffer(encrypted);
    res.setHeader("Content-Disposition", `attachment; filename="${backup.name}"`); res.setHeader("Content-Length", decrypted.byteLength);
    res.setHeader("Content-Type", "application/octet-stream"); res.end(decrypted);
  } catch { res.status(404).json({ error: "Respaldo no encontrado en el almacenamiento configurado" }); }
});
export default router;