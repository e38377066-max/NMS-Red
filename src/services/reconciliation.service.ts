import { Op } from "sequelize";
import { Client, Equipment } from "../db";
import {
  addToAddressList,
  getMikroTikAddressList,
  getMikroTikDhcpLeases,
  getMikroTikResource,
  getMikroTikSimpleQueues,
  removeFromAddressList,
  setClientSpeedLimit,
  upsertSimpleQueue,
  upsertStaticDhcpLease,
  type MikroTikDhcpLease,
  type MikroTikSimpleQueue,
} from "./mikrotik.service";

const ACTIVE_LIST = "Clientes_Activos";
const SUSPENDED_LIST = "Clientes_Cortados";

export type ReconciliationDifferenceKind =
  | "missing_lease"
  | "non_static_lease"
  | "router_only"
  | "orphan_queue"
  | "orphan_address_list"
  | "ip_mismatch"
  | "rate_mismatch"
  | "queue_missing"
  | "queue_mismatch"
  | "address_list_mismatch"
  | "duplicate";

export interface ReconciliationDifference {
  id: string;
  kind: ReconciliationDifferenceKind;
  severity: "warning" | "error" | "critical";
  clientId: number | null;
  clientName: string | null;
  mac: string;
  ip: string | null;
  routerLeaseId: string | null;
  routerQueueId: string | null;
  routerIp: string | null;
  routerRateLimit: string | null;
  expectedRateLimit?: string | null;
  expectedAddressList?: string | null;
  actualAddressLists?: string[];
  message: string;
}

export type ReconciliationReport = {
  equipment: { id: number; model: string; ip: string; checkedAt: string };
  routerReachable: boolean;
  totals: {
    clients: number;
    routerLeases: number;
    routerQueues: number;
    routerAddressLists: number;
    differences: number;
    critical: number;
  };
  differences: ReconciliationDifference[];
};

function normalizeMac(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/\/32$/, "") || null;
}

function normalizeRate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\s/g, "").toLowerCase();
}

function queueTarget(queue: MikroTikSimpleQueue): string | null {
  return normalizeIp(queue.target.split(",")[0]);
}

function expectedList(client: { status: string; paymentStatus: string }): string {
  return client.status === "SUSPENDED" || client.paymentStatus === "SUSPENDED"
    ? SUSPENDED_LIST
    : ACTIVE_LIST;
}

function isSafeToApply(difference: ReconciliationDifference): boolean {
  return ![
    "router_only",
    "orphan_queue",
    "orphan_address_list",
    "duplicate",
  ].includes(difference.kind);
}

