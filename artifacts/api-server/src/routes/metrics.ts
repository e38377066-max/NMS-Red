import { Router, type IRouter } from "express";
import { db, metricHistoryTable } from "@workspace/db";
import { eq, gte, and, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/equipment/:id/metrics", async (req, res): Promise<void> => {
  const equipmentId = Number(req.params.id);
  const hours = Number(req.query.hours ?? 24);
  if (isNaN(equipmentId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      recordedAt: metricHistoryTable.recordedAt,
      txMbps: metricHistoryTable.txMbps,
      rxMbps: metricHistoryTable.rxMbps,
      signalDbm: metricHistoryTable.signalDbm,
      ccq: metricHistoryTable.ccq,
    })
    .from(metricHistoryTable)
    .where(and(eq(metricHistoryTable.equipmentId, equipmentId), gte(metricHistoryTable.recordedAt, since)))
    .orderBy(metricHistoryTable.recordedAt);

  res.json(rows.map(r => ({
    recordedAt: r.recordedAt.toISOString(),
    txMbps: r.txMbps ? parseFloat(r.txMbps) : null,
    rxMbps: r.rxMbps ? parseFloat(r.rxMbps) : null,
    signalDbm: r.signalDbm ? parseFloat(r.signalDbm) : null,
    ccq: r.ccq ? parseFloat(r.ccq) : null,
  })));
});

router.get("/clients/:id/metrics", async (req, res): Promise<void> => {
  const clientId = Number(req.params.id);
  const hours = Number(req.query.hours ?? 24);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      recordedAt: metricHistoryTable.recordedAt,
      txMbps: metricHistoryTable.txMbps,
      rxMbps: metricHistoryTable.rxMbps,
      signalDbm: metricHistoryTable.signalDbm,
      ccq: metricHistoryTable.ccq,
    })
    .from(metricHistoryTable)
    .where(and(eq(metricHistoryTable.clientId, clientId), gte(metricHistoryTable.recordedAt, since)))
    .orderBy(metricHistoryTable.recordedAt);

  res.json(rows.map(r => ({
    recordedAt: r.recordedAt.toISOString(),
    txMbps: r.txMbps ? parseFloat(r.txMbps) : null,
    rxMbps: r.rxMbps ? parseFloat(r.rxMbps) : null,
    signalDbm: r.signalDbm ? parseFloat(r.signalDbm) : null,
    ccq: r.ccq ? parseFloat(r.ccq) : null,
  })));
});

export default router;
