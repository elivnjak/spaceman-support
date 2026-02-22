import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://rag:rag@localhost:5432/rag";

async function main() {
  const sqlPath = join(
    __dirname,
    "../src/lib/db/migrations/0005_playbook_product_types.sql"
  );
  const sql = readFileSync(sqlPath, "utf8");
  const client = postgres(connectionString, { max: 1 });
  await client.unsafe(sql);
  await client.end();
  console.log("Applied 0005_playbook_product_types migration (playbook/product type join table).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
