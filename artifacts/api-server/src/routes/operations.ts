import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  auditLogsTable,
  db,
  servicePlansTable,
  clientLifecycleEventsTable,
  clientChangeHistoryTable,
  paymentsTable,
  ticketsTable,
  ticketCommentsTable,
  ticketStatusHistoryTable,
  ticketSlaPoliciesTable,
  ticketAttachmentsTable,
  supportNotificationsTable,
  inventoryItemsTable,
  fieldWorkOrdersTable,
  technicianAvailabilityTable,
  incidentAlertsTable,
  equipmentTable,
  organizationsTable,
  sitesTable,
  clientsTable,
  usersTable,
  portalAccessTable,
  maintenanceNoticesTable,
} from "@workspace/db";
import {
  UpdateTicketClientReopenPermissionBody,
  UpdateTicketClientReopenPermissionResponse,
  AddSupportTicketCommentBody,
  AddSupportTicketCommentResponse,
  CreateSupportTicketBody,
  CreateSupportTicketResponse,
  CreateFieldWorkOrderBody,
  CreateFieldWorkOrderResponse,
  GetSupportTicketResponse,
  ListFieldWorkOrdersResponse,
  ListTechniciansResponse,
  ListTechnicianAvailabilityResponse,
  ListSupportTicketHistoryResponse,
  ListSupportTicketAttachmentsResponse,
  ListTicketSlaPoliciesResponse,
  ListUserNotificationsResponse,
  UpdateSupportTicketBody,
  UpdateSupportTicketResponse,
  UpdateFieldWorkOrderParams,
  UpdateFieldWorkOrderBody,
  UpdateFieldWorkOrderResponse,
  UpdateMyFieldWorkOrderBody,
  GetMyFieldWorkOrderAlignmentResponse,
  ReadMyFieldWorkOrderRadioGpsResponse,
  SaveMyFieldWorkOrderAlignmentBody,
  UpdateTicketSlaPolicyBody,
  UpdateTicketSlaPolicyResponse,
  UploadSupportTicketAttachmentBody,
  UploadSupportTicketAttachmentResponse,
  CreateTechnicianAvailabilityBody,
  CreateTechnicianAvailabilityResponse,
  DeleteTechnicianAvailabilityParams,
} from "@workspace/api-zod";
import { getMikroTikGps } from "../services/mikrotik.service";
import {
  getUbiquitiRadioGps,
  getWirelessTable,
  type WirelessStation,
} from "../services/ubiquiti.service";
import { TicketAttachmentStorageNotConfiguredError } from "../services/ticket-attachment-storage.service";
import { createTicketAttachment } from "../services/ticket-attachments.service";
import { downloadSupportTicketAttachment } from "../services/ticket-attachments.service";
import {
  getTicketSlaPolicy,
  listTicketSlaPolicies,
  notifyTicketAssignment,
  notifyTicketComment,
  recordTicketCreated,
  ticketPriorities,
  ticketSlaFields,
  transitionTicket,
} from "../services/ticket-lifecycle.service";
import {
  containsScheduleRange,
  isValidScheduleRange,
  scheduledOrderConflicts,
  scheduleRangesOverlap,
} from "../services/field-work-scheduling.service";

const router: IRouter = Router();

const asId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

type AlignmentEquipment = {
  id: number;
  model: string;
  equipmentRole: string;
  connectionType: string;
  ip: string;
  username: string;
  password: string;
  latitude: string | null;
  longitude: string | null;
  altitudeMeters: string | null;
  locationSource: string | null;
  locationAccuracyMeters: string | null;
};

const alignmentLocationSources = new Set([
  "manual",
  "external_gps",
  "phone_gps",
  "radio_gps",
  "unknown",
]);

function equipmentAlignmentPosition(equipment: AlignmentEquipment | undefined) {
  if (!equipment?.latitude || !equipment.longitude) return null;
  const latitude = Number(equipment.latitude);
  const longitude = Number(equipment.longitude);
  const rawAltitude = equipment.altitudeMeters === null ? null : Number(equipment.altitudeMeters);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) return null;
  return {
    latitude,
    longitude,
    altitudeMeters: rawAltitude !== null && Number.isFinite(rawAltitude) ? rawAltitude : null,
    source: equipment.locationSource && alignmentLocationSources.has(equipment.locationSource)
      ? equipment.locationSource
      : "unknown",
    accuracyMeters: equipment.locationAccuracyMeters === null
      ? null
      : Number.isFinite(Number(equipment.locationAccuracyMeters))
        ? Number(equipment.locationAccuracyMeters)
        : null,
  };
}

async function loadMyAlignmentContext(id: number, userId: number) {
  const [order] = await db.select({
    id: fieldWorkOrdersTable.id,
    clientId: fieldWorkOrdersTable.clientId,
  }).from(fieldWorkOrdersTable)
    .where(and(
      eq(fieldWorkOrdersTable.id, id),
      eq(fieldWorkOrdersTable.assignedToUserId, userId),
    ));
  if (!order?.clientId) return null;

  const [client] = await db.select({
    id: clientsTable.id,
    name: clientsTable.name,
    mac: clientsTable.mac,
    equipmentId: clientsTable.equipmentId,
    accessPointEquipmentId: clientsTable.accessPointEquipmentId,
  }).from(clientsTable).where(eq(clientsTable.id, order.clientId));
  if (!client) return null;

  const equipmentIds = [...new Set([
    client.equipmentId,
    client.accessPointEquipmentId,
  ].filter((equipmentId): equipmentId is number => equipmentId !== null))];
  const selectAlignmentEquipment = {
      id: equipmentTable.id,
      model: equipmentTable.model,
      equipmentRole: equipmentTable.equipmentRole,
      connectionType: equipmentTable.connectionType,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      password: equipmentTable.password,
      latitude: equipmentTable.latitude,
      longitude: equipmentTable.longitude,
      altitudeMeters: equipmentTable.altitudeMeters,
      locationSource: equipmentTable.locationSource,
      locationAccuracyMeters: equipmentTable.locationAccuracyMeters,
  };
  const devices: AlignmentEquipment[] = equipmentIds.length
    ? await db.select(selectAlignmentEquipment).from(equipmentTable).where(inArray(equipmentTable.id, equipmentIds))
    : [];
  const apCandidates: AlignmentEquipment[] = await db.select(selectAlignmentEquipment)
    .from(equipmentTable)
    .where(eq(equipmentTable.equipmentRole, "ap_distributor"));

  return {
    client,
    clientRadio: devices.find(device => device.id === client.equipmentId),
    savedAccessPoint: client.accessPointEquipmentId === null
      ? undefined
      : devices.find(device => device.id === client.accessPointEquipmentId),
    apCandidates: apCandidates.filter(device => device.id !== client.equipmentId),
  };
}

function normalizeMac(value: string): string {
  return value.replace(/[^a-f0-9]/gi, "").toLowerCase();
}

const ALIGNMENT_STATION_CACHE_TTL_MS = 12_000;
const ALIGNMENT_STATION_SCAN_CONCURRENCY = 8;
const alignmentStationTableCache = new Map<number, {
  expiresAt: number;
  stations: WirelessStation[];
}>();
const alignmentStationTablePending = new Map<number, Promise<WirelessStation[]>>();

