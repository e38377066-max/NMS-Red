import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const localEnvPath = path.join(root, ".env.local");

if (existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

function run(command, args, env = process.env) {
  const executable =
    isWindows && command === "pnpm" ? "pnpm.cmd" : isWindows && command === "pg_dump" ? "pg_dump.exe" : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    encoding: "utf8",
    shell: isWindows && command === "pnpm",
    stdio: "inherit",
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} terminó con código ${result.status ?? 1}.`);
  }
}

function runPnpm(args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (["npm_config_user_agent", "npm_execpath"].includes(key.toLowerCase())) {
      delete env[key];
    }
  }
  run("pnpm", args, env);
}

function checkPnpmVersion() {
  const result = spawnSync(isWindows ? "pnpm.cmd" : "pnpm", ["--version"], {
    cwd: root,
    encoding: "utf8",
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      "No encuentro pnpm. Instálalo una vez con: npm install --global pnpm@10.26.1"
    );
  }
}

function parseDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || /CHANGE_ME|replace-with|example\.com/i.test(value)) {
    throw new Error("Configura DATABASE_URL en .env.local antes de inicializar o actualizar la base.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida de PostgreSQL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL debe comenzar con postgres:// o postgresql://.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      "Por seguridad, los comandos locales solo admiten PostgreSQL en esta PC (localhost o 127.0.0.1)."
    );
  }
  return url;
}

function safeTarget(url) {
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "(sin nombre)";
  return `${url.hostname}:${url.port || "5432"}/${database}`;
}

async function inspectDatabase(url) {
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename"
    );
    return result.rows.map((row) => `${row.schemaname}.${row.tablename}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function confirm(prompt, expected) {
  const input = createInterface({ input: stdin, output: stdout });
  try {
    return (await input.question(`${prompt}\nEscribe ${expected} para continuar: `)).trim() === expected;
  } finally {
    input.close();
  }
}

function pgDumpEnvironment(url) {
  const env = { ...process.env };
  env.PGHOST = url.hostname.replace(/^\[|\]$/g, "");
  env.PGPORT = url.port || "5432";
  env.PGUSER = decodeURIComponent(url.username);
  env.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  else delete env.PGPASSWORD;

  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

function backupDatabase(url) {
  const backupDirectory = path.join(root, "data", "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, `before-schema-push-${stamp}.dump`);

  run(
    "pg_dump",
    ["--format=custom", "--no-owner", "--file", backupPath],
    pgDumpEnvironment(url)
  );
  console.log(`Copia de seguridad creada: ${path.relative(root, backupPath)}`);
}

async function main() {
  const action = process.argv[2];
  if (!["init", "push"].includes(action)) {
    throw new Error("Uso: npm run local:db:init o npm run local:db:push");
  }

  const url = parseDatabaseUrl();
  checkPnpmVersion();
  const tables = await inspectDatabase(url);
  console.log(`Base seleccionada: ${safeTarget(url)} (sin mostrar credenciales).`);

  if (action === "init" && tables.length > 0) {
    throw new Error(
      `La base ya contiene tablas (${tables.slice(0, 5).join(", ")}). No ejecutar el inicializador sobre datos existentes.`
    );
  }

  const expected = action === "init" ? "INIT" : "PUSH";
  const prompt =
    action === "init"
      ? "Esto creará el esquema en una base vacía. No se borrarán datos."
      : "Esto hará una copia local y luego abrirá Drizzle para aplicar cambios de esquema. Revisa su propuesta antes de aceptar.";
  if (!(await confirm(prompt, expected))) {
    console.log("Operación cancelada; la base no fue modificada.");
    return;
  }

  if (action === "push") backupDatabase(url);
  runPnpm(["--filter", "@workspace/db", "run", "push"]);
  console.log("Operación de esquema completada.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});