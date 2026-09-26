import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, numeric, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { equipmentTable } from "./equipment";
import { usersTable } from "./users";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentTable.id, { onDelete: "cascade" }),
  mac: text("mac").notNull(),
  ip: text("ip"),
  name: text("name").notNull(),
  planLimit: text("plan_limit").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  lastSeenDbm: text("last_seen_dbm"),
  paymentStatus: text("payment_status").notNull().default("PAID"),
  monthlyFee: numeric("monthly_fee", { precision: 10, scale: 2 }).default("0"),
  dueDate: timestamp("due_date"),
  lastPaymentDate: timestamp("last_payment_date"),
  contractReference: text("contract_reference"),
  contractNotes: text("contract_notes"),
  installationDate: timestamp("installation_date"),
  installationAddress: text("installation_address"),
  assignedTechnicianId: integer("assigned_technician_id").references(() => usersTable.id, { onDelete: "set null" }),
  accessPointEquipmentId: integer("access_point_equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export const clientChangeHistoryTable = pgTable("client_change_history", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  changedByUserId: integer("changed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  changeType: text("change_type").notNull(),
  reason: text("reason"),
  previousData: jsonb("previous_data").$type<Record<string, unknown>>().notNull().default({}),
  newData: jsonb("new_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientContractsTable = pgTable("client_contracts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull().default("PENDING"),
  isCurrent: boolean("is_current").notNull().default(false),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewReason: text("review_reason"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => ({
  clientVersionUnique: uniqueIndex("client_contracts_client_version_idx").on(table.clientId, table.version),
  clientCurrentUnique: uniqueIndex("client_contracts_current_idx")
    .on(table.clientId)
    .where(sql`${table.isCurrent} = true`),
}));
