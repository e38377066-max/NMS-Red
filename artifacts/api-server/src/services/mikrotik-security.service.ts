import { logger } from "../lib/logger";
import { decryptSecret } from "./credentials.service";

export type SecurityKind = "filter" | "nat" | "mangle" | "raw";

export interface SecurityRuleInput {
  action: string;
  chain: string;
  comment: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  srcAddressList?: string;
  dstAddressList?: string;
  connectionState?: string;
  connectionNatState?: string;
  connectionMark?: string;
  packetMark?: string;
  routingMark?: string;
  newConnectionMark?: string;
  newPacketMark?: string;
  newRoutingMark?: string;
  inInterface?: string;
  toAddresses?: string;
  toPorts?: string;
  outInterface?: string;
  jumpTarget?: string;
  addressList?: string;
  addressListTimeout?: string;
  layer7Protocol?: string;
  tcpFlags?: string;
  srcMacAddress?: string;
  dstMacAddress?: string;
  connectionBytes?: string;
  connectionRate?: string;
  nth?: string;
  limit?: string;
  time?: string;
  hotspot?: string;
  fragment?: string;
  ttl?: string;
  log?: string;
  logPrefix?: string;
  passthrough?: string;
  placeBefore?: string;
}

export interface SecurityRule {
  id: string;
  action: string | null;
  chain: string | null;
  comment: string | null;
  protocol: string | null;
  srcAddress: string | null;
  dstAddress: string | null;
  srcPort: string | null;
  dstPort: string | null;
  srcAddressList: string | null;
  dstAddressList: string | null;
  connectionState: string | null;
  connectionNatState: string | null;
  connectionMark: string | null;
  packetMark: string | null;
  routingMark: string | null;
  newConnectionMark: string | null;
  newPacketMark: string | null;
  newRoutingMark: string | null;
  inInterface: string | null;
  toAddresses: string | null;
  toPorts: string | null;
  outInterface: string | null;
  jumpTarget: string | null;
  addressList: string | null;
  addressListTimeout: string | null;
  layer7Protocol: string | null;
  tcpFlags: string | null;
  srcMacAddress: string | null;
  dstMacAddress: string | null;
  connectionBytes: string | null;
  connectionRate: string | null;
  nth: string | null;
  limit: string | null;
  time: string | null;
  hotspot: string | null;
  fragment: string | null;
  ttl: string | null;
  log: string | null;
  logPrefix: string | null;
  passthrough: string | null;
}

export interface SecurityAddressEntry {
  id: string;
  list: string | null;
  address: string | null;
  comment: string | null;
}

export interface SecurityService {
  id: string;
  name: string | null;
  port: string | null;
  address: string | null;
  disabled: string | null;
  comment: string | null;
}

const RULE_FIELDS: Record<string, string> = {
  action: "action",
  chain: "chain",
  comment: "comment",
  protocol: "protocol",
  srcAddress: "src-address",
  dstAddress: "dst-address",
  srcPort: "src-port",
  dstPort: "dst-port",
  srcAddressList: "src-address-list",
  dstAddressList: "dst-address-list",
  connectionState: "connection-state",
  connectionNatState: "connection-nat-state",
  connectionMark: "connection-mark",
  packetMark: "packet-mark",
  routingMark: "routing-mark",
  newConnectionMark: "new-connection-mark",
  newPacketMark: "new-packet-mark",
  newRoutingMark: "new-routing-mark",
  inInterface: "in-interface",
  toAddresses: "to-addresses",
  toPorts: "to-ports",
  outInterface: "out-interface",
  jumpTarget: "jump-target",
  addressList: "address-list",
  addressListTimeout: "address-list-timeout",
  layer7Protocol: "layer7-protocol",
  tcpFlags: "tcp-flags",
  srcMacAddress: "src-mac-address",
  dstMacAddress: "dst-mac-address",
  connectionBytes: "connection-bytes",
  connectionRate: "connection-rate",
  nth: "nth",
  limit: "limit",
  time: "time",
  hotspot: "hotspot",
  fragment: "fragment",
  ttl: "ttl",
  log: "log",
  logPrefix: "log-prefix",
  passthrough: "passthrough",
  placeBefore: "place-before",
};

const SECURITY_PATHS: Record<SecurityKind, string> = {
  filter: "/ip/firewall/filter",
  nat: "/ip/firewall/nat",
  mangle: "/ip/firewall/mangle",
  raw: "/ip/firewall/raw",
};

