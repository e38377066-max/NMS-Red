import { Router, type IRouter, type Response } from "express";
import { RegisterClientPaymentParams, RegisterClientPaymentBody } from "@workspace/api-zod";
import { and, desc, eq, gte, gt, lt, lte, or, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  db,
  cashClosuresTable,
  clientsTable,
  invoicesTable,
  paymentsTable,
  paymentProofsTable,
  billingSettingsTable,
  auditLogsTable,
} from "@workspace/db";
import { registerPayment, getBillingSummary, getBillingSettings, queueClientReactivation, runBillingCheck } from "../services/billing.service";
import { downloadPrivateObject, uploadPrivateObject } from "../services/object-storage.service";

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

const proofStatuses = new Set(["PENDING", "APPROVED", "REJECTED"]);
const paymentMethods = new Set(["cash", "transfer", "mobile", "other"]);
const audit = async (res: Response, action: string, details: string, clientId?: number) => {
  await db.insert(auditLogsTable).values({
    userId: res.locals.user?.id ?? null,
    username: res.locals.user?.username ?? "sistema",
    entity: "Billing",
    action,
    details,
    result: "Success",
    clientId,
    sourceIp: res.req.ip,
    device: res.req.get("user-agent")?.slice(0, 500) ?? null,
  });
};

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

router.get("/billing/settings", async (_req, res): Promise<void> => {
  res.json(serialize(await getBillingSettings()));
});

router.patch("/billing/settings", async (req, res): Promise<void> => {
  const reminderDaysBefore = Number(req.body?.reminderDaysBefore);
  const graceDays = Number(req.body?.graceDays);
  const autoSuspend = req.body?.autoSuspend;
  const reminderEnabled = req.body?.reminderEnabled;
  const currency = typeof req.body?.currency === "string" ? req.body.currency.trim().slice(0, 8).toUpperCase() : "USD";
  if (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 90 ||
      !Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90 ||
      typeof autoSuspend !== "boolean" || typeof reminderEnabled !== "boolean" || !currency) {
    res.status(400).json({ error: "La configuración de avisos y gracia no es válida" });
    return;
  }
  const [settings] = await db.insert(billingSettingsTable).values({
    id: 1,
    reminderDaysBefore,
    graceDays,
    autoSuspend,
    reminderEnabled,
    currency,
    updatedByUserId: res.locals.user?.id ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: billingSettingsTable.id,
    set: { reminderDaysBefore, graceDays, autoSuspend, reminderEnabled, currency, updatedByUserId: res.locals.user?.id ?? null, updatedAt: new Date() },
  }).returning();
  await audit(res, "SETTINGS_UPDATE", `Configuración actualizada: aviso ${reminderDaysBefore} días, gracia ${graceDays} días`, undefined);
  res.json(serialize(settings));
});

router.get("/billing/reports/arrears", async (req, res): Promise<void> => {
  const asOf = asDate(req.query.asOf, new Date());
  if (!asOf) {
    res.status(400).json({ error: "asOf debe tener una fecha válida" });
    return;
  }
  const rows = await db.select({
    invoice: invoicesTable,
    clientName: clientsTable.name,
  }).from(invoicesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, invoicesTable.clientId))
    .where(gt(invoicesTable.balanceDue, "0"))
    .orderBy(invoicesTable.dueDate);
  const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  const byClient = new Map<number, { clientId: number; clientName: string; balance: number; invoices: number; oldestDueDate: string | null }>();
  const details = rows.map(({ invoice, clientName }) => {
    const balance = Number(invoice.balanceDue);
    const ageDays = Math.max(0, Math.floor((asOf!.getTime() - invoice.dueDate.getTime()) / 86_400_000));
    const bucket = ageDays === 0 ? "current" : ageDays <= 30 ? "days1to30" : ageDays <= 60 ? "days31to60" : ageDays <= 90 ? "days61to90" : "over90";
    buckets[bucket] += balance;
    const previous = byClient.get(invoice.clientId);
    byClient.set(invoice.clientId, {
      clientId: invoice.clientId,
      clientName,
      balance: (previous?.balance ?? 0) + balance,
      invoices: (previous?.invoices ?? 0) + 1,
      oldestDueDate: previous?.oldestDueDate && previous.oldestDueDate < invoice.dueDate.toISOString()
        ? previous.oldestDueDate
        : invoice.dueDate.toISOString(),
    });
    return { ...serialize(invoice), clientName, ageDays, bucket };
  });
  res.json({
    asOf: asOf.toISOString(),
    total: Object.values(buckets).reduce((sum, value) => sum + value, 0),
    buckets,
    clients: [...byClient.values()].sort((a, b) => b.balance - a.balance),
    invoices: details,
  });
});

