import { Router, type IRouter } from "express";
import { db, proxmoxServersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProxmoxServerBody,
  DeleteProxmoxServerParams,
  GetProxmoxHealthParams,
  ListProxmoxVmsParams,
  StartProxmoxVmParams,
  StopProxmoxVmParams,
  SnapshotProxmoxVmParams,
  SnapshotProxmoxVmBody,
  UpdateProxmoxVmConfigParams,
  UpdateProxmoxVmConfigBody,
} from "@workspace/api-zod";
import {
  getProxmoxTicket,
  getProxmoxNodeStatus,
  listProxmoxVms,
  startVm,
  stopVm,
  createSnapshot,
  updateVmConfig,
} from "../services/proxmox.service";
import { encryptSecret } from "../services/credentials.service";

const router: IRouter = Router();

router.get("/proxmox", async (_req, res): Promise<void> => {
  const servers = await db
    .select({
      id: proxmoxServersTable.id,
      name: proxmoxServersTable.name,
      ip: proxmoxServersTable.ip,
      port: proxmoxServersTable.port,
      username: proxmoxServersTable.username,
      nodeName: proxmoxServersTable.nodeName,
      lastSeenStatus: proxmoxServersTable.lastSeenStatus,
      lastCheckedAt: proxmoxServersTable.lastCheckedAt,
      createdAt: proxmoxServersTable.createdAt,
    })
    .from(proxmoxServersTable)
    .orderBy(proxmoxServersTable.name);
  res.json(servers);
});

router.post("/proxmox", async (req, res): Promise<void> => {
  const parsed = CreateProxmoxServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, ip, port = 8006, username, password, nodeName = "pve" } = parsed.data;
  const [server] = await db
    .insert(proxmoxServersTable)
    .values({ name, ip, port, username, password: encryptSecret(password), nodeName })
    .returning({
      id: proxmoxServersTable.id,
      name: proxmoxServersTable.name,
      ip: proxmoxServersTable.ip,
      port: proxmoxServersTable.port,
      username: proxmoxServersTable.username,
      nodeName: proxmoxServersTable.nodeName,
      lastSeenStatus: proxmoxServersTable.lastSeenStatus,
      lastCheckedAt: proxmoxServersTable.lastCheckedAt,
      createdAt: proxmoxServersTable.createdAt,
    });
  res.status(201).json(server);
});

router.delete("/proxmox/:id", async (req, res): Promise<void> => {
  const params = DeleteProxmoxServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/proxmox/:id/health", async (req, res): Promise<void> => {
  const params = GetProxmoxHealthParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }

  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    await db
      .update(proxmoxServersTable)
      .set({ lastSeenStatus: "OFFLINE", lastCheckedAt: new Date() })
      .where(eq(proxmoxServersTable.id, server.id));
    res.json({ serverId: server.id, status: "OFFLINE" });
    return;
  }

  const health = await getProxmoxNodeStatus(server.ip, server.port, ticket, server.nodeName);
  await db
    .update(proxmoxServersTable)
    .set({ lastSeenStatus: health ? "ONLINE" : "OFFLINE", lastCheckedAt: new Date() })
    .where(eq(proxmoxServersTable.id, server.id));

  res.json({
    serverId: server.id,
    status: health ? "ONLINE" : "OFFLINE",
    ...health,
  });
});

router.get("/proxmox/:id/vms", async (req, res): Promise<void> => {
  const params = ListProxmoxVmsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }

  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    res.json([]);
    return;
  }

  const vms = await listProxmoxVms(server.ip, server.port, ticket, server.nodeName);
  res.json(vms);
});

router.post("/proxmox/:id/vms/:vmid/start", async (req, res): Promise<void> => {
  const params = StartProxmoxVmParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }
  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    res.json({ success: false, message: "No se pudo autenticar con Proxmox" });
    return;
  }
  const result = await startVm(server.ip, server.port, ticket, server.nodeName, params.data.vmid);
  res.json(result);
});

router.post("/proxmox/:id/vms/:vmid/stop", async (req, res): Promise<void> => {
  const params = StopProxmoxVmParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }
  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    res.json({ success: false, message: "No se pudo autenticar con Proxmox" });
    return;
  }
  const result = await stopVm(server.ip, server.port, ticket, server.nodeName, params.data.vmid);
  res.json(result);
});

router.post("/proxmox/:id/vms/:vmid/snapshot", async (req, res): Promise<void> => {
  const params = SnapshotProxmoxVmParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SnapshotProxmoxVmBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }
  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    res.json({ success: false, message: "No se pudo autenticar con Proxmox" });
    return;
  }
  const result = await createSnapshot(
    server.ip, server.port, ticket, server.nodeName,
    params.data.vmid, body.data.snapname, body.data.description
  );
  res.json(result);
});

router.patch("/proxmox/:id/vms/:vmid/config", async (req, res): Promise<void> => {
  const params = UpdateProxmoxVmConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateProxmoxVmConfigBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [server] = await db
    .select()
    .from(proxmoxServersTable)
    .where(eq(proxmoxServersTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Proxmox server not found" });
    return;
  }
  const ticket = await getProxmoxTicket(server.ip, server.port, server.username, server.password);
  if (!ticket) {
    res.json({ success: false, message: "No se pudo autenticar con Proxmox" });
    return;
  }
  const result = await updateVmConfig(
    server.ip, server.port, ticket, server.nodeName, params.data.vmid, body.data
  );
  res.json(result);
});

export default router;
