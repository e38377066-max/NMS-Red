# Instrucción para agente AI: contrato formal del cliente

## Objetivo

Completar únicamente el primer pendiente real de `pendientes-isp-administrativo.md`:

- almacenar el contrato o documento del cliente como archivo;
- aprobar o rechazar el documento desde la ficha del cliente;
- versionar los documentos sin perder el historial;
- dejar cada decisión registrada en auditoría.

No implementar en esta tarea facturación, comprobantes de pago, SLA, inventario, multisede ni otros pendientes del documento. Al terminar este alcance, detenerse y reportar los pendientes siguientes.

## Contexto actual

La aplicación es un monorepo pnpm con:

- API Express en `artifacts/api-server/`;
- dashboard React/Vite en `artifacts/nms-dashboard/`;
- PostgreSQL con Drizzle en `lib/db/`;
- contrato OpenAPI en `lib/api-spec/openapi.yaml`;
- historial administrativo existente en `client_change_history`;
- clientes con `contractReference` y `contractNotes`, pero sin archivo contractual;
- almacenamiento privado existente en `artifacts/api-server/src/services/object-storage.service.ts`, compatible con `s3` y `filesystem`.

Archivos iniciales que se deben leer:

- `pendientes-isp-administrativo.md`;
- `replit.md`;
- `.local/skills/object-storage/SKILL.md`;
- `.local/skills/pnpm-workspace/SKILL.md`;
- `lib/db/src/schema/clients.ts`;
- `lib/db/src/schema/operations.ts`;
- `artifacts/api-server/src/routes/clients.ts`;
- `artifacts/api-server/src/services/object-storage.service.ts`;
- `artifacts/nms-dashboard/src/pages/client-detail.tsx`.

## Restricciones

