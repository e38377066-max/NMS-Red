# ISP Cockpit — NMS Multi-Brand Platform

Plataforma de gestión de red (NMS) para ISPs con soporte multi-marca: MikroTik RouterOS, Ubiquiti AirOS/AirMAX y Proxmox VE. Interfaz en español con monitoreo en tiempo real.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (puerto 8080)
- `pnpm --filter @workspace/nms-dashboard run dev` — Dashboard React (puerto variable)
- `pnpm run typecheck` — typecheck completo en todos los paquetes
- `pnpm run build` — typecheck + build todos los paquetes
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks y schemas Zod desde el spec OpenAPI
- `pnpm --filter @workspace/db run push` — push del schema DB (solo dev)
- Env requerido: `DATABASE_URL` — conexión Postgres

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
- **Proxmox**: usa HTTPS nativo con `rejectUnauthorized: false` para certs auto-firmados de red local. Auth via ticket (PVEAuthCookie + CSRFPreventionToken)
- **Ubiquiti**: intenta HTTP primero (login.cgi → status.cgi / sta.cgi), fallback SSH con wstalist. Requiere algoritmos SSH legacy para equipos AirOS M-series

## Product

- **Dashboard** en tiempo real con WebSocket: nodos, equipos online/offline, alertas, actividad
- **Topología visual**: mapa de la red por capas con roles estrictos (Gateway → Enlace PTP → AP)
- **Equipos multi-marca**: formulario con selector de protocolo (MikroTik RouterOS / Ubiquiti AirOS) y rol funcional
- **Detalle de equipo**: estado en vivo + tabla de registro inalámbrico con señal dBm (Ubiquiti wstalist o MikroTik /wireless/registration-table)
- **Proxmox VE**: salud del servidor (CPU/RAM/disco), lista de VMs, start/stop, snapshots, ajuste CPU/RAM
- **Clientes**: gestión con cambio de velocidad (dry-run) aplicado via MikroTik CHR Simple Queues
- **IA contextual**: conoce la jerarquía completa (Proxmox → CHR → PTP Ubiquiti → AP → Cliente)
- **Audit log + RBAC**: cada acción registrada con usuario, comando, resultado
- **Monitoreo automático**: heartbeat cada 60s multi-marca (MikroTik + Ubiquiti + Proxmox)

## User preferences

- Idioma: español en toda la UI y en las respuestas

## Gotchas

- Al añadir dependencias con binarios nativos (ssh2, node-ssh, net-snmp): agregar a `external` en `build.mjs` y a `onlyBuiltDependencies` en `pnpm-workspace.yaml`
- Proxmox API usa HTTPS con cert auto-firmado: usar módulo nativo `https` con `rejectUnauthorized: false`
- Ubiquiti AirOS M-series requiere algoritmos SSH legacy para compatibilidad
- El CHR MikroTik gestiona todas las Simple Queues; las IPs de clientes deben coincidir con las MACs en las colas

## Pointers

- Ver skill `pnpm-workspace` para estructura de workspace, TypeScript y detalles de paquetes
- Credenciales demo: admin/admin123 y operador1/op123
