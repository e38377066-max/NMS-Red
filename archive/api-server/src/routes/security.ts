import { Router, type IRouter, type Request, type Response } from "express";
import { db, equipmentTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createMikroTikAddressEntry,
  createMikroTikSecurityRule,
  deleteMikroTikAddressEntry,
  deleteMikroTikSecurityRule,
  getMikroTikSecurityConfig,
  logSecurityServiceError,
  updateMikroTikSecurityRule,
  validateSecurityRule,
  type SecurityKind,
  type SecurityRuleInput,
} from "../services/mikrotik-security.service";

const router: IRouter = Router();

function isSecurityKind(value: string): value is SecurityKind {
  return value === "filter" || value === "nat" || value === "mangle" || value === "raw";
}

function paramString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function getCoreRouter(id: number) {
  const [equipment] = await db
    .select()
    .from(equipmentTable)
    .where(eq(equipmentTable.id, id));

  if (!equipment) return { error: "Equipo no encontrado", status: 404 as const };
  if (equipment.connectionType !== "mikrotik_routeros" || equipment.equipmentRole !== "core_router") {
    return { error: "La seguridad solo se puede administrar en el Router central MikroTik", status: 400 as const };
  }
  return { equipment };
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function parseRuleInput(body: unknown): Partial<SecurityRuleInput> {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields = [
    "action", "chain", "comment", "protocol", "srcAddress", "dstAddress", "srcPort", "dstPort",
    "srcAddressList", "dstAddressList", "connectionState", "connectionNatState", "connectionMark",
    "packetMark", "routingMark", "newConnectionMark", "newPacketMark", "newRoutingMark",
    "inInterface", "toAddresses", "toPorts", "outInterface", "jumpTarget", "addressList",
    "addressListTimeout", "layer7Protocol", "tcpFlags", "srcMacAddress", "dstMacAddress",
    "connectionBytes", "connectionRate", "nth", "limit", "time", "hotspot", "fragment", "ttl",
    "log", "logPrefix", "passthrough", "placeBefore",
  ] as const;
  const result: Partial<SecurityRuleInput> = {};
  for (const field of fields) {
    const value = cleanText(source[field], field === "comment" ? 240 : 120);
    if (value !== undefined || field === "comment") result[field] = value ?? "";
  }
  return result;
}

function validateAddressInput(body: unknown): { list: string; address: string; comment?: string } | string {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const list = cleanText(source.list, 64);
  const address = cleanText(source.address, 80);
  const comment = cleanText(source.comment, 240);
  if (!list || !/^[a-zA-Z0-9_-]+$/.test(list)) {
    return "El nombre de la lista solo puede contener letras, números, guion y guion bajo.";
  }
  if (!address || /\s/.test(address)) return "Escribe una IP, una red CIDR o una dirección IPv6 válida.";
  return { list, address, ...(comment ? { comment } : {}) };
}

async function writeAudit(
  equipmentId: number,
  action: string,
  operation: string,
  details: string,
): Promise<void> {
  await db.insert(auditLogsTable).values({
    entity: "Firewall",
    action,
    commandSent: operation,
    result: "Success",
    details,
    equipmentId,
  });
}

router.get("/equipment/:id/security", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const result = await getCoreRouter(id);
  if ("error" in result) {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }

  try {
    const config = await getMikroTikSecurityConfig(result.equipment.ip, result.equipment.username, result.equipment.password);
    res.json({
      equipment: {
        id: result.equipment.id,
        model: result.equipment.model,
        ip: result.equipment.ip,
        connectionType: result.equipment.connectionType,
        equipmentRole: result.equipment.equipmentRole,
      },
      ...config,
    });
  } catch (error) {
    logSecurityServiceError(error, { equipmentId: id, operation: "read" });
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo leer la seguridad del router" });
  }
});

router.post("/equipment/:id/security/address-list", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const parsed = validateAddressInput(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }

  const result = await getCoreRouter(id);
  if ("error" in result) {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }

  try {
    const item = await createMikroTikAddressEntry(
      result.equipment.ip,
      result.equipment.username,
      result.equipment.password,
      parsed.list,
      parsed.address,
      parsed.comment,
    );
    await writeAudit(
      id,
      "CREATE_ADDRESS_LIST_ENTRY",
      `/ip/firewall/address-list add list=${parsed.list} address=${parsed.address}`,
      `Dirección ${parsed.address} agregada a la lista ${parsed.list}`,
    );
    res.status(201).json({ success: true, message: `La dirección se agregó a ${parsed.list}.`, item });
  } catch (error) {
    logSecurityServiceError(error, { equipmentId: id, operation: "create-address-list-entry" });
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo agregar la dirección" });
  }
});

