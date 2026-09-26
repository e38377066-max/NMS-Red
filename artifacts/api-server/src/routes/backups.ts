import { Router, type IRouter } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { db, backupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listBackups, runAllBackups } from "../services/backup.service";
import { decryptBuffer } from "../services/credentials.service";
import { downloadPrivateObject } from "../services/object-storage.service";

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
    if (backup.filePath.startsWith("/objects/")) {
      const objectResponse = await downloadPrivateObject(backup.filePath);
      const encrypted = Buffer.from(await objectResponse.arrayBuffer());
      const decrypted = decryptBuffer(encrypted);
      res.setHeader("Content-Disposition", `attachment; filename="${backup.name}"`);
      res.setHeader("Content-Length", decrypted.byteLength);
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(decrypted);
      return;
    }
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