async function getAlignmentStationTable(
  equipment: AlignmentEquipment,
  forceRefresh = false,
): Promise<WirelessStation[]> {
  const cached = alignmentStationTableCache.get(equipment.id);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.stations;

  const pending = alignmentStationTablePending.get(equipment.id);
  if (!forceRefresh && pending) return pending;

  const request = getWirelessTable(
    equipment.ip,
    equipment.username,
    equipment.password,
    equipment.connectionType,
  ).catch(() => []);
  alignmentStationTablePending.set(equipment.id, request);
  try {
    const stations = await request;
    alignmentStationTableCache.set(equipment.id, {
      expiresAt: Date.now() + ALIGNMENT_STATION_CACHE_TTL_MS,
      stations,
    });
    return stations;
  } finally {
    if (alignmentStationTablePending.get(equipment.id) === request) {
      alignmentStationTablePending.delete(equipment.id);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}

type AlignmentContext = NonNullable<Awaited<ReturnType<typeof loadMyAlignmentContext>>>;
type AccessPointMatch = {
  equipment: AlignmentEquipment;
  station: WirelessStation;
};

async function resolveAssociatedAccessPoint(
  context: AlignmentContext,
  forceRefresh = false,
) {
  const clientMac = normalizeMac(context.client.mac);
  const checkedAt = new Date().toISOString();
  if (clientMac.length !== 12 || context.apCandidates.length === 0) {
    return {
      status: "not_detected" as const,
      method: null,
      selected: undefined,
      matches: [] as AccessPointMatch[],
      checkedAt,
    };
  }

  const tables = await mapWithConcurrency(
    context.apCandidates,
    ALIGNMENT_STATION_SCAN_CONCURRENCY,
    async equipment => ({
      equipment,
      stations: await getAlignmentStationTable(equipment, forceRefresh),
    }),
  );
  const matchesByEquipmentId = new Map<number, AccessPointMatch>();
  for (const { equipment, stations } of tables) {
    const station = stations.find(candidate => normalizeMac(candidate.mac) === clientMac);
    if (station && !matchesByEquipmentId.has(equipment.id)) {
      matchesByEquipmentId.set(equipment.id, { equipment, station });
    }
  }
  const matches = [...matchesByEquipmentId.values()];
  const savedReferenceMatch = context.savedAccessPoint
    ? matches.find(match => match.equipment.id === context.savedAccessPoint?.id)
    : undefined;
  const selected = matches.length === 1
    ? matches[0]
    : matches.length > 1
      ? savedReferenceMatch
      : undefined;

  return {
    status: selected ? "detected" as const : matches.length ? "ambiguous" as const : "not_detected" as const,
    method: selected
      ? matches.length === 1 ? "live_unique" as const : "saved_reference" as const
      : null,
    selected: selected?.equipment,
    matches,
    checkedAt,
  };
}

function metricNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

type FieldSignatureStroke = Array<[number, number]>;

function normalizeFieldSignatureData(value: string): string | null {
  if (value.length > 24_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const signerName = typeof parsed.signerName === "string" ? parsed.signerName.trim() : "";
    const rawStrokes = parsed.strokes;
    if (
      parsed.version !== 1
      || !signerName
      || signerName.length > 120
      || !Array.isArray(rawStrokes)
      || rawStrokes.length === 0
      || rawStrokes.length > 32
    ) {
      return null;
    }

    let pointCount = 0;
    const strokes: FieldSignatureStroke[] = [];
    for (const rawStroke of rawStrokes) {
      if (!Array.isArray(rawStroke) || rawStroke.length < 2 || rawStroke.length > 500) return null;
      const stroke: FieldSignatureStroke = [];
      for (const rawPoint of rawStroke) {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return null;
        const [x, y] = rawPoint.map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
        stroke.push([x, y]);
        pointCount += 1;
        if (pointCount > 2_000) return null;
      }
      strokes.push(stroke);
    }

    return JSON.stringify({
      version: 1,
      signerName,
      signedAt: new Date().toISOString(),
      strokes,
    });
  } catch {
    return null;
  }
}

async function buildMyFieldWorkOrderAlignment(id: number, userId: number) {
  const context = await loadMyAlignmentContext(id, userId);
  if (!context) return null;

  const association = await resolveAssociatedAccessPoint(context);
  const selectedMatch = association.matches.find(match => match.equipment.id === association.selected?.id);
  const activeAccessPoint = selectedMatch?.equipment;
  const station = selectedMatch?.station;

  return GetMyFieldWorkOrderAlignmentResponse.parse({
    workOrderId: id,
    clientName: context.client.name,
    clientMac: context.client.mac,
    clientRadio: {
      equipmentId: context.clientRadio?.id ?? null,
      model: context.clientRadio?.model ?? null,
      position: equipmentAlignmentPosition(context.clientRadio),
    },
    accessPoint: {
      equipmentId: activeAccessPoint?.id ?? null,
      model: activeAccessPoint?.model ?? null,
      position: equipmentAlignmentPosition(activeAccessPoint),
    },
    savedReferenceAccessPoint: context.savedAccessPoint?.equipmentRole === "ap_distributor"
      ? {
        equipmentId: context.savedAccessPoint.id,
        model: context.savedAccessPoint.model,
        position: equipmentAlignmentPosition(context.savedAccessPoint),
      }
      : null,
    accessPointAssociation: {
      status: association.status,
      method: association.method,
      candidates: association.matches.map(match => ({
        equipmentId: match.equipment.id,
        model: match.equipment.model,
        signalDbm: metricNumber(match.station.signalDbm),
      })),
      checkedAt: association.checkedAt,
    },
    metrics: {
      available: Boolean(station),
      signalDbm: metricNumber(station?.signalDbm),
      noiseDbm: metricNumber(station?.noiseDbm),
      ccq: metricNumber(station?.ccq),
      txRate: station?.txRate ?? null,
      rxRate: station?.rxRate ?? null,
      distance: station?.distance ?? null,
      refreshedAt: station ? new Date().toISOString() : null,
    },
  });
}

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

router.get("/clients/:id/history", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  if (!clientId) { res.status(400).json({ error: "Cliente inválido" }); return; }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const rows = await db.select({
    id: clientChangeHistoryTable.id,
    clientId: clientChangeHistoryTable.clientId,
    changedByUserId: clientChangeHistoryTable.changedByUserId,
    username: usersTable.username,
    changeType: clientChangeHistoryTable.changeType,
    reason: clientChangeHistoryTable.reason,
    previousData: clientChangeHistoryTable.previousData,
    newData: clientChangeHistoryTable.newData,
    createdAt: clientChangeHistoryTable.createdAt,
  })
    .from(clientChangeHistoryTable)
    .leftJoin(usersTable, eq(usersTable.id, clientChangeHistoryTable.changedByUserId))
    .where(eq(clientChangeHistoryTable.clientId, clientId))
    .orderBy(desc(clientChangeHistoryTable.createdAt));
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
  const priority = text(req.query.priority, 20);
  const assigneeFilter = text(req.query.assignedToUserId, 32);
  const slaFilter = text(req.query.sla, 32);
  const query = text(req.query.q, 120);
  const conditions = [];
  if (priority && !ticketPriorities.includes(priority as typeof ticketPriorities[number])) {
    res.status(400).json({ error: "Prioridad inválida" });
    return;
  }
  if (status) conditions.push(eq(ticketsTable.status, status));
  if (priority) conditions.push(eq(ticketsTable.priority, priority));
  if (assigneeFilter === "unassigned") conditions.push(isNull(ticketsTable.assignedToUserId));
  else if (assigneeFilter) {
    const assignedToUserId = asId(assigneeFilter);
    if (!assignedToUserId) { res.status(400).json({ error: "Responsable inválido" }); return; }
    conditions.push(eq(ticketsTable.assignedToUserId, assignedToUserId));
  }
  if (query) conditions.push(or(ilike(ticketsTable.subject, `%${query}%`), ilike(ticketsTable.description, `%${query}%`)));
  const rows = await db.select().from(ticketsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ticketsTable.updatedAt));
  const policies = new Map((await listTicketSlaPolicies()).map(policy => [policy.priority, policy]));
  const decorated = rows.map(ticket => {
    const policy = policies.get(ticket.priority) ?? { firstResponseMinutes: 240, resolutionMinutes: 1440 };
    return { ...serializeDates(ticket), ...ticketSlaFields(ticket, policy) };
  });
  const filtered = slaFilter === "overdue"
    ? decorated.filter(ticket => ticket.firstResponseSla === "breached" || ticket.resolutionSla === "breached")
    : slaFilter === "first_response"
      ? decorated.filter(ticket => ticket.firstResponseSla !== "met")
      : slaFilter === "resolution"
        ? decorated.filter(ticket => ticket.resolutionSla !== "met")
        : decorated;
  res.json(filtered);
});

