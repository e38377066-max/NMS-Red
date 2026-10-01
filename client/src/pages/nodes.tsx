import { useState } from "react";
import { useListNodes, getListNodesQueryKey, useCreateNode, useUpdateNode, useDeleteNode, Node } from "@workspace/api-client-react";
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
  const deleteNode = useDeleteNode();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", location: "", role: "" });

  const handleAdd = () => {
    createNode.mutate(
      { data: formData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
          setIsAddOpen(false);
          setFormData({ name: "", location: "", role: "" });
          toast({ title: "Node created", description: "Node successfully created." });
        },
        onError: () => toast({ title: "Error", description: "Could not create node.", variant: "destructive" })
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete node?")) return;
    deleteNode.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
          toast({ title: "Node deleted", description: "Node removed successfully." });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Server className="w-8 h-8 text-primary" />
          Nodes
        </h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" /> Add Node
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Node</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={createNode.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border border-border/50 rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : nodes?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No nodes found.</TableCell></TableRow>
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
