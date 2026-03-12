import { config } from "dotenv";
import { existsSync, openSync } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { spawnSync } from "child_process";
import { basename, dirname, join, resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

const FALLBACK_RAILWAY_TOKEN = "";

const DEFAULT_CONTEXT = {
  projectId: process.env.RAILWAY_PROJECT_ID ?? "23ca88f9-3bdf-435a-aa2c-cfd447796ded",
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? "a79106b8-5399-4e1d-bae0-8257102f5125",
  appServiceId: process.env.RAILWAY_APP_SERVICE_ID ?? "8d4b9d8c-ce69-46f6-81f4-1e5e854a3b91",
  postgresServiceId: process.env.RAILWAY_POSTGRES_SERVICE_ID ?? "0cb235e6-e364-4c5b-99af-cffca132de8d",
  projectName: process.env.RAILWAY_PROJECT_NAME ?? "spaceman-support",
  environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? "production",
};

type GraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type RailwayAuthMode = "bearer" | "project";

export type BackupManifest = {
  version: 1;
  createdAt: string;
  project: {
    id: string;
    name: string;
    environmentId: string;
    environmentName: string;
    appServiceId: string;
    postgresServiceId: string;
  };
  database: {
    dumpFile: string;
    verified: boolean;
  };
  storage: {
    attempted: boolean;
    completed: boolean;
    volumeInstanceId?: string;
    volumeId?: string;
    mountPath?: string;
    backupId?: string;
    backupName?: string;
    workflowId?: string;
    warning?: string;
  };
};

export type ProjectBackupSupport = {
  subscriptionType: string;
  volumeMaxBackupsCount: number;
  volumeMaxBackupsUsagePercent: number;
};

export type ParsedArgs = {
  flags: Set<string>;
  values: Map<string, string>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.split("=", 2);
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      i += 1;
      continue;
    }

    flags.add(key);
  }

  return { flags, values };
}

export function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

export function getValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.values.get(name);
}

export function timestampLabel(date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function getRailwayToken(): string {
  const token = process.env.RAILWAY_TOKEN?.trim() || FALLBACK_RAILWAY_TOKEN;
  if (!token) {
    throw new Error("RAILWAY_TOKEN is not set.");
  }
  return token;
}

async function rawGraphQl<T>(
  token: string,
  authMode: RailwayAuthMode,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQlResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authMode === "bearer") {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers["Project-Access-Token"] = token;
  }

  const response = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return (await response.json()) as GraphQlResponse<T>;
}

export async function detectRailwayAuthMode(token: string): Promise<RailwayAuthMode> {
  const bearerProbe = await rawGraphQl<{ me: { id: string } }>(token, "bearer", "query { me { id } }");
  if (bearerProbe.data?.me?.id) {
    return "bearer";
  }

  const projectProbe = await rawGraphQl<{ environment: { id: string } }>(
    token,
    "project",
    "query($environmentId:String!){ environment(id:$environmentId) { id } }",
    { environmentId: DEFAULT_CONTEXT.environmentId },
  );

  if (projectProbe.data?.environment?.id) {
    return "project";
  }

  const errorMessages = [...(bearerProbe.errors ?? []), ...(projectProbe.errors ?? [])]
    .map((entry) => entry.message)
    .join("; ");

  throw new Error(`Unable to authenticate with Railway token. ${errorMessages}`.trim());
}

export async function graphQl<T>(
  token: string,
  authMode: RailwayAuthMode,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const payload = await rawGraphQl<T>(token, authMode, query, variables);
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message).join("; "));
  }
  if (!payload.data) {
    throw new Error("Railway returned no data.");
  }
  return payload.data;
}

export async function getRailwayVariables(
  token: string,
  authMode: RailwayAuthMode,
  serviceId: string,
): Promise<Record<string, string>> {
  const data = await graphQl<{ variables: Record<string, string> }>(
    token,
    authMode,
    "query($projectId:String!, $environmentId:String!, $serviceId:String){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }",
    {
      projectId: DEFAULT_CONTEXT.projectId,
      environmentId: DEFAULT_CONTEXT.environmentId,
      serviceId,
    },
  );

  return data.variables;
}

