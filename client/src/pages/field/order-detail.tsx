import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { getListMyFieldWorkOrdersQueryKey, useListMyFieldWorkOrders, useUpdateMyFieldWorkOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Clock3, ExternalLink, MapPin, Radio, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderStatus, orderType, terminalOrder, visitAddress, visitWindow } from "@/lib/field-work";
import { fieldHaptic, openFieldDirections } from "@/lib/field-device";

function SignaturePad({onChange}:{onChange:(value:string)=>void}) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const drawing=useRef(false);
  const strokes=useRef<Array<Array<[number,number]>>>([]);
  const [hasInk,setHasInk]=useState(false);
  const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{
    const canvas=canvasRef.current!;
    const rect=canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};
  };
  const normalized=(event:React.PointerEvent<HTMLCanvasElement>):[number,number]=>{const p=point(event);const c=canvasRef.current!;return [Number((p.x/c.width).toFixed(4)),Number((p.y/c.height).toFixed(4))];};
  const down=(event:React.PointerEvent<HTMLCanvasElement>)=>{if(strokes.current.length>=32)return;event.currentTarget.setPointerCapture(event.pointerId);drawing.current=true;setHasInk(true);strokes.current=[...strokes.current,[normalized(event)]];const ctx=canvasRef.current!.getContext("2d")!;const p=point(event);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineWidth=4;ctx.lineCap="round";ctx.strokeStyle="#77d9f2";};
  const move=(event:React.PointerEvent<HTMLCanvasElement>)=>{if(!drawing.current)return;const ctx=canvasRef.current!.getContext("2d")!;const p=point(event);ctx.lineTo(p.x,p.y);ctx.stroke();const active=strokes.current.length-1;if(strokes.current[active].length<500&&strokes.current.reduce((sum,stroke)=>sum+stroke.length,0)<1000)strokes.current[active]=[...strokes.current[active],normalized(event)];onChange(JSON.stringify({version:1,signerName:"",signedAt:new Date().toISOString(),strokes:strokes.current}));};
  const clear=()=>{const c=canvasRef.current!;c.getContext("2d")!.clearRect(0,0,c.width,c.height);drawing.current=false;strokes.current=[];setHasInk(false);onChange("");};
  return <div className="rounded-xl border border-border bg-background p-2"><canvas ref={canvasRef} width={900} height={260} onPointerDown={down} onPointerMove={move} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}} className="h-32 w-full touch-none rounded-lg bg-card" aria-label="Área para firmar" /><div className="flex items-center justify-between px-1 pt-2 text-xs text-muted-foreground"><span>{hasInk?"Firma capturada":"Firma aquí con el dedo"}</span><button type="button" onClick={clear} className="inline-flex min-h-9 items-center gap-1 text-primary"><RotateCcw className="h-3.5 w-3.5"/>Borrar</button></div></div>;
}

