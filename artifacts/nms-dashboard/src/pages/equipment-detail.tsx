import { useState } from "react";
import { useRoute } from "wouter";
import {
  useGetEquipment, useGetEquipmentStatus, useGetEquipmentWireless, useGetEquipmentMetrics,
  getGetEquipmentQueryKey, getGetEquipmentStatusQueryKey, getGetEquipmentWirelessQueryKey, getGetEquipmentMetricsQueryKey,
} from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowLeft, Wifi, Cpu, MemoryStick, Clock, Globe, ArrowUpDown, Radio, Server, Signal, RefreshCw, Settings2, Upload, Download, FileCode2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ConfigPreview = {
  previewId: string;
  fileName: string;
  format: string;
  sizeBytes: number;
  lineCount: number;
  commands: string[];
  warning: string | null;
  dangerousLines: string[];
  requiresConfirmation: boolean;
};

type ConfigSnapshot = {
  reachable: boolean;
  connectionType: string;
  model: string;
  exportedAt: string;
  content: string;
  note: string;
  capabilities?: Record<string, string | boolean>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const ROLE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  gateway: { label: "Gateway (recibe internet)", icon: Globe, color: "text-cyan-400" },
  core_router: { label: "Router central (MikroTik hEX)", icon: Server, color: "text-violet-400" },
  ptp_link: { label: "Enlace Troncal PTP", icon: ArrowUpDown, color: "text-amber-400" },
  ap_distributor: { label: "AP / Repartidor", icon: Radio, color: "text-emerald-400" },
};

const BRAND_META: Record<string, { label: string; color: string }> = {
  mikrotik_routeros: { label: "MikroTik RouterOS", color: "text-sky-400" },
  ubiquiti_airos: { label: "Ubiquiti AirOS", color: "text-orange-400" },
};

function SignalStrengthBadge({ dbm }: { dbm: string }) {
  const val = parseFloat(dbm);
  let colorClass = "text-emerald-400 border-emerald-500/30";
  if (isNaN(val)) colorClass = "text-muted-foreground border-border";
  else if (val < -80) colorClass = "text-red-400 border-red-500/30";
  else if (val < -70) colorClass = "text-yellow-400 border-yellow-500/30";
  return (
    <Badge variant="outline" className={`font-mono text-xs ${colorClass}`}>
      {dbm}
    </Badge>
  );
}

