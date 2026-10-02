import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ScopedPermissionStore,
  getScopedPermissionRevision,
} from "../../src/lib/scoped-permission-store.js";
import {
  createPermissionRulesProvider,
  permissionRulesProviderAuthority,
} from "../../src/lib/permission-authority.js";
import { withFileLock } from "../../src/lib/with-file-lock.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-scoped-uncertain-"));
try {
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  const filePath = path.join(root, "rules.json");
  const realFsyncFailure = process.platform !== "win32";
  if (realFsyncFailure) {
    const originalFsync = fs.fsyncSync;
    fs.fsyncSync = (descriptor) => {
      if (fs.existsSync(filePath) && fs.fstatSync(descriptor).isDirectory())
        throw new Error("directory fsync failed after settings replacement");
      return originalFsync(descriptor);
    };
  }
  const store = new ScopedPermissionStore({
    cwd,
    filePath,
    lock(file, operation, options) {
      withFileLock(file, operation, options);
      if (!realFsyncFailure)
        throw Object.assign(new Error("persistence outcome unknown"), {
          commitState: "unknown",
        });
    },
  });
  const provider = createPermissionRulesProvider({
    cwd,
    scopedStore: store,
    env: {},
  });
  assert.throws(
    () =>
      store.add({
        decision: "allow",
        rule: "Bash",
        expiresAt: Date.now() + 60_000,
      }),
    { commitState: "unknown" },
  );
  fs.rmSync(filePath);
  for (const attempt of [
    () => store.list(),
    () =>
      store.add({
        decision: "allow",
        rule: "Read",
        expiresAt: Date.now() + 60_000,
      }),
    getScopedPermissionRevision,
    provider,
    () => permissionRulesProviderAuthority(provider).getSnapshot(),
  ]) {
    assert.throws(attempt, {
      code: "CC_SCOPED_PERMISSION_AUTHORITY_UNAVAILABLE",
    });
  }
  console.log("scoped uncertain commit blocked");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
