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
- Historial básico del ciclo de vida del cliente.
- Planes, pagos, vencimientos y recibos HTML.
- Suspensión y reactivación automática de facturación.
- Portal básico con token independiente.
- Tickets y comentarios.
- Órdenes de campo.
- Inventario básico.
- Alertas operativas con deduplicación.
- Métricas históricas iniciales.
- Auditoría.
- Backups de PostgreSQL y MikroTik.
- Cifrado de credenciales almacenadas.
- Reconciliación CRM–MikroTik inicial.
- Configuración de firewall y address-lists MikroTik.
- Worker de monitoreo.
- Worker de facturación.
- Cola persistente de tareas con reintentos, timeout y bloqueo por equipo.
- Organizaciones y sedes como base de multisede.
- Avisos de mantenimiento persistentes.

## Pendientes reales

## 1. Alta completa de clientes

La creación básica existe, pero falta completar el proceso administrativo:

- Prospecto.
- Instalación pendiente.
- Cliente activo.
- Cliente suspendido.
- Cliente trasladado.
- Cliente cancelado.
- Reactivación.
- Contrato o documento del cliente.
- Fecha de instalación.
- Técnico responsable.
- Equipo instalado.
- AP, LiteAP o SXT asociado.
- Plan contratado.
- Historial completo de cambios.
- Validación de MAC, IP, DHCP y cola antes de activar al cliente.

## 2. Aprovisionamiento completo en MikroTik

Actualmente hay operaciones separadas y una cola de tareas. Falta una operación única y transaccional de alta:

1. Validar que la MAC no exista.
2. Validar que la IP no esté ocupada.
3. Crear o actualizar el lease DHCP estático.
4. Crear o actualizar la Simple Queue.
5. Aplicar velocidad de subida y bajada.
6. Crear la address-list correspondiente.
7. Registrar el comentario con la identidad estable del cliente.
8. Asociar el cliente con el AP o SXT donde está conectado.
9. Leer nuevamente el estado real del MikroTik.
10. Confirmar que todos los pasos quedaron aplicados.
11. Revertir los pasos anteriores si uno falla.

## 3. Cortes y reconexiones

La base existe, pero falta cerrar el flujo completo:

- Suspender por falta de pago.
- Aplicar límite temporal en la cola.
- Agregar la IP a la lista de suspendidos.
- Mostrar el portal de suspensión.
- Confirmar que el MikroTik aplicó el cambio.
- Registrar el resultado real.
- Reactivar después del pago.
- Restaurar la velocidad anterior.
- Quitar la address-list de suspensión.
- Confirmar que el cliente volvió a operar.
- Evitar cortes duplicados.
- Evitar reactivaciones duplicadas.

## 4. Reconciliación completa con MikroTik

La reconciliación actual es parcial. Falta comparar y corregir:

- Clientes del CRM que no existen en MikroTik.
- Colas del MikroTik sin cliente en el CRM.
- IPs duplicadas.
- MACs modificadas.
- Clientes sin DHCP estático.
- Velocidades diferentes.
- Colas con nombres o comentarios incorrectos.
- Address-lists incorrectas.
- Clientes suspendidos en el CRM pero activos en MikroTik.
- Clientes activos en el CRM pero suspendidos en MikroTik.
- Equipos eliminados o reemplazados.
- Cambios de IP.
- Corrección aprobada desde la interfaz.
- Verificación posterior a la corrección.

## 5. Facturación administrativa completa

Ya existen planes, pagos, vencimientos, recibos y suspensión automática. Falta:

- Facturas mensuales.
- Numeración fiscal o consecutiva configurable.
- Pagos parciales.
- Saldos pendientes.
- Descuentos.
- Recargos.
- Prorrateo.
- Historial de deuda.
- Métodos de pago configurables.
- Pagos en efectivo.
- Pagos por transferencia.
- Pagos móviles.
- Comprobante de pago como archivo.
- Aprobación o rechazo del comprobante.
- Avisos antes del vencimiento.
- Reglas configurables de suspensión.
- Reactivación automática después de confirmar el pago.
- Reporte diario de ingresos.
- Reporte de morosidad.
- Exportación contable.
- Cierre diario de caja.