1. Mantener la arquitectura y las convenciones actuales; no migrar el proyecto a otro stack.
2. No guardar bytes, base64 ni contenido binario dentro de PostgreSQL. Guardar únicamente metadata y la ruta privada del objeto.
3. No exponer públicamente contratos de clientes. Toda descarga debe comprobar sesión administrativa y permisos sobre el cliente.
4. No sobrescribir un contrato aprobado. Cada reemplazo debe crear una nueva versión.
5. Un cliente puede tener como máximo un documento aprobado vigente.
6. Un documento pendiente rechazado no debe convertirse en vigente.
7. No reutilizar el estado del contrato para representar el pago ni el estado de red.
8. No pedir ni escribir secretos en el repositorio. Si el almacenamiento necesita configuración, usar las variables documentadas por el proyecto.
9. Antes de modificar el API, actualizar `lib/api-spec/openapi.yaml` y ejecutar:

   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```

10. Antes de finalizar ejecutar:

   ```bash
   pnpm run typecheck
   pnpm --filter @workspace/api-server run build
   ```

## Diseño recomendado

### Tabla de documentos contractuales

Crear una tabla Drizzle dedicada, por ejemplo `client_contract_documents`, con al menos:

- `id`;
- `clientId` con borrado en cascada;
- `version` entero;
- `status`: `PENDING`, `APPROVED` o `REJECTED`;
- `objectPath` privado;
- `originalFileName`;
- `contentType`;
- `sizeBytes`;
- `sha256`;
- `notes` opcionales;
- `uploadedByUserId`;
- `reviewedByUserId` opcional;
- `reviewedAt` opcional;
- `rejectionReason` opcional;
- `createdAt`.

Aplicar una restricción o validación que impida más de una versión aprobada vigente por cliente. Si PostgreSQL permite un índice único parcial en el estilo usado por el proyecto, preferir esa garantía en base de datos además de validarla en servicio.

### Estados y transiciones

Permitir únicamente estas transiciones:

```text
PENDING -> APPROVED
PENDING -> REJECTED
```

Una nueva carga siempre crea `PENDING`. Para reemplazar un contrato aprobado:

1. crear una versión nueva en `PENDING`;
2. revisar y aprobar la nueva versión;
3. retirar la aprobación anterior en la misma transacción o mediante una operación transaccional equivalente;
4. conservar la versión anterior como historial.

No borrar físicamente el objeto anterior como parte de una sustitución normal.

## Almacenamiento

Leer y seguir `.local/skills/object-storage/SKILL.md` antes de implementar la carga.

El proyecto ya usa `object-storage.service.ts` para almacenamiento privado S3/filesystem. Mantener el proveedor configurado por `BACKUP_STORAGE_PROVIDER`; no cambiarlo silenciosamente a Replit App Storage ni mezclar buckets. Usar una clave separada, por ejemplo:

```text
client-contracts/<clientId>/<uuid>.<extension>
```

Extender el servicio con una operación privada específica para documentos contractuales o reutilizar sus primitivas solo si conserva:

- validación de rutas;
- permisos de lectura;
- restricciones de tamaño;
- `Content-Type`;
- nombres de archivo sin traversal;
- limpieza controlada de objetos huérfanos.

Aceptar únicamente formatos contractuales definidos por producto, inicialmente PDF y, si se justifica, imágenes comunes. Rechazar ejecutables, tipos ambiguos y archivos que superen el límite configurado. Validar extensión y MIME, y calcular SHA-256 del archivo recibido.

## API que debe quedar disponible

Definir primero estas operaciones en OpenAPI y generar los clientes:

- `GET /api/clients/:id/contracts`
  - lista versiones, estado, nombre, tamaño, fecha y usuario;
  - nunca devuelve el objeto binario.
- `POST /api/clients/:id/contracts/upload`
  - recibe el archivo usando el mecanismo de carga elegido según la skill de almacenamiento;
  - crea una versión `PENDING`;
  - devuelve metadata del documento.
- `GET /api/clients/:id/contracts/:documentId/download`
  - valida sesión, cliente y documento;
  - descarga o redirige de forma privada al archivo.
- `POST /api/clients/:id/contracts/:documentId/approve`
  - requiere rol/permisos administrativos;
  - recibe una nota opcional;
  - aplica la transición y garantiza un único aprobado vigente.
- `POST /api/clients/:id/contracts/:documentId/reject`
  - requiere rol/permisos administrativos;
  - exige motivo de rechazo;
  - registra la decisión.

Todos los endpoints deben devolver errores claros para cliente inexistente, documento inexistente, MIME no permitido, tamaño excedido, transición inválida y falta de permisos.

## Auditoría e historial

Cada carga, aprobación y rechazo debe registrar:

- usuario y rol;
- cliente afectado;
- documento y versión;
- acción;
- motivo o comentario;
- resultado;
- fecha;
- error completo si falla.

Usar las convenciones de auditoría existentes. No confiar únicamente en el historial de cambios del expediente: la decisión documental debe quedar en auditoría y en la propia fila del documento.

## Cambios de dashboard

En `artifacts/nms-dashboard/src/pages/client-detail.tsx` añadir una sección “Documentos del contrato” que permita:

- ver todas las versiones;
- distinguir `Pendiente`, `Aprobado` y `Rechazado`;
- subir un nuevo documento;
- descargar documentos autorizados;
- aprobar una versión pendiente;
- rechazarla con motivo obligatorio;
- mostrar quién y cuándo tomó la decisión;
- actualizar la lista después de cada mutación y después de recargar la ficha.

No eliminar ni cambiar el formulario existente de `contractReference` y `contractNotes`; esos campos siguen siendo metadata administrativa.

## Criterios de aceptación

- Un administrador puede cargar un PDF válido desde la ficha de un cliente.
- La carga crea una versión `PENDING` y el archivo queda en almacenamiento privado.
- Un usuario no autenticado o sin permiso no puede listar ni descargar contratos.
- El administrador puede aprobar o rechazar desde la ficha.
- Rechazar exige motivo y deja trazabilidad.
- Aprobar una nueva versión conserva la anterior y no deja dos aprobadas vigentes.
- Una descarga devuelve el archivo correcto y no revela la ruta interna del almacenamiento.
- El flujo funciona tras navegación, recarga y nueva sesión.
- Las operaciones dejan auditoría.
- `pnpm run typecheck` y el build de la API pasan.
- El documento `pendientes-isp-administrativo.md` se actualiza solo para marcar este alcance como completado; no marcar los pendientes posteriores.

## Entrega del agente

Reportar:

1. archivos modificados;
2. endpoints y estados implementados;
3. formato y límite de archivos;
4. proveedor de almacenamiento utilizado, sin revelar credenciales;
5. verificaciones ejecutadas;
6. riesgos o decisiones que requieran confirmación humana.