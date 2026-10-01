import { Router, type IRouter } from "express";
import { Op } from "sequelize";
import { Equipment, Client, AuditLog, sequelize } from "../db";
import { getMikroTikDhcpLeases, createStaticDhcpLease, deleteDhcpLease, makeLeaseStatic, setClientSpeedLimit } from "../services/mikrotik.service";

const router: IRouter = Router();

// GET /equipment/:id/dhcp-leases — list all DHCP leases from an equipment
router.get("/equipment/:id/dhcp-leases", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const equip = await Equipment.findByPk(id);
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

  const { macAddress, fixedIp, comment, dhcpServer, rateLimit } = req.body as {
    macAddress?: string; fixedIp?: string; comment?: string; dhcpServer?: string; rateLimit?: string;
  };
  if (!macAddress || !fixedIp) { res.status(400).json({ error: "macAddress y fixedIp son requeridos" }); return; }

  const equip = await Equipment.findByPk(id);
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const result = await createStaticDhcpLease(
    equip.ip, equip.username, equip.password,
    macAddress, fixedIp, comment ?? macAddress, dhcpServer, rateLimit
  );

  if (result.success) {
    await AuditLog.create({
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

  const equip = await Equipment.findByPk(id);
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const ok = await deleteDhcpLease(equip.ip, equip.username, equip.password, leaseId);
  if (ok) {
    await AuditLog.create({
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
  const requestedClientId = Number((req.body as { clientId?: number } | undefined)?.clientId);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const equip = await Equipment.findByPk(id);
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const leases = await getMikroTikDhcpLeases(equip.ip, equip.username, equip.password);
  const lease = leases.find((item) => item.id === leaseId);
  const requestedClient = Number.isInteger(requestedClientId) && requestedClientId > 0
    ? await Client.findOne({ where: { id: requestedClientId, equipmentId: id } })
    : null;
  const linkedClients = requestedClient
    ? [requestedClient]
    : lease?.macAddress
      ? await Client.findAll({ where: {
        equipmentId: id,
        [Op.and]: sequelize.where(sequelize.fn("lower", sequelize.col("mac")), lease.macAddress.toLowerCase()),
      } as any })
      : [];
  const linkedClient = linkedClients[0];
  const clientComment = linkedClient ? `Cliente: ${linkedClient.name}` : undefined;
  const ok = await makeLeaseStatic(equip.ip, equip.username, equip.password, leaseId, clientComment);
  let rateLimitConfigured: boolean | null = null;
  let rateLimitMessage: string | null = null;
  if (ok) {
    if (linkedClient && lease?.address) {
       await linkedClient.update({
         ip: lease.address,
         ...(lease.dhcpServer ? { dhcpServer: lease.dhcpServer } : {}),
       })
      const limit = await setClientSpeedLimit(
        equip.ip,
        equip.username,
        equip.password,
        linkedClient.mac,
        linkedClient.planLimit,
        lease.address,
        linkedClient.name,
      );
      rateLimitConfigured = limit.success;
      rateLimitMessage = limit.message;
    }
    await AuditLog.create({
      entity: "DHCP",
      action: "MAKE_STATIC_LEASE",
      commandSent: `/ip/dhcp-server/lease set ${leaseId} dynamic=false`,
      result: "Success",
      details: `Lease ${leaseId} convertido a estático${linkedClient ? ` para ${linkedClient.name}` : ""} en ${equip.model} (${equip.ip})`,
      equipmentId: id,
    });
  }
  res.json({
    success: ok,
    message: ok
      ? linkedClient ? `Lease estático vinculado a ${linkedClient.name}` : "Lease convertido a estático"
      : "Error al convertir lease",
    clientName: linkedClient?.name ?? null,
    rateLimitConfigured,
    rateLimitMessage,
  });
});

// POST /clients/:id/dhcp-lease — create static lease for a client on their equipment
router.post("/clients/:id/dhcp-lease", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { fixedIp, dhcpServer } = req.body as { fixedIp?: string; dhcpServer?: string };
  if (!fixedIp) { res.status(400).json({ error: "fixedIp es requerido" }); return; }

  const client = await Client.findByPk(id);
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

  const equip = await Equipment.findByPk(client.equipmentId);
  if (!equip) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const result = await createStaticDhcpLease(
    equip.ip, equip.username, equip.password,
    client.mac, fixedIp,
    `Cliente: ${client.name}`,
    dhcpServer,
    client.planLimit
  );

  if (result.success) {
    await client.update({
      ip: fixedIp,
      ...(dhcpServer ? { dhcpServer } : {}),
    });
    const queue = await setClientSpeedLimit(
      equip.ip,
      equip.username,
      equip.password,
      client.mac,
      client.planLimit,
      fixedIp,
      client.name,
    );
    await AuditLog.create({
      entity: "Client",
      action: "DHCP_STATIC_LEASE",
      commandSent: `/ip/dhcp-server/lease add address=${fixedIp} mac-address=${client.mac}`,
      result: "Success",
      details: `Lease estático para ${client.name}: ${client.mac} → ${fixedIp}`,
      equipmentId: equip.id,
    });
    res.status(201).json({
      ...result,
      rateLimitConfigured: queue.success,
      rateLimitMessage: queue.message,
      message: queue.success
        ? `${result.message}. Límite DHCP de ${client.name} sincronizado a ${client.planLimit}.`
        : `${result.message}. Advertencia: no se pudo sincronizar el límite DHCP: ${queue.message}`,
    });
    return;
  }

  res.status(result.success ? 201 : 400).json(result);
});

export default router;
