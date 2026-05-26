import { useState } from "react";
import { useListClients, getListClientsQueryKey, useDeleteClient, useRegisterClientPayment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, Trash2, Eye, DollarSign, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { SignalStrength } from "@/components/signal-strength";
import { useToast } from "@/hooks/use-toast";

type Client = {
  id: number;
  name: string;
  mac: string;
  ip: string | null;
  equipmentId: number;
  equipmentModel?: string | null;
  planLimit: string;
  status: string;
  paymentStatus: string;
  monthlyFee?: string | null;
  dueDate?: string | null;
  lastSeenDbm?: string | null;
};

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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [paymentModal, setPaymentModal] = useState<Client | null>(null);
  const [fee, setFee] = useState("");
  const [days, setDays] = useState("30");

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          Clientes
        </h1>
        <Button><Plus className="w-4 h-4 mr-2" /> Agregar Cliente</Button>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead>Cobro</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>MAC / IP</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead>Señal</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : clients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
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
    </div>
  );
}
