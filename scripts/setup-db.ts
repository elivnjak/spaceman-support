import "dotenv/config";
import {
  seedLabels,
  seedActions,
  seedTooRunnyPlaybook,
  seedAdminUser,
} from "../src/lib/db/seed";

async function main() {
  await seedLabels();
  await seedActions();
  await seedTooRunnyPlaybook();
  await seedAdminUser();
  console.log(
    "Database seeded with default labels, actions, too_runny playbook, admin user, and vector indexes."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
