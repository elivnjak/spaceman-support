import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getDatabaseUrl } from "./connection-string";

const connectionString = getDatabaseUrl();

// For query purposes (migrations use a different connection)
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });

export * from "./schema";