export async function reconcileEquipment(equipmentId: number): Promise<ReconciliationReport> {
  const equipment = await Equipment.findByPk(equipmentId);
  if (!equipment) throw new Error("Equipo no encontrado");
  if (equipment.connectionType !== "mikrotik_routeros" || equipment.equipmentRole !== "core_router") {
    throw new Error("La reconciliación CRM–router solo está disponible para un Router central MikroTik");
  }

  const resource = await getMikroTikResource(equipment.ip, equipment.username, equipment.password);
  if (!resource.reachable) {
    throw new Error(`No se pudo conectar con el MikroTik ${equipment.ip}; no se aplicaron correcciones`);
  }

  const [clients, leases, queues, addressLists] = await Promise.all([
    Client.findAll({ where: { equipmentId } }),
    getMikroTikDhcpLeases(equipment.ip, equipment.username, equipment.password),
    getMikroTikSimpleQueues(equipment.ip, equipment.username, equipment.password),
    getMikroTikAddressList(equipment.ip, equipment.username, equipment.password),
  ]);

  const differences: ReconciliationDifference[] = [];
  const clientsByMac = new Map<string, typeof clients[number]>();
  const clientsByIp = new Map<string, typeof clients[number]>();
  const leasesByMac = new Map<string, MikroTikDhcpLease>();
  const queuesByIp = new Map<string, MikroTikSimpleQueue[]>();
  const leasesByIp = new Map<string, MikroTikDhcpLease[]>();
  const addressesByIp = new Map<string, Set<string>>();

  const addDifference = (difference: ReconciliationDifference) => {
    differences.push(difference);
  };

  for (const client of clients) {
    const mac = normalizeMac(client.mac);
    const ip = normalizeIp(client.ip);
    if (clientsByMac.has(mac)) {
      addDifference({
        id: `duplicate-crm-mac-${client.id}`,
        kind: "duplicate",
        severity: "critical",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: null,
        routerQueueId: null,
        routerIp: null,
        routerRateLimit: null,
        message: `La MAC ${client.mac} está asociada a más de un cliente en el CRM`,
      });
    } else {
      clientsByMac.set(mac, client);
    }
    if (ip) {
      if (clientsByIp.has(ip)) {
        addDifference({
          id: `duplicate-crm-ip-${ip}`,
          kind: "duplicate",
          severity: "critical",
          clientId: client.id,
          clientName: client.name,
          mac: client.mac,
          ip,
          routerLeaseId: null,
          routerQueueId: null,
          routerIp: null,
          routerRateLimit: null,
          message: `La IP ${ip} está asignada a más de un cliente en el CRM`,
        });
      } else {
        clientsByIp.set(ip, client);
      }
    }
  }

  for (const lease of leases) {
    const mac = normalizeMac(lease.macAddress);
    const ip = normalizeIp(lease.address);
    if (mac) {
      if (leasesByMac.has(mac)) {
        addDifference({
          id: `duplicate-router-mac-${lease.id}`,
          kind: "duplicate",
          severity: "critical",
          clientId: null,
          clientName: null,
          mac: lease.macAddress,
          ip: lease.address,
          routerLeaseId: lease.id,
          routerQueueId: null,
          routerIp: lease.address,
          routerRateLimit: lease.rateLimit,
          message: `La MAC ${lease.macAddress} aparece en más de un lease del router`,
        });
      } else {
        leasesByMac.set(mac, lease);
      }
    }
    if (ip) {
      const sameIp = leasesByIp.get(ip) ?? [];
      sameIp.push(lease);
      leasesByIp.set(ip, sameIp);
    }
  }

  for (const [ip, sameIp] of leasesByIp) {
    if (sameIp.length < 2) continue;
    addDifference({
      id: `duplicate-router-ip-${ip}`,
      kind: "duplicate",
      severity: "critical",
      clientId: null,
      clientName: null,
      mac: "",
      ip,
      routerLeaseId: sameIp[0]?.id ?? null,
      routerQueueId: null,
      routerIp: ip,
      routerRateLimit: sameIp[0]?.rateLimit ?? null,
      message: `La IP ${ip} aparece en ${sameIp.length} leases del router`,
    });
  }

  for (const queue of queues) {
    const target = queueTarget(queue);
    if (!target) continue;
    const sameTarget = queuesByIp.get(target) ?? [];
    sameTarget.push(queue);
    queuesByIp.set(target, sameTarget);
  }

  for (const entry of addressLists) {
    const ip = normalizeIp(entry.address);
    if (!ip || ![ACTIVE_LIST, SUSPENDED_LIST].includes(entry.list)) continue;
    const lists = addressesByIp.get(ip) ?? new Set<string>();
    lists.add(entry.list);
    addressesByIp.set(ip, lists);
  }

  for (const client of clients) {
    const clientIp = normalizeIp(client.ip);
    const mac = normalizeMac(client.mac);
    const lease = leasesByMac.get(mac);
    const queue = clientIp ? queuesByIp.get(clientIp)?.[0] : undefined;
    const routerIp = normalizeIp(lease?.address);

    if (!lease) {
      addDifference({
        id: `missing-lease-${client.id}`,
        kind: "missing_lease",
        severity: "warning",
        clientId: client.id,
        clientName: client.name,
        mac: client.mac,
        ip: client.ip,
        routerLeaseId: null,
        routerQueueId: queue?.id ?? null,
        routerIp: null,
        routerRateLimit: queue?.maxLimit ?? null,
        expectedRateLimit: client.planLimit,
        message: `El cliente ${client.name} no tiene un lease DHCP con su MAC en el router`,
      });
    } else {
      if (clientIp && routerIp && clientIp !== routerIp) {
        addDifference({
          id: `ip-mismatch-${client.id}`,
          kind: "ip_mismatch",
          severity: "error",
          clientId: client.id,
          clientName: client.name,
          mac: client.mac,
          ip: client.ip,
          routerLeaseId: lease.id,
          routerQueueId: queue?.id ?? null,
          routerIp: lease.address,
          routerRateLimit: queue?.maxLimit ?? lease.rateLimit,
          expectedRateLimit: client.planLimit,
          message: `La IP del CRM (${client.ip}) no coincide con la MAC del cliente en el router (${lease.address})`,
        });
      }
      if (lease.dynamic) {
        addDifference({
          id: `non-static-lease-${client.id}`,
          kind: "non_static_lease",
          severity: "error",
          clientId: client.id,
          clientName: client.name,
          mac: client.mac,
          ip: client.ip,
          routerLeaseId: lease.id,
          routerQueueId: queue?.id ?? null,
          routerIp: lease.address,
          routerRateLimit: lease.rateLimit,
          expectedRateLimit: client.planLimit,
          message: `El lease de ${client.name} existe, pero todavía es dinámico`,
        });
      }
    }

    if (clientIp) {
      if (!queue) {
        addDifference({
          id: `queue-missing-${client.id}`,
          kind: "queue_missing",
          severity: "warning",
          clientId: client.id,
          clientName: client.name,
          mac: client.mac,
          ip: client.ip,
          routerLeaseId: lease?.id ?? null,
          routerQueueId: null,
          routerIp: routerIp,
          routerRateLimit: lease?.rateLimit ?? null,
          expectedRateLimit: client.planLimit,
          message: `El cliente ${client.name} no tiene una Simple Queue para ${clientIp}`,
        });
      } else {
        const effectiveRate = queue.maxLimit ?? lease?.rateLimit ?? null;
        if (normalizeRate(effectiveRate) !== normalizeRate(client.planLimit)) {
          addDifference({
            id: `rate-mismatch-${client.id}`,
            kind: "rate_mismatch",
            severity: "error",
            clientId: client.id,
            clientName: client.name,
            mac: client.mac,
            ip: client.ip,
            routerLeaseId: lease?.id ?? null,
            routerQueueId: queue.id,
            routerIp: routerIp ?? queueTarget(queue),
            routerRateLimit: effectiveRate,
            expectedRateLimit: client.planLimit,
            message: `La velocidad del CRM (${client.planLimit}) no coincide con la configurada en el router (${effectiveRate ?? "sin límite"})`,
          });
        }
        if (
          queue.name.trim() !== client.name.trim()
          || (queue.comment ?? "").trim().toLowerCase() !== `cliente: ${client.name.trim().toLowerCase()}`
        ) {
          addDifference({
            id: `queue-mismatch-${client.id}`,
            kind: "queue_mismatch",
            severity: "error",
            clientId: client.id,
            clientName: client.name,
            mac: client.mac,
            ip: client.ip,
            routerLeaseId: lease?.id ?? null,
            routerQueueId: queue.id,
            routerIp: routerIp ?? queueTarget(queue),
            routerRateLimit: queue.maxLimit ?? lease?.rateLimit ?? null,
            expectedRateLimit: client.planLimit,
            message: `La Simple Queue de ${client.name} tiene nombre o comentario distinto al CRM`,
          });
        }
      }

      const actualLists = [...(addressesByIp.get(clientIp) ?? new Set<string>())];
      const wantedList = expectedList(client);
      if (actualLists.length !== 1 || actualLists[0] !== wantedList) {
        addDifference({
          id: `address-list-mismatch-${client.id}`,
          kind: "address_list_mismatch",
          severity: "error",
          clientId: client.id,
          clientName: client.name,
          mac: client.mac,
          ip: client.ip,
          routerLeaseId: lease?.id ?? null,
          routerQueueId: queue?.id ?? null,
          routerIp: routerIp ?? clientIp,
          routerRateLimit: queue?.maxLimit ?? lease?.rateLimit ?? null,
          expectedRateLimit: client.planLimit,
          expectedAddressList: wantedList,
          actualAddressLists: actualLists,
          message: `El estado ${client.status}/${client.paymentStatus} requiere ${wantedList}, pero el router tiene ${actualLists.join(", ") || "ninguna"}`,
        });
      }
    }
  }

  for (const lease of leases) {
    if (!clientsByMac.has(normalizeMac(lease.macAddress))) {
      addDifference({
        id: `router-only-${lease.id}`,
        kind: "router_only",
        severity: "warning",
        clientId: null,
        clientName: null,
        mac: lease.macAddress,
        ip: lease.address,
        routerLeaseId: lease.id,
        routerQueueId: null,
        routerIp: lease.address,
        routerRateLimit: lease.rateLimit,
        message: `El lease ${lease.address} (${lease.macAddress}) no tiene cliente en el CRM`,
      });
    }
  }

  for (const [ip, targetQueues] of queuesByIp) {
    if (clientsByIp.has(ip)) continue;
    for (const queue of targetQueues) {
      addDifference({
        id: `orphan-queue-${queue.id}`,
        kind: "orphan_queue",
        severity: "warning",
        clientId: null,
        clientName: null,
        mac: "",
        ip,
        routerLeaseId: null,
        routerQueueId: queue.id,
        routerIp: ip,
        routerRateLimit: queue.maxLimit,
        message: `La Simple Queue ${queue.name || queue.id} apunta a ${ip}, pero no existe un cliente con esa IP en el CRM`,
      });
    }
  }

  for (const [ip, lists] of addressesByIp) {
    if (clientsByIp.has(ip)) continue;
    addDifference({
      id: `orphan-address-list-${ip}`,
      kind: "orphan_address_list",
      severity: "warning",
      clientId: null,
      clientName: null,
      mac: "",
      ip,
      routerLeaseId: null,
      routerQueueId: null,
      routerIp: ip,
      routerRateLimit: null,
      actualAddressLists: [...lists],
      message: `La IP ${ip} aparece en ${[...lists].join(" y ")} pero no existe en el CRM`,
    });
  }

  return {
    equipment: { id: equipment.id, model: equipment.model, ip: equipment.ip, checkedAt: new Date().toISOString() },
    routerReachable: true,
    totals: {
      clients: clients.length,
      routerLeases: leases.length,
      routerQueues: queues.length,
      routerAddressLists: addressLists.length,
      differences: differences.length,
      critical: differences.filter(item => item.severity === "critical").length,
    },
    differences,
  };
}

