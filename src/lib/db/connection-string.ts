const DEFAULT_DATABASE_URL = "postgres://rag:rag@localhost:5432/rag";

function normalizeSchemaName(schema: string): string {
  return schema.trim().replace(/[^a-zA-Z0-9_]/g, "_");
}

export function buildDatabaseUrl(
  baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  schema = process.env.DATABASE_SCHEMA?.trim()
): string {
  if (!schema) return baseUrl;

  const url = new URL(baseUrl);
  const normalizedSchema = normalizeSchemaName(schema);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${normalizedSchema},public`;

  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );

  return url.toString();
}

export function getDatabaseUrl(): string {
  return buildDatabaseUrl();
}
