import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: integer("user_id"),
  username: text("username"),
  equipmentId: integer("equipment_id"),
  clientId: integer("client_id"),
  entity: text("entity").notNull(),
  action: text("action").notNull(),
  commandSent: text("command_sent"),
  result: text("result").notNull().default("Pending"),
  details: text("details").notNull(),
  sourceIp: text("source_ip"),
  device: text("device"),
  beforeState: text("before_state"),
  afterState: text("after_state"),
  reason: text("reason"),
  confirmation: text("confirmation"),
  durationMs: integer("duration_ms"),
  error: text("error"),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