export async function applyReconciliationDifference(
  equipmentId: number,
  difference: ReconciliationDifference,
): Promise<{ applied: boolean; message: string }> {
  if (!isSafeToApply(difference)) {
    return { applied: false, message: "Esta diferencia requiere revisión manual y no se corrige automáticamente" };
  }

  const equipment = await Equipment.findByPk(equipmentId);
  if (!equipment) throw new Error("Equipo no encontrado");
  const client = difference.clientId
    ? await Client.findOne({ where: { id: difference.clientId, equipmentId } })
    : null;
  if (!client) return { applied: false, message: "El cliente ya no existe o pertenece a otro router" };

  const ip = normalizeIp(client.ip);
  if (difference.kind === "ip_mismatch") {
    const routerIp = normalizeIp(difference.routerIp);
    if (!routerIp) return { applied: false, message: "El router no devolvió una IP válida para la MAC" };
    const conflict = await Client.findOne({ attributes: ["id"], where: {
      equipmentId, ip: routerIp, id: { [Op.ne]: client.id },
    } });
    if (conflict) return { applied: false, message: `La IP ${routerIp} ya pertenece a otro cliente del CRM` };
    await client.update({ ip: routerIp });
    return { applied: true, message: `IP del cliente actualizada a ${routerIp}` };
  }

  if (!ip && !difference.routerIp) {
    return { applied: false, message: "El cliente no tiene una IP para corregir" };
  }
  const targetIp = ip ?? normalizeIp(difference.routerIp);
  if (!targetIp) return { applied: false, message: "No se pudo determinar la IP del cliente" };

  if (difference.kind === "missing_lease" || difference.kind === "non_static_lease") {
    const result = await upsertStaticDhcpLease(
      equipment.ip,
      equipment.username,
      equipment.password,
      client.mac,
      targetIp,
      `Cliente: ${client.name}`,
      undefined,
      client.planLimit,
    );
    return { applied: result.success, message: result.message };
  }

  if (difference.kind === "rate_mismatch") {
    const result = await setClientSpeedLimit(
      equipment.ip,
      equipment.username,
      equipment.password,
      client.mac,
      client.planLimit,
      targetIp,
      client.name,
    );
    return { applied: result.success, message: result.message };
  }

  if (difference.kind === "queue_missing" || difference.kind === "queue_mismatch") {
    const result = await upsertSimpleQueue(equipment.ip, equipment.username, equipment.password, {
      target: targetIp,
      name: client.name,
      maxLimit: client.planLimit,
      comment: `Cliente: ${client.name}`,
    });
    return { applied: result.success, message: result.message };
  }

  if (difference.kind === "address_list_mismatch") {
    const wantedList = difference.expectedAddressList ?? expectedList(client);
    const otherList = wantedList === ACTIVE_LIST ? SUSPENDED_LIST : ACTIVE_LIST;
    const added = await addToAddressList(
      equipment.ip,
      equipment.username,
      equipment.password,
      targetIp,
      wantedList,
      `${wantedList === ACTIVE_LIST ? "ACTIVO" : "SUSPENDIDO"}: ${client.name}`,
    );
    const removed = await removeFromAddressList(
      equipment.ip,
      equipment.username,
      equipment.password,
      targetIp,
      otherList,
    );
    return {
      applied: added && removed,
      message: added && removed
        ? `Estado del cliente sincronizado con ${wantedList}`
        : "No se pudo sincronizar completamente la address-list",
    };
  }

  return { applied: false, message: "Diferencia no soportada para corrección" };
}