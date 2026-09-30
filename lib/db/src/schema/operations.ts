import {
  check,
  index,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "./clients";
import { equipmentTable } from "./equipment";
import { usersTable } from "./users";

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const servicePlansTable = pgTable("service_plans", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  downloadLimit: text("download_limit").notNull(),
  uploadLimit: text("upload_limit").notNull(),
  monthlyFee: numeric("monthly_fee", { precision: 12, scale: 2 }).notNull(),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientLifecycleEventsTable = pgTable("client_lifecycle_events", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  notes: text("notes"),
  technicianUserId: integer("technician_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  method: text("method").notNull(),
  reference: text("reference"),
  receiptNumber: text("receipt_number").notNull().unique(),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
  receivedByUserId: integer("received_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  idempotencyKeyUnique: uniqueIndex("payments_idempotency_key_idx").on(table.idempotencyKey),
}));

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  number: text("number").notNull().unique(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  dueDate: timestamp("due_date").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  surcharge: numeric("surcharge", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  balanceDue: numeric("balance_due", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("OPEN"),
  kind: text("kind").notNull().default("RECURRING"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const paymentProofsTable = pgTable("payment_proofs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  method: text("method").notNull(),
  reference: text("reference").notNull(),
  notes: text("notes"),
  originalName: text("original_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  storagePath: text("storage_path"),
  status: text("status").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  resubmissionOfId: integer("resubmission_of_id"),
  approvedPaymentId: integer("approved_payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
});

export const billingSettingsTable = pgTable("billing_settings", {
  id: serial("id").primaryKey(),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(3),
  graceDays: integer("grace_days").notNull().default(0),
  autoSuspend: boolean("auto_suspend").notNull().default(true),
  reminderEnabled: boolean("reminder_enabled").notNull().default(true),
  currency: text("currency").notNull().default("USD"),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cashClosuresTable = pgTable("cash_closures", {
  id: serial("id").primaryKey(),
  closureDate: timestamp("closure_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  cashTotal: numeric("cash_total", { precision: 12, scale: 2 }).notNull().default("0"),
  transferTotal: numeric("transfer_total", { precision: 12, scale: 2 }).notNull().default("0"),
  mobileTotal: numeric("mobile_total", { precision: 12, scale: 2 }).notNull().default("0"),
  otherTotal: numeric("other_total", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedTotal: numeric("expected_total", { precision: 12, scale: 2 }).notNull().default("0"),
  countedTotal: numeric("counted_total", { precision: 12, scale: 2 }).notNull(),
  difference: numeric("difference", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("CLOSED"),
  notes: text("notes"),
  closedByUserId: integer("closed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("other"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  rootCause: text("root_cause"),
  firstResponseAt: timestamp("first_response_at"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  closedByClient: boolean("closed_by_client").notNull().default(false),
  clientReopenEnabled: boolean("client_reopen_enabled").notNull().default(false),
  firstResponseDueAt: timestamp("first_response_due_at"),
  resolutionDueAt: timestamp("resolution_due_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ticketSlaPoliciesTable = pgTable("ticket_sla_policies", {
  priority: text("priority").primaryKey(),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  positiveTargets: check("ticket_sla_positive_targets", sql`${table.firstResponseMinutes} > 0 AND ${table.resolutionMinutes} > 0`),
}));

export const ticketStatusHistoryTable = pgTable("ticket_status_history", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorType: text("actor_type").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorClientId: integer("actor_client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ticketCreatedIdx: index("ticket_status_history_ticket_created_idx").on(table.ticketId, table.createdAt),
}));

export const ticketAttachmentsTable = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByClientId: integer("uploaded_by_client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  visibleToClient: boolean("visible_to_client").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ticketCreatedIdx: index("ticket_attachments_ticket_created_idx").on(table.ticketId, table.createdAt),
}));

export const supportNotificationsTable = pgTable("support_notifications", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  oneRecipient: check("support_notifications_one_recipient", sql`(${table.userId} IS NOT NULL) <> (${table.clientId} IS NOT NULL)`),
  userCreatedIdx: index("support_notifications_user_created_idx").on(table.userId, table.createdAt),
  clientCreatedIdx: index("support_notifications_client_created_idx").on(table.clientId, table.createdAt),
}));

export const ticketCommentsTable = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  internal: boolean("internal").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  sku: text("sku"),
  name: text("name").notNull(),
  category: text("category").notNull(),
  serialNumber: text("serial_number"),
  macAddress: text("mac_address"),
  status: text("status").notNull().default("in_stock"),
  supplier: text("supplier"),
  warrantyUntil: timestamp("warranty_until"),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const fieldWorkOrdersTable = pgTable("field_work_orders", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  type: text("type").notNull().default("installation"),
  status: text("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at"),
  scheduledEndAt: timestamp("scheduled_end_at"),
  address: text("address"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  notes: text("notes"),
  materials: jsonb("materials").$type<Array<Record<string, unknown>>>().notNull().default([]),
  measuredPower: numeric("measured_power", { precision: 8, scale: 2 }),
  signalDbm: real("signal_dbm"),
  ccq: real("ccq"),
  installedEquipment: text("installed_equipment"),
  installedSerialNumber: text("installed_serial_number"),
  signatureData: text("signature_data"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  signalDbmRange: check("field_work_orders_signal_dbm_range", sql`${table.signalDbm} IS NULL OR (${table.signalDbm} >= -120 AND ${table.signalDbm} <= 0)`),
  ccqRange: check("field_work_orders_ccq_range", sql`${table.ccq} IS NULL OR (${table.ccq} >= 0 AND ${table.ccq} <= 100)`),
}));

export const portalAccessTable = pgTable("portal_access", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique().references(() => clientsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const incidentAlertsTable = pgTable("incident_alerts", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  fingerprint: text("fingerprint").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("warning"),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at"),
  silencedUntil: timestamp("silenced_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const organizationMembershipsTable = pgTable("organization_memberships", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const maintenanceNoticesTable = pgTable("maintenance_notices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});