# Pendientes del ISP administrativo

## Contexto operativo

- **MikroTik central:** es la autoridad para clientes, DHCP, Simple Queues, límites de velocidad, cortes, reconexiones y address-lists.
- **Ubiquiti LiteAP / SXT:** se usa para distribución inalámbrica, enlaces, radios, señal, CCQ y clientes asociados.
- **Regla importante:** Ubiquiti no debe administrar cobros, cortes ni velocidades de clientes. Esas operaciones deben ejecutarse en el MikroTik central.

Este documento separa lo que ya tiene una base funcional de lo que todavía falta cerrar para una operación administrativa real. No incluye la conexión física entre sedes, WireGuard, CGNAT ni rutas externas.

## Ya implementado

- API Express y dashboard React.
- Autenticación con sesiones JWT.
- Bloqueo temporal por intentos fallidos.
- Creación segura del primer administrador mediante variables explícitas.
- Gestión de usuarios.
- Gestión de equipos MikroTik, Ubiquiti y Proxmox.
- Gestión básica de clientes.
- Validación para asociar clientes al Router central MikroTik.
- Alta idempotente por MAC/IP.
- Aprovisionamiento transaccional en MikroTik: lease DHCP estático, Simple Queue, límites, address-list, verificación y rollback.
- Cortes y reconexiones verificadas mediante la cola persistente: límite temporal, `Clientes_Cortados`, `Clientes_Activos` y comprobación posterior.
- Historial básico del ciclo de vida del cliente.
- Planes, pagos, vencimientos y recibos HTML.
- Facturas, numeración consecutiva, pagos parciales, saldos, descuentos, recargos y métodos de pago.
- Reporte diario de ingresos y cierre diario de caja.
- Suspensión y reactivación automática de facturación.
- Portal básico con token independiente.
- Portal web del cliente con acceso por token, estado del servicio, saldo real de facturas, pagos y recibos descargables, avisos, tickets y solicitudes operativas.
- Tickets y comentarios.
- Órdenes de campo.
- Inventario básico.
- Alertas operativas con deduplicación.
- Métricas históricas iniciales.
- Auditoría.
- Backups de PostgreSQL y MikroTik.
- Cifrado de credenciales almacenadas.
- Reconciliación CRM–MikroTik con detección de diferencias, corrección aprobada y verificación posterior.
- Configuración de firewall y address-lists MikroTik.
- Worker de monitoreo.
- Worker de facturación.
- Cola persistente de tareas con reintentos, timeout y bloqueo por equipo.
- Organizaciones y sedes como base de multisede.
- Avisos de mantenimiento persistentes.
- Expediente administrativo del cliente: referencia y notas de contrato, fecha y dirección de instalación, técnico responsable, AP/enlace asociado e historial de cambios con usuario, motivo y valores anterior/nuevo.
- Contratos formales privados versionados: carga de PDF, hash, aprobación/rechazo, documento vigente, descarga protegida y auditoría.

## Pendientes reales

## 1. Alta completa de clientes — completada

La creación básica, el aprovisionamiento de red, el expediente administrativo base y el archivo formal del contrato ya están implementados:

- Los contratos se almacenan fuera de PostgreSQL mediante el proveedor privado configurado (`filesystem` o `s3`).
- Cada carga crea una versión inmutable con nombre original, MIME, tamaño, hash SHA-256, ruta privada y usuario de carga.
- Las versiones pasan por `PENDING`, `APPROVED` o `REJECTED`; el rechazo exige motivo.
- Solo puede existir un contrato vigente aprobado por cliente; una nueva aprobación sustituye lógicamente a la anterior sin borrar el historial.
- Las descargas requieren autenticación y pertenencia al cliente indicado en la ruta.
- La ficha del cliente permite cargar, descargar y revisar documentos cuando el usuario es administrador.
- Las cargas, aprobaciones y rechazos quedan en auditoría con motivo, usuario, IP, dispositivo y estados anterior/nuevo.

Guía general para avanzar todos los pendientes: `instrucciones-agente/00-guia-general-pendientes.md`.

## 2. Facturación administrativa completa

La sección está completada sobre la emisión básica, el cobro y el cierre diario:

