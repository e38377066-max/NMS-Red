import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Clock3,
  RefreshCw,
  Search,
  Server,
  Signal,
  Users,
  Wifi,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWebSocket } from "@/hooks/use-websocket";
import type { NetworkMonitoringSnapshot } from "@/types/monitoring";

import { apiFetch } from "@/lib/api-fetch";
const chartTooltipStyle = {
  backgroundColor: "#171827",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
};

type Sample = {
  at: string;
  rx: number | null;
  tx: number | null;
  signal: number | null;
  noise: number | null;
  snr: number | null;
  ccq: number | null;
};

function metric(value: number | null, suffix = "", digits = 1) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function statusBadge(status: "ONLINE" | "OFFLINE" | "UNKNOWN") {
  if (status === "ONLINE") return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">En línea</Badge>;
  if (status === "OFFLINE") return <Badge className="border-red-500/30 bg-red-500/10 text-red-400">Fuera de línea</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Sin confirmar</Badge>;
}

function clientStatusBadge(status: "CONNECTED" | "DISCONNECTED" | "UNKNOWN") {
  if (status === "CONNECTED") return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">Conectado</Badge>;
  if (status === "DISCONNECTED") return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">Desconectado</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Sin dato</Badge>;
}

function EmptyState({ icon: Icon, children }: { icon: typeof Activity; children: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p>{children}</p>
    </div>
  );
}

