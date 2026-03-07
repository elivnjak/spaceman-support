import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, cp } from "fs/promises";
import os from "os";
import path from "path";
import { once } from "events";
import { createServer } from "net";
import { spawn, type ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { buildDatabaseUrl } from "@/lib/db/connection-string";

const execFileAsync = promisify(execFile);

export type SandboxDatabase = ReturnType<typeof drizzle<typeof schema>>;

export type SandboxHandle = {
  schema: string;
  databaseUrl: string;
  storagePath: string;
  db: SandboxDatabase;
  cleanup: () => Promise<void>;
};

export type AppInstance = {
  baseUrl: string;
  process: ChildProcess;
  logLines: string[];
  stop: () => Promise<void>;
};

export function createDatabaseClient(databaseUrl = buildDatabaseUrl()) {
  const client = postgres(databaseUrl, { max: 10 });
  return {
    db: drizzle(client, { schema }),
    close: async () => {
      await client.end({ timeout: 5 }).catch(() => {});
    },
  };
}

export type FileEdit = {
  filePath: string;
  search: string;
  replace: string;
};

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function ident(value: string): string {
  return `"${sanitizeIdentifier(value)}"`;
}

async function getPublicTableNames(client: postgres.Sql) {
  const rows = await client.unsafe<{ table_name: string }[]>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
  );
  return rows.map((row) => row.table_name);
}

async function clonePublicSchemaToSandbox(client: postgres.Sql, schemaName: string) {
  await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${ident(schemaName)}`);
  const tableNames = await getPublicTableNames(client);

  for (const tableName of tableNames) {
    const quotedTable = ident(tableName);
    await client.unsafe(`DROP TABLE IF EXISTS ${ident(schemaName)}.${quotedTable} CASCADE`);
    await client.unsafe(
      `CREATE TABLE ${ident(schemaName)}.${quotedTable} (LIKE public.${quotedTable} INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED)`
    );
    await client.unsafe(
      `INSERT INTO ${ident(schemaName)}.${quotedTable} SELECT * FROM public.${quotedTable}`
    );
  }
}

export async function createSandbox(): Promise<SandboxHandle> {
  const baseUrl = process.env.DATABASE_URL ?? "postgres://rag:rag@localhost:5432/rag";
  const schemaName = sanitizeIdentifier(
    `playbook_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  );
  const adminClient = postgres(baseUrl, { max: 1 });
  const storagePath = await mkdtemp(path.join(os.tmpdir(), `${schemaName}_storage_`));

  try {
    await clonePublicSchemaToSandbox(adminClient, schemaName);
  } catch (error) {
    await adminClient.end({ timeout: 5 });
    throw error;
  }

  const sandboxUrl = buildDatabaseUrl(baseUrl, schemaName);
  const client = postgres(sandboxUrl, { max: 10 });
  const db = drizzle(client, { schema });

  return {
    schema: schemaName,
    databaseUrl: sandboxUrl,
    storagePath,
    db,
    cleanup: async () => {
      await client.end({ timeout: 5 }).catch(() => {});
      await adminClient.unsafe(`DROP SCHEMA IF EXISTS ${ident(schemaName)} CASCADE`).catch(() => {});
      await adminClient.end({ timeout: 5 }).catch(() => {});
      await rm(storagePath, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function waitForPort(port: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for app on port ${port}`);
}

export async function getAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  if (!port) {
    throw new Error("Unable to allocate an available port");
  }
  return port;
}

export async function startAppInstance(options: {
  workspaceDir: string;
  schema: string;
  storagePath: string;
}): Promise<AppInstance> {
  const port = await getAvailablePort();
  const nextBinary = path.join(options.workspaceDir, "node_modules", ".bin", "next");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    TURNSTILE_ENFORCE: "false",
    NEXT_PUBLIC_TURNSTILE_ENFORCE: "false",
    DATABASE_SCHEMA: options.schema,
    STORAGE_PATH: options.storagePath,
  };

  const child = spawn(nextBinary, ["dev", "-p", String(port)], {
    cwd: options.workspaceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.stdout || !child.stderr) {
    throw new Error("Failed to capture Next.js process output");
  }
  const logLines: string[] = [];
  const capture = (chunk: Buffer) => {
    const lines = chunk
      .toString("utf-8")
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    logLines.push(...lines);
    if (logLines.length > 200) {
      logLines.splice(0, logLines.length - 200);
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  try {
    await waitForPort(port, 90_000);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `${error instanceof Error ? error.message : "Failed to start app"}\n${logLines.join("\n")}`
    );
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    process: child,
    logLines,
    stop: async () => {
      if (child.exitCode !== null || child.killed) return;
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => {});
    },
  };
}

export async function createWorkspaceSandbox(sourceDir: string): Promise<string> {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "playbook-test-workspace-"));
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(sourceDir, entry);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return ![".git", "node_modules", ".next", "storage", "logs"].includes(first);
    },
  });

  await mkdir(path.join(targetDir, "logs"), { recursive: true });

  try {
    await symlink(path.join(sourceDir, "node_modules"), path.join(targetDir, "node_modules"));
  } catch {
    // fall back to the copied workspace if symlink creation is not allowed
  }

  return targetDir;
}

export async function cleanupWorkspaceSandbox(workspaceDir: string) {
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
}

export async function applySearchReplaceEdits(workspaceDir: string, edits: FileEdit[]) {
  for (const edit of edits) {
    const absolutePath = path.join(workspaceDir, edit.filePath);
    const content = await readFile(absolutePath, "utf-8");
    const matchCount = content.split(edit.search).length - 1;
    if (matchCount !== 1) {
      throw new Error(
        `Expected exactly one match for edit in ${edit.filePath}, found ${matchCount}`
      );
    }
    await writeFile(absolutePath, content.replace(edit.search, edit.replace), "utf-8");
  }
}

export async function readRelevantFileSnippets(
  repoRoot: string,
  filePaths: string[]
): Promise<Record<string, string>> {
  const snippets: Record<string, string> = {};
  for (const filePath of filePaths) {
    snippets[filePath] = await readFile(path.join(repoRoot, filePath), "utf-8");
  }
  return snippets;
}

export async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}
