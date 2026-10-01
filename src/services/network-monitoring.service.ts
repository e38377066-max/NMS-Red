import { sequelize, Client } from "../db";
import { getMikroTikTrafficSnapshot, type MikroTikTrafficSnapshot } from "./mikrotik.service";
import { getUbiquitiStatus, getWirelessTable, type WirelessStation } from "./ubiquiti.service";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

export type LiveClientStatus = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export interface NetworkMonitoringClient {
  id: number;
  name: string;
  ip: string | null;
  mac: string;
  equipmentId: number;
  equipmentName: string;
  status: LiveClientStatus;
  rxMbps: number | null;
  txMbps: number | null;
  signalDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  ccq: number | null;
  source: "routeros-queue" | "wireless-station" | null;
  disconnectionCause: "client_or_access" | "infrastructure_equipment" | null;
}

export interface NetworkMonitoringEquipment {
  id: number;
  nodeName: string;
  model: string;
  ip: string;
  role: string;
  connectionType: string;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  lastCheckedAt: string | null;
  rxMbps: number | null;
  txMbps: number | null;
  signalDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  ccq: number | null;
  clientCount: number;
  qualitySource: "wireless-stations" | null;
}

export interface NetworkMonitoringIncident {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  cause: "infrastructure_equipment" | "client_or_access";
  equipmentId: number;
  clientId: number | null;
  recordedAt: string;
}

export interface NetworkMonitoringSnapshot {
  generatedAt: string;
  totals: {
    rxMbps: number | null;
    txMbps: number | null;
    totalClients: number;
    connectedClients: number;
    disconnectedClients: number;
    unknownClients: number;
    onlineEquipment: number;
    offlineEquipment: number;
    equipmentWithoutTraffic: number;
  };
  quality: {
    signalDbm: number | null;
    noiseDbm: number | null;
    snrDb: number | null;
    ccq: number | null;
    samples: number;
  };
  equipment: NetworkMonitoringEquipment[];
  clients: NetworkMonitoringClient[];
  incidents: NetworkMonitoringIncident[];
}

let socket: SocketServer | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let latestSnapshot: NetworkMonitoringSnapshot | null = null;
let refreshInFlight: Promise<NetworkMonitoringSnapshot> | null = null;

export function setNetworkMonitoringSocket(socketServer: SocketServer): void {
  socket = socketServer;
}

export function startNetworkMonitoring(): void {
  if (refreshInterval) return;
  logger.info("Starting live network telemetry collection (15s interval)");
  void refreshNetworkMonitoring();
  refreshInterval = setInterval(() => { void refreshNetworkMonitoring(); }, 15_000);
}

export function stopNetworkMonitoring(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

export async function getNetworkMonitoringSnapshot(): Promise<NetworkMonitoringSnapshot> {
  if (latestSnapshot) return latestSnapshot;
  return refreshNetworkMonitoring();
}

async function refreshNetworkMonitoring(): Promise<NetworkMonitoringSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = buildSnapshot().finally(() => { refreshInFlight = null; });
  const snapshot = await refreshInFlight;
  latestSnapshot = snapshot;
  socket?.emit("monitoring:telemetry", snapshot);
  return snapshot;
}

