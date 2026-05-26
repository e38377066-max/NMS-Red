import { Router, type IRouter } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { db, backupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listBackups, runAllBackups } from "../services/backup.service";

const router: IRouter = Router();

router.get("/backups", async (req, res): Promise<void> => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const equipmentId = req.query.equipmentId ? Number(req.query.equipmentId) : undefined;
  const backups = await listBackups(type, equipmentId);
  res.json(backups);
});

router.post("/backups/run", async (_req, res): Promise<void> => {
  const result = await runAllBackups();
  res.json({
    success: true,
    message: `Respaldo completado: ${result.success} exitosos, ${result.failed} fallidos.`,
  });
});

router.get("/backups/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [backup] = await db
    .select()
    .from(backupsTable)
    .where(eq(backupsTable.id, id));

  if (!backup) {
    res.status(404).json({ error: "Respaldo no encontrado" });
    return;
  }

  try {
    const stats = await stat(backup.filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${backup.name}"`);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Type", "application/octet-stream");
    const stream = createReadStream(backup.filePath);
    stream.pipe(res);
  } catch {
    res.status(404).json({ error: "Archivo no encontrado en el servidor" });
  }
});

export default router;
