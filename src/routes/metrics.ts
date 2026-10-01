import { Router, type IRouter } from "express";
import { MetricHistory } from "../db";
import { Op } from "sequelize";
const router: IRouter = Router();
async function metrics(req: any, res: any, field: "equipmentId" | "clientId"): Promise<void> {
  const id = Number(req.params.id), hours = Number(req.query.hours ?? 24);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const rows = await MetricHistory.findAll({ where: { [field]: id, recordedAt: { [Op.gte]: new Date(Date.now() - hours * 3600000) } },
    attributes: ["recordedAt", "txMbps", "rxMbps", "signalDbm", "ccq"], order: [["recordedAt", "ASC"]], raw: true }) as any[];
  res.json(rows.map(r => ({ recordedAt: new Date(r.recordedAt).toISOString(), txMbps: r.txMbps ? parseFloat(r.txMbps) : null, rxMbps: r.rxMbps ? parseFloat(r.rxMbps) : null, signalDbm: r.signalDbm ? parseFloat(r.signalDbm) : null, ccq: r.ccq ? parseFloat(r.ccq) : null })));
}
router.get("/equipment/:id/metrics", (req, res) => void metrics(req, res, "equipmentId"));
router.get("/clients/:id/metrics", (req, res) => void metrics(req, res, "clientId"));
export default router;