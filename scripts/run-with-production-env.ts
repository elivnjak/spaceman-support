/**
 * Loads .env.production and runs a command with that env.
 * If POSTGRES_HOST is set, builds DATABASE_URL from POSTGRES_* so you don't
 * need to put the full Railway URL in .env.production.
 *
 * Usage: npx tsx scripts/run-with-production-env.ts [command...]
 * Example: npx tsx scripts/run-with-production-env.ts npm run db:setup
 */
import { config } from "dotenv";
import { execSync } from "child_process";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.production");
config({ path: envPath });

if (process.env.POSTGRES_HOST) {
  const user = process.env.POSTGRES_USER ?? "rag";
  const password = process.env.POSTGRES_PASSWORD ?? "";
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT ?? "5432";
  const db = process.env.POSTGRES_DB ?? "rag";
  const useSSL = !host.endsWith(".proxy.rlwy.net");
  const qs = useSSL ? "?sslmode=require" : "";
  process.env.DATABASE_URL = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}${qs}`;
} else if (process.env.DATABASE_URL?.includes("railway.internal")) {
  console.error(
    "DATABASE_URL in .env.production uses the internal host (Postgres.railway.internal), which is only reachable from Railway.\n" +
      "To run migrations from your computer, use the public URL instead:\n" +
      "  1. In Railway: Postgres service → Variables or Connect → copy the public connection URL (host like *.railway.app).\n" +
      "  2. Either set DATABASE_URL in .env.production to that full public URL, or set POSTGRES_HOST to the public hostname and keep POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB (and optional POSTGRES_PORT)."
  );
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: npx tsx scripts/run-with-production-env.ts <command> [args...]");
  process.exit(1);
}

try {
  execSync([command, ...args].join(" "), {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
} catch (err: unknown) {
  const code = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : 1;
  const signal = err && typeof err === "object" && "signal" in err ? (err as { signal: string }).signal : null;
  // Ctrl+C (SIGINT) often yields status 130 or signal; treat as clean exit so you don't get a spurious error after success
  if (signal === "SIGINT" || code === 130) {
    process.exit(0);
  }
  process.exit(typeof code === "number" ? code : 1);
}
