import { Router, type IRouter } from "express";
import { RegisterClientPaymentParams, RegisterClientPaymentBody } from "@workspace/api-zod";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  db,
  cashClosuresTable,
  clientsTable,
  invoicesTable,
  paymentsTable,
} from "@workspace/db";
import { registerPayment, getBillingSummary, queueClientReactivation, runBillingCheck } from "../services/billing.service";

const router: IRouter = Router();

const asMoney = (value: unknown): number | null => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
};

const asDate = (value: unknown, fallback?: Date): Date | null => {
  if (value === undefined || value === null || value === "") return fallback ?? null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const serialize = <T extends Record<string, unknown>>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : value,
  ])) as T;

const invoiceNumber = (clientId: number, date = new Date()) =>
  `FAC-${date.toISOString().slice(0, 7).replace("-", "")}-${clientId}-${randomBytes(3).toString("hex").toUpperCase()}`;

router.post("/clients/:id/payment", async (req, res): Promise<void> => {
  const params = RegisterClientPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RegisterClientPaymentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const daysUntilNextDue = body.data.daysUntilNextDue ?? 30;
  const ok = await registerPayment(params.data.id, body.data.monthlyFee, daysUntilNextDue);
  if (!ok) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json({ success: true, message: `Pago registrado. Próximo vencimiento en ${daysUntilNextDue} días.` });
});

router.get("/billing/summary", async (_req, res): Promise<void> => {
  const summary = await getBillingSummary();
  res.json(summary);
});

router.post("/billing/suspend-overdue", async (_req, res): Promise<void> => {
  const result = await runBillingCheck();
  res.json({
    success: true,
    message: `Corte ejecutado: ${result.suspended} suspendidos, ${result.markedPending} marcados como pendientes.`,
  });
});

router.get("/billing/invoices", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select({
      invoice: invoicesTable,
      clientName: clientsTable.name,
      clientMac: clientsTable.mac,
    })
    .from(invoicesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, invoicesTable.clientId))
    .where(status ? eq(invoicesTable.status, status) : undefined)
    .orderBy(desc(invoicesTable.createdAt));

  res.json(rows.map(row => ({
    ...serialize(row.invoice),
    clientName: row.clientName,
    clientMac: row.clientMac,
  })));
});

router.post("/billing/invoices", async (req, res): Promise<void> => {
  const clientId = Number(req.body?.clientId);
  const subtotal = asMoney(req.body?.subtotal);
  const discount = asMoney(req.body?.discount) ?? 0;
  const surcharge = asMoney(req.body?.surcharge) ?? 0;
  const periodStart = asDate(req.body?.periodStart);
  const periodEnd = asDate(req.body?.periodEnd);
  const dueDate = asDate(req.body?.dueDate, periodEnd ?? undefined);

  if (!Number.isInteger(clientId) || clientId <= 0 || subtotal === null || subtotal <= 0 ||
      !periodStart || !periodEnd || !dueDate || periodEnd < periodStart || discount > subtotal) {
    res.status(400).json({ error: "Cliente, importe, período y vencimiento son obligatorios y válidos" });
    return;
  }

  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Cliente no encontrado" });
    return;
  }

  const total = Math.round((subtotal - discount + surcharge) * 100) / 100;
  const [invoice] = await db.insert(invoicesTable).values({
    clientId,
    number: typeof req.body?.number === "string" && req.body.number.trim()
      ? req.body.number.trim()
      : invoiceNumber(clientId),
    periodStart,
    periodEnd,
    dueDate,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    surcharge: surcharge.toFixed(2),
    total: total.toFixed(2),
    balanceDue: total.toFixed(2),
  }).returning();

  res.status(201).json(serialize(invoice));
});