export default function EquipmentDetail() {
  const [, params] = useRoute("/equipment/:id");
  const id = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [configSnapshot, setConfigSnapshot] = useState<ConfigSnapshot | null>(null);
  const [configText, setConfigText] = useState("");
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [configPreview, setConfigPreview] = useState<ConfigPreview | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);

  const { data: equip, isLoading: loadingEquip } = useGetEquipment(id);
  const { data: liveStatus, isLoading: loadingStatus } = useGetEquipmentStatus(id, {
    query: { queryKey: getGetEquipmentStatusQueryKey(id) },
  });
  const { data: metrics } = useGetEquipmentMetrics(id, { hours: 24 }, {
    query: { queryKey: getGetEquipmentMetricsQueryKey(id, { hours: 24 }) },
  });
  const { data: wireless, isLoading: loadingWireless } = useGetEquipmentWireless(id, {
    query: { queryKey: getGetEquipmentWirelessQueryKey(id) },
  });

  const roleMeta = ROLE_META[equip?.equipmentRole ?? ""] ?? null;
  const brandMeta = BRAND_META[equip?.connectionType ?? ""] ?? null;

  const refreshWireless = () => {
    queryClient.invalidateQueries({ queryKey: getGetEquipmentWirelessQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetEquipmentStatusQueryKey(id) });
  };

  const loadConfiguration = async () => {
    setConfigLoading(true);
    try {
      const response = await fetch(`${BASE}/api/equipment/${id}/configuration`);
      const body = await response.json() as ConfigSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo leer la configuración");
      setConfigSnapshot(body);
      setConfigText(body.content);
      toast({ title: "Configuración cargada", description: "Los secretos se muestran redactados por seguridad." });
    } catch (error) {
      toast({ title: "No se pudo leer la configuración", description: error instanceof Error ? error.message : "Revisa el acceso SSH.", variant: "destructive" });
    } finally {
      setConfigLoading(false);
    }
  };

  const previewConfiguration = async (fileName: string, contentBase64: string) => {
    setConfigBusy(true);
    try {
      const response = await fetch(`${BASE}/api/equipment/${id}/configuration/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, contentBase64 }),
      });
      const body = await response.json() as ConfigPreview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo previsualizar");
      setConfigPreview(body);
      toast({ title: "Cambios listos para revisión", description: `${body.fileName} será aplicado solo después de confirmar.` });
    } catch (error) {
      toast({ title: "No se pudo previsualizar", description: error instanceof Error ? error.message : "Archivo inválido.", variant: "destructive" });
    } finally {
      setConfigBusy(false);
    }
  };

  const previewTextConfiguration = () => {
    if (!configText.trim()) {
      toast({ title: "No hay comandos para revisar", description: "Carga la configuración o escribe un script.", variant: "destructive" });
      return;
    }
    const bytes = new TextEncoder().encode(configText);
    const connectionType = equip?.connectionType ?? "mikrotik_routeros";
    void previewConfiguration(connectionType === "mikrotik_routeros" ? "manual.rsc" : "manual.txt", bytesToBase64(bytes));
  };

  const handleConfigFile = (file: File | undefined) => {
    if (!file) return;
    setConfigFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      void previewConfiguration(file.name, comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  };

  const applyConfiguration = async () => {
    if (!configPreview) return;
    if (!confirm(`¿Aplicar ${configPreview.fileName} al equipo ${equip?.model ?? "seleccionado"}? Se creó un respaldo previo y el equipo podría reiniciarse.`)) return;
    setConfigBusy(true);
    try {
      const response = await fetch(`${BASE}/api/equipment/${id}/configuration/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: configPreview.previewId }),
      });
      const body = await response.json() as { success?: boolean; message?: string; error?: string; backupPath?: string };
      if (!response.ok || !body.success) throw new Error(body.error ?? "No se pudo aplicar");
      setConfigPreview(null);
      setConfigFile(null);
      toast({
        title: "Configuración aplicada",
        description: `${body.message ?? "Cambios aplicados."}${body.backupPath ? " Se guardó un respaldo previo." : ""}`,
      });
      void loadConfiguration();
      refreshWireless();
    } catch (error) {
      toast({ title: "Aplicación detenida", description: error instanceof Error ? error.message : "El equipo rechazó la configuración.", variant: "destructive" });
    } finally {
      setConfigBusy(false);
    }
  };

  if (loadingEquip) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!equip) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Equipo no encontrado.
        <Link href="/equipment"><Button variant="link">Volver a equipos</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/equipment">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            {roleMeta && <roleMeta.icon className={`w-6 h-6 ${roleMeta.color}`} />}
            {equip.model}
            <StatusBadge status={equip.lastSeenStatus} />
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{equip.ip}</span>
            <span>·</span>
            <span>{roleMeta?.label ?? equip.equipmentRole}</span>
            <span>·</span>
            <span className={brandMeta?.color}>{brandMeta?.label ?? equip.connectionType}</span>
            <span>·</span>
            <span>Nodo: {equip.nodeName}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refreshWireless}>
          <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
        </Button>
      </div>

      {/* Live status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loadingStatus ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : liveStatus ? (
          <>
            {[
              { icon: Cpu, label: "CPU", value: liveStatus.cpuLoad ?? "—" },
              { icon: MemoryStick, label: "Memoria libre", value: liveStatus.freeMemory ?? "—" },
              { icon: Clock, label: "Uptime", value: liveStatus.uptime ?? "—" },
              { icon: Server, label: "Placa", value: liveStatus.boardName ?? liveStatus.firmware ?? "—" },
            ].map(({ icon: Icon, label, value }) => (
              <Card key={label} className="bg-card/50 border-border/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
                  </div>
                  <div className="text-sm font-mono font-medium truncate">{value}</div>
                </CardContent>
              </Card>
            ))}

            {/* Ubiquiti-specific: radio info */}
            {equip.connectionType === "ubiquiti_airos" && (liveStatus.frequency || liveStatus.txPower || liveStatus.noiseFloor) && (
              <Card className="col-span-2 md:col-span-4 bg-orange-950/10 border-orange-500/20">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Signal className="w-4 h-4 text-orange-400" />
                    <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Radio AirMAX</span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {liveStatus.frequency && (
                      <div><div className="text-[10px] text-muted-foreground">Frecuencia</div><div className="font-mono text-sm">{liveStatus.frequency}</div></div>
                    )}
                    {liveStatus.txPower && (
                      <div><div className="text-[10px] text-muted-foreground">Tx Power</div><div className="font-mono text-sm">{liveStatus.txPower}</div></div>
                    )}
                    {liveStatus.noiseFloor && (
                      <div><div className="text-[10px] text-muted-foreground">Noise Floor</div><div className="font-mono text-sm">{liveStatus.noiseFloor}</div></div>
                    )}
                    {liveStatus.airMaxCapacity && (
                      <div><div className="text-[10px] text-muted-foreground">AirMax Cap</div><div className="font-mono text-sm">{liveStatus.airMaxCapacity}</div></div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <div className="col-span-4 p-4 rounded-md bg-red-950/20 border border-red-900/30 text-red-400 text-sm">
            No se pudo obtener estado en vivo del equipo.
          </div>
        )}
      </div>

      {/* Full configuration workbench */}
      <Card className="bg-card/50 border-primary/20">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            Administración completa del equipo
            <Badge variant="outline" className="ml-auto border-primary/30 text-primary text-[10px]">
              Revisión obligatoria
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" onClick={loadConfiguration} disabled={configLoading}>
              <Download className="w-4 h-4 mr-2" />
              {configLoading ? "Leyendo..." : "Leer configuración actual"}
            </Button>
            <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium cursor-pointer hover:bg-accent hover:text-accent-foreground">
              <Upload className="w-4 h-4 mr-2" />
              {configFile ? configFile.name : "Cargar .cfg / .bin / .rsc / .backup"}
              <input
                type="file"
                className="sr-only"
                accept=".cfg,.bin,.rsc,.backup,.txt"
                onChange={(event) => handleConfigFile(event.target.files?.[0])}
              />
            </label>
            <Button onClick={previewTextConfiguration} disabled={configBusy || !configText.trim()}>
              <FileCode2 className="w-4 h-4 mr-2" />
              Revisar script escrito
            </Button>
          </div>
          <div className="rounded-md border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Flujo protegido para airOS y RouterOS
            </div>
            <p>
              Puedes cargar respaldos nativos, exports RouterOS o scripts manuales. El CMS crea un respaldo antes de aplicar y registra la operación en Audit Log.
            </p>
            <p>
              Para cambios de SSID, contraseña WiFi, modo AP/Station, frecuencia, IP, DHCP o credenciales administrativas, usa el formato de comandos del propio firmware.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Editor de configuración / comandos</Label>
            <Textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              placeholder={equip.connectionType === "mikrotik_routeros"
                ? "/interface/wifi set [find] configuration.ssid=\"NUEVA_RED\"\n/ip/address add address=192.168.88.2/24 interface=ether1"
                : "mca-cli-op set wireless.1.ssid=NUEVA_RED\n# Usa los comandos soportados por la versión de airOS instalada"}
              className="min-h-44 font-mono text-xs"
            />
          </div>
          {configSnapshot && (
            <div className="rounded-md border border-border/50 p-3 text-xs">
              <div className="flex items-center gap-2 mb-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Configuración leída: {new Date(configSnapshot.exportedAt).toLocaleString("es")}
              </div>
              <p className="text-muted-foreground">{configSnapshot.note}</p>
              {configSnapshot.capabilities && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.entries(configSnapshot.capabilities).map(([name, value]) => (
                    <Badge key={name} variant="outline" className="text-[10px] border-border/70">
                      {name}: {String(value)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
          {configPreview && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-950/10 p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium text-yellow-300">
                <AlertTriangle className="w-4 h-4" /> Revisión antes de aplicar
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground">Archivo</span><div className="font-mono truncate">{configPreview.fileName}</div></div>
                <div><span className="text-muted-foreground">Formato</span><div>{configPreview.format}</div></div>
                <div><span className="text-muted-foreground">Tamaño</span><div>{Math.ceil(configPreview.sizeBytes / 1024)} KB</div></div>
                <div><span className="text-muted-foreground">Líneas</span><div>{configPreview.lineCount}</div></div>
              </div>
              {configPreview.warning && <p className="text-xs text-yellow-200">{configPreview.warning}</p>}
              {configPreview.dangerousLines.length > 0 && (
                <div className="text-xs text-red-300">
                  Se detectaron comandos sensibles. El backend los bloqueará si son destructivos:
                  <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap font-mono">{configPreview.dangerousLines.join("\n")}</pre>
                </div>
              )}
              {configPreview.commands.length > 0 && (
                <pre className="max-h-40 overflow-auto rounded bg-black/30 p-3 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap">
                  {configPreview.commands.join("\n")}
                </pre>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfigPreview(null)}>Cancelar revisión</Button>
                <Button onClick={applyConfiguration} disabled={configBusy}>
                  {configBusy ? "Aplicando..." : "Confirmar y aplicar"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wireless Registration Table */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            Tabla de Registro Inalámbrico
            <Badge variant="outline" className={
              equip.connectionType === "ubiquiti_airos"
                ? "border-orange-500/30 text-orange-400 text-[10px]"
                : "border-sky-500/30 text-sky-400 text-[10px]"
            }>
               {equip.connectionType === "ubiquiti_airos" ? "Ubiquiti wstalist / airOS" : "MikroTik RouterOS"}
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {wireless?.length ?? 0} estaciones conectadas
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingWireless ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !wireless || wireless.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-1">
              <Wifi className="w-8 h-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm">Sin estaciones inalámbricas detectadas.</p>
              <p className="text-xs text-muted-foreground/60">
                {equip.connectionType === "ubiquiti_airos"
                  ? "Verifica que el equipo tenga SSH habilitado o el API HTTP accesible."
                  : "Verifica que la interfaz wireless esté activa en RouterOS."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MAC</TableHead>
                  <TableHead>IP / Nombre</TableHead>
                  <TableHead>Señal (dBm)</TableHead>
                  <TableHead>Ruido</TableHead>
                  <TableHead>CCQ</TableHead>
                  <TableHead>Tx / Rx</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead>Distancia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wireless.map((sta, i) => (
                  <TableRow key={i} className="hover:bg-card/30">
                    <TableCell className="font-mono text-xs">{sta.mac}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{sta.name ?? "—"}</TableCell>
                    <TableCell><SignalStrengthBadge dbm={sta.signalDbm} /></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{sta.noiseDbm ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{sta.ccq}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {sta.txRate ? `↑${sta.txRate}` : "—"} {sta.rxRate ? `↓${sta.rxRate}` : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{sta.uptime ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{sta.distance ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historical signal chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <Signal className="w-4 h-4 text-primary" />
            Señal Histórica — Últimas 24 horas
            <span className="text-xs text-muted-foreground ml-auto">{(metrics ?? []).length} puntos</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!metrics || metrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-36 text-muted-foreground/50 text-sm">
              <Signal className="w-8 h-8 mb-2" />
              Sin datos históricos aún. Se recolectan cada 5 min en equipos Ubiquiti.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={metrics.map(m => ({
                  time: new Date(m.recordedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
                  "Señal dBm": m.signalDbm,
                  "CCQ %": m.ccq,
                }))}
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#6b7280" }} />
                <YAxis yAxisId="dbm" domain={[-100, -40]} tick={{ fontSize: 10, fill: "#6b7280" }} />
                <YAxis yAxisId="ccq" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} />
                <Tooltip contentStyle={{ backgroundColor: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="dbm" type="monotone" dataKey="Señal dBm" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="ccq" type="monotone" dataKey="CCQ %" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
