import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, isNull, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  db,
  servicePlansTable,
  clientLifecycleEventsTable,
  paymentsTable,
  ticketsTable,
  ticketCommentsTable,
  inventoryItemsTable,
  fieldWorkOrdersTable,
  incidentAlertsTable,
  organizationsTable,
  sitesTable,
  clientsTable,
  usersTable,
  portalAccessTable,
} from "@workspace/db";

const router: IRouter = Router();

const asId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const text = (value: unknown, max = 4000): string | null => {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= max ? result : null;
};

const optionalDate = (value: unknown): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const result = new Date(String(value));
  return Number.isNaN(result.getTime()) ? undefined : result;
};

function serializeDates<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : value,
  ])) as T;
}

async function audit(
  user: { id?: number; username?: string } | undefined,
  entity: string,
  action: string,
  details: string,
  ids: { clientId?: number; equipmentId?: number } = {},
): Promise<void> {
  const { auditLogsTable } = await import("@workspace/db");
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null,
    username: user?.username ?? "sistema",
    entity,
    action,
    details,
    result: "Success",
    clientId: ids.clientId,
    equipmentId: ids.equipmentId,
  });
}

router.get("/plans", async (_req, res): Promise<void> => {
  const rows = await db.select().from(servicePlansTable).orderBy(servicePlansTable.name);
  res.json(rows.map(serializeDates));
});

router.post("/portal/access/:clientId", async (req, res): Promise<void> => {
  if (res.locals.user?.role !== "admin") {
    res.status(403).json({ error: "Solo un administrador puede generar acceso de portal" });
    return;
  }
  const clientId = asId(req.params.clientId);
  if (!clientId) { res.status(400).json({ error: "Cliente inválido" }); return; }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = req.body?.expiresInDays
    ? new Date(Date.now() + Math.min(3650, Math.max(1, Number(req.body.expiresInDays))) * 86_400_000)
    : null;
  await db.insert(portalAccessTable).values({ clientId, tokenHash: createHash("sha256").update(rawToken).digest("hex"), expiresAt })
    .onConflictDoUpdate({
      target: portalAccessTable.clientId,
      set: { tokenHash: createHash("sha256").update(rawToken).digest("hex"), expiresAt, lastUsedAt: null },
    });
  await audit(res.locals.user, "PortalAccess", "ROTATE", `Acceso de portal regenerado para cliente ${clientId}`, { clientId });
  res.status(201).json({ token: rawToken, expiresAt: expiresAt?.toISOString() ?? null });
});

router.post("/plans", async (req, res): Promise<void> => {
  const name = text(req.body?.name, 120);
  const downloadLimit = text(req.body?.downloadLimit, 32);
  const uploadLimit = text(req.body?.uploadLimit, 32);
  const monthlyFee = text(req.body?.monthlyFee, 24);
  if (!name || !downloadLimit || !uploadLimit || !monthlyFee || Number.isNaN(Number(monthlyFee))) {
    res.status(400).json({ error: "name, downloadLimit, uploadLimit y monthlyFee son obligatorios" });
    return;
  }
  const [plan] = await db.insert(servicePlansTable).values({
    name, downloadLimit, uploadLimit, monthlyFee,
    billingCycle: text(req.body?.billingCycle, 24) ?? "monthly",
    organizationId: asId(req.body?.organizationId),
  }).returning();
  await audit(res.locals.user, "ServicePlan", "CREATE", `Plan ${name} creado`);
  res.status(201).json(serializeDates(plan));
});

router.patch("/plans/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "ID de plan inválido" }); return; }
  const update: Record<string, unknown> = {};
  for (const key of ["name", "downloadLimit", "uploadLimit", "billingCycle"]) {
    const value = text(req.body?.[key], 120);
    if (value !== null) update[key] = value;
  }
  if (req.body?.monthlyFee !== undefined && !Number.isNaN(Number(req.body.monthlyFee))) update.monthlyFee = String(req.body.monthlyFee);
  if (typeof req.body?.active === "boolean") update.active = req.body.active;
  if (!Object.keys(update).length) { res.status(400).json({ error: "No hay cambios válidos" }); return; }
  const [plan] = await db.update(servicePlansTable).set(update).where(eq(servicePlansTable.id, id)).returning();
  if (!plan) { res.status(404).json({ error: "Plan no encontrado" }); return; }
  await audit(res.locals.user, "ServicePlan", "UPDATE", `Plan ${id} actualizado`);
  res.json(serializeDates(plan));
});

