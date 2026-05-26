import { useListEquipment, getListEquipmentQueryKey, useDeleteEquipment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Router as RouterIcon, Plus, Eye, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";

export default function Equipment() {
  const { data: equipment, isLoading } = useListEquipment({ query: { queryKey: getListEquipmentQueryKey() } });
  const queryClient = useQueryClient();
  const deleteEq = useDeleteEquipment();
  const { toast } = useToast();

  const handleDelete = (id: number) => {
    if(!confirm("Delete equipment?")) return;
    deleteEq.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
        toast({ title: "Deleted", description: "Equipment deleted" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <RouterIcon className="w-8 h-8 text-primary" />
          Equipment
        </h1>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Register Device
        </Button>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Node</TableHead>
              <TableHead>Clients</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : equipment?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No equipment found.</TableCell></TableRow>
            ) : (
              equipment?.map(eq => (
                <TableRow key={eq.id}>
                  <TableCell><StatusBadge status={eq.lastSeenStatus} /></TableCell>
                  <TableCell className="font-mono text-sm">{eq.ip}</TableCell>
                  <TableCell className="font-medium">{eq.model}</TableCell>
                  <TableCell className="text-muted-foreground">{eq.nodeName}</TableCell>
                  <TableCell>
                    <span className="font-mono bg-muted px-2 py-1 rounded text-xs">{eq.clientCount || 0}</span>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Link href={`/equipment/${eq.id}`}>
                      <Button variant="ghost" size="icon"><Eye className="w-4 h-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(eq.id)}>
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
