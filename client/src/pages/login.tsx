import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { Activity, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useLoginUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { saveAuth } from "@/lib/auth";

export default function Login() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const login = useLoginUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    login.mutate(
      { data: { username: username.trim(), password } },
      {
        onSuccess: (result) => {
          saveAuth(result);
          toast({ title: "Sesión iniciada", description: `Bienvenido, ${result.user.username}.` });
          navigate("/");
        },
        onError: (error) => {
          toast({
            title: "No se pudo iniciar sesión",
            description: error instanceof Error ? error.message : "Comprueba el usuario y la contraseña.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-primary/10 p-10 md:flex">
          <div className="flex items-center gap-2 font-bold tracking-[0.2em] text-primary">
            <Activity className="h-5 w-5" />
            IMPERIO AP
          </div>
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-primary">Network operations</p>
            <h1 className="text-4xl font-bold leading-tight">Controla tu red desde un solo lugar.</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
              Monitoreo, clientes, equipos y operaciones de tu ISP con trazabilidad.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Acceso protegido para el equipo de operaciones.</p>
        </div>
        <Card className="rounded-none border-0 bg-transparent shadow-none">
          <CardHeader className="space-y-3 p-8 pb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary md:hidden">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
            <p className="text-sm text-muted-foreground">Usa tu cuenta de operación para continuar.</p>
          </CardHeader>
          <CardContent className="p-8 pt-3">
            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="login-username">Usuario</Label>
                <Input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Contraseña</Label>
                <div className="relative">
                  <Input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="pr-10" />
                  <button type="button" className="absolute right-3 top-2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button className="w-full" disabled={login.isPending || !username.trim() || !password}>
                {login.isPending ? "Validando..." : "Entrar al panel"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}