function headers(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${decryptSecret(password)}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function mikrotikBaseUrl(ip: string): string {
  const scheme = process.env.MIKROTIK_API_SCHEME
    ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const port = process.env.MIKROTIK_API_PORT?.trim();
  return `${scheme}://${ip}${port ? `:${port}` : ""}/rest`;
}

async function restFetch(
  ip: string,
  username: string,
  password: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(`${mikrotikBaseUrl(ip)}${path}`, {
      ...options,
      headers: { ...headers(username, password), ...(options.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function serializeRule(raw: Record<string, string>): SecurityRule {
  return {
    id: raw[".id"] ?? "",
    action: raw.action ?? null,
    chain: raw.chain ?? null,
    comment: raw.comment ?? null,
    protocol: raw.protocol ?? null,
    srcAddress: raw["src-address"] ?? null,
    dstAddress: raw["dst-address"] ?? null,
    srcPort: raw["src-port"] ?? null,
    dstPort: raw["dst-port"] ?? null,
    srcAddressList: raw["src-address-list"] ?? null,
    dstAddressList: raw["dst-address-list"] ?? null,
    connectionState: raw["connection-state"] ?? null,
    connectionNatState: raw["connection-nat-state"] ?? null,
    connectionMark: raw["connection-mark"] ?? null,
    packetMark: raw["packet-mark"] ?? null,
    routingMark: raw["routing-mark"] ?? null,
    newConnectionMark: raw["new-connection-mark"] ?? null,
    newPacketMark: raw["new-packet-mark"] ?? null,
    newRoutingMark: raw["new-routing-mark"] ?? null,
    inInterface: raw["in-interface"] ?? null,
    toAddresses: raw["to-addresses"] ?? null,
    toPorts: raw["to-ports"] ?? null,
    outInterface: raw["out-interface"] ?? null,
    jumpTarget: raw["jump-target"] ?? null,
    addressList: raw["address-list"] ?? null,
    addressListTimeout: raw["address-list-timeout"] ?? null,
    layer7Protocol: raw["layer7-protocol"] ?? null,
    tcpFlags: raw["tcp-flags"] ?? null,
    srcMacAddress: raw["src-mac-address"] ?? null,
    dstMacAddress: raw["dst-mac-address"] ?? null,
    connectionBytes: raw["connection-bytes"] ?? null,
    connectionRate: raw["connection-rate"] ?? null,
    nth: raw.nth ?? null,
    limit: raw.limit ?? null,
    time: raw.time ?? null,
    hotspot: raw.hotspot ?? null,
    fragment: raw.fragment ?? null,
    ttl: raw.ttl ?? null,
    log: raw.log ?? null,
    logPrefix: raw["log-prefix"] ?? null,
    passthrough: raw.passthrough ?? null,
  };
}

function serializeAddress(raw: Record<string, string>): SecurityAddressEntry {
  return {
    id: raw[".id"] ?? "",
    list: raw.list ?? null,
    address: raw.address ?? null,
    comment: raw.comment ?? null,
  };
}

function serializeService(raw: Record<string, string>): SecurityService {
  return {
    id: raw[".id"] ?? "",
    name: raw.name ?? null,
    port: raw.port ?? null,
    address: raw.address ?? null,
    disabled: raw.disabled ?? null,
    comment: raw.comment ?? null,
  };
}

export function toRouterOsRuleBody(input: Partial<SecurityRuleInput>, kind: SecurityKind): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [field, routerField] of Object.entries(RULE_FIELDS)) {
    const value = input[field as keyof SecurityRuleInput];
    if (value !== undefined && value !== null && (value !== "" || field === "comment")) {
      body[routerField] = String(value).trim();
    }
  }

  return body;
}

async function getCollection(
  ip: string,
  username: string,
  password: string,
  path: string,
): Promise<Array<Record<string, string>>> {
  const response = await restFetch(ip, username, password, path);
  if (!response.ok) {
    throw new Error(`RouterOS rechazó la lectura de ${path}: HTTP ${response.status}`);
  }
  return readJson<Array<Record<string, string>>>(response);
}

export async function getMikroTikSecurityConfig(ip: string, username: string, password: string) {
  const [filters, nat, mangle, raw, addresses, services] = await Promise.all([
    getCollection(ip, username, password, "/ip/firewall/filter"),
    getCollection(ip, username, password, "/ip/firewall/nat"),
    getCollection(ip, username, password, "/ip/firewall/mangle"),
    getCollection(ip, username, password, "/ip/firewall/raw"),
    getCollection(ip, username, password, "/ip/firewall/address-list"),
    getCollection(ip, username, password, "/ip/service"),
  ]);

  return {
    filters: filters.map(serializeRule),
    nat: nat.map(serializeRule),
    mangle: mangle.map(serializeRule),
    raw: raw.map(serializeRule),
    addressLists: addresses.map(serializeAddress),
    services: services.map(serializeService),
  };
}

export async function createMikroTikSecurityRule(
  ip: string,
  username: string,
  password: string,
  kind: SecurityKind,
  input: SecurityRuleInput,
) {
  const path = SECURITY_PATHS[kind];
  const response = await restFetch(ip, username, password, path, {
    method: "POST",
    body: JSON.stringify(toRouterOsRuleBody(input, kind)),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`RouterOS rechazó la regla: HTTP ${response.status} ${details}`);
  }
  const item = await readJson<Record<string, string>>(response);
  return serializeRule(item);
}

export async function updateMikroTikSecurityRule(
  ip: string,
  username: string,
  password: string,
  kind: SecurityKind,
  ruleId: string,
  input: Partial<SecurityRuleInput>,
) {
  const path = `${SECURITY_PATHS[kind]}/${encodeURIComponent(ruleId)}`;
  const response = await restFetch(ip, username, password, path, {
    method: "PATCH",
    body: JSON.stringify(toRouterOsRuleBody(input, kind)),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`RouterOS rechazó la actualización: HTTP ${response.status} ${details}`);
  }
  const item = await readJson<Record<string, string>>(response);
  return serializeRule(item);
}

export async function deleteMikroTikSecurityRule(
  ip: string,
  username: string,
  password: string,
  kind: SecurityKind,
  ruleId: string,
): Promise<void> {
  const path = `${SECURITY_PATHS[kind]}/${encodeURIComponent(ruleId)}`;
  const response = await restFetch(ip, username, password, path, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const details = await response.text().catch(() => "");
    throw new Error(`RouterOS rechazó la eliminación: HTTP ${response.status} ${details}`);
  }
}

export async function createMikroTikAddressEntry(
  ip: string,
  username: string,
  password: string,
  list: string,
  address: string,
  comment?: string,
) {
  const response = await restFetch(ip, username, password, "/ip/firewall/address-list", {
    method: "POST",
    body: JSON.stringify({ list, address, comment: comment ?? "" }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`RouterOS rechazó la dirección: HTTP ${response.status} ${details}`);
  }
  return serializeAddress(await readJson<Record<string, string>>(response));
}

export async function deleteMikroTikAddressEntry(
  ip: string,
  username: string,
  password: string,
  entryId: string,
): Promise<void> {
  const response = await restFetch(ip, username, password, `/ip/firewall/address-list/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    const details = await response.text().catch(() => "");
    throw new Error(`RouterOS rechazó la dirección: HTTP ${response.status} ${details}`);
  }
}

export function validateSecurityRule(kind: SecurityKind, input: Partial<SecurityRuleInput>, editing = false): string | null {
  const allowedFilterActions = new Set(["accept", "drop", "reject", "jump", "return", "log", "passthrough", "add-src-to-address-list", "add-dst-to-address-list"]);
  const allowedNatActions = new Set(["masquerade", "src-nat", "dst-nat", "redirect", "netmap"]);
  const allowedMangleActions = new Set(["accept", "drop", "jump", "log", "passthrough", "mark-connection", "mark-packet", "mark-routing", "change-mss", "clear", "tarpit", "return"]);
  const allowedRawActions = new Set(["accept", "drop", "notrack", "jump", "return"]);
  const allowedChains = kind === "nat"
    ? new Set(["srcnat", "dstnat"])
    : new Set(["input", "forward", "output", "prerouting", "postrouting"]);
  const actions = kind === "filter" ? allowedFilterActions : kind === "nat" ? allowedNatActions : kind === "mangle" ? allowedMangleActions : allowedRawActions;

  if (!input.action || !actions.has(input.action)) return "La acción seleccionada no es válida para este tipo de regla.";
  if (!input.chain || !allowedChains.has(input.chain)) return "La cadena seleccionada no es válida para este tipo de regla.";
  if (!editing && !input.comment?.trim()) return "Escribe una explicación para que otro operador entienda la regla.";
  if (input.comment && input.comment.length > 240) return "El comentario no puede superar 240 caracteres.";
  if (["filter", "raw"].includes(kind) && input.chain === "input" && ["drop", "reject"].includes(input.action) &&
      !input.srcAddress && !input.srcAddressList && !input.protocol && !input.connectionState) {
    return "Esta regla bloquearía todo el acceso al router. Indica una IP, una lista, un protocolo o un estado de conexión.";
  }
  if (kind === "nat" && ["dst-nat", "netmap"].includes(input.action) && !input.toAddresses) {
    return "Una redirección necesita indicar la IP interna de destino.";
  }
  if (kind === "mangle" && input.action === "jump" && !input.jumpTarget) {
    return "Una regla jump necesita indicar la cadena personalizada a la que saltará.";
  }
  if (kind === "mangle" && input.action === "mark-connection" && !input.newConnectionMark) {
    return "Indica el nombre de la marca que se aplicará a la conexión.";
  }
  if (kind === "mangle" && input.action === "mark-packet" && !input.newPacketMark) {
    return "Indica el nombre de la marca que se aplicará al paquete.";
  }
  if (kind === "mangle" && input.action === "mark-routing" && !input.newRoutingMark) {
    return "Indica el nombre de la marca que se aplicará al enrutamiento.";
  }
  return null;
}

export function logSecurityServiceError(error: unknown, context: Record<string, unknown>): void {
  logger.warn({ ...context, error }, "MikroTik security operation failed");
}