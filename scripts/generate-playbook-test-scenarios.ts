import "dotenv/config";
import path from "path";
import { generatePlaybookScenarios } from "./playbook-test/generate";

async function main() {
  const repoRoot = process.cwd();
  const outputDir = path.join(repoRoot, "data", "playbook_tests");
  const scenarios = await generatePlaybookScenarios(outputDir);
  console.log(`Generated ${scenarios.length} playbook scenarios in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
