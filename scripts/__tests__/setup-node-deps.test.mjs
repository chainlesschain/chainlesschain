import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const action = fs
  .readFileSync(
    new URL(
      "../../.github/actions/setup-node-deps/action.yml",
      import.meta.url,
    ),
    "utf8",
  )
  .replace(/\r\n/g, "\n");
const installStepName =
  "Install npm dependencies (3-attempt retry, transient ECONNRESET hardening)";

function extractInstallScript(source) {
  // Scope every check to the named composite step: earlier run blocks may use
  // another shell, and later Bash steps install different dependencies.
  const steps = source.replace(/\r\n/g, "\n").split(/^ {4}- /m);
  const matches = steps.filter((step) =>
    step.startsWith(`name: ${installStepName}\n`),
  );
  assert.equal(
    matches.length,
    1,
    "Expected exactly one npm dependency install step",
  );
  const step = matches[0];
  assert.match(
    step,
    /^ {6}shell: bash$/m,
    "The npm install step must use Bash",
  );
  assert.match(
    step,
    /^ {6}working-directory: \$\{\{ inputs\.working-directory \}\}$/m,
    "The npm install step must use the requested working directory",
  );
  const run = step.match(
    /^ {6}run: \|\n((?:(?: {8}[^\n]*)?\n| {8}[^\n]+$)+)/m,
  )?.[1];
  assert.ok(run, "The named npm install step must have a literal run script");
  const script = run.replace(/^ {8}/gm, "");
  assert.equal(
    script.split("${{ inputs.install-command }}").length - 1,
    1,
    "The npm install script must reference install-command exactly once",
  );
  return script;
}

const installScript = extractInstallScript(action).replace(
  "${{ inputs.install-command }}",
  "node install-fixture.cjs",
);

test("dependency fixture selects the named Bash install after unrelated run blocks", () => {
  const decoy = `    - name: Unrelated Bash preparation
      shell: bash
      run: |
        echo unrelated-preparation
        INSTALL_CMD="\${{ inputs.install-command }}"
`;
  const withDecoy = action.replace(
    `    - name: ${installStepName}`,
    `${decoy}    - name: ${installStepName}`,
  );
  const script = extractInstallScript(withDecoy);
  assert.equal(script, extractInstallScript(action));
  assert.match(script, /^INSTALL_CMD="\$\{\{ inputs\.install-command \}\}"/);
  assert.match(script, /cleanup_partial_install\(\)/);
  assert.doesNotMatch(script, /GITHUB_ENV|unrelated-preparation|RUNNER_OS/);
  assert.equal(
    extractInstallScript(withDecoy.replace(/\r?\n/g, "\r\n")),
    script,
  );
});

test("dependency fixture rejects missing, duplicate, or non-Bash install steps", () => {
  assert.throws(
    () =>
      extractInstallScript(
        action.replace(installStepName, "Unrelated install"),
      ),
    /exactly one npm dependency install step/,
  );
  assert.throws(
    () => extractInstallScript(`${action}\n    - name: ${installStepName}\n`),
    /exactly one npm dependency install step/,
  );
  assert.throws(
    () =>
      extractInstallScript(
        action.replace(
          `name: ${installStepName}\n      shell: bash`,
          `name: ${installStepName}\n      shell: pwsh`,
        ),
      ),
    /must use Bash/,
  );
});

test("dependency fixture cannot borrow the script from a following Bash step", () => {
  assert.throws(
    () =>
      extractInstallScript(`    - name: ${installStepName}
      shell: bash
      working-directory: \${{ inputs.working-directory }}
    - name: A different installer
      shell: bash
      run: |
        INSTALL_CMD="\${{ inputs.install-command }}"
`),
    /named npm install step must have a literal run script/,
  );
});

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
  for (const artifact of ["attempts", "sleeps", "cleanup-attempts"]) {
    assert.ok(
      fs.existsSync(path.join(directory, artifact)),
      `Install fixture did not produce ${artifact}; status=${result.status}, signal=${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
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
