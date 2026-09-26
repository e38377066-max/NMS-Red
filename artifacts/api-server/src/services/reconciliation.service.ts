import { and, eq, sql } from "drizzle-orm";
import { clientsTable, db, equipmentTable } from "@workspace/db";
import { getMikroTikDhcpLeases, type MikroTikDhcpLease } from "./mikrotik.service";

export type ReconciliationDifference =
  | {
      id: string;
      kind: "crm_only";
      severity: "warning";
      clientId: number;
      clientName: string;
      mac: string;
      ip: string | null;
      routerLeaseId: null;
      routerIp: null;
      routerRateLimit: null;
      message: string;
    }
  | {
      id: string;
      kind: "router_only";
      severity: "warning";
      clientId: null;
      clientName: null;
      mac: string;
      ip: null;
      routerLeaseId: string;
      routerIp: string;
      routerRateLimit: string | null;
      message: string;
    }
  | {
      id: string;
      kind: "ip_mismatch" | "rate_mismatch";
      severity: "error";
      clientId: number;
      clientName: string;
      mac: string;
      ip: string | null;
      routerLeaseId: string;
      routerIp: string;
      routerRateLimit: string | null;
      message: string;
    }
  | {
      id: string;
      kind: "duplicate";
      severity: "critical";
      clientId: number | null;
      clientName: string | null;
      mac: string;
      ip: string | null;
      routerLeaseId: string | null;
      routerIp: string | null;
      routerRateLimit: string | null;
      message: string;
    };

function normalizeMac(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function normalizeRate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\s/g, "").toLowerCase();
}

export async function reconcileEquipment(equipmentId: number) {
  const [equipment] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, equipmentId));
  if (!equipment) throw new Error("Equipo no encontrado");
  if (equipment.connectionType !== "mikrotik_routeros") {
    throw new Error("La reconciliación CRM–router solo está disponible para MikroTik RouterOS");
  }

  const [clients, leases] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.equipmentId, equipmentId)),
    getMikroTikDhcpLeases(equipment.ip, equipment.username, equipment.password),
  ]);
  const differences: ReconciliationDifference[] = [];
  const clientsByMac = new Map<string, typeof clients[number]>();
  const leasesByMac = new Map<string, MikroTikDhcpLease>();

  for (const client of clients) {
    const mac = normalizeMac(client.mac);
    if (clientsByMac.has(mac)) {
      differences.push({
        id: `duplicate-crm-mac-${client.id}`,
        kind: "duplicate",
        severity: "critical",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: null,
        routerIp: null,
        routerRateLimit: null,
        message: `La MAC ${client.mac} está asociada a más de un cliente en el CRM`,
      });
    } else {
      clientsByMac.set(mac, client);
    }
  }

  for (const lease of leases) {
    const mac = normalizeMac(lease.macAddress);
    if (!mac) continue;
    if (leasesByMac.has(mac)) {
      differences.push({
        id: `duplicate-router-mac-${lease.id}`,
        kind: "duplicate",
        severity: "critical",
        clientId: null,
        clientName: null,
        mac: lease.macAddress,
        ip: null,
        routerLeaseId: lease.id,
        routerIp: lease.address,
        routerRateLimit: lease.rateLimit,
        message: `La MAC ${lease.macAddress} aparece en más de un lease del router`,
      });
    } else {
      leasesByMac.set(mac, lease);
    }
  }

  for (const client of clients) {
    const lease = leasesByMac.get(normalizeMac(client.mac));
    if (!lease) {
      differences.push({
        id: `crm-only-${client.id}`,
        kind: "crm_only",
        severity: "warning",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: null,
        routerIp: null,
        routerRateLimit: null,
        message: `El cliente ${client.name} no tiene un lease con su MAC en el router`,
      });
      continue;
    }
    if (client.ip && lease.address && client.ip !== lease.address) {
      differences.push({
        id: `ip-mismatch-${client.id}`,
        kind: "ip_mismatch",
        severity: "error",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: lease.id,
        routerIp: lease.address,
        routerRateLimit: lease.rateLimit,
        message: `La IP del CRM (${client.ip}) no coincide con la del router (${lease.address})`,
      });
    }
    if (normalizeRate(client.planLimit) !== normalizeRate(lease.rateLimit)) {
      differences.push({
        id: `rate-mismatch-${client.id}`,
        kind: "rate_mismatch",
        severity: "error",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: lease.id,
        routerIp: lease.address,
        routerRateLimit: lease.rateLimit,
        message: `La velocidad del cliente (${client.planLimit}) no coincide con el límite del router (${lease.rateLimit ?? "sin límite"})`,
      });
    }
  }

  for (const lease of leases) {
    if (!clientsByMac.has(normalizeMac(lease.macAddress))) {
      differences.push({
        id: `router-only-${lease.id}`,
        kind: "router_only",
        severity: "warning",
        clientId: null,
        clientName: null,
        mac: lease.macAddress,
        ip: null,
        routerLeaseId: lease.id,
        routerIp: lease.address,
        routerRateLimit: lease.rateLimit,
        message: `El lease ${lease.address} (${lease.macAddress}) no tiene cliente en el CRM`,
      });
    }
  }

  const duplicateIps = await db
    .select({ ip: clientsTable.ip, count: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(and(eq(clientsTable.equipmentId, equipmentId), sql`${clientsTable.ip} is not null`))
    .groupBy(clientsTable.ip)
    .having(sql`count(*) > 1`);
  for (const duplicate of duplicateIps) {
    differences.push({
      id: `duplicate-crm-ip-${duplicate.ip}`,
      kind: "duplicate",
      severity: "critical",
      clientId: null,
      clientName: null,
      mac: "",
      ip: duplicate.ip,
      routerLeaseId: null,
      routerIp: null,
      routerRateLimit: null,
      message: `La IP ${duplicate.ip} está asignada a ${duplicate.count} clientes en el CRM`,
    });
  }

  return {
    equipment: { id: equipment.id, model: equipment.model, ip: equipment.ip, checkedAt: new Date().toISOString() },
    routerReachable: true,
    totals: {
      clients: clients.length,
      routerLeases: leases.length,
      differences: differences.length,
      critical: differences.filter(item => item.severity === "critical").length,
    },
    differences,
  };
}