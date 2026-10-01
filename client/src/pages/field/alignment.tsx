import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { getGetMyFieldWorkOrderAlignmentQueryKey, getListMyFieldWorkOrdersQueryKey, useGetMyFieldWorkOrderAlignment, useListMyFieldWorkOrders, useReadMyFieldWorkOrderRadioGps, useSaveMyFieldWorkOrderAlignment, type AlignmentPosition } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Compass, MapPin, Radio, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fieldHaptic, readCurrentFieldPosition, requestLocationPermission } from "@/lib/field-device";
import { FieldAimingPanel } from "@/pages/field/aiming-panel";

type Fields={lat:string;lon:string;alt:string;accuracy:string};
type Source=AlignmentPosition["source"];
const blank:Fields={lat:"",lon:"",alt:"",accuracy:""};
const fromPosition=(p:AlignmentPosition|null|undefined):Fields=>p?{lat:String(p.latitude),lon:String(p.longitude),alt:p.altitudeMeters==null?"":String(p.altitudeMeters),accuracy:p.accuracyMeters==null?"":String(p.accuracyMeters)}:{...blank};
const sourceLabel=(s:Source|null|undefined)=>({manual:"Entrada manual",external_gps:"GPS externo",phone_gps:"GPS del teléfono",radio_gps:"Radio",unknown:"Origen desconocido"}[s??"unknown"]);
const parse=(v:string)=>v.trim()===""?null:Number(v.trim().replace(",","."));

function CoordEditor({title,fields,setFields,source,setSource,onPhone,loading,permissionError}:{title:string;fields:Fields;setFields:(f:Fields)=>void;source:Source;setSource:(s:Source)=>void;onPhone:()=>void;loading:boolean;permissionError:string}) {
  return <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">Fuente: {sourceLabel(source)}</p></div><MapPin className="h-5 w-5 text-primary"/></div>
    <div className="mt-4 grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Latitud</Label><Input inputMode="decimal" value={fields.lat} onChange={e=>{setFields({...fields,lat:e.target.value});setSource("manual")}} placeholder="-34.6037" className="min-h-12"/></div><div className="space-y-2"><Label>Longitud</Label><Input inputMode="decimal" value={fields.lon} onChange={e=>{setFields({...fields,lon:e.target.value});setSource("manual")}} placeholder="-58.3816" className="min-h-12"/></div><div className="space-y-2"><Label>Altitud (m)</Label><Input inputMode="decimal" value={fields.alt} onChange={e=>{setFields({...fields,alt:e.target.value});setSource("manual")}} placeholder="Opcional" className="min-h-12"/></div><div className="space-y-2"><Label>Exactitud (m)</Label><Input inputMode="decimal" value={fields.accuracy} onChange={e=>{setFields({...fields,accuracy:e.target.value});setSource("manual")}} placeholder="Desconocida" className="min-h-12"/></div></div>
    <Button variant="outline" className="mt-4 min-h-11 w-full" disabled={loading} onClick={onPhone}><Compass className="mr-2 h-4 w-4"/>{loading?"Solicitando ubicación…":"Usar GPS del teléfono"}</Button>
    {permissionError&&<p role="alert" className="mt-2 text-sm text-amber-200">{permissionError}</p>}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Si la exactitud no está disponible, se guarda como desconocida; no se asume precisión.</p>
  </section>;
}

