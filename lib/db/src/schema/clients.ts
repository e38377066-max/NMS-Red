import { pgTable, serial, text, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
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