export default function Monitoring() {
  const { telemetry, isConnected } = useWebSocket();
  const [search, setSearch] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const { data: initialData, isLoading, isFetching, refetch } = useQuery<NetworkMonitoringSnapshot>({
    queryKey: ["network-monitoring-overview"],
    queryFn: async () => {
      const response = await apiFetch("/api/monitoring/overview");
      if (!response.ok) throw new Error("No se pudo cargar el monitoreo");
      return response.json() as Promise<NetworkMonitoringSnapshot>;
    },
    staleTime: 5_000,
    refetchInterval: isConnected ? false : 10_000,
  });

  const data = isConnected ? telemetry ?? initialData : initialData;

  useEffect(() => {
    if (!data) return;
    setSamples((previous) => {
      if (previous.some((sample) => sample.at === data.generatedAt)) return previous;
      return [
        ...previous,
        {
          at: data.generatedAt,
          rx: data.totals.rxMbps,
          tx: data.totals.txMbps,
          signal: data.quality.signalDbm,
          noise: data.quality.noiseDbm,
          snr: data.quality.snrDb,
          ccq: data.quality.ccq,
        },
      ].slice(-36);
    });
  }, [data]);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!data || !query) return data?.clients ?? [];
    return data.clients.filter((client) =>
      [client.name, client.ip, client.mac, client.equipmentName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [data, search]);

  const trafficChart = samples.map((sample) => ({
    time: new Date(sample.at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    Descarga: sample.rx,
    Subida: sample.tx,
  }));
  const qualityChart = samples.map((sample) => ({
    time: new Date(sample.at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    Señal: sample.signal,
    Ruido: sample.noise,
    SNR: sample.snr,
    CCQ: sample.ccq,
  }));

  const totals = data?.totals;
  const quality = data?.quality;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            <Activity className="h-4 w-4" /> Operaciones de red
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de monitoreo</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tráfico, clientes y calidad de enlaces observados directamente desde los equipos registrados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-amber-400"}`} />
            {isConnected ? "Telemetría en vivo" : "HTTP fallback · actualización cada 15 s"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-28" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-primary/20 bg-primary/[0.04]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Descarga total</CardTitle>
                <ArrowDown className="h-4 w-4 text-sky-400" />
              </CardHeader>
              <CardContent><div className="font-mono text-3xl font-bold">{metric(totals?.rxMbps ?? null, " Mbps")}</div><p className="mt-1 text-xs text-muted-foreground">Lectura actual de interfaces RouterOS</p></CardContent>
            </Card>
            <Card className="border-primary/20 bg-primary/[0.04]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subida total</CardTitle>
                <ArrowUp className="h-4 w-4 text-violet-400" />
              </CardHeader>
              <CardContent><div className="font-mono text-3xl font-bold">{metric(totals?.txMbps ?? null, " Mbps")}</div><p className="mt-1 text-xs text-muted-foreground">Lectura actual de interfaces RouterOS</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Clientes conectados</CardTitle>
                <Users className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent><div className="font-mono text-3xl font-bold">{totals?.connectedClients ?? 0}</div><p className="mt-1 text-xs text-muted-foreground">{totals?.totalClients ?? 0} registrados · {totals?.unknownClients ?? 0} sin confirmar</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Equipos de red</CardTitle>
                <Server className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent><div className="font-mono text-3xl font-bold">{totals?.onlineEquipment ?? 0}<span className="text-base font-normal text-muted-foreground"> / {data?.equipment.length ?? 0}</span></div><p className="mt-1 text-xs text-muted-foreground">{totals?.offlineEquipment ?? 0} fuera de línea · {totals?.equipmentWithoutTraffic ?? 0} sin tráfico</p></CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-3">
                <div>
                  <CardTitle className="text-base">Consumo de la red</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Muestras recibidas durante esta sesión</p>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">{samples.length} muestras</Badge>
              </CardHeader>
              <CardContent className="pt-5">
                {trafficChart.length < 2 || !trafficChart.some((sample) => sample.Descarga !== null || sample.Subida !== null) ? (
                  <EmptyState icon={Activity}>Aún no hay dos lecturas de tráfico reales para dibujar la tendencia.</EmptyState>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trafficChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rxFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.28} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0} /></linearGradient>
                        <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a78bfa" stopOpacity={0.22} /><stop offset="95%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#71717a" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#71717a" }} unit=" Mbps" />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="Descarga" stroke="#38bdf8" fill="url(#rxFill)" strokeWidth={2} connectNulls />
                      <Area type="monotone" dataKey="Subida" stroke="#a78bfa" fill="url(#txFill)" strokeWidth={2} connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-3">
                <div>
                  <CardTitle className="text-base">Calidad de enlaces</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Promedios de estaciones que reportan la métrica</p>
                </div>
                <Signal className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="pt-5">
                <div className="mb-4 grid grid-cols-4 gap-2 text-center">
                  <div><div className="font-mono text-lg font-semibold text-sky-300">{metric(quality?.signalDbm ?? null, " dBm")}</div><div className="text-[10px] uppercase text-muted-foreground">Señal</div></div>
                  <div><div className="font-mono text-lg font-semibold text-amber-300">{metric(quality?.noiseDbm ?? null, " dBm")}</div><div className="text-[10px] uppercase text-muted-foreground">Ruido</div></div>
                  <div><div className="font-mono text-lg font-semibold text-emerald-300">{metric(quality?.snrDb ?? null, " dB")}</div><div className="text-[10px] uppercase text-muted-foreground">SNR</div></div>
                  <div><div className="font-mono text-lg font-semibold text-violet-300">{metric(quality?.ccq ?? null, "%")}</div><div className="text-[10px] uppercase text-muted-foreground">CCQ</div></div>
                </div>
                {qualityChart.length < 2 || !qualityChart.some((sample) => sample.Señal !== null || sample.SNR !== null) ? (
                  <EmptyState icon={Signal}>No hay suficientes lecturas de señal y ruido para dibujar la tendencia.</EmptyState>
                ) : (
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={qualityChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#71717a" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#71717a" }} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="Señal" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="Ruido" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="SNR" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 border-b border-border/50 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Clientes y consumo individual</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">El tráfico individual solo aparece cuando el equipo lo expone por cola o estación.</p>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, IP o MAC" className="pl-9" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredClients.length === 0 ? (
                <EmptyState icon={Users}>{data?.clients.length ? "No hay clientes que coincidan con la búsqueda." : "No hay clientes o todavía no hay equipos conectados para obtener su estado."}</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow className="border-b-border/50 hover:bg-transparent"><TableHead>Cliente</TableHead><TableHead>Estado</TableHead><TableHead>Equipo</TableHead><TableHead>Descarga</TableHead><TableHead>Subida</TableHead><TableHead>Señal / ruido</TableHead><TableHead>SNR</TableHead><TableHead>CCQ</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredClients.map((client) => (
                        <TableRow key={client.id} className="border-b-border/50">
                          <TableCell><div className="font-medium">{client.name}</div><div className="font-mono text-[11px] text-muted-foreground">{client.ip ?? client.mac}</div></TableCell>
                          <TableCell>{clientStatusBadge(client.status)}</TableCell>
                          <TableCell><div className="text-sm">{client.equipmentName}</div><div className="text-[11px] text-muted-foreground">{client.source === "routeros-queue" ? "Cola RouterOS" : client.source === "wireless-station" ? "Estación inalámbrica" : "Sin fuente en vivo"}</div></TableCell>
                          <TableCell className="font-mono text-xs text-sky-300">{metric(client.rxMbps, " Mbps")}</TableCell>
                          <TableCell className="font-mono text-xs text-violet-300">{metric(client.txMbps, " Mbps")}</TableCell>
                          <TableCell className="font-mono text-xs">{metric(client.signalDbm, " / ")}{client.noiseDbm !== null ? metric(client.noiseDbm, " dBm") : "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-emerald-300">{metric(client.snrDb, " dB")}</TableCell>
                          <TableCell className="font-mono text-xs">{metric(client.ccq, "%")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader className="border-b border-border/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4 text-primary" /> Estado de infraestructura</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data?.equipment.length === 0 ? <EmptyState icon={Server}>No hay equipos registrados para monitorear.</EmptyState> : (
                  <div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-b-border/50 hover:bg-transparent"><TableHead>Equipo</TableHead><TableHead>Estado</TableHead><TableHead>Tráfico</TableHead><TableHead>Calidad</TableHead><TableHead>Clientes</TableHead></TableRow></TableHeader><TableBody>
                    {data?.equipment.map((equipment) => (
                      <TableRow key={equipment.id} className="border-b-border/50">
                        <TableCell><div className="font-medium">{equipment.model}</div><div className="font-mono text-[11px] text-muted-foreground">{equipment.ip} · {equipment.nodeName}</div></TableCell>
                        <TableCell>{statusBadge(equipment.status)}</TableCell>
                        <TableCell className="font-mono text-xs"><span className="text-sky-300">{metric(equipment.rxMbps, " ↓")}</span><br /><span className="text-violet-300">{metric(equipment.txMbps, " ↑")}</span></TableCell>
                        <TableCell className="font-mono text-xs">{equipment.qualitySource ? `${metric(equipment.signalDbm, " dBm")} · ${metric(equipment.snrDb, " dB")}` : "No disponible"}</TableCell>
                        <TableCell className="font-mono text-xs">{equipment.clientCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table></div>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-500/20">
              <CardHeader className="border-b border-border/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-400" /> Desconexiones y causas</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data?.incidents.length === 0 ? <EmptyState icon={Wifi}>No hay desconexiones reportadas por las lecturas actuales.</EmptyState> : (
                  <div className="divide-y divide-border/50">
                    {data?.incidents.slice(0, 8).map((incident) => (
                      <div key={incident.id} className="space-y-1 p-4">
                        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2 font-medium text-sm">{incident.severity === "critical" ? <Server className="h-4 w-4 text-red-400" /> : <Users className="h-4 w-4 text-amber-400" />}{incident.title}</div><Badge variant="outline" className={incident.cause === "infrastructure_equipment" ? "border-red-500/30 text-red-400" : "border-amber-500/30 text-amber-400"}>{incident.cause === "infrastructure_equipment" ? "Infraestructura" : "Cliente / acceso"}</Badge></div>
                        <p className="pl-6 text-xs leading-relaxed text-muted-foreground">{incident.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Última lectura: {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("es") : "—"}</span>
            <span className="flex items-center gap-1.5"><CircleHelp className="h-3.5 w-3.5" /> Las métricas no soportadas por un fabricante se mantienen sin dato.</span>
          </div>
        </>
      )}
    </div>
  );
}