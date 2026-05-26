import { pgTable, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { equipmentTable } from "./equipment";
import { clientsTable } from "./clients";

export const metricHistoryTable = pgTable("metric_history", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  txMbps: numeric("tx_mbps", { precision: 8, scale: 3 }),
  rxMbps: numeric("rx_mbps", { precision: 8, scale: 3 }),
  signalDbm: numeric("signal_dbm", { precision: 6, scale: 1 }),
  ccq: numeric("ccq", { precision: 5, scale: 1 }),
});

export type MetricHistory = typeof metricHistoryTable.$inferSelect;
