import { logger } from "../lib/logger";
import * as https from "https";
import { decryptSecret } from "./credentials.service";

// Proxmox API uses HTTPS with self-signed certs in most local installs
// We use native https module to bypass cert verification safely on LAN
const PROXMOX_TIMEOUT_MS = 8000;

interface ProxmoxTicket {
  ticket: string;
  CSRFPreventionToken: string;
}

export async function fetchProxmox<T>(
  ip: string,
  port: number,
  path: string,
  options: {
    method?: string;
    ticket?: string;
    csrf?: string;
    body?: unknown;
  } = {},
  requestFn: typeof https.request = https.request,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const { method = "GET", ticket, csrf, body } = options;
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const reqOptions: https.RequestOptions = {
      hostname: ip,
      port,
      path: `/api2/json${path}`,
      method,
      rejectUnauthorized: false, // LAN self-signed cert
      headers: {
        "Content-Type": "application/json",
        ...(ticket ? { Cookie: `PVEAuthCookie=${ticket}` } : {}),
        ...(csrf ? { CSRFPreventionToken: csrf } : {}),
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = requestFn(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        const isSuccessful = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300;
        let parsed: { data?: T; errors?: unknown; message?: unknown };
        try {
          parsed = JSON.parse(data) as { data?: T; errors?: unknown; message?: unknown };
        } catch {
          if (!isSuccessful) {
            reject(new Error(`Proxmox API error (${res.statusCode ?? "unknown"}): ${data.slice(0, 200) || res.statusMessage || "request failed"}`));
            return;
          }
          reject(new Error(`Invalid JSON from Proxmox: ${data.slice(0, 100)}`));
          return;
        }

        if (!isSuccessful) {
          const details = parsed.errors
            ? JSON.stringify(parsed.errors)
            : typeof parsed.message === "string"
              ? parsed.message
              : typeof parsed.data === "string"
                ? parsed.data
                : res.statusMessage || "request failed";
          reject(new Error(`Proxmox API error (${res.statusCode ?? "unknown"}): ${details}`));
          return;
        }

        resolve(parsed.data as T);
      });
    });

    req.setTimeout(PROXMOX_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Proxmox request timed out"));
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function getProxmoxTicket(
  ip: string,
  port: number,
  username: string,
  password: string
): Promise<ProxmoxTicket | null> {
  try {
    const result = await fetchProxmox<ProxmoxTicket>(ip, port, "/access/ticket", {
      method: "POST",
       body: { username, password: decryptSecret(password) },
    });
    if (!result?.ticket) return null;
    return result;
  } catch (err) {
    logger.warn({ ip, err }, "Failed to get Proxmox ticket");
    return null;
  }
}

export async function getProxmoxNodeStatus(
  ip: string,
  port: number,
  ticket: ProxmoxTicket,
  nodeName: string
): Promise<ProxmoxHealthData | null> {
  try {
    type NodeStatusRaw = {
      cpu: number;
      mem: number;
      maxmem: number;
      rootfs: { used: number; total: number };
      uptime: number;
      kversion: string;
    };

    const status = await fetchProxmox<NodeStatusRaw>(
      ip, port, `/nodes/${nodeName}/status`,
      { ticket: ticket.ticket, csrf: ticket.CSRFPreventionToken }
    );

    type VersionRaw = { version: string };
    let pveVersion: string | null = null;
    try {
      const ver = await fetchProxmox<VersionRaw>(ip, port, "/version", {
        ticket: ticket.ticket, csrf: ticket.CSRFPreventionToken,
      });
      pveVersion = ver?.version ?? null;
    } catch { /* optional */ }

    return {
      cpuUsagePercent: status?.cpu != null ? Math.round(status.cpu * 100) : null,
      memUsedGb: status?.mem != null ? parseFloat((status.mem / 1024 / 1024 / 1024).toFixed(2)) : null,
      memTotalGb: status?.maxmem != null ? parseFloat((status.maxmem / 1024 / 1024 / 1024).toFixed(2)) : null,
      diskUsedGb: status?.rootfs?.used != null ? parseFloat((status.rootfs.used / 1024 / 1024 / 1024).toFixed(2)) : null,
      diskTotalGb: status?.rootfs?.total != null ? parseFloat((status.rootfs.total / 1024 / 1024 / 1024).toFixed(2)) : null,
      uptime: status?.uptime != null ? formatUptime(status.uptime) : null,
      kernelVersion: status?.kversion ?? null,
      pveVersion,
    };
  } catch (err) {
    logger.warn({ ip, nodeName, err }, "Failed to get Proxmox node status");
    return null;
  }
}

export interface ProxmoxHealthData {
  cpuUsagePercent: number | null;
  memUsedGb: number | null;
  memTotalGb: number | null;
  diskUsedGb: number | null;
  diskTotalGb: number | null;
  uptime: string | null;
  kernelVersion: string | null;
  pveVersion: string | null;
}

export interface ProxmoxVmData {
  vmid: number;
  name: string;
  status: "running" | "stopped" | "paused" | "unknown";
  cpuUsage: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  diskGb: number | null;
  uptimeSeconds: number | null;
  cores: number | null;
  maxMem: number | null;
  tags: string | null;
}

export async function listProxmoxVms(
  ip: string,
  port: number,
  ticket: ProxmoxTicket,
  nodeName: string
): Promise<ProxmoxVmData[]> {
  try {
    type VmRaw = {
      vmid: number;
      name?: string;
      status: string;
      cpu?: number;
      mem?: number;
      maxmem?: number;
      disk?: number;
      maxdisk?: number;
      uptime?: number;
      cores?: number;
      tags?: string;
    };

    const vms = await fetchProxmox<VmRaw[]>(
      ip, port, `/nodes/${nodeName}/qemu`,
      { ticket: ticket.ticket, csrf: ticket.CSRFPreventionToken }
    );

    if (!Array.isArray(vms)) return [];

    return vms.map((vm) => ({
      vmid: vm.vmid,
      name: vm.name ?? `VM-${vm.vmid}`,
      status: normalizeVmStatus(vm.status),
      cpuUsage: vm.cpu != null ? parseFloat((vm.cpu * 100).toFixed(1)) : null,
      memUsedMb: vm.mem != null ? Math.round(vm.mem / 1024 / 1024) : null,
      memTotalMb: vm.maxmem != null ? Math.round(vm.maxmem / 1024 / 1024) : null,
      diskGb: vm.maxdisk != null ? parseFloat((vm.maxdisk / 1024 / 1024 / 1024).toFixed(1)) : null,
      uptimeSeconds: vm.uptime ?? null,
      cores: vm.cores ?? null,
      maxMem: vm.maxmem ?? null,
      tags: vm.tags ?? null,
    }));
  } catch (err) {
    logger.warn({ ip, nodeName, err }, "Failed to list Proxmox VMs");
    return [];
  }
}

export async function startVm(
  ip: string, port: number, ticket: ProxmoxTicket, nodeName: string, vmid: number,
  requestFn: typeof https.request = https.request,
): Promise<{ success: boolean; message: string }> {
  try {
    await fetchProxmox(ip, port, `/nodes/${nodeName}/qemu/${vmid}/status/start`, {
      method: "POST",
      ticket: ticket.ticket,
      csrf: ticket.CSRFPreventionToken,
    }, requestFn);
    return { success: true, message: `VM ${vmid} iniciada correctamente` };
  } catch (err) {
    logger.warn({ ip, vmid, err }, "Failed to start VM");
    return { success: false, message: `Error al iniciar VM ${vmid}: ${String(err)}` };
  }
}

export async function stopVm(
  ip: string, port: number, ticket: ProxmoxTicket, nodeName: string, vmid: number
): Promise<{ success: boolean; message: string }> {
  try {
    await fetchProxmox(ip, port, `/nodes/${nodeName}/qemu/${vmid}/status/stop`, {
      method: "POST",
      ticket: ticket.ticket,
      csrf: ticket.CSRFPreventionToken,
    });
    return { success: true, message: `VM ${vmid} detenida correctamente` };
  } catch (err) {
    logger.warn({ ip, vmid, err }, "Failed to stop VM");
    return { success: false, message: `Error al detener VM ${vmid}: ${String(err)}` };
  }
}

export async function createSnapshot(
  ip: string, port: number, ticket: ProxmoxTicket, nodeName: string, vmid: number,
  snapname: string, description?: string
): Promise<{ success: boolean; message: string }> {
  try {
    await fetchProxmox(ip, port, `/nodes/${nodeName}/qemu/${vmid}/snapshot`, {
      method: "POST",
      ticket: ticket.ticket,
      csrf: ticket.CSRFPreventionToken,
      body: { snapname, description: description ?? `Imperio AP snapshot ${new Date().toISOString()}` },
    });
    return { success: true, message: `Snapshot '${snapname}' creado para VM ${vmid}` };
  } catch (err) {
    logger.warn({ ip, vmid, snapname, err }, "Failed to create snapshot");
    return { success: false, message: `Error al crear snapshot: ${String(err)}` };
  }
}

export async function updateVmConfig(
  ip: string, port: number, ticket: ProxmoxTicket, nodeName: string, vmid: number,
  config: { cores?: number; memory?: number; description?: string }
): Promise<{ success: boolean; message: string }> {
  try {
    await fetchProxmox(ip, port, `/nodes/${nodeName}/qemu/${vmid}/config`, {
      method: "PUT",
      ticket: ticket.ticket,
      csrf: ticket.CSRFPreventionToken,
      body: config,
    });
    const changes = Object.entries(config)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    return { success: true, message: `VM ${vmid} actualizada: ${changes}` };
  } catch (err) {
    logger.warn({ ip, vmid, config, err }, "Failed to update VM config");
    return { success: false, message: `Error al actualizar VM: ${String(err)}` };
  }
}

function normalizeVmStatus(s: string): "running" | "stopped" | "paused" | "unknown" {
  if (s === "running") return "running";
  if (s === "stopped") return "stopped";
  if (s === "paused") return "paused";
  return "unknown";
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
