import { Router, type IRouter, type Request } from "express";
import path from "node:path";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  clientsTable,
  equipmentTable,
  invoicesTable,
  paymentProofsTable,
  portalAccessTable,
  ticketsTable,
  paymentsTable,
  maintenanceNoticesTable,
} from "@workspace/db";
import { downloadPrivateObject, uploadPrivateObject } from "../services/object-storage.service";

const router: IRouter = Router();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function id(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const proofMethods = new Set(["transfer", "mobile", "cash", "other"]);
const proofMimeTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const MAX_PROOF_BYTES = 2 * 1024 * 1024;

function decodeProofFile(value: unknown, mimeType: unknown): { data: Buffer; extension: string } | null {
  if (typeof value !== "string" || typeof mimeType !== "string") return null;
  const extension = proofMimeTypes.get(mimeType.trim().toLowerCase());
  if (!extension) return null;
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const data = Buffer.from(base64, "base64");
  if (data.length === 0 || data.length > MAX_PROOF_BYTES) return null;
  return { data, extension };
}

function safeOriginalName(value: unknown, extension: string): string {
  if (typeof value !== "string") return `comprobante${extension}`;
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name && name.length <= 255 ? name : `comprobante${extension}`;
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
    equipmentId: clientsTable.equipmentId, accessPointEquipmentId: clientsTable.accessPointEquipmentId,
  }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const [payments, tickets, invoices, paymentProofs, equipment] = await Promise.all([
    db.select().from(paymentsTable)
      .where(eq(paymentsTable.clientId, clientId)).orderBy(paymentsTable.paidAt),
    db.select().from(ticketsTable)
      .where(eq(ticketsTable.clientId, clientId)).orderBy(ticketsTable.updatedAt),
    db.select().from(invoicesTable)
      .where(eq(invoicesTable.clientId, clientId)).orderBy(invoicesTable.dueDate),
    db.select({
      id: paymentProofsTable.id,
      invoiceId: paymentProofsTable.invoiceId,
      amount: paymentProofsTable.amount,
      currency: paymentProofsTable.currency,
      method: paymentProofsTable.method,
      reference: paymentProofsTable.reference,
      originalName: paymentProofsTable.originalName,
      mimeType: paymentProofsTable.mimeType,
      status: paymentProofsTable.status,
      rejectionReason: paymentProofsTable.rejectionReason,
      submittedAt: paymentProofsTable.submittedAt,
      reviewedAt: paymentProofsTable.reviewedAt,
    }).from(paymentProofsTable)
      .where(eq(paymentProofsTable.clientId, clientId))
      .orderBy(paymentProofsTable.submittedAt),
    db.select({
      id: equipmentTable.id,
      model: equipmentTable.model,
      ip: equipmentTable.ip,
      equipmentRole: equipmentTable.equipmentRole,
      lastSeenStatus: equipmentTable.lastSeenStatus,
    }).from(equipmentTable),
  ]);
  const equipmentById = new Map(equipment.map(item => [item.id, item]));
  res.json({
    client: {
      ...client,
      dueDate: client.dueDate?.toISOString() ?? null,
      network: {
        coreRouter: equipmentById.get(client.equipmentId) ?? null,
        accessPoint: client.accessPointEquipmentId ? equipmentById.get(client.accessPointEquipmentId) ?? null : null,
      },
    },
    payments: payments.map(payment => ({ ...payment, paidAt: payment.paidAt.toISOString(), createdAt: payment.createdAt.toISOString() })),
    tickets: tickets.map(ticket => ({
      ...ticket,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    })),
    invoices: invoices.map(invoice => ({
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
    })),
    paymentProofs: paymentProofs.map(proof => ({
      ...proof,
      submittedAt: proof.submittedAt.toISOString(),
      reviewedAt: proof.reviewedAt?.toISOString() ?? null,
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

router.post("/service-request", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const requestedType = typeof req.body?.type === "string" ? req.body.type : "";
  const type = requestedType === "relocation" || requestedType === "reconnection"
    ? requestedType as "relocation" | "reconnection"
    : null;
  const details = typeof req.body?.details === "string" ? req.body.details.trim() : "";
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!type || !details || details.length > 4000) {
    res.status(400).json({ error: "Tipo y detalle de la solicitud son obligatorios" });
    return;
  }
  const labels: Record<"relocation" | "reconnection", string> = { relocation: "traslado", reconnection: "reconexión" };
  const [ticket] = await db.insert(ticketsTable).values({
    clientId,
    subject: `Solicitud de ${labels[type]}`,
    description: details,
    category: type,
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
  const method = typeof req.body?.method === "string" ? req.body.method.trim().toLowerCase() : "";
  const invoiceId = req.body?.invoiceId === undefined || req.body?.invoiceId === ""
    ? null
    : id(req.body?.invoiceId);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const file = decodeProofFile(req.body?.file, req.body?.mimeType);
  if (!reference || reference.length > 160 || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      !proofMethods.has(method) || !file || (req.body?.invoiceId !== undefined && !invoiceId)) {
    res.status(400).json({ error: "Referencia, importe, método y archivo válido son obligatorios" });
    return;
  }
  if (notes.length > 4000) {
    res.status(400).json({ error: "Las notas no pueden superar 4000 caracteres" });
    return;
  }
  if (invoiceId) {
    const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.clientId, clientId),
      gt(invoicesTable.balanceDue, "0"),
    ));
    if (!invoice) {
      res.status(400).json({ error: "La factura seleccionada no pertenece a tu cuenta o ya está pagada" });
      return;
    }
  }

  let storagePath: string;
  try {
    storagePath = await uploadPrivateObject(
      file.data,
      String(req.body.mimeType).trim().toLowerCase(),
      file.extension,
      `payment-proofs/${clientId}`,
    );
  } catch {
    res.status(503).json({ error: "El almacenamiento privado no está disponible" });
    return;
  }

  const originalName = safeOriginalName(req.body?.fileName, file.extension);
  const [proof] = await db.insert(paymentProofsTable).values({
    clientId,
    invoiceId,
    amount: Number(amount).toFixed(2),
    currency: typeof req.body?.currency === "string" ? req.body.currency.trim().slice(0, 8).toUpperCase() || "USD" : "USD",
    method,
    reference,
    notes: notes || null,
    originalName,
    mimeType: String(req.body.mimeType).trim().toLowerCase(),
    sizeBytes: file.data.length,
    sha256: createHash("sha256").update(file.data).digest("hex"),
    storagePath,
  }).returning();
  res.status(201).json({
    ...proof,
    submittedAt: proof.submittedAt.toISOString(),
    reviewedAt: null,
  });
});

router.post("/tickets/:id/close", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const [ticket] = await db.update(ticketsTable).set({
    status: "closed",
    closedByClient: true,
    closedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(ticketsTable.id, ticketId),
    eq(ticketsTable.clientId, clientId),
  )).returning({ id: ticketsTable.id, status: ticketsTable.status });
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  res.json(ticket);
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

router.get("/payment-proofs/:id/download", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const proofId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!proofId) { res.status(400).json({ error: "Comprobante inválido" }); return; }
  const [proof] = await db.select().from(paymentProofsTable).where(and(
    eq(paymentProofsTable.id, proofId),
    eq(paymentProofsTable.clientId, clientId),
  ));
  if (!proof?.storagePath) { res.status(404).json({ error: "Archivo de comprobante no encontrado" }); return; }
  try {
    const objectResponse = await downloadPrivateObject(proof.storagePath);
    const data = Buffer.from(await objectResponse.arrayBuffer());
    res.setHeader("Content-Type", proof.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Length", data.byteLength);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(proof.originalName ?? `comprobante-${proof.id}`)}`);
    res.end(data);
  } catch {
    res.status(404).json({ error: "Archivo de comprobante no disponible" });
  }
});

export default router;