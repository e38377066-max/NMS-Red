import { Router, type IRouter } from "express";
import { Equipment, sequelize } from "../db";
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

async function validateParentAssignment(input: {
  equipmentId?: number;
  connectionType: string;
  parentEquipmentId: number | null | undefined;
  parentCapacityLimit: string | null | undefined;
}): Promise<string | null> {
  const parentId = input.parentEquipmentId ?? null;
  const limit = input.parentCapacityLimit?.trim() || null;
  if (!parentId) {
    return limit ? "La capacidad asignada requiere seleccionar un MikroTik padre" : null;
  }
  if (input.connectionType !== "mikrotik_routeros") {
    return "Solo se pueden encadenar equipos MikroTik RouterOS";
  }
  if (input.equipmentId === parentId) {
    return "Un equipo no puede ser su propio padre";
  }
  if (!limit) {
    return "Indica la capacidad asignada desde el MikroTik padre (por ejemplo 100M/100M)";
  }

  const visited = new Set<number>();
  let currentId: number | null = parentId;
  while (currentId !== null) {
    if (currentId === input.equipmentId) {
      return "La relación crearía un ciclo en la topología";
    }
    if (visited.has(currentId)) {
      return "La topología existente contiene un ciclo y no se puede ampliar";
    }
    visited.add(currentId);
    const parent: { connectionType: string; parentEquipmentId: number | null } | null =
      await Equipment.findByPk(currentId, { attributes: ["id", "connectionType", "parentEquipmentId"] });
    if (!parent) return "El MikroTik padre seleccionado no existe";
    if (parent.connectionType !== "mikrotik_routeros") {
      return "Solo se pueden encadenar equipos MikroTik RouterOS";
    }
    currentId = parent.parentEquipmentId;
  }
  return null;
}

router.get("/equipment", async (_req, res): Promise<void> => {
  const rows = await sequelize.query(`SELECT e.id, e.node_id AS "nodeId", n.name AS "nodeName", e.ip, e.username, e.model,
    e.connection_type AS "connectionType", e.equipment_role AS "equipmentRole", e.parent_equipment_id AS "parentEquipmentId",
    e.parent_capacity_limit AS "parentCapacityLimit", e.snmp_community AS "snmpCommunity", e.api_port AS "apiPort",
    e.last_seen_status AS "lastSeenStatus", e.last_checked_at AS "lastCheckedAt", e.created_at AS "createdAt",
    COUNT(c.id)::int AS "clientCount"
    FROM equipment e LEFT JOIN nodes n ON n.id=e.node_id LEFT JOIN clients c ON c.equipment_id=e.id
    GROUP BY e.id,n.name ORDER BY e.model`, { type: "SELECT" }) as any[];
  res.json(rows);
});

router.post("/equipment", async (req, res): Promise<void> => {
  const parsed = CreateEquipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const topologyError = await validateParentAssignment({
    connectionType: parsed.data.connectionType,
    parentEquipmentId: parsed.data.parentEquipmentId,
    parentCapacityLimit: parsed.data.parentCapacityLimit,
  });
  if (topologyError) {
    res.status(400).json({ error: topologyError });
    return;
  }
  const equip = await Equipment.create({ ...parsed.data, password: encryptSecret(parsed.data.password) } as any);
  res.status(201).json({ ...equip, nodeName: null, clientCount: 0 });
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const params = GetEquipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await sequelize.query(`SELECT e.id, e.node_id AS "nodeId", n.name AS "nodeName", e.ip, e.username, e.model,
    e.connection_type AS "connectionType", e.equipment_role AS "equipmentRole", e.parent_equipment_id AS "parentEquipmentId",
    e.parent_capacity_limit AS "parentCapacityLimit", e.snmp_community AS "snmpCommunity", e.api_port AS "apiPort",
    e.last_seen_status AS "lastSeenStatus", e.last_checked_at AS "lastCheckedAt", e.created_at AS "createdAt",
    COUNT(c.id)::int AS "clientCount"
    FROM equipment e LEFT JOIN nodes n ON n.id=e.node_id LEFT JOIN clients c ON c.equipment_id=e.id
    WHERE e.id = :id GROUP BY e.id,n.name`, { replacements: { id: params.data.id }, type: "SELECT" }) as any[];
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
  const existing = await Equipment.findByPk(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  const effectiveParentId = parsed.data.parentEquipmentId !== undefined
    ? parsed.data.parentEquipmentId
    : existing.parentEquipmentId;
  const effectiveCapacityLimit = parsed.data.parentCapacityLimit !== undefined
    ? parsed.data.parentCapacityLimit
    : effectiveParentId === existing.parentEquipmentId ? existing.parentCapacityLimit : null;
  const topologyError = await validateParentAssignment({
    equipmentId: existing.id,
    connectionType: parsed.data.connectionType ?? existing.connectionType,
    parentEquipmentId: effectiveParentId,
    parentCapacityLimit: effectiveCapacityLimit,
  });
  if (topologyError) {
    res.status(400).json({ error: topologyError });
    return;
  }
  const children = { count: await Equipment.count({ where: { parentEquipmentId: existing.id } }) };
  if (
    parsed.data.connectionType !== undefined &&
    parsed.data.connectionType !== "mikrotik_routeros" &&
    Number(children?.count ?? 0) > 0
  ) {
    res.status(409).json({ error: "No se puede cambiar a airOS un MikroTik que tiene equipos dependientes" });
    return;
  }
  const updateData = {
    ...parsed.data,
    ...(parsed.data.parentEquipmentId === null && parsed.data.parentCapacityLimit === undefined
      ? { parentCapacityLimit: null }
      : {}),
    ...(parsed.data.password ? { password: encryptSecret(parsed.data.password) } : {}),
  };
  await existing.update(updateData as any);
  const equip = existing;
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
  const equip = await Equipment.findByPk(params.data.id, { attributes: ["id"] });
  if (!equip) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  await Equipment.update({ parentEquipmentId: null, parentCapacityLimit: null }, { where: { parentEquipmentId: params.data.id } });
  const deleted = await Equipment.destroy({ where: { id: params.data.id } });
  if (!deleted) {
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
  const equip = await Equipment.findByPk(params.data.id);
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
  const equip = await Equipment.findByPk(params.data.id);
  if (!equip) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  const table = await getWirelessTable(equip.ip, equip.username, equip.password, equip.connectionType);
  res.json(table);
});

export default router;
