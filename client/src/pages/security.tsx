import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListEquipment, getListEquipmentQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, ArrowRightLeft, Check, ChevronDown, ChevronRight, CircleHelp, Globe2, Info, ListFilter, LockKeyhole, Pencil, Plus, RefreshCw, Router as RouterIcon, ShieldCheck, SlidersHorizontal, Trash2, WandSparkles, Wifi, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

import { apiFetch } from "@/lib/api-fetch";

type RuleKind = "filter" | "nat" | "mangle" | "raw";
type SecurityTab = RuleKind | "lists" | "services";

type SecurityRule = {
  id?: string | number;
  ruleId?: string | number;
  action?: string | null;
  chain?: string | null;
  comment?: string | null;
  protocol?: string | null;
  srcAddress?: string | null;
  dstAddress?: string | null;
  srcPort?: string | number | null;
  dstPort?: string | number | null;
  srcAddressList?: string | null;
  dstAddressList?: string | null;
  connectionState?: string | null;
  connectionNatState?: string | null;
  connectionMark?: string | null;
  packetMark?: string | null;
  routingMark?: string | null;
  newConnectionMark?: string | null;
  newPacketMark?: string | null;
  newRoutingMark?: string | null;
  inInterface?: string | null;
  toAddresses?: string | null;
  toPorts?: string | number | null;
  outInterface?: string | null;
  jumpTarget?: string | null;
  addressList?: string | null;
  addressListTimeout?: string | null;
  layer7Protocol?: string | null;
  tcpFlags?: string | null;
  srcMacAddress?: string | null;
  dstMacAddress?: string | null;
  connectionBytes?: string | null;
  connectionRate?: string | null;
  nth?: string | null;
  limit?: string | null;
  time?: string | null;
  hotspot?: string | null;
  fragment?: string | null;
  ttl?: string | null;
  log?: string | null;
  logPrefix?: string | null;
  passthrough?: string | null;
  placeBefore?: string | number | null;
  [key: string]: unknown;
};

type AddressEntry = {
  id?: string | number;
  entryId?: string | number;
  list?: string | null;
  address?: string | null;
  comment?: string | null;
};

type SecurityResponse = {
  equipment?: { id?: number; model?: string; ip?: string; connectionType?: string; equipmentRole?: string };
  filters?: SecurityRule[];
  nat?: SecurityRule[];
  mangle?: SecurityRule[];
  raw?: SecurityRule[];
  addressLists?: AddressEntry[];
  services?: SecurityRule[];
};

type MutationResponse = { success?: boolean; message?: string; item?: unknown };

type RuleForm = {
  action: string;
  chain: string;
  comment: string;
  protocol: string;
  srcAddress: string;
  dstAddress: string;
  srcPort: string;
  dstPort: string;
  srcAddressList: string;
  dstAddressList: string;
  connectionState: string;
  connectionNatState: string;
  connectionMark: string;
  packetMark: string;
  routingMark: string;
  newConnectionMark: string;
  newPacketMark: string;
  newRoutingMark: string;
  inInterface: string;
  toAddresses: string;
  toPorts: string;
  outInterface: string;
  jumpTarget: string;
  addressList: string;
  addressListTimeout: string;
  layer7Protocol: string;
  tcpFlags: string;
  srcMacAddress: string;
  dstMacAddress: string;
  connectionBytes: string;
  connectionRate: string;
  nth: string;
  limit: string;
  time: string;
  hotspot: string;
  fragment: string;
  ttl: string;
  log: string;
  logPrefix: string;
  passthrough: string;
  placeBefore: string;
};

type AddressForm = { list: string; address: string; comment: string };

const blankRule: RuleForm = {
  action: "accept",
  chain: "input",
  comment: "",
  protocol: "",
  srcAddress: "",
  dstAddress: "",
  srcPort: "",
  dstPort: "",
  srcAddressList: "",
  dstAddressList: "",
  connectionState: "",
  connectionNatState: "",
  connectionMark: "",
  packetMark: "",
  routingMark: "",
  newConnectionMark: "",
  newPacketMark: "",
  newRoutingMark: "",
  inInterface: "",
  toAddresses: "",
  toPorts: "",
  outInterface: "",
  jumpTarget: "",
  addressList: "",
  addressListTimeout: "",
  layer7Protocol: "",
  tcpFlags: "",
  srcMacAddress: "",
  dstMacAddress: "",
  connectionBytes: "",
  connectionRate: "",
  nth: "",
  limit: "",
  time: "",
  hotspot: "",
  fragment: "",
  ttl: "",
  log: "",
  logPrefix: "",
  passthrough: "",
  placeBefore: "",
};

const blankAddress: AddressForm = { list: "clientes_activos", address: "", comment: "" };

const actionLabels: Record<string, string> = {
  accept: "Permitir",
  drop: "Bloquear",
  reject: "Rechazar",
  masquerade: "Masquerade",
  redirect: "Redirigir",
  jump: "Saltar a otra cadena",
  passthrough: "Continuar",
  "notrack": "No rastrear la conexión",
  "mark-connection": "Marcar conexión",
  "mark-packet": "Marcar paquete",
  "mark-routing": "Marcar enrutamiento",
  "change-mss": "Cambiar MSS",
  "src-nat": "NAT de origen",
  "dst-nat": "NAT de destino",
  "netmap": "Mapeo de red",
  "add-src-to-address-list": "Agregar origen a una lista",
  "add-dst-to-address-list": "Agregar destino a una lista",
};

const actionOptions: Record<RuleKind, Array<{ value: string; label: string }>> = {
  filter: [
    { value: "accept", label: "Permitir" }, { value: "drop", label: "Bloquear silenciosamente" },
    { value: "reject", label: "Rechazar y avisar" }, { value: "jump", label: "Saltar a otra cadena" },
    { value: "return", label: "Volver a la cadena anterior" }, { value: "log", label: "Registrar en el log" },
    { value: "passthrough", label: "Continuar sin decidir" }, { value: "add-src-to-address-list", label: "Agregar origen a una lista" },
    { value: "add-dst-to-address-list", label: "Agregar destino a una lista" },
  ],
  nat: [
    { value: "masquerade", label: "Masquerade (NAT dinámico)" }, { value: "src-nat", label: "NAT de origen" },
    { value: "dst-nat", label: "NAT de destino / Port Forward" }, { value: "redirect", label: "Redirigir al router" },
    { value: "netmap", label: "Mapeo 1:1 de red" },
  ],
  mangle: [
    { value: "mark-connection", label: "Marcar conexión" }, { value: "mark-packet", label: "Marcar paquete" },
    { value: "mark-routing", label: "Marcar enrutamiento" }, { value: "change-mss", label: "Cambiar MSS" },
    { value: "accept", label: "Permitir" }, { value: "drop", label: "Bloquear" },
    { value: "jump", label: "Saltar a otra cadena" }, { value: "log", label: "Registrar en el log" },
    { value: "passthrough", label: "Continuar" }, { value: "return", label: "Volver" },
  ],
  raw: [
    { value: "accept", label: "Permitir" }, { value: "drop", label: "Bloquear" },
    { value: "notrack", label: "No rastrear conexión" }, { value: "jump", label: "Saltar a otra cadena" },
    { value: "return", label: "Volver" },
  ],
};