export async function getProjectBackupSupport(
  token: string,
  authMode: RailwayAuthMode,
): Promise<ProjectBackupSupport> {
  const data = await graphQl<{
    project: {
      subscriptionType: string;
      subscriptionPlanLimit: unknown;
    };
  }>(
    token,
    authMode,
    "query($projectId:String!){ project(id:$projectId) { subscriptionType subscriptionPlanLimit } }",
    { projectId: DEFAULT_CONTEXT.projectId },
  );

  const planLimit = data.project.subscriptionPlanLimit as {
    volumes?: {
      maxBackupsCount?: number;
      maxBackupsUsagePercent?: number;
    };
  };

  return {
    subscriptionType: data.project.subscriptionType,
    volumeMaxBackupsCount: planLimit.volumes?.maxBackupsCount ?? 0,
    volumeMaxBackupsUsagePercent: planLimit.volumes?.maxBackupsUsagePercent ?? 0,
  };
}

export async function getStorageVolumeInstance(
  token: string,
  authMode: RailwayAuthMode,
): Promise<{
  id: string;
  volumeId: string;
  mountPath: string;
  serviceId: string | null;
  volume: { id: string; name: string };
  service: { id: string; name: string };
}> {
  const data = await graphQl<{
    environment: {
      volumeInstances: {
        edges: Array<{
          node: {
            id: string;
            volumeId: string;
            serviceId: string | null;
            mountPath: string;
            volume: { id: string; name: string };
            service: { id: string; name: string };
          };
        }>;
      };
    };
  }>(
    token,
    authMode,
    "query($environmentId:String!){ environment(id:$environmentId) { volumeInstances { edges { node { id volumeId serviceId mountPath volume { id name } service { id name } } } } } }",
    { environmentId: DEFAULT_CONTEXT.environmentId },
  );

  const match = data.environment.volumeInstances.edges
    .map((edge) => edge.node)
    .find((node) => node.service.id === DEFAULT_CONTEXT.appServiceId);

  if (!match) {
    throw new Error("Could not find the app storage volume instance in Railway.");
  }

  return match;
}

export async function createStorageBackup(
  token: string,
  authMode: RailwayAuthMode,
  volumeInstanceId: string,
  name: string,
): Promise<{ workflowId: string }> {
  const data = await graphQl<{ volumeInstanceBackupCreate: { workflowId: string } }>(
    token,
    authMode,
    "mutation($volumeInstanceId:String!, $name:String!){ volumeInstanceBackupCreate(volumeInstanceId:$volumeInstanceId, name:$name) { workflowId } }",
    { volumeInstanceId, name },
  );

  return data.volumeInstanceBackupCreate;
}

export async function restoreStorageBackup(
  token: string,
  authMode: RailwayAuthMode,
  volumeInstanceId: string,
  volumeInstanceBackupId: string,
): Promise<{ workflowId: string }> {
  const data = await graphQl<{ volumeInstanceBackupRestore: { workflowId: string } }>(
    token,
    authMode,
    "mutation($volumeInstanceId:String!, $volumeInstanceBackupId:String!){ volumeInstanceBackupRestore(volumeInstanceId:$volumeInstanceId, volumeInstanceBackupId:$volumeInstanceBackupId) { workflowId } }",
    { volumeInstanceId, volumeInstanceBackupId },
  );

  return data.volumeInstanceBackupRestore;
}

export async function waitForWorkflow(
  token: string,
  authMode: RailwayAuthMode,
  workflowId: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const data = await graphQl<{ workflowStatus: { status: string; error: string | null } }>(
      token,
      authMode,
      "query($workflowId:String!){ workflowStatus(workflowId:$workflowId) { status error } }",
      { workflowId },
    );

    if (data.workflowStatus.status === "Complete") {
      return;
    }

    if (data.workflowStatus.status === "Error") {
      throw new Error(data.workflowStatus.error ?? "Railway workflow failed.");
    }

    if (data.workflowStatus.status === "NotFound") {
      throw new Error("Railway workflow was not found.");
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }

  throw new Error("Timed out waiting for Railway workflow to complete.");
}

export async function listStorageBackups(
  token: string,
  authMode: RailwayAuthMode,
  volumeInstanceId: string,
): Promise<
  Array<{
    id: string;
    name: string | null;
    createdAt: string;
  }>
> {
  const data = await graphQl<{
    volumeInstanceBackupList: Array<{ id: string; name: string | null; createdAt: string }>;
  }>(
    token,
    authMode,
    "query($volumeInstanceId:String!){ volumeInstanceBackupList(volumeInstanceId:$volumeInstanceId) { id name createdAt } }",
    { volumeInstanceId },
  );

  return data.volumeInstanceBackupList;
}

