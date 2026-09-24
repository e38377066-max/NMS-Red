import { logger } from "../lib/logger";

type SecurityKind = "filter" | "nat";

export interface SecurityRuleInput {
  action: string;
  chain: string;
  comment: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  dstPort?: string;
  srcAddressList?: string;
  dstAddressList?: string;
  connectionState?: string;
  toAddresses?: string;
  toPorts?: string;
  outInterface?: string;
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
  dstPort: string | null;
  srcAddressList: string | null;
  dstAddressList: string | null;
  connectionState: string | null;
  toAddresses: string | null;
  toPorts: string | null;
  outInterface: string | null;
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
  dstPort: "dst-port",
  srcAddressList: "src-address-list",
  dstAddressList: "dst-address-list",
  connectionState: "connection-state",
  toAddresses: "to-addresses",
  toPorts: "to-ports",
  outInterface: "out-interface",
  placeBefore: "place-before",
};

function headers(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
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
    return await fetch(`http://${ip}/rest${path}`, {
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
    dstPort: raw["dst-port"] ?? null,
    srcAddressList: raw["src-address-list"] ?? null,
    dstAddressList: raw["dst-address-list"] ?? null,
    connectionState: raw["connection-state"] ?? null,
    toAddresses: raw["to-addresses"] ?? null,
    toPorts: raw["to-ports"] ?? null,
    outInterface: raw["out-interface"] ?? null,
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

export function toRouterOsRuleBody(input: SecurityRuleInput, kind: SecurityKind): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [field, routerField] of Object.entries(RULE_FIELDS)) {
    const value = input[field as keyof SecurityRuleInput];
    if (value !== undefined && value !== null && (value !== "" || field === "comment")) {
      body[routerField] = String(value).trim();
    }
  }

  if (kind === "filter") {
    delete body["to-addresses"];
    delete body["to-ports"];
    delete body["out-interface"];
  } else {
    delete body["connection-state"];
    delete body["src-address-list"];
    delete body["dst-address-list"];
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
  const [filters, nat, addresses, services] = await Promise.all([
    getCollection(ip, username, password, "/ip/firewall/filter"),
    getCollection(ip, username, password, "/ip/firewall/nat"),
    getCollection(ip, username, password, "/ip/firewall/address-list"),
    getCollection(ip, username, password, "/ip/service"),
  ]);

  return {
    filters: filters.map(serializeRule),
    nat: nat.map(serializeRule),
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
  const path = kind === "filter" ? "/ip/firewall/filter" : "/ip/firewall/nat";
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
  const path = `${kind === "filter" ? "/ip/firewall/filter" : "/ip/firewall/nat"}/${encodeURIComponent(ruleId)}`;
  const response = await restFetch(ip, username, password, path, {
    method: "PATCH",
    body: JSON.stringify(toRouterOsRuleBody(input as SecurityRuleInput, kind)),
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
  const path = `${kind === "filter" ? "/ip/firewall/filter" : "/ip/firewall/nat"}/${encodeURIComponent(ruleId)}`;
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
  const allowedFilterActions = new Set(["accept", "drop", "reject", "jump", "return", "passthrough"]);
  const allowedNatActions = new Set(["masquerade", "src-nat", "dst-nat", "redirect", "netmap"]);
  const allowedChains = kind === "filter" ? new Set(["input", "forward", "output"]) : new Set(["srcnat", "dstnat"]);
  const actions = kind === "filter" ? allowedFilterActions : allowedNatActions;

  if (!input.action || !actions.has(input.action)) return "La acción seleccionada no es válida para este tipo de regla.";
  if (!input.chain || !allowedChains.has(input.chain)) return "La cadena seleccionada no es válida para este tipo de regla.";
  if (!editing && !input.comment?.trim()) return "Escribe una explicación para que otro operador entienda la regla.";
  if (input.comment && input.comment.length > 240) return "El comentario no puede superar 240 caracteres.";
  if (kind === "filter" && input.chain === "input" && ["drop", "reject"].includes(input.action) &&
      !input.srcAddress && !input.srcAddressList && !input.protocol && !input.connectionState) {
    return "Esta regla bloquearía todo el acceso al router. Indica una IP, una lista, un protocolo o un estado de conexión.";
  }
  if (kind === "nat" && ["dst-nat", "netmap"].includes(input.action) && !input.toAddresses) {
    return "Una redirección necesita indicar la IP interna de destino.";
  }
  return null;
}

export function logSecurityServiceError(error: unknown, context: Record<string, unknown>): void {
  logger.warn({ ...context, error }, "MikroTik security operation failed");
}