import { dirname, isAbsolute, join, resolve } from "path";
import {
  detectRailwayAuthMode,
  getLatestManifestPath,
  getProductionDatabaseConnection,
  getRailwayToken,
  getStorageVolumeInstance,
  getValue,
  hasFlag,
  parseArgs,
  readManifest,
  restoreDatabaseDump,
  restoreStorageBackup,
  waitForWorkflow,
} from "./lib/railway-production";

function resolveBackupInput(input?: string): string {
  if (!input) {
    throw new Error("Pass --backup <backup-folder-or-manifest.json>, or use --latest.");
  }

  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const backupInput = hasFlag(parsed, "--latest")
    ? await getLatestManifestPath()
    : resolveBackupInput(getValue(parsed, "--backup"));

  if (!hasFlag(parsed, "--yes")) {
    throw new Error("Production restore is destructive. Re-run with --yes after confirming the backup you want.");
  }

  const dbOnly = hasFlag(parsed, "--db-only");
  const storageOnly = hasFlag(parsed, "--storage-only");
  const manifest = await readManifest(backupInput);
  const manifestBaseDir = backupInput.endsWith(".json") ? dirname(backupInput) : backupInput;
  const dumpPath = join(manifestBaseDir, manifest.database.dumpFile);
  const token = getRailwayToken();
  const authMode = await detectRailwayAuthMode(token);

  console.log(`Using Railway auth mode: ${authMode}`);
  console.log(`Restoring from ${backupInput}`);

  if (!storageOnly) {
    const connection = await getProductionDatabaseConnection(token, authMode);
    restoreDatabaseDump(dumpPath, connection);
    console.log("Production database restore completed.");
  }

  if (!dbOnly) {
    if (!manifest.storage.backupId || !manifest.storage.volumeInstanceId) {
      throw new Error("This backup does not include a restorable storage snapshot.");
    }

    const storageVolume = await getStorageVolumeInstance(token, authMode);
    const targetVolumeInstanceId = manifest.storage.volumeInstanceId ?? storageVolume.id;
    console.log(`Restoring Railway storage snapshot ${manifest.storage.backupName ?? manifest.storage.backupId}`);
    const workflow = await restoreStorageBackup(token, authMode, targetVolumeInstanceId, manifest.storage.backupId);
    await waitForWorkflow(token, authMode, workflow.workflowId);
    console.log("Production storage restore completed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
