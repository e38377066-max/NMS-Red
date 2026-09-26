import { Router, type IRouter, type Request } from "express";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, clientsTable, portalAccessTable, ticketsTable, paymentsTable, maintenanceNoticesTable } from "@workspace/db";

const router: IRouter = Router();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function id(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getPortalClient(req: Request): Promise<number | null> {
  const token = req.header("x-portal-token");
  if (!token || token.length < 32) return null;
  const [access] = await db.select({ clientId: portalAccessTable.clientId })
    .from(portalAccessTable)
    .where(and(
      eq(portalAccessTable.tokenHash, hash(token)),
      or(isNull(portalAccessTable.expiresAt), gt(portalAccessTable.expiresAt, new Date())),
    ));
  if (!access) {
    return null;
  }
  await db.update(portalAccessTable).set({ lastUsedAt: new Date() })
    .where(eq(portalAccessTable.clientId, access.clientId));
  return access.clientId;
}

router.get("/session", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const [client] = await db.select({
    id: clientsTable.id, name: clientsTable.name, planLimit: clientsTable.planLimit,
    status: clientsTable.status, paymentStatus: clientsTable.paymentStatus,
    monthlyFee: clientsTable.monthlyFee, dueDate: clientsTable.dueDate,
  }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const payments = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.clientId, clientId)).orderBy(paymentsTable.paidAt);
  const tickets = await db.select().from(ticketsTable)
    .where(eq(ticketsTable.clientId, clientId)).orderBy(ticketsTable.updatedAt);
  res.json({
    client: { ...client, dueDate: client.dueDate?.toISOString() ?? null },
    payments: payments.map(payment => ({ ...payment, paidAt: payment.paidAt.toISOString(), createdAt: payment.createdAt.toISOString() })),
    tickets: tickets.map(ticket => ({
      ...ticket,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    })),
  });
});

router.post("/tickets", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!subject || !description || subject.length > 200 || description.length > 4000) {
    res.status(400).json({ error: "Asunto y descripción son obligatorios" });
    return;
  }
  const [ticket] = await db.insert(ticketsTable).values({
    clientId, subject, description, category: "client_report",
    priority: "normal", status: "open",
  }).returning();
  res.status(201).json({ id: ticket.id, status: ticket.status, createdAt: ticket.createdAt.toISOString() });
});

router.post("/plan-change", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const requestedPlan = typeof req.body?.requestedPlan === "string" ? req.body.requestedPlan.trim() : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!requestedPlan || requestedPlan.length > 200) {
    res.status(400).json({ error: "Indica el plan solicitado" });
    return;
  }
  const [ticket] = await db.insert(ticketsTable).values({
    clientId,
    subject: `Solicitud de cambio de plan: ${requestedPlan}`,
    description: reason || "El cliente solicita revisar un cambio de plan.",
    category: "plan_change",
    priority: "normal",
    status: "open",
  }).returning({ id: ticketsTable.id, status: ticketsTable.status, createdAt: ticketsTable.createdAt });
  res.status(201).json({ ...ticket, createdAt: ticket.createdAt.toISOString() });
});

router.post("/payment-proof", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
  const amount = typeof req.body?.amount === "string" || typeof req.body?.amount === "number"
    ? String(req.body.amount).trim() : "";
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!reference || reference.length > 160 || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Referencia e importe positivo son obligatorios" });
    return;
  }
  const [ticket] = await db.insert(ticketsTable).values({
    clientId,
    subject: `Comprobante de pago: ${reference}`,
    description: `Importe declarado: ${amount}. Referencia: ${reference}.${notes ? ` ${notes}` : ""}`,
    category: "payment_proof",
    priority: "normal",
    status: "open",
  }).returning({ id: ticketsTable.id, status: ticketsTable.status, createdAt: ticketsTable.createdAt });
  res.status(201).json({ ...ticket, createdAt: ticket.createdAt.toISOString() });
});

router.get("/notices", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const now = new Date();
  const notices = await db.select({
    id: maintenanceNoticesTable.id,
    title: maintenanceNoticesTable.title,
    message: maintenanceNoticesTable.message,
    startsAt: maintenanceNoticesTable.startsAt,
    endsAt: maintenanceNoticesTable.endsAt,
  }).from(maintenanceNoticesTable).where(and(
    eq(maintenanceNoticesTable.active, true),
    lte(maintenanceNoticesTable.startsAt, now),
    or(isNull(maintenanceNoticesTable.endsAt), gt(maintenanceNoticesTable.endsAt, now)),
  ));
  res.json(notices.map(notice => ({
    ...notice,
    startsAt: notice.startsAt.toISOString(),
    endsAt: notice.endsAt?.toISOString() ?? null,
  })));
});

router.get("/payments/:id/receipt", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const paymentId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!paymentId) { res.status(400).json({ error: "Recibo inválido" }); return; }
  const [payment] = await db.select().from(paymentsTable).where(and(
    eq(paymentsTable.id, paymentId),
    eq(paymentsTable.clientId, clientId),
  ));
  if (!payment) { res.status(404).json({ error: "Recibo no encontrado" }); return; }
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId));
  const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${payment.receiptNumber}.html"`);
  res.send(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Recibo ${escapeHtml(payment.receiptNumber)}</title><style>body{font:16px system-ui;max-width:680px;margin:40px auto;padding:0 20px;color:#17202a}h1{font-size:24px}dl{display:grid;grid-template-columns:180px 1fr;gap:10px;border-top:1px solid #ddd;padding-top:20px}dt{font-weight:600}dd{margin:0}</style><h1>Recibo de pago</h1><dl><dt>Número</dt><dd>${escapeHtml(payment.receiptNumber)}</dd><dt>Cliente</dt><dd>${escapeHtml(client?.name ?? `Cliente ${clientId}`)}</dd><dt>Fecha</dt><dd>${payment.paidAt.toISOString()}</dd><dt>Importe</dt><dd>${escapeHtml(payment.currency)} ${escapeHtml(payment.amount)}</dd><dt>Método</dt><dd>${escapeHtml(payment.method)}</dd><dt>Referencia</dt><dd>${escapeHtml(payment.reference ?? "—")}</dd></dl></html>`);
});

export default router;