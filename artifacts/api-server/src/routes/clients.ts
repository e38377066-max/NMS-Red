import { Router, type IRouter } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import { db, clientsTable, equipmentTable, clientLifecycleEventsTable, clientChangeHistoryTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
  ChangeClientSpeedParams,
  ChangeClientSpeedBody,
} from "@workspace/api-zod";
import { enqueueSpeedChange } from "../services/task-queue.service";
import { provisionClient } from "../services/client-provisioning.service";

const router: IRouter = Router();

const CLIENT_SELECT = {
  id: clientsTable.id,
  equipmentId: clientsTable.equipmentId,
  equipmentModel: equipmentTable.model,
  equipmentRole: equipmentTable.equipmentRole,
  connectionType: equipmentTable.connectionType,
  mac: clientsTable.mac,
  ip: clientsTable.ip,
  name: clientsTable.name,
  planLimit: clientsTable.planLimit,
  status: clientsTable.status,
  lastSeenDbm: clientsTable.lastSeenDbm,
  paymentStatus: clientsTable.paymentStatus,
  monthlyFee: clientsTable.monthlyFee,
  dueDate: clientsTable.dueDate,
  lastPaymentDate: clientsTable.lastPaymentDate,
  contractReference: clientsTable.contractReference,
  contractNotes: clientsTable.contractNotes,
  installationDate: clientsTable.installationDate,
  installationAddress: clientsTable.installationAddress,
  assignedTechnicianId: clientsTable.assignedTechnicianId,
  accessPointEquipmentId: clientsTable.accessPointEquipmentId,
  createdAt: clientsTable.createdAt,
} as const;

function serializeClient(row: {
  id: number;
  equipmentId: number;
  equipmentModel: string | null;
  equipmentRole: string | null;
  connectionType: string | null;
  mac: string;
  ip: string | null;
  name: string;
  planLimit: string;
  status: string;
  lastSeenDbm: string | null;
  paymentStatus: string;
  monthlyFee: string | null;
  dueDate: Date | null;
  lastPaymentDate: Date | null;
  contractReference: string | null;
  contractNotes: string | null;
  installationDate: Date | null;
  installationAddress: string | null;
  assignedTechnicianId: number | null;
  accessPointEquipmentId: number | null;
  createdAt: Date;
}) {
  return {
    ...row,
    dueDate: row.dueDate?.toISOString() ?? null,
    lastPaymentDate: row.lastPaymentDate?.toISOString() ?? null,
    installationDate: row.installationDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isClientController(equipment: { equipmentRole: string; connectionType: string }): boolean {
  return equipment.equipmentRole === "core_router" && equipment.connectionType === "mikrotik_routeros";
}

async function getClientController(equipmentId: number) {
  const [equip] = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.id, equipmentId));
  return equip ?? null;
}

router.get("/clients", async (_req, res): Promise<void> => {
  const rows = await db
    .select(CLIENT_SELECT)
    .from(clientsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, clientsTable.equipmentId))
    .orderBy(clientsTable.name);
  res.json(rows.map(serializeClient));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dueDate, ...rest } = parsed.data;
  const controller = await getClientController(rest.equipmentId);
  if (!controller || !isClientController(controller)) {
    res.status(400).json({ error: "El cliente debe estar asociado al Router central MikroTik (rol core_router)" });
    return;
  }
  const duplicate = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(or(
      eq(clientsTable.mac, rest.mac),
      rest.ip ? eq(clientsTable.ip, rest.ip) : undefined,
    ))
    .limit(1);
  if (duplicate[0]) {
    res.status(409).json({ error: "Ya existe un cliente con esa MAC o IP; la operación es idempotente y no crea duplicados" });
    return;
  }
  const insertData = {
    ...rest,
    dueDate: dueDate ? new Date(dueDate) : undefined,
  };
  const [client] = await db.insert(clientsTable).values(insertData).returning();
  await db.insert(clientLifecycleEventsTable).values({
    clientId: client.id,
    status: client.status,
    notes: "Alta de cliente",
    equipmentId: client.equipmentId,
  });
  await db.insert(clientChangeHistoryTable).values({
    clientId: client.id,
    changedByUserId: res.locals.user?.id ?? null,
    changeType: "CREATED",
    reason: "Alta de cliente",
    previousData: {},
    newData: {
      name: client.name,
      equipmentId: client.equipmentId,
      accessPointEquipmentId: client.accessPointEquipmentId,
      assignedTechnicianId: client.assignedTechnicianId,
      installationDate: client.installationDate?.toISOString() ?? null,
      installationAddress: client.installationAddress,
      contractReference: client.contractReference,
    },
  });
  res.status(201).json(serializeClient({
    ...client,
    equipmentModel: controller.model,
    equipmentRole: controller.equipmentRole,
    connectionType: controller.connectionType,
  }));
});

