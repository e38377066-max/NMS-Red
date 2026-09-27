# ISP Cockpit — CMS de red MikroTik + Ubiquiti

Plataforma de gestión de red para ISPs. El MikroTik hEX es el router central que administra clientes, velocidades, cortes, reconexiones, DHCP y colas; los equipos Ubiquiti LiteAP y MikroTik SXT 5 ax se administran como distribución inalámbrica. Interfaz en español con monitoreo en tiempo real.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (puerto 8080)
- `pnpm --filter @workspace/nms-dashboard run dev` — Dashboard React (puerto variable)
- `pnpm run typecheck` — typecheck completo en todos los paquetes
- `pnpm run build` — typecheck + build todos los paquetes
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks y schemas Zod desde el spec OpenAPI
- `pnpm --filter @workspace/db run push` — push del schema DB (solo dev)
- Alta administrativa: usar `POST /api/clients/provision` con `equipmentId`, `name`, `mac`, `fixedIp` y `planLimit`; verifica lease DHCP estático, Simple Queue y `Clientes_Activos`, con rollback si falla el alta.
- Facturación administrativa: `GET/POST /api/billing/invoices` crea y consulta facturas; `POST /api/billing/invoices/:id/payments` aplica pagos completos o parciales y actualiza el saldo; `GET /api/billing/reports/daily` resume ingresos por método; `GET/POST /api/billing/cash-closures` consulta y registra cierres diarios.
- Contratos formales: `GET /api/clients/:id/contracts` lista versiones; `POST` recibe un PDF privado con `X-Original-File-Name`; `PATCH /api/clients/:id/contracts/:contractId/review` aprueba o rechaza; `GET .../download` descarga con autenticación.
- Métodos de pago soportados en facturas: `cash`, `transfer`, `mobile` y `other`. Los estados de factura son `OPEN`, `PARTIAL` y `PAID`.
- Env requerido: `DATABASE_URL` — conexión Postgres
- Primer arranque: define `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` (mínimo 8 caracteres) para crear un único administrador en una base vacía; no existe una contraseña por defecto y esas variables se pueden retirar después del primer arranque.
- Configuración de producción externa: copiar `.env.example` y usar un PostgreSQL y un almacenamiento S3-compatible propios; el API no depende de Replit Object Storage. `BACKUP_STORAGE_PROVIDER=filesystem` también funciona para una instalación de un solo servidor.
- `BACKUP_STORAGE_PROVIDER=s3` requiere `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` y `S3_BUCKET`. Para una instalación de un solo servidor se puede usar `filesystem` con `BACKUP_STORAGE_DIR` absoluto.
- En producción `MIKROTIK_API_SCHEME=https` es el valor recomendado; el acceso a las sedes debe resolverse con WireGuard, red privada o un conector propio antes de exponer el API.
- Los contratos reutilizan `BACKUP_STORAGE_PROVIDER` (`filesystem` o `s3`) y nunca se guardan como binarios o base64 en PostgreSQL.
- Topología objetivo: `Router central MikroTik hEX → LiteAP / SXT 5 ax → clientes`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.io (WebSocket real-time)
- DB: PostgreSQL + Drizzle ORM
- Validación: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (desde spec OpenAPI)
- Build: esbuild (CJS bundle) — externos: node-ssh, ssh2, cpu-features, net-snmp
- Frontend: React + Vite + Tailwind + Shadcn UI

## Where things live

- `lib/api-spec/openapi.yaml` — spec OpenAPI (fuente de verdad del contrato API)
- `lib/db/src/schema/` — schemas Drizzle ORM (equipment.ts, proxmoxServers.ts, etc.)
- `lib/api-client-react/src/generated/` — hooks generados por Orval
- `lib/api-zod/src/generated/` — schemas Zod generados
- `artifacts/api-server/src/services/` — mikrotik.service.ts, ubiquiti.service.ts, proxmox.service.ts, monitoring.service.ts, ai.service.ts
- `artifacts/api-server/src/routes/` — rutas Express por entidad
- `artifacts/nms-dashboard/src/pages/` — todas las páginas del dashboard

## Architecture decisions

- **Contrato-first**: el spec OpenAPI define el contrato; codegen genera hooks y schemas automáticamente
- **Multi-marca sin breaking change**: el campo `connectionType` en equipment determina qué servicio usa el backend (MikroTik REST o Ubiquiti SSH/HTTP)
- **SSH/native modules en esbuild**: node-ssh, ssh2, cpu-features y net-snmp deben estar en la lista `external` del build.mjs Y en `onlyBuiltDependencies` del pnpm-workspace.yaml
- **Ubiquiti**: intenta HTTP primero (login.cgi → status.cgi / sta.cgi), fallback SSH con wstalist. Requiere algoritmos SSH legacy para equipos AirOS M-series

## Product

- **Dashboard** en tiempo real con WebSocket: nodos, equipos online/offline, alertas, actividad
- **Topología visual**: mapa de la red por capas con roles estrictos (Gateway → Enlace PTP → AP)
- **Equipos multi-marca**: formulario con selector de protocolo (MikroTik RouterOS / Ubiquiti AirOS) y rol funcional
- **Detalle de equipo**: estado en vivo + tabla de registro inalámbrico con señal dBm (Ubiquiti wstalist o MikroTik /wireless/registration-table)
- **Clientes**: alta y gestión desde el CMS, cambio de velocidad (dry-run), DHCP estático, cobros, cortes y reconexiones aplicados al MikroTik central mediante Simple Queues y address-lists
- **Equipos inalámbricos**: monitoreo y registro inalámbrico de LiteAP, airOS y MikroTik RouterOS
- **IA contextual**: conoce la jerarquía completa (MikroTik central → enlace → LiteAP/SXT → cliente)
- **Audit log + RBAC**: cada acción registrada con usuario, comando, resultado
- **Monitoreo automático**: heartbeat cada 60s multi-marca (MikroTik + Ubiquiti + Proxmox)
- **Operación ISP**: `/operations` centraliza tickets, órdenes de campo, inventario, planes, alertas e informes persistidos en PostgreSQL.
- **Portal de cliente**: el API expone `/api/portal/session` y `/api/portal/tickets` mediante tokens hashados con expiración; un administrador rota el acceso desde `/api/portal/access/:clientId`.
- **Facturación operativa**: pagos numerados, historial, próximo vencimiento y recibo HTML consultable en `/api/payments/:id/receipt`.
- **Ciclo de vida**: altas idempotentes por MAC/IP y eventos de prospecto, instalación, activo, suspensión, traslado, cancelación y reactivación en `client_lifecycle_events`.

## User preferences

- Idioma: español en toda la UI y en las respuestas

## Gotchas

- Al añadir dependencias con binarios nativos (ssh2, node-ssh, net-snmp): agregar a `external` en `build.mjs` y a `onlyBuiltDependencies` en `pnpm-workspace.yaml`
- Proxmox API usa HTTPS con cert auto-firmado: usar módulo nativo `https` con `rejectUnauthorized: false`
- Ubiquiti AirOS M-series requiere algoritmos SSH legacy para compatibilidad
- El CHR MikroTik gestiona todas las Simple Queues; las IPs de clientes deben coincidir con las MACs en las colas
- La conectividad hacia la red local (WireGuard, agente, CGNAT y rutas entre sedes) no está inventada en el código: debe configurarse en la infraestructura externa antes de habilitar operaciones sobre equipos.

## Pointers

- Ver skill `pnpm-workspace` para estructura de workspace, TypeScript y detalles de paquetes
- Credenciales demo: admin/admin123 y operador1/op123
