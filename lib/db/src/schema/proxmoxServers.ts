import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const proxmoxServersTable = pgTable("proxmox_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  port: integer("port").notNull().default(8006),
  username: text("username").notNull(),
  password: text("password").notNull(),
  nodeName: text("node_name").notNull().default("pve"),
  lastSeenStatus: text("last_seen_status").notNull().default("UNKNOWN"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProxmoxServerSchema = createInsertSchema(proxmoxServersTable).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  lastSeenStatus: true,
});
export type InsertProxmoxServer = z.infer<typeof insertProxmoxServerSchema>;
export type ProxmoxServer = typeof proxmoxServersTable.$inferSelect;