router.post("/clients/provision", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  const equipmentId = Number(body?.equipmentId);
  const name = typeof body?.name === "string" ? body.name : "";
  const mac = typeof body?.mac === "string" ? body.mac : "";
  const fixedIp = typeof body?.fixedIp === "string" ? body.fixedIp : "";
  const planLimit = typeof body?.planLimit === "string" ? body.planLimit : "";
  if (!Number.isInteger(equipmentId) || equipmentId <= 0 || !name.trim() || !mac.trim() || !fixedIp.trim() || !planLimit.trim()) {
    res.status(400).json({ error: "equipmentId, name, mac, fixedIp y planLimit son obligatorios" });
    return;
  }
  const optionalString = (key: string): string | undefined =>
    typeof body?.[key] === "string" && body[key].trim() ? body[key].trim() : undefined;
  const dueDate = optionalString("dueDate");
  if (dueDate && Number.isNaN(new Date(dueDate).getTime())) {
    res.status(400).json({ error: "dueDate no es una fecha válida" });
    return;
  }

  try {
    const result = await provisionClient({
      equipmentId,
      name,
      mac,
      fixedIp,
      planLimit,
      monthlyFee: optionalString("monthlyFee"),
      dueDate,
      status: optionalString("status"),
      paymentStatus: optionalString("paymentStatus"),
      notes: optionalString("notes"),
      dhcpServer: optionalString("dhcpServer"),
      contractReference: optionalString("contractReference"),
      contractNotes: optionalString("contractNotes"),
      installationDate: optionalString("installationDate"),
      installationAddress: optionalString("installationAddress"),
      assignedTechnicianId: body?.assignedTechnicianId ? Number(body.assignedTechnicianId) : undefined,
      accessPointEquipmentId: body?.accessPointEquipmentId ? Number(body.accessPointEquipmentId) : undefined,
    }, res.locals.user?.id ?? null);
    const controller = await getClientController(result.client.equipmentId);
    res.status(201).json({
      client: serializeClient({
        ...result.client,
        equipmentModel: controller?.model ?? null,
        equipmentRole: controller?.equipmentRole ?? null,
        connectionType: controller?.connectionType ?? null,
      }),
      equipment: result.equipment,
      router: result.router,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo aprovisionar el cliente";
    const status = message.includes("Ya existe") || message.includes("más de un lease") ? 409 : 502;
    res.status(status).json({
      error: message,
      rolledBack: true,
    });
  }
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select(CLIENT_SELECT)
    .from(clientsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, clientsTable.equipmentId))
    .where(eq(clientsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(serializeClient(row));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existingClient] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.id));
  if (!existingClient) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const { dueDate: ud, ...updateRest } = parsed.data;
  const updateData = {
    ...updateRest,
    ...(ud !== undefined ? { dueDate: ud ? new Date(ud) : null } : {}),
  };
  if (updateRest.mac || updateRest.ip) {
    const conflicts = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(
        or(
          updateRest.mac ? eq(clientsTable.mac, updateRest.mac) : undefined,
          updateRest.ip ? eq(clientsTable.ip, updateRest.ip) : undefined,
        ),
        sql`${clientsTable.id} <> ${params.data.id}`,
      ))
      .limit(1);
    if (conflicts[0]) {
      res.status(409).json({ error: "La MAC o IP ya pertenece a otro cliente" });
      return;
    }
  }
  const [client] = await db
    .update(clientsTable)
    .set(updateData)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const changedFields = Object.fromEntries(
    Object.keys(updateData).map((key) => [
      key,
      (client as Record<string, unknown>)[key],
    ]),
  );
  const previousFields = Object.fromEntries(
    Object.keys(updateData).map((key) => [
      key,
      (existingClient as Record<string, unknown>)[key],
    ]),
  );
  if (JSON.stringify(previousFields) !== JSON.stringify(changedFields)) {
    await db.insert(clientChangeHistoryTable).values({
      clientId: client.id,
      changedByUserId: res.locals.user?.id ?? null,
      changeType: "UPDATED",
      reason: typeof req.body?.changeReason === "string" ? req.body.changeReason.trim() || null : null,
      previousData: serializeHistoryValue(previousFields),
      newData: serializeHistoryValue(changedFields),
    });
  }
  if (client.status !== existingClient.status) {
    await db.insert(clientLifecycleEventsTable).values({
      clientId: client.id,
      status: client.status,
      notes: "Cambio de estado desde la ficha del cliente",
      equipmentId: client.equipmentId,
      metadata: {
        previousStatus: existingClient.status,
        changedByUserId: res.locals.user?.id ?? null,
      },
    });
  }
  const controller = await getClientController(client.equipmentId);
  res.json(serializeClient({
    ...client,
    equipmentModel: controller?.model ?? null,
    equipmentRole: controller?.equipmentRole ?? null,
    connectionType: controller?.connectionType ?? null,
  }));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .delete(clientsTable)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/clients/:id/speed", async (req, res): Promise<void> => {
  const params = ChangeClientSpeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ChangeClientSpeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const equip = await getClientController(client.equipmentId);
  if (!equip) {
    res.status(404).json({ error: "Equipment not found for this client" });
    return;
  }
  if (!isClientController(equip)) {
    res.status(409).json({ error: "Este cliente no tiene un Router central MikroTik válido asignado" });
    return;
  }

  if (parsed.data.dryRun) {
    const currentLimitMbps = parseMbps(client.planLimit);
    const newLimitMbps = parseMbps(parsed.data.newLimit);
    const drastic = currentLimitMbps > 0 && newLimitMbps < currentLimitMbps * 0.5;

    if (drastic) {
      res.json({
        success: false,
        message: `Cambio drastico detectado: de ${client.planLimit} a ${parsed.data.newLimit}`,
        requiresConfirmation: true,
        warning: `El cliente ${client.name} tiene una alta diferencia de velocidad. ¿Estas seguro de realizar este cambio?`,
      });
      return;
    }

    res.json({
      success: true,
      message: `Dry run OK: cambiar velocidad a ${parsed.data.newLimit}`,
      requiresConfirmation: false,
      warning: null,
    });
    return;
  }

  const task = await enqueueSpeedChange(
    params.data.id,
    parsed.data.newLimit,
    res.locals.user?.id ?? parsed.data.userId ?? null,
  );

  res.status(202).json({
    success: true,
    queued: true,
    taskId: task.id,
    message: `Cambio de velocidad encolado para ${client.name}.`,
    requiresConfirmation: null,
    warning: null,
  });
});

function parseMbps(limit: string): number {
  const match = limit.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function serializeHistoryValue(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    entry instanceof Date ? entry.toISOString() : entry,
  ]));
}

export default router;
