import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const action = fs.readFileSync(
  new URL("../../.github/actions/setup-node-deps/action.yml", import.meta.url),
  "utf8",
);
const firstRun = action.match(/      run: \|\r?\n((?:        .*\r?\n)+)/)?.[1];
assert.ok(firstRun, "The shared dependency action must have an install script");
const installScript = firstRun
  .replace(/^        /gm, "")
  .replace("${{ inputs.install-command }}", "node install-fixture.cjs");

function runInstall(t, { lock = "transient", failEveryInstall = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-npm-retry-"));
  t.after(() => {
    // Only remove the fixture directory created above, never the checkout.
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(directory, "keep.txt"), "outside node_modules");
  fs.writeFileSync(
    path.join(directory, "install-fixture.cjs"),
    `const fs = require('node:fs');
const attempt = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts', 'utf8')) + 1 : 1;
fs.writeFileSync('attempts', String(attempt));
if (attempt > 1 && fs.existsSync('node_modules')) throw new Error('Retry used a partial dependency tree');
if (attempt === 1 || process.env.FAIL_EVERY_INSTALL === 'true') {
  fs.mkdirSync('node_modules/pkcs11js', { recursive: true });
  process.exitCode = 42;
}
`,
  );
  fs.writeFileSync(
    path.join(directory, "lock-fixture.cjs"),
    `const fs = require('node:fs');
const path = require('node:path');
const locked = path.join(process.cwd(), 'node_modules', 'pkcs11js');
let attempts = 0;
function blocked(target) {
  if (path.resolve(String(target)) !== locked) return false;
  if (!fs.existsSync('sleeps')) throw new Error('Cleanup ran before the install backoff');
  attempts++;
  fs.appendFileSync('cleanup-attempts', 'busy-check\\n');
  return process.env.LOCK_MODE === 'persistent' || attempts === 1;
}
const rmdir = fs.rmdir;
fs.rmdir = function(target, ...args) {
  if (blocked(target)) return process.nextTick(args.at(-1), Object.assign(new Error('fixture directory busy'), { code: 'EBUSY' }));
  return rmdir.call(this, target, ...args);
};
// The old synchronous cleanup must fail under the same injected lock.
const rmdirSync = fs.rmdirSync;
fs.rmdirSync = function(target, ...args) {
  if (blocked(target)) throw Object.assign(new Error('fixture directory busy'), { code: 'EBUSY' });
  return rmdirSync.call(this, target, ...args);
};
// Keep the bounded persistent-lock case fast; preserve all retry callbacks.
const timers = require('node:timers');
const setTimeout = timers.setTimeout;
timers.setTimeout = (fn, delay, ...args) => setTimeout(fn, Math.min(delay, 1), ...args);
`,
  );
  fs.writeFileSync(
    path.join(directory, "install.sh"),
    // Record backoff without waiting 15/30 seconds. The cleanup function must
    // see the backoff first, just as it would after npm releases native locks.
    `sleep() { printf '%s\\n' "$1" >> sleeps; }\n${installScript}`,
  );
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", "install.sh"],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        NODE_OPTIONS: "--require ./lock-fixture.cjs",
        LOCK_MODE: lock,
        FAIL_EVERY_INSTALL: String(failEveryInstall),
      },
    },
  );
  assert.ifError(result.error);
  assert.equal(
    fs.readFileSync(path.join(directory, "keep.txt"), "utf8"),
    "outside node_modules",
  );
  return {
    ...result,
    attempts: Number(fs.readFileSync(path.join(directory, "attempts"), "utf8")),
    sleeps: fs
      .readFileSync(path.join(directory, "sleeps"), "utf8")
      .trim()
      .split("\n"),
    cleanupAttempts: fs
      .readFileSync(path.join(directory, "cleanup-attempts"), "utf8")
      .trim()
      .split("\n").length,
  };
}

test("dependency install retries after a transient native-directory EBUSY and cleans the partial tree", (t) => {
  const result = runInstall(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.sleeps, ["15"]);
  assert.ok(result.cleanupAttempts >= 2);
});

test("dependency install fails closed when the native directory remains locked", (t) => {
  const result = runInstall(t, { lock: "persistent" });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.sleeps, ["15"]);
  assert.ok(result.cleanupAttempts > 1 && result.cleanupAttempts < 100);
  assert.match(result.stdout, /Cannot clean partial node_modules/);
});

test("dependency install preserves the three-attempt failure limit", (t) => {
  const result = runInstall(t, { failEveryInstall: true });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.sleeps, ["15", "30"]);
  assert.match(result.stdout, /npm install failed after 3 attempts/);
});