const tabMeta: Record<SecurityTab, { label: string; short: string; icon: typeof ShieldCheck; description: string }> = {
  filter: { label: "Filter Rules", short: "Filter", icon: LockKeyhole, description: "Controla quién puede entrar al router y qué tráfico puede atravesarlo." },
  nat: { label: "NAT", short: "NAT", icon: Globe2, description: "Traduce direcciones, publica servicios internos y permite la salida a Internet." },
  mangle: { label: "Mangle", short: "Mangle", icon: SlidersHorizontal, description: "Marca conexiones, paquetes y rutas para aplicar políticas avanzadas." },
  raw: { label: "Raw", short: "Raw", icon: Zap, description: "Filtra tráfico antes del seguimiento de conexiones para ahorrar recursos." },
  lists: { label: "Address Lists", short: "Listas", icon: ListFilter, description: "Agrupa IPs y redes para reutilizarlas en cualquier regla." },
  services: { label: "Service Ports", short: "Servicios", icon: CircleHelp, description: "Consulta los servicios administrativos expuestos por el router." },
};

function ruleId(rule: SecurityRule): string {
  return String(rule.id ?? rule.ruleId ?? "");
}

function displayValue(value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function ruleExplanation(rule: SecurityRule, kind: RuleKind): string {
  const action = String(rule.action ?? "").toLowerCase();
  const subject = rule.protocol ? `${rule.protocol.toUpperCase()}${rule.dstPort ? ` en puerto ${rule.dstPort}` : ""}` : "este tráfico";
  const source = rule.srcAddressList
    ? ` de la lista ${rule.srcAddressList}`
    : rule.srcAddress
      ? ` desde ${rule.srcAddress}`
      : "";
  if (kind === "nat") {
    if (action === "masquerade") return "NAT de salida: permite que los clientes naveguen usando la conexión WAN.";
    if (action === "dst-nat") return `Redirección: lleva ${subject} hacia ${displayValue(rule.toAddresses)}${rule.toPorts ? `:${rule.toPorts}` : ""}.`;
    return `${actionLabels[action] ?? displayValue(rule.action)} ${subject} para tráfico${source}.`;
  }
  if (rule.chain === "input") return `${actionLabels[action] ?? displayValue(rule.action)} ${subject}${source} directamente contra el router.`;
  return `${actionLabels[action] ?? displayValue(rule.action)} ${subject}${source} al cruzar la red.`;
}

function roleLabel(role?: string) {
  if (role === "core_router") return "Router central";
  if (role === "gateway") return "Gateway";
  if (role === "ap_distributor") return "AP / Repartidor";
  if (role === "ptp_link") return "Enlace PTP";
  return role ?? "Equipo de red";
}

function statusClass(status?: string) {
  if (status === "ONLINE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "OFFLINE") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-border text-muted-foreground";
}

type RuleFieldKey = Exclude<keyof RuleForm, "action" | "chain" | "comment">;

const fieldMeta: Record<RuleFieldKey, { label: string; placeholder: string; group: string; help: string }> = {
  protocol: { label: "Protocolo", placeholder: "tcp, udp o icmp", group: "Tráfico", help: "Limita la regla a un tipo de tráfico. Si escribes tcp, por ejemplo, no afectará a UDP." },
  srcAddress: { label: "IP o red de origen", placeholder: "10.0.0.0/8", group: "Direcciones", help: "Es la red o IP que inicia la conexión. Vacío significa cualquier origen." },
  dstAddress: { label: "IP o red de destino", placeholder: "192.168.88.1", group: "Direcciones", help: "Es la IP o red a la que se dirige el tráfico. Vacío significa cualquier destino." },
  srcPort: { label: "Puerto de origen", placeholder: "1024-65535", group: "Puertos", help: "Filtra por el puerto desde el que sale la conexión. Normalmente se deja vacío para clientes." },
  dstPort: { label: "Puerto de destino", placeholder: "80, 443 o 8291", group: "Puertos", help: "Filtra el servicio al que se intenta acceder. 8291, por ejemplo, es el puerto habitual de Winbox." },
  srcAddressList: { label: "Lista de origen", placeholder: "clientes_activos", group: "Direcciones", help: "Usa una lista de IPs existente. La regla se aplicará a cada dirección que pertenezca a ella." },
  dstAddressList: { label: "Lista de destino", placeholder: "servidores_internos", group: "Direcciones", help: "Usa una lista de destinos para evitar repetir muchas IPs en la regla." },
  connectionState: { label: "Estado de conexión", placeholder: "established,related", group: "Conexión", help: "Permite distinguir conexiones nuevas de respuestas. established,related suele permitir respuestas ya relacionadas." },
  connectionNatState: { label: "Estado NAT", placeholder: "dstnat o srcnat", group: "Conexión", help: "Filtra conexiones que ya fueron traducidas por NAT. Útil para proteger o publicar servicios." },
  connectionMark: { label: "Marca de conexión", placeholder: "ruta_cliente_1", group: "Marcado", help: "Selecciona conexiones que ya tienen una marca creada por una regla Mangle anterior." },
  packetMark: { label: "Marca de paquete", placeholder: "video", group: "Marcado", help: "Selecciona paquetes marcados para aplicar colas, rutas o políticas específicas." },
  routingMark: { label: "Marca de enrutamiento", placeholder: "wan_2", group: "Marcado", help: "Selecciona tráfico que debe seguir una tabla de rutas concreta." },
  newConnectionMark: { label: "Nueva marca de conexión", placeholder: "cliente_premium", group: "Acción", help: "Guarda una etiqueta en la conexión. Después puedes usarla en otras reglas Mangle, Filter o colas." },
  newPacketMark: { label: "Nueva marca de paquete", placeholder: "video", group: "Acción", help: "Etiqueta cada paquete coincidente para que QoS, colas o reglas posteriores lo reconozcan." },
  newRoutingMark: { label: "Nueva marca de enrutamiento", placeholder: "wan_2", group: "Acción", help: "Hace que el tráfico use una tabla de rutas específica. Debe existir una ruta compatible." },
  inInterface: { label: "Interfaz de entrada", placeholder: "bridge-clientes", group: "Interfaces", help: "Solo coincide cuando el tráfico entra por esa interfaz. Ejemplo: bridge-clientes." },
  outInterface: { label: "Interfaz de salida", placeholder: "ether1-WAN", group: "Interfaces", help: "Solo coincide cuando el tráfico sale por esa interfaz. Es habitual usarla en masquerade." },
  toAddresses: { label: "Traducir hacia IP", placeholder: "10.0.0.20", group: "NAT", help: "En un dst-nat, es la IP interna que recibirá el tráfico publicado." },
  toPorts: { label: "Traducir hacia puerto", placeholder: "8080", group: "NAT", help: "En un dst-nat, es el puerto interno al que se redirigirá el puerto público." },
  jumpTarget: { label: "Cadena personalizada", placeholder: "proteger-clientes", group: "Acción", help: "La regla saltará a una cadena personalizada. Esa cadena debe existir en RouterOS." },
  addressList: { label: "Lista que se modificará", placeholder: "sospechosos", group: "Acción", help: "Con una acción compatible, agrega la IP coincidente a esta lista para reutilizarla en reglas posteriores." },
  addressListTimeout: { label: "Tiempo en la lista", placeholder: "1h, 1d o none", group: "Acción", help: "Define cuánto tiempo permanecerá la IP en la lista. none la deja hasta eliminarla manualmente." },
  layer7Protocol: { label: "Protocolo Layer7", placeholder: "streaming", group: "Avanzado", help: "Usa un patrón Layer7 definido en RouterOS. Consume más recursos que filtrar por puerto." },
  tcpFlags: { label: "Banderas TCP", placeholder: "syn", group: "Avanzado", help: "Permite coincidir solo paquetes TCP con ciertas banderas, por ejemplo SYN para conexiones nuevas." },
  srcMacAddress: { label: "MAC de origen", placeholder: "AA:BB:CC:DD:EE:FF", group: "Avanzado", help: "Limita la regla a un equipo físico concreto dentro de la red local." },
  dstMacAddress: { label: "MAC de destino", placeholder: "AA:BB:CC:DD:EE:FF", group: "Avanzado", help: "Limita la regla al equipo físico de destino cuando RouterOS puede ver esa MAC." },
  connectionBytes: { label: "Bytes de conexión", placeholder: "1000000-0", group: "Avanzado", help: "Coincide cuando la conexión ha transferido un rango de bytes. Útil para políticas después de cierto consumo." },
  connectionRate: { label: "Velocidad de conexión", placeholder: "1M-10M", group: "Avanzado", help: "Coincide según la velocidad observada de la conexión." },
  nth: { label: "Distribución Nth", placeholder: "2,1", group: "Avanzado", help: "Distribuye conexiones o paquetes entre varias reglas. Úsalo solo si tienes claro el patrón de reparto." },
  limit: { label: "Límite", placeholder: "10,10:packet", group: "Avanzado", help: "Limita cuántas coincidencias puede procesar la regla en un intervalo." },
  time: { label: "Horario", placeholder: "08:00:00-18:00:00", group: "Avanzado", help: "Activa la coincidencia solo en un horario. Puedes combinarlo con los días de la semana." },
  hotspot: { label: "Estado HotSpot", placeholder: "from-client", group: "Avanzado", help: "Filtra tráfico según el estado del usuario HotSpot." },
  fragment: { label: "Fragmentación", placeholder: "yes o no", group: "Avanzado", help: "Indica si la regla debe coincidir con paquetes IP fragmentados." },
  ttl: { label: "TTL", placeholder: "64", group: "Avanzado", help: "Coincide con un valor TTL concreto. Se usa en escenarios avanzados de diagnóstico o control." },
  log: { label: "Registrar en log", placeholder: "yes o no", group: "Registro", help: "Si se activa, cada coincidencia se escribirá en el log del router." },
  logPrefix: { label: "Prefijo del log", placeholder: "FIREWALL_CLIENTE", group: "Registro", help: "Texto para encontrar rápidamente estas coincidencias en los logs." },
  passthrough: { label: "Continuar después de Mangle", placeholder: "yes o no", group: "Acción", help: "Si es yes, RouterOS seguirá evaluando las reglas siguientes después de esta coincidencia." },
  placeBefore: { label: "Colocar antes de", placeholder: "ID de regla", group: "Orden", help: "Las reglas se procesan de arriba hacia abajo. Colocar una regla antes puede cambiar cuál se ejecuta primero." },
};

function fieldsForKind(kind: RuleKind): RuleFieldKey[] {
  const common: RuleFieldKey[] = [
    "protocol", "srcAddress", "dstAddress", "srcPort", "dstPort", "srcAddressList", "dstAddressList",
    "inInterface", "outInterface", "connectionState", "connectionNatState", "layer7Protocol",
    "tcpFlags", "srcMacAddress", "dstMacAddress", "connectionBytes", "connectionRate", "nth",
    "limit", "time", "hotspot", "fragment", "ttl", "placeBefore",
  ];
  if (kind === "nat") return [...common, "toAddresses", "toPorts"];
  if (kind === "mangle") {
    return [...common, "connectionMark", "packetMark", "routingMark", "newConnectionMark", "newPacketMark", "newRoutingMark", "jumpTarget", "log", "logPrefix", "passthrough"];
  }
  return [...common, "jumpTarget", "addressList", "addressListTimeout", "log", "logPrefix"];
}

function chainOptions(kind: RuleKind): string[] {
  if (kind === "nat") return ["srcnat", "dstnat"];
  if (kind === "mangle") return ["prerouting", "input", "forward", "output", "postrouting"];
  return ["input", "forward", "output"];
}

function chainLabel(chain: string): string {
  return {
    input: "Entrada al router", forward: "Tránsito entre redes", output: "Salida del router",
    prerouting: "Antes de decidir la ruta", postrouting: "Después de decidir la ruta",
    srcnat: "NAT de origen / salida", dstnat: "NAT de destino / publicación",
  }[chain] ?? chain;
}

function actionHelp(kind: RuleKind, action: string): string {
  const text: Record<string, string> = {
    accept: "Deja pasar el tráfico que coincida con las condiciones.",
    drop: "Descarta el tráfico sin enviar una respuesta al origen.",
    reject: "Descarta el tráfico y responde indicando que fue rechazado.",
    masquerade: "Cambia la IP de origen por la IP de la interfaz de salida, ideal para WAN dinámica.",
    "src-nat": "Cambia la IP de origen por la dirección que indiques.",
    "dst-nat": "Cambia el destino y puede publicar un servicio interno hacia Internet.",
    redirect: "Envía el tráfico al propio router, normalmente hacia un proxy o servicio local.",
    netmap: "Realiza una traducción 1:1 conservando la relación de direcciones.",
    jump: "Envía el tráfico a otra cadena para organizar reglas reutilizables.",
    return: "Regresa a la cadena que llamó a esta cadena personalizada.",
    log: "Registra las coincidencias y continúa según la familia de reglas.",
    passthrough: "Cuenta o marca la coincidencia y continúa evaluando reglas posteriores.",
    notrack: "Evita el seguimiento de conexión para reducir trabajo del router.",
    "mark-connection": "Guarda una marca en la conexión para reutilizarla en reglas posteriores.",
    "mark-packet": "Marca paquetes individuales para QoS, colas o políticas posteriores.",
    "mark-routing": "Marca el tráfico para elegir una tabla de rutas específica.",
    "change-mss": "Ajusta el tamaño máximo TCP, útil en enlaces con MTU reducida.",
    "add-src-to-address-list": "Agrega la IP de origen a una lista para que otras reglas puedan reutilizarla.",
    "add-dst-to-address-list": "Agrega la IP de destino a una lista para que otras reglas puedan reutilizarla.",
  };
  return text[action] ?? `Aplica la acción ${action || "seleccionada"} sobre el tráfico que coincida.`;
}

function rulePreview(kind: RuleKind, form: RuleForm): string {
  const scope = [
    form.protocol ? form.protocol.toUpperCase() : "cualquier protocolo",
    form.srcAddress || form.srcAddressList ? `desde ${form.srcAddress || `la lista ${form.srcAddressList}`}` : "desde cualquier origen",
    form.dstAddress || form.dstAddressList ? `hacia ${form.dstAddress || `la lista ${form.dstAddressList}`}` : "hacia cualquier destino",
    form.dstPort ? `puerto ${form.dstPort}` : "",
  ].filter(Boolean).join(" ");
  if (kind === "nat" && form.action === "masquerade") return `Cuando ${scope} salga por ${form.outInterface || "la interfaz indicada"}, el router reemplazará la IP privada por su IP pública para permitir navegación.`;
  if (kind === "nat" && ["dst-nat", "netmap"].includes(form.action)) return `Cuando llegue ${scope}, el router lo traducirá hacia ${form.toAddresses || "la IP interna que indiques"}${form.toPorts ? `:${form.toPorts}` : ""}.`;
  if (kind === "mangle" && form.action === "mark-connection") return `Cuando coincida ${scope}, RouterOS guardará la marca de conexión “${form.newConnectionMark || "sin definir"}” para que otras reglas puedan reconocerla.`;
  if (kind === "mangle" && form.action === "mark-packet") return `Cuando coincida ${scope}, cada paquete recibirá la marca “${form.newPacketMark || "sin definir"}”, que luego puede usar una cola o política QoS.`;
  if (kind === "mangle" && form.action === "mark-routing") return `Cuando coincida ${scope}, el tráfico usará la marca de ruta “${form.newRoutingMark || "sin definir"}”.`;
  const actionLabel = actionLabels[form.action] ?? (form.action || "la acción seleccionada");
  return `Cuando coincida ${scope} en ${chainLabel(form.chain)}, ${actionLabel}: ${actionHelp(kind, form.action).toLowerCase()}`;
}

export default function Security() {
  const { data: equipment, isLoading: equipmentLoading, isError: equipmentError } = useListEquipment({
    query: { queryKey: getListEquipmentQueryKey() },
  });
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<SecurityTab>("filter");
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleKind, setRuleKind] = useState<RuleKind>("filter");
  const [editingRule, setEditingRule] = useState<SecurityRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(blankRule);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressForm>(blankAddress);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const selectedEquipment = useMemo(() => {
    if (!equipment?.length) return undefined;
    return equipment.find(item => String(item.id) === selectedId)
      ?? equipment.find(item => item.equipmentRole === "core_router")
      ?? equipment[0];
  }, [equipment, selectedId]);
  const equipmentId = selectedEquipment?.id;
  const securityKey = ["equipment-security", equipmentId] as const;

  const securityQuery = useQuery<SecurityResponse>({
    queryKey: securityKey,
    enabled: Boolean(equipmentId),
    queryFn: async () => {
      const response = await apiFetch(`/api/equipment/${equipmentId}/security`, { credentials: "include" });
      const body = await response.json() as SecurityResponse & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message ?? body.error ?? "No se pudo leer la seguridad del equipo.");
      return body;
    },
  });

  const security = securityQuery.data;
  const filters = security?.filters ?? [];
  const natRules = security?.nat ?? [];
  const mangleRules = security?.mangle ?? [];
  const rawRules = security?.raw ?? [];
  const addressLists = security?.addressLists ?? [];
  const services = security?.services ?? [];
  const activeRules = activeTab === "nat"
    ? natRules
    : activeTab === "mangle"
      ? mangleRules
      : activeTab === "raw"
        ? rawRules
        : filters;

  const setRuleField = (field: keyof RuleForm, value: string) => {
    setRuleForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreateRule = (kind: RuleKind, defaults?: Partial<RuleForm>) => {
    setRuleKind(kind);
    setEditingRule(null);
    setRuleForm({
      ...blankRule,
      chain: kind === "nat" ? "srcnat" : kind === "mangle" ? "prerouting" : activeTab === "filter" ? "input" : "input",
      action: kind === "nat" ? "masquerade" : kind === "mangle" ? "mark-connection" : "accept",
      ...defaults,
    });
    setRuleDialogOpen(true);
  };

  const openEditRule = (kind: RuleKind, rule: SecurityRule) => {
    setRuleKind(kind);
    setEditingRule(rule);
    setRuleForm({
      ...blankRule,
      action: String(rule.action ?? "accept"),
      chain: String(rule.chain ?? (kind === "nat" ? "srcnat" : "input")),
      comment: String(rule.comment ?? ""),
      protocol: String(rule.protocol ?? ""),
      srcAddress: String(rule.srcAddress ?? ""),
      dstAddress: String(rule.dstAddress ?? ""),
      srcPort: String(rule.srcPort ?? ""),
      dstPort: String(rule.dstPort ?? ""),
      srcAddressList: String(rule.srcAddressList ?? ""),
      dstAddressList: String(rule.dstAddressList ?? ""),
      connectionState: String(rule.connectionState ?? ""),
      connectionNatState: String(rule.connectionNatState ?? ""),
      connectionMark: String(rule.connectionMark ?? ""),
      packetMark: String(rule.packetMark ?? ""),
      routingMark: String(rule.routingMark ?? ""),
      newConnectionMark: String(rule.newConnectionMark ?? ""),
      newPacketMark: String(rule.newPacketMark ?? ""),
      newRoutingMark: String(rule.newRoutingMark ?? ""),
      inInterface: String(rule.inInterface ?? ""),
      toAddresses: String(rule.toAddresses ?? ""),
      toPorts: String(rule.toPorts ?? ""),
      outInterface: String(rule.outInterface ?? ""),
      jumpTarget: String(rule.jumpTarget ?? ""),
      addressList: String(rule.addressList ?? ""),
      addressListTimeout: String(rule.addressListTimeout ?? ""),
      layer7Protocol: String(rule.layer7Protocol ?? ""),
      tcpFlags: String(rule.tcpFlags ?? ""),
      srcMacAddress: String(rule.srcMacAddress ?? ""),
      dstMacAddress: String(rule.dstMacAddress ?? ""),
      connectionBytes: String(rule.connectionBytes ?? ""),
      connectionRate: String(rule.connectionRate ?? ""),
      nth: String(rule.nth ?? ""),
      limit: String(rule.limit ?? ""),
      time: String(rule.time ?? ""),
      hotspot: String(rule.hotspot ?? ""),
      fragment: String(rule.fragment ?? ""),
      ttl: String(rule.ttl ?? ""),
      log: String(rule.log ?? ""),
      logPrefix: String(rule.logPrefix ?? ""),
      passthrough: String(rule.passthrough ?? ""),
      placeBefore: String(rule.placeBefore ?? ""),
    });
    setRuleDialogOpen(true);
  };

  const ruleBody = () => {
    const common: Record<string, string> = {
      action: ruleForm.action,
      chain: ruleForm.chain,
      comment: ruleForm.comment,
    };
    for (const [field, value] of Object.entries(ruleForm)) {
      if (field === "action" || field === "chain" || field === "comment") continue;
      if (value.trim()) common[field] = value.trim();
    }
    return common;
  };

  const saveRule = async () => {
    if (!equipmentId || !ruleForm.comment.trim()) {
      toast({ title: "Falta una explicación", description: "Escribe un comentario para que el operador entienda esta regla.", variant: "destructive" });
      return;
    }
    try {
      const endpoint = `/api/equipment/${equipmentId}/security/${ruleKind}${editingRule ? `/${ruleId(editingRule)}` : ""}`;
      const response = await apiFetch(endpoint, {
        method: editingRule ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleBody()),
      });
      const body = await response.json() as MutationResponse;
      if (!response.ok || body.success === false) throw new Error(body.message ?? "No se pudo guardar la regla.");
      await queryClient.invalidateQueries({ queryKey: securityKey });
      toast({ title: editingRule ? "Regla actualizada" : "Regla creada", description: body.message ?? "La configuración fue sincronizada con el equipo." });
      setRuleDialogOpen(false);
    } catch (error) {
      toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Revisa la conexión con el router.", variant: "destructive" });
    }
  };

  const deleteRule = async (kind: RuleKind, rule: SecurityRule) => {
    if (!equipmentId || !ruleId(rule)) return;
    if (!confirm(`¿Eliminar la regla “${rule.comment ?? rule.action ?? "sin comentario"}”? Esta acción se aplicará al router.`)) return;
    try {
      const response = await apiFetch(`/api/equipment/${equipmentId}/security/${kind}/${ruleId(rule)}`, { method: "DELETE", credentials: "include" });
      const body = await response.json() as MutationResponse;
      if (!response.ok || body.success === false) throw new Error(body.message ?? "No se pudo eliminar la regla.");
      await queryClient.invalidateQueries({ queryKey: securityKey });
      toast({ title: "Regla eliminada", description: body.message ?? "El router ya no aplicará esta regla." });
    } catch (error) {
      toast({ title: "No se pudo eliminar", description: error instanceof Error ? error.message : "El router rechazó el cambio.", variant: "destructive" });
    }
  };

  const saveAddress = async () => {
    if (!equipmentId || !addressForm.list.trim() || !addressForm.address.trim()) return;
    try {
      const response = await apiFetch(`/api/equipment/${equipmentId}/security/address-list`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list: addressForm.list.trim(), address: addressForm.address.trim(), ...(addressForm.comment.trim() ? { comment: addressForm.comment.trim() } : {}) }),
      });
      const body = await response.json() as MutationResponse;
      if (!response.ok || body.success === false) throw new Error(body.message ?? "No se pudo agregar la dirección.");
      await queryClient.invalidateQueries({ queryKey: securityKey });
      toast({ title: "Dirección agregada", description: body.message ?? "La lista está lista para usarse en reglas." });
      setAddressDialogOpen(false);
      setAddressForm(blankAddress);
    } catch (error) {
      toast({ title: "No se pudo agregar", description: error instanceof Error ? error.message : "Revisa la dirección IP.", variant: "destructive" });
    }
  };

  const deleteAddress = async (entry: AddressEntry) => {
    const id = String(entry.id ?? entry.entryId ?? "");
    if (!equipmentId || !id) return;
    if (!confirm(`¿Quitar ${entry.address ?? "esta dirección"} de la lista ${entry.list ?? ""}?`)) return;
    try {
      const response = await apiFetch(`/api/equipment/${equipmentId}/security/address-list/${id}`, { method: "DELETE", credentials: "include" });
      const body = await response.json() as MutationResponse;
      if (!response.ok || body.success === false) throw new Error(body.message ?? "No se pudo quitar la dirección.");
      await queryClient.invalidateQueries({ queryKey: securityKey });
      toast({ title: "Dirección eliminada", description: body.message ?? "La lista fue actualizada." });
    } catch (error) {
      toast({ title: "No se pudo quitar", description: error instanceof Error ? error.message : "El router rechazó el cambio.", variant: "destructive" });
    }
  };

  if (equipmentLoading) {
    return <div className="space-y-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-28 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (equipmentError) {
    return <div className="flex min-h-96 flex-col items-center justify-center gap-3 rounded-lg border border-red-500/20 bg-red-950/10 text-center"><AlertTriangle className="h-8 w-8 text-red-400" /><p className="text-sm text-red-200">No se pudo cargar el inventario de equipos.</p><Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() })}>Reintentar</Button></div>;
  }

  if (!equipment?.length) {
    return <div className="flex min-h-96 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center"><RouterIcon className="h-9 w-9 text-muted-foreground/50" /><p className="font-medium">Todavía no hay routers registrados</p><p className="max-w-md text-sm text-muted-foreground">Registra un MikroTik hEX en Equipos para comenzar a revisar sus reglas de seguridad.</p></div>;
  }

  return (
    <div className="space-y-6 pb-8" data-testid="page-security">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><ShieldCheck className="h-4 w-4" /> Seguridad operativa</div>
          <h1 className="text-3xl font-bold tracking-tight">Protección del router</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Administra Filter, NAT, Mangle y Raw de RouterOS con una guía que explica cada campo antes de aplicar una regla.</p>
        </div>
        <div className="w-full lg:w-80">
          <Label className="mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground">Router seleccionado</Label>
          <Select value={String(selectedEquipment?.id ?? "")} onValueChange={setSelectedId}>
            <SelectTrigger data-testid="select-security-equipment" className="h-11 bg-card"><SelectValue placeholder="Selecciona un router" /></SelectTrigger>
            <SelectContent>
              {equipment.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.model} · {item.ip}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card/80 to-card">
        <CardContent className="p-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-primary"><RouterIcon className="h-6 w-6" /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{selectedEquipment?.model}</h2><Badge variant="outline" className={statusClass(selectedEquipment?.lastSeenStatus)}>{selectedEquipment?.lastSeenStatus === "ONLINE" ? "En línea" : selectedEquipment?.lastSeenStatus === "OFFLINE" ? "Sin conexión" : "Estado desconocido"}</Badge></div>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{selectedEquipment?.ip} <span className="font-sans">·</span> {roleLabel(selectedEquipment?.equipmentRole)} <span className="font-sans">·</span> {selectedEquipment?.connectionType === "mikrotik_routeros" ? "MikroTik RouterOS" : selectedEquipment?.connectionType}</p>
                <p className="mt-3 max-w-2xl text-sm text-foreground/80">La protección actual está organizada para leerla como una historia: qué entra al router, qué cruza tu red y cómo salen los clientes a Internet.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <SummaryMetric label="Filter" value={filters.length} tone="sky" />
              <SummaryMetric label="NAT" value={natRules.length} tone="amber" />
              <SummaryMetric label="Mangle" value={mangleRules.length} tone="violet" />
              <SummaryMetric label="Raw" value={rawRules.length} tone="slate" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <GuidedAction icon={LockKeyhole} title="Cerrar acceso administrativo" description="Bloquea servicios del router desde Internet, excepto tu red de administración." onClick={() => openCreateRule("filter", { chain: "input", action: "drop", srcAddressList: "wan", comment: "Bloquear administración desde Internet" })} />
        <GuidedAction icon={Globe2} title="Activar NAT de salida" description="Permite que los clientes naveguen usando la conexión WAN." onClick={() => openCreateRule("nat", { action: "masquerade", chain: "srcnat", outInterface: "ether1", comment: "NAT de salida para clientes ISP" })} />
        <GuidedAction icon={Wifi} title="Permitir conexiones establecidas" description="Mantiene vivas las respuestas de conexiones que ya fueron aprobadas." onClick={() => openCreateRule("filter", { chain: "forward", action: "accept", connectionState: "established,related", comment: "Permitir conexiones establecidas y relacionadas" })} />
        <GuidedAction icon={SlidersHorizontal} title="Marcar una política" description="Prepara Mangle para identificar conexiones y usarlas en una ruta o cola." onClick={() => openCreateRule("mangle", { chain: "prerouting", action: "mark-connection", newConnectionMark: "politica_cliente", comment: "Marcar conexiones de clientes" })} />
      </div>

      {securityQuery.isLoading ? (
        <Card><CardContent className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-52 w-full" /></CardContent></Card>
      ) : securityQuery.isError ? (
        <Card className="border-red-500/20 bg-red-950/10"><CardContent className="flex min-h-60 flex-col items-center justify-center gap-3 text-center"><AlertTriangle className="h-8 w-8 text-red-400" /><p className="text-sm text-red-200">No se pudo leer la configuración de seguridad de este equipo.</p><Button variant="outline" onClick={() => securityQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Reintentar lectura</Button></CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SecurityTab)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-card/70 p-1 md:grid-cols-6">
            {(Object.keys(tabMeta) as SecurityTab[]).map(tab => { const meta = tabMeta[tab]; const Icon = meta.icon; return <TabsTrigger key={tab} value={tab} data-testid={`tab-security-${tab}`} className="justify-start gap-2 py-2.5 text-xs sm:text-sm"><Icon className="h-4 w-4" /><span className="hidden sm:inline">{meta.label}</span><span className="sm:hidden">{meta.short}</span></TabsTrigger>; })}
          </TabsList>
          <TabsContent value="filter" className="mt-0"><RulesCard kind="filter" rules={activeRules} title={tabMeta.filter.label} description={tabMeta.filter.description} emptyText="No hay reglas Filter. Puedes empezar protegiendo la entrada al router o el tránsito entre redes." onCreate={() => openCreateRule("filter", { chain: "input" })} onEdit={(rule) => openEditRule("filter", rule)} onDelete={(rule) => deleteRule("filter", rule)} /></TabsContent>
          <TabsContent value="nat" className="mt-0"><RulesCard kind="nat" rules={activeRules} title={tabMeta.nat.label} description={tabMeta.nat.description} emptyText="No hay reglas NAT. Sin una regla de salida, las IP privadas no podrán navegar por la WAN." onCreate={() => openCreateRule("nat")} onEdit={(rule) => openEditRule("nat", rule)} onDelete={(rule) => deleteRule("nat", rule)} /></TabsContent>
          <TabsContent value="mangle" className="mt-0"><RulesCard kind="mangle" rules={activeRules} title={tabMeta.mangle.label} description={tabMeta.mangle.description} emptyText="No hay reglas Mangle. Aquí puedes marcar conexiones, paquetes o rutas sin tocar todavía el filtrado." onCreate={() => openCreateRule("mangle")} onEdit={(rule) => openEditRule("mangle", rule)} onDelete={(rule) => deleteRule("mangle", rule)} /></TabsContent>
          <TabsContent value="raw" className="mt-0"><RulesCard kind="raw" rules={activeRules} title={tabMeta.raw.label} description={tabMeta.raw.description} emptyText="No hay reglas Raw. Estas reglas se ejecutan antes del seguimiento de conexiones y deben usarse con cuidado." onCreate={() => openCreateRule("raw")} onEdit={(rule) => openEditRule("raw", rule)} onDelete={(rule) => deleteRule("raw", rule)} /></TabsContent>
          <TabsContent value="lists" className="mt-0"><AddressListsCard entries={addressLists} onCreate={() => { setAddressForm(blankAddress); setAddressDialogOpen(true); }} onDelete={deleteAddress} /></TabsContent>
          <TabsContent value="services" className="mt-0"><ServicesCard services={services} onProtect={(service) => { setActiveTab("filter"); openCreateRule("filter", { chain: "input", action: "accept", protocol: "tcp", dstPort: String(service.port ?? ""), comment: `Permitir ${service.name ?? "servicio"} desde la red de administración` }); }} /></TabsContent>
        </Tabs>
      )}

      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><CircleHelp className="h-4 w-4 text-primary" /> Servicios visibles en el router <Badge variant="outline" className="ml-auto text-[10px]">{services.length} detectados</Badge></CardTitle></CardHeader>
        <CardContent className="pt-0"><p className="mb-3 text-xs text-muted-foreground">Los servicios se muestran como referencia. Para protegerlos, crea una regla de entrada con una explicación que el equipo pueda entender.</p><div className="flex flex-wrap gap-2">{services.length ? services.map((service, index) => <Badge key={`${displayValue(service.name)}-${index}`} variant="outline" data-testid={`badge-service-${index}`} className="font-mono text-[11px]">{displayValue(service.name ?? service.comment ?? service.protocol)}{service.port ? `:${String(service.port)}` : ""}</Badge>) : <span className="text-xs text-muted-foreground">El equipo no reportó servicios publicados.</span>}</div></CardContent>
      </Card>

      <RuleDialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen} kind={ruleKind} editing={Boolean(editingRule)} form={ruleForm} onFieldChange={setRuleField} onSave={saveRule} />
      <AddressDialog open={addressDialogOpen} onOpenChange={setAddressDialogOpen} form={addressForm} onChange={(field, value) => setAddressForm(prev => ({ ...prev, [field]: value }))} onSave={saveAddress} />
    </div>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: "sky" | "violet" | "amber" | "slate" }) {
  const styles = { sky: "text-sky-300 border-sky-400/20 bg-sky-400/10", violet: "text-violet-300 border-violet-400/20 bg-violet-400/10", amber: "text-amber-300 border-amber-400/20 bg-amber-400/10", slate: "text-slate-300 border-slate-400/20 bg-slate-400/10" };
  return <div className={`min-w-[72px] rounded-lg border px-3 py-2 text-center ${styles[tone]}`} data-testid={`metric-security-${label.toLowerCase()}`}><div className="text-xl font-semibold">{value}</div><div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div></div>;
}

