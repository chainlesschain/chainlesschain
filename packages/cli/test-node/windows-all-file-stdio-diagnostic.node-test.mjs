import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  ALL_FILE_CHECK_SOURCE,
  ALL_FILE_CHILD_SOURCE,
  inspectAllFileExecution,
} from "../scripts/windows-all-file-stdio-diagnostic.mjs";

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const input = Buffer.from([0, 255, 10, 13, 1, 127]);
function sample() {
  const child = {
    marker: "all-file-child-ok",
    pid: 200,
    parentPid: 100,
    inputBytes: input.length,
    inputDigest: digest(input),
    runtime: "private/node.exe",
    nodeVersion: "v22.22.2",
    libuvVersion: "1.51.0",
  };
  const record = {
    mode: "file-file-file",
    pid: 100,
    status: 0,
    signal: null,
    errorCode: null,
    descriptorsClosed: 3,
    stdout: JSON.stringify(child) + "\n",
    stderr: "all-file-stderr-ok\n",
  };
  return {
    manifestDigest: "sha256:" + "a".repeat(64),
    settlement: {
      manifestDigest: "a".repeat(64),
      cleanupConfirmed: true,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      executionFailed: false,
      targetExitCode: 0,
      targetPid: 100,
    },
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: "CC_ALL_FILE_STDIO:" + JSON.stringify(record) + "\n",
      stderr: "",
    },
    runtime: {
      path: child.runtime,
      nodeVersion: child.nodeVersion,
      libuvVersion: child.libuvVersion,
    },
    input: { bytes: input.length, digest: digest(input) },
  };
}
function editRecord(s, edit) {
  const row = JSON.parse(s.execution.stdout.slice("CC_ALL_FILE_STDIO:".length));
  edit(row);
  s.execution.stdout = "CC_ALL_FILE_STDIO:" + JSON.stringify(row) + "\n";
}
function editChild(s, edit) {
  editRecord(s, (row) => {
    const child = JSON.parse(row.stdout);
    edit(child);
    row.stdout = JSON.stringify(child) + "\n";
  });
}

test("binds actual stdin digest and both output channels without granting capability", () => {
  const result = inspectAllFileExecution(sample());
  assert.equal(result.diagnosticCompleted, true);
  assert.deepEqual(result.capabilities, {});
  assert.equal(result.child.inputDigest, digest(input));
});

for (const [name, change] of [
  [
    "missing stdin bytes",
    (s) =>
      editChild(s, (c) => {
        c.inputBytes = 0;
      }),
  ],
  [
    "substituted stdin content",
    (s) =>
      editChild(s, (c) => {
        c.inputDigest = digest("different");
      }),
  ],
  [
    "wrong child parent",
    (s) =>
      editChild(s, (c) => {
        c.parentPid++;
      }),
  ],
  [
    "same child as evaluator",
    (s) =>
      editChild(s, (c) => {
        c.pid = 100;
      }),
  ],
  [
    "substituted runtime",
    (s) =>
      editChild(s, (c) => {
        c.runtime = "host/node.exe";
      }),
  ],
  [
    "wrong runtime version",
    (s) =>
      editChild(s, (c) => {
        c.nodeVersion = "v24.0.0";
      }),
  ],
  [
    "lost stderr",
    (s) =>
      editRecord(s, (r) => {
        r.stderr = "";
      }),
  ],
  [
    "ignore mode",
    (s) =>
      editRecord(s, (r) => {
        r.mode = "ignore-file-file";
      }),
  ],
  [
    "descriptor leak",
    (s) =>
      editRecord(s, (r) => {
        r.descriptorsClosed = 2;
      }),
  ],
  [
    "child failure",
    (s) =>
      editRecord(s, (r) => {
        r.status = 1;
      }),
  ],
  [
    "timeout",
    (s) =>
      editRecord(s, (r) => {
        r.errorCode = "ETIMEDOUT";
      }),
  ],
  [
    "duplicate observation",
    (s) => {
      s.execution.stdout += s.execution.stdout;
    },
  ],
  [
    "unconfirmed cleanup",
    (s) => {
      s.settlement.cleanupConfirmed = false;
    },
  ],
  [
    "granted capabilities",
    (s) => {
      s.settlement.capabilityCount = 1;
    },
  ],
  [
    "loopback exemption",
    (s) => {
      s.settlement.loopbackExemptionAbsent = false;
    },
  ],
  [
    "substituted manifest",
    (s) => {
      s.manifestDigest = "sha256:" + "b".repeat(64);
    },
  ],
])
  test(`rejects ${name}`, () => {
    const s = sample();
    change(s);
    assert.throws(() => inspectAllFileExecution(s));
  });

test("real host control transports binary input and both outputs through file descriptors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-all-file-contract-"));
  const workspace = path.join(root, "workspace"),
    scratch = path.join(root, "scratch");
  try {
    fs.mkdirSync(workspace);
    fs.mkdirSync(scratch);
    fs.writeFileSync(path.join(workspace, "child.cjs"), ALL_FILE_CHILD_SOURCE);
    fs.writeFileSync(path.join(workspace, "input.bin"), input);
    const check = path.join(root, "check.cjs");
    fs.writeFileSync(check, ALL_FILE_CHECK_SOURCE);
    const result = spawnSync(process.execPath, [check, workspace, scratch], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const row = JSON.parse(result.stdout.slice("CC_ALL_FILE_STDIO:".length));
    assert.equal(row.status, 0);
    assert.equal(row.descriptorsClosed, 3);
    assert.equal(row.stderr, "all-file-stderr-ok\n");
    const child = JSON.parse(row.stdout);
    assert.equal(child.inputBytes, input.length);
    assert.equal(child.inputDigest, digest(input));
    assert.equal(child.parentPid, row.pid);
    // This host fixture is deliberately not passed off as native attestation.
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
