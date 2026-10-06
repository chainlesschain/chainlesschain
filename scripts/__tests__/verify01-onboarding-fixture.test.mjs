import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createOnboardingFixture } from "../lib/verify01-onboarding-fixture.mjs";

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
