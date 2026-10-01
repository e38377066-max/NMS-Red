import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, nodesTable, equipmentTable } from "@workspace/db";
import {
  CreateNodeBody,
  UpdateNodeBody,
  GetNodeParams,
  UpdateNodeParams,
  DeleteNodeParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/nodes", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: nodesTable.id,
      name: nodesTable.name,
      location: nodesTable.location,
      role: nodesTable.role,
      createdAt: nodesTable.createdAt,
      equipmentCount: sql<number>`count(${equipmentTable.id})::int`,
    })
    .from(nodesTable)
    .leftJoin(equipmentTable, eq(equipmentTable.nodeId, nodesTable.id))
    .groupBy(nodesTable.id)
    .orderBy(nodesTable.name);

  res.json(rows);
});

router.post("/nodes", async (req, res): Promise<void> => {
  const parsed = CreateNodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [node] = await db.insert(nodesTable).values(parsed.data).returning();
  res.status(201).json(node);
});

router.get("/nodes/:id", async (req, res): Promise<void> => {
  const params = GetNodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({
      id: nodesTable.id,
      name: nodesTable.name,
      location: nodesTable.location,
      role: nodesTable.role,
      createdAt: nodesTable.createdAt,
      equipmentCount: sql<number>`count(${equipmentTable.id})::int`,
    })
    .from(nodesTable)
    .leftJoin(equipmentTable, eq(equipmentTable.nodeId, nodesTable.id))
    .where(eq(nodesTable.id, params.data.id))
    .groupBy(nodesTable.id);

  if (!row) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.json(row);
});

router.patch("/nodes/:id", async (req, res): Promise<void> => {
  const params = UpdateNodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [node] = await db
    .update(nodesTable)
    .set(parsed.data)
    .where(eq(nodesTable.id, params.data.id))
    .returning();
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.json(node);
});

router.delete("/nodes/:id", async (req, res): Promise<void> => {
  const params = DeleteNodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [node] = await db
    .delete(nodesTable)
    .where(eq(nodesTable.id, params.data.id))
    .returning();
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
