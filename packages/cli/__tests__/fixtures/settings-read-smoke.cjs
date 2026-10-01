"use strict";

// Read-only CJS discovery and ESM provider loading must not materialize the
// write-only require(ESM) bridge or emit warnings in a concurrency worker.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const loader = require("../../src/lib/settings-loader.cjs");
const helpers = ["durable-security-store.js", "with-file-lock.js"].map((name) =>
  require.resolve(`../../src/lib/${name}`),
);
assert.ok(helpers.every((file) => !require.cache[file]));

async function main() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-settings-read-smoke-"),
  );
  try {
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash"] } }),
    );
    loader._deps.homedir = () => path.join(root, "home");
    assert.deepEqual(loader.loadSettings({ cwd: root, env: {} }).rules.deny, [
      "Bash",
    ]);
    const inventory = loader.inspectSettingsSources({
      cwd: root,
      env: {},
      managedSettingsFile: path.join(root, "managed.json"),
    });
    assert.equal(inventory.sources.length, 4);
    const project = inventory.sources.find((source) => source.exists);
    assert.deepEqual(project.settings.permissions.deny, ["Bash"]);
    assert.match(project.digest, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(project.settings.permissions.deny));
    const { createPermissionRulesProvider } =
      await import("../../src/lib/permission-authority.js");
    const provider = createPermissionRulesProvider({
      cwd: root,
      env: {},
      baseRules: { allow: [], ask: [], deny: ["Bash"] },
    });
    assert.deepEqual(provider().rules.deny, ["Bash"]);
    assert.ok(helpers.every((file) => !require.cache[file]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
