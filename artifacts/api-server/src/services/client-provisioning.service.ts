import { eq, or } from "drizzle-orm";
import {
  clientLifecycleEventsTable,
  clientsTable,
  db,
  equipmentTable,
} from "@workspace/db";
import {
  addToAddressList,
  deleteDhcpLease,
  deleteSimpleQueue,
  getMikroTikAddressList,
  getMikroTikDhcpLeases,
  getMikroTikSimpleQueues,
  removeFromAddressList,
  restoreDhcpLease,
  upsertSimpleQueue,
  upsertStaticDhcpLease,
  type MikroTikDhcpLease,
} from "./mikrotik.service";

const ACTIVE_LIST = "Clientes_Activos";

export interface ProvisionClientInput {
  equipmentId: number;
  name: string;
  mac: string;
  fixedIp: string;
  planLimit: string;
  monthlyFee?: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  notes?: string;
  dhcpServer?: string;
}

export async function provisionClient(input: ProvisionClientInput, requestedByUserId: number | null) {
  const name = input.name.trim();
  const mac = input.mac.trim();
  const fixedIp = input.fixedIp.trim();
  const planLimit = input.planLimit.trim();
  if (!name || !mac || !fixedIp || !planLimit) {
    throw new Error("Nombre, MAC, IP fija y plan son obligatorios para aprovisionar");
  }

  const [equipment] = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.id, input.equipmentId));
  if (!equipment) throw new Error("Router central no encontrado");
  if (equipment.connectionType !== "mikrotik_routeros" || equipment.equipmentRole !== "core_router") {
    throw new Error("El aprovisionamiento solo puede ejecutarse en un Router central MikroTik");
  }

  const duplicate = await db
    .select({ id: clientsTable.id, mac: clientsTable.mac, ip: clientsTable.ip })
    .from(clientsTable)
    .where(or(eq(clientsTable.mac, mac), eq(clientsTable.ip, fixedIp)))
    .limit(2);
  if (duplicate.length > 0) {
    throw new Error("Ya existe un cliente con esa MAC o IP en el CRM");
  }

  const leasesBefore = await getMikroTikDhcpLeases(equipment.ip, equipment.username, equipment.password);
  const macKey = normalizeMac(mac);
  const conflictingLease = leasesBefore.find(lease =>
    normalizeMac(lease.macAddress) === macKey || lease.address === fixedIp,
  );
  const queuesBefore = await getMikroTikSimpleQueues(equipment.ip, equipment.username, equipment.password);
  const previousQueue = queuesBefore.find(queue =>
    queue.target.split(",")[0]?.trim().replace(/\/32$/, "") === fixedIp ||
    queue.name.trim().toLowerCase() === name.toLowerCase() ||
    queue.comment?.trim().toLowerCase() === `cliente: ${name.toLowerCase()}`,
  );
  if (conflictingLease && normalizeMac(conflictingLease.macAddress) !== macKey) {
    throw new Error(`La IP ${fixedIp} ya está ocupada por otra MAC en el MikroTik`);
  }
  if (
    previousQueue &&
    previousQueue.target.split(",")[0]?.trim().replace(/\/32$/, "") === fixedIp &&
    previousQueue.comment?.trim().toLowerCase() !== `cliente: ${name.toLowerCase()}` &&
    previousQueue.name.trim().toLowerCase() !== name.toLowerCase()
  ) {
    throw new Error(`La IP ${fixedIp} ya está ocupada por otra Simple Queue en el MikroTik`);
  }
  const activeEntriesBefore = await getMikroTikAddressList(
    equipment.ip,
    equipment.username,
    equipment.password,
    ACTIVE_LIST,
    fixedIp,
  );

  let leaseId: string | undefined;
  let leaseCreated = false;
  let previousLease = undefined as typeof conflictingLease;
  let queueId: string | undefined;
  let queueCreated = false;
  let activeListCreated = false;

  try {
    const lease = await upsertStaticDhcpLease(
      equipment.ip,
      equipment.username,
      equipment.password,
      mac,
      fixedIp,
      `Cliente: ${name}`,
      input.dhcpServer,
      planLimit,
    );
    if (!lease.success || !lease.id) throw new Error(lease.message);
    leaseId = lease.id;
    leaseCreated = lease.created === true;
    previousLease = lease.previous ?? conflictingLease;

    const queue = await upsertSimpleQueue(equipment.ip, equipment.username, equipment.password, {
      target: fixedIp,
      name,
      maxLimit: planLimit,
      comment: `Cliente: ${name}`,
    });
    if (!queue.success || !queue.id) throw new Error(queue.message);
    queueId = queue.id;
    queueCreated = queue.created === true;

    if (!(await addToAddressList(
      equipment.ip,
      equipment.username,
      equipment.password,
      fixedIp,
      ACTIVE_LIST,
      `ACTIVO: ${name}`,
    ))) {
      throw new Error("No se pudo agregar la IP a la address-list de clientes activos");
    }
    activeListCreated = activeEntriesBefore.length === 0;

    const [verifiedLease] = (await getMikroTikDhcpLeases(
      equipment.ip,
      equipment.username,
      equipment.password,
    )).filter(lease => lease.address === fixedIp && normalizeMac(lease.macAddress) === macKey);
    const [verifiedQueue] = (await getMikroTikSimpleQueues(
      equipment.ip,
      equipment.username,
      equipment.password,
    )).filter(queue =>
      queue.target.split(",")[0]?.trim().replace(/\/32$/, "") === fixedIp &&
      normalizeRate(queue.maxLimit) === normalizeRate(planLimit),
    );
    const verifiedActive = await getMikroTikAddressList(
      equipment.ip,
      equipment.username,
      equipment.password,
      ACTIVE_LIST,
      fixedIp,
    );
    if (!verifiedLease || !verifiedQueue || verifiedActive.length === 0) {
      throw new Error("La verificación posterior no coincide con el estado solicitado en MikroTik");
    }

    const result = await db.transaction(async (tx) => {
      const [client] = await tx.insert(clientsTable).values({
        equipmentId: equipment.id,
        name,
        mac,
        ip: fixedIp,
        planLimit,
        monthlyFee: input.monthlyFee,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        status: input.status ?? "ACTIVE",
        paymentStatus: input.paymentStatus ?? "PAID",
      }).returning();
      if (!client) throw new Error("No se pudo crear el cliente en el CRM");

      await tx.insert(clientLifecycleEventsTable).values({
        clientId: client.id,
        status: client.status,
        notes: input.notes ?? "Alta y aprovisionamiento verificado en MikroTik",
        equipmentId: equipment.id,
        technicianUserId: requestedByUserId,
        metadata: {
          leaseId: verifiedLease.id,
          queueId: verifiedQueue.id,
          activeList: ACTIVE_LIST,
          provisionedAt: new Date().toISOString(),
        },
      });
      return client;
    });

    return {
      client: result,
      equipment: { id: equipment.id, model: equipment.model, ip: equipment.ip },
      router: {
        leaseId: verifiedLease.id,
        queueId: verifiedQueue.id,
        addressList: ACTIVE_LIST,
        verified: true,
      },
    };
  } catch (error) {
    await rollbackRouterState({
      equipment,
      leaseId,
      leaseCreated,
      previousLease,
      queueId,
      queueCreated,
      previousQueue,
      activeListCreated,
      fixedIp,
    });
    throw error;
  }
}

