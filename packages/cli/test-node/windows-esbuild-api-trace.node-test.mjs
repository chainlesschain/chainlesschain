import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  digest,
  capture,
  GNU_IDENTITY,
} from "../scripts/windows-rollup-gnu-forwarder.mjs";
import {
  ESBUILD_DIGEST,
  TRACE_CHECK_SOURCE,
  inspectEsbuildTrace,
} from "../scripts/windows-esbuild-api-trace.mjs";

const directory = fileURLToPath(new URL("../scripts/", import.meta.url));
function fixture() {
  const root = "C:\\private-trace-fixture",
    workspace = path.win32.join(root, "workspace"),
    rootPid = 101,
    childPid = 102;
  const outputs = ["esbuild-trace-launcher.node", "esbuild-trace-shim.dll"].map(
    (name, index) => ({
      path: "C:\\build\\" + name,
      digest: "sha256:" + String(index + 1).repeat(64),
    }),
  );
  const checkDigest = digest(TRACE_CHECK_SOURCE),
    rows = [
      {
        api: "identity-accepted",
        patches: 0,
        success: true,
        error: 0,
        requestedPath: "",
      },
      {
        api: "installed",
        patches: 2,
        success: true,
        error: 0,
        requestedPath: "",
      },
      {
        api: "resolve:CreateFileW",
        patches: 2,
        success: true,
        error: 0,
        requestedPath: "",
      },
      {
        api: "CreateFileW",
        patches: 2,
        success: false,
        error: 5,
        requestedPath: "C:\\",
      },
      { api: "exit", patches: 2, success: true, error: 0, requestedPath: "" },
    ].map((row, index) => ({
      ...row,
      sequence: index + 1,
      pid: childPid,
      overflow: 0,
    }));
  const launcher = {
    completed: true,
    stage: "completed",
    rootPid,
    childPid,
    childExit: 1,
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7",
    capabilityCount: 0,
    exactHandles: true,
    leafRestricted: true,
    imagePinned: true,
    rootTokenProven: true,
    childTokenProven: true,
  };
  const manifest = {
    version: 2,
    root,
    workspace,
    runtime: { sha256: GNU_IDENTITY.runtimeDigest.slice(7) },
    files: [
      ["esbuild.exe", ESBUILD_DIGEST],
      ["entry.js", digest("export const answer = 42;\n")],
      ...outputs.map((row) => [
        "adapter/" + path.win32.basename(row.path),
        row.digest,
      ]),
    ].map(([file, hash]) => ({
      path: path.win32.join(workspace, file),
      sha256: hash.slice(7),
    })),
  };
  manifest.files.push({
    path: path.win32.join(root, "control/check.cjs"),
    sha256: checkDigest.slice(7),
  });
  const report = {
    schema: "chainlesschain.windows-esbuild-api-trace/v1",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    status: "NOT_ADMITTED",
    resultTranslation: false,
    checkDigest,
    esbuild: { digest: ESBUILD_DIGEST },
    runtime: { digest: GNU_IDENTITY.runtimeDigest },
    outputs,
    driver: capture(path.join(directory, "windows-esbuild-api-trace.mjs")),
    sources: [
      "windows-esbuild-trace-launcher.cpp",
      "windows-esbuild-trace-shim.cpp",
    ].map((name) => capture(path.join(directory, "diagnostics", name))),
    manifest,
    manifestDigest: digest(JSON.stringify(manifest)),
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: "CC_ESBUILD_TRACE:" + JSON.stringify(launcher) + "\n",
      stderr: 'Cannot read directory "../../..": Access is denied.',
    },
    settlement: {
      cleanupConfirmed: true,
      executionFailed: false,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      targetExitCode: 0,
      targetPid: rootPid,
      appContainerSid: launcher.appContainerSid,
      manifestDigest: digest(JSON.stringify(manifest)).slice(7),
    },
  };
  seal(report, rows);
  return { report, rows, launcher };
}
function seal(report, rows) {
  report.traceRaw = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  report.traceDigest = digest(report.traceRaw);
}
test("trace parser records a dynamic API denial while retaining NOT_ADMITTED", () => {
  const { report } = fixture();
  const result = inspectEsbuildTrace(report);
  assert.equal(result.denied[0].requestedPath, "C:\\");
  assert.equal(report.status, "NOT_ADMITTED");
});
for (const [label, mutate] of [
  ["admission claim", (r) => (r.admissionEligible = true)],
  ["result translation", (r) => (r.resultTranslation = true)],
  [
    "source substitution",
    (r) => (r.sources[0].digest = "sha256:" + "9".repeat(64)),
  ],
  [
    "different executable",
    (r) => (r.esbuild.digest = "sha256:" + "9".repeat(64)),
  ],
  ["missing cleanup", (r) => (r.settlement.cleanupConfirmed = false)],
  ["capability added", (r) => (r.settlement.capabilityCount = 1)],
  ["root failed", (r) => (r.execution.status = 2)],
  ["manifest tamper", (r) => r.manifest.files.pop()],
  ["trace digest tamper", (r) => (r.traceRaw += "\n")],
  [
    "empty trace",
    (r) => {
      r.traceRaw = "";
      r.traceDigest = digest("");
    },
  ],
]) {
  test("trace parser rejects " + label, () => {
    const { report } = fixture();
    mutate(report);
    assert.throws(() => inspectEsbuildTrace(report));
  });
}
for (const [label, mutate] of [
  ["no installed shim", (rows) => rows.splice(1, 1)],
  ["no dynamic resolution", (rows) => rows.splice(2, 1)],
  ["no actual rejection", (rows) => (rows[3].success = true)],
  ["different Windows error", (rows) => (rows[3].error = 2)],
  ["different process", (rows) => (rows[3].pid = 103)],
  ["incomplete patch", (rows) => (rows[3].patches = 1)],
  ["truncated trace", (rows) => (rows[3].overflow = 1)],
  ["missing exit", (rows) => rows.pop()],
]) {
  test("trace parser rejects resealed " + label, () => {
    const { report, rows } = fixture();
    mutate(rows);
    seal(report, rows);
    assert.throws(() => inspectEsbuildTrace(report));
  });
}
for (const [label, mutate] of [
  [
    "DLL init failure",
    (value) => {
      value.completed = false;
      value.stage = "process-loader-status";
      value.childExit = 0xc0000142;
    },
  ],
  ["child token not proven", (value) => (value.childTokenProven = false)],
  ["root token not proven", (value) => (value.rootTokenProven = false)],
  ["unrestricted child", (value) => (value.leafRestricted = false)],
  ["broad handles", (value) => (value.exactHandles = false)],
  [
    "different child SID",
    (value) => (value.appContainerSid = "S-1-15-2-7-6-5-4-3-2-1"),
  ],
]) {
  test("trace parser rejects launcher " + label, () => {
    const { report, launcher } = fixture();
    mutate(launcher);
    report.execution.stdout =
      "CC_ESBUILD_TRACE:" + JSON.stringify(launcher) + "\n";
    assert.throws(() => inspectEsbuildTrace(report));
  });
}