router.get("/billing/reports/accounting-export", async (req, res): Promise<void> => {
  const from = asDate(req.query.from);
  const to = asDate(req.query.to);
  if (!from || !to || to <= from) {
    res.status(400).json({ error: "from y to son obligatorios y deben formar un período válido" });
    return;
  }
  const rows = await db.select({
    invoiceNumber: invoicesTable.number,
    invoiceStatus: invoicesTable.status,
    clientName: clientsTable.name,
    payment: paymentsTable,
  }).from(paymentsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, paymentsTable.clientId))
    .leftJoin(invoicesTable, eq(invoicesTable.id, paymentsTable.invoiceId))
    .where(and(gte(paymentsTable.paidAt, from), lt(paymentsTable.paidAt, to)))
    .orderBy(paymentsTable.paidAt);
  const csvCell = (value: unknown) => {
    const text = value instanceof Date ? value.toISOString() : String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  };
  const header = ["fecha_pago", "cliente", "factura", "estado_factura", "importe", "moneda", "metodo", "referencia", "estado_pago"];
  const lines = rows.map(row => [
    row.payment.paidAt, row.clientName, row.invoiceNumber, row.invoiceStatus,
    row.payment.amount, row.payment.currency, row.payment.method, row.payment.reference, row.payment.status,
  ].map(csvCell).join(","));
  const csv = [header.join(","), ...lines].join("\n");
  await audit(res, "ACCOUNTING_EXPORT", `Exportación contable de ${from.toISOString()} a ${to.toISOString()}`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="facturacion-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}\n`);
});

router.get("/billing/payment-proofs", async (req, res): Promise<void> => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  if (requestedStatus && !proofStatuses.has(requestedStatus)) {
    res.status(400).json({ error: "Estado de comprobante inválido" });
    return;
  }
  const rows = await db.select({
    proof: paymentProofsTable,
    clientName: clientsTable.name,
    invoiceNumber: invoicesTable.number,
  }).from(paymentProofsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, paymentProofsTable.clientId))
    .leftJoin(invoicesTable, eq(invoicesTable.id, paymentProofsTable.invoiceId))
    .where(requestedStatus ? eq(paymentProofsTable.status, requestedStatus) : undefined)
    .orderBy(desc(paymentProofsTable.submittedAt));
  res.json(rows.map(row => ({
    ...serialize(row.proof),
    clientName: row.clientName,
    invoiceNumber: row.invoiceNumber,
  })));
});

