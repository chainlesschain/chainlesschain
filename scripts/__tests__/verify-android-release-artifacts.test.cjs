"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("failed real verifier preserves named diagnostics only in a sanitized upload directory", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "android-diagnostics-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const diagnostics = path.join(root, "diagnostics");
  fs.mkdirSync(diagnostics);
  const password = "fixture-password-not-a-release-credential";
  const alias = "fixture-alias-not-a-release-credential";
  const rawReport = `tool failure with ${password} and ${alias}\n`;
  fs.writeFileSync(path.join(diagnostics, "tool-report.txt"), rawReport);
  const helper = path.resolve(
    __dirname,
    "../ci/verify-android-release-artifacts.sh",
  );
  const shellPath = (file) => file.replace(/\\/g, "/");
  const bash =
    process.platform === "win32"
      ? path.join(
          process.env.ProgramFiles || "C:/Program Files",
          "Git/usr/bin/bash.exe",
        )
      : "bash";
  const result = spawnSync(
    bash,
    [shellPath(helper), shellPath(root), shellPath(diagnostics)],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SIGNING_TYPE: "debug",
        KEYSTORE_PASSWORD: password,
        KEY_ALIAS: alias,
      },
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /stage release-signing-mode/, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(diagnostics, "tool-report.txt"), "utf8"),
    rawReport,
  );
  const sanitized = path.join(diagnostics, "sanitized");
  assert.match(
    fs.readFileSync(path.join(sanitized, "failure.txt"), "utf8"),
    /stage=release-signing-mode/,
  );
  for (const report of fs.readdirSync(sanitized)) {
    const text = fs.readFileSync(path.join(sanitized, report), "utf8");
    assert.ok(!text.includes(password) && !text.includes(alias));
  }
  assert.match(
    fs.readFileSync(path.join(sanitized, "tool-report.txt"), "utf8"),
    /\*\*\*/,
  );
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(alias));
});
