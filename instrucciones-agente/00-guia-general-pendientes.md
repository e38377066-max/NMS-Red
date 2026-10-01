# Guía general para agentes AI: pendientes del ISP administrativo

## Propósito

Esta guía permite que otro agente AI complete los pendientes de
`pendientes-isp-administrativo.md` sin perder el orden funcional del proyecto.

El agente debe avanzar una sección a la vez. No debe implementar una sección
posterior para compensar una sección anterior incompleta. Si una dependencia
externa, una credencial o una decisión de producto bloquea el trabajo, debe
detenerse, documentar el bloqueo y preparar la instrucción concreta para el
siguiente agente; no debe inventar datos ni saltarse el orden.

## Estado de partida

La base ya implementada incluye:

- API Express y dashboard React/Vite;
- sesiones JWT, bloqueo temporal y primer administrador explícito;
- equipos MikroTik, Ubiquiti y Proxmox;
- clientes, aprovisionamiento idempotente y rollback;
- cortes, reconexiones y reconciliación CRM–MikroTik;
- planes, pagos, facturas, cierres y recibos HTML;
- portal de cliente con token, resumen, saldo real, pagos, tickets, avisos y
  solicitudes básicas, comprobantes privados y reenvío de rechazados;
- operaciones, tickets básicos, órdenes de campo e inventario básico;
- monitoreo inicial, alertas deduplicadas, métricas y auditoría;
- backups, cifrado, cola persistente, organizaciones, sedes y avisos;
- expediente administrativo con referencia, notas, instalación, técnico,
  AP/enlace e historial;
- contratos formales privados versionados para clientes, con PDF, aprobación,
  rechazo, descarga protegida y auditoría.

Antes de comenzar cualquier sección, comparar el código actual con el documento
de pendientes. No rehacer una capacidad que ya esté funcionando.

## Reglas obligatorias para todos los agentes

### 1. Trabajar por orden

El orden de trabajo es:

1. Alta completa de clientes: contrato formal (completada).
2. Facturación administrativa completa (completada).
3. Portal del cliente restante.
4. Soporte y tickets.
5. Operación de campo.
6. Inventario.
7. Monitoreo MikroTik y Ubiquiti.
8. Alertas reales.
9. Descubrimiento e inventario de red.
10. Usuarios y permisos.
11. Multiempresa y multisede.
12. Auditoría completa.
13. Backups y recuperación.
14. Arquitectura de producción.

Las prioridades iniciales de aprovisionamiento, cortes y reconciliación ya
tienen base funcional. No volver a implementarlas salvo que una sección
posterior encuentre una regresión verificable.

### 2. Inspección antes de editar

Leer antes de cada tarea:

- `pendientes-isp-administrativo.md`;
- `replit.md`;
- `.agents/memory/MEMORY.md` y los temas relevantes;
- el skill especializado que corresponda;
- las rutas, servicios, schemas y páginas que ya cubran esa capacidad.

Buscar primero con `rg` y leer solo los archivos relevantes. Mantener la
estructura actual del monorepo.

### 3. Contrato primero

Para cualquier endpoint nuevo o cambio de respuesta:

