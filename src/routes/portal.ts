import { Router, type IRouter, type Request } from "express";
import path from "node:path";
import { createHash } from "node:crypto";
import { Op } from "sequelize";
import {
  sequelize, Client, Equipment, Invoice, PaymentProof, PortalAccess, Ticket, Payment,
  MaintenanceNotice, TicketAttachment, SupportNotification,
} from "../db";
import { downloadPrivateObject, uploadPrivateObject } from "../services/object-storage.service";
import { TicketAttachmentStorageNotConfiguredError } from "../services/ticket-attachment-storage.service";
import {
  ListPortalNotificationsResponse,
  ListPortalReopenableTicketsResponse,
  ListPortalTicketAttachmentsResponse,
  MarkPortalNotificationReadParams,
  ReopenPortalTicketResponse,
  UploadPortalTicketAttachmentBody,
  UploadPortalTicketAttachmentResponse,
} from "@workspace/api-zod";
import {
  createSupportTicket,
  listTicketSlaPolicies,
  ticketSlaFields,
  transitionTicket,
} from "../services/ticket-lifecycle.service";
import { createTicketAttachment, downloadSupportTicketAttachment } from "../services/ticket-attachments.service";

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
const plain = <T>(value: T): T => (value && typeof (value as any).toJSON === "function" ? (value as any).toJSON() : value);

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
  return sequelize.transaction(async transaction => {
    const access = await PortalAccess.findOne({
      where: { tokenHash: hash(token), [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] },
      attributes: ["clientId"], transaction,
    });
    if (!access) return null;
    const clientId = access.get("clientId") as number;
    await PortalAccess.update({ lastUsedAt: new Date() }, { where: { clientId }, transaction });
    return clientId;
  });
}