router.post("/tickets", async (req, res): Promise<void> => {
  const input = CreateSupportTicketBody.safeParse(req.body);
  const subject = input.success ? text(input.data.subject, 200) : null;
  const description = input.success ? text(input.data.description) : null;
  if (!input.success || !subject || !description) {
    res.status(400).json({ error: "subject y description son obligatorios y deben tener formato válido" });
    return;
  }
  const priority = input.data.priority ?? "normal";
  if (!ticketPriorities.includes(priority as typeof ticketPriorities[number])) {
    res.status(400).json({ error: "Prioridad inválida" });
    return;
  }
  const policy = await getTicketSlaPolicy(priority);
  const createdAt = new Date();
  const [ticket] = await db.insert(ticketsTable).values({
    subject,
    description,
    clientId: asId(input.data.clientId),
    equipmentId: asId(input.data.equipmentId),
    siteId: asId(input.data.siteId),
    createdByUserId: res.locals.user?.id ?? null,
    assignedToUserId: asId(input.data.assignedToUserId),
    category: text(input.data.category, 40) ?? "other",
    priority,
    firstResponseDueAt: new Date(createdAt.getTime() + policy.firstResponseMinutes * 60_000),
    resolutionDueAt: new Date(createdAt.getTime() + policy.resolutionMinutes * 60_000),
    createdAt,
    updatedAt: createdAt,
  }).returning();
  await recordTicketCreated(ticket, {
    type: "user",
    userId: res.locals.user?.id,
    name: res.locals.user?.username,
    sourceIp: req.ip,
    device: req.get("user-agent"),
  });
  res.status(201).json(CreateSupportTicketResponse.parse({
    ...ticket,
    ...ticketSlaFields(ticket, policy),
  }));
});

router.get("/tickets/sla-policies", async (_req, res): Promise<void> => {
  res.json(ListTicketSlaPoliciesResponse.parse((await listTicketSlaPolicies()).map(serializeDates)));
});

router.get("/tickets/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const comments = await db.select().from(ticketCommentsTable)
    .where(eq(ticketCommentsTable.ticketId, id)).orderBy(ticketCommentsTable.createdAt);
  const policy = await getTicketSlaPolicy(ticket.priority);
  res.json(GetSupportTicketResponse.parse({
    ...ticket,
    ...ticketSlaFields(ticket, policy),
    comments: comments.map(serializeDates),
  }));
});

router.patch("/tickets/:id", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const input = UpdateSupportTicketBody.safeParse(req.body);
  if (!ticketId || !input.success) { res.status(400).json({ error: "Ticket o cambios inválidos" }); return; }

  if (input.data.status !== undefined) {
    if (Object.keys(input.data).some(key => key !== "status" && key !== "reason")) {
      res.status(400).json({ error: "Una transición de estado debe enviarse por separado de otros cambios" });
      return;
    }
    const transition = await transitionTicket({
      ticketId,
      toStatus: input.data.status,
      actor: {
        type: "user",
        userId: res.locals.user?.id,
        name: res.locals.user?.username,
        sourceIp: req.ip,
        device: req.get("user-agent"),
      },
      reason: text(input.data.reason, 500),
      command: "PATCH /tickets/:id",
    });
    if (transition.kind === "not_found") { res.status(404).json({ error: "Ticket no encontrado" }); return; }
    if (transition.kind === "invalid_transition") {
      res.status(409).json({ error: `No se permite pasar de ${transition.currentStatus} a ${input.data.status}` });
      return;
    }
    const policy = await getTicketSlaPolicy(transition.ticket.priority);
    res.json(UpdateSupportTicketResponse.parse({
      ...transition.ticket,
      ...ticketSlaFields(transition.ticket, policy),
    }));
    return;
  }

  const [before] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!before) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const update: Partial<typeof ticketsTable.$inferInsert> = { updatedAt: new Date() };
  if (input.data.priority !== undefined) {
    if (!ticketPriorities.includes(input.data.priority as typeof ticketPriorities[number])) {
      res.status(400).json({ error: "Prioridad inválida" });
      return;
    }
    const policy = await getTicketSlaPolicy(input.data.priority);
    update.priority = input.data.priority;
    update.firstResponseDueAt = new Date(before.createdAt.getTime() + policy.firstResponseMinutes * 60_000);
    update.resolutionDueAt = new Date(before.createdAt.getTime() + policy.resolutionMinutes * 60_000);
  }
  if (input.data.category !== undefined) update.category = text(input.data.category, 40) ?? before.category;
  if (input.data.rootCause !== undefined) update.rootCause = input.data.rootCause === null ? null : text(input.data.rootCause, 2000);
  for (const key of ["assignedToUserId", "equipmentId", "siteId", "clientId"] as const) {
    if (input.data[key] !== undefined) update[key] = asId(input.data[key]);
  }
  const changedFields = Object.keys(input.data).filter(key => key !== "reason");
  if (changedFields.length === 0) { res.status(400).json({ error: "Indica al menos un cambio" }); return; }
  if (update.assignedToUserId) {
    const [assignee] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, update.assignedToUserId));
    if (!assignee) { res.status(400).json({ error: "El responsable seleccionado no existe" }); return; }
  }
  const [ticket] = await db.update(ticketsTable).set(update).where(eq(ticketsTable.id, ticketId)).returning();
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const afterState = Object.fromEntries(changedFields.map(key => [key, (ticket as Record<string, unknown>)[key]]));
  const beforeState = Object.fromEntries(changedFields.map(key => [key, (before as Record<string, unknown>)[key]]));
  await db.insert(auditLogsTable).values({
    userId: res.locals.user?.id ?? null,
    username: res.locals.user?.username ?? "sistema",
    clientId: ticket.clientId,
    equipmentId: ticket.equipmentId,
    entity: "Ticket",
    action: ticket.assignedToUserId !== before.assignedToUserId ? "ASSIGNMENT_CHANGE" : "UPDATE",
    commandSent: "PATCH /tickets/:id",
    result: "Success",
    details: `Ticket #${ticket.id} actualizado: ${changedFields.join(", ")}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
    beforeState: JSON.stringify(beforeState),
    afterState: JSON.stringify(afterState),
    reason: text(input.data.reason, 500),
  });
  if (ticket.assignedToUserId !== before.assignedToUserId) {
    await notifyTicketAssignment({
      ticket,
      actor: {
        type: "user",
        userId: res.locals.user?.id,
        name: res.locals.user?.username,
      },
    });
  }
  const policy = await getTicketSlaPolicy(ticket.priority);
  res.json(UpdateSupportTicketResponse.parse({
    ...ticket,
    ...ticketSlaFields(ticket, policy),
  }));
});

router.patch("/tickets/:id/client-reopen", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const input = UpdateTicketClientReopenPermissionBody.safeParse(req.body);
  if (!ticketId || !input.success) {
    res.status(400).json({ error: "Ticket o permiso de reapertura inválido" });
    return;
  }
  const [existing] = await db.select({
    id: ticketsTable.id,
    clientId: ticketsTable.clientId,
    status: ticketsTable.status,
    clientReopenEnabled: ticketsTable.clientReopenEnabled,
  }).from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!existing) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  if (existing.status !== "closed" || existing.clientId === null) {
    res.status(409).json({ error: "Solo puedes cambiar el permiso de un ticket cerrado de un cliente" });
    return;
  }
  const [ticket] = await db.update(ticketsTable).set({
    clientReopenEnabled: input.data.enabled,
    updatedAt: new Date(),
  }).where(and(
    eq(ticketsTable.id, ticketId),
    eq(ticketsTable.status, "closed"),
    isNotNull(ticketsTable.clientId),
  )).returning({
    id: ticketsTable.id,
    clientId: ticketsTable.clientId,
    clientReopenEnabled: ticketsTable.clientReopenEnabled,
  });
  if (!ticket) {
    res.status(409).json({ error: "El ticket cambió de estado; actualiza y vuelve a intentarlo" });
    return;
  }
  await db.insert(auditLogsTable).values({
    userId: res.locals.user?.id ?? null,
    username: res.locals.user?.username ?? "sistema",
    clientId: ticket.clientId,
    entity: "Ticket",
    action: "CLIENT_REOPEN_PERMISSION",
    commandSent: "PATCH /tickets/:id/client-reopen",
    result: "Success",
    details: `Permiso de reapertura del cliente ${ticket.clientReopenEnabled ? "habilitado" : "revocado"} para el ticket #${ticket.id}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
    beforeState: JSON.stringify({ clientReopenEnabled: existing.clientReopenEnabled }),
    afterState: JSON.stringify({ clientReopenEnabled: ticket.clientReopenEnabled }),
    reason: "Permiso de reapertura de un solo uso actualizado por soporte",
  });
  res.json(UpdateTicketClientReopenPermissionResponse.parse({
    ticketId: ticket.id,
    enabled: ticket.clientReopenEnabled,
  }));
});