test("trace parser rejects supervisor execution failure", () => {
  const { report } = fixture();
  report.settlement.executionFailed = true;
  assert.throws(() => inspectEsbuildTrace(report));
});
test("trace parser rejects unrelated stderr", () => {
  const { report } = fixture();
  report.execution.stderr = "unexpected native loader error";
  assert.throws(() => inspectEsbuildTrace(report));
});
test("successful child cannot have stderr", () => {
  const { report, launcher } = fixture();
  launcher.childExit = 0;
  report.execution.stdout =
    "CC_ESBUILD_TRACE:" + JSON.stringify(launcher) + "\n";
  assert.throws(() => inspectEsbuildTrace(report));
  report.execution.stderr = "";
  assert.equal(inspectEsbuildTrace(report).launcher.childExit, 0);
});
test("trace parser rejects a resealed sequence gap", () => {
  const { report, rows } = fixture();
  rows[3].sequence = 40;
  seal(report, rows);
  assert.throws(() => inspectEsbuildTrace(report));
});
test("trace parser rejects a resealed missing redundant API record", () => {
  const { report, rows } = fixture();
  rows.splice(3, 0, { ...rows[3], sequence: 4 });
  rows.forEach((row, index) => {
    row.sequence = index + 1;
  });
  seal(report, rows);
  assert.equal(inspectEsbuildTrace(report).denied.length, 2);
  rows.splice(3, 1);
  seal(report, rows);
  assert.throws(() => inspectEsbuildTrace(report));
});