router.delete("/equipment/:id/security/address-list/:entryId", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const entryId = paramString(req.params.entryId);
  if (isNaN(id) || !entryId) {
    res.status(400).json({ error: "Solicitud de dirección inválida" });
    return;
  }

  const result = await getCoreRouter(id);
  if ("error" in result) {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }

  try {
    await deleteMikroTikAddressEntry(result.equipment.ip, result.equipment.username, result.equipment.password, entryId);
    await writeAudit(
      id,
      "DELETE_ADDRESS_LIST_ENTRY",
      `/ip/firewall/address-list remove ${entryId}`,
      `Dirección ${entryId} eliminada desde el CRM`,
    );
    res.json({ success: true, message: "La dirección fue eliminada de la lista." });
  } catch (error) {
    logSecurityServiceError(error, { equipmentId: id, entryId, operation: "delete-address-list-entry" });
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo eliminar la dirección" });
  }
});

router.post("/equipment/:id/security/:kind", async (req, res): Promise<void> => {
  await mutateRule(req, res, "create");
});

router.patch("/equipment/:id/security/:kind/:ruleId", async (req, res): Promise<void> => {
  await mutateRule(req, res, "update");
});

router.delete("/equipment/:id/security/:kind/:ruleId", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const kind = paramString(req.params.kind);
  const ruleId = paramString(req.params.ruleId);
  if (isNaN(id) || !kind || !ruleId || !isSecurityKind(kind)) {
    res.status(400).json({ error: "Solicitud de regla inválida" });
    return;
  }

  const result = await getCoreRouter(id);
  if ("error" in result) {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }

  try {
    await deleteMikroTikSecurityRule(result.equipment.ip, result.equipment.username, result.equipment.password, kind, ruleId);
    await writeAudit(
      id,
      `DELETE_${kind.toUpperCase()}_RULE`,
      `/ip/firewall/${kind} remove ${ruleId}`,
      `Regla ${ruleId} eliminada desde el CRM`,
    );
    res.json({ success: true, message: "La regla fue eliminada del RouterOS." });
  } catch (error) {
    logSecurityServiceError(error, { equipmentId: id, kind, ruleId, operation: "delete-rule" });
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo eliminar la regla" });
  }
});

async function mutateRule(
  req: Request,
  res: Response,
  operation: "create" | "update",
): Promise<void> {
  const id = Number(req.params.id);
  const kind = paramString(req.params.kind);
  const ruleId = paramString(req.params.ruleId);
  if (isNaN(id) || !kind || !isSecurityKind(kind) || (operation === "update" && !ruleId)) {
    res.status(400).json({ error: "Solicitud de regla inválida" });
    return;
  }

  const input = parseRuleInput(req.body);
  const validationError = validateSecurityRule(kind, input, operation === "update");
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const targetRuleId = ruleId ?? "";

  const result = await getCoreRouter(id);
  if ("error" in result) {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }

  try {
    const item = operation === "create"
      ? await createMikroTikSecurityRule(result.equipment.ip, result.equipment.username, result.equipment.password, kind, input as SecurityRuleInput)
      : await updateMikroTikSecurityRule(result.equipment.ip, result.equipment.username, result.equipment.password, kind, targetRuleId, input);
    await writeAudit(
      id,
      `${operation === "create" ? "CREATE" : "UPDATE"}_${kind.toUpperCase()}_RULE`,
      `/ip/firewall/${kind} ${operation} ${JSON.stringify(input).slice(0, 500)}`,
      `${operation === "create" ? "Regla creada" : "Regla actualizada"}: ${input.comment || ruleId}`,
    );
    res.status(operation === "create" ? 201 : 200).json({
      success: true,
      message: operation === "create" ? "La regla fue creada en el RouterOS." : "La regla fue actualizada en el RouterOS.",
      item,
    });
  } catch (error) {
    logSecurityServiceError(error, { equipmentId: id, kind, ruleId, operation: `${operation}-rule` });
    res.status(502).json({ error: error instanceof Error ? error.message : "No se pudo aplicar la regla" });
  }
}

export default router;