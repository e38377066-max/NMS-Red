import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
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
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  method: text("method").notNull(),
  reference: text("reference"),
  receiptNumber: text("receipt_number").notNull().unique(),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
  receivedByUserId: integer("received_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  address: text("address"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  notes: text("notes"),
  materials: jsonb("materials").$type<Array<Record<string, unknown>>>().notNull().default([]),
  measuredPower: numeric("measured_power", { precision: 8, scale: 2 }),
  signatureData: text("signature_data"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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