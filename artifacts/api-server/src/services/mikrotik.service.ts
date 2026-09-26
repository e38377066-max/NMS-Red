import { logger } from "../lib/logger";
import { decryptSecret } from "./credentials.service";

export interface MikroTikResourceResult {
  cpuLoad: string | null;
  freeMemory: string | null;
  uptime: string | null;
  boardName: string | null;
  reachable: boolean;
}

export interface MikroTikTrafficClient {
  key: string;
  rxMbps: number | null;
  txMbps: number | null;
}

export interface MikroTikTrafficSnapshot {
  reachable: boolean;
  rxMbps: number | null;
  txMbps: number | null;
  clients: MikroTikTrafficClient[];
}

export interface MikroTikDhcpLease {
  id: string;
  address: string;
  macAddress: string;
  hostName: string | null;
  comment: string | null;
  rateLimit: string | null;
  parentQueue: string | null;
  addressLists: string | null;
  status: string;
  dynamic: boolean;
  blocked: boolean;
  dhcpServer: string;
  expiresAfter: string | null;
}

function mkHeaders(username: string, password: string) {
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

async function mkFetch(
  ip: string,
  username: string,
  password: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${mikrotikBaseUrl(ip)}${path}`, {
      headers: mkHeaders(username, password),
      signal: controller.signal,
      ...options,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMikroTikResource(ip: string, username: string, password: string): Promise<MikroTikResourceResult> {
  try {
    const res = await mkFetch(ip, username, password, "/system/resource");
    if (!res.ok) {
      logger.warn({ ip, status: res.status }, "MikroTik API returned non-OK status");
      return { cpuLoad: null, freeMemory: null, uptime: null, boardName: null, reachable: false };
    }
    const data = await res.json() as Record<string, string>;
    return {
      cpuLoad: data["cpu-load"] ?? null,
      freeMemory: data["free-memory"] ?? null,
      uptime: data["uptime"] ?? null,
      boardName: data["board-name"] ?? null,
      reachable: true,
    };
  } catch (err) {
    logger.warn({ ip, err }, "Failed to reach MikroTik device");
    return { cpuLoad: null, freeMemory: null, uptime: null, boardName: null, reachable: false };
  }
}

function parseRateMbps(value: unknown): number | null {
  if (typeof value === "number") return value / 1_000_000;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9.]+)\s*(bps|kbps|mbps|gbps)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "bps").toLowerCase();
  const multiplier = unit === "gbps" ? 1000 : unit === "mbps" ? 1 : unit === "kbps" ? 0.001 : 0.000001;
  return amount * multiplier;
}

function parseRatePair(value: unknown): { rxMbps: number | null; txMbps: number | null } {
  if (typeof value !== "string") return { rxMbps: null, txMbps: null };
  const [first, second] = value.split("/");
  return { rxMbps: parseRateMbps(first), txMbps: parseRateMbps(second) };
}

function parseTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/\/32$/, "") || null;
}

export async function getMikroTikTrafficSnapshot(
  ip: string,
  username: string,
  password: string,
): Promise<MikroTikTrafficSnapshot> {
  try {
    const [interfaceResponse, queueResponse] = await Promise.all([
      mkFetch(ip, username, password, "/interface"),
      mkFetch(ip, username, password, "/queue/simple"),
    ]);

    if (!interfaceResponse.ok) {
      return { reachable: false, rxMbps: null, txMbps: null, clients: [] };
    }

    const interfaces = await interfaceResponse.json() as Array<Record<string, unknown>>;
    const activeInterfaces = interfaces.filter((entry) => {
      const name = String(entry.name ?? "").toLowerCase();
      return entry.running !== "false" && !name.includes("loopback");
    });
    const rxValues = activeInterfaces.map((entry) => parseRateMbps(entry["rx-bits-per-second"])).filter((value): value is number => value !== null);
    const txValues = activeInterfaces.map((entry) => parseRateMbps(entry["tx-bits-per-second"])).filter((value): value is number => value !== null);

    const clients: MikroTikTrafficClient[] = [];
    if (queueResponse.ok) {
      const queues = await queueResponse.json() as Array<Record<string, unknown>>;
      for (const queue of queues) {
        const key = parseTarget(queue.target) ?? String(queue.name ?? "").trim();
        if (!key) continue;
        const rates = parseRatePair(queue.rate ?? queue["rate-bytes"]);
        clients.push({ key, ...rates });
      }
    }

    return {
      reachable: true,
      rxMbps: rxValues.length ? rxValues.reduce((sum, value) => sum + value, 0) : null,
      txMbps: txValues.length ? txValues.reduce((sum, value) => sum + value, 0) : null,
      clients,
    };
  } catch (error) {
    logger.warn({ ip, error }, "Failed to fetch MikroTik traffic snapshot");
    return { reachable: false, rxMbps: null, txMbps: null, clients: [] };
  }
}

export async function setClientSpeedLimit(
  ip: string,
  username: string,
  password: string,
  mac: string,
  newLimit: string,
  clientIp?: string,
  clientName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const leases = await getMikroTikDhcpLeases(ip, username, password);
    const normalizedMac = mac.toLowerCase();
    const normalizedName = clientName?.trim().toLowerCase();
    const lease = leases.find((item) =>
      (clientIp && item.address === clientIp) ||
      item.macAddress.toLowerCase() === normalizedMac ||
      (normalizedName && (
        item.hostName?.trim().toLowerCase() === normalizedName ||
        item.comment?.toLowerCase().includes(normalizedName)
      ))
    );

    if (!lease) {
      return {
        success: false,
        message: `No se encontró un lease DHCP para ${clientName ?? mac}. Conecta el cliente o créale un lease estático primero.`,
      };
    }

    const updateRes = await mkFetch(ip, username, password, `/ip/dhcp-server/lease/${lease.id}`, {
      method: "PATCH",
      body: JSON.stringify({ "rate-limit": newLimit }),
    });
    if (!updateRes.ok) {
      const errBody = await updateRes.text().catch(() => "");
      return { success: false, message: `No se pudo actualizar rate-limit del lease: ${updateRes.status} ${errBody}` };
    }
    return { success: true, message: `Límite DHCP de ${clientName ?? mac} actualizado a ${newLimit}` };
  } catch (err) {
    logger.error({ ip, mac, err }, "Error setting speed limit on MikroTik");
    return { success: false, message: "Connection error" };
  }
}

// ─── Firewall Address List ──────────────────────────────────────────────────

export async function addToAddressList(
  ip: string,
  username: string,
  password: string,
  address: string,
  listName: string,
  comment?: string
): Promise<boolean> {
  try {
    const res = await mkFetch(ip, username, password, "/ip/firewall/address-list", {
      method: "POST",
      body: JSON.stringify({
        address,
        list: listName,
        comment: comment ?? "",
      }),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ ip, address, listName, err }, "Failed to add to address list");
    return false;
  }
}

export async function removeFromAddressList(
  ip: string,
  username: string,
  password: string,
  address: string,
  listName: string
): Promise<boolean> {
  try {
    // Find the entry first
    const listRes = await mkFetch(ip, username, password, `/ip/firewall/address-list?list=${encodeURIComponent(listName)}&address=${encodeURIComponent(address)}`);
    if (!listRes.ok) return false;

    const entries = await listRes.json() as Array<{ ".id": string }>;
    if (entries.length === 0) return true; // Already not in list

    const deleteRes = await mkFetch(ip, username, password, `/ip/firewall/address-list/${entries[0][".id"]}`, {
      method: "DELETE",
    });
    return deleteRes.ok || deleteRes.status === 404;
  } catch (err) {
    logger.warn({ ip, address, listName, err }, "Failed to remove from address list");
    return false;
  }
}

// ─── DHCP Leases ────────────────────────────────────────────────────────────

export async function getMikroTikDhcpLeases(
  ip: string,
  username: string,
  password: string
): Promise<MikroTikDhcpLease[]> {
  try {
    const res = await mkFetch(ip, username, password, "/ip/dhcp-server/lease");
    if (!res.ok) return [];

    const raw = await res.json() as Array<Record<string, string>>;
    return raw.map(entry => ({
      id: entry[".id"],
      address: entry["address"] ?? "",
      macAddress: entry["mac-address"] ?? "",
      hostName: entry["host-name"] ?? null,
      comment: entry["comment"] ?? null,
      rateLimit: entry["rate-limit"] ?? null,
      parentQueue: entry["parent-queue"] ?? null,
      addressLists: entry["address-lists"] ?? null,
      status: entry["status"] ?? "waiting",
      dynamic: entry["dynamic"] === "true",
      blocked: entry["blocked"] === "true",
      dhcpServer: entry["dhcp-server"] ?? "",
      expiresAfter: entry["expires-after"] ?? null,
    }));
  } catch (err) {
    logger.warn({ ip, err }, "Failed to fetch DHCP leases");
    return [];
  }
}

export async function createStaticDhcpLease(
  ip: string,
  username: string,
  password: string,
  macAddress: string,
  fixedIp: string,
  comment: string,
  dhcpServer?: string,
  rateLimit?: string,
): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const body: Record<string, string> = {
      "mac-address": macAddress,
      address: fixedIp,
      comment,
      "insert-queue-before": "bottom",
    };
    if (dhcpServer) body["server"] = dhcpServer;
    if (rateLimit) body["rate-limit"] = rateLimit;

    const existingLeases = await getMikroTikDhcpLeases(ip, username, password);
    const leaseTemplate = existingLeases.find((lease) => lease.parentQueue || lease.addressLists);
    if (leaseTemplate?.parentQueue) body["parent-queue"] = leaseTemplate.parentQueue;
    if (leaseTemplate?.addressLists) body["address-lists"] = leaseTemplate.addressLists;

    const res = await mkFetch(ip, username, password, "/ip/dhcp-server/lease", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { success: false, message: `Error MikroTik: ${res.status} ${errBody}` };
    }

    const created = await res.json() as Record<string, string>;
    return { success: true, message: `Lease estático creado: ${macAddress} → ${fixedIp}`, id: created[".id"] };
  } catch (err) {
    logger.error({ ip, macAddress, fixedIp, err }, "Error creating static DHCP lease");
    return { success: false, message: "Error de conexión con MikroTik" };
  }
}

export async function deleteDhcpLease(
  ip: string,
  username: string,
  password: string,
  leaseId: string
): Promise<boolean> {
  try {
    const res = await mkFetch(ip, username, password, `/ip/dhcp-server/lease/${leaseId}`, {
      method: "DELETE",
    });
    return res.ok || res.status === 404;
  } catch (err) {
    logger.warn({ ip, leaseId, err }, "Failed to delete DHCP lease");
    return false;
  }
}

export async function makeLeaseStatic(
  ip: string,
  username: string,
  password: string,
  leaseId: string,
  comment?: string,
): Promise<boolean> {
  try {
    const body: Record<string, string> = { dynamic: "false" };
    if (comment) body.comment = comment;
    const res = await mkFetch(ip, username, password, `/ip/dhcp-server/lease/${leaseId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ ip, leaseId, err }, "Failed to make lease static");
    return false;
  }
}