router.get("/clients/:id/lifecycle", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  if (!clientId) { res.status(400).json({ error: "Cliente inválido" }); return; }
  const rows = await db.select().from(clientLifecycleEventsTable)
    .where(eq(clientLifecycleEventsTable.clientId, clientId))
    .orderBy(desc(clientLifecycleEventsTable.createdAt));
  res.json(rows.map(serializeDates));
});

router.post("/clients/:id/lifecycle", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  const status = text(req.body?.status, 40);
  if (!clientId || !status) { res.status(400).json({ error: "Cliente y estado son obligatorios" }); return; }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const [event] = await db.insert(clientLifecycleEventsTable).values({
    clientId, status, notes: text(req.body?.notes),
    technicianUserId: asId(req.body?.technicianUserId),
    equipmentId: asId(req.body?.equipmentId),
    metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
  }).returning();
  await db.update(clientsTable).set({ status }).where(eq(clientsTable.id, clientId));
  await audit(res.locals.user, "Client", "LIFECYCLE_CHANGE", `Cliente ${clientId}: ${status}`, { clientId });
  res.status(201).json(serializeDates(event));
});

router.get("/clients/:id/payments", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  if (!clientId) { res.status(400).json({ error: "Cliente inválido" }); return; }
  const rows = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.clientId, clientId))
    .orderBy(desc(paymentsTable.paidAt));
  res.json(rows.map(serializeDates));
});

router.post("/clients/:id/payments", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  const amount = text(req.body?.amount, 24);
  const method = text(req.body?.method, 32);
  if (!clientId || !amount || Number.isNaN(Number(amount)) || Number(amount) <= 0 || !method) {
    res.status(400).json({ error: "Cliente, importe positivo y método son obligatorios" });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const receiptNumber = text(req.body?.receiptNumber, 64) ?? `REC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const paidAt = optionalDate(req.body?.paidAt);
  const [payment] = await db.insert(paymentsTable).values({
    clientId, amount, method, receiptNumber,
    currency: text(req.body?.currency, 8) ?? "USD",
    reference: text(req.body?.reference, 120),
    notes: text(req.body?.notes),
    paidAt: paidAt instanceof Date ? paidAt : new Date(),
    receivedByUserId: res.locals.user?.id ?? null,
  }).returning();
  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + Math.max(1, Number(req.body?.daysUntilNextDue ?? 30)));
  await db.update(clientsTable).set({
    paymentStatus: "PAID",
    status: client.status === "SUSPENDED" ? "ACTIVE" : client.status,
    lastPaymentDate: payment.paidAt,
    dueDate: nextDue,
  }).where(eq(clientsTable.id, clientId));
  await audit(res.locals.user, "Payment", "REGISTER", `Recibo ${receiptNumber} por ${amount}`, { clientId });
  res.status(201).json(serializeDates(payment));
});

router.get("/payments/:id/receipt", async (req, res): Promise<void> => {
  const paymentId = asId(req.params.id);
  if (!paymentId) { res.status(400).json({ error: "Recibo inválido" }); return; }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
  if (!payment) { res.status(404).json({ error: "Pago no encontrado" }); return; }
  const [client] = await db.select({ name: clientsTable.name, mac: clientsTable.mac })
    .from(clientsTable).where(eq(clientsTable.id, payment.clientId));
  const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${payment.receiptNumber}.html"`);
  res.send(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Recibo ${escapeHtml(payment.receiptNumber)}</title><style>body{font:16px system-ui;max-width:680px;margin:40px auto;padding:0 20px;color:#17202a}h1{font-size:24px}dl{display:grid;grid-template-columns:180px 1fr;gap:10px;border-top:1px solid #ddd;padding-top:20px}dt{font-weight:600}dd{margin:0}</style><h1>Recibo de pago</h1><dl><dt>Número</dt><dd>${escapeHtml(payment.receiptNumber)}</dd><dt>Cliente</dt><dd>${escapeHtml(client?.name ?? `Cliente ${payment.clientId}`)}</dd><dt>Fecha</dt><dd>${payment.paidAt.toISOString()}</dd><dt>Importe</dt><dd>${escapeHtml(payment.currency)} ${escapeHtml(payment.amount)}</dd><dt>Método</dt><dd>${escapeHtml(payment.method)}</dd><dt>Referencia</dt><dd>${escapeHtml(payment.reference ?? "—")}</dd></dl></html>`);
});

router.get("/tickets", async (req, res): Promise<void> => {
  const status = text(req.query.status, 32);
  const query = text(req.query.q, 120);
  const conditions = [];
  if (status) conditions.push(eq(ticketsTable.status, status));
  if (query) conditions.push(or(ilike(ticketsTable.subject, `%${query}%`), ilike(ticketsTable.description, `%${query}%`)));
  const rows = await db.select().from(ticketsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ticketsTable.updatedAt));
  res.json(rows.map(serializeDates));
});

