import "dotenv/config";
import {
  DEFAULT_KNOWLEDGE_BASE_SYNC_DIR,
  exportKnowledgeBaseSyncBundle,
} from "../src/lib/content-sync";

function readOutputDirArg(): string {
  const outputFlagIndex = process.argv.findIndex((value) => value === "--output");
  if (outputFlagIndex >= 0) {
    return process.argv[outputFlagIndex + 1] ?? DEFAULT_KNOWLEDGE_BASE_SYNC_DIR;
  }
  return process.argv[2] ?? DEFAULT_KNOWLEDGE_BASE_SYNC_DIR;
}

async function main() {
  const outputDir = readOutputDirArg();
  const result = await exportKnowledgeBaseSyncBundle(outputDir);

  console.log(`Exported knowledge-base sync bundle to ${result.outputDir}`);
  console.log(`Exported at: ${result.manifest.exportedAt}`);
  console.log(`Files: ${result.manifest.files.length}`);
  for (const [tableName, count] of Object.entries(result.manifest.tableCounts)) {
    console.log(`- ${tableName}: ${count}`);
  }
  if (result.manifest.missingTables.length > 0) {
    console.log(
      `Skipped missing source tables: ${result.manifest.missingTables.join(", ")}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