export default function FieldOrderDetail() {
  const params=useParams<{id:string}>();
  const id=Number(params.id);
  const query=useListMyFieldWorkOrders();
  const client=useQueryClient();
  const mutation=useUpdateMyFieldWorkOrder();
  const order=(query.data??[]).find(item=>item.id===id);
  const [signal,setSignal]=useState("");
  const [ccq,setCcq]=useState("");
  const [equipment,setEquipment]=useState("");
  const [serial,setSerial]=useState("");
  const [destination,setDestination]=useState("");
  const [signer,setSigner]=useState("");
  const [signature,setSignature]=useState("");
  const [confirmRelocation,setConfirmRelocation]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  useEffect(()=>{if(order){setSignal(order.signalDbm==null?"":String(order.signalDbm));setCcq(order.ccq==null?"":String(order.ccq));setEquipment(order.installedEquipment??"");setSerial(order.installedSerialNumber??"");setDestination(order.address??"");}},[order?.id]);
  const isRelocation=order?.type.toLowerCase()==="relocation";
  const needsSignature=order?.type.toLowerCase()==="installation";
  const inProgress=order?.status.toLowerCase()==="in_progress";
  const complete=order?terminalOrder(order):false;
  const runUpdate=async(data:{status:"in_progress"|"completed";address?:string;signalDbm?:number;ccq?:number;installedEquipment?:string;installedSerialNumber?:string;signatureData?:string})=>{
    setError("");setNotice("");
    try {await mutation.mutateAsync({id,data});await client.invalidateQueries({queryKey:getListMyFieldWorkOrdersQueryKey()});setNotice(data.status==="in_progress"?"Visita iniciada. Registra los resultados antes de completar.":"Orden completada y guardada.");await fieldHaptic();return true;}
    catch(e){setError(e instanceof Error?e.message:"No se pudo actualizar la orden. Inténtalo de nuevo.");return false;}
  };
  const start=()=>void runUpdate({status:"in_progress"});
  const finish=async()=>{
    const parse=(v:string)=>v.trim()===""?undefined:Number(v.trim().replace(",","."));
    const s=parse(signal),q=parse(ccq);
    if(s!==undefined&&(!Number.isFinite(s)||s < -120||s>0)){setError("La señal debe estar entre −120 y 0 dBm.");return;}
    if(q!==undefined&&(!Number.isFinite(q)||q<0||q>100)){setError("El CCQ debe estar entre 0 y 100 %.");return;}
    if(isRelocation&&!destination.trim()){setError("Indica la nueva dirección antes de completar.");return;}
    if(needsSignature&&(!signer.trim()||!signature)){setError("Para una instalación se requiere nombre y firma de conformidad.");return;}
    if(needsSignature){
      const parsed=JSON.parse(signature) as {version:number;signedAt:string;strokes:Array<Array<[number,number]>>};
      if(!parsed.strokes.some(stroke=>stroke.length>=2)){setError("Firma dentro del recuadro para continuar.");return;}
      parsed.signedAt=new Date().toISOString();
      await runUpdate({status:"completed",...(isRelocation?{address:destination.trim()}:{}),...(s!==undefined?{signalDbm:s}:{}),...(q!==undefined?{ccq:q}:{}),...(equipment.trim()?{installedEquipment:equipment.trim()}:{}),...(serial.trim()?{installedSerialNumber:serial.trim()}:{}),signatureData:JSON.stringify({...parsed,signerName:signer.trim()})});
    } else {
      await runUpdate({status:"completed",...(isRelocation?{address:destination.trim()}:{}),...(s!==undefined?{signalDbm:s}:{}),...(q!==undefined?{ccq:q}:{}),...(equipment.trim()?{installedEquipment:equipment.trim()}:{}),...(serial.trim()?{installedSerialNumber:serial.trim()}:{} )});
    }
    setConfirmRelocation(false);
  };
  if(!Number.isInteger(id)||id<=0)return <main className="min-h-[100dvh] bg-background p-5 text-foreground"><Link href="/field" className="inline-flex min-h-11 items-center gap-2 text-primary"><ArrowLeft className="h-4 w-4"/>Agenda</Link><p className="mt-8">El identificador de la orden no es válido.</p></main>;
  if(query.isLoading)return <main className="min-h-[100dvh] bg-background p-5 text-foreground"><div className="mx-auto max-w-2xl space-y-3 pt-12">{[1,2,3].map(i=><div key={i} className="h-20 animate-pulse rounded-xl bg-card"/> )}</div></main>;
  if(query.isError)return <main className="min-h-[100dvh] bg-background p-5 text-foreground"><div className="mx-auto max-w-xl pt-8"><Link href="/field" className="inline-flex min-h-11 items-center gap-2 text-primary"><ArrowLeft className="h-4 w-4"/>Agenda</Link><div className="mt-8 rounded-2xl border border-destructive/30 bg-card p-5"><AlertCircle className="mb-3 h-5 w-5 text-destructive"/><h1 className="font-semibold">No se pudo verificar la asignación</h1><p className="mt-2 text-sm text-muted-foreground">Las órdenes se consultan solo desde tus asignaciones.</p><Button className="mt-4 min-h-11" variant="outline" onClick={()=>query.refetch()}>Reintentar</Button></div></div></main>;
  if(!order)return <main className="min-h-[100dvh] bg-background p-5 text-foreground"><Link href="/field" className="inline-flex min-h-11 items-center gap-2 text-primary"><ArrowLeft className="h-4 w-4"/>Agenda</Link><div className="mx-auto mt-12 max-w-md text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><AlertCircle/></div><h1 className="mt-4 text-xl font-semibold">Orden no disponible</h1><p className="mt-2 text-sm text-muted-foreground">No está asignada a tu cuenta o ya no está disponible.</p></div></main>;
  return <main className="min-h-[100dvh] bg-background text-foreground"><div className="mx-auto max-w-2xl px-4 pb-20 pt-4 sm:px-7 sm:pt-7">
    <Link href="/field" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"><ArrowLeft className="h-4 w-4"/>Volver a agenda</Link>
    <header className="mb-6 mt-4"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-primary">{orderType(order.type)} <span className="text-muted-foreground">· orden #{order.id}</span></div><h1 className="mt-2 text-3xl font-semibold tracking-tight">{order.clientName||"Cliente asignado"}</h1><div className="mt-3 inline-flex rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">{orderStatus(order.status)}</div></header>
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><h2 className="font-semibold">Visita asignada</h2><div className="mt-4 flex items-start gap-3"><Clock3 className="mt-0.5 h-4 w-4 text-primary"/><div><p className="text-sm font-medium">{visitWindow(order.scheduledAt,order.scheduledEndAt)}</p><p className="mt-1 text-xs text-muted-foreground">Ventana definida por supervisión · se conserva sin cambios</p></div></div><div className="mt-4 flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 text-primary"/><div className="min-w-0 flex-1"><p className="text-sm leading-5">{visitAddress(order)}</p><Button variant="outline" className="mt-3 min-h-11" onClick={()=>void openFieldDirections(visitAddress(order))}><ExternalLink className="mr-2 h-4 w-4"/>Cómo llegar</Button></div></div></section>
    {order.notes&&<section className="mt-3 rounded-2xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Indicaciones de trabajo</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{order.notes}</p></section>}
    {!complete&&<Link href={`/field/orders/${order.id}/alignment`} className="mt-3 flex min-h-12 items-center justify-between rounded-xl border border-primary/25 bg-primary/[.06] px-4 text-sm font-medium text-primary">Herramienta de alineación asignada<ExternalLink className="h-4 w-4"/></Link>}
    {isRelocation&&<section className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/[.06] p-4"><p className="text-xs font-bold tracking-widest text-amber-200">REUBICACIÓN</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Dirección actual</p><p className="mt-1 text-sm">{order.address||order.clientInstallationAddress||"No registrada"}</p></div><div><p className="text-xs text-muted-foreground">Nueva dirección</p><p className="mt-1 text-sm">{destination.trim()||"Por indicar"}</p></div></div></section>}
    {!complete&&inProgress&&<section className="mt-5 space-y-4"><div><div className="mb-3 flex items-center gap-2"><Radio className="h-4 w-4 text-primary"/><h2 className="font-semibold">Resultado del trabajo</h2></div><p className="mb-4 text-xs leading-5 text-muted-foreground">Registra cada medida por separado. No se cambiarán configuraciones de radio, IP, MAC ni router.</p>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="signal">Señal (dBm)</Label><Input id="signal" inputMode="decimal" value={signal} onChange={e=>setSignal(e.target.value)} placeholder="−65" className="min-h-12"/></div><div className="space-y-2"><Label htmlFor="ccq">CCQ (%)</Label><Input id="ccq" inputMode="decimal" value={ccq} onChange={e=>setCcq(e.target.value)} placeholder="92" className="min-h-12"/></div></div>
      {isRelocation&&<div className="mt-4 space-y-2"><Label htmlFor="destination">Nueva dirección *</Label><Input id="destination" value={destination} onChange={e=>setDestination(e.target.value)} maxLength={500} placeholder="Dirección de destino" className="min-h-12"/></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="equipment">Equipo instalado</Label><Input id="equipment" value={equipment} onChange={e=>setEquipment(e.target.value)} maxLength={200} placeholder="Modelo / descripción" className="min-h-12"/></div><div className="space-y-2"><Label htmlFor="serial">Número de serie</Label><Input id="serial" value={serial} onChange={e=>setSerial(e.target.value)} maxLength={128} placeholder="Serie" className="min-h-12"/></div></div>
      {needsSignature&&<div className="mt-4 space-y-2"><Label htmlFor="signer">Firma de conformidad · nombre</Label><Input id="signer" value={signer} onChange={e=>setSigner(e.target.value)} maxLength={120} placeholder="Nombre de quien recibe" className="min-h-12"/><SignaturePad onChange={setSignature}/></div>}
    </div></section>}
    {!inProgress&&!complete&&<div className="mt-5 rounded-xl border border-primary/20 bg-primary/[.06] p-4 text-sm text-muted-foreground">Inicia la visita para registrar medidas y materiales instalados.</div>}
    {complete&&<div className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[.08] p-4"><div className="flex items-center gap-2 font-medium text-emerald-300"><Check className="h-4 w-4"/>Visita completada</div>{order.signalDbm!=null&&<p className="mt-2 text-sm text-muted-foreground">Señal {order.signalDbm} dBm · CCQ {order.ccq==null?"—":`${order.ccq}%`}</p>}</div>}
    {error&&<p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
    {!complete&&<div className="sticky bottom-0 -mx-4 mt-6 border-t border-border bg-background/95 p-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">{inProgress?<Button className="min-h-12 w-full text-base" disabled={mutation.isPending} onClick={()=>isRelocation?setConfirmRelocation(true):void finish()}>{mutation.isPending?"Guardando…":"Completar visita"}</Button>:<Button className="min-h-12 w-full text-base" disabled={mutation.isPending} onClick={start}>{mutation.isPending?"Iniciando…":"Iniciar visita"}</Button>}</div>}
    {confirmRelocation&&<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"><h2 className="text-lg font-semibold">Confirmar reubicación</h2><p className="mt-2 text-sm text-muted-foreground">Verifica ambas direcciones. La nueva ubicación se guardará al completar esta orden asignada.</p><div className="mt-4 space-y-3 rounded-xl bg-background p-3 text-sm"><p><span className="block text-xs text-muted-foreground">Anterior</span>{order.address||order.clientInstallationAddress||"No registrada"}</p><p><span className="block text-xs text-muted-foreground">Nueva</span>{destination||"Por indicar"}</p></div><div className="mt-5 grid grid-cols-2 gap-3"><Button variant="outline" className="min-h-11" onClick={()=>setConfirmRelocation(false)}>Revisar</Button><Button className="min-h-11" disabled={mutation.isPending} onClick={()=>void finish()}>{mutation.isPending?"Guardando…":"Confirmar y completar"}</Button></div></div></div>}
  </div></main>;
}