import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListEquipment, getListEquipmentQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, ArrowRightLeft, Check, ChevronRight, CircleHelp, Globe2, ListFilter, LockKeyhole, Pencil, Plus, RefreshCw, Router as RouterIcon, ShieldCheck, Trash2, WandSparkles, Wifi } from "lucide-react";
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

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RuleKind = "filter" | "nat";
type SecurityTab = "input" | "forward" | "nat" | "lists";

type SecurityRule = {
  id?: string | number;
  ruleId?: string | number;
  action?: string | null;
  chain?: string | null;
  comment?: string | null;
  protocol?: string | null;
  srcAddress?: string | null;
  dstAddress?: string | null;
  dstPort?: string | number | null;
  srcAddressList?: string | null;
  dstAddressList?: string | null;
  connectionState?: string | null;
  toAddresses?: string | null;
  toPorts?: string | number | null;
  outInterface?: string | null;
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
  dstPort: string;
  srcAddressList: string;
  dstAddressList: string;
  connectionState: string;
  toAddresses: string;
  toPorts: string;
  outInterface: string;
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
  dstPort: "",
  srcAddressList: "",
  dstAddressList: "",
  connectionState: "",
  toAddresses: "",
  toPorts: "",
  outInterface: "",
  placeBefore: "",
};

const blankAddress: AddressForm = { list: "clientes_activos", address: "", comment: "" };

const actionLabels: Record<string, string> = {
  accept: "Permitir",
  drop: "Bloquear",
  reject: "Rechazar",
  masquerade: "Masquerade",
  "src-nat": "NAT de origen",
  "dst-nat": "NAT de destino",
  redirect: "Redirigir",
  jump: "Saltar a otra cadena",
  passthrough: "Continuar",
};

const actionOptions: Array<{ value: string; label: string }> = [
  { value: "accept", label: "Permitir" },
  { value: "drop", label: "Bloquear silenciosamente" },
  { value: "reject", label: "Rechazar y avisar" },
  { value: "masquerade", label: "Masquerade" },
  { value: "src-nat", label: "NAT de origen" },
  { value: "dst-nat", label: "NAT de destino" },
  { value: "redirect", label: "Redirigir" },
];