router.post("/tickets/:id/comments", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const input = AddSupportTicketCommentBody.safeParse(req.body);
  const body = input.success ? text(input.data.body) : null;
  if (!ticketId || !input.success || !body) {
    res.status(400).json({ error: "Ticket y comentario son obligatorios" });
    return;
  }
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const internal = input.data.internal === true;
  const [comment] = await db.insert(ticketCommentsTable).values({
    ticketId,
    body,
    userId: res.locals.user?.id ?? null,
    internal,
  }).returning();
  const firstResponseAt = new Date();
  const [firstResponse] = internal || ticket.firstResponseAt
    ? []
    : await db.update(ticketsTable).set({ updatedAt: firstResponseAt, firstResponseAt })
      .where(and(eq(ticketsTable.id, ticketId), isNull(ticketsTable.firstResponseAt)))
      .returning({ id: ticketsTable.id });
  if (firstResponse) {
    await db.insert(auditLogsTable).values({
      userId: res.locals.user?.id ?? null,
      username: res.locals.user?.username ?? "sistema",
      clientId: ticket.clientId,
      equipmentId: ticket.equipmentId,
      entity: "Ticket",
      action: "FIRST_RESPONSE",
      commandSent: "POST /tickets/:id/comments",
      result: "Success",
      details: `Primera respuesta registrada para el ticket #${ticket.id}`,
      sourceIp: req.ip,
      device: req.get("user-agent"),
      beforeState: JSON.stringify({ firstResponseAt: null }),
      afterState: JSON.stringify({ firstResponseAt: firstResponseAt.toISOString() }),
    });
  } else {
    await db.update(ticketsTable).set({ updatedAt: new Date() }).where(eq(ticketsTable.id, ticketId));
  }
  await notifyTicketComment({
    ticket,
    actor: {
      type: "user",
      userId: res.locals.user?.id,
      name: res.locals.user?.username,
    },
    internal,
  });
  res.status(201).json(AddSupportTicketCommentResponse.parse(serializeDates(comment)));
});

router.get("/tickets/:id/history", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const [ticket] = await db.select({ id: ticketsTable.id }).from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const history = await db.select().from(ticketStatusHistoryTable)
    .where(eq(ticketStatusHistoryTable.ticketId, ticketId))
    .orderBy(ticketStatusHistoryTable.createdAt);
  res.json(ListSupportTicketHistoryResponse.parse(history.map(serializeDates)));
});

router.get("/tickets/:id/attachments", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  if (!ticketId) { res.status(400).json({ error: "Ticket inválido" }); return; }
  const [ticket] = await db.select({ id: ticketsTable.id }).from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  const attachments = await db.select({
    id: ticketAttachmentsTable.id,
    ticketId: ticketAttachmentsTable.ticketId,
    fileName: ticketAttachmentsTable.fileName,
    mimeType: ticketAttachmentsTable.mimeType,
    sizeBytes: ticketAttachmentsTable.sizeBytes,
    visibleToClient: ticketAttachmentsTable.visibleToClient,
    createdAt: ticketAttachmentsTable.createdAt,
  }).from(ticketAttachmentsTable)
    .where(eq(ticketAttachmentsTable.ticketId, ticketId))
    .orderBy(ticketAttachmentsTable.createdAt);
  res.json(ListSupportTicketAttachmentsResponse.parse(attachments.map(serializeDates)));
});

router.post("/tickets/:id/attachments", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const input = UploadSupportTicketAttachmentBody.safeParse(req.body);
  if (!ticketId || !input.success) { res.status(400).json({ error: "Ticket o archivo inválido" }); return; }
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
  let attachment: Awaited<ReturnType<typeof createTicketAttachment>>;
  try {
    attachment = await createTicketAttachment({
      ticketId,
      fileName: input.data.fileName,
      mimeType: input.data.mimeType,
      dataBase64: input.data.dataBase64,
      visibleToClient: input.data.visibleToClient ?? false,
      uploadedByUserId: res.locals.user?.id ?? null,
    });
  } catch (error) {
    if (error instanceof TicketAttachmentStorageNotConfiguredError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!attachment) { res.status(400).json({ error: "Archivo inválido, no compatible o mayor a 2 MiB" }); return; }
  const now = new Date();
  await db.update(ticketsTable).set({ updatedAt: now }).where(eq(ticketsTable.id, ticketId));
  await db.insert(auditLogsTable).values({
    userId: res.locals.user?.id ?? null,
    username: res.locals.user?.username ?? "sistema",
    clientId: ticket.clientId,
    equipmentId: ticket.equipmentId,
    entity: "Ticket attachment",
    action: "UPLOAD",
    commandSent: "POST /tickets/:id/attachments",
    result: "Success",
    details: `Evidencia ${attachment.fileName} añadida al ticket #${ticketId}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
    afterState: JSON.stringify({
      attachmentId: attachment.id,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      visibleToClient: attachment.visibleToClient,
      sha256: attachment.sha256,
    }),
  });
  if (attachment.visibleToClient && ticket.clientId !== null) {
    await db.insert(supportNotificationsTable).values({
      ticketId,
      clientId: ticket.clientId,
      title: `Nueva evidencia en el ticket #${ticketId}`,
      message: `Soporte añadió ${attachment.fileName}.`,
    });
  }
  res.status(201).json(UploadSupportTicketAttachmentResponse.parse({
    ...attachment,
    createdAt: attachment.createdAt.toISOString(),
  }));
});

