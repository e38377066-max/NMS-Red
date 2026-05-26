import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { nodesTable } from "./nodes";

export const equipmentTable = pgTable("equipment", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").notNull().references(() => nodesTable.id, { onDelete: "cascade" }),
  ip: text("ip").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  model: text("model").notNull(),
  lastSeenStatus: text("last_seen_status").notNull().default("UNKNOWN"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({ id: true, createdAt: true, lastCheckedAt: true, lastSeenStatus: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;
