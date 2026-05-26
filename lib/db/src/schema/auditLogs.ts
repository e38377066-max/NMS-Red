import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: integer("user_id"),
  username: text("username"),
  equipmentId: integer("equipment_id"),
  entity: text("entity").notNull(),
  action: text("action").notNull(),
  commandSent: text("command_sent"),
  result: text("result").notNull().default("Pending"),
  details: text("details").notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
