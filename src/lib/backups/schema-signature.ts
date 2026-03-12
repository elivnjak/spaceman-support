import { createHash } from "crypto";

type MigrationSignatureInput = {
  fileName: string;
  content: Buffer | string;
};

type SchemaSignatureInput = {
  schemaContent: Buffer | string;
  migrationEntries: MigrationSignatureInput[];
  normalizeLineEndings: boolean;
};

function normalizeSignatureContent(content: Buffer | string): Buffer {
  const text = typeof content === "string" ? content : content.toString("utf8");
  return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

function getSignatureContent(
  content: Buffer | string,
  normalizeLineEndings: boolean
): Buffer | string {
  return normalizeLineEndings ? normalizeSignatureContent(content) : content;
}

export function buildSchemaSignature({
  schemaContent,
  migrationEntries,
  normalizeLineEndings,
}: SchemaSignatureInput): string {
  const hash = createHash("sha256");
  hash.update(getSignatureContent(schemaContent, normalizeLineEndings));

  for (const entry of [...migrationEntries].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    hash.update(entry.fileName);
    hash.update(getSignatureContent(entry.content, normalizeLineEndings));
  }

  return hash.digest("hex");
}