router.get("/tickets/:id/attachments/:attachmentId/download", async (req, res): Promise<void> => {
  const ticketId = asId(req.params.id);
  const attachmentId = asId(req.params.attachmentId);
  if (!ticketId || !attachmentId) { res.status(400).json({ error: "Ticket o archivo inválido" }); return; }
  const [attachment] = await db.select().from(ticketAttachmentsTable).where(and(
    eq(ticketAttachmentsTable.id, attachmentId),
    eq(ticketAttachmentsTable.ticketId, ticketId),
  ));
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
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

router.patch("/tickets/sla-policies/:priority", async (req, res): Promise<void> => {
  const priority = text(req.params.priority, 20);
  const input = UpdateTicketSlaPolicyBody.safeParse(req.body);
  if (!priority || !ticketPriorities.includes(priority as typeof ticketPriorities[number]) || !input.success) {
    res.status(400).json({ error: "Prioridad o política SLA inválida" });
    return;
  }
  const [before] = await db.select().from(ticketSlaPoliciesTable)
    .where(eq(ticketSlaPoliciesTable.priority, priority));
  const [policy] = await db.insert(ticketSlaPoliciesTable).values({
    priority,
    firstResponseMinutes: input.data.firstResponseMinutes,
    resolutionMinutes: input.data.resolutionMinutes,
    updatedByUserId: res.locals.user?.id ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: ticketSlaPoliciesTable.priority,
    set: {
      firstResponseMinutes: input.data.firstResponseMinutes,
      resolutionMinutes: input.data.resolutionMinutes,
      updatedByUserId: res.locals.user?.id ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  await db.insert(auditLogsTable).values({
    userId: res.locals.user?.id ?? null,
    username: res.locals.user?.username ?? "sistema",
    entity: "Ticket SLA",
    action: "UPDATE",
    commandSent: "PATCH /tickets/sla-policies/:priority",
    result: "Success",
    details: `Objetivos de SLA actualizados para prioridad ${priority}`,
    sourceIp: req.ip,
    device: req.get("user-agent"),
    beforeState: before ? JSON.stringify({
      firstResponseMinutes: before.firstResponseMinutes,
      resolutionMinutes: before.resolutionMinutes,
    }) : null,
    afterState: JSON.stringify({
      firstResponseMinutes: policy.firstResponseMinutes,
      resolutionMinutes: policy.resolutionMinutes,
    }),
    reason: "Cambio de configuración SLA",
  });
  res.json(UpdateTicketSlaPolicyResponse.parse(serializeDates(policy)));
});

router.get("/notifications", async (_req, res): Promise<void> => {
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Usuario no autenticado" }); return; }
  const notifications = await db.select().from(supportNotificationsTable)
    .where(eq(supportNotificationsTable.userId, userId))
    .orderBy(desc(supportNotificationsTable.createdAt))
    .limit(50);
  res.json(ListUserNotificationsResponse.parse(notifications.map(serializeDates)));
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const notificationId = asId(req.params.id);
  const userId = res.locals.user?.id;
  if (!notificationId || !userId) { res.status(400).json({ error: "Notificación inválida" }); return; }
  const [notification] = await db.update(supportNotificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(supportNotificationsTable.id, notificationId),
      eq(supportNotificationsTable.userId, userId),
    ))
    .returning({ id: supportNotificationsTable.id });
  if (!notification) { res.status(404).json({ error: "Notificación no encontrada" }); return; }
  res.status(204).end();
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

async function workOrderScheduleConflict(
  technicianUserId: number,
  startsAt: Date,
  endsAt: Date,
  excludedOrderId?: number,
): Promise<{ status: 404 | 409; message: string } | null> {
  const [technician] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, technicianUserId));
  if (!technician) return { status: 404, message: "Usuario asignable no encontrado" };

  const availability = await db.select().from(technicianAvailabilityTable)
    .where(eq(technicianAvailabilityTable.technicianUserId, technicianUserId));
  if (!availability.some(block => containsScheduleRange(block.startsAt, block.endsAt, startsAt, endsAt))) {
    return { status: 409, message: "El horario debe quedar dentro de un bloque disponible del técnico" };
  }

  const orders = await db.select().from(fieldWorkOrdersTable)
    .where(eq(fieldWorkOrdersTable.assignedToUserId, technicianUserId));
  const activeStatuses = new Set(["completed", "cancelled", "closed"]);
  const conflicts = orders.some(order =>
    order.id !== excludedOrderId
    && !activeStatuses.has(order.status.toLowerCase())
    && order.scheduledAt !== null
    && scheduledOrderConflicts(startsAt, endsAt, order.scheduledAt, order.scheduledEndAt),
  );
  return conflicts ? { status: 409, message: "El técnico ya tiene una orden en ese horario" } : null;
}

router.get("/work-orders/mine", async (_req, res): Promise<void> => {
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Sesión requerida" }); return; }

  const rows = await db.select({
    order: fieldWorkOrdersTable,
    clientName: clientsTable.name,
    clientInstallationAddress: clientsTable.installationAddress,
  }).from(fieldWorkOrdersTable)
    .leftJoin(clientsTable, eq(clientsTable.id, fieldWorkOrdersTable.clientId))
    .where(eq(fieldWorkOrdersTable.assignedToUserId, userId))
    .orderBy(asc(fieldWorkOrdersTable.scheduledAt), asc(fieldWorkOrdersTable.createdAt));

  const response = rows.map(({ order, clientName, clientInstallationAddress }) => ({
    ...serializeDates(order),
    clientName,
    clientInstallationAddress,
  }));
  res.json(ListFieldWorkOrdersResponse.parse(response));
});

router.get("/work-orders/mine/:id/alignment", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Identificador de orden inválido" }); return; }
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Sesión requerida" }); return; }

  const alignment = await buildMyFieldWorkOrderAlignment(id, userId);
  if (!alignment) {
    res.status(404).json({ error: "Orden no asignada o sin cliente asociado" });
    return;
  }
  res.json(alignment);
});

router.post("/work-orders/mine/:id/alignment/radio-gps", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Identificador de orden inválido" }); return; }
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Sesión requerida" }); return; }

  const context = await loadMyAlignmentContext(id, userId);
  if (!context) {
    res.status(404).json({ error: "Orden no asignada o sin cliente asociado" });
    return;
  }
  const association = await resolveAssociatedAccessPoint(context);

  const readings = new Map<number, ReturnType<typeof getMikroTikGps>>();
  const read = (device: AlignmentEquipment | undefined) => {
    if (!device) {
      return Promise.resolve({
        supported: false,
        position: null,
        message: "No hay un radio asociado en NMS.",
      });
    }
    const cached = readings.get(device.id);
    if (cached) return cached;
    const result = device.connectionType === "mikrotik_routeros"
      ? getMikroTikGps(device.ip, device.username, device.password)
      : device.connectionType === "ubiquiti_airos"
        ? getUbiquitiRadioGps(device.ip, device.username, device.password)
        : Promise.resolve({
          supported: false,
          position: null,
          message: "Este protocolo no tiene lectura GPS compatible.",
        });
    readings.set(device.id, result);
    return result;
  };
  const [clientRadio, accessPoint] = await Promise.all([
    read(context.clientRadio),
    association.selected
      ? read(association.selected)
      : Promise.resolve({
        supported: false,
        position: null,
        message: association.status === "ambiguous"
          ? "Hay varias asociaciones activas; el AP no se confirmó de forma única."
          : "No se encontró una asociación activa con un AP / Repartidor.",
      }),
  ]);
  res.json(ReadMyFieldWorkOrderRadioGpsResponse.parse({ clientRadio, accessPoint }));
});

router.patch("/work-orders/mine/:id/alignment", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Identificador de orden inválido" }); return; }
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Sesión requerida" }); return; }

  const input = SaveMyFieldWorkOrderAlignmentBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const { clientRadioLocation, accessPointLocation } = input.data;
  if (!clientRadioLocation && !accessPointLocation) {
    res.status(400).json({ error: "Incluye al menos una ubicación para guardar" });
    return;
  }

  const context = await loadMyAlignmentContext(id, userId);
  if (!context) {
    res.status(404).json({ error: "Orden no asignada o sin cliente asociado" });
    return;
  }
  const association = accessPointLocation
    ? await resolveAssociatedAccessPoint(context, true)
    : null;
  if (accessPointLocation && !association?.selected) {
    res.status(409).json({
      error: association?.status === "ambiguous"
        ? "Hay varias asociaciones activas. Actualiza la asociación del cliente en NMS antes de guardar el AP."
        : "No se detectó una asociación activa con un AP / Repartidor. No se guardaron coordenadas del AP.",
    });
    return;
  }
  const activeAccessPointId = association?.selected?.id;

  const result = await db.transaction(async tx => {
    const [order] = await tx.select({
      clientId: fieldWorkOrdersTable.clientId,
    }).from(fieldWorkOrdersTable)
      .where(and(
        eq(fieldWorkOrdersTable.id, id),
        eq(fieldWorkOrdersTable.assignedToUserId, userId),
      ))
      .for("update");
    if (!order?.clientId) return { kind: "not_found" as const };
    if (order.clientId !== context.client.id) return { kind: "not_found" as const };

    const [client] = await tx.select({
      equipmentId: clientsTable.equipmentId,
    }).from(clientsTable)
      .where(eq(clientsTable.id, order.clientId))
      .for("update");
    if (!client) return { kind: "not_found" as const };
    if (
      clientRadioLocation
      && (!client.equipmentId || client.equipmentId <= 0)
    ) return { kind: "radio_missing" as const };
    if (
      accessPointLocation
      && (!activeAccessPointId || activeAccessPointId <= 0)
    ) return { kind: "ap_missing" as const };

    if (accessPointLocation && client.equipmentId === activeAccessPointId) {
      return { kind: "duplicate_equipment" as const };
    }

    if (accessPointLocation && activeAccessPointId) {
      const [activeAccessPoint] = await tx.select({
        id: equipmentTable.id,
      }).from(equipmentTable)
        .where(and(
          eq(equipmentTable.id, activeAccessPointId),
          eq(equipmentTable.equipmentRole, "ap_distributor"),
        ))
        .for("update");
      if (!activeAccessPoint) return { kind: "ap_missing" as const };
    }

    if (clientRadioLocation) {
      await tx.update(equipmentTable).set({
        latitude: String(clientRadioLocation.latitude),
        longitude: String(clientRadioLocation.longitude),
        altitudeMeters: clientRadioLocation.altitudeMeters === null
          ? null
          : String(clientRadioLocation.altitudeMeters),
        locationSource: clientRadioLocation.source,
        locationAccuracyMeters: clientRadioLocation.accuracyMeters === null
          ? null
          : String(clientRadioLocation.accuracyMeters),
      }).where(eq(equipmentTable.id, client.equipmentId));
    }
    if (accessPointLocation && activeAccessPointId) {
      await tx.update(equipmentTable).set({
        latitude: String(accessPointLocation.latitude),
        longitude: String(accessPointLocation.longitude),
        altitudeMeters: accessPointLocation.altitudeMeters === null
          ? null
          : String(accessPointLocation.altitudeMeters),
        locationSource: accessPointLocation.source,
        locationAccuracyMeters: accessPointLocation.accuracyMeters === null
          ? null
          : String(accessPointLocation.accuracyMeters),
      }).where(eq(equipmentTable.id, activeAccessPointId));
    }
    return { kind: "saved" as const };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Orden no asignada o sin cliente asociado" });
    return;
  }
  if (result.kind === "radio_missing" || result.kind === "ap_missing") {
    res.status(400).json({ error: "El equipo que intentas actualizar no está asociado al cliente en NMS" });
    return;
  }
  if (result.kind === "duplicate_equipment") {
    res.status(400).json({ error: "La radio del cliente y el AP apuntan al mismo equipo; verifica la asociación en NMS" });
    return;
  }

  await audit(res.locals.user, "Equipment", "UPDATE", `Coordenadas de alineación actualizadas desde orden #${id}`);
  const alignment = await buildMyFieldWorkOrderAlignment(id, userId);
  if (!alignment) {
    res.status(404).json({ error: "Orden no asignada o sin cliente asociado" });
    return;
  }
  res.json(alignment);
});

router.patch("/work-orders/mine/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Identificador de orden inválido" }); return; }
  const userId = res.locals.user?.id;
  if (!userId) { res.status(401).json({ error: "Sesión requerida" }); return; }

  const input = UpdateMyFieldWorkOrderBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }

  const signatureData = input.data.signatureData === undefined
    ? undefined
    : normalizeFieldSignatureData(input.data.signatureData);
  if (input.data.signatureData !== undefined && !signatureData) {
    res.status(400).json({ error: "La firma no tiene un formato válido" });
    return;
  }

  const hasVisitReport = input.data.address !== undefined
    || input.data.signalDbm !== undefined
    || input.data.ccq !== undefined
    || input.data.installedEquipment !== undefined
    || input.data.installedSerialNumber !== undefined
    || input.data.signatureData !== undefined;
  if (input.data.status === "in_progress" && hasVisitReport) {
    res.status(400).json({ error: "Las mediciones y el equipo se registran al completar la visita" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: fieldWorkOrdersTable.id,
      clientId: fieldWorkOrdersTable.clientId,
      assignedToUserId: fieldWorkOrdersTable.assignedToUserId,
      type: fieldWorkOrdersTable.type,
      status: fieldWorkOrdersTable.status,
      address: fieldWorkOrdersTable.address,
    }).from(fieldWorkOrdersTable)
      .where(eq(fieldWorkOrdersTable.id, id))
      .for("update");

    // Hide both missing and unassigned orders so the mobile endpoint cannot be
    // used to probe another technician's work.
    if (!current || current.assignedToUserId !== userId) {
      return { kind: "not_found" as const };
    }

    const currentStatus = current.status.toLowerCase();
    if (["completed", "closed", "cancelled", "canceled"].includes(currentStatus)) {
      return { kind: "conflict" as const, message: "La orden ya está cerrada" };
    }
    if (input.data.status === "completed" && currentStatus !== "in_progress") {
      return { kind: "conflict" as const, message: "Inicia la visita antes de completarla" };
    }
    if (
      input.data.status === "completed"
      && current.type.toLowerCase() === "installation"
      && !signatureData
    ) {
      return {
        kind: "invalid" as const,
        message: "La orden de instalación requiere la firma de conformidad del cliente",
      };
    }

    const isRelocation = current.type.toLowerCase() === "relocation";
    if (input.data.address !== undefined && (!isRelocation || input.data.status !== "completed")) {
      return {
        kind: "invalid" as const,
        message: "La dirección solo se puede actualizar al completar una reubicación",
      };
    }

    const destination = input.data.address !== undefined
      ? input.data.address?.trim() ?? ""
      : current.address?.trim() ?? "";
    if (input.data.status === "completed" && isRelocation && !destination) {
      return { kind: "invalid" as const, message: "La reubicación requiere una dirección nueva" };
    }
    if (input.data.status === "completed" && isRelocation && !current.clientId) {
      return { kind: "invalid" as const, message: "La orden de reubicación no tiene un cliente asociado" };
    }

    const update: Record<string, unknown> = {
      status: input.data.status,
      updatedAt: new Date(),
    };
    if (input.data.status === "completed") {
      update.completedAt = new Date();
      if (input.data.signalDbm !== undefined) update.signalDbm = input.data.signalDbm;
      if (input.data.ccq !== undefined) update.ccq = input.data.ccq;
      if (input.data.installedEquipment !== undefined) update.installedEquipment = input.data.installedEquipment;
      if (input.data.installedSerialNumber !== undefined) update.installedSerialNumber = input.data.installedSerialNumber;
      if (signatureData !== undefined) update.signatureData = signatureData;
      if (isRelocation) update.address = destination;
    }

    let previousAddress: string | null = null;
    if (input.data.status === "completed" && isRelocation && current.clientId) {
      const [client] = await tx.select({
        installationAddress: clientsTable.installationAddress,
      }).from(clientsTable)
        .where(eq(clientsTable.id, current.clientId))
        .for("update");
      if (!client) return { kind: "client_missing" as const };
      previousAddress = client.installationAddress;
    }

    const [order] = await tx.update(fieldWorkOrdersTable)
      .set(update)
      .where(eq(fieldWorkOrdersTable.id, id))
      .returning();
    if (!order) return { kind: "not_found" as const };

    if (
      input.data.status === "completed"
      && isRelocation
      && current.clientId
      && previousAddress !== destination
    ) {
      await tx.update(clientsTable)
        .set({ installationAddress: destination })
        .where(eq(clientsTable.id, current.clientId));
      await tx.insert(clientChangeHistoryTable).values({
        clientId: current.clientId,
        changedByUserId: userId,
        changeType: "UPDATED",
        reason: `Reubicación confirmada mediante orden de campo #${id}`,
        previousData: { installationAddress: previousAddress },
        newData: {
          installationAddress: destination,
          fieldWorkOrderId: id,
          completedAt: new Date().toISOString(),
        },
      });
    }

    return { kind: "updated" as const, order };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Orden no asignada al usuario autenticado" });
    return;
  }
  if (result.kind === "client_missing") {
    res.status(404).json({ error: "Cliente de reubicación no encontrado" });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: result.message });
    return;
  }
  if (result.kind === "invalid") {
    res.status(400).json({ error: result.message });
    return;
  }

  await audit(res.locals.user, "FieldWorkOrder", "UPDATE", `Orden móvil #${id}: ${input.data.status}`);
  const responseOrder = ListFieldWorkOrdersResponse.parse([serializeDates(result.order)])[0];
  res.json(responseOrder);
});

