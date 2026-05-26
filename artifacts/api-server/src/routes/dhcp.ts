import { Router, type IRouter } from "express";
import { db, equipmentTable, clientsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMikroTikDhcpLeases, createStaticDhcpLease, deleteDhcpLease, makeLeaseStatic } from "../services/mikrotik.service";

const router: IRouter = Router();

// GET /equipment/:id/dhcp-leases — list all DHCP leases from an equipment
router.get("/equipment/:id/dhcp-leases", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, id));
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  if (equip.connectionType !== "mikrotik_routeros") {
    res.status(400).json({ error: "Solo equipos MikroTik RouterOS soportan DHCP leases" });
    return;
  }

  const leases = await getMikroTikDhcpLeases(equip.ip, equip.username, equip.password);
  res.json(leases);
});

// POST /equipment/:id/dhcp-leases — create a static lease
router.post("/equipment/:id/dhcp-leases", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { macAddress, fixedIp, comment, dhcpServer } = req.body as {
    macAddress?: string; fixedIp?: string; comment?: string; dhcpServer?: string;
  };
  if (!macAddress || !fixedIp) { res.status(400).json({ error: "macAddress y fixedIp son requeridos" }); return; }

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, id));
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const result = await createStaticDhcpLease(
    equip.ip, equip.username, equip.password,
    macAddress, fixedIp, comment ?? macAddress, dhcpServer
  );

  if (result.success) {
    await db.insert(auditLogsTable).values({
      entity: "DHCP",
      action: "CREATE_STATIC_LEASE",
      commandSent: `/ip/dhcp-server/lease add address=${fixedIp} mac-address=${macAddress}`,
      result: "Success",
      details: `Lease estático: ${macAddress} → ${fixedIp} | ${comment ?? ""}`,
      equipmentId: id,
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

// DELETE /equipment/:id/dhcp-leases/:leaseId — delete a lease
router.delete("/equipment/:id/dhcp-leases/:leaseId", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const leaseId = req.params.leaseId;
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, id));
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const ok = await deleteDhcpLease(equip.ip, equip.username, equip.password, leaseId);
  if (ok) {
    await db.insert(auditLogsTable).values({
      entity: "DHCP",
      action: "DELETE_LEASE",
      commandSent: `/ip/dhcp-server/lease remove ${leaseId}`,
      result: "Success",
      details: `Lease ${leaseId} eliminado del equipo ${equip.model} (${equip.ip})`,
      equipmentId: id,
    });
  }
  res.json({ success: ok });
});

// PATCH /equipment/:id/dhcp-leases/:leaseId/make-static — convert dynamic to static
router.patch("/equipment/:id/dhcp-leases/:leaseId/make-static", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const leaseId = req.params.leaseId;
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, id));
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const ok = await makeLeaseStatic(equip.ip, equip.username, equip.password, leaseId);
  if (ok) {
    await db.insert(auditLogsTable).values({
      entity: "DHCP",
      action: "MAKE_STATIC_LEASE",
      commandSent: `/ip/dhcp-server/lease set ${leaseId} dynamic=false`,
      result: "Success",
      details: `Lease ${leaseId} convertido a estático en ${equip.model} (${equip.ip})`,
      equipmentId: id,
    });
  }
  res.json({ success: ok, message: ok ? "Lease convertido a estático" : "Error al convertir lease" });
});

// POST /clients/:id/dhcp-lease — create static lease for a client on their equipment
router.post("/clients/:id/dhcp-lease", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { fixedIp, dhcpServer } = req.body as { fixedIp?: string; dhcpServer?: string };
  if (!fixedIp) { res.status(400).json({ error: "fixedIp es requerido" }); return; }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const [equip] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, client.equipmentId));
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const result = await createStaticDhcpLease(
    equip.ip, equip.username, equip.password,
    client.mac, fixedIp,
    `Cliente: ${client.name}`,
    dhcpServer
  );

  if (result.success) {
    await db.update(clientsTable).set({ ip: fixedIp }).where(eq(clientsTable.id, id));
    await db.insert(auditLogsTable).values({
      entity: "Client",
      action: "DHCP_STATIC_LEASE",
      commandSent: `/ip/dhcp-server/lease add address=${fixedIp} mac-address=${client.mac}`,
      result: "Success",
      details: `Lease estático para ${client.name}: ${client.mac} → ${fixedIp}`,
      equipmentId: equip.id,
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

export default router;