router.post("/tickets", async (req, res): Promise<void> => {
  const subject = text(req.body?.subject, 200);
  const description = text(req.body?.description);
  if (!subject || !description) { res.status(400).json({ error: "subject y description son obligatorios" }); return; }
  const [ticket] = await db.insert(ticketsTable).values({
    subject, description, clientId: asId(req.body?.clientId),
    equipmentId: asId(req.body?.equipmentId), siteId: asId(req.body?.siteId),
    createdByUserId: res.locals.user?.id ?? null,
    assignedToUserId: asId(req.body?.assignedToUserId),
    category: text(req.body?.category, 40) ?? "other",
    priority: text(req.body?.priority, 20) ?? "normal",
  }).returning();
  await audit(res.locals.user, "Ticket", "CREATE", `Ticket #${ticket.id}: ${subject}`, { clientId: ticket.clientId ?? undefined, equipmentId: ticket.equipmentId ?? undefined });
  res.status(201).json(serializeDates(ticket));
});

router.get("/tickets/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const comments = await db.select().from(ticketCommentsTable)
    .where(eq(ticketCommentsTable.ticketId, id)).orderBy(ticketCommentsTable.createdAt);
  res.json({ ...serializeDates(ticket), comments: comments.map(serializeDates) });
});

router.patch("/tickets/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["status", "priority", "category", "rootCause"]) {
    const value = text(req.body?.[key], 2000);
    if (value !== null) update[key] = value;
  }
  for (const key of ["assignedToUserId", "equipmentId", "siteId", "clientId"]) {
    if (req.body?.[key] !== undefined) update[key] = asId(req.body[key]);
  }
  if (req.body?.status === "in_progress") update.firstResponseAt = new Date();
  if (req.body?.status === "resolved") update.resolvedAt = new Date();
  if (req.body?.status === "closed") update.closedAt = new Date();
  const [ticket] = await db.update(ticketsTable).set(update).where(eq(ticketsTable.id, id)).returning();
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  await audit(res.locals.user, "Ticket", "UPDATE", `Ticket #${id} actualizado`, { clientId: ticket.clientId ?? undefined, equipmentId: ticket.equipmentId ?? undefined });
  res.json(serializeDates(ticket));
});

router.post("/tickets/:id/comments", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const body = text(req.body?.body);
  if (!ticketId || !body) { res.status(400).json({ error: "Ticket y comentario son obligatorios" }); return; }
  const [comment] = await db.insert(ticketCommentsTable).values({
    ticketId, body, userId: res.locals.user?.id ?? null, internal: req.body?.internal === true,
  }).returning();
  await db.update(ticketsTable).set({ updatedAt: new Date(), firstResponseAt: new Date() })
    .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.firstResponseAt)));
  res.status(201).json(serializeDates(comment));
});

router.get("/inventory", async (req, res): Promise<void> => {
  const status = text(req.query.status, 32);
  const category = text(req.query.category, 64);
  const conditions = [];
  if (status) conditions.push(eq(inventoryItemsTable.status, status));
  if (category) conditions.push(eq(inventoryItemsTable.category, category));
  const rows = await db.select().from(inventoryItemsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inventoryItemsTable.updatedAt));
  res.json(rows.map(serializeDates));
});

