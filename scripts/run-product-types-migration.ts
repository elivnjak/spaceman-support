import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://rag:rag@localhost:5432/rag";

async function main() {
  const sqlPath = join(
    __dirname,
    "../src/lib/db/migrations/0004_product_types.sql"
  );
  const sql = readFileSync(sqlPath, "utf8");
  const client = postgres(connectionString, { max: 1 });
  await client.unsafe(sql);
  await client.end();
  console.log("Applied 0004_product_types migration (product_types table, playbook/session columns, seed data).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
