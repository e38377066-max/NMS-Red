const userAgent = process.env.npm_config_user_agent ?? "";
const executablePath = process.env.npm_execpath ?? "";

if (
  !userAgent.toLowerCase().startsWith("pnpm/") &&
  !executablePath.toLowerCase().includes("pnpm")
) {
  console.error(
    "Este monorepo usa pnpm (workspace/catalog). Ejecuta npm install -g pnpm@10.26.1 y luego pnpm install."
  );
  process.exit(1);
}