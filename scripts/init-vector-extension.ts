import "dotenv/config";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://rag:rag@localhost:5432/rag";

async function main() {
  const sql = postgres(connectionString, { max: 1 });
  await sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
  await sql.end();
  console.log("pgvector extension created (or already exists).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