router.get("/work-orders", async (req, res): Promise<void> => {
  const status = text(req.query.status, 32);
  const rows = await db.select().from(fieldWorkOrdersTable)
    .where(status ? eq(fieldWorkOrdersTable.status, status) : undefined)
    .orderBy(desc(fieldWorkOrdersTable.scheduledAt), desc(fieldWorkOrdersTable.createdAt));
  res.json(ListFieldWorkOrdersResponse.parse(rows.map(serializeDates)));
});

router.post("/work-orders", async (req, res): Promise<void> => {
  const input = CreateFieldWorkOrderBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const isRelocation = (input.data.type ?? "installation").toLowerCase() === "relocation";
  if (isRelocation) {
    if (input.data.clientId == null || !input.data.address?.trim()) {
      res.status(400).json({ error: "La reubicación requiere un cliente y una dirección nueva" });
      return;
    }
    if (["completed", "closed"].includes((input.data.status ?? "pending").toLowerCase())) {
      res.status(400).json({ error: "Crea la orden de reubicación pendiente y complétala desde la agenda" });
      return;
    }
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(eq(clientsTable.id, input.data.clientId));
    if (!client) { res.status(404).json({ error: "Cliente de reubicación no encontrado" }); return; }
  }
  const assignedToUserId = input.data.assignedToUserId ?? null;
  const scheduledAt = input.data.scheduledAt ? new Date(input.data.scheduledAt) : null;
  const scheduledEndAt = input.data.scheduledEndAt ? new Date(input.data.scheduledEndAt) : null;
  if ((scheduledAt === null) !== (scheduledEndAt === null)) {
    res.status(400).json({ error: "La hora de inicio y de fin deben enviarse juntas" });
    return;
  }
  if (scheduledAt && scheduledEndAt && !isValidScheduleRange(scheduledAt, scheduledEndAt)) {
    res.status(400).json({ error: "La hora de fin debe ser posterior a la de inicio" });
    return;
  }
  if (assignedToUserId !== null && scheduledAt && scheduledEndAt) {
    const conflict = await workOrderScheduleConflict(assignedToUserId, scheduledAt, scheduledEndAt);
    if (conflict) { res.status(conflict.status).json({ error: conflict.message }); return; }
  } else if (assignedToUserId !== null) {
    const [technician] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, assignedToUserId));
    if (!technician) { res.status(404).json({ error: "Usuario asignable no encontrado" }); return; }
  }

  const [order] = await db.insert(fieldWorkOrdersTable).values({
    clientId: input.data.clientId ?? null,
    siteId: input.data.siteId ?? null,
    assignedToUserId,
    type: input.data.type ?? "installation",
    status: input.data.status ?? "pending",
    scheduledAt,
    scheduledEndAt,
    address: input.data.address ?? null,
    latitude: input.data.latitude ?? null,
    longitude: input.data.longitude ?? null,
    notes: input.data.notes ?? null,
    materials: input.data.materials ?? [],
    measuredPower: input.data.measuredPower ?? null,
    signalDbm: input.data.signalDbm ?? null,
    ccq: input.data.ccq ?? null,
    installedEquipment: input.data.installedEquipment ?? null,
    installedSerialNumber: input.data.installedSerialNumber ?? null,
    completedAt: ["completed", "closed"].includes((input.data.status ?? "pending").toLowerCase()) ? new Date() : null,
  }).returning();
  await audit(res.locals.user, "FieldWorkOrder", "CREATE", `Orden de campo #${order.id}`);
  res.status(201).json(CreateFieldWorkOrderResponse.parse(serializeDates(order)));
});