function GuidedAction({ icon: Icon, title, description, onClick }: { icon: typeof ShieldCheck; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} data-testid={`button-guided-${title.toLowerCase().replaceAll(" ", "-")}`} className="group flex min-h-28 items-start gap-3 rounded-lg border border-border/70 bg-card/45 p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"><div className="rounded-md border border-primary/20 bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm font-semibold">{title}<ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div></button>;
}

function RulesCard({ kind, rules, title, description, emptyText, onCreate, onEdit, onDelete }: { kind: RuleKind; rules: SecurityRule[]; title: string; description: string; emptyText: string; onCreate: () => void; onEdit: (rule: SecurityRule) => void; onDelete: (rule: SecurityRule) => void }) {
  return <Card className="overflow-hidden border-border/70 bg-card/50"><CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/50 pb-4"><div><CardTitle className="text-base">{title}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Button size="sm" onClick={onCreate} data-testid={`button-create-${kind}`}><Plus className="mr-2 h-4 w-4" /> Nueva regla</Button></CardHeader><CardContent className="p-0">{rules.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center"><ListFilter className="h-8 w-8 text-muted-foreground/35" /><p className="max-w-md text-sm text-muted-foreground">{emptyText}</p><Button variant="outline" size="sm" onClick={onCreate}>Crear primera regla</Button></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-[28%]">Qué hace</TableHead><TableHead>Cadena</TableHead><TableHead>Condiciones</TableHead><TableHead className="w-[22%]">Comentario del operador</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{rules.map((rule, index) => <TableRow key={`${ruleId(rule)}-${index}`} data-testid={`row-security-rule-${ruleId(rule) || index}`}><TableCell><div className="flex items-start gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${String(rule.action).toLowerCase().includes("drop") || String(rule.action).toLowerCase().includes("reject") ? "bg-red-400" : kind === "nat" ? "bg-amber-400" : "bg-emerald-400"}`} /><div><div className="text-sm font-medium">{ruleExplanation(rule, kind)}</div><div className="mt-1 text-[11px] font-mono text-muted-foreground">{actionLabels[String(rule.action)] ?? displayValue(rule.action)}</div></div></div></TableCell><TableCell><Badge variant="outline" className="font-mono text-[10px]">{displayValue(rule.chain)}</Badge></TableCell><TableCell><div className="flex max-w-56 flex-wrap gap-1">{[rule.protocol, rule.dstPort ? `puerto ${rule.dstPort}` : null, rule.connectionState, rule.srcAddressList ? `origen: ${rule.srcAddressList}` : rule.srcAddress, rule.dstAddressList ? `destino: ${rule.dstAddressList}` : rule.dstAddress, rule.outInterface ? `salida: ${rule.outInterface}` : null, rule.toAddresses ? `hacia ${rule.toAddresses}` : null].filter(Boolean).map((value, conditionIndex) => <Badge key={`${String(value)}-${conditionIndex}`} variant="secondary" className="text-[10px]">{String(value)}</Badge>)}</div></TableCell><TableCell className="max-w-48 text-xs text-muted-foreground">{displayValue(rule.comment)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(rule)} data-testid={`button-edit-rule-${ruleId(rule) || index}`}><Pencil className="h-3.5 w-3.5" /><span className="sr-only">Editar regla</span></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => onDelete(rule)} data-testid={`button-delete-rule-${ruleId(rule) || index}`}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Eliminar regla</span></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>;
}

function AddressListsCard({ entries, onCreate, onDelete }: { entries: AddressEntry[]; onCreate: () => void; onDelete: (entry: AddressEntry) => void }) {
  const grouped = entries.reduce<Record<string, AddressEntry[]>>((result, entry) => { const key = entry.list ?? "sin_lista"; (result[key] ??= []).push(entry); return result; }, {});
  return <Card className="overflow-hidden border-border/70 bg-card/50"><CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/50 pb-4"><div><CardTitle className="text-base">Listas de direcciones</CardTitle><p className="mt-1 text-xs text-muted-foreground">Una lista es un grupo de IPs con nombre. Después puedes escribir “clientes_activos” en una regla, en lugar de repetir todas las direcciones.</p></div><Button size="sm" onClick={onCreate} data-testid="button-create-address-list"><Plus className="mr-2 h-4 w-4" /> Agregar IP</Button></CardHeader><CardContent className="p-5">{entries.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center"><ListFilter className="h-8 w-8 text-muted-foreground/35" /><p className="text-sm text-muted-foreground">No hay direcciones agrupadas todavía.</p><Button variant="outline" size="sm" onClick={onCreate}>Crear primera lista</Button></div> : <div className="grid gap-4 md:grid-cols-2">{Object.entries(grouped).map(([list, listEntries]) => <div key={list} className="rounded-lg border border-border/60 bg-background/20 p-4"><div className="mb-3 flex items-center gap-2"><ListFilter className="h-4 w-4 text-primary" /><span className="font-mono text-sm font-semibold">{list}</span><Badge variant="outline" className="ml-auto text-[10px]">{listEntries.length} IP{listEntries.length === 1 ? "" : "s"}</Badge></div><div className="space-y-2">{listEntries.map((entry, index) => <div key={`${String(entry.id ?? entry.entryId)}-${index}`} className="flex items-center gap-3 rounded-md border border-border/40 bg-card/50 px-3 py-2" data-testid={`row-address-${entry.id ?? index}`}><span className="flex-1 font-mono text-xs text-foreground">{displayValue(entry.address)}</span><span className="hidden flex-1 truncate text-xs text-muted-foreground sm:block">{displayValue(entry.comment)}</span><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => onDelete(entry)} data-testid={`button-delete-address-${entry.id ?? index}`}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Eliminar dirección</span></Button></div>)}</div></div>)}</div>}</CardContent></Card>;
}

function ServicesCard({ services, onProtect }: { services: SecurityRule[]; onProtect: (service: SecurityRule) => void }) {
  return <Card className="overflow-hidden border-border/70 bg-card/50">
    <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/50 pb-4">
      <div><CardTitle className="text-base">Service Ports</CardTitle><p className="mt-1 text-xs text-muted-foreground">Estos servicios están publicados por el router. Selecciona uno para preparar una regla Filter de entrada.</p></div>
      <Badge variant="outline" className="text-[10px]">{services.length} detectados</Badge>
    </CardHeader>
    <CardContent className="p-0">
      {services.length === 0 ? <div className="flex min-h-52 items-center justify-center px-6 text-sm text-muted-foreground">El router no reportó servicios publicados.</div> :
        <Table><TableHeader><TableRow><TableHead>Servicio</TableHead><TableHead>Puerto</TableHead><TableHead>Dirección permitida</TableHead><TableHead className="text-right">Acción guiada</TableHead></TableRow></TableHeader>
          <TableBody>{services.map((service, index) => <TableRow key={`${displayValue(service.name)}-${index}`}>
            <TableCell className="font-medium">{displayValue(service.name ?? service.comment)}</TableCell>
            <TableCell className="font-mono text-xs">{displayValue(service.port)}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{displayValue(service.srcAddress ?? service.dstAddress)}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => onProtect(service)}><ShieldCheck className="mr-2 h-3.5 w-3.5" />Preparar regla</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>}
    </CardContent>
  </Card>;
}

function RuleDialog({ open, onOpenChange, kind, editing, form, onFieldChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; kind: RuleKind; editing: boolean; form: RuleForm; onFieldChange: (field: keyof RuleForm, value: string) => void; onSave: () => void }) {
  const availableFields = fieldsForKind(kind);
  const [enabledFields, setEnabledFields] = useState<RuleFieldKey[]>([]);

  useEffect(() => {
    if (open) setEnabledFields(availableFields.filter(field => Boolean(form[field])));
  }, [open, kind, editing]);

  const toggleField = (field: RuleFieldKey) => {
    if (enabledFields.includes(field)) {
      setEnabledFields(fields => fields.filter(item => item !== field));
      onFieldChange(field, "");
    } else {
      setEnabledFields(fields => [...fields, field]);
    }
  };

  const grouped = availableFields.reduce<Record<string, RuleFieldKey[]>>((result, field) => {
    const group = fieldMeta[field].group;
    (result[group] ??= []).push(field);
    return result;
  }, {});
  const activeFields = availableFields.filter(field => enabledFields.includes(field));
  const inactiveFields = availableFields.filter(field => !enabledFields.includes(field));
  const kindLabel = kind === "filter" ? "Filter Rules" : kind === "nat" ? "NAT" : kind === "mangle" ? "Mangle" : "Raw";

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><WandSparkles className="h-5 w-5 text-primary" />{editing ? "Editar regla" : "Crear regla guiada"}<Badge variant="outline" className="ml-1 text-[10px]">{kindLabel}</Badge></DialogTitle>
        <DialogDescription>Activa solo las condiciones que necesitas. Cada campo explica qué significa vacío, muestra un ejemplo y anticipa el efecto antes de guardar.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-medium text-foreground"><Check className="h-3.5 w-3.5 text-primary" /> Vista previa de la regla</div>
          {rulePreview(kind, form)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Acción</Label><Select value={form.action} onValueChange={value => onFieldChange("action", value)}><SelectTrigger data-testid="select-rule-action"><SelectValue /></SelectTrigger><SelectContent>{actionOptions[kind].map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><p className="text-[11px] text-muted-foreground">{actionHelp(kind, form.action)}</p></div>
          <div className="space-y-1.5"><Label>Cadena</Label><Select value={form.chain} onValueChange={value => onFieldChange("chain", value)}><SelectTrigger data-testid="select-rule-chain"><SelectValue /></SelectTrigger><SelectContent>{chainOptions(kind).map(chain => <SelectItem key={chain} value={chain}>{chainLabel(chain)}</SelectItem>)}</SelectContent></Select><p className="text-[11px] text-muted-foreground">La cadena define en qué momento del recorrido se evaluará esta regla.</p></div>
        </div>
        <div className="space-y-1.5"><Label>Qué protege o permite <span className="text-destructive">*</span></Label><Input data-testid="input-rule-comment" value={form.comment} onChange={event => onFieldChange("comment", event.target.value)} placeholder="Ej. Marcar tráfico de clientes premium para usar WAN 2" /><p className="text-[11px] text-muted-foreground">Este comentario queda guardado junto a la regla para que otro operador entienda su intención.</p></div>

        {Object.entries(grouped).map(([group, fields]) => {
          const inactive = fields.filter(field => inactiveFields.includes(field));
          const active = fields.filter(field => activeFields.includes(field));
          if (!active.length && !inactive.length) return null;
          return <div key={group} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">{group}</h3><p className="text-[11px] text-muted-foreground">Los campos no activados no se envían al router.</p></div><ChevronDown className="h-4 w-4 text-muted-foreground" /></div>
            {active.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{active.map(field => {
              const meta = fieldMeta[field];
              return <div key={field} className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2"><Label htmlFor={`input-rule-${field}`}>{meta.label}</Label><button type="button" className="text-[10px] text-muted-foreground hover:text-destructive" onClick={() => toggleField(field)}>Quitar</button></div>
                <Input id={`input-rule-${field}`} data-testid={`input-rule-${field}`} value={form[field]} onChange={event => onFieldChange(field, event.target.value)} placeholder={meta.placeholder} />
                <div className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" /><span>{meta.help}<br /><span className="text-foreground/70">Ejemplo: {meta.placeholder}</span></span></div>
              </div>;
            })}</div>}
            {inactive.length > 0 && <div className="flex flex-wrap gap-2">{inactive.map(field => <button key={field} type="button" onClick={() => toggleField(field)} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"><Plus className="h-3 w-3 text-primary" />{fieldMeta[field].label}</button>)}</div>}
          </div>;
        })}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} data-testid="button-save-rule">{editing ? "Guardar cambios" : "Crear regla"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AddressDialog({ open, onOpenChange, form, onChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; form: AddressForm; onChange: (field: keyof AddressForm, value: string) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><ListFilter className="h-5 w-5 text-primary" /> Agregar dirección a una lista</DialogTitle><DialogDescription>Las listas ayudan a aplicar la misma regla a varios clientes o redes.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Nombre de la lista</Label><Input data-testid="input-address-list" value={form.list} onChange={event => onChange("list", event.target.value)} placeholder="clientes_activos" /></div><div className="space-y-1.5"><Label>IP o red</Label><Input data-testid="input-address" value={form.address} onChange={event => onChange("address", event.target.value)} placeholder="10.0.1.42 o 10.0.1.0/24" /></div><div className="space-y-1.5"><Label>Comentario <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input data-testid="input-address-comment" value={form.comment} onChange={event => onChange("comment", event.target.value)} placeholder="Clientes del nodo norte" /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} disabled={!form.list.trim() || !form.address.trim()} data-testid="button-save-address">Agregar dirección</Button></DialogFooter></DialogContent></Dialog>;
}