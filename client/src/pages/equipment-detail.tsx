import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import {
  useGetEquipment, useGetEquipmentStatus, useGetEquipmentWireless, useGetEquipmentMetrics,
  useListEquipment, getListEquipmentQueryKey, useUpdateEquipment,
  getGetEquipmentQueryKey, getGetEquipmentStatusQueryKey, getGetEquipmentWirelessQueryKey, getGetEquipmentMetricsQueryKey,
  getEquipmentConfiguration, previewEquipmentConfigurationFile, previewEquipmentConfigurationSettings, applyEquipmentConfiguration,
  type EquipmentConfiguration, type EquipmentConfigurationParameter, type EquipmentConfigurationPreview,
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ConfigPreview = EquipmentConfigurationPreview;
type ConfigParameter = EquipmentConfigurationParameter;
type ConfigSnapshot = EquipmentConfiguration;

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
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [configPreview, setConfigPreview] = useState<ConfigPreview | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [parentEquipmentId, setParentEquipmentId] = useState("");
  const [parentCapacityLimit, setParentCapacityLimit] = useState("");
  const canApplyDeviceConfig = configSnapshot?.controlPolicy?.canApply === true;

  const { data: equip, isLoading: loadingEquip } = useGetEquipment(id);
  const { data: allEquipment } = useListEquipment({ query: { queryKey: getListEquipmentQueryKey() } });
  const updateEquipment = useUpdateEquipment();
  const { data: liveStatus, isLoading: loadingStatus } = useGetEquipmentStatus(id, {
    query: { queryKey: getGetEquipmentStatusQueryKey(id) },
  });
  const { data: metrics } = useGetEquipmentMetrics(id, { hours: 24 }, {
    query: { queryKey: getGetEquipmentMetricsQueryKey(id, { hours: 24 }) },
  });
  const { data: wireless, isLoading: loadingWireless } = useGetEquipmentWireless(id, {
    query: { queryKey: getGetEquipmentWirelessQueryKey(id) },
  });

  useEffect(() => {
    setParentEquipmentId(equip?.parentEquipmentId ? String(equip.parentEquipmentId) : "");
    setParentCapacityLimit(equip?.parentCapacityLimit ?? "");
  }, [equip?.id, equip?.parentEquipmentId, equip?.parentCapacityLimit]);

  const hasDescendant = (candidateId: number) => {
    const seen = new Set<number>();
    let current = allEquipment?.find((item) => item.id === candidateId);
    while (current?.parentEquipmentId != null && !seen.has(current.id)) {
      if (current.parentEquipmentId === id) return true;
      seen.add(current.id);
      current = allEquipment?.find((item) => item.id === current?.parentEquipmentId);
    }
    return false;
  };
  const parentCandidates = (allEquipment ?? []).filter((item) =>
    item.connectionType === "mikrotik_routeros" &&
    item.id !== id &&
    !hasDescendant(item.id),
  );
  const parentEquipment = allEquipment?.find((item) => item.id === equip?.parentEquipmentId);
  const childEquipment = (allEquipment ?? []).filter((item) => item.parentEquipmentId === id);

  const saveTopology = () => {
    const selectedParentId = parentEquipmentId ? Number(parentEquipmentId) : null;
    if (selectedParentId !== null && !parentCapacityLimit.trim()) {
      toast({
        title: "Falta la capacidad asignada",
        description: "Indica un valor como 100M/100M para guardar la relación.",
        variant: "destructive",
      });
      return;
    }
    updateEquipment.mutate({
      id,
      data: {
        parentEquipmentId: selectedParentId,
        parentCapacityLimit: selectedParentId === null ? null : parentCapacityLimit.trim(),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetEquipmentQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        toast({ title: "Topología actualizada", description: "La relación y capacidad quedaron registradas en Imperio AP." });
      },
      onError: (error) => toast({
        title: "No se pudo guardar la topología",
        description: error.message,
        variant: "destructive",
      }),
    });
  };

  const roleMeta = ROLE_META[equip?.equipmentRole ?? ""] ?? null;
  const brandMeta = BRAND_META[equip?.connectionType ?? ""] ?? null;

  const refreshWireless = () => {
    queryClient.invalidateQueries({ queryKey: getGetEquipmentWirelessQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetEquipmentStatusQueryKey(id) });
  };

  const loadConfiguration = async () => {
    setConfigLoading(true);
    try {
      const body = await getEquipmentConfiguration(id);
      setConfigSnapshot(body);
      setConfigText("");
      setParameterDrafts(Object.fromEntries((body.parameters ?? []).map(parameter => [
        parameter.key,
        parameter.value ?? "",
      ])));
      setConfigPreview(null);
      toast({ title: "Configuración cargada", description: "Los secretos se muestran redactados por seguridad." });
    } catch (error) {
      toast({ title: "No se pudo leer la configuración", description: error instanceof Error ? error.message : "Revisa el acceso SSH.", variant: "destructive" });
    } finally {
      setConfigLoading(false);
    }
  };

  const previewConfiguration = async (fileName: string, contentBase64: string) => {
    if (!canApplyDeviceConfig) {
      toast({ title: "Equipo en solo lectura", description: configSnapshot?.controlPolicy?.reason ?? "Lee y detecta primero el modelo y firmware.", variant: "destructive" });
      return;
    }
    setConfigBusy(true);
    try {
      const body = await previewEquipmentConfigurationFile(id, { fileName, contentBase64 });
      setConfigPreview(body);
      toast({ title: "Cambios listos para revisión", description: `${body.fileName} será aplicado solo después de confirmar.` });
    } catch (error) {
      toast({ title: "No se pudo previsualizar", description: error instanceof Error ? error.message : "Archivo inválido.", variant: "destructive" });
    } finally {
      setConfigBusy(false);
    }
  };

  const previewStructuredSettings = async () => {
    if (!configSnapshot || !canApplyDeviceConfig) {
      toast({ title: "Equipo en solo lectura", description: configSnapshot?.controlPolicy?.reason ?? "Lee y detecta primero el modelo y firmware.", variant: "destructive" });
      return;
    }
    const changes = (configSnapshot.parameters ?? []).flatMap(parameter => {
      const draft = parameterDrafts[parameter.key] ?? "";
      const original = parameter.sensitive ? "" : parameter.value ?? "";
      return (parameter.sensitive ? Boolean(draft.trim()) : draft !== original)
        ? [{ key: parameter.key, value: draft }]
        : [];
    });
    if (changes.length === 0) {
      toast({ title: "No hay cambios", description: "Modifica una o más opciones detectadas antes de continuar.", variant: "destructive" });
      return;
    }
    setConfigBusy(true);
    try {
      const body = await previewEquipmentConfigurationSettings(id, { changes });
      setConfigPreview(body);
      toast({ title: "Opciones listas para revisión", description: `${body.lineCount} cambios quedarán pendientes de confirmación.` });
    } catch (error) {
      toast({ title: "No se pudieron revisar las opciones", description: error instanceof Error ? error.message : "Comprueba los valores.", variant: "destructive" });
    } finally {
      setConfigBusy(false);
    }
  };

  const previewTextConfiguration = () => {
    if (!canApplyDeviceConfig) {
      toast({ title: "Equipo en solo lectura", description: configSnapshot?.controlPolicy?.reason ?? "Lee y detecta primero el modelo y firmware.", variant: "destructive" });
      return;
    }
    if (!configText.trim()) {
      toast({ title: "No hay comandos para revisar", description: "Carga la configuración o escribe un script.", variant: "destructive" });
      return;
    }
    const bytes = new TextEncoder().encode(configText);
    const connectionType = equip?.connectionType ?? "mikrotik_routeros";
    void previewConfiguration(connectionType === "mikrotik_routeros" ? "manual.rsc" : "manual.txt", bytesToBase64(bytes));
  };

  const handleConfigFile = (file: File | undefined) => {
    if (!file || !canApplyDeviceConfig) return;
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
    const detectedModel = configSnapshot?.identity?.model ?? equip?.model ?? "seleccionado";
    const firmware = configSnapshot?.identity?.firmware ? ` (${configSnapshot.identity.firmware})` : "";
    if (!confirm(`¿Aplicar ${configPreview.fileName} al equipo ${detectedModel}${firmware}? Se creará un respaldo previo y el equipo podría reiniciarse.`)) return;
    setConfigBusy(true);
    try {
      const body = await applyEquipmentConfiguration(id, {
        previewId: configPreview.previewId,
        confirmed: true,
      });
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

      {equip.connectionType === "mikrotik_routeros" && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" /> Topología MikroTik y capacidad asignada
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <Label>MikroTik padre</Label>
                <Select value={parentEquipmentId || "none"} onValueChange={(value) => {
                  setParentEquipmentId(value === "none" ? "" : value);
                  if (value === "none") setParentCapacityLimit("");
                }}>
                  <SelectTrigger data-testid="select-topology-parent"><SelectValue placeholder="Sin padre" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin router padre</SelectItem>
                    {parentCandidates.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>{item.model} · {item.ip}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {parentEquipment && (
                  <p className="text-xs text-muted-foreground">
                    Actualmente conectado a {parentEquipment.model} · {parentEquipment.ip}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Capacidad asignada desde el padre</Label>
                <Input
                  data-testid="input-topology-capacity"
                  value={parentCapacityLimit}
                  onChange={(event) => setParentCapacityLimit(event.target.value)}
                  disabled={!parentEquipmentId}
                  placeholder="100M/100M"
                  className="font-mono"
                />
              </div>
              <Button
                data-testid="button-save-topology"
                onClick={saveTopology}
                disabled={updateEquipment.isPending}
              >
                {updateEquipment.isPending ? "Guardando..." : "Guardar topología"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              La capacidad se registra como referencia en Imperio AP. Este guardado no modifica RouterOS.
            </p>
            <div className="border-t border-border/40 pt-3">
              <h3 className="text-sm font-medium mb-2">MikroTiks dependientes ({childEquipment.length})</h3>
              {childEquipment.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay equipos hijos asociados.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {childEquipment.map((child) => (
                    <Link key={child.id} href={`/equipment/${child.id}`}>
                      <div
                        data-testid={`equipment-child-${child.id}`}
                        className="rounded-md border border-border/50 p-3 hover:bg-muted/20"
                      >
                        <div className="font-medium text-sm">{child.model}</div>
                        <div className="text-xs text-muted-foreground font-mono">{child.ip}</div>
                        <div className="text-xs mt-2">Capacidad asignada: <span className="font-mono">{child.parentCapacityLimit ?? "Sin registrar"}</span></div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
              { icon: Server, label: "Identificación", value: liveStatus.boardName ?? liveStatus.firmware ?? "—" },
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
                    <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Radio</span>
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
              {configLoading ? "Detectando..." : "Detectar modelo y leer configuración"}
            </Button>
            <label className={`inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ${canApplyDeviceConfig ? "cursor-pointer hover:bg-accent hover:text-accent-foreground" : "cursor-not-allowed opacity-50"}`}>
              <Upload className="w-4 h-4 mr-2" />
              {configFile ? configFile.name : canApplyDeviceConfig ? "Cargar .cfg / .bin / .rsc / .backup" : "Carga bloqueada hasta detectar perfil"}
              <input
                type="file"
                className="sr-only"
                accept=".cfg,.bin,.rsc,.backup,.txt"
                disabled={!canApplyDeviceConfig || configBusy}
                onChange={(event) => handleConfigFile(event.target.files?.[0])}
              />
            </label>
            <Button onClick={previewTextConfiguration} disabled={configBusy || !canApplyDeviceConfig || !configText.trim()}>
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
            <Label>Editor de comandos para el perfil detectado</Label>
            <Textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              readOnly={!canApplyDeviceConfig}
              placeholder={equip.connectionType === "mikrotik_routeros"
                ? "/interface/wifi set [find] configuration.ssid=\"NUEVA_RED\"\n/ip/address add address=192.168.88.2/24 interface=ether1"
                : "mca-cli-op set wireless.1.ssid=NUEVA_RED\n# Usa los comandos soportados por la versión de airOS instalada"}
              className="min-h-44 font-mono text-xs"
            />
          </div>
          {!configSnapshot && (
            <p className="text-xs text-muted-foreground">
              Lee la configuración para detectar el modelo, el firmware y las capacidades antes de habilitar cambios.
            </p>
          )}
          {configSnapshot && (
            <div className="rounded-md border border-border/50 p-3 text-xs">
              <div className="flex items-center gap-2 mb-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Configuración leída: {new Date(configSnapshot.exportedAt).toLocaleString("es")}
              </div>
              <p className="text-muted-foreground">{configSnapshot.note}</p>
              {configSnapshot.identity && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div><span className="text-muted-foreground">Fabricante</span><div className="font-medium">{configSnapshot.identity.manufacturer}</div></div>
                  <div><span className="text-muted-foreground">Modelo detectado</span><div className="font-medium">{configSnapshot.identity.model ?? "No detectado"}{configSnapshot.identity.source === "inventory" ? " · inventario" : configSnapshot.identity.source === "unknown" ? " · sin verificar" : ""}</div></div>
                  <div><span className="text-muted-foreground">Firmware</span><div className="font-medium">{configSnapshot.identity.firmware ?? "No detectado"}</div></div>
                  <div><span className="text-muted-foreground">Perfil</span><div className="font-medium">{configSnapshot.identity.profileId}</div></div>
                </div>
              )}
              {configSnapshot.content && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver export protegido</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded bg-black/20 p-3 font-mono text-[10px] whitespace-pre-wrap">
                    {configSnapshot.content.split(/\r?\n/).slice(0, 200).join("\n")}
                  </pre>
                  {configSnapshot.content.split(/\r?\n/).length > 200 && (
                    <p className="mt-1 text-[10px] text-muted-foreground">Vista limitada a las primeras 200 líneas.</p>
                  )}
                </details>
              )}
              {configSnapshot.controlPolicy && !configSnapshot.controlPolicy.canApply && (
                <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-200">
                  Solo lectura: {configSnapshot.controlPolicy.reason}
                </p>
              )}
              {configSnapshot.capabilities && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.entries(configSnapshot.capabilities).map(([name, value]) => (
                    <Badge key={name} variant="outline" className={`text-[10px] border-border/70 ${name === "airMax" && value === "disabled" ? "border-muted-foreground/40 text-muted-foreground" : ""}`}>
                      {name}: {String(value)}
                    </Badge>
                  ))}
                </div>
              )}
              {canApplyDeviceConfig && (configSnapshot.parameters?.length ?? 0) > 0 && (
                <section className="mt-4 space-y-3 border-t border-border/50 pt-4">
                  <div>
                    <h3 className="font-semibold text-foreground">Opciones detectadas en este firmware</h3>
                    <p className="mt-1 text-muted-foreground">
                      Se muestran las opciones presentes en el archivo nativo. Los secretos permanecen ocultos; para conservarlos, deja esos campos vacíos. Revisa hasta 100 cambios por envío.
                    </p>
                  </div>
                  <div className="grid max-h-96 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                    {(configSnapshot.parameters ?? []).map((parameter, index) => (
                      <div key={`${parameter.key}-${index}`} className="space-y-1">
                        <Label htmlFor={`device-setting-${index}`} className="font-mono text-[10px]">
                          {parameter.key}
                        </Label>
                        <Input
                          id={`device-setting-${index}`}
                          type={parameter.sensitive ? "password" : parameter.valueType === "number" ? "number" : "text"}
                          value={parameterDrafts[parameter.key] ?? ""}
                          maxLength={1024}
                          autoComplete="off"
                          placeholder={parameter.sensitive ? "Vacío conserva el valor actual" : undefined}
                          onChange={(event) => setParameterDrafts(previous => ({
                            ...previous,
                            [parameter.key]: event.target.value,
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                  <Button onClick={previewStructuredSettings} disabled={configBusy || !canApplyDeviceConfig}>
                    <FileCode2 className="mr-2 h-4 w-4" />
                    Revisar opciones modificadas
                  </Button>
                </section>
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
