import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, equipmentTable, nodesTable, clientsTable } from "@workspace/db";
import {
  CreateEquipmentBody,
  UpdateEquipmentBody,
  GetEquipmentParams,
  UpdateEquipmentParams,
  DeleteEquipmentParams,
  GetEquipmentStatusParams,
} from "@workspace/api-zod";
import { getMikroTikResource } from "../services/mikrotik.service";

const router: IRouter = Router();

router.get("/equipment", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: equipmentTable.id,
      nodeId: equipmentTable.nodeId,
      nodeName: nodesTable.name,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      model: equipmentTable.model,
      lastSeenStatus: equipmentTable.lastSeenStatus,
      lastCheckedAt: equipmentTable.lastCheckedAt,
      createdAt: equipmentTable.createdAt,
      clientCount: sql<number>`count(${clientsTable.id})::int`,
    })
    .from(equipmentTable)
    .leftJoin(nodesTable, eq(nodesTable.id, equipmentTable.nodeId))
    .leftJoin(clientsTable, eq(clientsTable.equipmentId, equipmentTable.id))
    .groupBy(equipmentTable.id, nodesTable.name)
    .orderBy(equipmentTable.model);

  res.json(rows);
});

router.post("/equipment", async (req, res): Promise<void> => {
  const parsed = CreateEquipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [equip] = await db.insert(equipmentTable).values(parsed.data).returning();
  res.status(201).json({ ...equip, nodeName: null, clientCount: 0 });
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const params = GetEquipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({
      id: equipmentTable.id,
      nodeId: equipmentTable.nodeId,
      nodeName: nodesTable.name,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      model: equipmentTable.model,
      lastSeenStatus: equipmentTable.lastSeenStatus,
      lastCheckedAt: equipmentTable.lastCheckedAt,
      createdAt: equipmentTable.createdAt,
      clientCount: sql<number>`count(${clientsTable.id})::int`,
    })
    .from(equipmentTable)
    .leftJoin(nodesTable, eq(nodesTable.id, equipmentTable.nodeId))
    .leftJoin(clientsTable, eq(clientsTable.equipmentId, equipmentTable.id))
    .where(eq(equipmentTable.id, params.data.id))
    .groupBy(equipmentTable.id, nodesTable.name);

  if (!row) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  res.json(row);
});

router.patch("/equipment/:id", async (req, res): Promise<void> => {
  const params = UpdateEquipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEquipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [equip] = await db
    .update(equipmentTable)
    .set(parsed.data)
    .where(eq(equipmentTable.id, params.data.id))
    .returning();
  if (!equip) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  res.json({ ...equip, nodeName: null, clientCount: 0 });
});

router.delete("/equipment/:id", async (req, res): Promise<void> => {
  const params = DeleteEquipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [equip] = await db
    .delete(equipmentTable)
    .where(eq(equipmentTable.id, params.data.id))
    .returning();
  if (!equip) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/equipment/:id/status", async (req, res): Promise<void> => {
  const params = GetEquipmentStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [equip] = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.id, params.data.id));
  if (!equip) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  const result = await getMikroTikResource(equip.ip, equip.username, equip.password);
  res.json({
    equipmentId: equip.id,
    status: result.reachable ? "ONLINE" : "OFFLINE",
    cpuLoad: result.cpuLoad,
    freeMemory: result.freeMemory,
    uptime: result.uptime,
    boardName: result.boardName,
  });
});

export default router;
