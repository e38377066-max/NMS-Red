import { useState } from "react";
import {
  useListEquipment, getListEquipmentQueryKey,
  useDeleteEquipment, useCreateEquipment,
  useListNodes,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Router as RouterIcon, Plus, Eye, Trash2, Globe, ArrowUpDown, Radio, Server as ServerIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  gateway: { label: "Gateway", icon: Globe, color: "text-cyan-400" },
  core_router: { label: "Router central", icon: ServerIcon, color: "text-violet-400" },
  ptp_link: { label: "Enlace PTP", icon: ArrowUpDown, color: "text-amber-400" },
  ap_distributor: { label: "AP / Repartidor", icon: Radio, color: "text-emerald-400" },
};

const BRAND_LABEL: Record<string, string> = {
  mikrotik_routeros: "MikroTik",
  ubiquiti_airos: "Ubiquiti",
};

function RoleIcon({ role }: { role: string }) {
  const meta = ROLE_META[role];
  if (!meta) return null;
  const Icon = meta.icon;
  return <Icon className={`w-4 h-4 ${meta.color}`} title={meta.label} />;
}

const INITIAL_FORM = {
  nodeId: "",
  ip: "",
  username: "",
  password: "",
  model: "",
  connectionType: "mikrotik_routeros",
  equipmentRole: "ap_distributor",
  snmpCommunity: "",
  apiPort: "",
};

export default function Equipment() {
  const { data: equipment, isLoading } = useListEquipment({ query: { queryKey: getListEquipmentQueryKey() } });
  const { data: nodes } = useListNodes();
  const queryClient = useQueryClient();
  const deleteEq = useDeleteEquipment();
  const createEq = useCreateEquipment();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);

  const handleDelete = (id: number) => {
    if (!confirm("¿Eliminar este equipo?")) return;
    deleteEq.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        toast({ title: "Eliminado", description: "Equipo eliminado correctamente." });
      },
    });
  };

  const handleCreate = () => {
    if (!form.nodeId || !form.ip || !form.username || !form.password || !form.model) return;
    createEq.mutate({
      data: {
        nodeId: Number(form.nodeId),
        ip: form.ip,
        username: form.username,
        password: form.password,
        model: form.model,
        connectionType: form.connectionType,
        equipmentRole: form.equipmentRole,
        ...(form.snmpCommunity ? { snmpCommunity: form.snmpCommunity } : {}),
        ...(form.apiPort ? { apiPort: Number(form.apiPort) } : {}),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        toast({ title: "Equipo registrado", description: `${form.model} (${form.ip}) agregado.` });
        setOpen(false);
        setForm(INITIAL_FORM);
      },
      onError: () => toast({ title: "Error", description: "No se pudo registrar el equipo.", variant: "destructive" }),
    });
  };

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <RouterIcon className="w-8 h-8 text-primary" />
          Equipos
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Registrar Equipo</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Registrar Equipo de Red</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>Nodo</Label>
                  <Select value={form.nodeId} onValueChange={(v) => set("nodeId", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecciona un nodo..." /></SelectTrigger>
                    <SelectContent>
                      {nodes?.map(n => <SelectItem key={n.id} value={String(n.id)}>{n.name} — {n.location}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>IP / Host</Label>
                  <Input value={form.ip} onChange={e => set("ip", e.target.value)} placeholder="192.168.1.100" />
                </div>
                <div className="space-y-2">
                  <Label>Modelo</Label>
                  <Input value={form.model} onChange={e => set("model", e.target.value)} placeholder="RB4011, NS-5AC, CHR..." />
                </div>
                <div className="space-y-2">
                  <Label>Usuario RouterOS / airOS</Label>
                  <Input value={form.username} onChange={e => set("username", e.target.value)} placeholder="admin" />
                </div>
                <div className="space-y-2">
                  <Label>Contraseña RouterOS / airOS</Label>
                  <Input type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label>Protocolo de conexión</Label>
                  <Select value={form.connectionType} onValueChange={(v) => set("connectionType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="mikrotik_routeros">MikroTik RouterOS (API / REST)</SelectItem>
                       <SelectItem value="ubiquiti_airos">Ubiquiti airOS (SSH / HTTP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rol funcional</Label>
                  <Select value={form.equipmentRole} onValueChange={(v) => set("equipmentRole", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gateway">🌐 Gateway (recibe internet)</SelectItem>
                       <SelectItem value="core_router">🖥 Router central (MikroTik hEX)</SelectItem>
                      <SelectItem value="ptp_link">↕ Enlace Troncal PTP</SelectItem>
                       <SelectItem value="ap_distributor">📡 LiteAP / SXT (repartidor)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.connectionType === "ubiquiti_airos" && (
                  <div className="space-y-2">
                    <Label>SNMP Community <span className="text-muted-foreground">(opcional)</span></Label>
                    <Input value={form.snmpCommunity} onChange={e => set("snmpCommunity", e.target.value)} placeholder="public" />
                  </div>
                )}
                {form.connectionType === "mikrotik_routeros" && (
                  <div className="space-y-2">
                   <Label>Puerto RouterOS REST / API-SSL <span className="text-muted-foreground">(opcional)</span></Label>
                   <Input type="number" value={form.apiPort} onChange={e => set("apiPort", e.target.value)} placeholder="80 o 443" />
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createEq.isPending}>
                {createEq.isPending ? "Registrando..." : "Registrar Equipo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Nodo</TableHead>
              <TableHead>Clientes</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : equipment?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No hay equipos registrados.
                </TableCell>
              </TableRow>
            ) : (
              equipment?.map(eq => (
                <TableRow key={eq.id} className="hover:bg-card/30">
                  <TableCell><StatusBadge status={eq.lastSeenStatus} /></TableCell>
                  <TableCell className="font-mono text-sm">{eq.ip}</TableCell>
                  <TableCell className="font-medium">{eq.model}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <RoleIcon role={eq.equipmentRole} />
                      <span className="text-xs text-muted-foreground">
                        {ROLE_META[eq.equipmentRole]?.label ?? eq.equipmentRole}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      eq.connectionType === "mikrotik_routeros"
                        ? "border-sky-500/30 text-sky-400 text-[10px]"
                        : "border-orange-500/30 text-orange-400 text-[10px]"
                    }>
                      {BRAND_LABEL[eq.connectionType] ?? eq.connectionType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{eq.nodeName}</TableCell>
                  <TableCell>
                    <span className="font-mono bg-muted px-2 py-1 rounded text-xs">{eq.clientCount ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Link href={`/equipment/${eq.id}`}>
                      <Button variant="ghost" size="icon"><Eye className="w-4 h-4" /></Button>
                    </Link>
                    <Button
                      variant="ghost" size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(eq.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
