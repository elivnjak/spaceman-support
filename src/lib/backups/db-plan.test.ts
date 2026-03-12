import test from "node:test";
import assert from "node:assert/strict";
import { MANAGED_BACKUP_TABLES } from "./db-plan";

test("managed backup tables expose timestamp columns that can be revived during restore", () => {
  const table = MANAGED_BACKUP_TABLES.find((entry) => entry.name === "users");

  assert.ok(table);
  const dateColumns = Object.entries(table.table as Record<string, unknown>)
    .filter(([key, value]) => {
      if (key === "enableRLS") return false;
      if (!value || typeof value !== "object") return false;
      return "dataType" in value && (value as { dataType?: unknown }).dataType === "date";
    })
    .map(([key]) => key);

  assert.deepEqual(dateColumns.sort(), ["createdAt", "updatedAt"]);
});
