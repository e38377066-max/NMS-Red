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
  // Connection protocol: mikrotik_routeros | ubiquiti_airos
  connectionType: text("connection_type").notNull().default("mikrotik_routeros"),
  // Functional role in the network topology
  equipmentRole: text("equipment_role").notNull().default("ap_distributor"),
  // Optional: SNMP community string for Ubiquiti/SNMP polling
  snmpCommunity: text("snmp_community"),
  // Optional: API port override (MikroTik REST default 80, RouterOS API 8728)
  apiPort: integer("api_port"),
  lastSeenStatus: text("last_seen_status").notNull().default("UNKNOWN"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  lastSeenStatus: true,
});
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;