router.patch("/work-orders/:id", async (req, res): Promise<void> => {
  const params = UpdateFieldWorkOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const input = UpdateFieldWorkOrderBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const [current] = await db.select().from(fieldWorkOrdersTable)
    .where(eq(fieldWorkOrdersTable.id, params.data.id));
  if (!current) { res.status(404).json({ error: "Orden no encontrada" }); return; }

  const assignedToUserId = input.data.assignedToUserId !== undefined
    ? input.data.assignedToUserId
    : current.assignedToUserId;
  const scheduledAt = input.data.scheduledAt !== undefined
    ? input.data.scheduledAt ? new Date(input.data.scheduledAt) : null
    : current.scheduledAt;
  const scheduledEndAt = input.data.scheduledEndAt !== undefined
    ? input.data.scheduledEndAt ? new Date(input.data.scheduledEndAt) : null
    : current.scheduledEndAt;
  const scheduleChanged = input.data.assignedToUserId !== undefined
    || input.data.scheduledAt !== undefined
    || input.data.scheduledEndAt !== undefined;
  if (scheduleChanged && (scheduledAt === null) !== (scheduledEndAt === null)) {
    res.status(400).json({ error: "La hora de inicio y de fin deben enviarse juntas" });
    return;
  }
  if (scheduleChanged && scheduledAt && scheduledEndAt && !isValidScheduleRange(scheduledAt, scheduledEndAt)) {
    res.status(400).json({ error: "La hora de fin debe ser posterior a la de inicio" });
    return;
  }

  if (assignedToUserId !== null && scheduleChanged) {
    if (scheduledAt && scheduledEndAt) {
      const conflict = await workOrderScheduleConflict(
        assignedToUserId,
        scheduledAt,
        scheduledEndAt,
        params.data.id,
      );
      if (conflict) { res.status(conflict.status).json({ error: conflict.message }); return; }
    } else {
      const [technician] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.id, assignedToUserId));
      if (!technician) { res.status(404).json({ error: "Usuario asignable no encontrado" }); return; }
    }
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  const isRelocationCompletion = current.type.toLowerCase() === "relocation"
    && ["completed", "closed"].includes(input.data.status?.toLowerCase() ?? "")
    && !["completed", "closed", "cancelled", "canceled"].includes(current.status.toLowerCase());
  const relocationClientId = current.clientId;
  const relocationDestination = input.data.address !== undefined
    ? input.data.address?.trim() ?? ""
    : current.address?.trim() ?? "";
  if (isRelocationCompletion) {
    if (!relocationClientId) {
      res.status(400).json({ error: "La orden de reubicación no tiene un cliente asociado" });
      return;
    }
    if (input.data.clientId !== undefined && input.data.clientId !== relocationClientId) {
      res.status(400).json({ error: "No se puede cambiar el cliente durante la finalización de una reubicación" });
      return;
    }
    if (input.data.type !== undefined && input.data.type.toLowerCase() !== "relocation") {
      res.status(400).json({ error: "No se puede cambiar el tipo de orden al finalizar una reubicación" });
      return;
    }
    if (!relocationDestination) {
      res.status(400).json({ error: "La reubicación requiere una dirección nueva" });
      return;
    }
  }

  for (const key of ["status", "type", "address", "notes"] as const) {
    if (input.data[key] !== undefined) update[key] = input.data[key];
  }
  if (isRelocationCompletion) update.address = relocationDestination;
  for (const key of ["clientId", "siteId", "assignedToUserId"] as const) {
    if (input.data[key] !== undefined) update[key] = input.data[key];
  }
  if (input.data.scheduledAt !== undefined) update.scheduledAt = scheduledAt;
  if (input.data.scheduledEndAt !== undefined) update.scheduledEndAt = scheduledEndAt;
  if (input.data.latitude !== undefined) update.latitude = input.data.latitude;
  if (input.data.longitude !== undefined) update.longitude = input.data.longitude;
  if (input.data.measuredPower !== undefined) update.measuredPower = input.data.measuredPower;
  if (input.data.signalDbm !== undefined) update.signalDbm = input.data.signalDbm;
  if (input.data.ccq !== undefined) update.ccq = input.data.ccq;
  if (input.data.installedEquipment !== undefined) update.installedEquipment = input.data.installedEquipment;
  if (input.data.installedSerialNumber !== undefined) update.installedSerialNumber = input.data.installedSerialNumber;
  if (input.data.materials !== undefined) update.materials = input.data.materials;
  if (input.data.status && ["completed", "closed"].includes(input.data.status.toLowerCase()) && !current.completedAt) {
    update.completedAt = new Date();
  }
  const result = await db.transaction(async (tx) => {
    const [lockedOrder] = await tx.select({
      id: fieldWorkOrdersTable.id,
      clientId: fieldWorkOrdersTable.clientId,
      type: fieldWorkOrdersTable.type,
      status: fieldWorkOrdersTable.status,
    }).from(fieldWorkOrdersTable)
      .where(eq(fieldWorkOrdersTable.id, params.data.id))
      .for("update");
    if (!lockedOrder) return { kind: "order_missing" as const };
    if (isRelocationCompletion && (
      lockedOrder.clientId !== relocationClientId
      || lockedOrder.type.toLowerCase() !== "relocation"
      || ["completed", "closed", "cancelled", "canceled"].includes(lockedOrder.status.toLowerCase())
    )) {
      return { kind: "order_changed" as const };
    }

    let previousAddress: string | null = null;
    if (isRelocationCompletion && relocationClientId) {
      const [client] = await tx.select({
        installationAddress: clientsTable.installationAddress,
      }).from(clientsTable)
        .where(eq(clientsTable.id, relocationClientId))
        .for("update");
      if (!client) return { kind: "client_missing" as const };
      previousAddress = client.installationAddress;
    }

    const [order] = await tx.update(fieldWorkOrdersTable).set(update)
      .where(eq(fieldWorkOrdersTable.id, params.data.id)).returning();
    if (!order) return { kind: "order_missing" as const };

    if (isRelocationCompletion && relocationClientId && previousAddress !== relocationDestination) {
      await tx.update(clientsTable)
        .set({ installationAddress: relocationDestination })
        .where(eq(clientsTable.id, relocationClientId));
      await tx.insert(clientChangeHistoryTable).values({
        clientId: relocationClientId,
        changedByUserId: res.locals.user?.id ?? null,
        changeType: "UPDATED",
        reason: `Reubicación confirmada mediante orden de campo #${params.data.id}`,
        previousData: { installationAddress: previousAddress },
        newData: {
          installationAddress: relocationDestination,
          fieldWorkOrderId: params.data.id,
          completedAt: new Date().toISOString(),
        },
      });
    }
    return { kind: "updated" as const, order };
  });
  if (result.kind === "order_missing") { res.status(404).json({ error: "Orden no encontrada" }); return; }
  if (result.kind === "client_missing") { res.status(404).json({ error: "Cliente de reubicación no encontrado" }); return; }
  if (result.kind === "order_changed") {
    res.status(409).json({ error: "La orden cambió mientras se completaba; actualiza la agenda e inténtalo de nuevo" });
    return;
  }
  const order = result.order;
  await audit(res.locals.user, "FieldWorkOrder", "UPDATE", `Orden de campo #${params.data.id} actualizada`);
  res.json(UpdateFieldWorkOrderResponse.parse(serializeDates(order)));
});