router.post("/billing/payment-proofs/:id/review", async (req, res): Promise<void> => {
  const proofId = Number(req.params.id);
  const status = typeof req.body?.status === "string" ? req.body.status.toUpperCase() : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 4000) : "";
  if (!Number.isInteger(proofId) || proofId <= 0 || !proofStatuses.has(status) || status === "PENDING" ||
      (status === "REJECTED" && !reason)) {
    res.status(400).json({ error: "Estado y motivo de revisión son obligatorios y válidos" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [proof] = await tx.select().from(paymentProofsTable)
      .where(eq(paymentProofsTable.id, proofId))
      .for("update");
    if (!proof) return { kind: "not_found" as const };
    if (proof.status !== "PENDING") return { kind: "already_reviewed" as const, proof };
    if (status === "REJECTED") {
      const [updated] = await tx.update(paymentProofsTable).set({
        status,
        rejectionReason: reason,
        reviewedByUserId: res.locals.user?.id ?? null,
        reviewedAt: new Date(),
      }).where(eq(paymentProofsTable.id, proofId)).returning();
      return { kind: "rejected" as const, proof: updated };
    }
    const [invoice] = proof.invoiceId
      ? await tx.select().from(invoicesTable).where(and(
        eq(invoicesTable.id, proof.invoiceId),
        eq(invoicesTable.clientId, proof.clientId),
        gt(invoicesTable.balanceDue, "0"),
      )).for("update")
      : await tx.select().from(invoicesTable).where(and(
        eq(invoicesTable.clientId, proof.clientId),
        gt(invoicesTable.balanceDue, "0"),
      )).orderBy(invoicesTable.dueDate).limit(1).for("update");
    if (!invoice) return { kind: "invoice_missing" as const };
    const amount = Number(proof.amount);
    const balance = Number(invoice.balanceDue);
    if (amount > balance + 0.001) return { kind: "overpayment" as const, balance };
    const paymentIdempotencyKey = `proof:${proof.id}`;
    const [payment] = await tx.insert(paymentsTable).values({
      clientId: proof.clientId,
      invoiceId: invoice.id,
      amount: amount.toFixed(2),
      currency: proof.currency,
      method: proof.method,
      reference: proof.reference,
      notes: proof.notes,
      receiptNumber: `REC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`,
      paidAt: new Date(),
      receivedByUserId: res.locals.user?.id ?? null,
      idempotencyKey: paymentIdempotencyKey,
    }).onConflictDoNothing({ target: paymentsTable.idempotencyKey }).returning();
    if (!payment) return { kind: "already_approved" as const };
    const amountPaid = Math.round((Number(invoice.amountPaid) + amount) * 100) / 100;
    const balanceDue = Math.max(0, Math.round((Number(invoice.total) - amountPaid) * 100) / 100);
    const invoiceStatus = balanceDue === 0 ? "PAID" : "PARTIAL";
    const [updatedInvoice] = await tx.update(invoicesTable).set({
      amountPaid: amountPaid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      status: invoiceStatus,
    }).where(eq(invoicesTable.id, invoice.id)).returning();
    if (invoiceStatus === "PAID") {
      await tx.update(clientsTable).set({
        paymentStatus: "PAID",
        status: "ACTIVE",
        lastPaymentDate: payment.paidAt,
        dueDate: invoice.dueDate,
      }).where(eq(clientsTable.id, proof.clientId));
    }
    const [updatedProof] = await tx.update(paymentProofsTable).set({
      status,
      reviewedByUserId: res.locals.user?.id ?? null,
      reviewedAt: new Date(),
      approvedPaymentId: payment.id,
      rejectionReason: null,
    }).where(eq(paymentProofsTable.id, proofId)).returning();
    return { kind: "approved" as const, proof: updatedProof, payment, invoice: updatedInvoice };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Comprobante no encontrado" }); return; }
  if (result.kind === "already_reviewed" || result.kind === "already_approved") {
    res.status(409).json({ error: "El comprobante ya fue revisado" }); return;
  }
  if (result.kind === "invoice_missing") { res.status(400).json({ error: "No hay una factura abierta para aplicar el comprobante" }); return; }
  if (result.kind === "overpayment") { res.status(400).json({ error: `El comprobante supera el saldo pendiente de ${result.balance.toFixed(2)}` }); return; }
  await audit(res, `PAYMENT_PROOF_${status}`, `Comprobante #${proofId} ${status === "APPROVED" ? "aprobado y aplicado" : "rechazado"}${reason ? `: ${reason}` : ""}`, result.proof?.clientId ?? undefined);
  if (result.kind === "approved" && result.invoice?.status === "PAID") await queueClientReactivation(result.invoice.clientId);
  res.json({ proof: serialize(result.proof), ...(result.kind === "approved" ? { payment: serialize(result.payment), invoice: serialize(result.invoice) } : {}) });
});

router.get("/billing/payment-proofs/:id/download", async (req, res): Promise<void> => {
  const proofId = Number(req.params.id);
  if (!Number.isInteger(proofId) || proofId <= 0) {
    res.status(400).json({ error: "Comprobante inválido" });
    return;
  }
  const [proof] = await db.select().from(paymentProofsTable).where(eq(paymentProofsTable.id, proofId));
  if (!proof?.storagePath) {
    res.status(404).json({ error: "Archivo de comprobante no encontrado" });
    return;
  }
  try {
    const file = await downloadPrivateObject(proof.storagePath);
    res.setHeader("Content-Type", proof.mimeType ?? "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(proof.originalName ?? `comprobante-${proof.id}`)}`,
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Archivo de comprobante no disponible" });
  }
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