router.post("/inventory", async (req, res): Promise<void> => {
  const name = text(req.body?.name, 200);
  const category = text(req.body?.category, 64);
  if (!name || !category) { res.status(400).json({ error: "name y category son obligatorios" }); return; }
  const [item] = await db.insert(inventoryItemsTable).values({
    name, category, sku: text(req.body?.sku, 80), serialNumber: text(req.body?.serialNumber, 120),
    macAddress: text(req.body?.macAddress, 64), status: text(req.body?.status, 32) ?? "in_stock",
    supplier: text(req.body?.supplier, 160), warrantyUntil: optionalDate(req.body?.warrantyUntil) ?? null,
    cost: req.body?.cost !== undefined ? String(req.body.cost) : null, notes: text(req.body?.notes),
    organizationId: asId(req.body?.organizationId), siteId: asId(req.body?.siteId),
    clientId: asId(req.body?.clientId), equipmentId: asId(req.body?.equipmentId),
  }).returning();
  await audit(res.locals.user, "Inventory", "CREATE", `Inventario: ${name}`);
  res.status(201).json(serializeDates(item));
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Artículo inválido" }); return; }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["name", "category", "sku", "serialNumber", "macAddress", "status", "supplier", "notes"]) {
    if (req.body?.[key] !== undefined) update[key] = text(req.body[key], 300);
  }
  for (const key of ["organizationId", "siteId", "clientId", "equipmentId"]) {
    if (req.body?.[key] !== undefined) update[key] = asId(req.body[key]);
  }
  if (req.body?.cost !== undefined) update.cost = String(req.body.cost);
  if (req.body?.warrantyUntil !== undefined) update.warrantyUntil = optionalDate(req.body.warrantyUntil) ?? null;
  const [item] = await db.update(inventoryItemsTable).set(update).where(eq(inventoryItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Artículo no encontrado" }); return; }
  await audit(res.locals.user, "Inventory", "UPDATE", `Inventario #${id} actualizado`);
  res.json(serializeDates(item));
});

router.get("/work-orders", async (req, res): Promise<void> => {
  const status = text(req.query.status, 32);
  const rows = await db.select().from(fieldWorkOrdersTable)
    .where(status ? eq(fieldWorkOrdersTable.status, status) : undefined)
    .orderBy(desc(fieldWorkOrdersTable.scheduledAt), desc(fieldWorkOrdersTable.createdAt));
  res.json(rows.map(serializeDates));
});

router.post("/work-orders", async (req, res): Promise<void> => {
  const [order] = await db.insert(fieldWorkOrdersTable).values({
    clientId: asId(req.body?.clientId), siteId: asId(req.body?.siteId),
    assignedToUserId: asId(req.body?.assignedToUserId),
    type: text(req.body?.type, 32) ?? "installation",
    status: text(req.body?.status, 32) ?? "pending",
    scheduledAt: optionalDate(req.body?.scheduledAt) ?? null,
    address: text(req.body?.address, 500), latitude: req.body?.latitude ? String(req.body.latitude) : null,
    longitude: req.body?.longitude ? String(req.body.longitude) : null,
    notes: text(req.body?.notes), measuredPower: req.body?.measuredPower ? String(req.body.measuredPower) : null,
    materials: Array.isArray(req.body?.materials) ? req.body.materials : [],
  }).returning();
  await audit(res.locals.user, "FieldWorkOrder", "CREATE", `Orden de campo #${order.id}`);
  res.status(201).json(serializeDates(order));
});

router.patch("/work-orders/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Orden inválida" }); return; }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["status", "type", "address", "notes"]) {
    if (req.body?.[key] !== undefined) update[key] = text(req.body[key], 2000);
  }
  if (req.body?.assignedToUserId !== undefined) update.assignedToUserId = asId(req.body.assignedToUserId);
  if (req.body?.scheduledAt !== undefined) update.scheduledAt = optionalDate(req.body.scheduledAt) ?? null;
  if (req.body?.measuredPower !== undefined) update.measuredPower = String(req.body.measuredPower);
  if (Array.isArray(req.body?.materials)) update.materials = req.body.materials;
  if (req.body?.status === "completed") update.completedAt = new Date();
  const [order] = await db.update(fieldWorkOrdersTable).set(update).where(eq(fieldWorkOrdersTable.id, id)).returning();
  if (!order) { res.status(404).json({ error: "Orden no encontrada" }); return; }
  await audit(res.locals.user, "FieldWorkOrder", "UPDATE", `Orden de campo #${id} actualizada`);
  res.json(serializeDates(order));
});

router.get("/incidents", async (req, res): Promise<void> => {
  const status = text(req.query.status, 32) ?? "open";
  const rows = await db.select().from(incidentAlertsTable)
    .where(eq(incidentAlertsTable.status, status)).orderBy(desc(incidentAlertsTable.createdAt));
  res.json(rows.map(serializeDates));
});

router.post("/incidents", async (req, res): Promise<void> => {
  const fingerprint = text(req.body?.fingerprint, 200);
  const type = text(req.body?.type, 64);
  const message = text(req.body?.message);
  if (!fingerprint || !type || !message) { res.status(400).json({ error: "fingerprint, type y message son obligatorios" }); return; }
  const [existing] = await db.select().from(incidentAlertsTable)
    .where(and(eq(incidentAlertsTable.fingerprint, fingerprint), eq(incidentAlertsTable.status, "open"))).limit(1);
  if (existing) { res.status(200).json({ ...serializeDates(existing), deduplicated: true }); return; }
  const [incident] = await db.insert(incidentAlertsTable).values({
    fingerprint, type, message, severity: text(req.body?.severity, 20) ?? "warning",
    equipmentId: asId(req.body?.equipmentId), clientId: asId(req.body?.clientId),
  }).returning();
  res.status(201).json(serializeDates(incident));
});

