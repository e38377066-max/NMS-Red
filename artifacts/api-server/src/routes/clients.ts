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

router.get("/clients", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: clientsTable.id,
      equipmentId: clientsTable.equipmentId,
      equipmentModel: equipmentTable.model,
      mac: clientsTable.mac,
      ip: clientsTable.ip,
      name: clientsTable.name,
      planLimit: clientsTable.planLimit,
      status: clientsTable.status,
      lastSeenDbm: clientsTable.lastSeenDbm,
      createdAt: clientsTable.createdAt,
    })
    .from(clientsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, clientsTable.equipmentId))
    .orderBy(clientsTable.name);
  res.json(rows);
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db.insert(clientsTable).values(parsed.data).returning();
  res.status(201).json({ ...client, equipmentModel: null });
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({
      id: clientsTable.id,
      equipmentId: clientsTable.equipmentId,
      equipmentModel: equipmentTable.model,
      mac: clientsTable.mac,
      ip: clientsTable.ip,
      name: clientsTable.name,
      planLimit: clientsTable.planLimit,
      status: clientsTable.status,
      lastSeenDbm: clientsTable.lastSeenDbm,
      createdAt: clientsTable.createdAt,
    })
    .from(clientsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, clientsTable.equipmentId))
    .where(eq(clientsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(row);
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
  const [client] = await db
    .update(clientsTable)
    .set(parsed.data)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json({ ...client, equipmentModel: null });
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

  const [equip] = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.id, client.equipmentId));
  if (!equip) {
    res.status(404).json({ error: "Equipment not found for this client" });
    return;
  }

  // Dry Run validation
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

  // Actually apply the speed change
  const authUser = extractUserFromRequest(req.headers.authorization);
  const result = await setClientSpeedLimit(equip.ip, equip.username, equip.password, client.mac, parsed.data.newLimit);

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
