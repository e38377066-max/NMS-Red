import { logger } from "../lib/logger";

export interface MikroTikResourceResult {
  cpuLoad: string | null;
  freeMemory: string | null;
  uptime: string | null;
  boardName: string | null;
  reachable: boolean;
}

export async function getMikroTikResource(ip: string, username: string, password: string): Promise<MikroTikResourceResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const url = `http://${ip}/rest/system/resource`;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn({ ip, status: response.status }, "MikroTik API returned non-OK status");
      return { cpuLoad: null, freeMemory: null, uptime: null, boardName: null, reachable: false };
    }

    const data = await response.json() as Record<string, string>;

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

export async function setClientSpeedLimit(
  ip: string,
  username: string,
  password: string,
  mac: string,
  newLimit: string
): Promise<{ success: boolean; message: string }> {
  try {
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    };

    // First, find the queue entry for this client
    const listUrl = `http://${ip}/rest/queue/simple?mac-src=${encodeURIComponent(mac)}`;
    const listRes = await fetch(listUrl, { headers });

    if (!listRes.ok) {
      return { success: false, message: "Could not query MikroTik queue" };
    }

    const queues = await listRes.json() as Array<{ ".id": string }>;

    if (queues.length === 0) {
      // Create new queue entry
      const createUrl = `http://${ip}/rest/queue/simple`;
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ "mac-src": mac, "max-limit": newLimit }),
      });

      if (!createRes.ok) {
        return { success: false, message: "Failed to create speed queue" };
      }

      return { success: true, message: `Speed set to ${newLimit} for ${mac}` };
    }

    // Update existing queue
    const queueId = queues[0][".id"];
    const updateUrl = `http://${ip}/rest/queue/simple/${queueId}`;
    const updateRes = await fetch(updateUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ "max-limit": newLimit }),
    });

    if (!updateRes.ok) {
      return { success: false, message: "Failed to update speed queue" };
    }

    return { success: true, message: `Speed updated to ${newLimit} for ${mac}` };
  } catch (err) {
    logger.error({ ip, mac, err }, "Error setting speed limit on MikroTik");
    return { success: false, message: "Connection error" };
  }
}
