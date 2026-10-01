import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const localEnvPath = path.join(root, ".env.local");

if (existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    throw new Error(
      `Se requiere Node.js 22.18 o superior; tienes ${process.versions.node}. Actualiza Node.js y vuelve a intentarlo.`
    );
  }
}

function run(command, args, { capture = false, env = process.env } = {}) {
  const executable =
    isWindows && command === "pnpm" ? "pnpm.cmd" : isWindows && ["git", "pg_dump"].includes(command) ? `${command}.exe` : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    encoding: "utf8",
    shell: isWindows && command === "pnpm",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (capture) {
    return {
      status: result.error ? 1 : result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.error?.message ?? result.stderr ?? "",
    };
  }

  if (result.error) {
    throw new Error(`No se pudo ejecutar ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} terminó con código ${result.status ?? 1}.`);
  }

  return { status: 0, stdout: "", stderr: "" };
}

function runPnpm(args, options = {}) {
  const env = { ...(options.env ?? process.env) };
  for (const key of Object.keys(env)) {
    if (["npm_config_user_agent", "npm_execpath"].includes(key.toLowerCase())) {
      delete env[key];
    }
  }
  return run("pnpm", args, { ...options, env });
}

function checkPnpmVersion() {
  const result = runPnpm(["--version"], { capture: true });
  if (result.status !== 0) {
    throw new Error(
      "No encuentro pnpm. Instálalo una vez con: npm install --global pnpm@10.26.1"
    );
  }
  const installed = result.stdout.trim();
  if (installed !== "10.26.1") {
    console.warn(`Este proyecto fija pnpm 10.26.1; se encontró ${installed}.`);
  }
}

function gitOutput(args) {
  const result = run("git", args, { capture: true });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "No se pudo ejecutar Git.");
  }
  return result.stdout.trim();
}

function assertLocalConfig() {
  const envPath = localEnvPath;
  if (!existsSync(envPath)) {
    throw new Error("Falta .env.local. Ejecuta primero: npm run local:setup");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /CHANGE_ME|replace-with|example\.com/i.test(databaseUrl)) {
    throw new Error(
      "Configura DATABASE_URL en .env.local con la base PostgreSQL local antes de continuar."
    );
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida de PostgreSQL.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(host)
  ) {
    throw new Error(
      "Por seguridad, la instalación local solo admite PostgreSQL en esta PC (localhost o 127.0.0.1)."
    );
  }
}

function createLocalConfig() {
  const envPath = path.join(root, ".env.local");
  const backups = path.join(root, "data", "backups");
  const attachments = path.join(root, "data", "ticket-attachments");

  mkdirSync(backups, { recursive: true });
  mkdirSync(attachments, { recursive: true });

  if (existsSync(envPath)) {
    console.log(".env.local ya existe; se conserva sin cambios.");
    return;
  }

  const templatePath = path.join(root, ".env.local.example");
  if (!existsSync(templatePath)) {
    throw new Error("No se encontró .env.local.example.");
  }

  const adminPassword = randomBytes(24).toString("base64url");
  const sessionSecret = randomBytes(48).toString("hex");
  const contents = readFileSync(templatePath, "utf8")
    .replaceAll("__INITIAL_ADMIN_PASSWORD__", adminPassword)
    .replaceAll("__SESSION_SECRET__", sessionSecret)
    .replaceAll(
      "__BACKUP_STORAGE_DIR__",
      path.join(root, "data", "backups").replaceAll("\\", "/")
    )
    .replaceAll(
      "__TICKET_ATTACHMENT_STORAGE_DIR__",
      path.join(root, "data", "ticket-attachments").replaceAll("\\", "/")
    );

  writeFileSync(envPath, contents, { flag: "wx", mode: 0o600 });
  console.log(".env.local creado con secretos aleatorios para esta PC.");
  console.log(`Usuario administrador inicial: admin`);
  console.log(`Contraseña inicial (guárdala ahora): ${adminPassword}`);
  console.log("Después de iniciar sesión por primera vez, elimina INITIAL_ADMIN_USERNAME y INITIAL_ADMIN_PASSWORD de .env.local.");
}

