import { useMemo, useState } from "react";
import {
  getListUsersQueryKey,
  useCreateUser,
  useListUsers,
  useUpdateUser,
  type User,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, ShieldCheck, UserPlus, Users as UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getCurrentUser } from "@/lib/auth";

type Role = "admin" | "operator";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  operator: "Operador",
};

export default function Users() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading, isError } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === "admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<Role>("operator");
  const [resetPassword, setResetPassword] = useState("");
  const [editError, setEditError] = useState("");

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditRole(user.role);
    setResetPassword("");
    setEditError("");
  };

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users ?? [];
    return (users ?? []).filter((user) => user.username.toLowerCase().includes(term));
  }, [search, users]);

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 3 || password.length < 6) {
      toast({
        title: "Datos incompletos",
        description: "El usuario necesita al menos 3 caracteres y la contraseña 6.",
        variant: "destructive",
      });
      return;
    }

    createUser.mutate(
      { data: { username: normalizedUsername, password, role } },
      {
        onSuccess: () => {
          setUsername("");
          setPassword("");
          setRole("operator");
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "Usuario creado", description: `${normalizedUsername} ya puede iniciar sesión.` });
        },
        onError: (error) => {
          toast({
            title: "No se pudo crear el usuario",
            description: error instanceof Error ? error.message : "Revisa si el nombre ya existe.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUser) return;
    const normalizedUsername = editUsername.trim();
    if (normalizedUsername.length < 3 || (resetPassword.length > 0 && resetPassword.length < 6)) {
      setEditError("El usuario debe tener al menos 3 caracteres y la contraseña nueva al menos 6.");
      return;
    }
    setEditError("");
    updateUser.mutate(
      {
        id: editingUser.id,
        data: {
          username: normalizedUsername,
          role: editRole,
          ...(resetPassword ? { password: resetPassword } : {}),
        },
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setEditingUser(null);
          toast({ title: "Usuario actualizado", description: `Se guardaron los cambios de ${normalizedUsername}.` });
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "No se pudieron guardar los cambios.";
          setEditError(message);
          toast({ title: "No se pudo actualizar el usuario", description: message, variant: "destructive" });
        },
      },
    );
  };

  const handleToggleActive = (user: User) => {
    if (user.isActive && user.id === currentUser?.id) {
      toast({ title: "Acción no permitida", description: "No puedes desactivar tu propia cuenta.", variant: "destructive" });
      return;
    }
    const activate = !user.isActive;
    if (!confirm(`${activate ? "¿Reactivar" : "¿Desactivar"} la cuenta de ${user.username}?`)) return;
    updateUser.mutate(
      { id: user.id, data: { isActive: activate } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({
            title: activate ? "Cuenta reactivada" : "Cuenta desactivada",
            description: `${user.username} ${activate ? "puede volver a iniciar sesión" : "ya no puede iniciar sesión"}.`,
          });
        },
        onError: (error) => toast({
          title: "No se pudo cambiar el estado",
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <ShieldCheck className="h-8 w-8 text-primary" />
          Usuarios y permisos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Controla quién puede operar Imperio AP y separa administración de operación diaria.
        </p>
      </div>

      {!isAdmin ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Solo un administrador puede gestionar usuarios.</CardContent></Card>
      ) : <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              Añadir usuario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-2">
                <Label htmlFor="new-username">Usuario</Label>
                <Input
                  id="new-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="operador2"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operador</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" disabled={createUser.isPending}>
                {createUser.isPending ? "Creando..." : "Crear usuario"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4 text-primary" />
              Usuarios registrados
              <Badge variant="outline">{users?.length ?? 0}</Badge>
            </CardTitle>
            <Input
              className="max-w-[220px]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar usuario..."
              type="search"
            />
          </CardHeader>
          <CardContent className="p-0">
            {isError ? (
              <div className="p-8 text-center text-sm text-destructive">No se pudieron cargar los usuarios.</div>
            ) : isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : visibleUsers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No hay usuarios que coincidan.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Alta</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={user.role === "admin" ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}
                        >
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString("es") : "—"}
                      </TableCell>
                      <TableCell className={`text-xs ${user.isActive ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {user.isActive ? "Activo" : "Inactivo"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)} disabled={updateUser.isPending}>
                          <Pencil className="mr-1 h-4 w-4" /> Editar
                        </Button>
                        <Button
                          variant={user.isActive ? "outline" : "default"}
                          size="sm"
                          onClick={() => handleToggleActive(user)}
                          disabled={updateUser.isPending || (user.isActive && user.id === currentUser?.id)}
                        >
                          {user.isActive ? "Desactivar" : "Reactivar"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>}
      <Dialog
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open && !updateUser.isPending) {
            setEditingUser(null);
            setEditError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>Editar usuario</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={handleEdit}>
            <div className="space-y-2">
              <Label htmlFor="edit-username">Usuario</Label>
              <Input id="edit-username" value={editUsername} onChange={(event) => setEditUsername(event.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operador</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password">Nueva contraseña (opcional)</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="Dejar en blanco para no cambiarla"
                autoComplete="new-password"
              />
            </div>
            {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)} disabled={updateUser.isPending}>Cancelar</Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}