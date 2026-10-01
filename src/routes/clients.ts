import { Router, type IRouter } from "express";
import { Op } from "sequelize";
import { Client, Equipment, ClientLifecycleEvent, ClientChangeHistory, sequelize } from "../db";
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

const CLIENT_COLUMNS = `c.id, c.equipment_id AS "equipmentId", e.model AS "equipmentModel", e.ip AS "equipmentIp",
e.equipment_role AS "equipmentRole", e.connection_type AS "connectionType", c.mac, c.ip, c.name, c.plan_limit AS "planLimit",
c.status, c.last_seen_dbm AS "lastSeenDbm", c.payment_status AS "paymentStatus", c.dhcp_server AS "dhcpServer",
c.dhcp_pool AS "dhcpPool", c.monthly_fee AS "monthlyFee", c.due_date AS "dueDate", c.last_payment_date AS "lastPaymentDate",
c.contract_reference AS "contractReference", c.contract_notes AS "contractNotes", c.installation_date AS "installationDate",
c.installation_address AS "installationAddress", c.assigned_technician_id AS "assignedTechnicianId",
c.access_point_equipment_id AS "accessPointEquipmentId", c.created_at AS "createdAt"`;
async function clientRows(where = "", replacements: Record<string, unknown> = {}) {
  return await sequelize.query(`SELECT ${CLIENT_COLUMNS} FROM clients c LEFT JOIN equipment e ON e.id=c.equipment_id ${where}`, { replacements, type: "SELECT" }) as any[];
}

function serializeClient(row: {
  id: number;
  equipmentId: number;
  equipmentModel: string | null;
  equipmentIp: string | null;
  equipmentRole: string | null;
  connectionType: string | null;
  mac: string;
  ip: string | null;
  name: string;
  planLimit: string;
  status: string;
  lastSeenDbm: string | null;
  paymentStatus: string;
  dhcpServer: string | null;
  dhcpPool: string | null;
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
  return await Equipment.findByPk(equipmentId);
}

async function validateAccessEquipment(input: {
  controllerId: number;
  accessPointEquipmentId: number | null | undefined;
}): Promise<string | null> {
  const accessPointId = input.accessPointEquipmentId ?? null;
  if (accessPointId === null) return null;
  if (accessPointId === input.controllerId) {
    return "El equipo de acceso debe ser distinto del MikroTik que controla al cliente";
  }
  const accessPoint = await Equipment.findByPk(accessPointId, { attributes: ["id"] });
  return accessPoint ? null : "El equipo de acceso seleccionado no existe";
}

router.get("/clients", async (_req, res): Promise<void> => {
  const rows = await clientRows("ORDER BY c.name");
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
  const accessEquipmentError = await validateAccessEquipment({
    controllerId: rest.equipmentId,
    accessPointEquipmentId: rest.accessPointEquipmentId,
  });
  if (accessEquipmentError) {
    res.status(400).json({ error: accessEquipmentError });
    return;
  }
  const duplicate = await Client.findOne({ where: { [Op.or]: [{ mac: rest.mac }, ...(rest.ip ? [{ ip: rest.ip }] : [])] } });
  if (duplicate) {
    res.status(409).json({ error: "Ya existe un cliente con esa MAC o IP; la operación es idempotente y no crea duplicados" });
    return;
  }
  const insertData = {
    ...rest,
    dueDate: dueDate ? new Date(dueDate) : undefined,
  };
  const client = await Client.create(insertData as any);
  await ClientLifecycleEvent.create({
    clientId: client.id,
    status: client.status,
    notes: "Alta de cliente",
    equipmentId: client.equipmentId,
  });
  await ClientChangeHistory.create({
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
      equipmentIp: controller.ip,
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
      dhcpPool: optionalString("dhcpPool"),
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
      equipmentIp: controller?.ip ?? null,
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
  const [row] = await clientRows("WHERE c.id = :id", { id: params.data.id });

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
  const existingClient = await Client.findByPk(params.data.id);
  if (!existingClient) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const { dueDate: ud, ...updateRest } = parsed.data;
  const updateData = {
    ...updateRest,
    ...(ud !== undefined ? { dueDate: ud ? new Date(ud) : null } : {}),
  };
  const effectiveEquipmentId = updateRest.equipmentId ?? existingClient.equipmentId;
  const controller = await Equipment.findByPk(effectiveEquipmentId);
  if (!controller || !isClientController(controller)) {
    res.status(400).json({ error: "El cliente debe estar asociado a un MikroTik con rol Router central" });
    return;
  }
  const accessEquipmentError = await validateAccessEquipment({
    controllerId: effectiveEquipmentId,
    accessPointEquipmentId: updateRest.accessPointEquipmentId !== undefined
      ? updateRest.accessPointEquipmentId
      : existingClient.accessPointEquipmentId,
  });
  if (accessEquipmentError) {
    res.status(400).json({ error: accessEquipmentError });
    return;
  }
  if (updateRest.mac || updateRest.ip) {
    const conflicts = await Client.findOne({ where: {
      id: { [Op.ne]: params.data.id }, [Op.or]: [
        ...(updateRest.mac ? [{ mac: updateRest.mac }] : []),
        ...(updateRest.ip ? [{ ip: updateRest.ip }] : []),
      ],
    } as any });
    if (conflicts) {
      res.status(409).json({ error: "La MAC o IP ya pertenece a otro cliente" });
      return;
    }
  }
  await existingClient.update(updateData as any);
  const client = existingClient;
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
    await ClientChangeHistory.create({
      clientId: client.id,
      changedByUserId: res.locals.user?.id ?? null,
      changeType: "UPDATED",
      reason: typeof req.body?.changeReason === "string" ? req.body.changeReason.trim() || null : null,
      previousData: serializeHistoryValue(previousFields),
      newData: serializeHistoryValue(changedFields),
    });
  }
  if (client.status !== existingClient.status) {
    await ClientLifecycleEvent.create({
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
  res.json(serializeClient({
    ...client,
    equipmentModel: controller?.model ?? null,
    equipmentIp: controller?.ip ?? null,
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
  const client = await Client.findByPk(params.data.id);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  await client.destroy();
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

  const client = await Client.findByPk(params.data.id);
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
