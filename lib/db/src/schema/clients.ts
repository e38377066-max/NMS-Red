import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { equipmentTable } from "./equipment";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