router.post("/billing/invoices/:id/payments", async (req, res): Promise<void> => {
  const invoiceId = Number(req.params.id);
  const amount = asMoney(req.body?.amount);
  const method = typeof req.body?.method === "string" ? req.body.method.trim().toLowerCase() : "";
  const allowedMethods = new Set(["cash", "transfer", "mobile", "other"]);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0 || amount === null || amount <= 0 || !allowedMethods.has(method)) {
    res.status(400).json({ error: "Factura, importe y método de pago válido son obligatorios" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) return { kind: "not_found" as const };
    const balance = Number(invoice.balanceDue);
    if (amount > balance + 0.001) return { kind: "overpayment" as const, balance };

    const paidAt = asDate(req.body?.paidAt, new Date()) ?? new Date();
    const receiptNumber = typeof req.body?.receiptNumber === "string" && req.body.receiptNumber.trim()
      ? req.body.receiptNumber.trim()
      : `REC-${paidAt.toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const [payment] = await tx.insert(paymentsTable).values({
      clientId: invoice.clientId,
      invoiceId,
      amount: amount.toFixed(2),
      currency: typeof req.body?.currency === "string" ? req.body.currency.trim().slice(0, 8) || "USD" : "USD",
      method,
      reference: typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 120) || null : null,
      receiptNumber,
      notes: typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 4000) || null : null,
      paidAt,
      receivedByUserId: res.locals.user?.id ?? null,
    }).returning();

    const amountPaid = Math.round((Number(invoice.amountPaid) + amount) * 100) / 100;
    const balanceDue = Math.max(0, Math.round((Number(invoice.total) - amountPaid) * 100) / 100);
    const status = balanceDue === 0 ? "PAID" : "PARTIAL";
    const [updatedInvoice] = await tx.update(invoicesTable).set({
      amountPaid: amountPaid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      status,
    }).where(eq(invoicesTable.id, invoiceId)).returning();

    if (status === "PAID") {
      await tx.update(clientsTable).set({
        paymentStatus: "PAID",
        status: "ACTIVE",
        lastPaymentDate: paidAt,
        dueDate: invoice.dueDate,
      }).where(eq(clientsTable.id, invoice.clientId));
    }
    return { kind: "ok" as const, payment, invoice: updatedInvoice };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Factura no encontrada" });
    return;
  }
  if (result.kind === "overpayment") {
    res.status(400).json({ error: `El pago supera el saldo pendiente de ${result.balance.toFixed(2)}` });
    return;
  }
  if (result.invoice.status === "PAID") {
    await queueClientReactivation(result.invoice.clientId);
  }
  res.status(201).json({
    payment: serialize(result.payment),
    invoice: serialize(result.invoice),
  });
});

router.get("/billing/reports/daily", async (req, res): Promise<void> => {
  const requested = typeof req.query.date === "string" ? req.query.date : "";
  const start = asDate(requested ? `${requested}T00:00:00` : undefined, new Date());
  if (!start) {
    res.status(400).json({ error: "date debe tener un formato válido" });
    return;
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = await db.select().from(paymentsTable)
    .where(and(gte(paymentsTable.paidAt, start), lt(paymentsTable.paidAt, end)))
    .orderBy(desc(paymentsTable.paidAt));
  const byMethod = { cash: 0, transfer: 0, mobile: 0, other: 0 };
  for (const row of rows) {
    const key = row.method in byMethod ? row.method as keyof typeof byMethod : "other";
    byMethod[key] += Number(row.amount);
  }
  res.json({
    date: start.toISOString().slice(0, 10),
    count: rows.length,
    total: rows.reduce((sum, row) => sum + Number(row.amount), 0),
    byMethod,
    payments: rows.map(serialize),
  });
});

router.get("/billing/cash-closures", async (_req, res): Promise<void> => {
  const rows = await db.select().from(cashClosuresTable).orderBy(desc(cashClosuresTable.closureDate)).limit(30);
  res.json(rows.map(serialize));
});

router.post("/billing/cash-closures", async (req, res): Promise<void> => {
  const closureDate = asDate(req.body?.closureDate, new Date());
  const openingBalance = asMoney(req.body?.openingBalance) ?? 0;
  const countedTotal = asMoney(req.body?.countedTotal);
  if (!closureDate || countedTotal === null) {
    res.status(400).json({ error: "Fecha de cierre y total contado son obligatorios" });
    return;
  }
  closureDate.setHours(0, 0, 0, 0);
  const end = new Date(closureDate);
  end.setDate(end.getDate() + 1);
  const payments = await db.select().from(paymentsTable)
    .where(and(gte(paymentsTable.paidAt, closureDate), lt(paymentsTable.paidAt, end)));
  const totals = { cash: 0, transfer: 0, mobile: 0, other: 0 };
  for (const payment of payments) {
    const key = payment.method in totals ? payment.method as keyof typeof totals : "other";
    totals[key] += Number(payment.amount);
  }
  const expectedTotal = Math.round((openingBalance + Object.values(totals).reduce((sum, value) => sum + value, 0)) * 100) / 100;
  const difference = Math.round((countedTotal - expectedTotal) * 100) / 100;
  const [closure] = await db.insert(cashClosuresTable).values({
    closureDate,
    openingBalance: openingBalance.toFixed(2),
    cashTotal: totals.cash.toFixed(2),
    transferTotal: totals.transfer.toFixed(2),
    mobileTotal: totals.mobile.toFixed(2),
    otherTotal: totals.other.toFixed(2),
    expectedTotal: expectedTotal.toFixed(2),
    countedTotal: countedTotal.toFixed(2),
    difference: difference.toFixed(2),
    notes: typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 4000) || null : null,
    closedByUserId: res.locals.user?.id ?? null,
  }).returning();
  res.status(201).json(serialize(closure));
});

export default router;
