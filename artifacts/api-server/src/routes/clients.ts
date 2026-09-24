import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable, equipmentTable, auditLogsTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
  ChangeClientSpeedParams,
  ChangeClientSpeedBody,
} from "@workspace/api-zod";
import { setClientSpeedLimit } from "../services/mikrotik.service";
import { extractUserFromRequest } from "../services/auth.service";

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
  createdAt: Date;
}) {
  return {
    ...row,
    dueDate: row.dueDate?.toISOString() ?? null,
    lastPaymentDate: row.lastPaymentDate?.toISOString() ?? null,
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
  const insertData = {
    ...rest,
    dueDate: dueDate ? new Date(dueDate) : undefined,
  };
  const [client] = await db.insert(clientsTable).values(insertData).returning();
  res.status(201).json(serializeClient({
    ...client,
    equipmentModel: controller.model,
    equipmentRole: controller.equipmentRole,
    connectionType: controller.connectionType,
  }));
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
  const { dueDate: ud, ...updateRest } = parsed.data;
  const updateData = {
    ...updateRest,
    ...(ud !== undefined ? { dueDate: ud ? new Date(ud) : null } : {}),
  };
  const [client] = await db
    .update(clientsTable)
    .set(updateData)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
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

  const authUser = extractUserFromRequest(req.headers.authorization);
  const result = await setClientSpeedLimit(
    equip.ip,
    equip.username,
    equip.password,
    client.mac,
    parsed.data.newLimit,
    client.ip ?? undefined,
    client.name,
  );

  await db.insert(auditLogsTable).values({
    userId: authUser?.id ?? parsed.data.userId ?? null,
    username: authUser?.username ?? "operador",
    equipmentId: equip.id,
    entity: "Client",
    action: "SPEED_CHANGE",
    commandSent: `/queue/simple set max-limit=${parsed.data.newLimit} target=${client.mac}`,
    result: result.success ? "Success" : "Fail",
    details: `Cliente: ${client.name} (${client.mac}) | Nuevo plan: ${parsed.data.newLimit} | ${result.message}`,
  });

  if (result.success) {
    await db
      .update(clientsTable)
      .set({ planLimit: parsed.data.newLimit })
      .where(eq(clientsTable.id, params.data.id));
  }

  res.json({
    success: result.success,
    message: result.message,
    requiresConfirmation: null,
    warning: null,
  });
});

function parseMbps(limit: string): number {
  const match = limit.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export default router;
