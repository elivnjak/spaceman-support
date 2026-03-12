import { join } from "path";
import {
  buildBackupDir,
  createDatabaseDump,
  createStorageBackup,
  detectRailwayAuthMode,
  getProductionDatabaseConnection,
  getProjectBackupSupport,
  getRailwayToken,
  getStorageVolumeInstance,
  hasFlag,
  listStorageBackups,
  parseArgs,
  productionContext,
  timestampLabel,
  verifyDatabaseDump,
  waitForWorkflow,
  writeManifest,
  type BackupManifest,
} from "./lib/railway-production";

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const skipStorage = hasFlag(parsed, "--db-only") || hasFlag(parsed, "--skip-storage");
  const strict = hasFlag(parsed, "--strict");
  const backupDir = buildBackupDir();
  const dumpPath = join(backupDir, "production-db.dump");
  const token = getRailwayToken();
  const authMode = await detectRailwayAuthMode(token);
  const context = productionContext();
  const backupSupport = await getProjectBackupSupport(token, authMode);

  console.log(`Using Railway auth mode: ${authMode}`);
  console.log(`Creating production database backup in ${backupDir}`);

  const connection = await getProductionDatabaseConnection(token, authMode);
  await createDatabaseDump(dumpPath, connection);
  verifyDatabaseDump(dumpPath);

  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    project: {
      id: context.projectId,
      name: context.projectName,
      environmentId: context.environmentId,
      environmentName: context.environmentName,
      appServiceId: context.appServiceId,
      postgresServiceId: context.postgresServiceId,
    },
    database: {
      dumpFile: "production-db.dump",
      verified: true,
    },
    storage: {
      attempted: !skipStorage,
      completed: false,
    },
  };

  if (!skipStorage) {
    if (backupSupport.volumeMaxBackupsCount <= 0) {
      const warning =
        `Railway volume snapshots are not available on the current ${backupSupport.subscriptionType} plan ` +
        `(maxBackupsCount=${backupSupport.volumeMaxBackupsCount}).`;
      manifest.storage = {
        attempted: true,
        completed: false,
        warning,
      };
      console.warn(`Storage snapshot was skipped: ${warning}`);
      if (strict) {
        throw new Error(warning);
      }
    } else {
      try {
        const storageVolume = await getStorageVolumeInstance(token, authMode);
        const backupName = `storage-${timestampLabel()}`;
        console.log(`Requesting Railway storage snapshot: ${backupName}`);
        const workflow = await createStorageBackup(token, authMode, storageVolume.id, backupName);
        await waitForWorkflow(token, authMode, workflow.workflowId);

        const completedBackups = await listStorageBackups(token, authMode, storageVolume.id);
        const latestBackup = completedBackups
          .slice()
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .find((backup) => backup.name === backupName) ?? completedBackups[0];

        manifest.storage = {
          attempted: true,
          completed: true,
          volumeInstanceId: storageVolume.id,
          volumeId: storageVolume.volumeId,
          mountPath: storageVolume.mountPath,
          backupId: latestBackup?.id,
          backupName: latestBackup?.name ?? backupName,
          workflowId: workflow.workflowId,
        };
      } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        manifest.storage = {
          attempted: true,
          completed: false,
          warning,
        };
        console.warn(`Storage snapshot was not completed: ${warning}`);
        if (strict) {
          throw error;
        }
      }
    }
  }

  const manifestPath = await writeManifest(backupDir, manifest);
  console.log(`Backup manifest written to ${manifestPath}`);

  if (manifest.storage.attempted && !manifest.storage.completed) {
    console.log("Database backup completed, but storage snapshot did not.");
    console.log("Use a full-account Railway token if you want the storage snapshot/restore steps to succeed.");
  } else if (!manifest.storage.attempted) {
    console.log("Database backup completed. Storage snapshot was skipped.");
  } else {
    console.log("Database backup and storage snapshot completed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