const tabMeta: Record<SecurityTab, { label: string; short: string; icon: typeof ShieldCheck; description: string }> = {
  input: { label: "Firewall de entrada", short: "Entrada", icon: LockKeyhole, description: "Controla quién puede hablar directamente con el router." },
  forward: { label: "Firewall de tránsito", short: "Tránsito", icon: ArrowRightLeft, description: "Controla el tráfico entre clientes, antenas y la salida a Internet." },
  nat: { label: "NAT / Masquerade", short: "NAT", icon: Globe2, description: "Traduce las IP privadas para que los clientes naveguen por la WAN." },
  lists: { label: "Listas de direcciones", short: "Listas", icon: ListFilter, description: "Agrupa IPs para reutilizarlas en reglas sin editar una por una." },
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

export default function Security() {
  const { data: equipment, isLoading: equipmentLoading, isError: equipmentError } = useListEquipment({
    query: { queryKey: getListEquipmentQueryKey() },
  });
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<SecurityTab>("input");
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
      const response = await fetch(`${BASE}/api/equipment/${equipmentId}/security`, { credentials: "include" });
      const body = await response.json() as SecurityResponse & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message ?? body.error ?? "No se pudo leer la seguridad del equipo.");
      return body;
    },
  });

  const security = securityQuery.data;
  const filters = security?.filters ?? [];
  const natRules = security?.nat ?? [];
  const addressLists = security?.addressLists ?? [];
  const services = security?.services ?? [];
  const activeRules = activeTab === "nat" ? natRules : activeTab === "input" ? filters.filter(rule => rule.chain === "input") : filters.filter(rule => rule.chain === "forward");

  const setRuleField = (field: keyof RuleForm, value: string) => {
    setRuleForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreateRule = (kind: RuleKind, defaults?: Partial<RuleForm>) => {
    setRuleKind(kind);
    setEditingRule(null);
    setRuleForm({
      ...blankRule,
      chain: kind === "nat" ? "srcnat" : activeTab === "forward" ? "forward" : "input",
      action: kind === "nat" ? "masquerade" : "accept",
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
      dstPort: String(rule.dstPort ?? ""),
      srcAddressList: String(rule.srcAddressList ?? ""),
      dstAddressList: String(rule.dstAddressList ?? ""),
      connectionState: String(rule.connectionState ?? ""),
      toAddresses: String(rule.toAddresses ?? ""),
      toPorts: String(rule.toPorts ?? ""),
      outInterface: String(rule.outInterface ?? ""),
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
    const fields = ruleKind === "nat"
      ? ["protocol", "srcAddress", "dstAddress", "dstPort", "toAddresses", "toPorts", "outInterface", "srcAddressList", "placeBefore"]
      : ["protocol", "srcAddress", "dstAddress", "dstPort", "srcAddressList", "dstAddressList", "connectionState", "placeBefore"];
    for (const field of fields) {
      const value = ruleForm[field as keyof RuleForm];
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
      const endpoint = `${BASE}/api/equipment/${equipmentId}/security/${ruleKind}${editingRule ? `/${ruleId(editingRule)}` : ""}`;
      const response = await fetch(endpoint, {
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
      const response = await fetch(`${BASE}/api/equipment/${equipmentId}/security/${kind}/${ruleId(rule)}`, { method: "DELETE", credentials: "include" });
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
      const response = await fetch(`${BASE}/api/equipment/${equipmentId}/security/address-list`, {
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
      const response = await fetch(`${BASE}/api/equipment/${equipmentId}/security/address-list/${id}`, { method: "DELETE", credentials: "include" });
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
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Administra Firewall y NAT de RouterOS con explicaciones claras. Los comentarios se guardan junto a cada regla para que el próximo operador sepa por qué existe.</p>
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
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <SummaryMetric label="Entrada" value={filters.filter(rule => rule.chain === "input").length} tone="sky" />
              <SummaryMetric label="Tránsito" value={filters.filter(rule => rule.chain === "forward").length} tone="violet" />
              <SummaryMetric label="NAT" value={natRules.length} tone="amber" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <GuidedAction icon={LockKeyhole} title="Cerrar acceso administrativo" description="Bloquea servicios del router desde Internet, excepto tu red de administración." onClick={() => openCreateRule("filter", { chain: "input", action: "drop", srcAddressList: "wan", comment: "Bloquear administración desde Internet" })} />
        <GuidedAction icon={Globe2} title="Activar NAT de salida" description="Permite que los clientes naveguen usando la conexión WAN." onClick={() => openCreateRule("nat", { action: "masquerade", chain: "srcnat", outInterface: "ether1", comment: "NAT de salida para clientes ISP" })} />
        <GuidedAction icon={Wifi} title="Permitir conexiones establecidas" description="Mantiene vivas las respuestas de conexiones que ya fueron aprobadas." onClick={() => openCreateRule("filter", { chain: "forward", action: "accept", connectionState: "established,related", comment: "Permitir conexiones establecidas y relacionadas" })} />
      </div>

      {securityQuery.isLoading ? (
        <Card><CardContent className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-52 w-full" /></CardContent></Card>
      ) : securityQuery.isError ? (
        <Card className="border-red-500/20 bg-red-950/10"><CardContent className="flex min-h-60 flex-col items-center justify-center gap-3 text-center"><AlertTriangle className="h-8 w-8 text-red-400" /><p className="text-sm text-red-200">No se pudo leer la configuración de seguridad de este equipo.</p><Button variant="outline" onClick={() => securityQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Reintentar lectura</Button></CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SecurityTab)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-card/70 p-1 md:grid-cols-4">
            {(Object.keys(tabMeta) as SecurityTab[]).map(tab => { const meta = tabMeta[tab]; const Icon = meta.icon; return <TabsTrigger key={tab} value={tab} data-testid={`tab-security-${tab}`} className="justify-start gap-2 py-2.5 text-xs sm:text-sm"><Icon className="h-4 w-4" /><span className="hidden sm:inline">{meta.label}</span><span className="sm:hidden">{meta.short}</span></TabsTrigger>; })}
          </TabsList>
          <TabsContent value="input" className="mt-0"><RulesCard kind="filter" rules={activeRules} title={tabMeta.input.label} description={tabMeta.input.description} emptyText="No hay reglas de entrada. El router aún no tiene una historia clara de quién puede hablar con él." onCreate={() => openCreateRule("filter", { chain: "input" })} onEdit={(rule) => openEditRule("filter", rule)} onDelete={(rule) => deleteRule("filter", rule)} /></TabsContent>
          <TabsContent value="forward" className="mt-0"><RulesCard kind="filter" rules={activeRules} title={tabMeta.forward.label} description={tabMeta.forward.description} emptyText="No hay reglas de tránsito. Revisa este espacio antes de permitir tráfico entre clientes y la WAN." onCreate={() => openCreateRule("filter", { chain: "forward" })} onEdit={(rule) => openEditRule("filter", rule)} onDelete={(rule) => deleteRule("filter", rule)} /></TabsContent>
          <TabsContent value="nat" className="mt-0"><RulesCard kind="nat" rules={activeRules} title={tabMeta.nat.label} description={tabMeta.nat.description} emptyText="No hay reglas NAT. Sin una regla de salida, las IP privadas no podrán navegar por la WAN." onCreate={() => openCreateRule("nat")} onEdit={(rule) => openEditRule("nat", rule)} onDelete={(rule) => deleteRule("nat", rule)} /></TabsContent>
          <TabsContent value="lists" className="mt-0"><AddressListsCard entries={addressLists} onCreate={() => { setAddressForm(blankAddress); setAddressDialogOpen(true); }} onDelete={deleteAddress} /></TabsContent>
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

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: "sky" | "violet" | "amber" }) {
  const styles = { sky: "text-sky-300 border-sky-400/20 bg-sky-400/10", violet: "text-violet-300 border-violet-400/20 bg-violet-400/10", amber: "text-amber-300 border-amber-400/20 bg-amber-400/10" };
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

function RuleDialog({ open, onOpenChange, kind, editing, form, onFieldChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; kind: RuleKind; editing: boolean; form: RuleForm; onFieldChange: (field: keyof RuleForm, value: string) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><WandSparkles className="h-5 w-5 text-primary" />{editing ? "Editar regla" : "Crear regla guiada"} <Badge variant="outline" className="ml-1 text-[10px]">{kind === "nat" ? "NAT" : "Firewall"}</Badge></DialogTitle><DialogDescription>Completa lo esencial y deja una explicación en lenguaje normal. El backend traducirá estos campos a RouterOS.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"><div className="mb-1 flex items-center gap-2 font-medium text-foreground"><Check className="h-3.5 w-3.5 text-primary" /> Regla legible y revisable</div>Los campos vacíos no se envían. No necesitas conocer la sintaxis de RouterOS.</div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Acción</Label><Select value={form.action} onValueChange={value => onFieldChange("action", value)}><SelectTrigger data-testid="select-rule-action"><SelectValue /></SelectTrigger><SelectContent>{actionOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Cadena</Label><Select value={form.chain} onValueChange={value => onFieldChange("chain", value)}><SelectTrigger data-testid="select-rule-chain"><SelectValue /></SelectTrigger><SelectContent>{(kind === "nat" ? ["srcnat", "dstnat"] : ["input", "forward", "output"]).map(chain => <SelectItem key={chain} value={chain}>{chain === "input" ? "Entrada al router" : chain === "forward" ? "Tránsito entre redes" : chain === "srcnat" ? "NAT de salida" : chain === "dstnat" ? "NAT de destino" : "Salida del router"}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-1.5"><Label>Qué protege o permite <span className="text-destructive">*</span></Label><Input data-testid="input-rule-comment" value={form.comment} onChange={event => onFieldChange("comment", event.target.value)} placeholder="Ej. NAT de salida para clientes ISP" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Protocolo <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input data-testid="input-rule-protocol" value={form.protocol} onChange={event => onFieldChange("protocol", event.target.value)} placeholder="tcp, udp, icmp" /></div><div className="space-y-1.5"><Label>Puerto destino <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input data-testid="input-rule-dst-port" value={form.dstPort} onChange={event => onFieldChange("dstPort", event.target.value)} placeholder="80 o 8291" /></div><div className="space-y-1.5"><Label>IP de origen</Label><Input data-testid="input-rule-src-address" value={form.srcAddress} onChange={event => onFieldChange("srcAddress", event.target.value)} placeholder="10.0.0.0/8" /></div><div className="space-y-1.5"><Label>IP de destino</Label><Input data-testid="input-rule-dst-address" value={form.dstAddress} onChange={event => onFieldChange("dstAddress", event.target.value)} placeholder="192.168.88.1" /></div><div className="space-y-1.5"><Label>Lista de origen</Label><Input data-testid="input-rule-src-list" value={form.srcAddressList} onChange={event => onFieldChange("srcAddressList", event.target.value)} placeholder="clientes_activos" /></div><div className="space-y-1.5"><Label>Lista de destino</Label><Input data-testid="input-rule-dst-list" value={form.dstAddressList} onChange={event => onFieldChange("dstAddressList", event.target.value)} placeholder="wan" /></div>{kind === "filter" ? <div className="space-y-1.5"><Label>Estado de conexión</Label><Input data-testid="input-rule-connection-state" value={form.connectionState} onChange={event => onFieldChange("connectionState", event.target.value)} placeholder="established,related" /></div> : <><div className="space-y-1.5"><Label>Interfaz de salida</Label><Input data-testid="input-rule-out-interface" value={form.outInterface} onChange={event => onFieldChange("outInterface", event.target.value)} placeholder="ether1-WAN" /></div><div className="space-y-1.5"><Label>Traducir hacia IP</Label><Input data-testid="input-rule-to-addresses" value={form.toAddresses} onChange={event => onFieldChange("toAddresses", event.target.value)} placeholder="10.0.0.20" /></div><div className="space-y-1.5"><Label>Traducir hacia puerto</Label><Input data-testid="input-rule-to-ports" value={form.toPorts} onChange={event => onFieldChange("toPorts", event.target.value)} placeholder="8080" /></div></>}<div className="space-y-1.5"><Label>Posición <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input data-testid="input-rule-place-before" value={form.placeBefore} onChange={event => onFieldChange("placeBefore", event.target.value)} placeholder="ID de regla existente" /></div></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} data-testid="button-save-rule">{editing ? "Guardar cambios" : "Crear regla"}</Button></DialogFooter></DialogContent></Dialog>;
}

function AddressDialog({ open, onOpenChange, form, onChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; form: AddressForm; onChange: (field: keyof AddressForm, value: string) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><ListFilter className="h-5 w-5 text-primary" /> Agregar dirección a una lista</DialogTitle><DialogDescription>Las listas ayudan a aplicar la misma regla a varios clientes o redes.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Nombre de la lista</Label><Input data-testid="input-address-list" value={form.list} onChange={event => onChange("list", event.target.value)} placeholder="clientes_activos" /></div><div className="space-y-1.5"><Label>IP o red</Label><Input data-testid="input-address" value={form.address} onChange={event => onChange("address", event.target.value)} placeholder="10.0.1.42 o 10.0.1.0/24" /></div><div className="space-y-1.5"><Label>Comentario <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input data-testid="input-address-comment" value={form.comment} onChange={event => onChange("comment", event.target.value)} placeholder="Clientes del nodo norte" /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} disabled={!form.list.trim() || !form.address.trim()} data-testid="button-save-address">Agregar dirección</Button></DialogFooter></DialogContent></Dialog>;
}