async function rollbackRouterState(input: {
  equipment: typeof equipmentTable.$inferSelect;
  leaseId?: string;
  leaseCreated: boolean;
  previousLease?: MikroTikDhcpLease;
  queueId?: string;
  queueCreated: boolean;
  previousQueue?: Awaited<ReturnType<typeof getMikroTikSimpleQueues>>[number];
  activeListCreated: boolean;
  fixedIp: string;
}): Promise<void> {
  const { equipment } = input;
  if (input.activeListCreated) {
    const entries = await getMikroTikAddressList(
      equipment.ip,
      equipment.username,
      equipment.password,
      ACTIVE_LIST,
      input.fixedIp,
    );
    for (const entry of entries) {
      const removed = await removeFromAddressList(
        equipment.ip,
        equipment.username,
        equipment.password,
        entry.address,
        ACTIVE_LIST,
      );
      if (!removed) break;
    }
  }
  if (input.queueCreated && input.queueId) {
    await deleteSimpleQueue(equipment.ip, equipment.username, equipment.password, input.queueId);
  } else if (input.previousQueue?.id && input.previousQueue.maxLimit) {
    await upsertSimpleQueue(equipment.ip, equipment.username, equipment.password, {
      target: input.previousQueue.target.split(",")[0]?.trim().replace(/\/32$/, "") ?? input.fixedIp,
      name: input.previousQueue.name,
      maxLimit: input.previousQueue.maxLimit,
      comment: input.previousQueue.comment ?? undefined,
    });
  }
  if (input.leaseCreated && input.leaseId) {
    await deleteDhcpLease(equipment.ip, equipment.username, equipment.password, input.leaseId);
  } else if (input.previousLease) {
    await restoreDhcpLease(equipment.ip, equipment.username, equipment.password, input.previousLease);
  }
}

function normalizeMac(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function normalizeRate(value: string | null | undefined): string | null {
  return value?.replace(/\s/g, "").toLowerCase() ?? null;
}