router.get("/session", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const clientRecord = await Client.findByPk(clientId, {
    attributes: ["id", "name", "planLimit", "status", "paymentStatus", "monthlyFee", "dueDate", "equipmentId", "accessPointEquipmentId"],
  });
  const client = clientRecord ? plain(clientRecord) : null;
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const [payments, tickets, invoices, paymentProofs, equipment] = await Promise.all([
    Payment.findAll({ where: { clientId }, order: [["paidAt", "ASC"]], raw: true }),
    Ticket.findAll({ where: { clientId }, order: [["updatedAt", "ASC"]], raw: true }),
    Invoice.findAll({ where: { clientId }, order: [["dueDate", "ASC"]], raw: true }),
    PaymentProof.findAll({ where: { clientId }, attributes: ["id", "invoiceId", "amount", "currency", "method", "reference", "notes", "originalName", "mimeType", "status", "rejectionReason", "resubmissionOfId", "submittedAt", "reviewedAt"], order: [["submittedAt", "ASC"]], raw: true }),
    Equipment.findAll({ attributes: ["id", "model", "ip", "equipmentRole", "lastSeenStatus"], raw: true }),
  ]);
  const equipmentById = new Map(equipment.map(item => [item.id, item]));
  const policyByPriority = new Map((await listTicketSlaPolicies()).map(policy => [policy.priority, policy]));
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
      ...ticketSlaFields(ticket, policyByPriority.get(ticket.priority) ?? {
        firstResponseMinutes: 240,
        resolutionMinutes: 1440,
      }),
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

router.get("/notifications", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const notifications = await SupportNotification.findAll({
    where: { clientId }, order: [["createdAt", "ASC"]], limit: 50, raw: true,
  });
  res.json(ListPortalNotificationsResponse.parse(notifications.map(notification => ({
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
  }))));
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const params = MarkPortalNotificationReadParams.safeParse(req.params);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!params.success) { res.status(400).json({ error: "Notificación inválida" }); return; }
  const [updatedCount] = await SupportNotification.update({ readAt: new Date() }, {
    where: { id: params.data.id, clientId }, returning: true,
  });
  if (!updatedCount) { res.status(404).json({ error: "Notificación no encontrada" }); return; }
  res.status(204).end();
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
  const ticket = await createSupportTicket({
    clientId, subject, description, category: "client_report",
    priority: "normal", status: "open",
  }, {
    type: "client",
    clientId,
    name: `Cliente ${clientId}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
  });
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
  const ticket = await createSupportTicket({
    clientId,
    subject: `Solicitud de cambio de plan: ${requestedPlan}`,
    description: reason || "El cliente solicita revisar un cambio de plan.",
    category: "plan_change",
    priority: "normal",
    status: "open",
  }, {
    type: "client",
    clientId,
    name: `Cliente ${clientId}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
  });
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
  const ticket = await createSupportTicket({
    clientId,
    subject: `Solicitud de ${labels[type]}`,
    description: details,
    category: type,
    priority: "normal",
    status: "open",
  }, {
    type: "client",
    clientId,
    name: `Cliente ${clientId}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
  });
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
  const resubmissionOfId = req.body?.resubmitProofId === undefined || req.body?.resubmitProofId === ""
    ? null
    : id(req.body?.resubmitProofId);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const file = decodeProofFile(req.body?.file, req.body?.mimeType);
  if (!reference || reference.length > 160 || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      !proofMethods.has(method) || !file || (req.body?.invoiceId !== undefined && !invoiceId) ||
      (req.body?.resubmitProofId !== undefined && !resubmissionOfId)) {
    res.status(400).json({ error: "Referencia, importe, método y archivo válido son obligatorios" });
    return;
  }
  if (notes.length > 4000) {
    res.status(400).json({ error: "Las notas no pueden superar 4000 caracteres" });
    return;
  }
  if (invoiceId) {
    const invoice = await Invoice.findOne({ where: { id: invoiceId, clientId, balanceDue: { [Op.gt]: 0 } }, attributes: ["id"] });
    if (!invoice) {
      res.status(400).json({ error: "La factura seleccionada no pertenece a tu cuenta o ya está pagada" });
      return;
    }
  }
  if (resubmissionOfId) {
    const rejectedProof = await PaymentProof.findOne({ where: { id: resubmissionOfId, clientId }, attributes: ["id", "status"], raw: true });
    if (!rejectedProof || rejectedProof.status !== "REJECTED") {
      res.status(400).json({ error: "Solo puedes reenviar un comprobante rechazado de tu cuenta" });
      return;
    }
    const existingResubmission = await PaymentProof.findOne({ where: { resubmissionOfId, status: "PENDING" }, attributes: ["id"] });
    if (existingResubmission) {
      res.status(409).json({ error: "Ya existe un reenvío pendiente para este comprobante" });
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
  const proof = await PaymentProof.create({
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
    resubmissionOfId,
  });
  res.status(201).json({
    ...plain(proof),
    submittedAt: proof.submittedAt.toISOString(),
    reviewedAt: null,
  });
});

router.post("/tickets/:id/close", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const result = await transitionTicket({
    ticketId,
    toStatus: "closed",
    actor: {
      type: "client",
      clientId,
      name: `Cliente ${clientId}`,
      sourceIp: req.ip,
      device: req.get("user-agent"),
    },
    closeByClient: true,
    reason: "Cierre confirmado desde el portal",
    command: "POST /portal/tickets/:id/close",
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  if (result.kind === "invalid_transition") {
    res.status(409).json({ error: "Solo se puede confirmar el cierre de un ticket resuelto" });
    return;
  }
  res.json({ id: result.ticket.id, status: result.ticket.status });
});

router.get("/tickets/reopenable", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const tickets = await Ticket.findAll({
    attributes: [["id", "ticketId"]], where: { clientId, status: "closed", clientReopenEnabled: true }, raw: true,
  });
  res.json(ListPortalReopenableTicketsResponse.parse(tickets));
});

router.post("/tickets/:id/reopen", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const result = await transitionTicket({
    ticketId,
    toStatus: "open",
    actor: {
      type: "client",
      clientId,
      name: `Cliente ${clientId}`,
      sourceIp: req.ip,
      device: req.get("user-agent"),
    },
    allowReopen: true,
    reason: "Reapertura solicitada desde el portal del cliente",
    command: "POST /portal/tickets/:id/reopen",
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  if (result.kind === "invalid_transition") {
    res.status(409).json({ error: "Este ticket no está habilitado para reapertura" });
    return;
  }
  res.json(ReopenPortalTicketResponse.parse({
    ticketId: result.ticket.id,
    status: result.ticket.status,
    clientReopenEnabled: result.ticket.clientReopenEnabled,
    updatedAt: result.ticket.updatedAt.toISOString(),
  }));
});

router.get("/tickets/:id/attachments", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const ticket = await Ticket.findOne({ where: { id: ticketId, clientId }, attributes: ["id"] });
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const attachments = await TicketAttachment.findAll({
    attributes: ["id", "ticketId", "fileName", "mimeType", "sizeBytes", "visibleToClient", "createdAt"],
    where: { ticketId, visibleToClient: true }, order: [["createdAt", "ASC"]], raw: true,
  });
  res.json(ListPortalTicketAttachmentsResponse.parse(attachments.map(attachment => ({
    ...attachment,
    createdAt: attachment.createdAt.toISOString(),
  }))));
});

router.post("/tickets/:id/attachments", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  const input = UploadPortalTicketAttachmentBody.safeParse(req.body);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId || !input.success) { res.status(400).json({ error: "Ticket o archivo inválido" }); return; }
  const ticket = await Ticket.findOne({ where: { id: ticketId, clientId } });
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  let attachment: Awaited<ReturnType<typeof createTicketAttachment>>;
  try {
    attachment = await createTicketAttachment({
      ticketId,
      fileName: input.data.fileName,
      mimeType: input.data.mimeType,
      dataBase64: input.data.dataBase64,
      visibleToClient: true,
      uploadedByClientId: clientId,
    });
  } catch (error) {
    if (error instanceof TicketAttachmentStorageNotConfiguredError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!attachment) { res.status(400).json({ error: "Archivo inválido, no compatible o mayor a 2 MiB" }); return; }
  if (ticket.assignedToUserId !== null) {
    await SupportNotification.create({
      ticketId,
      userId: ticket.assignedToUserId,
      title: `Nueva evidencia en el ticket #${ticketId}`,
      message: `El cliente añadió ${attachment.fileName}.`,
    });
  }
  res.status(201).json(UploadPortalTicketAttachmentResponse.parse({
    ...attachment,
    createdAt: attachment.createdAt.toISOString(),
  }));
});

