import { useState } from "react";
import { useListNodes, getListNodesQueryKey, getGetNodeQueryKey, useCreateNode, useUpdateNode, useDeleteNode, Node } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Plus, Trash2, Edit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function Nodes() {
  const { data: nodes, isLoading } = useListNodes({ query: { queryKey: getListNodesQueryKey() } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createNode = useCreateNode();
  const updateNode = useUpdateNode();
  const deleteNode = useDeleteNode();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  const [editError, setEditError] = useState("");
  const [formData, setFormData] = useState({ name: "", location: "", role: "" });

  const handleAdd = () => {
    createNode.mutate(
      { data: formData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
          setIsAddOpen(false);
          setFormData({ name: "", location: "", role: "" });
          toast({ title: "Nodo creado", description: "El nodo se creó correctamente." });
        },
        onError: () => toast({ title: "Error", description: "No se pudo crear el nodo.", variant: "destructive" })
      }
    );
  };

  const openEdit = (node: Node) => {
    setEditingNode(node);
    setEditError("");
    setFormData({ name: node.name, location: node.location, role: node.role });
  };

  const handleEdit = () => {
    if (!editingNode) return;
    const changes = {
      name: formData.name.trim(),
      location: formData.location.trim(),
      role: formData.role.trim(),
    };
    if (!changes.name || !changes.location || !changes.role) {
      setEditError("Completa el nombre, la ubicación y el rol.");
      return;
    }
    setEditError("");
    updateNode.mutate(
      { id: editingNode.id, data: changes },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(editingNode.id) }),
          ]);
          setEditingNode(null);
          toast({ title: "Nodo actualizado", description: "Los cambios se guardaron correctamente." });
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "No se pudieron guardar los cambios.";
          setEditError(message);
          toast({ title: "No se pudo actualizar el nodo", description: message, variant: "destructive" });
        },
      },
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("¿Eliminar este nodo?")) return;
    deleteNode.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
          toast({ title: "Nodo eliminado", description: "El nodo se eliminó correctamente." });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Server className="w-8 h-8 text-primary" />
          Nodos
        </h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" /> Añadir nodo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Añadir nodo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Rol</Label>
                <Input value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={createNode.isPending}>{createNode.isPending ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={editingNode !== null}
          onOpenChange={(open) => {
            if (!open && !updateNode.isPending) {
              setEditingNode(null);
              setEditError("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar nodo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-node-name">Nombre</Label>
                <Input id="edit-node-name" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-node-location">Ubicación</Label>
                <Input id="edit-node-location" value={formData.location} onChange={(event) => setFormData({ ...formData, location: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-node-role">Rol</Label>
                <Input id="edit-node-role" value={formData.role} onChange={(event) => setFormData({ ...formData, role: event.target.value })} />
              </div>
              {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingNode(null)} disabled={updateNode.isPending}>Cancelar</Button>
              <Button onClick={handleEdit} disabled={updateNode.isPending}>
                {updateNode.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Equipos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : nodes?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No se encontraron nodos.</TableCell></TableRow>
            ) : (
              nodes?.map(node => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium text-foreground">{node.name}</TableCell>
                  <TableCell className="text-muted-foreground">{node.location}</TableCell>
                  <TableCell className="text-muted-foreground">{node.role}</TableCell>
                  <TableCell>
                    <span className="font-mono bg-muted px-2 py-1 rounded text-xs">{node.equipmentCount || 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Editar ${node.name}`} onClick={() => openEdit(node)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(node.id)}>
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
