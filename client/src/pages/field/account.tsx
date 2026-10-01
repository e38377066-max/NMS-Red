import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ArrowLeft, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUser, logoutAuth } from "@/lib/auth";

const roleLabel:Record<string,string>={technician:"Técnico de campo",admin:"Administrador",supervisor:"Supervisor",operator:"Operador"};
export default function FieldAccount(){
  const user=getCurrentUser();const [,navigate]=useLocation();const [pending,setPending]=useState(false);const [error,setError]=useState("");
  const signOut=async()=>{setPending(true);setError("");try{await logoutAuth();navigate("/login");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar la sesión.");}finally{setPending(false);}};
  return <main className="min-h-[100dvh] bg-background text-foreground"><div className="mx-auto max-w-xl px-4 pt-5 sm:px-7 sm:pt-8"><Link href="/field" className="inline-flex min-h-11 items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4"/>Volver a agenda</Link><header className="mb-7 mt-6"><p className="flex items-center gap-2 text-xs font-bold tracking-[.17em] text-primary"><Activity className="h-4 w-4"/> CUENTA DE CAMPO</p><h1 className="mt-2 text-3xl font-semibold">Tu perfil</h1><p className="mt-1 text-sm text-muted-foreground">Identidad de la sesión activa.</p></header>
    <section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><UserRound className="h-7 w-7"/></div><div className="min-w-0"><p className="truncate text-xl font-semibold">{user?.username??"Sesión no disponible"}</p><p className="mt-1 text-sm text-muted-foreground">{user?roleLabel[user.role]??user.role:"Vuelve a iniciar sesión"}</p></div></div></section>
    <section className="mt-4 flex gap-3 rounded-2xl border border-border bg-card p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary"/><div><h2 className="text-sm font-semibold">Acceso por asignación</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">La agenda y las herramientas de radio se limitan a órdenes asignadas a tu usuario.</p></div></section>
    {error&&<p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    <Button variant="outline" className="mt-7 min-h-12 w-full justify-center" disabled={pending} onClick={()=>void signOut()}><LogOut className="mr-2 h-4 w-4"/>{pending?"Cerrando sesión…":"Cerrar sesión"}</Button>
  </div></main>;
}