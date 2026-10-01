# Ejecutar ISP Cockpit en Windows dentro de la LAN

La interfaz React y la API Express se compilan y arrancan juntas en el puerto
5000. La aplicación se conecta directamente desde esta PC a las direcciones
privadas de los equipos de la red.

## Requisitos

- Windows 10/11 de 64 bits.
- Node.js 22.18 o superior.
- Git for Windows.
- PostgreSQL instalado y ejecutándose. Esta guía funciona con PostgreSQL 18.
- pnpm 10.26.1 para dependencias. Puedes usar npm para ejecutar los comandos del
  proyecto; el workspace requiere pnpm para instalar sus paquetes `catalog:` y
  `workspace:`.

Instala pnpm una sola vez desde PowerShell:

```powershell
npm install --global pnpm@10.26.1
```

## Primera instalación

Clona desde el repositorio privado o público de GitHub y entra en la carpeta:

```powershell
git clone <URL_DEL_REPOSITORIO>
cd <CARPETA_DEL_REPOSITORIO>
npm run local:setup
```

`local:setup` crea `.env.local`, genera un secreto de sesión y una contraseña
inicial de administrador, instala dependencias usando el lockfile y crea las
carpetas locales para copias y adjuntos. La contraseña inicial se muestra una
sola vez en esa consola; guárdala.

### Crear la base local

En pgAdmin, crea un usuario PostgreSQL para la aplicación y una base llamada
`isp_cockpit`, propiedad de ese usuario. También puedes usar un usuario local
que ya tengas. No reutilices una base que contenga datos que quieras conservar.

Edita `.env.local` y cambia `DATABASE_URL`, por ejemplo:

```text
DATABASE_URL=postgresql://isp_cockpit_app:TU_CLAVE@127.0.0.1:5432/isp_cockpit
```

Si la contraseña tiene caracteres reservados en una URL (`@`, `#`, `%`, `/` o
`:`), codifícalos como URL. No compartas ni subas `.env.local`.

### Conexión al MikroTik en la LAN

Para el RouterOS probado en esta instalación, la API REST responde por HTTP en
el puerto 80; la negociación TLS en el puerto 443 falla. La plantilla local usa:

```text
MIKROTIK_API_SCHEME=http
MIKROTIK_API_PORT=80
```

HTTP no cifra la autenticación Basic: usa esta opción solo en una LAN privada y
confiable. No conectes la app a una Wi-Fi pública o de invitados, y no reenvíes
el puerto 80 del MikroTik a Internet. Esto no requiere cambiar la configuración
del router. Si ya existe `.env.local`, edita ahí esos valores; `local:setup`
conserva el archivo existente.

Inicializa el esquema únicamente en esa base nueva y vacía:

```powershell
npm run local:db:init
```

El comando verifica que la base no tenga tablas y pide escribir `INIT` antes de
crear el esquema. Luego compila y ejecuta:

```powershell
npm run local:start
```

Abre `http://127.0.0.1:5000` en esa PC. Desde otro equipo de la LAN, usa
`http://IP_LOCAL_DE_LA_PC:5000`. Para que otros equipos entren, permite TCP 5000
solo en el perfil **Privado** de Windows Defender Firewall. No crees una regla
para el perfil Público ni un reenvío de ese puerto en el MikroTik.

Si necesitas la regla desde PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "ISP Cockpit LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Private
```

Inicia sesión con el usuario `admin` y la contraseña que mostró la instalación.
Después del primer acceso, elimina `INITIAL_ADMIN_USERNAME` y
`INITIAL_ADMIN_PASSWORD` de `.env.local`.

La base local comienza vacía: este proceso no copia automáticamente clientes,
equipos ni otros datos de otra instalación.

## Actualizaciones desde GitHub

Con la copia clonada, desde la carpeta del proyecto:

```powershell
npm run local:update
npm run local:start
```

`local:update` exige que no haya cambios en archivos versionados, hace
`git pull --ff-only`, instala las versiones fijadas por `pnpm-lock.yaml` y
comprueba el build. No modifica el esquema de la base automáticamente.

Si informa que cambiaron archivos bajo `lib/db/src/schema/`, haz primero una
copia de seguridad y aplica los cambios de esquema con:

```powershell
npm run local:db:push
```

Ese comando crea una copia `.dump` en `data/backups/`, pide confirmación y
permite revisar la propuesta de Drizzle antes de aplicarla.

## Notas operativas

- Mantén la PC encendida y conectada por cable. Reserva su IP en DHCP para
  acceder a la interfaz desde otros equipos.
- La app y PostgreSQL quedan en esa PC; si está apagada, la app no estará
  disponible.
- Asegúrate de que `pg_dump` esté en el `PATH` de Windows para que las copias
  previas a cambios de esquema funcionen. Suele estar en
  `C:\Program Files\PostgreSQL\18\bin`.
- Los archivos locales, secretos, copias y adjuntos quedan ignorados por Git.
- No abras REST, SSH ni Winbox del MikroTik hacia Internet. La app debe llegar al
  router por la LAN y por los permisos que ya tenga configurados.