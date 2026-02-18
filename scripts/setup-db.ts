import "dotenv/config";
import { seedLabels, seedActions, seedTooRunnyPlaybook } from "../src/lib/db/seed";

async function main() {
  await seedLabels();
  await seedActions();
  await seedTooRunnyPlaybook();
  console.log("Database seeded with default labels, actions, too_runny playbook, and vector indexes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
