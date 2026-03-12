import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRestoreLockApiResponse,
  clearRestoreLock,
  writeRestoreLock,
} from "./restore-lock";

test.afterEach(async () => {
  await clearRestoreLock();
});

test("restore lock blocks mutating admin requests", async () => {
  await writeRestoreLock({
    active: true,
    operationId: "op-1",
    backupId: "backup-1",
    backupName: "Prod backup",
    startedAt: new Date().toISOString(),
    message: "Restoring Prod backup",
  });

  const response = await buildRestoreLockApiResponse("/api/admin/tickets", "POST");
  assert.ok(response);
  assert.equal(response.status, 503);
});

test("restore lock still allows backup polling reads", async () => {
  await writeRestoreLock({
    active: true,
    operationId: "op-1",
    backupId: "backup-1",
    backupName: "Prod backup",
    startedAt: new Date().toISOString(),
    message: "Restoring Prod backup",
  });

  const response = await buildRestoreLockApiResponse("/api/admin/backups", "GET");
  assert.equal(response, null);
});
