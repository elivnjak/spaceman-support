import test from "node:test";
import assert from "node:assert/strict";
import { buildSchemaSignature } from "./schema-signature";

test("schema signature normalization makes CRLF and LF inputs match", () => {
  const lfSignature = buildSchemaSignature({
    schemaContent: "export const example = 1;\n",
    migrationEntries: [
      {
        fileName: "0001_example.sql",
        content: "create table test (\n  id text not null\n);\n",
      },
    ],
    normalizeLineEndings: true,
  });

  const crlfSignature = buildSchemaSignature({
    schemaContent: "export const example = 1;\r\n",
    migrationEntries: [
      {
        fileName: "0001_example.sql",
        content: "create table test (\r\n  id text not null\r\n);\r\n",
      },
    ],
    normalizeLineEndings: true,
  });

  assert.equal(crlfSignature, lfSignature);
});

test("legacy schema signature remains line-ending sensitive", () => {
  const lfSignature = buildSchemaSignature({
    schemaContent: "export const example = 1;\n",
    migrationEntries: [
      {
        fileName: "0001_example.sql",
        content: "create table test (\n  id text not null\n);\n",
      },
    ],
    normalizeLineEndings: false,
  });

  const crlfSignature = buildSchemaSignature({
    schemaContent: "export const example = 1;\r\n",
    migrationEntries: [
      {
        fileName: "0001_example.sql",
        content: "create table test (\r\n  id text not null\r\n);\r\n",
      },
    ],
    normalizeLineEndings: false,
  });

  assert.notEqual(crlfSignature, lfSignature);
});