- Prorrateo por alta, traslado o cambio de plan con vista previa, crédito y factura proporcional.
- Historial de deuda por cliente con facturas, pagos, saldo actual y eventos ordenados.
- Comprobante de pago como archivo privado con límite de tamaño, hash y metadatos.
- Aprobación o rechazo administrativo del comprobante, con aplicación idempotente del pago.
- Reenvío formal de comprobantes rechazados desde el portal, conservando el historial.
- Avisos antes del vencimiento y reglas configurables de gracia y suspensión automática.
- Reporte de morosidad por antigüedad, cliente y factura.
- Exportación contable CSV de pagos por período, con auditoría.

## 3. Portal del cliente

La interfaz web y el backend base ya están conectados:

- Pantalla real para iniciar sesión con el token.
- Ver el plan actual, la velocidad contratada, el vencimiento y el estado del servicio.
- Ver el saldo real de facturas, no solo el estado de pago del cliente.
- Ver el historial de pagos y descargar recibos desde el portal.
- Consultar y crear tickets desde el portal.
- Ver avisos de mantenimiento.
- Solicitar cambio de plan, traslado y reconexión.
- Confirmar el cierre de un ticket atendido.
- Ver el router central y el AP/enlace asociado cuando están registrados.
- Enviar comprobantes privados, consultar su estado y reenviar formalmente los rechazados.
- Ver solicitudes como pendientes de revisión con su número de ticket.
- Imprimir o guardar recibos como PDF desde una plantilla mejorada.
- Reabrir un ticket cerrado sólo si soporte habilita el permiso de un solo uso.
- Soporte y tickets: filtros, SLA, historial, asignación, comentarios, avisos y evidencias están implementados; falta montar el volumen persistente de Railway y configurar `TICKET_ATTACHMENT_STORAGE_DIR` para probar adjuntos de extremo a extremo. La carpeta de adjuntos es independiente de los backups.

El flujo formal de comprobantes está conectado con facturación: almacenamiento privado, revisión administrativa, aplicación idempotente del pago y reenvío de rechazados.

## 4. Soporte y tickets

Existe una mesa de ayuda básica con tickets, categorías, prioridad, asignación, comentarios y relaciones con cliente/equipo. Falta:

- SLA de primera respuesta.
- SLA de resolución.
- Evidencias adjuntas.
- Fotografías.
- Historial de estados.
- Confirmación del cliente al cerrar.
- Reapertura de tickets.
- Reporte de tickets vencidos.
- Notificaciones al cliente y al técnico.

## 5. Operación de campo

Existen órdenes de campo con tipo, asignación, cliente, dirección, coordenadas, materiales, potencia medida y firma. La agenda permite asignar personal, fijar/reprogramar inicio y fin, y registrar bloques de disponibilidad por fecha y hora. Se rechazan solapamientos y se exige que el horario de una orden asignada quede dentro de un bloque disponible. La orden captura señal del enlace en dBm, CCQ y equipo/serie instalado como datos de la visita, sin generar movimientos de inventario. Al completar una orden, esta pasa al historial consultable; cada orden finalizada representa una visita. Se usan las cuentas existentes como personal asignable; no se añadió un rol de técnico independiente.

Falta:

- Fotos antes y después.
- Acta de instalación.
- Reubicación del cliente.
- Cambio de AP o SXT.
- Aplicación móvil para técnicos.

## 6. Inventario

Existe un inventario básico. Falta:

- Entradas de almacén.
- Salidas de almacén.
- Transferencias entre sedes.
- Número de serie único.
- MAC única.
- Estado de reparación.
- Historial de movimientos.
- Inventario de radios Ubiquiti.
- Inventario de antenas.
- Inventario de fuentes PoE.
- Inventario de cables y conectores.

## 7. Monitoreo de MikroTik y Ubiquiti

Existe monitoreo y métricas iniciales. Falta guardar y mostrar de forma completa:

### MikroTik

- CPU.
- Memoria.
- Temperatura.
- Interfaces.
- Tráfico por interfaz.
- Pérdida de paquetes.
- Latencia.
- Estado de DHCP.
- Estado de colas.
- Clientes desconectados repetidamente.
- Estado de backups.
- Versión de RouterOS.
- Estado de certificados.

### Ubiquiti y SXT

- Capacidad del enlace.
- Frecuencia.
- Canal.
- Ancho de canal.
- Reintentos.
- Estado del radio.
- Versión de firmware.
- Temperatura.
- Saturación.
- Disponibilidad del enlace PTP.

## 8. Alertas reales

Existe deduplicación básica de incidentes. Falta:

