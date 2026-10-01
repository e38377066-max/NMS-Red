import { useState } from "react";
import {
  useListProxmoxServers, useCreateProxmoxServer, useDeleteProxmoxServer,
  useGetProxmoxHealth, useListProxmoxVms,
  useStartProxmoxVm, useStopProxmoxVm, useSnapshotProxmoxVm, useUpdateProxmoxVmConfig,
  getListProxmoxServersQueryKey, getListProxmoxVmsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Server, Plus, Trash2, Play, Square, Camera, Settings2, Cpu, HardDrive, MemoryStick, Clock } from "lucide-react";

function VmStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    stopped: "border-red-500/40 text-red-400 bg-red-500/10",
    paused: "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
    unknown: "border-border text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={map[status] ?? map.unknown}>
      {status}
    </Badge>
  );
}

function formatUptime(secs: number | null | undefined) {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function ServerHealthCard({ serverId }: { serverId: number }) {
  const { data: health, isLoading } = useGetProxmoxHealth(serverId);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!health || health.status === "OFFLINE") return (
    <div className="p-3 rounded-md bg-red-950/20 border border-red-900/30 text-red-400 text-sm">
      Sin conexión con el servidor Proxmox
    </div>
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
      {[
        { icon: Cpu, label: "CPU", value: health.cpuUsagePercent != null ? `${health.cpuUsagePercent}%` : "—" },
        { icon: MemoryStick, label: "RAM", value: health.memUsedGb != null ? `${health.memUsedGb} / ${health.memTotalGb} GB` : "—" },
        { icon: HardDrive, label: "Disco", value: health.diskUsedGb != null ? `${health.diskUsedGb} / ${health.diskTotalGb} GB` : "—" },
        { icon: Clock, label: "Uptime", value: health.uptime ?? "—" },
      ].map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2">
          <Icon className="w-4 h-4 text-primary shrink-0" />
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
            <div className="text-sm font-mono font-medium">{value}</div>
          </div>
        </div>
      ))}
      {health.pveVersion && (
        <div className="col-span-full text-xs text-muted-foreground font-mono">
          Proxmox VE {health.pveVersion} — {health.kernelVersion}
        </div>
      )}
    </div>
  );
}

