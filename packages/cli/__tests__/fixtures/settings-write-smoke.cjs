"use strict";

// Executed outside Vitest, including at Node's supported minimum version.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const loader = require("../../src/lib/settings-loader.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-smoke-"));
  let remove;
  try {
    const { createPermissionRulesProvider, permissionRulesProviderAuthority } =
      await import("../../src/lib/permission-authority.js");
    const provider = createPermissionRulesProvider({
      cwd: root,
      env: {},
      baseRules: { allow: [], ask: [], deny: [] },
    });
    const owner = permissionRulesProviderAuthority(provider);
    const before = owner.getSnapshot();
    assert.equal(before, loader.getSettingsPermissionRevision());
    let notified = false;
    remove = owner.subscribePolicyRevision(() => {
      notified = true;
    });
    const result = loader.addRule({ cwd: root, kind: "deny", rule: "Bash" });
    assert.equal(result.added, true);
    assert.equal(typeof result.then, "undefined");
    assert.equal(notified, true);
    assert.equal(owner.getSnapshot().revision, before.revision + 1);
    assert.equal(provider().settingsRevision, owner.getSnapshot());
    process.stdout.write(`settings-write-smoke passed on ${process.version}\n`);
  } finally {
    remove?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
