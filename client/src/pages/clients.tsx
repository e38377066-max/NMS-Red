import { useEffect, useState } from "react";
import {
  useListClients, getListClientsQueryKey, useDeleteClient, useRegisterClientPayment,
  useListEquipment, useProvisionClient, useListClientDhcpLeases,
  useImportClientsFromDhcpLeases, type Client,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, Trash2, Eye, DollarSign, AlertCircle, CheckCircle2, XCircle, Router, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { SignalStrength } from "@/components/signal-strength";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { apiFetch } from "@/lib/api-fetch";

function PaymentBadge({ status }: { status: string }) {
  if (status === "PAID") return (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 gap-1">
      <CheckCircle2 className="w-3 h-3" /> Al día
    </Badge>
  );
  if (status === "PENDING") return (
    <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 gap-1">
      <AlertCircle className="w-3 h-3" /> Pendiente
    </Badge>
  );
  return (
    <Badge variant="outline" className="border-red-500/30 text-red-400 gap-1">
      <XCircle className="w-3 h-3" /> Suspendido
    </Badge>
  );
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Clients() {
  const { data: clients, isLoading } = useListClients({ query: { queryKey: getListClientsQueryKey() } });
  const deleteClient = useDeleteClient();
  const registerPayment = useRegisterClientPayment();
  const { data: equipment } = useListEquipment();
  const { data: users } = useQuery<Array<{ id: number; username: string; role: string }>>({
    queryKey: ["users-for-client-assignment"],
    queryFn: async () => {
      const response = await apiFetch("/api/users");
      if (!response.ok) throw new Error("No se pudieron cargar los técnicos");
      return response.json();
    },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const provisionClient = useProvisionClient();
  const importDhcpLeases = useImportClientsFromDhcpLeases();

  const [paymentModal, setPaymentModal] = useState<Client | null>(null);
  const [fee, setFee] = useState("");
  const [days, setDays] = useState("30");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importEquipmentId, setImportEquipmentId] = useState("");
  const [selectedMacs, setSelectedMacs] = useState<string[]>([]);
  const [initializedImportEquipmentId, setInitializedImportEquipmentId] = useState("");
  const {
    data: dhcpLeases,
    isLoading: dhcpLeasesLoading,
    error: dhcpLeasesError,
    refetch: refreshDhcpLeases,
  } = useListClientDhcpLeases(
    { equipmentId: Number(importEquipmentId) || 0 },
    { query: { enabled: importOpen && Boolean(importEquipmentId) } },
  );
  const [newClient, setNewClient] = useState({
    equipmentId: "",
    name: "",
    mac: "",
    ip: "",
    planLimit: "10M/10M",
    monthlyFee: "",
    contractReference: "",
    contractNotes: "",
    installationDate: "",
    installationAddress: "",
    assignedTechnicianId: "",
    accessPointEquipmentId: "",
    dhcpServer: "",
    dhcpPool: "",
  });

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`¿Eliminar cliente "${name}"?`)) return;
    deleteClient.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Cliente eliminado" });
      }
    });
  };

  const openPayment = (client: Client) => {
    setFee(client.monthlyFee ?? "");
    setDays("30");
    setPaymentModal(client);
  };

  const submitPayment = () => {
    if (!paymentModal) return;
    registerPayment.mutate(
      { id: paymentModal.id, data: { monthlyFee: parseFloat(fee), daysUntilNextDue: parseInt(days, 10) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: "Pago registrado", description: `${paymentModal.name} marcado como pagado.` });
          setPaymentModal(null);
        },
        onError: () => toast({ title: "Error", description: "No se pudo registrar el pago.", variant: "destructive" }),
      }
    );
  };

  const centralRouters = (equipment ?? []).filter((item) =>
    item.connectionType === "mikrotik_routeros" &&
    item.equipmentRole === "core_router"
  );
  const availableLeases = (dhcpLeases ?? []).filter((lease) => !lease.alreadyImported);
  const allAvailableSelected = availableLeases.length > 0 &&
    availableLeases.every((lease) => selectedMacs.includes(lease.macAddress));

  useEffect(() => {
    if (!importOpen || !importEquipmentId || !dhcpLeases || initializedImportEquipmentId === importEquipmentId) return;
    setSelectedMacs(dhcpLeases.filter((lease) => !lease.alreadyImported).map((lease) => lease.macAddress));
    setInitializedImportEquipmentId(importEquipmentId);
  }, [importOpen, importEquipmentId, dhcpLeases, initializedImportEquipmentId]);

  const openDhcpImport = () => {
    setImportEquipmentId(centralRouters[0] ? String(centralRouters[0].id) : "");
    setSelectedMacs([]);
    setInitializedImportEquipmentId("");
    setImportOpen(true);
  };

  const closeDhcpImport = (open: boolean) => {
    setImportOpen(open);
    if (!open) {
      setSelectedMacs([]);
      setInitializedImportEquipmentId("");
    }
  };

  const toggleLeaseSelection = (macAddress: string, checked: boolean) => {
    setSelectedMacs((current) => checked
      ? current.includes(macAddress) ? current : [...current, macAddress]
      : current.filter((mac) => mac !== macAddress));
  };

  const toggleAllAvailableLeases = (checked: boolean) => {
    setSelectedMacs(checked ? availableLeases.map((lease) => lease.macAddress) : []);
  };

  const submitDhcpImport = () => {
    if (!importEquipmentId || selectedMacs.length === 0) return;
    importDhcpLeases.mutate({
      data: {
        equipmentId: Number(importEquipmentId),
        macAddresses: selectedMacs,
      },
    }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        const details = [
          `${result.importedCount} importados`,
          result.alreadyImportedCount ? `${result.alreadyImportedCount} ya existían o coincidían con datos locales` : "",
          result.missingLeaseCount ? `${result.missingLeaseCount} ya no estaban en el router` : "",
        ].filter(Boolean).join(" · ");
        toast({ title: "Importación local completada", description: details });
        closeDhcpImport(false);
      },
      onError: (error: Error) => toast({
        title: "No se pudieron importar los leases",
        description: error.message,
        variant: "destructive",
      }),
    });
  };

  const accessPoints = (equipment ?? []).filter((item) =>
    item.id !== Number(newClient.equipmentId) &&
    (item.equipmentRole === "ap_distributor" || item.connectionType === "ubiquiti_airos")
  );

  const submitClient = () => {
    if (!newClient.equipmentId || !newClient.name || !newClient.mac || !newClient.ip || !newClient.planLimit) {
      toast({ title: "Completa los campos requeridos", description: "Selecciona el router central y registra nombre, MAC, IP fija y plan.", variant: "destructive" });
      return;
    }
    provisionClient.mutate({
      data: {
        equipmentId: Number(newClient.equipmentId),
        name: newClient.name,
        mac: newClient.mac,
        fixedIp: newClient.ip,
        planLimit: newClient.planLimit,
        ...(newClient.monthlyFee ? { monthlyFee: newClient.monthlyFee } : {}),
        ...(newClient.contractReference ? { contractReference: newClient.contractReference } : {}),
        ...(newClient.contractNotes ? { contractNotes: newClient.contractNotes } : {}),
        ...(newClient.installationDate ? { installationDate: `${newClient.installationDate}T00:00:00.000Z` } : {}),
        ...(newClient.installationAddress ? { installationAddress: newClient.installationAddress } : {}),
        ...(newClient.assignedTechnicianId ? { assignedTechnicianId: Number(newClient.assignedTechnicianId) } : {}),
        ...(newClient.accessPointEquipmentId ? { accessPointEquipmentId: Number(newClient.accessPointEquipmentId) } : {}),
        ...(newClient.dhcpServer.trim() ? { dhcpServer: newClient.dhcpServer.trim() } : {}),
        ...(newClient.dhcpPool.trim() ? { dhcpPool: newClient.dhcpPool.trim() } : {}),
      },
    }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Cliente aprovisionado", description: result.router?.verified ? `${newClient.name} quedó verificado en DHCP, Simple Queue y address-list.` : `${newClient.name} quedó registrado.` });
        setCreateOpen(false);
         setNewClient({
           equipmentId: "", name: "", mac: "", ip: "", planLimit: "10M/10M", monthlyFee: "",
           contractReference: "", contractNotes: "", installationDate: "", installationAddress: "",
           assignedTechnicianId: "", accessPointEquipmentId: "",
           dhcpServer: "", dhcpPool: "",
         });
      },
      onError: (error: Error) => toast({ title: "No se pudo aprovisionar el cliente", description: `${error.message}. No se guardó un alta parcial.`, variant: "destructive" }),
    });
  };

  const updateNewClient = (key: keyof typeof newClient, value: string) =>
    setNewClient((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          Clientes
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openDhcpImport} disabled={centralRouters.length === 0}>
            <Router className="w-4 h-4 mr-2" /> Importar leases DHCP
          </Button>
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Agregar Cliente</Button>
        </div>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead>Cobro</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>MAC / IP</TableHead>
              <TableHead>Router controlador</TableHead>
              <TableHead>Equipo de acceso</TableHead>
              <TableHead>DHCP servidor / pool</TableHead>
              <TableHead>Señal</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={11}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : clients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-12">
                  <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  No hay clientes registrados.
                </TableCell>
              </TableRow>
            ) : (
              clients?.map(client => (
                <TableRow key={client.id} className={client.paymentStatus === "SUSPENDED" ? "bg-red-950/10" : ""}>
                  <TableCell>
                    <Badge variant="outline" className={
                      client.status === "ACTIVE" ? "border-emerald-500/30 text-emerald-500" :
                      client.status === "OFFLINE" ? "border-red-500/30 text-red-500" : "border-yellow-500/30 text-yellow-500"
                    }>{client.status === "ACTIVE" ? "Activo" : client.status === "OFFLINE" ? "Offline" : "Suspendido"}</Badge>
                  </TableCell>
                  <TableCell><PaymentBadge status={client.paymentStatus} /></TableCell>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{client.mac}</div>
                    <div className="font-mono text-xs text-muted-foreground">{client.ip ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{client.equipmentModel ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {(() => {
                      const accessPoint = equipment?.find((item) => item.id === client.accessPointEquipmentId);
                      return accessPoint
                        ? <><div>{accessPoint.model}</div><div className="text-xs text-muted-foreground font-mono">{accessPoint.ip}</div></>
                        : <span className="text-muted-foreground">Sin asociar</span>;
                    })()}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-mono">{client.dhcpServer ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{client.dhcpPool ? `Pool: ${client.dhcpPool}` : "Pool sin registrar"}</div>
                  </TableCell>
                  <TableCell><SignalStrength dbm={client.lastSeenDbm} /></TableCell>
                  <TableCell className="font-mono text-sm">{client.planLimit}</TableCell>
                  <TableCell className={`text-xs ${client.dueDate && new Date(client.dueDate) < new Date() ? "text-red-400 font-medium" : "text-muted-foreground"}`}>
                    {formatDate(client.dueDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="text-emerald-400 hover:bg-emerald-500/10" onClick={() => openPayment(client as Client)} title="Registrar pago">
                        <DollarSign className="w-4 h-4" />
                      </Button>
                      <Link href={`/clients/${client.id}`}>
                        <Button variant="ghost" size="icon"><Eye className="w-4 h-4" /></Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(client.id, client.name)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={importOpen} onOpenChange={closeDhcpImport}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Router className="w-5 h-5 text-primary" /> Importar clientes desde leases DHCP
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-hidden py-1">
            <div className="space-y-1.5">
              <Label>Router central</Label>
              <Select
                value={importEquipmentId}
                onValueChange={(value) => {
                  setImportEquipmentId(value);
                  setSelectedMacs([]);
                  setInitializedImportEquipmentId("");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecciona el MikroTik..." /></SelectTrigger>
                <SelectContent>
                  {centralRouters.map((router) => (
                    <SelectItem key={router.id} value={String(router.id)}>
                      {router.model} — {router.ip}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Elige las MAC que quieras registrar. Los clientes existentes aparecen deshabilitados.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshDhcpLeases()}
                disabled={!importEquipmentId || dhcpLeasesLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${dhcpLeasesLoading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </div>
            {dhcpLeasesError && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {dhcpLeasesError.message}
              </div>
            )}
            {!importEquipmentId ? (
              <p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
                Selecciona un Router central para consultar sus leases.
              </p>
            ) : dhcpLeasesLoading && !dhcpLeases ? (
              <Skeleton className="h-64 w-full" />
            ) : dhcpLeases?.length === 0 ? (
              <p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
                No hay leases DHCP importables en este MikroTik.
              </p>
            ) : (
              <div className="max-h-[46vh] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Seleccionar todos los leases nuevos"
                          checked={allAvailableSelected}
                          onCheckedChange={(checked) => toggleAllAvailableLeases(checked === true)}
                          disabled={availableLeases.length === 0}
                        />
                      </TableHead>
                      <TableHead>Nombre / comentario</TableHead>
                      <TableHead>MAC / IP</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Velocidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dhcpLeases ?? []).map((lease) => (
                      <TableRow key={lease.macAddress} className={lease.alreadyImported ? "opacity-55" : ""}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Seleccionar ${lease.displayName}`}
                            checked={selectedMacs.includes(lease.macAddress)}
                            onCheckedChange={(checked) => toggleLeaseSelection(lease.macAddress, checked === true)}
                            disabled={lease.alreadyImported}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{lease.displayName}</div>
                          {lease.alreadyImported && <span className="text-xs text-muted-foreground">Ya existe o coincide con un cliente local</span>}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs">{lease.macAddress}</div>
                          <div className="font-mono text-xs text-muted-foreground">{lease.address}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={lease.status.toLowerCase() === "bound" ? "border-emerald-500/30 text-emerald-500" : "text-muted-foreground"}>
                            {lease.blocked ? "Bloqueado" : lease.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {lease.dynamic ? "Dinámico" : "Estático"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{lease.rateLimit ?? "No informada"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Solo se guardan datos locales de red. No se escribe en el MikroTik ni se crean contratos o pagos;
              el cobro queda pendiente y la cuota mensual en 0 hasta que completes esos datos.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeDhcpImport(false)}>Cancelar</Button>
            <Button
              onClick={submitDhcpImport}
              disabled={!importEquipmentId || selectedMacs.length === 0 || importDhcpLeases.isPending}
            >
              {importDhcpLeases.isPending ? "Importando..." : `Importar ${selectedMacs.length} seleccionados`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentModal} onOpenChange={() => setPaymentModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Registrar Pago — {paymentModal?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Monto del pago (Q)</Label>
              <Input
                type="number"
                placeholder="150.00"
                value={fee}
                onChange={e => setFee(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Días hasta el próximo vencimiento</Label>
              <Input
                type="number"
                placeholder="30"
                value={days}
                onChange={e => setDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Próximo vencimiento: {(() => {
                  const d = new Date();
                  d.setDate(d.getDate() + parseInt(days || "30", 10));
                  return d.toLocaleDateString("es", { day: "2-digit", month: "long", year: "numeric" });
                })()}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentModal(null)}>Cancelar</Button>
            <Button onClick={submitPayment} disabled={!fee || registerPayment.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              {registerPayment.isPending ? "Guardando..." : "Confirmar Pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Registrar cliente en el MikroTik central
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Router central</Label>
              <Select value={newClient.equipmentId} onValueChange={(value) => updateNewClient("equipmentId", value)}>
                <SelectTrigger><SelectValue placeholder="Selecciona el MikroTik que administra las colas..." /></SelectTrigger>
                <SelectContent>
                  {centralRouters.map((router) => (
                    <SelectItem key={router.id} value={String(router.id)}>
                      {router.model} — {router.ip}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {centralRouters.length === 0 && (
                <p className="text-xs text-yellow-400">Registra primero el hEX con rol “Router central”.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nombre completo</Label>
                <Input value={newClient.name} onChange={(event) => updateNewClient("name", event.target.value)} placeholder="Cliente 001" />
              </div>
              <div className="space-y-1.5">
                <Label>MAC</Label>
                <Input value={newClient.mac} onChange={(event) => updateNewClient("mac", event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>IP fija requerida</Label>
                <Input value={newClient.ip} onChange={(event) => updateNewClient("ip", event.target.value)} placeholder="192.168.88.100" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Plan / velocidad</Label>
                <Input value={newClient.planLimit} onChange={(event) => updateNewClient("planLimit", event.target.value)} placeholder="10M/10M" className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Cuota mensual (opcional)</Label>
              <Input type="number" value={newClient.monthlyFee} onChange={(event) => updateNewClient("monthlyFee", event.target.value)} placeholder="150.00" />
            </div>
            <div className="border-t border-border/40 pt-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expediente administrativo</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Referencia de contrato</Label>
                  <Input value={newClient.contractReference} onChange={(event) => updateNewClient("contractReference", event.target.value)} placeholder="CTR-2026-001" />
                </div>
                <div className="space-y-1.5">
                  <Label>Fecha de instalación</Label>
                  <Input type="date" value={newClient.installationDate} onChange={(event) => updateNewClient("installationDate", event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Técnico responsable</Label>
                  <Select value={newClient.assignedTechnicianId} onValueChange={(value) => updateNewClient("assignedTechnicianId", value)}>
                    <SelectTrigger><SelectValue placeholder="Selecciona un técnico..." /></SelectTrigger>
                    <SelectContent>
                      {(users ?? []).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.username} · {user.role}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>AP / LiteAP / SXT / enlace</Label>
                  <Select value={newClient.accessPointEquipmentId} onValueChange={(value) => updateNewClient("accessPointEquipmentId", value)}>
                    <SelectTrigger><SelectValue placeholder="Selecciona el equipo de acceso..." /></SelectTrigger>
                    <SelectContent>
                      {accessPoints.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.model} · {item.ip}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Servidor DHCP <span className="text-xs text-muted-foreground">(nombre RouterOS)</span></Label>
                  <Input
                    data-testid="input-client-dhcp-server"
                    value={newClient.dhcpServer}
                    onChange={(event) => updateNewClient("dhcpServer", event.target.value)}
                    placeholder="dhcp1"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pool DHCP <span className="text-xs text-muted-foreground">(referencia)</span></Label>
                  <Input
                    data-testid="input-client-dhcp-pool"
                    value={newClient.dhcpPool}
                    onChange={(event) => updateNewClient("dhcpPool", event.target.value)}
                    placeholder="pool-clientes"
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Dirección de instalación</Label>
                <Input value={newClient.installationAddress} onChange={(event) => updateNewClient("installationAddress", event.target.value)} placeholder="Dirección o referencia del domicilio" />
              </div>
              <div className="space-y-1.5">
                <Label>Notas del contrato <span className="text-xs text-muted-foreground">(opcional)</span></Label>
                <Input value={newClient.contractNotes} onChange={(event) => updateNewClient("contractNotes", event.target.value)} placeholder="Condiciones o referencia del documento" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              El alta verifica MAC/IP, lease DHCP estático, Simple Queue y address-list en el MikroTik. Si falla una etapa, intenta revertir los cambios del router.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={submitClient} disabled={provisionClient.isPending || centralRouters.length === 0}>
              {provisionClient.isPending ? "Aprovisionando..." : "Aprovisionar Cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