router.patch("/incidents/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Incidente inválido" }); return; }
  const update: Record<string, unknown> = {};
  if (req.body?.status === "acknowledged") {
    update.status = "acknowledged"; update.acknowledgedAt = new Date(); update.acknowledgedByUserId = res.locals.user?.id;
  } else if (req.body?.status === "resolved") {
    update.status = "resolved"; update.resolvedAt = new Date();
  }
  if (req.body?.silencedUntil !== undefined) update.silencedUntil = optionalDate(req.body.silencedUntil) ?? null;
  if (typeof req.body?.severity === "string") update.severity = text(req.body.severity, 20);
  if (!Object.keys(update).length) { res.status(400).json({ error: "Cambio de incidente no válido" }); return; }
  const [incident] = await db.update(incidentAlertsTable).set(update).where(eq(incidentAlertsTable.id, id)).returning();
  if (!incident) { res.status(404).json({ error: "Incidente no encontrado" }); return; }
  await audit(res.locals.user, "Incident", "UPDATE", `Incidente #${id}: ${String(req.body?.status ?? "actualizado")}`);
  res.json(serializeDates(incident));
});

router.get("/organizations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(organizationsTable).orderBy(organizationsTable.name);
  res.json(rows.map(serializeDates));
});

router.post("/organizations", async (req, res): Promise<void> => {
  const name = text(req.body?.name, 160);
  const slug = text(req.body?.slug, 80)?.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!name || !slug) { res.status(400).json({ error: "name y slug son obligatorios" }); return; }
  const [organization] = await db.insert(organizationsTable).values({ name, slug }).returning();
  await audit(res.locals.user, "Organization", "CREATE", `Organización ${name} creada`);
  res.status(201).json(serializeDates(organization));
});

router.get("/sites", async (req, res): Promise<void> => {
  const organizationId = asId(req.query.organizationId);
  const rows = await db.select().from(sitesTable)
    .where(organizationId ? eq(sitesTable.organizationId, organizationId) : undefined)
    .orderBy(sitesTable.name);
  res.json(rows.map(serializeDates));
});

router.post("/sites", async (req, res): Promise<void> => {
  const name = text(req.body?.name, 160);
  if (!name) { res.status(400).json({ error: "name es obligatorio" }); return; }
  const [site] = await db.insert(sitesTable).values({
    name, organizationId: asId(req.body?.organizationId), address: text(req.body?.address, 500),
    contactName: text(req.body?.contactName, 160), contactPhone: text(req.body?.contactPhone, 64),
    latitude: req.body?.latitude ? String(req.body.latitude) : null,
    longitude: req.body?.longitude ? String(req.body.longitude) : null,
  }).returning();
  await audit(res.locals.user, "Site", "CREATE", `Sede ${name} creada`);
  res.status(201).json(serializeDates(site));
});

router.get("/reports/operations", async (req, res): Promise<void> => {
  const since = new Date(Date.now() - Math.min(365, Math.max(1, Number(req.query.days ?? 30))) * 86_400_000);
  const [clients, payments, tickets, orders, incidents] = await Promise.all([
    db.select({ id: clientsTable.id, status: clientsTable.status, paymentStatus: clientsTable.paymentStatus }).from(clientsTable),
    db.select().from(paymentsTable).where(gte(paymentsTable.paidAt, since)),
    db.select().from(ticketsTable).where(gte(ticketsTable.createdAt, since)),
    db.select().from(fieldWorkOrdersTable).where(gte(fieldWorkOrdersTable.createdAt, since)),
    db.select().from(incidentAlertsTable).where(gte(incidentAlertsTable.createdAt, since)),
  ]);
  const by = <T extends Record<string, unknown>>(rows: T[], key: keyof T) => rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "unknown"); acc[value] = (acc[value] ?? 0) + 1; return acc;
  }, {});
  res.json({
    period: { since: since.toISOString(), until: new Date().toISOString() },
    clients: { total: clients.length, byStatus: by(clients, "status"), byPaymentStatus: by(clients, "paymentStatus") },
    payments: { count: payments.length, total: payments.reduce((sum, p) => sum + Number(p.amount), 0) },
    tickets: { total: tickets.length, byStatus: by(tickets, "status"), byPriority: by(tickets, "priority") },
    workOrders: { total: orders.length, byStatus: by(orders, "status") },
    incidents: { total: incidents.length, bySeverity: by(incidents, "severity") },
  });
});

router.get("/users/technicians", async (_req, res): Promise<void> => {
  const rows = await db.select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
    .from(usersTable).orderBy(usersTable.username);
  res.json(rows);
});

export default router;