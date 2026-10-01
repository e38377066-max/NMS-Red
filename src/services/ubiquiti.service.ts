import { logger } from "../lib/logger";
import { decryptSecret } from "./credentials.service";
import type { RadioGpsReading, RadioGpsPosition } from "./mikrotik.service";
import { NodeSSH } from "node-ssh";

const SSH_TIMEOUT_MS = 8000;
const HTTP_TIMEOUT_MS = 6000;
const HTTP_REACHABILITY_TIMEOUT_MS = 1500;

export interface UbiquitiStatus {
  reachable: boolean;
  boardName: string | null;
  firmware: string | null;
  frequency: string | null;
  txPower: string | null;
  noiseFloor: string | null;
  airMaxCapacity: string | null;
  cpuLoad: string | null;
  freeMemory: string | null;
  uptime: string | null;
}

export interface WirelessStation {
  mac: string;
  name: string | null;
  signalDbm: string;
  noiseDbm: string | null;
  ccq: string;
  txRate: string | null;
  rxRate: string | null;
  uptime: string | null;
  distance: string | null;
}

// --- HTTP approach (AirOS 6.x JSON status API) ---
async function tryHttpStatus(ip: string, username: string, password: string): Promise<UbiquitiStatus | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    // AirOS login endpoint
    const loginRes = await fetch(`http://${ip}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: decryptSecret(password) }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!loginRes.ok) {
      // Try legacy form login
      return await tryHttpLegacy(ip, username, password);
    }

    const cookies = loginRes.headers.get("set-cookie") ?? "";
    const statusRes = await fetch(`http://${ip}/status.cgi`, {
      headers: { Cookie: cookies },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!statusRes.ok) return null;
    const data = await statusRes.json() as AirOsStatusJson;
    return parseAirOsStatus(data);
  } catch {
    return null;
  }
}

async function tryHttpLegacy(ip: string, username: string, password: string): Promise<UbiquitiStatus | null> {
  try {
    // AirOS M-series legacy: POST /login.cgi
    const params = new URLSearchParams({ username, password: decryptSecret(password), uri: "/status.cgi" });
    const loginRes = await fetch(`http://${ip}/login.cgi`, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const cookie = loginRes.headers.get("set-cookie") ?? "";
    if (!cookie) return null;

    const statusRes = await fetch(`http://${ip}/status.cgi`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!statusRes.ok) return null;
    const data = await statusRes.json() as AirOsStatusJson;
    return parseAirOsStatus(data);
  } catch {
    return null;
  }
}

// --- SSH approach (most reliable for AirOS/OpenWRT) ---
async function trySSHStatus(ip: string, username: string, password: string): Promise<UbiquitiStatus | null> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: ip,
      username,
      password: decryptSecret(password),
      readyTimeout: SSH_TIMEOUT_MS,
      algorithms: {
        kex: [
          "ecdh-sha2-nistp256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
        ],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"],
        hmac: ["hmac-sha2-256", "hmac-sha1"],
        serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256"],
      },
    });

    // mca-status gives JSON on AirOS 8.x; fallback to iwconfig / iwlist
    const mcaResult = await ssh.execCommand("mca-status 2>/dev/null || mca-cli-op info 2>/dev/null");
    const uptimeResult = await ssh.execCommand("cat /proc/uptime 2>/dev/null");
    const memResult = await ssh.execCommand("cat /proc/meminfo 2>/dev/null | head -4");
    ssh.dispose();

    return parseSshOutput(mcaResult.stdout, uptimeResult.stdout, memResult.stdout);
  } catch (err) {
    logger.warn({ ip, err }, "Ubiquiti SSH status failed");
    try { ssh.dispose(); } catch { /* ignore */ }
    return null;
  }
}