1. actualizar `lib/api-spec/openapi.yaml`;
2. ejecutar:

   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```

3. implementar rutas y servicios;
4. conectar el dashboard usando el contrato generado o la convención
   existente;
5. comprobar la respuesta después de recargar la página.

No crear endpoints privados que solo existan en el frontend.

El workspace usa Zod 3, mientras las versiones actuales de Orval pueden generar
`zod.int()` y exportaciones duplicadas. `lib/api-spec/compat-codegen.mjs` aplica
la compatibilidad necesaria después de cada regeneración; debe conservarse al
modificar el contrato OpenAPI.

### 4. Base de datos y archivos

- Para cambios de datos, usar Drizzle en `lib/db/src/schema/`.
- No guardar archivos, base64 ni binarios en PostgreSQL.
- Para archivos persistentes, leer `.local/skills/object-storage/SKILL.md`.
- Mantener el proveedor de almacenamiento que ya usa el proyecto
  (`s3` o `filesystem`) salvo decisión explícita del usuario.
- El `push` de esquema documentado en `replit.md` es solo para desarrollo.
  Nunca ejecutar cambios de esquema sobre producción desde el agente.
- Toda descarga de documentos debe comprobar autenticación, autorización y
  pertenencia al cliente u organización.

### 5. Seguridad y red

- No pedir, imprimir ni guardar secretos en el repositorio.
- No inventar conectividad hacia MikroTik, Ubiquiti, WireGuard, CGNAT o
  servicios externos.
- Las operaciones que modifican equipos deben conservar dry-run, confirmación,
  bloqueo por equipo, rollback y verificación posterior.
- Las operaciones administrativas deben dejar auditoría.
- Los cambios críticos deben ser explícitos y reversibles.

### 6. Definición de terminado

Una sección solo está terminada cuando:

- API, base de datos y UI cubren el mismo flujo;
- existen estados de carga, vacío, error y éxito;
- las mutaciones actualizan las listas y detalles visibles;
- el flujo funciona después de navegar y recargar;
- permisos y aislamiento están comprobados;
- hay auditoría para acciones sensibles;
- se ejecuta el typecheck y el build relevante;
- se actualiza `pendientes-isp-administrativo.md`;
- se reportan decisiones, bloqueos y pendientes restantes.

## Hoja de ruta por sección

### 1. Alta completa de clientes: contrato formal — completada

**Objetivo:** asociar un contrato documental versionado al expediente del
cliente.

**Implementado:**

- tabla de documentos contractuales vinculada a `clients`;
- versiones con estados `PENDING`, `APPROVED` y `REJECTED`;
- carga privada de PDF de hasta 10 MB mediante el proveedor configurado
  (`filesystem` o `s3`);
- nombre original, MIME, tamaño, hash, ruta privada y usuario que carga;
- aprobación o rechazo con motivo;
- como máximo un contrato aprobado vigente por cliente mediante restricción de
  base de datos;
- descarga protegida con autenticación;
- sección de documentos en
  `client/src/pages/client-detail.tsx` con carga, listado,
  estado, revisión y descarga;
- auditoría de carga, aprobación y rechazo con usuario, IP, dispositivo,
  motivo y estados anterior/nuevo;
- rutas documentadas en OpenAPI y hooks generados para listar y revisar
  contratos.

**Archivos principales:**

- `lib/db/src/schema/clients.ts`
- `src/routes/client-contracts.ts`
- `src/services/object-storage.service.ts`
- `client/src/pages/client-detail.tsx`
- `lib/api-spec/openapi.yaml`

**Verificación realizada:**

- `pnpm --filter @workspace/api-spec run codegen`: correcto.
- `pnpm run typecheck`: correcto en librerías, API, dashboard, canvas y
  scripts.
- Build del API: correcto.
- Build del dashboard: correcto con `PORT` y `BASE_PATH` del artifact.
- Schema de desarrollo actualizado con Drizzle.
- `/api/healthz`: responde correctamente.
- `/api/clients` sin autenticación: rechaza con `401`.
- Dashboard servido en preview sin errores de navegador.

**Decisiones y límites:** una versión nueva no sobrescribe una anterior y una
segunda aprobada reemplaza lógicamente a la vigente sin perder historial. El
flujo autenticado completo de ficha no se pudo probar con usuarios demo porque
las credenciales documentadas no estaban disponibles en la base actual; no se
inventaron credenciales.

**Estado actual:** la sección 2 y el flujo formal de comprobantes del portal ya
están implementados. Antes de abrir una tarea nueva, comparar el código con
`pendientes-isp-administrativo.md` para no rehacer estas capacidades.

### 2. Facturación administrativa completa

**Objetivo:** convertir la facturación actual en un ciclo administrativo
completo y revisable.

**Estado:** completada.

**Implementado:**

- prorrateo al iniciar, trasladar o cambiar de plan;
- historial de deuda por factura, cliente y período;
- comprobante de pago como archivo privado;
- estados de comprobante: pendiente, aprobado y rechazado;
- motivo de rechazo y reenvío;
- aplicación del pago únicamente después de aprobación;
- avisos configurables antes del vencimiento;
- reglas configurables de suspensión con período de gracia;
- reporte de morosidad por antigüedad y saldo;
- exportación contable con período, factura, pago, método y estado;
- auditoría de aprobación, rechazo, suspensión y exportación.

**Archivos principales:**

- `src/services/billing.service.ts`;
- `src/routes/billing.ts`;
- `src/routes/portal.ts`;
- `client/src/pages/billing.tsx`;
- `client/src/pages/client-portal.tsx`;
- `lib/db/src/schema/operations.ts`;
- `lib/api-spec/openapi.yaml`.

**Cuidado:** no aplicar un pago dos veces por reintento ni cambiar el estado
de red sin una regla de suspensión explícita y verificable.

**Cierre:** un comprobante aprobado actualiza la factura una sola vez, la
deuda histórica permanece consultable y el reporte de morosidad coincide con
los saldos de las facturas.

**Verificación realizada:**

- `pnpm --filter @workspace/api-spec run codegen`: correcto;
- `pnpm run typecheck`: correcto en librerías, API, dashboard, canvas y
  scripts;
- build del API durante el workflow: correcto;
- dashboard servido en preview sin errores de navegador;
- `/api/healthz`: responde `200 OK`;
- esquema de desarrollo actualizado con Drizzle;
- cambios de plan ascendentes cobran solo la diferencia proporcional y los
  descendentes generan crédito sin facturas negativas.

### 3. Portal del cliente restante — completada

**Objetivo:** cerrar las capacidades que el cliente puede ejecutar sin entrar
al dashboard administrativo.

**Revisar primero:** el portal web y los endpoints existentes ya cubren token,
plan, saldo real, pagos, recibos, comprobantes privados, reenvío de rechazados,
tickets, avisos, cambio de plan, traslado, reconexión y cierre básico.

**Alcance restante:**

- mostrar estado de revisión y motivo de rechazo;
- mejorar la presentación del comprobante descargable cuando corresponda;
- confirmar que el saldo proviene de facturas y no solo de `paymentStatus`;
- mostrar AP/enlace asociado cuando exista;
- permitir que el cliente reabra un ticket cerrado cuando el soporte lo
  habilite;
- añadir confirmaciones y mensajes claros para solicitudes pendientes.

**Dependencias:** sección 2 y autorización por token.

**Cierre:** el cliente puede consultar su situación completa y ninguna acción
del portal puede modificar directamente colas, DHCP o suspensión sin pasar por
la operación administrativa correspondiente.

**Estado:** completada. El recibo del portal es imprimible y apto para guardar
como PDF; las solicitudes muestran su ticket y estado pendiente; soporte puede
autorizar una reapertura de un solo uso, que queda auditada.

### 4. Soporte y tickets

**Objetivo:** convertir los tickets básicos en una mesa de ayuda medible.

**Alcance:**

- SLA de primera respuesta y resolución por prioridad;
- evidencias adjuntas y fotografías privadas;
- historial de estados inmutable;
- confirmación de cierre por cliente;
- reapertura controlada;
- reporte de tickets vencidos;
- notificaciones al cliente y técnico;
- filtros por estado, prioridad, SLA y responsable;
- auditoría de asignación, cambios de estado y reapertura.

**Dependencias:** almacenamiento privado, portal y usuarios/permisos.

**Cierre:** cada ticket muestra fechas objetivo, historial completo, evidencia,
responsable y estado de SLA; las transiciones inválidas son rechazadas.

**Estado (2026-09-30):** contrato OpenAPI, esquema, rutas, interfaz operativa y
portal de adjuntos implementados. Codegen, typechecks, build y push del esquema
de desarrollo pasan; `/api/healthz` responde y las rutas protegidas rechazan
solicitudes sin autenticación. Los adjuntos tienen un adaptador filesystem
separado del almacenamiento de backups; se probaron lectura, escritura,
eliminación, permisos privados y rechazo de rutas maliciosas en un directorio
temporal. No marcar esta sección como completada todavía: falta configurar y
probar el volumen persistente del servicio API en Railway.

**Próximo paso seguro:** montar un volumen Railway en `/data` (o usar el punto
de montaje existente) y configurar `TICKET_ATTACHMENT_STORAGE_DIR` en el
servicio API, por ejemplo `/data/support-ticket-attachments`. Después probar
carga y descarga desde soporte, visibilidad privada/pública al cliente,
permisos por token y rechazo de archivos inválidos o mayores de 2 MiB. El
almacenamiento nuevo no cambia el destino de backups. El filesystem local de
Replit no sirve como persistencia de producción. Los SLA se calculan en
minutos corridos y sus objetivos son editables; el horario laboral aún no está
definido.

### 5. Operación de campo

**Objetivo:** hacer trazable el trabajo técnico en instalaciones y visitas.

**Estado (2026-09-30): parcial.** Ya existen agenda/órdenes, app móvil, alineación con detección del AP asociado en vivo y captura móvil de nombre/firma de conformidad para órdenes de instalación. El API valida la firma y la fecha del servidor. No marcar la sección completa todavía: faltan fotos antes/después con almacenamiento persistente, un acta integral revisable/descargable, cambios trazables de AP/SXT y movimientos de inventario ligados a la orden.

**Alcance:**

- agenda y disponibilidad de técnicos;
- fotos antes y después;
- señal del enlace y CCQ;
- equipo instalado y número de serie;
- acta de instalación firmable;
- historial de visitas;
- reubicación del cliente;
- cambio de AP o SXT;
- vista y flujo móvil responsive para técnicos.

**Dependencias:** inventario, equipos, clientes, almacenamiento, permisos por
sede y tickets.

**Cuidado:** un cambio de AP o SXT no debe cambiar el Router central que
controla DHCP, colas y facturación.

**Cierre:** una orden de campo tiene agenda, técnico, evidencias, materiales,
mediciones, firma y vínculo con el cliente y el inventario.

### 6. Inventario

**Objetivo:** controlar existencias, equipos serializados y movimientos entre
sedes.

**Estado (2026-09-30): parcial.** Existe catálogo básico de inventario, pero no hay libro de movimientos completo ni garantías de unicidad para serie/MAC. No permite cerrar instalación, transferencia y retiro con trazabilidad.

**Alcance:**

- entradas, salidas y transferencias;
- número de serie único;
- MAC única cuando aplique;
- estados de reparación;
- historial de movimientos;
- categorías para radios Ubiquiti, antenas, fuentes PoE, cables y conectores;
- vínculo con orden de campo, cliente, equipo y sede;
- inventario disponible, reservado, instalado, reparando y retirado.

**Dependencias:** organizaciones/sedes, operación de campo y permisos.

**Cierre:** nunca se puede instalar, transferir o retirar una unidad sin
actualizar existencias y registrar quién, cuándo, desde dónde y hacia dónde.

### 7. Monitoreo de MikroTik y Ubiquiti

**Objetivo:** persistir y mostrar métricas operativas útiles por marca.

**Estado (2026-09-30): parcial.** Hay lecturas en vivo y métricas iniciales; faltan varias métricas específicas por marca, retención/frescura homogénea y aislamiento de fallos por equipo.

**MikroTik:** CPU, memoria, temperatura, interfaces, tráfico, pérdida,
latencia, DHCP, colas, desconexiones repetidas, backups, RouterOS y
certificados.

**Ubiquiti/SXT:** capacidad de enlace, frecuencia, canal, ancho de canal,
reintentos, radio, firmware, temperatura, saturación y disponibilidad PTP.

**Alcance transversal:**

- normalizar unidades y timestamps;
- guardar histórico con retención definida;
- diferenciar dato no disponible de valor cero;
- mostrar última lectura y tendencia;
- evitar que un fallo de un equipo detenga todo el worker;
- asociar métricas con equipo, sede y enlace.

**Dependencias:** descubrimiento de equipos solo si aporta identificadores;
servicios `monitoring`, `network-monitoring` y métricas existentes.

**Cierre:** cada métrica tiene fuente, fecha, estado de frescura y manejo
explícito de errores.

### 8. Alertas reales

**Objetivo:** generar incidentes accionables desde las métricas y tareas.

**Estado (2026-09-30): parcial.** Hay alertas iniciales de disponibilidad/degradación y deduplicación; faltan reglas para todas las métricas, ventanas/histéresis, escalamiento y notificaciones Telegram/correo.

**Alcance:**

- caída de MikroTik, LiteAP y SXT;
- enlace degradado;
- señal, CCQ, ruido, CPU, memoria y temperatura fuera de umbral;
- interfaz saturada;
- pérdida y latencia altas;
- cliente desconectándose repetidamente;
- backup fallido;
- certificado próximo a vencer;
- escalamiento por tiempo y severidad;
- notificación por Telegram y correo mediante integraciones configuradas.

**Dependencias:** sección 7, deduplicación existente, usuarios, sedes e
integraciones externas.

**Cuidado:** usar ventanas de recuperación, histéresis y deduplicación para
evitar tormentas de alertas.

**Cierre:** una condición sostenida abre una alerta, la recuperación la
resuelve y cada notificación tiene reintento, estado y auditoría.

### 9. Descubrimiento e inventario de red

**Objetivo:** encontrar equipos de una subred autorizada y compararlos con el
inventario.

**Estado (2026-09-30): pendiente.** No se encontró un flujo de descubrimiento revisable que limite el escaneo a una subred autorizada.

**Alcance:**

- descubrimiento por subred explícitamente autorizada;
- detección de MikroTik y Ubiquiti;
- importación revisable;
- modelo, firmware, interfaces, radios y licencias;
- detección de duplicados;
- historial de cambios de IP;
- detección de equipos reemplazados;
- comparación de inventario físico contra sistema.

**Dependencias:** permisos, organizaciones/sedes, almacenamiento de resultados
si son grandes y conectividad externa real.

**Cuidado:** no escanear rangos arbitrarios ni ejecutar cambios durante un
descubrimiento. El descubrimiento debe ser de solo lectura.

**Cierre:** el agente muestra qué encontró, qué importará, qué coincide, qué
es duplicado y qué requiere confirmación humana.

### 10. Usuarios y permisos

**Objetivo:** sustituir el control básico por autorización granular.

**Estado (2026-09-30): parcial.** Hay autenticación, sesiones y roles básicos; falta autorización granular por acción y por alcance de organización/sede/recurso, además de MFA y controles de sesión solicitados.

**Roles mínimos:** superadministrador, administrador de red, facturación,
soporte, técnico de campo, solo lectura y auditor.

**Alcance:**

- permisos por módulo y acción;
- alcance por equipo, cliente, organización y sede;
- administrador limitado por sede;
- MFA para administradores;
- revocación de sesiones;
- historial de sesiones;
- restricción por IP si se configura;
- rotación de credenciales;
- middleware de autorización reutilizable en API y navegación del dashboard.

**Dependencias:** organizaciones/sedes, auditoría y autenticación existente.

**Cuidado:** ocultar un botón no es autorización; cada endpoint debe validar
el permiso en servidor.

**Cierre:** un usuario no puede leer ni modificar recursos fuera de su
alcance aunque conozca el ID o la URL.

### 11. Multiempresa y multisede

**Objetivo:** aplicar aislamiento real sobre la base existente.

**Estado (2026-09-30): parcial y de alto riesgo.** Existe el modelo de organizaciones/sedes, pero no está aplicado como filtro de seguridad consistente en todas las consultas, workers y reportes.

**Alcance:**

- organización en clientes, equipos, planes y pagos;
- sede en técnicos, MikroTik y Ubiquiti;
- filtros de aislamiento en todas las consultas;
- configuración independiente;
- límites por organización;
- reportes, facturación y auditoría separados;
- selección de organización/sede en el dashboard según permisos.

**Dependencias:** sección 10 y modelo actual de memberships.

**Cuidado:** no confiar en un filtro enviado por el frontend. Derivar el
alcance desde la sesión y aplicar autorización en cada consulta.

**Cierre:** dos organizaciones con IDs conocidos no pueden verse ni afectarse
entre sí; los reportes y workers respetan el mismo aislamiento.

### 12. Auditoría completa

**Objetivo:** que las acciones críticas puedan reconstruirse sin ambigüedad.

**Estado (2026-09-30): parcial.** Hay auditoría en operaciones administrativas, pero no se verificó cobertura universal ni correlación completa con tareas, comandos, resultados y reintentos.

**Alcance:**

- usuario, rol, IP y dispositivo;
- cliente, MikroTik y Ubiquiti afectados;
- configuración anterior y nueva;
- comando ejecutado;
- resultado real;
- motivo y confirmación adicional;
- fecha y duración;
- error completo;
- identificador de tarea y reintentos.

**Dependencias:** se debe revisar después de implementar las secciones
anteriores para cubrir sus nuevas acciones.

**Cuidado:** no registrar secretos, contraseñas ni tokens; guardar referencias
seguras y valores redactados.

**Cierre:** cada operación crítica tiene un evento verificable, correlacionado
con su tarea, sin información sensible.

### 13. Backups y recuperación

**Objetivo:** demostrar que la plataforma puede recuperar datos y
configuraciones.

**Estado (2026-09-30): parcial.** Se generan backups cifrados de PostgreSQL y MikroTik, y las rutas administrativas están limitadas a administradores. Faltan restauración, versionado/comparación y pruebas de recuperación; no existe evidencia de backup de configuración Ubiquiti ni de backup automático previo a cada cambio crítico.

**Alcance:**

- backup automático antes de cambios críticos;
- backup por MikroTik;
- backup de configuración Ubiquiti;
- versionado y comparación;
- restauración desde panel con confirmación;
- validación de compatibilidad;
- auditoría de restauración y motivo;
- copia externa;
- cifrado validado;
- prueba periódica de restauración;
- backup PostgreSQL;
- procedimiento de recuperación ante caída del servidor.

**Dependencias:** almacenamiento privado, auditoría, tareas persistentes y
arquitectura de producción.

**Cuidado:** restaurar es una operación destructiva. Requiere confirmación
explícita, backup previo, bloqueo del equipo y verificación posterior.

**Cierre:** existe una prueba documentada de restauración exitosa, no solo un
archivo generado.

### 14. Arquitectura de producción

**Objetivo:** preparar una operación estable y observable sin romper el modo
actual de desarrollo.

**Estado (2026-09-30): parcial.** Hay cola persistente, health checks y workers iniciales, pero los procesos críticos comparten el API y faltan los controles y pruebas de recuperación descritos abajo.

**Alcance:**

- separar o controlar API, dashboard, worker de tareas, monitoreo, billing,
  WebSocket y PostgreSQL;
- almacenamiento de backups;
- logs centralizados;
- health checks y readiness;
- alertas del backend;
- protección contra sobrecarga;
- migraciones controladas;
- restauración probada;
- recuperación ante caída del servidor;
- límites, timeouts, reintentos y apagado ordenado.

**Dependencias:** todas las secciones funcionales anteriores, especialmente
permisos, auditoría y backups.

**Cuidado:** no cambiar el despliegue, separar procesos ni migrar servicios
sin medir primero los workers actuales y documentar el impacto.

**Cierre:** cada proceso tiene responsabilidad, health check, logs, límites y
procedimiento de recuperación.

## Plantilla de trabajo por tarea

Cada agente debe dejar un informe con esta estructura:

```text
## Tarea completada
<sección y pendiente exacto>

## Cambios
- API:
- Base de datos:
- Dashboard:
- Workers/integraciones:
- Auditoría:

## Verificación
- typecheck:
- build:
- pruebas manuales:
- escenarios de error:

## Pendientes no tocados
- <sección siguiente>

## Bloqueos o decisiones
- <solo si aplica>
```

Si no puede cumplir los criterios de cierre, no marcar la sección como
implementada. Debe dejar una instrucción actualizada para el siguiente agente
con el bloqueo, los archivos relevantes y el próximo paso seguro.