export default function FieldAlignment() {
  const params=useParams<{id:string}>();const id=Number(params.id);const queryClient=useQueryClient();
  const ordersQuery=useListMyFieldWorkOrders();
  const alignmentQuery=useGetMyFieldWorkOrderAlignment(id,{query:{enabled:Number.isInteger(id)&&id>0,queryKey:getGetMyFieldWorkOrderAlignmentQueryKey(id)}});
  const readGps=useReadMyFieldWorkOrderRadioGps();const save=useSaveMyFieldWorkOrderAlignment();
  const order=(ordersQuery.data??[]).find(item=>item.id===id);
  const data=alignmentQuery.data;
  const [clientFields,setClientFields]=useState<Fields>(blank);const [apFields,setApFields]=useState<Fields>(blank);
  const [clientSource,setClientSource]=useState<Source>("manual");const [apSource,setApSource]=useState<Source>("manual");
  const [permissionError,setPermissionError]=useState("");const [gpsLoading,setGpsLoading]=useState<"client"|"ap"|null>(null);
  const [readError,setReadError]=useState("");const [saveError,setSaveError]=useState("");const [saved,setSaved]=useState(false);
  useEffect(()=>{if(data){setClientFields(fromPosition(data.clientRadio.position));setApFields(fromPosition(data.accessPoint.position));setClientSource(data.clientRadio.position?.source??"manual");setApSource(data.accessPoint.position?.source??"manual");}},[data?.workOrderId]);
  const association=data?.accessPointAssociation;
  const safeAssociation=Boolean(association?.status==="detected"&&association.method&&association.candidates.length===1&&data?.accessPoint.equipmentId!=null&&association.candidates[0]?.equipmentId===data.accessPoint.equipmentId);
  const gps=(which:"client"|"ap")=>async()=>{
    setGpsLoading(which);setPermissionError("");
    try{const allowed=await requestLocationPermission();if(!allowed){setPermissionError("Permiso de ubicación denegado. Activa el GPS en los ajustes o introduce coordenadas manualmente.");return;}const p=await readCurrentFieldPosition();const f={lat:String(p.latitude),lon:String(p.longitude),alt:p.altitudeMeters==null?"":String(p.altitudeMeters),accuracy:p.accuracyMeters==null?"":String(p.accuracyMeters)};if(which==="client"){setClientFields(f);setClientSource("phone_gps");}else{setApFields(f);setApSource("phone_gps");}}
    catch(e){setPermissionError(e instanceof Error?e.message:"No se pudo leer el GPS. Puedes introducir coordenadas manualmente.");}finally{setGpsLoading(null);}
  };
  const explicitRadioRead=async()=>{setReadError("");try{const result=await readGps.mutateAsync({id});const client=result.clientRadio.position;const ap=result.accessPoint.position;if(client){setClientFields(fromPosition(client));setClientSource("radio_gps");}if(ap){setApFields(fromPosition(ap));setApSource("radio_gps");}if(!client&&!ap)setReadError([result.clientRadio.message,result.accessPoint.message].filter(Boolean).join(" · ")||"Los radios no informaron posiciones.");await queryClient.invalidateQueries({queryKey:getGetMyFieldWorkOrderAlignmentQueryKey(id)});}catch(e){setReadError(e instanceof Error?e.message:"No se pudieron leer posiciones de radio.");}};
  const toPosition=(f:Fields,source:Source):AlignmentPosition|null=>{
    const lat=parse(f.lat),lon=parse(f.lon),alt=parse(f.alt),accuracy=parse(f.accuracy);
    if(lat===null&&lon===null&&alt===null&&accuracy===null)return null;
    if(lat===null||lon===null||!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180)return null;
    if(alt!==null&&(!Number.isFinite(alt)||alt < -500||alt>10000))return null;
    if(accuracy!==null&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>10000))return null;
    return {latitude:lat,longitude:lon,altitudeMeters:alt,accuracyMeters:accuracy,source};
  };
  const clientPos=toPosition(clientFields,clientSource);const apPos=toPosition(apFields,apSource);
  const hasInput=[clientFields,apFields].some(f=>Object.values(f).some(v=>v.trim()!==""));
  const invalid=hasInput&&([clientFields,apFields].some(f=>Object.values(f).some(v=>v.trim()!=="")))&&((Object.values(clientFields).some(v=>v.trim()!=="")&&!toPosition(clientFields,clientSource))||(Object.values(apFields).some(v=>v.trim()!=="")&&!toPosition(apFields,apSource)));
  const savePositions=async()=>{setSaved(false);setSaveError("");if(!safeAssociation){setSaveError("No se puede guardar: el servidor no confirmó una asociación única entre radio cliente y AP.");return;}if(invalid){setSaveError("Revisa coordenadas, altitud y exactitud. Latitud −90…90, longitud −180…180.");return;}if(!clientPos&&!apPos){setSaveError("Añade al menos una posición válida antes de guardar.");return;}try{await save.mutateAsync({id,data:{...(clientPos?{clientRadioLocation:clientPos}:{}),...(apPos?{accessPointLocation:apPos}:{})}});setSaved(true);await queryClient.invalidateQueries({queryKey:getGetMyFieldWorkOrderAlignmentQueryKey(id)});await queryClient.invalidateQueries({queryKey:getListMyFieldWorkOrdersQueryKey()});await fieldHaptic();}catch(e){setSaveError(e instanceof Error?e.message:"No se pudieron guardar las posiciones.");}};
  if(!Number.isInteger(id)||id<=0)return <main className="min-h-[100dvh] bg-background p-5 text-foreground">Identificador de orden no válido.</main>;
  if(ordersQuery.isLoading||alignmentQuery.isLoading)return <main className="min-h-[100dvh] bg-background p-5"><div className="mx-auto max-w-2xl space-y-3 pt-8">{[1,2,3].map(i=><div key={i} className="h-24 animate-pulse rounded-2xl bg-card"/> )}</div></main>;
  if(ordersQuery.isError||alignmentQuery.isError||!order||!data)return <main className="min-h-[100dvh] bg-background p-5 text-foreground"><div className="mx-auto max-w-xl"><Link href={`/field/orders/${id}`} className="inline-flex min-h-11 items-center gap-2 text-primary"><ArrowLeft className="h-4 w-4"/>Orden</Link><Alert variant="destructive" className="mt-6"><AlertCircle/><AlertDescription>No se pudo verificar la orden asignada ni cargar el estado de alineación. <button className="ml-1 underline" onClick={()=>{ordersQuery.refetch();alignmentQuery.refetch();}}>Reintentar</button></AlertDescription></Alert></div></main>;
  return <main className="min-h-[100dvh] bg-background text-foreground"><div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4 sm:px-7 sm:pt-7">
    <Link href={`/field/orders/${id}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4"/>Orden #{id}</Link>
    <header><p className="text-xs font-bold tracking-[.15em] text-primary">ALINEACIÓN ASIGNADA</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{data.clientName}</h1><p className="mt-1 text-sm text-muted-foreground">Radio cliente ↔ punto de acceso</p></header>
    <section className={`rounded-2xl border p-4 ${safeAssociation?"border-emerald-400/25 bg-emerald-400/[.07]":"border-amber-300/30 bg-amber-300/[.07]"}`}><div className="flex items-start gap-3">{safeAssociation?<Check className="mt-0.5 h-5 w-5 text-emerald-300"/>:<ShieldAlert className="mt-0.5 h-5 w-5 text-amber-200"/>}<div><h2 className="font-semibold">Asociación {safeAssociation?"confirmada":"no confirmada"}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{safeAssociation?`Asociación única verificada · ${association?.method==="live_unique"?"detección en vivo":"referencia guardada"} · ${new Date(association!.checkedAt).toLocaleString("es")}`:"El servidor debe confirmar una única pareja de equipos. No se permite guardar cuando la asociación es ambigua o no detectada."}</p><p className="mt-2 text-xs text-muted-foreground">{association?.candidates.length??0} AP candidatos {association?.status==="ambiguous"?"· resultado ambiguo":""}</p></div></div></section>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Radio cliente</p><p className="mt-1 font-medium">{data.clientRadio.model||"Modelo no disponible"}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{data.clientMac}</p><p className="mt-2 text-xs text-muted-foreground">ID equipo: {data.clientRadio.equipmentId??"—"}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Punto de acceso</p><p className="mt-1 font-medium">{data.accessPoint.model||"No identificado"}</p><p className="mt-2 text-xs text-muted-foreground">ID equipo: {data.accessPoint.equipmentId??"—"}</p></div></div>
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Lectura de enlace</h2><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Solo lectura</span></div>{data.metrics.available?<div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Señal" value={data.metrics.signalDbm==null?"—":`${data.metrics.signalDbm} dBm`}/><Metric label="CCQ" value={data.metrics.ccq==null?"—":`${data.metrics.ccq}%`}/><Metric label="Ruido" value={data.metrics.noiseDbm==null?"—":`${data.metrics.noiseDbm} dBm`}/><Metric label="TX / RX" value={`${data.metrics.txRate??"—"} / ${data.metrics.rxRate??"—"}`}/></div>:<p className="mt-3 text-sm text-muted-foreground">Métricas no disponibles para este enlace.</p>}{data.metrics.refreshedAt&&<p className="mt-3 text-xs text-muted-foreground">Actualizadas {new Date(data.metrics.refreshedAt).toLocaleString("es")}</p>}</section>
    <div className="rounded-xl border border-primary/20 bg-primary/[.06] p-4 text-sm leading-5 text-muted-foreground"><Radio className="mr-2 inline h-4 w-4 text-primary"/>La lectura de GPS de radio es manual y explícita. Nunca se buscan equipos cercanos ni radios ajenos a esta orden.</div>
    <Button variant="outline" className="min-h-12 w-full" disabled={readGps.isPending} onClick={()=>void explicitRadioRead()}><RefreshCw className={`mr-2 h-4 w-4 ${readGps.isPending?"animate-spin":""}`}/>{readGps.isPending?"Leyendo radios de esta orden…":"Leer GPS de los radios de esta orden"}</Button>
    {readError&&<p role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/[.06] p-3 text-sm text-amber-100">{readError}</p>}
    <CoordEditor title="Ubicación del radio cliente" fields={clientFields} setFields={setClientFields} source={clientSource} setSource={setClientSource} onPhone={gps("client")} loading={gpsLoading==="client"} permissionError={permissionError}/>
    <CoordEditor title="Ubicación del punto de acceso" fields={apFields} setFields={setApFields} source={apSource} setSource={setApSource} onPhone={gps("ap")} loading={gpsLoading==="ap"} permissionError={permissionError}/>
    <FieldAimingPanel clientPosition={toPosition(clientFields,clientSource)} accessPointPosition={toPosition(apFields,apSource)} />
    {saved&&<p role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-200"><Check className="mr-2 inline h-4 w-4"/>Posiciones guardadas con su fuente y exactitud.</p>}
    {saveError&&<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur sm:sticky sm:bottom-3 sm:rounded-2xl sm:border sm:p-3"><Button className="min-h-12 w-full" disabled={save.isPending||!safeAssociation||invalid||!hasInput} onClick={()=>void savePositions()}><Save className="mr-2 h-4 w-4"/>{save.isPending?"Guardando…":"Guardar posiciones"}</Button>{!safeAssociation&&<p className="mt-2 text-center text-xs text-muted-foreground">Bloqueado hasta confirmar una asociación única.</p>}</div>
  </div></main>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>}