async function probeHttpReachability(ip: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${ip}/`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_REACHABILITY_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function isUbiquitiReachable(
  ip: string,
  username: string,
  password: string,
): Promise<boolean> {
  if (await probeHttpReachability(ip)) return true;
  return (await trySSHStatus(ip, username, password)) !== null;
}

function emptyUbiquitiStatus(reachable: boolean): UbiquitiStatus {
  return {
    reachable,
    boardName: null,
    firmware: null,
    frequency: null,
    txPower: null,
    noiseFloor: null,
    airMaxCapacity: null,
    cpuLoad: null,
    freeMemory: null,
    uptime: null,
  };
}

export async function getUbiquitiStatus(ip: string, username: string, password: string): Promise<UbiquitiStatus> {
  // Try HTTP first (faster, no SSH overhead)
  const httpResult = await tryHttpStatus(ip, username, password);
  if (httpResult) return httpResult;

  // Fallback: SSH
  const sshResult = await trySSHStatus(ip, username, password);
  if (sshResult) return sshResult;

  // Older airOS devices can answer HTTP while SSH is disabled or unavailable.
  // A response from the device is enough to establish reachability, even when
  // its firmware does not expose the status API needed for radio metrics.
  const httpReachable = await probeHttpReachability(ip);
  if (httpReachable) {
    logger.info({ ip }, "Ubiquiti responds over HTTP; SSH/status API unavailable");
  }
  return emptyUbiquitiStatus(httpReachable);
}

function numericCoordinate(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function findAirOsPosition(value: unknown, depth = 0): RadioGpsPosition | null {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = findAirOsPosition(entry, depth + 1);
      if (result) return result;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const normalized = new Map(Object.entries(record).map(([key, item]) => [
    key.toLowerCase().replace(/[^a-z]/g, ""),
    item,
  ]));
  const latitude = numericCoordinate(normalized.get("latitude") ?? normalized.get("lat"));
  const longitude = numericCoordinate(
    normalized.get("longitude") ?? normalized.get("lon") ?? normalized.get("lng"),
  );
  if (
    latitude !== null
    && longitude !== null
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  ) {
    const rawAltitude = numericCoordinate(
      normalized.get("altitudemeters")
      ?? normalized.get("altitude")
      ?? normalized.get("elevation"),
    );
    const altitudeMeters = rawAltitude !== null && rawAltitude >= -500 && rawAltitude <= 10000
      ? rawAltitude
      : null;
    return {
      latitude,
      longitude,
      altitudeMeters,
      source: "radio_gps",
      accuracyMeters: null,
    };
  }

  for (const entry of Object.values(record)) {
    const result = findAirOsPosition(entry, depth + 1);
    if (result) return result;
  }
  return null;
}

async function fetchAirOsStatusData(
  ip: string,
  username: string,
  password: string,
): Promise<AirOsStatusJson | null> {
  const plainPassword = decryptSecret(password);
  try {
    const login = await fetch(`http://${ip}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: plainPassword }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (login.ok) {
      const status = await fetch(`http://${ip}/status.cgi`, {
        headers: { Cookie: login.headers.get("set-cookie") ?? "" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (status.ok) return await status.json() as AirOsStatusJson;
    }
  } catch {
    // Legacy AirOS below may still expose status.cgi.
  }

  try {
    const params = new URLSearchParams({
      username,
      password: plainPassword,
      uri: "/status.cgi",
    });
    const login = await fetch(`http://${ip}/login.cgi`, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const cookie = login.headers.get("set-cookie");
    if (!cookie) return null;
    const status = await fetch(`http://${ip}/status.cgi`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return status.ok ? await status.json() as AirOsStatusJson : null;
  } catch {
    return null;
  }
}

export async function getUbiquitiRadioGps(
  ip: string,
  username: string,
  password: string,
): Promise<RadioGpsReading> {
  const status = await fetchAirOsStatusData(ip, username, password);
  const position = status ? findAirOsPosition(status) : null;
  if (!position) {
    return {
      supported: false,
      position: null,
      message: "No se encontraron coordenadas GPS en el estado de este radio.",
    };
  }
  return {
    supported: true,
    position,
    message: "Posición leída del estado del radio.",
  };
}

// --- Wireless station table ---
export async function getWirelessTable(
  ip: string,
  username: string,
  password: string,
  connectionType: string
): Promise<WirelessStation[]> {
  if (connectionType === "ubiquiti_airos") {
    return getUbiquitiWirelessTable(ip, username, password);
  }
  return getMikroTikWirelessTable(ip, username, password);
}

async function getUbiquitiWirelessTable(ip: string, username: string, password: string): Promise<WirelessStation[]> {
  // Try HTTP wstalist first (AirOS JSON API)
  const httpResult = await tryHttpWirelessTable(ip, username, password);
  if (httpResult.length > 0) return httpResult;

  // Fallback: SSH wstalist command
  return trySSHWirelessTable(ip, username, password);
}

async function tryHttpWirelessTable(ip: string, username: string, password: string): Promise<WirelessStation[]> {
  try {
    const params = new URLSearchParams({ username, password: decryptSecret(password), uri: "/sta.cgi" });
    const loginRes = await fetch(`http://${ip}/login.cgi`, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";
    if (!cookie) return [];

    const staCgiRes = await fetch(`http://${ip}/sta.cgi`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!staCgiRes.ok) return [];
    const data = await staCgiRes.json() as { sta?: AirOsStaEntry[] };
    return (data.sta ?? []).map(parseAirOsSta);
  } catch {
    return [];
  }
}

async function trySSHWirelessTable(ip: string, username: string, password: string): Promise<WirelessStation[]> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: ip,
      username,
      password: decryptSecret(password),
      readyTimeout: SSH_TIMEOUT_MS,
      algorithms: {
        kex: ["ecdh-sha2-nistp256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
        cipher: ["aes128-ctr", "aes256-ctr", "aes128-cbc", "3des-cbc"],
        hmac: ["hmac-sha2-256", "hmac-sha1"],
        serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256"],
      },
    });

    // wstalist returns JSON array on AirOS
    const result = await ssh.execCommand("wstalist 2>/dev/null || cat /proc/net/wireless 2>/dev/null");
    ssh.dispose();

    return parseWstalist(result.stdout);
  } catch (err) {
    logger.warn({ ip, err }, "Ubiquiti SSH wireless table failed");
    try { ssh.dispose(); } catch { /* ignore */ }
    return [];
  }
}

async function getMikroTikWirelessTable(ip: string, username: string, password: string): Promise<WirelessStation[]> {
  try {
    const auth = Buffer.from(`${username}:${decryptSecret(password)}`).toString("base64");
    for (const wirelessPackage of ["wireless", "wifi"]) {
      const res = await fetch(`http://${ip}/rest/interface/${wirelessPackage}/registration-table`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = await res.json() as MikroTikWirelessEntry[];
      if (!Array.isArray(data) || data.length === 0) continue;
      return data.map((e) => ({
        mac: e["mac-address"] ?? e.mac ?? "N/A",
        name: e.comment ?? e.interface ?? null,
        signalDbm: e["signal-strength"] ?? e.signal ?? "N/A",
        noiseDbm: e["noise-floor"] ?? null,
        ccq: e.ccq ?? "N/A",
        txRate: e["tx-rate"] ?? null,
        rxRate: e["rx-rate"] ?? null,
        uptime: e.uptime ?? null,
        distance: e.distance != null ? `${e.distance}m` : null,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// --- Type helpers ---
interface AirOsStatusJson {
  host?: { hostname?: string; fwversion?: string; uptime?: number };
  wireless?: {
    frequency?: string;
    txpower?: number;
    noise?: number;
    "airmax-cap"?: number;
  };
  system?: { cpu?: number; "memory-free"?: number };
}

interface AirOsStaEntry {
  mac?: string;
  lastip?: string;
  signal?: number;
  noise?: number;
  tx?: { rate?: number };
  rx?: { rate?: number };
  uptime?: number;
  distance?: number;
  "signal-strength"?: number;
  ccq?: number;
}

interface MikroTikWirelessEntry {
  "mac-address"?: string;
  mac?: string;
  comment?: string;
  interface?: string;
  "signal-strength"?: string;
  signal?: string;
  "noise-floor"?: string;
  ccq?: string;
  "tx-rate"?: string;
  "rx-rate"?: string;
  uptime?: string;
  distance?: number;
}

function parseAirOsStatus(data: AirOsStatusJson): UbiquitiStatus {
  return {
    reachable: true,
    boardName: data.host?.hostname ?? null,
    firmware: data.host?.fwversion ?? null,
    frequency: data.wireless?.frequency ? `${data.wireless.frequency} MHz` : null,
    txPower: data.wireless?.txpower != null ? `${data.wireless.txpower} dBm` : null,
    noiseFloor: data.wireless?.noise != null ? `${data.wireless.noise} dBm` : null,
    airMaxCapacity: data.wireless?.["airmax-cap"] != null ? `${data.wireless["airmax-cap"]}%` : null,
    cpuLoad: data.system?.cpu != null ? `${data.system.cpu}%` : null,
    freeMemory: data.system?.["memory-free"] != null ? `${data.system["memory-free"]} kB` : null,
    uptime: data.host?.uptime != null ? formatUptime(data.host.uptime) : null,
  };
}

function parseAirOsSta(sta: AirOsStaEntry): WirelessStation {
  const signal = sta["signal-strength"] ?? sta.signal;
  const ccqVal = sta.ccq;
  return {
    mac: sta.mac ?? "N/A",
    name: sta.lastip ?? null,
    signalDbm: signal != null ? `${signal} dBm` : "N/A",
    noiseDbm: sta.noise != null ? `${sta.noise} dBm` : null,
    ccq: ccqVal != null ? `${ccqVal}%` : "N/A",
    txRate: sta.tx?.rate != null ? `${(sta.tx.rate / 1000).toFixed(1)} Mbps` : null,
    rxRate: sta.rx?.rate != null ? `${(sta.rx.rate / 1000).toFixed(1)} Mbps` : null,
    uptime: sta.uptime != null ? formatUptime(sta.uptime) : null,
    distance: sta.distance != null ? `${sta.distance}m` : null,
  };
}

function parseWstalist(stdout: string): WirelessStation[] {
  try {
    const data = JSON.parse(stdout) as AirOsStaEntry[];
    if (Array.isArray(data)) return data.map(parseAirOsSta);
  } catch { /* not JSON, parse plain text */ }

  // Parse plain `cat /proc/net/wireless` format (less info)
  const lines = stdout.split("\n").filter(l => l.includes(":"));
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      mac: parts[0]?.replace(":", "") ?? "N/A",
      name: null,
      signalDbm: parts[3] ? `${parts[3]} dBm` : "N/A",
      noiseDbm: parts[4] ? `${parts[4]} dBm` : null,
      ccq: "N/A",
      txRate: null, rxRate: null, uptime: null, distance: null,
    };
  });
}

function parseSshOutput(mcaStdout: string, uptimeStdout: string, memStdout: string): UbiquitiStatus {
  let boardName: string | null = null;
  let firmware: string | null = null;
  let frequency: string | null = null;
  let txPower: string | null = null;
  let noiseFloor: string | null = null;
  let cpuLoad: string | null = null;
  let freeMemory: string | null = null;

  for (const line of mcaStdout.split("\n")) {
    const [key, val] = line.split("=").map(s => s.trim());
    if (!key || !val) continue;
    if (key === "board.name" || key === "board") boardName = val;
    if (key === "system.version" || key === "version") firmware = val;
    if (key === "radio.freq") frequency = `${val} MHz`;
    if (key === "radio.txpower" || key === "txpower") txPower = `${val} dBm`;
    if (key === "radio.noise") noiseFloor = `${val} dBm`;
    if (key === "system.cpu") cpuLoad = `${val}%`;
  }

  // Parse /proc/meminfo for free memory
  for (const line of memStdout.split("\n")) {
    if (line.startsWith("MemFree:")) {
      freeMemory = line.replace("MemFree:", "").trim();
      break;
    }
  }

  // Parse uptime seconds
  let uptime: string | null = null;
  if (uptimeStdout) {
    const secs = parseFloat(uptimeStdout.split(" ")[0] ?? "0");
    if (!isNaN(secs)) uptime = formatUptime(Math.floor(secs));
  }

  return {
    reachable: boardName != null || firmware != null,
    boardName, firmware, frequency, txPower, noiseFloor,
    airMaxCapacity: null, cpuLoad, freeMemory, uptime,
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