router.get("/tickets/:id/attachments/:attachmentId/download", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const ticketId = id(req.params.id);
  const attachmentId = id(req.params.attachmentId);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!ticketId || !attachmentId) { res.status(400).json({ error: "Ticket o archivo inválido" }); return; }
  const ownedTicket = await Ticket.findOne({ where: { id: ticketId, clientId }, attributes: ["id"] });
  if (!ownedTicket) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
  const attachment = await TicketAttachment.findOne({
    where: { id: attachmentId, ticketId, visibleToClient: true },
  });
  if (!attachment) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
  let response: Response;
  try {
    response = await downloadSupportTicketAttachment(attachment.storagePath);
  } catch (error) {
    if (error instanceof TicketAttachmentStorageNotConfiguredError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
  const data = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Length", data.length);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

router.get("/notices", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const now = new Date();
  const notices = await MaintenanceNotice.findAll({
    attributes: ["id", "title", "message", "startsAt", "endsAt"],
    where: { active: true, startsAt: { [Op.lte]: now }, [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gt]: now } }] },
    raw: true,
  });
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
  const payment = await Payment.findOne({ where: { id: paymentId, clientId } });
  if (!payment) { res.status(404).json({ error: "Recibo no encontrado" }); return; }
  const client = await Client.findByPk(clientId, { attributes: ["name"], raw: true });
  const escapeHtml = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const receiptFilename = payment.receiptNumber.replace(/[^A-Za-z0-9_.-]/g, "_");
  const paidAt = new Intl.DateTimeFormat("es-CU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Havana",
  }).format(payment.paidAt);
  const clientName = escapeHtml(client?.name ?? `Cliente ${clientId}`);
  const receiptNumber = escapeHtml(payment.receiptNumber);
  const amount = escapeHtml(`${payment.currency} ${payment.amount}`);
  const method = escapeHtml(payment.method);
  const reference = escapeHtml(payment.reference ?? "—");
  const status = escapeHtml(payment.status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${receiptFilename}.html"`);
  res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Recibo ${receiptNumber} · Imperio AP</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f1f5f9}
    *{box-sizing:border-box}
    body{margin:0;padding:48px 20px}
    .receipt{max-width:720px;margin:0 auto;background:#fff;border:1px solid #dce3ec;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.09)}
    .top{padding:32px 36px 28px;background:linear-gradient(135deg,#0b1f3a,#123f69);color:#fff}
    .brand{font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#a9d5ff}
    h1{margin:18px 0 6px;font-size:28px;line-height:1.15}
    .subtitle{margin:0;color:#d7e8f8;font-size:14px}
    .body{padding:30px 36px 34px}
    .amount{margin-bottom:26px;padding:20px 22px;border:1px solid #c9e6d8;border-radius:12px;background:#f1fbf5}
    .amount-label{color:#52705e;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}
    .amount-value{margin-top:5px;color:#14683c;font-size:30px;font-weight:750;letter-spacing:-.03em}
    .details{display:grid;grid-template-columns:minmax(130px,.7fr) 1.3fr;gap:0;margin:0;border-top:1px solid #e7ebf0}
    .details dt,.details dd{margin:0;padding:14px 0;border-bottom:1px solid #e7ebf0;font-size:14px}
    .details dt{color:#657286}
    .details dd{font-weight:600;overflow-wrap:anywhere}
    .number{font-variant-numeric:tabular-nums}
    .footer{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:26px;color:#657286;font-size:12px}
    .print{border:0;border-radius:9px;padding:10px 14px;background:#1167a8;color:white;font:inherit;font-weight:650;cursor:pointer}
    .print:hover{background:#0b568f}
    @media(max-width:520px){body{padding:16px 10px}.top{padding:26px 22px}.body{padding:24px 22px}.details{grid-template-columns:1fr;gap:0}.details dt{padding-bottom:2px;border-bottom:0}.details dd{padding-top:0}.footer{align-items:flex-start;flex-direction:column}}
    @media print{@page{size:auto;margin:16mm} :root{background:#fff}body{padding:0;background:#fff}.receipt{max-width:none;border:0;border-radius:0;box-shadow:none}.top{-webkit-print-color-adjust:exact;print-color-adjust:exact}.amount{break-inside:avoid}.print{display:none}}
  </style>
</head>
<body>
  <main class="receipt">
    <header class="top">
      <div class="brand">Imperio AP · Portal del cliente</div>
      <h1>Recibo de pago</h1>
      <p class="subtitle">Comprobante electrónico de un pago registrado en tu cuenta.</p>
    </header>
    <section class="body" aria-label="Detalles del pago">
      <div class="amount">
        <div class="amount-label">Importe recibido</div>
        <div class="amount-value">${amount}</div>
      </div>
      <dl class="details">
        <dt>Número de recibo</dt><dd class="number">${receiptNumber}</dd>
        <dt>Cliente</dt><dd>${clientName}</dd>
        <dt>Fecha de pago</dt><dd>${escapeHtml(paidAt)} (hora de Cuba)</dd>
        <dt>Método de pago</dt><dd>${method}</dd>
        <dt>Referencia</dt><dd>${reference}</dd>
        <dt>Estado</dt><dd>${status}</dd>
      </dl>
      <footer class="footer">
        <span>Conserva este recibo para tus registros.</span>
        <button class="print" type="button" onclick="window.print()">Imprimir o guardar como PDF</button>
      </footer>
    </section>
  </main>
</body>
</html>`);
});

router.get("/payment-proofs/:id/download", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const proofId = id(req.params.id);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!proofId) { res.status(400).json({ error: "Comprobante inválido" }); return; }
  const proof = await PaymentProof.findOne({ where: { id: proofId, clientId } });
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