## 6. Portal del cliente

El backend tiene una base, pero falta completar el flujo de usuario:

- Pantalla real para iniciar sesión con el token.
- Ver el plan actual.
- Ver la velocidad contratada.
- Ver el saldo pendiente.
- Ver el vencimiento.
- Ver el historial de pagos.
- Descargar recibos.
- Subir comprobantes.
- Consultar tickets.
- Crear tickets.
- Ver avisos de mantenimiento.
- Solicitar cambio de plan.
- Solicitar traslado.
- Solicitar reconexión.
- Confirmar el cierre de un ticket.
- Ver el AP o enlace asociado.

Actualmente el cambio de plan y el comprobante se registran como tickets, pero falta el flujo formal de aprobación y almacenamiento del archivo.

## 7. Soporte y tickets

Existe una mesa de ayuda básica. Falta:

- Ticket creado desde el portal.
- Ticket creado por operador.
- Categorías completas.
- Prioridad configurable.
- Técnico asignado.
- SLA de primera respuesta.
- SLA de resolución.
- Comentarios internos y públicos.
- Evidencias adjuntas.
- Fotografías.
- Relación con el cliente.
- Relación con el MikroTik.
- Relación con LiteAP, SXT o enlace.
- Causa raíz.
- Historial de estados.
- Confirmación del cliente al cerrar.
- Reapertura de tickets.
- Reporte de tickets vencidos.
- Notificaciones al cliente y al técnico.

## 8. Operación de campo

Existen órdenes de campo básicas. Falta:

- Agenda de técnicos.
- Disponibilidad del técnico.
- Orden de instalación.
- Orden de reparación.
- Orden de traslado.
- Dirección completa.
- Coordenadas GPS.
- Fotos antes y después.
- Potencia medida.
- Señal del enlace.
- CCQ.
- Equipo instalado.
- Número de serie.
- Material utilizado.
- Firma del cliente.
- Acta de instalación.
- Historial de visitas.
- Reubicación del cliente.
- Cambio de AP o SXT.
- Aplicación móvil para técnicos.

## 9. Inventario

Existe un inventario básico. Falta:

- Entradas de almacén.
- Salidas de almacén.
- Transferencias entre sedes.
- Asignación a técnico.
- Asignación a cliente.
- Asignación a instalación.
- Número de serie único.
- MAC única.
- Proveedor.
- Garantía.
- Costo.
- Estado de reparación.
- Equipos instalados.
- Equipos averiados.
- Equipos retirados.
- Historial de movimientos.
- Inventario de radios Ubiquiti.
- Inventario de antenas.
- Inventario de fuentes PoE.
- Inventario de cables y conectores.

## 10. Monitoreo de MikroTik y Ubiquiti

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
- Clientes conectados.
- Clientes desconectados repetidamente.
- Estado de backups.
- Versión de RouterOS.
- Estado de certificados.

### Ubiquiti y SXT

- Señal por cliente.
- CCQ.
- Ruido.
- SNR.
- Capacidad del enlace.
- TX/RX.
- Frecuencia.
- Canal.
- Ancho de canal.
- Clientes asociados.
- Desconexiones.
- Reintentos.
- Estado del radio.
- Versión de firmware.
- Temperatura.
- Saturación.
- Disponibilidad del enlace PTP.

## 11. Alertas reales

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
- Silenciamiento temporal.
- Mantenimiento programado.
- Escalamiento.
- Notificación por Telegram.
- Notificación por correo.
- Historial de incidentes.
- Confirmación y resolución de alertas.

## 12. Descubrimiento e inventario de red

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

## 13. Usuarios y permisos

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

## 14. Multiempresa y multisede

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

## 15. Auditoría completa

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

## 16. Backups y recuperación

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

## 17. Arquitectura de producción

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