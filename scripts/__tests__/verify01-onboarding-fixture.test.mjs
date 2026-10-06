import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createOnboardingFixture,
  isolateOnboardingEnvironment,
} from "../lib/verify01-onboarding-fixture.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc identity's "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(
    ["home", "capture", "bin"].map((name) => [name, path.join(root, name)]),
  );
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  return {
    root,
    dirs,
    ...createOnboardingFixture({ root, dirs, version: "0.166.90" }),
  };
}

function run(command, args = ["--version"], env = process.env) {
  return spawnSync(
    process.platform === "win32" ? `"${command}"` : command,
    args,
    {
      shell: process.platform === "win32",
      windowsHide: true,
      encoding: "utf8",
      env,
    },
  );
}

test("actual explicit/global identity replacement leaves the managed command valid", (t) => {
  const f = fixture(t);
  assert.equal(run(f.goodCommand).stdout.trim(), "0.166.90");
  fs.writeFileSync(f.mode, "gcc");
  assert.equal(run(f.goodCommand).stdout.trim(), "cc (GCC) 12.2.0");
  assert.equal(run(f.globalCommand).stdout.trim(), "cc (GCC) 12.2.0");
  assert.equal(run(f.managedCommand).stdout.trim(), "0.166.90");
  const rejected = run(f.goodCommand, ["agent"]);
  assert.equal(rejected.status, 98);
  assert.match(rejected.stderr, /Agent invocation forbidden/u);
  const records = fs
    .readFileSync(f.trace, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.length, 5);
  assert.ok(
    records.some((r) => r.identity === "managed" && r.mode === "valid"),
  );
});

test("isolated PATH observes removal and repair without resolving a system compiler", (t) => {
  const f = fixture(t);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^path$/iu.test(key)) delete env[key];
  env.PATH = f.idePath;
  assert.equal(run("cc", ["--version"], env).stdout.trim(), "0.166.90");
  fs.renameSync(f.globalCommand, `${f.globalCommand}.disabled`);
  for (const alias of ["cc", "chainlesschain", "clc", "clchain"])
    assert.notEqual(run(alias, ["--version"], env).status, 0, alias);
  fs.renameSync(`${f.globalCommand}.disabled`, f.globalCommand);
  assert.equal(run("cc", ["--version"], env).stdout.trim(), "0.166.90");
  assert.equal(
    run(f.managedCommand, ["--version"], env).stdout.trim(),
    "0.166.90",
  );
});

test("non-version banners cannot configure a fixture CLI", (t) => {
  const f = fixture(t);
  assert.throws(
    () => createOnboardingFixture({ ...f, version: "cc (GCC) 12.2.0" }),
    /bare fixture CLI version/u,
  );
});

test("PATH augmentation cannot resolve an alternate installed CLI name", (t) => {
  const f = fixture(t);
  const trap = path.join(f.root, "ambient-bin");
  fs.mkdirSync(trap);
  fs.copyFileSync(
    f.goodCommand,
    path.join(
      trap,
      process.platform === "win32" ? "chainlesschain.cmd" : "chainlesschain",
    ),
  );
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^path$/iu.test(key)) delete env[key];
  env.PATH = `${f.idePath}${path.delimiter}${trap}`;
  const output = run("chainlesschain", ["--version"], env);
  assert.equal(output.status, 127);
  assert.match(output.stderr, /fixture command not found/u);
  assert.equal(output.stdout.trim(), "");
});

test("manager-path isolation preserves build PATH and the caller's environment", () => {
  const base = {
    PATH: "original-build-path",
    NVM_BIN: "real-cli",
    NVM_SYMLINK: "real-cli",
    VOLTA_HOME: "real-cli",
    FNM_MULTISHELL_PATH: "real-cli",
    JAVA_HOME: "jdk",
    HOME: "user-home",
    PROGRAMFILES: "ambient-global-cli",
  };
  const isolated = isolateOnboardingEnvironment(base, "private-home");
  assert.equal(isolated.PATH, base.PATH);
  assert.equal(isolated.JAVA_HOME, base.JAVA_HOME);
  assert.equal(isolated.HOME, "private-home");
  for (const key of [
    "NVM_BIN",
    "NVM_SYMLINK",
    "VOLTA_HOME",
    "FNM_MULTISHELL_PATH",
  ])
    assert.equal(key in isolated, false);
  assert.equal(base.NVM_BIN, "real-cli");
  assert.equal(base.HOME, "user-home");
  assert.equal("PROGRAMFILES" in isolated, false);
  assert.notEqual(isolated.ProgramFiles, "ambient-global-cli");
});
