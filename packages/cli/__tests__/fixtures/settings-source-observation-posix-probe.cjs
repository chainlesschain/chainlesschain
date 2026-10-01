"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  observeSettingsSource,
  observeSettingsSources,
} = require("../../src/lib/settings-source-observation.cjs");
const loader = require("../../src/lib/settings-loader.cjs");
assert.notEqual(
  process.platform,
  "win32",
  "This probe requires POSIX filesystem semantics",
);
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-settings-source-posix-"),
);
const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
}
function write(name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return file;
}
try {
  const bytes = '{"permissions":{"allow":["Read"]}}\n';
  const file = write("first/settings.json", bytes);
  check("exact-byte-digest-and-frozen-parse", () => {
    const observed = observeSettingsSource(file);
    assert.equal(
      observed.digest,
      crypto.createHash("sha256").update(bytes).digest("hex"),
    );
    assert.deepEqual(observed.settings.permissions.allow, ["Read"]);
    assert.ok(Object.isFrozen(observed.settings.permissions.allow));
  });
  check("real-posix-atomic-replace-during-read-is-rejected", () => {
    const replacement = write("first/replacement.json", {
      permissions: { deny: ["Read"] },
    });
    let replaced = false;
    const runtimeFs = {
      ...fs,
      readSync(...args) {
        const count = fs.readSync(...args);
        if (count && !replaced) {
          replaced = true;
          fs.renameSync(replacement, file);
        }
        return count;
      },
    };
    assert.throws(() => observeSettingsSource(file, { fs: runtimeFs }), {
      code: "CC_SETTINGS_SOURCE_CHANGED",
    });
    assert.ok(replaced);
    assert.deepEqual(observeSettingsSource(file).settings.permissions.deny, [
      "Read",
    ]);
  });
  check("real-final-file-symlink-is-rejected", () => {
    const alias = path.join(root, "file-alias.json");
    fs.symlinkSync(file, alias);
    assert.throws(() => observeSettingsSource(alias), {
      code: "CC_SETTINGS_SOURCE_UNSAFE",
    });
  });
  check("real-directory-alias-keeps-logical-and-physical-binding", () => {
    const alias = path.join(root, "directory-alias");
    fs.symlinkSync(path.dirname(file), alias, "dir");
    const sources = observeSettingsSources([
      file,
      path.join(alias, "settings.json"),
    ]);
    assert.notEqual(sources[0].logicalPath, sources[1].logicalPath);
    assert.equal(sources[0].physicalPath, sources[1].physicalPath);
    assert.equal(sources[0].digest, sources[1].digest);
  });
  check("real-hardlink-is-rejected", () => {
    const target = write("hardlink-source.json", {});
    fs.linkSync(target, path.join(root, "hardlink-alias.json"));
    assert.throws(() => observeSettingsSource(target), {
      code: "CC_SETTINGS_SOURCE_UNSAFE",
    });
  });
  check("missing-parent-and-future-physical-target-are-retained", () => {
    const missing = path.join(root, "missing", "settings.json");
    const observed = observeSettingsSource(missing);
    assert.equal(observed.exists, false);
    assert.equal(observed.nearestExistingParent, fs.realpathSync(root));
    assert.equal(observed.remainingPath, path.join("missing", "settings.json"));
    assert.equal(observed.digest, null);
  });
  check("ENOTDIR-is-not-accepted-as-absence", () => {
    const parent = write("regular-parent", "file");
    assert.throws(
      () => observeSettingsSource(path.join(parent, "child.json")),
      { code: "CC_SETTINGS_SOURCE_UNSAFE" },
    );
  });
  check("invalid-utf8-is-rejected", () => {
    const invalid = path.join(root, "invalid.json");
    fs.writeFileSync(
      invalid,
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    );
    assert.throws(() => observeSettingsSource(invalid), {
      code: "CC_SETTINGS_SOURCE_INVALID",
    });
  });
  check(
    "complete-candidate-inventory-keeps-non-contributing-and-managed-sources",
    () => {
      const projectFile = write("project/.claude/settings.json", {
        env: { TOOL_DEFAULT: "yes" },
      });
      const cwd = path.join(root, "project", "nested");
      fs.mkdirSync(cwd);
      fs.mkdirSync(path.join(root, "project", ".git"));
      loader._deps.homedir = () => path.join(root, "home");
      const explicit = write("explicit.json", {});
      const inventory = loader.inspectSettingsSources({
        cwd,
        settingsFile: explicit,
        managedSettingsFile: path.join(root, "managed.json"),
        env: {},
      });
      assert.equal(inventory.sources.length, 7);
      assert.equal(
        inventory.sources.filter((source) => source.exists).length,
        2,
      );
      assert.equal(inventory.sources[1].logicalPath, projectFile);
      assert.equal(inventory.sources.at(-1).exists, false);
    },
  );
  const writeBridgeLoaded = [
    "durable-security-store.js",
    "with-file-lock.js",
  ].some((name) => require.cache[require.resolve(`../../src/lib/${name}`)]);
  assert.equal(writeBridgeLoaded, false);
  process.stdout.write(
    JSON.stringify({
      platform: process.platform,
      node: process.version,
      passed: checks.length,
      checks,
      writeBridgeLoaded,
    }) + "\n",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