router.get("/technicians/availability", async (_req, res): Promise<void> => {
  const rows = await db.select().from(technicianAvailabilityTable)
    .orderBy(asc(technicianAvailabilityTable.startsAt), asc(technicianAvailabilityTable.id));
  res.json(ListTechnicianAvailabilityResponse.parse(rows.map(serializeDates)));
});

router.post("/technicians/availability", async (req, res): Promise<void> => {
  const input = CreateTechnicianAvailabilityBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const startsAt = new Date(input.data.startsAt);
  const endsAt = new Date(input.data.endsAt);
  if (!isValidScheduleRange(startsAt, endsAt)) {
    res.status(400).json({ error: "La hora de fin debe ser posterior a la de inicio" });
    return;
  }
  const [technician] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, input.data.technicianUserId));
  if (!technician) { res.status(404).json({ error: "Usuario asignable no encontrado" }); return; }

  const existing = await db.select().from(technicianAvailabilityTable)
    .where(eq(technicianAvailabilityTable.technicianUserId, input.data.technicianUserId));
  if (existing.some(block => scheduleRangesOverlap(startsAt, endsAt, block.startsAt, block.endsAt))) {
    res.status(409).json({ error: "El bloque se solapa con otra disponibilidad del técnico" });
    return;
  }
  const [block] = await db.insert(technicianAvailabilityTable).values({
    technicianUserId: input.data.technicianUserId,
    startsAt,
    endsAt,
    notes: input.data.notes ?? null,
    createdByUserId: res.locals.user?.id ?? null,
  }).returning();
  await audit(res.locals.user, "TechnicianAvailability", "CREATE", `Disponibilidad añadida para usuario #${block.technicianUserId}`);
  res.status(201).json(CreateTechnicianAvailabilityResponse.parse(serializeDates(block)));
});

router.delete("/technicians/availability/:id", async (req, res): Promise<void> => {
  const params = DeleteTechnicianAvailabilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [block] = await db.select().from(technicianAvailabilityTable)
    .where(eq(technicianAvailabilityTable.id, params.data.id));
  if (!block) { res.status(404).json({ error: "Bloque de disponibilidad no encontrado" }); return; }

  const orders = await db.select().from(fieldWorkOrdersTable)
    .where(eq(fieldWorkOrdersTable.assignedToUserId, block.technicianUserId));
  const terminalStatuses = new Set(["completed", "cancelled", "closed"]);
  const scheduledOrder = orders.some(order =>
    !terminalStatuses.has(order.status.toLowerCase())
    && order.scheduledAt !== null
    && scheduledOrderConflicts(block.startsAt, block.endsAt, order.scheduledAt, order.scheduledEndAt),
  );
  if (scheduledOrder) {
    res.status(409).json({ error: "No se puede eliminar: hay órdenes activas en ese horario" });
    return;
  }
  await db.delete(technicianAvailabilityTable).where(eq(technicianAvailabilityTable.id, block.id));
  await audit(res.locals.user, "TechnicianAvailability", "DELETE", `Disponibilidad eliminada #${block.id}`);
  res.status(204).end();
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

router.get("/maintenance-notices", async (_req, res): Promise<void> => {
  const rows = await db.select().from(maintenanceNoticesTable)
    .orderBy(desc(maintenanceNoticesTable.startsAt));
  res.json(rows.map(serializeDates));
});

router.post("/maintenance-notices", async (req, res): Promise<void> => {
  const title = text(req.body?.title, 200);
  const message = text(req.body?.message);
  const startsAt = optionalDate(req.body?.startsAt);
  const endsAt = optionalDate(req.body?.endsAt);
  if (!title || !message || !(startsAt instanceof Date)) {
    res.status(400).json({ error: "title, message y startsAt son obligatorios y válidos" });
    return;
  }
  if (endsAt === undefined || (endsAt instanceof Date && endsAt <= startsAt)) {
    res.status(400).json({ error: "endsAt debe ser posterior a startsAt" });
    return;
  }
  const [notice] = await db.insert(maintenanceNoticesTable).values({
    title,
    message,
    startsAt,
    endsAt: endsAt ?? null,
    active: req.body?.active !== false,
    organizationId: asId(req.body?.organizationId),
    siteId: asId(req.body?.siteId),
    createdByUserId: res.locals.user?.id ?? null,
  }).returning();
  await audit(res.locals.user, "MaintenanceNotice", "CREATE", `Aviso ${title} creado`);
  res.status(201).json(serializeDates(notice));
});

router.patch("/maintenance-notices/:id", async (req, res): Promise<void> => {
  const id = asId(req.params.id);
  if (!id) { res.status(400).json({ error: "Aviso inválido" }); return; }
  const update: Record<string, unknown> = {};
  for (const key of ["title", "message"]) {
    if (req.body?.[key] !== undefined) {
      const value = text(req.body[key], key === "title" ? 200 : 4000);
      if (value) update[key] = value;
    }
  }
  for (const key of ["startsAt", "endsAt"]) {
    if (req.body?.[key] !== undefined) {
      const value = optionalDate(req.body[key]);
      if (value !== undefined) update[key] = value;
    }
  }
  if (typeof req.body?.active === "boolean") update.active = req.body.active;
  if (!Object.keys(update).length) { res.status(400).json({ error: "No hay cambios válidos" }); return; }
  const [notice] = await db.update(maintenanceNoticesTable).set(update)
    .where(eq(maintenanceNoticesTable.id, id)).returning();
  if (!notice) { res.status(404).json({ error: "Aviso no encontrado" }); return; }
  await audit(res.locals.user, "MaintenanceNotice", "UPDATE", `Aviso ${id} actualizado`);
  res.json(serializeDates(notice));
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
  res.json(ListTechniciansResponse.parse(rows));
});

export default router;