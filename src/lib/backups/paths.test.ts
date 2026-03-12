import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_LIBRARY_DIRNAME,
  getBackupTmpRoot,
  sanitizeFileComponent,
  shouldIncludeStorageRelativePath,
} from "./paths";

test("backup storage paths exclude the backup library itself", () => {
  assert.equal(shouldIncludeStorageRelativePath(`${BACKUP_LIBRARY_DIRNAME}/archive.tar.gz`), false);
  assert.equal(shouldIncludeStorageRelativePath("diagnostic_sessions/session-1/photo.jpg"), true);
});

test("sanitizeFileComponent produces stable archive-safe names", () => {
  assert.equal(sanitizeFileComponent("Prod Backup 01", "backup"), "prod-backup-01");
  assert.equal(sanitizeFileComponent("   ", "backup"), "backup");
});

test("backup temp root lives outside the storage backup library", () => {
  const tempRoot = getBackupTmpRoot().replace(/\\/g, "/");
  assert.match(tempRoot, /spaceman-support\/__backups\/tmp$/);
  assert.equal(tempRoot.includes("/storage/__backups/tmp"), false);
});