function setup() {
  assertNodeVersion();
  checkPnpmVersion();
  createLocalConfig();

  console.log("\nInstalando dependencias desde pnpm-lock.yaml...");
  runPnpm(["install", "--frozen-lockfile"]);

  const pgDump = run("pg_dump", ["--version"], { capture: true });
  if (pgDump.status === 0) {
    console.log(`Herramientas PostgreSQL encontradas: ${pgDump.stdout.trim()}`);
  } else {
    console.warn(
      "Aviso: no encuentro pg_dump en PATH. La app puede iniciar, pero agrega la carpeta bin de PostgreSQL al PATH para habilitar copias de seguridad."
    );
  }

  console.log("\nSiguiente: configura DATABASE_URL en .env.local y crea una base vacía llamada isp_cockpit.");
  console.log("Luego ejecuta: npm run local:db:init");
}

function launchServer(nodeEnv) {
  const env = {
    ...process.env,
    NODE_ENV: nodeEnv,
    PORT: process.env.PORT || "5000",
  };
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`No se pudo iniciar el servidor: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

function findTestFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [fullPath] : [];
  });
}

function updateFromGitHub() {
  assertNodeVersion();
  checkPnpmVersion();
  const dirty = gitOutput(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) {
    throw new Error(
      "Hay cambios locales en archivos versionados. Guárdalos o descártalos antes de actualizar; no hice el pull."
    );
  }

  const before = gitOutput(["rev-parse", "HEAD"]);
  console.log("Descargando cambios con git pull --ff-only...");
  run("git", ["pull", "--ff-only"]);
  const after = gitOutput(["rev-parse", "HEAD"]);
  const changedFiles =
    before === after
      ? []
      : gitOutput(["diff", "--name-only", `${before}..${after}`])
          .split(/\r?\n/)
          .filter(Boolean);

  console.log("\nSincronizando dependencias...");
  runPnpm(["install", "--frozen-lockfile"]);
  console.log("\nVerificando build de backend y frontend...");
  runPnpm(["run", "build"]);

  if (
    changedFiles.some(
      (file) => file.startsWith("lib/db/src/schema/") || file === "lib/db/drizzle.config.ts"
    )
  ) {
    console.warn(
      "\nLa actualización incluye cambios de esquema de PostgreSQL. Haz una copia de seguridad y revisa el cambio antes de ejecutar: npm run local:db:push"
    );
  }

  console.log("\nActualización lista. Inicia la app con: npm run local:start");
}

function main() {
  const task = process.argv[2];
  assertNodeVersion();

  switch (task) {
    case "setup":
      setup();
      break;
    case "build":
      runPnpm(["run", "typecheck:server"]);
      runPnpm(["run", "build:web"], {
        env: { ...process.env, BASE_PATH: "/", PORT: process.env.PORT || "5000" },
      });
      break;
    case "build-web":
      runPnpm(["--filter", "@workspace/client", "run", "build"], {
        env: { ...process.env, BASE_PATH: "/", PORT: process.env.PORT || "5000" },
      });
      break;
    case "dev":
      runPnpm(["run", "build"]);
      launchServer(process.env.NODE_ENV || "development");
      break;
    case "start":
      launchServer("production");
      break;
    case "local-start":
      assertLocalConfig();
      checkPnpmVersion();
      runPnpm(["run", "build"]);
      launchServer("production");
      break;
    case "update":
      updateFromGitHub();
      break;
    case "test": {
      const files = findTestFiles(path.join(root, "tests"));
      if (files.length === 0) {
        console.log("No se encontraron pruebas *.test.ts.");
        break;
      }
      run(process.execPath, ["--import", "tsx", "--test", ...files], {
        env: { ...process.env, NODE_ENV: "production" },
      });
      break;
    }
    default:
      throw new Error(
        "Uso interno: node scripts/run-local.mjs <setup|build|build-web|dev|start|local-start|update|test>"
      );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}