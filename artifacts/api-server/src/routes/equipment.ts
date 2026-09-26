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
  GetEquipmentWirelessParams,
} from "@workspace/api-zod";
import { getMikroTikResource } from "../services/mikrotik.service";
import { getUbiquitiStatus, getWirelessTable } from "../services/ubiquiti.service";
import { encryptSecret } from "../services/credentials.service";

const router: IRouter = Router();

const EQUIP_SELECT = {
  id: equipmentTable.id,
  nodeId: equipmentTable.nodeId,
  nodeName: nodesTable.name,
  ip: equipmentTable.ip,
  username: equipmentTable.username,
  model: equipmentTable.model,
  connectionType: equipmentTable.connectionType,
  equipmentRole: equipmentTable.equipmentRole,
  snmpCommunity: equipmentTable.snmpCommunity,
  apiPort: equipmentTable.apiPort,
  lastSeenStatus: equipmentTable.lastSeenStatus,
  lastCheckedAt: equipmentTable.lastCheckedAt,
  createdAt: equipmentTable.createdAt,
  clientCount: sql<number>`count(${clientsTable.id})::int`,
};

router.get("/equipment", async (_req, res): Promise<void> => {
  const rows = await db
    .select(EQUIP_SELECT)
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
  const [equip] = await db.insert(equipmentTable).values({
    ...parsed.data,
    password: encryptSecret(parsed.data.password),
  }).returning();
  res.status(201).json({ ...equip, nodeName: null, clientCount: 0 });
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const params = GetEquipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select(EQUIP_SELECT)
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
  const updateData = {
    ...parsed.data,
    ...(parsed.data.password ? { password: encryptSecret(parsed.data.password) } : {}),
  };
  const [equip] = await db
    .update(equipmentTable)
    .set(updateData)
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

// Live status — dispatches to MikroTik or Ubiquiti service based on connectionType
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

  if (equip.connectionType === "ubiquiti_airos") {
    const result = await getUbiquitiStatus(equip.ip, equip.username, equip.password);
    res.json({
      equipmentId: equip.id,
      connectionType: equip.connectionType,
      status: result.reachable ? "ONLINE" : "OFFLINE",
      boardName: result.boardName,
      firmware: result.firmware,
      frequency: result.frequency,
      txPower: result.txPower,
      noiseFloor: result.noiseFloor,
      airMaxCapacity: result.airMaxCapacity,
      cpuLoad: result.cpuLoad,
      freeMemory: result.freeMemory,
      uptime: result.uptime,
    });
  } else {
    const result = await getMikroTikResource(equip.ip, equip.username, equip.password);
    res.json({
      equipmentId: equip.id,
      connectionType: equip.connectionType,
      status: result.reachable ? "ONLINE" : "OFFLINE",
      cpuLoad: result.cpuLoad,
      freeMemory: result.freeMemory,
      uptime: result.uptime,
      boardName: result.boardName,
      firmware: null,
      frequency: null,
      txPower: null,
      noiseFloor: null,
      airMaxCapacity: null,
    });
  }
});

// Wireless registration table — works for both MikroTik and Ubiquiti
router.get("/equipment/:id/wireless", async (req, res): Promise<void> => {
  const params = GetEquipmentWirelessParams.safeParse(req.params);
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
  const table = await getWirelessTable(equip.ip, equip.username, equip.password, equip.connectionType);
  res.json(table);
});

export default router;
