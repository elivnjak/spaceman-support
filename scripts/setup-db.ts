import "dotenv/config";
import {
  seedLabels,
  seedActions,
  seedTooRunnyPlaybook,
  seedAdminUser,
  seedSupportedModels,
} from "../src/lib/db/seed";

async function main() {
  await seedLabels();
  await seedActions();
  await seedTooRunnyPlaybook();
  await seedAdminUser();
  await seedSupportedModels();
  console.log(
    "Database seeded with default labels, actions, too_runny playbook, admin user, supported models, and vector indexes."
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
