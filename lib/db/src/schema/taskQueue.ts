import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const taskQueueTable = pgTable("task_queue", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  equipmentId: integer("equipment_id"),
  equipmentLabel: text("equipment_label").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"),
  retries: integer("retries").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  error: text("error"),
  result: text("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  nextAttemptAt: timestamp("next_attempt_at"),
  cancelledAt: timestamp("cancelled_at"),
  requestedByUserId: integer("requested_by_user_id"),
});

export type TaskQueueRow = typeof taskQueueTable.$inferSelect;