async function buildSnapshot(): Promise<NetworkMonitoringSnapshot> {
  const [equipmentRows] = await sequelize.query(
    `SELECT e.id,e.ip,e.username,e.password,e.model,e.connection_type AS "connectionType",
      e.equipment_role AS "equipmentRole",e.last_seen_status AS "lastSeenStatus",
      e.last_checked_at AS "lastCheckedAt",n.name AS "nodeName"
     FROM equipment e LEFT JOIN nodes n ON n.id=e.node_id`) as [any[], unknown];

  const clientRows = await Client.findAll({ attributes: ["id","equipmentId","mac","ip","name"], raw: true }) as any[];

  const equipmentResults = await Promise.all(equipmentRows.map(async (equipment) => {
    if (equipment.connectionType === "ubiquiti_airos") {
      const [status, stations] = await Promise.all([
        getUbiquitiStatus(equipment.ip, equipment.username, equipment.password),
        getWirelessTable(equipment.ip, equipment.username, equipment.password, equipment.connectionType),
      ]);
      return {
        equipment,
        reachable: status.reachable,
        traffic: null as MikroTikTrafficSnapshot | null,
        stations,
      };
    }

    const traffic = await getMikroTikTrafficSnapshot(equipment.ip, equipment.username, equipment.password);
    return { equipment, reachable: traffic.reachable, traffic, stations: [] as WirelessStation[] };
  }));

  const liveEquipment: NetworkMonitoringEquipment[] = [];
  const liveClients: NetworkMonitoringClient[] = [];
  const incidents: NetworkMonitoringIncident[] = [];
  const qualitySamples: Array<{ signal: number | null; noise: number | null; snr: number | null; ccq: number | null }> = [];
  const wirelessStationsByMac = new Map<string, { station: WirelessStation; equipmentReachable: boolean }>();
  let rxTotal = 0;
  let txTotal = 0;
  let hasRx = false;
  let hasTx = false;

  for (const result of equipmentResults) {
    const { equipment, traffic, stations } = result;
    const status: NetworkMonitoringEquipment["status"] = result.reachable
      ? "ONLINE"
      : equipment.lastSeenStatus === "UNKNOWN" ? "UNKNOWN" : "OFFLINE";
    const stationMetrics = stations.map(toStationMetrics);
    stationMetrics.forEach((metric) => qualitySamples.push(metric));
    for (const station of stations) {
      wirelessStationsByMac.set(station.mac.toLowerCase(), {
        station,
        equipmentReachable: result.reachable,
      });
    }

    const signalDbm = averageNullable(stationMetrics.map((metric) => metric.signal));
    const noiseDbm = averageNullable(stationMetrics.map((metric) => metric.noise));
    const snrDb = signalDbm !== null && noiseDbm !== null ? signalDbm - noiseDbm : null;
    const ccq = averageNullable(stationMetrics.map((metric) => metric.ccq));
    const rxMbps = traffic?.rxMbps ?? null;
    const txMbps = traffic?.txMbps ?? null;

    if (rxMbps !== null) { rxTotal += rxMbps; hasRx = true; }
    if (txMbps !== null) { txTotal += txMbps; hasTx = true; }

    liveEquipment.push({
      id: equipment.id,
      nodeName: equipment.nodeName ?? "Sin nodo",
      model: equipment.model,
      ip: equipment.ip,
      role: equipment.equipmentRole,
      connectionType: equipment.connectionType,
      status,
      lastCheckedAt: equipment.lastCheckedAt?.toISOString() ?? null,
      rxMbps,
      txMbps,
      signalDbm,
      noiseDbm,
      snrDb,
      ccq,
      clientCount: clientRows.filter((client) => client.equipmentId === equipment.id).length,
      qualitySource: stations.length > 0 ? "wireless-stations" : null,
    });

    if (status === "OFFLINE") {
      incidents.push({
        id: `equipment-${equipment.id}`,
        severity: "critical",
        title: `${equipment.model} no responde`,
        detail: `El equipo ${equipment.ip} del nodo ${equipment.nodeName ?? "Sin nodo"} no responde. Los clientes asociados pueden estar afectados.`,
        cause: "infrastructure_equipment",
        equipmentId: equipment.id,
        clientId: null,
        recordedAt: new Date().toISOString(),
      });
    }

    for (const client of clientRows.filter((row) => row.equipmentId === equipment.id)) {
      const wirelessStation = wirelessStationsByMac.get(client.mac.toLowerCase());
      const station = wirelessStation?.station;
      const queue = traffic?.clients.find((item) => {
        const key = item.key.toLowerCase();
        return key === client.ip?.toLowerCase() || key === client.name.toLowerCase();
      });

      const isConnected = queue !== undefined || station !== undefined;
      const hasReachableWirelessLink = wirelessStation?.equipmentReachable === true;
      const clientStatus: LiveClientStatus = !result.reachable && !hasReachableWirelessLink
        ? "UNKNOWN"
        : isConnected ? "CONNECTED" : equipment.connectionType === "ubiquiti_airos" ? "DISCONNECTED" : "UNKNOWN";
      const stationMetric = station ? toStationMetrics(station) : null;
      const clientRx = queue?.rxMbps ?? null;
      const clientTx = queue?.txMbps ?? null;

      liveClients.push({
        id: client.id,
        name: client.name,
        ip: client.ip,
        mac: client.mac,
        equipmentId: equipment.id,
        equipmentName: equipment.model,
        status: clientStatus,
        rxMbps: clientRx,
        txMbps: clientTx,
        signalDbm: stationMetric?.signal ?? null,
        noiseDbm: stationMetric?.noise ?? null,
        snrDb: stationMetric && stationMetric.signal !== null && stationMetric.noise !== null
          ? stationMetric.signal - stationMetric.noise
          : null,
        ccq: stationMetric?.ccq ?? null,
        source: queue ? "routeros-queue" : station ? "wireless-station" : null,
        disconnectionCause: clientStatus === "DISCONNECTED" ? "client_or_access" : null,
      });

      if (clientStatus === "DISCONNECTED") {
        incidents.push({
          id: `client-${client.id}`,
          severity: "warning",
          title: `${client.name} no aparece conectado`,
          detail: `El equipo ${equipment.model} responde, pero no reporta la estación ${client.mac}. Revisar el CPE, radioenlace o alimentación del cliente.`,
          cause: "client_or_access",
          equipmentId: equipment.id,
          clientId: client.id,
          recordedAt: new Date().toISOString(),
        });
      }
    }
  }

  const connectedClients = liveClients.filter((client) => client.status === "CONNECTED").length;
  const disconnectedClients = liveClients.filter((client) => client.status === "DISCONNECTED").length;
  const unknownClients = liveClients.filter((client) => client.status === "UNKNOWN").length;
  const quality = {
    signalDbm: averageNullable(qualitySamples.map((sample) => sample.signal)),
    noiseDbm: averageNullable(qualitySamples.map((sample) => sample.noise)),
    snrDb: averageNullable(qualitySamples.map((sample) => sample.snr)),
    ccq: averageNullable(qualitySamples.map((sample) => sample.ccq)),
    samples: qualitySamples.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      rxMbps: hasRx ? rxTotal : null,
      txMbps: hasTx ? txTotal : null,
      totalClients: liveClients.length,
      connectedClients,
      disconnectedClients,
      unknownClients,
      onlineEquipment: liveEquipment.filter((equipment) => equipment.status === "ONLINE").length,
      offlineEquipment: liveEquipment.filter((equipment) => equipment.status === "OFFLINE").length,
      equipmentWithoutTraffic: liveEquipment.filter((equipment) => equipment.rxMbps === null && equipment.txMbps === null).length,
    },
    quality,
    equipment: liveEquipment,
    clients: liveClients,
    incidents: incidents.slice(0, 50),
  };
}

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toStationMetrics(station: WirelessStation) {
  return {
    signal: toNumber(station.signalDbm),
    noise: toNumber(station.noiseDbm),
    ccq: toNumber(station.ccq),
    snr: toNumber(station.signalDbm) !== null && toNumber(station.noiseDbm) !== null
      ? toNumber(station.signalDbm)! - toNumber(station.noiseDbm)!
      : null,
  };
}

function averageNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}