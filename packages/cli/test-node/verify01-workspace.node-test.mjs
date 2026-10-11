import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  seedVerify01Deliverables,
  snapshotVerify01Workspace as snapshot,
  diffVerify01Workspace as diff,
} from "../src/lib/eval/verify01-workspace.js";

function temporary(t) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workspace-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const budget = { remainingMs: () => 10000 };

test("diagnostic bootstraps from source outside the repository without npm dependencies or Node hooks", (t) => {
  const root = temporary(t);
  const cli = fileURLToPath(new URL("../", import.meta.url));
  const isolatedCli = path.join(root, "packages/cli");
  for (const directory of ["src", "scripts"])
    fs.cpSync(path.join(cli, directory), path.join(isolatedCli, directory), {
      recursive: true,
    });
  fs.cpSync(
    path.join(cli, "../../scripts/lib"),
    path.join(root, "scripts/lib"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(isolatedCli, "package.json"),
    '{"type":"module"}\n',
  );
  const result = spawnSync(
    process.execPath,
    [path.join(isolatedCli, "scripts/verify01-first-run-cli-diagnostic.mjs")],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /confirm-live/u);
});

test("trusted empty seeds cannot overwrite existing files or escape the workspace", (t) => {
  const root = temporary(t);
  const seeds = seedVerify01Deliverables(root, ["tests/answer.js"], budget);
  assert.equal(seeds[0].bytes, 0);
  assert.equal(fs.readFileSync(path.join(root, "tests/answer.js")).length, 0);
  fs.writeFileSync(path.join(root, "tests/answer.js"), "preserved");
  assert.throws(
    () => seedVerify01Deliverables(root, ["tests/answer.js"], budget),
    /EEXIST/u,
  );
  assert.throws(
    () => seedVerify01Deliverables(root, ["../answer.js"], budget),
    /relative/u,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "tests/answer.js"), "utf8"),
    "preserved",
  );
});

test("snapshots preserve additions, deletions and byte changes", (t) => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, "removed"), "old");
  fs.writeFileSync(path.join(root, "changed"), "before");
  const before = snapshot(root, budget, "before");
  fs.unlinkSync(path.join(root, "removed"));
  fs.writeFileSync(path.join(root, "changed"), "after");
  fs.writeFileSync(path.join(root, "added"), "new");
  const changes = diff(before, snapshot(root, budget, "after"));
  assert.deepEqual(
    changes.map((change) => change.path),
    ["added", "changed", "removed"],
  );
  assert.equal(changes[0].before, null);
  assert.equal(changes[2].after, null);
  assert.equal(
    Buffer.from(changes[1].after.bytesBase64, "base64").toString(),
    "after",
  );
});

test("dependency bodies larger than 16 MiB are fingerprinted without body copies", (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, "node_modules"));
  const file = path.join(root, "node_modules/large.bin");
  fs.writeFileSync(file, Buffer.alloc(17 * 1024 * 1024, 1));
  const before = snapshot(root, budget, "before");
  fs.writeFileSync(file, Buffer.alloc(17 * 1024 * 1024, 2));
  const after = snapshot(root, budget, "after");
  assert.equal(before.dependencyBoundary.bytes, 17 * 1024 * 1024);
  assert.notEqual(
    before.dependencyBoundary.digest,
    after.dependencyBoundary.digest,
  );
  const [change] = diff(before, after);
  assert.equal(change.after.bytesBase64, null);
  assert.equal(change.after.dependency, true);
});

test("dependency links outside the workspace are rejected", (t) => {
  const root = temporary(t);
  const outside = temporary(t);
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(
    outside,
    path.join(root, "node_modules/external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => snapshot(root, budget, "scan"), /escapes/u);
});

test("expired deadlines prevent seed creation and stop snapshots", (t) => {
  const root = temporary(t);
  const expired = {
    remainingMs: () => {
      throw new Error("deadline expired");
    },
  };
  assert.throws(
    () => seedVerify01Deliverables(root, ["answer.js"], expired),
    /deadline/u,
  );
  assert.equal(fs.existsSync(path.join(root, "answer.js")), false);
  fs.writeFileSync(path.join(root, "existing"), "data");
  assert.throws(() => snapshot(root, expired, "scan"), /deadline/u);
});
