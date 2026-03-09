import "dotenv/config";
import {
  DEFAULT_KNOWLEDGE_BASE_SYNC_DIR,
  importKnowledgeBaseSyncBundle,
} from "../src/lib/content-sync";

function readInputDirArg(): string {
  const inputFlagIndex = process.argv.findIndex((value) => value === "--input");
  if (inputFlagIndex >= 0) {
    return process.argv[inputFlagIndex + 1] ?? DEFAULT_KNOWLEDGE_BASE_SYNC_DIR;
  }
  return process.argv[2] ?? DEFAULT_KNOWLEDGE_BASE_SYNC_DIR;
}

async function main() {
  const inputDir = readInputDirArg();
  const result = await importKnowledgeBaseSyncBundle(inputDir);

  console.log(`Imported knowledge-base sync bundle from ${result.inputDir}`);
  console.log(`Bundle exported at: ${result.manifest.exportedAt}`);
  console.log(`Files restored: ${result.manifest.files.length}`);
  for (const [tableName, count] of Object.entries(result.manifest.tableCounts)) {
    console.log(`- ${tableName}: ${count}`);
  }
  if (result.manifest.missingTables.length > 0) {
    console.log(
      `Bundle was exported without source tables: ${result.manifest.missingTables.join(", ")}`
    );
  }
  if (result.skippedTargetTables.length > 0) {
    console.log(
      `Skipped missing target tables: ${result.skippedTargetTables.join(", ")}`
    );
  }
  console.log(
    "Local support and ticket history was cleared during import so the synced content can be restored cleanly."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