- Equipo MikroTik caído.
- LiteAP caído.
- SXT caído.
- Enlace degradado.
- Señal baja.
- CCQ bajo.
- Ruido alto.
- CPU alta.
- Memoria alta.
- Temperatura alta.
- Interfaz saturada.
- Pérdida de paquetes.
- Latencia alta.
- Cliente desconectándose repetidamente.
- Backup fallido.
- Certificado por vencer.
- Escalamiento.
- Notificación por Telegram.
- Notificación por correo.

## 9. Descubrimiento e inventario de red

Todavía falta:

- Descubrir equipos por subred.
- Detectar MikroTik.
- Detectar Ubiquiti.
- Importar equipos encontrados.
- Identificar modelo.
- Identificar firmware.
- Detectar duplicados.
- Registrar interfaces.
- Registrar radios.
- Registrar licencias.
- Registrar cambios de IP.
- Detectar equipos reemplazados.
- Comparar inventario físico contra inventario del sistema.

## 10. Usuarios y permisos

Hay usuarios y roles básicos, pero falta control administrativo detallado:

- Superadministrador.
- Administrador de red.
- Facturación.
- Soporte.
- Técnico de campo.
- Solo lectura.
- Auditor.
- Administrador por sede.
- Permisos por módulo.
- Permisos por acción.
- Permisos por equipo.
- Permisos por cliente.
- Permisos por organización.
- Permisos por sede.
- MFA para administradores.
- Revocación de todas las sesiones.
- Historial de sesiones.
- Restricción por IP.
- Rotación de credenciales.

## 11. Multiempresa y multisede

La base de organizaciones y sedes existe, pero falta aplicar aislamiento real:

- Cada organización debe ver solo sus clientes.
- Cada organización debe ver solo sus equipos.
- Cada organización debe tener sus planes.
- Cada organización debe tener sus pagos.
- Cada sede debe tener sus técnicos.
- Cada sede debe tener sus MikroTik.
- Cada sede debe tener sus Ubiquiti.
- Permisos por sede.
- Configuración independiente por organización.
- Límites por organización.
- Reportes separados.
- Facturación separada.
- Auditoría separada.

## 12. Auditoría completa

Existe auditoría, pero falta garantizar que todas las acciones registren:

- Usuario.
- Rol.
- IP de origen.
- Dispositivo utilizado.
- Cliente afectado.
- MikroTik afectado.
- Ubiquiti afectado.
- Configuración anterior.
- Configuración nueva.
- Comando ejecutado.
- Resultado real del equipo.
- Motivo del cambio.
- Confirmación adicional.
- Fecha.
- Duración.
- Error completo.
- Identificador de tarea.
- Reintentos realizados.

## 13. Backups y recuperación

Existe generación de backups, pero falta completar el ciclo de producción:

- Backup automático antes de cada cambio crítico.
- Backup por MikroTik.
- Backup de configuración Ubiquiti.
- Versionado.
- Comparación entre versiones.
- Restauración desde el panel.
- Confirmación antes de restaurar.
- Validación de compatibilidad.
- Registro de quién restauró.
- Motivo de restauración.
- Copia externa.
- Cifrado validado.
- Prueba periódica de restauración.
- Backup de PostgreSQL.
- Procedimiento de recuperación ante caída del servidor.

## 14. Arquitectura de producción

Actualmente varios workers viven dentro del mismo proceso. Para producción falta separar o controlar:

- API.
- Dashboard.
- Worker de tareas MikroTik.
- Worker de monitoreo Ubiquiti.
- Worker de facturación.
- WebSocket.
- PostgreSQL.
- Almacenamiento de backups.
- Logs centralizados.
- Health checks.
- Alertas del backend.
- Protección contra sobrecarga.
- Migraciones controladas.
- Restauración probada.
- Recuperación ante caída del servidor.

## Prioridad recomendada

1. Aprovisionamiento completo de clientes en el MikroTik central.
2. Cortes y reconexiones verificadas.
3. Reconciliación completa.
4. Facturación completa.
5. Portal del cliente terminado.
6. Tickets y soporte.
7. Inventario y operación de campo.
8. Monitoreo específico de MikroTik y Ubiquiti.
9. Alertas y notificaciones.
10. Permisos y multisede.
11. Backups y restauración probada.
12. Descubrimiento automático de equipos.

## Resumen

Lo más importante que falta cerrar es este flujo:

**Cliente → plan → pago → MikroTik central → DHCP → Simple Queue → address-list → AP/SXT → monitoreo → auditoría.**

La parte administrativa no estará completa hasta que ese flujo sea idempotente, verificable, auditable y recuperable cuando falle cualquier paso.