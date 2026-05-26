import { useListClients, getListClientsQueryKey, useDeleteClient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Users, Plus, Trash2, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { SignalStrength } from "@/components/signal-strength";
import { Badge } from "@/components/ui/badge";

export default function Clients() {
  const { data: clients, isLoading } = useListClients({ query: { queryKey: getListClientsQueryKey() } });
  const deleteClient = useDeleteClient();
  const queryClient = useQueryClient();

  const handleDelete = (id: number) => {
    if(!confirm("Delete client?")) return;
    deleteClient.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() })
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          Clients
        </h1>
        <Button><Plus className="w-4 h-4 mr-2" /> Add Client</Button>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>MAC / IP</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Signal</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : clients?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No clients found.</TableCell></TableRow>
            ) : (
              clients?.map(client => (
                <TableRow key={client.id}>
                  <TableCell>
                    <Badge variant="outline" className={
                      client.status === "ACTIVE" ? "border-emerald-500/30 text-emerald-500" :
                      client.status === "OFFLINE" ? "border-red-500/30 text-red-500" : "border-yellow-500/30 text-yellow-500"
                    }>{client.status}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{client.mac}</div>
                    <div className="font-mono text-xs text-muted-foreground">{client.ip || '--'}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{client.equipmentModel}</TableCell>
                  <TableCell><SignalStrength dbm={client.lastSeenDbm} /></TableCell>
                  <TableCell className="font-mono text-sm">{client.planLimit}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Link href={`/clients/${client.id}`}>
                      <Button variant="ghost" size="icon"><Eye className="w-4 h-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(client.id)}>
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
