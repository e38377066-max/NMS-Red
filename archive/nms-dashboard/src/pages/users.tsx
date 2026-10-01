import { useMemo, useState } from "react";
import {
  getListUsersQueryKey,
  useCreateUser,
  useListUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserPlus, Users as UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [search, setSearch] = useState("");

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
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
                    <TableHead className="text-right">Estado</TableHead>
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
                      <TableCell className="text-right text-xs text-emerald-400">Activo</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}