function VmTable({ serverId }: { serverId: number }) {
  const { data: vms, isLoading } = useListProxmoxVms(serverId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const startVm = useStartProxmoxVm();
  const stopVm = useStopProxmoxVm();
  const snapshotVm = useSnapshotProxmoxVm();
  const updateConfig = useUpdateProxmoxVmConfig();
  const [snapTarget, setSnapTarget] = useState<{ vmid: number; name: string } | null>(null);
  const [snapName, setSnapName] = useState("");
  const [configTarget, setConfigTarget] = useState<{ vmid: number; name: string; cores: number | null; memMb: number | null } | null>(null);
  const [newCores, setNewCores] = useState("");
  const [newMem, setNewMem] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListProxmoxVmsQueryKey(serverId) });
  };

  const handleStart = (vmid: number) => {
    startVm.mutate({ id: serverId, vmid }, {
      onSuccess: (r) => { toast({ title: r.success ? "VM iniciada" : "Error", description: r.message }); refresh(); },
    });
  };

  const handleStop = (vmid: number) => {
    if (!confirm("¿Detener la VM?")) return;
    stopVm.mutate({ id: serverId, vmid }, {
      onSuccess: (r) => { toast({ title: r.success ? "VM detenida" : "Error", description: r.message }); refresh(); },
    });
  };

  const handleSnapshot = () => {
    if (!snapTarget || !snapName.trim()) return;
    snapshotVm.mutate(
      { id: serverId, vmid: snapTarget.vmid, data: { snapname: snapName.replace(/\s+/g, "_") } },
      {
        onSuccess: (r) => {
          toast({ title: r.success ? "Snapshot creado" : "Error", description: r.message });
          setSnapTarget(null); setSnapName("");
        },
      }
    );
  };

  const handleUpdateConfig = () => {
    if (!configTarget) return;
    const body: Record<string, number> = {};
    if (newCores) body.cores = parseInt(newCores);
    if (newMem) body.memory = parseInt(newMem);
    updateConfig.mutate(
      { id: serverId, vmid: configTarget.vmid, data: body },
      {
        onSuccess: (r) => {
          toast({ title: r.success ? "Config actualizada" : "Error", description: r.message });
          setConfigTarget(null); setNewCores(""); setNewMem(""); refresh();
        },
      }
    );
  };

  if (isLoading) return <Skeleton className="h-32 w-full mt-3" />;
  if (!vms?.length) return <div className="text-sm text-muted-foreground mt-3">No hay VMs detectadas.</div>;

  return (
    <>
      <div className="border border-border/50 rounded-md bg-card/30 mt-3 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>VMID</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>RAM</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vms.map((vm) => (
              <TableRow key={vm.vmid} className="hover:bg-card/50">
                <TableCell className="font-mono text-xs text-muted-foreground">{vm.vmid}</TableCell>
                <TableCell className="font-medium">{vm.name}</TableCell>
                <TableCell><VmStatusBadge status={vm.status} /></TableCell>
                <TableCell className="font-mono text-sm">{vm.cpuUsage != null ? `${vm.cpuUsage}%` : "—"}</TableCell>
                <TableCell className="font-mono text-sm">
                  {vm.memUsedMb != null ? `${vm.memUsedMb} / ${vm.memTotalMb} MB` : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{formatUptime(vm.uptimeSeconds)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {vm.status !== "running" && (
                      <Button size="icon" variant="ghost" title="Iniciar" onClick={() => handleStart(vm.vmid)} className="text-emerald-400 hover:bg-emerald-500/10">
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {vm.status === "running" && (
                      <Button size="icon" variant="ghost" title="Detener" onClick={() => handleStop(vm.vmid)} className="text-red-400 hover:bg-red-500/10">
                        <Square className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" title="Snapshot" onClick={() => { setSnapTarget({ vmid: vm.vmid, name: vm.name }); setSnapName(`snap-${vm.name}-${Date.now()}`); }}>
                      <Camera className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="CPU/RAM" onClick={() => { setConfigTarget({ vmid: vm.vmid, name: vm.name, cores: vm.cores ?? null, memMb: vm.memTotalMb ?? null }); setNewCores(String(vm.cores ?? "")); setNewMem(String(vm.memTotalMb ?? "")); }}>
                      <Settings2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Snapshot dialog */}
      <Dialog open={!!snapTarget} onOpenChange={(o) => { if (!o) { setSnapTarget(null); setSnapName(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Crear Snapshot — {snapTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Nombre del snapshot</Label>
            <Input value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder="snap-chrvm-20260526" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnapTarget(null)}>Cancelar</Button>
            <Button onClick={handleSnapshot} disabled={snapshotVm.isPending}>
              {snapshotVm.isPending ? "Creando..." : "Crear Snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config dialog */}
      <Dialog open={!!configTarget} onOpenChange={(o) => { if (!o) { setConfigTarget(null); setNewCores(""); setNewMem(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar CPU/RAM — {configTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">Actual: {configTarget?.cores ?? "—"} cores / {configTarget?.memMb ?? "—"} MB RAM. Los cambios requieren reiniciar la VM para aplicarse completamente.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cores de CPU</Label>
                <Input type="number" min={1} value={newCores} onChange={(e) => setNewCores(e.target.value)} placeholder="4" />
              </div>
              <div className="space-y-2">
                <Label>RAM (MB)</Label>
                <Input type="number" min={512} step={512} value={newMem} onChange={(e) => setNewMem(e.target.value)} placeholder="2048" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigTarget(null)}>Cancelar</Button>
            <Button onClick={handleUpdateConfig} disabled={updateConfig.isPending}>
              {updateConfig.isPending ? "Aplicando..." : "Guardar Configuración"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Proxmox() {
  const { data: servers, isLoading } = useListProxmoxServers();
  const createServer = useCreateProxmoxServer();
  const deleteServer = useDeleteProxmoxServer();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", ip: "", port: "8006", username: "root@pam", password: "", nodeName: "pve" });

  const handleCreate = () => {
    if (!form.name || !form.ip || !form.username || !form.password) return;
    createServer.mutate(
      { data: { name: form.name, ip: form.ip, port: Number(form.port), username: form.username, password: form.password, nodeName: form.nodeName || "pve" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProxmoxServersQueryKey() });
          toast({ title: "Proxmox agregado", description: `${form.name} (${form.ip}) registrado correctamente.` });
          setOpen(false);
          setForm({ name: "", ip: "", port: "8006", username: "root@pam", password: "", nodeName: "pve" });
        },
        onError: () => toast({ title: "Error", description: "No se pudo agregar el servidor Proxmox.", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`¿Eliminar ${name} de la lista?`)) return;
    deleteServer.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProxmoxServersQueryKey() });
        toast({ title: "Eliminado", description: `${name} fue eliminado.` });
        if (expanded === id) setExpanded(null);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Server className="w-8 h-8 text-primary" />
          Proxmox VE — Hipervisor
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Agregar Servidor</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Registrar Servidor Proxmox</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              {[
                { label: "Nombre", key: "name", placeholder: "Proxmox-Principal" },
                { label: "IP / Host", key: "ip", placeholder: "192.168.1.10" },
                { label: "Puerto HTTPS", key: "port", placeholder: "8006" },
                { label: "Node Name", key: "nodeName", placeholder: "pve" },
                { label: "Usuario", key: "username", placeholder: "root@pam" },
                { label: "Contraseña", key: "password", placeholder: "••••••••", type: "password" },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key} className={key === "username" || key === "password" ? "col-span-2 space-y-2" : "space-y-2"}>
                  <Label>{label}</Label>
                  <Input
                    type={type ?? "text"}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createServer.isPending}>
                {createServer.isPending ? "Registrando..." : "Registrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : servers?.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="py-12 text-center space-y-2">
            <Server className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay servidores Proxmox registrados.</p>
            <p className="text-sm text-muted-foreground/70">Agrega tu hipervisor para gestionar VMs desde aquí.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {servers?.map((server) => (
            <Card key={server.id} className="bg-card/50 border-border/50 overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-primary" />
                    <div>
                      <CardTitle className="text-base">{server.name}</CardTitle>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {server.ip}:{server.port} — nodo: {server.nodeName}
                      </div>
                    </div>
                    <Badge variant="outline" className={
                      server.lastSeenStatus === "ONLINE"
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : server.lastSeenStatus === "OFFLINE"
                        ? "border-red-500/40 text-red-400 bg-red-500/10"
                        : "border-border text-muted-foreground"
                    }>
                      {server.lastSeenStatus}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setExpanded(expanded === server.id ? null : server.id)}
                    >
                      {expanded === server.id ? "Colapsar" : "Ver VMs"}
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(server.id, server.name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <ServerHealthCard serverId={server.id} />
              </CardHeader>
              {expanded === server.id && (
                <CardContent className="border-t border-border/50 pt-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Máquinas Virtuales
                  </h3>
                  <VmTable serverId={server.id} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
