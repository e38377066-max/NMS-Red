import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { equipmentTable } from "./equipment";

export const backupsTable = pgTable("backups", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").default(0),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Backup = typeof backupsTable.$inferSelect;
