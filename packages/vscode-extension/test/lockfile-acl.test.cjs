"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lockfile = require("../src/lockfile.js");

const original = {
  homedir: lockfile._deps.homedir,
  platform: lockfile._deps.platform,
  chmodSync: lockfile._deps.chmodSync,
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chainlesschain-lockfile-"));
lockfile._deps.homedir = () => root;
lockfile._deps.platform = () => "linux";
lockfile._deps.chmodSync = () => {
  throw new Error("simulated chmod failure");
};

try {
  assert.throws(
    () =>
      lockfile.writeLock({
        port: 43124,
        token: "a".repeat(64),
      }),
    /simulated chmod failure/,
    "default lockfile publication must fail closed",
  );

  const published = lockfile.writeLock({
    port: 43125,
    token: "b".repeat(64),
    allowInsecurePermissions: true,
  });
  assert.equal(fs.existsSync(published), true);
  assert.equal(JSON.parse(fs.readFileSync(published, "utf8")).token, "b".repeat(64));
  console.log("lockfile-acl: 3 assertions passed");
} finally {
  lockfile._deps.homedir = original.homedir;
  lockfile._deps.platform = original.platform;
  lockfile._deps.chmodSync = original.chmodSync;
  fs.rmSync(root, { recursive: true, force: true });
}
