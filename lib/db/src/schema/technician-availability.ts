import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const technicianAvailabilityTable = pgTable("technician_availability", {
  id: serial("id").primaryKey(),
  technicianUserId: integer("technician_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  technicianStartIndex: index("technician_availability_user_start_idx").on(table.technicianUserId, table.startsAt),
  validRange: check("technician_availability_valid_range", sql`${table.endsAt} > ${table.startsAt}`),
}));