export function ensureDocker(): void {
  const result = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error("Docker is required for pg_dump/pg_restore but was not found.");
  }
}

export function buildBackupDir(customName?: string): string {
  const folderName = customName ? customName : `production-${timestampLabel()}`;
  return resolve(process.cwd(), "backups", folderName);
}

export async function writeManifest(dir: string, manifest: BackupManifest): Promise<string> {
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

export async function readManifest(manifestOrDir: string): Promise<BackupManifest> {
  const candidate = manifestOrDir.endsWith(".json")
    ? resolve(process.cwd(), manifestOrDir)
    : join(resolve(process.cwd(), manifestOrDir), "manifest.json");

  const content = await readFile(candidate, "utf8");
  return JSON.parse(content) as BackupManifest;
}

export async function getLatestManifestPath(): Promise<string> {
  const backupsDir = resolve(process.cwd(), "backups");
  if (!existsSync(backupsDir)) {
    throw new Error("No backups directory exists yet.");
  }

  const entries = await readdir(backupsDir, { withFileTypes: true });
  const manifests = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(backupsDir, entry.name, "manifest.json"))
    .filter((path) => existsSync(path));

  if (manifests.length === 0) {
    throw new Error("No backup manifests were found.");
  }

  const sorted = manifests.sort((a, b) => (a < b ? 1 : -1));

  return sorted[0];
}

export function runDocker(command: string[], options: { stdoutFile?: string } = {}): void {
  const stdio: Array<number | "inherit" | "ignore"> = ["ignore", "inherit", "inherit"];
  if (options.stdoutFile) {
    stdio[1] = openSync(options.stdoutFile, "w");
  }

  const result = spawnSync("docker", command, { stdio });
  if (result.status !== 0) {
    throw new Error(`Docker command failed: docker ${command.join(" ")}`);
  }
}

export async function createDatabaseDump(
  dumpPath: string,
  connection: { host: string; port: string; user: string; password: string; dbName: string },
): Promise<void> {
  ensureDocker();
  await mkdir(dirname(dumpPath), { recursive: true });

  runDocker(
    [
      "run",
      "--rm",
      "-e",
      `PGPASSWORD=${connection.password}`,
      "postgres:16-alpine",
      "pg_dump",
      "--host",
      connection.host,
      "--port",
      connection.port,
      "--username",
      connection.user,
      "--dbname",
      connection.dbName,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ],
    { stdoutFile: dumpPath },
  );
}

export function verifyDatabaseDump(dumpPath: string): void {
  ensureDocker();
  const backupDir = dirname(dumpPath);
  const dumpFile = basename(dumpPath);

  runDocker([
    "run",
    "--rm",
    "-v",
    `${backupDir}:/backup`,
    "postgres:16-alpine",
    "pg_restore",
    "-l",
    `/backup/${dumpFile}`,
  ]);
}

export function restoreDatabaseDump(
  dumpPath: string,
  connection: { host: string; port: string; user: string; password: string; dbName: string },
): void {
  ensureDocker();
  const backupDir = dirname(dumpPath);
  const dumpFile = basename(dumpPath);

  runDocker([
    "run",
    "--rm",
    "-v",
    `${backupDir}:/backup`,
    "-e",
    `PGPASSWORD=${connection.password}`,
    "postgres:16-alpine",
    "pg_restore",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--host",
    connection.host,
    "--port",
    connection.port,
    "--username",
    connection.user,
    "--dbname",
    connection.dbName,
    `/backup/${dumpFile}`,
  ]);
}

export async function getProductionDatabaseConnection(
  token: string,
  authMode: RailwayAuthMode,
): Promise<{ host: string; port: string; user: string; password: string; dbName: string }> {
  const variables = await getRailwayVariables(token, authMode, DEFAULT_CONTEXT.postgresServiceId);

  const host = variables.RAILWAY_TCP_PROXY_DOMAIN;
  const port = variables.RAILWAY_TCP_PROXY_PORT ?? "5432";
  const user = variables.POSTGRES_USER;
  const password = variables.POSTGRES_PASSWORD;
  const dbName = variables.POSTGRES_DB;

  if (!host || !user || !password || !dbName) {
    throw new Error("Could not read the production Postgres connection details from Railway.");
  }

  return { host, port, user, password, dbName };
}

export function productionContext() {
  return { ...DEFAULT_CONTEXT };
}
