import { pgTable, serial, text, timestamp, integer, numeric, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
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
  // Optional MikroTik parent in the routed hierarchy
  parentEquipmentId: integer("parent_equipment_id").references(
    (): AnyPgColumn => equipmentTable.id,
    { onDelete: "set null" },
  ),
  // Capacity reserved for this child on its parent, in RouterOS max-limit format (e.g. 100M/100M)
  parentCapacityLimit: text("parent_capacity_limit"),
  // Optional: SNMP community string for Ubiquiti/SNMP polling
  snmpCommunity: text("snmp_community"),
  // Optional: API port override (MikroTik REST default 80, RouterOS API 8728)
  apiPort: integer("api_port"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  altitudeMeters: numeric("altitude_meters", { precision: 8, scale: 2 }),
  locationSource: text("location_source"),
  locationAccuracyMeters: numeric("location_accuracy_meters", { precision: 8, scale: 2 }),
  lastSeenStatus: text("last_seen_status").notNull().default("UNKNOWN"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  check("equipment_latitude_range", sql`${table.latitude} is null or ${table.latitude} between -90 and 90`),
  check("equipment_longitude_range", sql`${table.longitude} is null or ${table.longitude} between -180 and 180`),
  check("equipment_altitude_range", sql`${table.altitudeMeters} is null or ${table.altitudeMeters} between -500 and 10000`),
  check("equipment_location_source", sql`${table.locationSource} is null or ${table.locationSource} in ('manual', 'external_gps', 'phone_gps', 'radio_gps', 'unknown')`),
  check("equipment_location_accuracy_range", sql`${table.locationAccuracyMeters} is null or ${table.locationAccuracyMeters} between 0 and 10000`),
]);

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  lastSeenStatus: true,
});
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;
