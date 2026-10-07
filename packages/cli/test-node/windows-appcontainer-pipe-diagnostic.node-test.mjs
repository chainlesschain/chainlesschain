import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectNativePipeDiagnosticExecution,
  inspectPipeDiagnosticOutput,
  PIPE_DIAGNOSTIC_UPSTREAM,
} from "../scripts/windows-appcontainer-pipe-diagnostic.mjs";

const labels = [
  "libuv-name-1",
  "libuv-name-2",
  "libuv-name-3",
  "local-dot",
  "local-extended",
  "nul-stdin",
];
function records(appContainer = 1) {
  return labels.map((label) => ({
    label,
    pid: 200,
    tokenIsAppContainer: appContainer,
    success: appContainer === 0 || label.startsWith("local-"),
    win32Error: appContainer === 0 || label.startsWith("local-") ? 0 : 5,
    handleClosed: true,
    elapsedMs: 1,
  }));
}
const apiOutput = (rows) =>
  rows.map((row) => "CC_PIPE_API:" + JSON.stringify(row)).join("\n") + "\n";
function sample() {
  const manifestDigest = "sha256:" + "a".repeat(64);
  const settlement = {
    manifestDigest: manifestDigest.slice(7),
    cleanupConfirmed: true,
    capabilityCount: 0,
    loopbackExemptionAbsent: true,
    targetPid: 100,
    targetExitCode: 0,
    executionFailed: false,
  };
  const child =
    "CC_PIPE_CHILD:" +
    JSON.stringify({ pid: 100, status: 0, signal: null, errorCode: null });
  const files = ["ignore-stdin", "inherit-stdin", "file-stdin"].map(
    (mode) =>
      "CC_FILE_STDIO:" +
      JSON.stringify({
        mode,
        pid: 100,
        status: mode === "ignore-stdin" ? null : 0,
        signal: null,
        errorCode: mode === "ignore-stdin" ? "EPERM" : null,
        output:
          mode === "ignore-stdin"
            ? ""
            : JSON.stringify({ marker: "file-child-ok", pid: 300 }),
      }),
  );
  return {
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: apiOutput(records()) + [child, ...files].join("\n") + "\n",
    },
    settlement,
    manifestDigest,
  };
}

test("keeps host controls distinct from native Win32 error observations", () => {
  assert.equal(
    inspectPipeDiagnosticOutput(apiOutput(records(0)), {
      appContainer: 0,
    }).every((row) => row.success),
    true,
  );
  const s = sample();
  const result = inspectNativePipeDiagnosticExecution(
    s.execution,
    s.settlement,
    s.manifestDigest,
  );
  assert.deepEqual(
    result.records.map((row) => row.win32Error),
    [5, 5, 5, 0, 0, 5],
  );
  assert.deepEqual(
    result.fileStdio.map((row) => row.errorCode),
    ["EPERM", null, null],
  );
  assert.equal(Object.hasOwn(result, "capabilities"), false);
});

for (const [name, change] of [
  [
    "root identity",
    (rows) => {
      rows[0].pid = 100;
    },
  ],
  [
    "mixed identity",
    (rows) => {
      rows[1].pid = 201;
    },
  ],
  [
    "host impersonation",
    (rows) => {
      rows[0].tokenIsAppContainer = 0;
    },
  ],
  [
    "open handle",
    (rows) => {
      rows[0].handleClosed = false;
    },
  ],
  [
    "fake error",
    (rows) => {
      rows[0].win32Error = 0;
    },
  ],
  [
    "fake success",
    (rows) => {
      rows[0].success = true;
    },
  ],
  ["duplicate", (rows) => rows.push(rows[0])],
  ["missing", (rows) => rows.pop()],
  ["reordered", (rows) => rows.reverse()],
])
  test(`rejects ${name} API records`, () => {
    const rows = records();
    change(rows);
    assert.throws(() =>
      inspectPipeDiagnosticOutput(apiOutput(rows), {
        appContainer: 1,
        targetPid: 100,
      }),
    );
  });

for (const field of ["cleanupConfirmed", "loopbackExemptionAbsent"])
  test(`rejects unconfirmed ${field}`, () => {
    const s = sample();
    s.settlement[field] = false;
    assert.throws(
      () =>
        inspectNativePipeDiagnosticExecution(
          s.execution,
          s.settlement,
          s.manifestDigest,
        ),
      /unconfirmed/,
    );
  });

test("rejects timeout, grants, substituted manifest and missing child/file records", () => {
  for (const change of [
    (s) => {
      s.execution.status = 125;
    },
    (s) => {
      s.settlement.capabilityCount = 1;
    },
    (s) => {
      s.settlement.manifestDigest = "b".repeat(64);
    },
    (s) => {
      s.execution.stdout = apiOutput(records());
    },
    (s) => {
      s.execution.stdout += "unexpected\n";
    },
    (s) => {
      s.execution.stdout = s.execution.stdout.replace(
        '"status":0',
        '"status":84',
      );
    },
    (s) => {
      s.execution.stdout = s.execution.stdout.replaceAll(
        '\\"pid\\":300',
        '\\"pid\\":100',
      );
    },
  ]) {
    const s = sample();
    change(s);
    assert.throws(() =>
      inspectNativePipeDiagnosticExecution(
        s.execution,
        s.settlement,
        s.manifestDigest,
      ),
    );
  }
});

test("pins the investigated upstream release and the two independent code paths", () => {
  assert.equal(PIPE_DIAGNOSTIC_UPSTREAM.nodeVersion, "v22.22.2");
  assert.equal(PIPE_DIAGNOSTIC_UPSTREAM.libuvVersion, "1.51.0");
  assert.match(PIPE_DIAGNOSTIC_UPSTREAM.nodeCommit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(
    PIPE_DIAGNOSTIC_UPSTREAM.sources.map((item) => item.path),
    ["deps/uv/src/win/pipe.c", "deps/uv/src/win/process-stdio.c"],
  );
  for (const entry of PIPE_DIAGNOSTIC_UPSTREAM.sources)
    assert.match(entry.sha256, /^sha256:[a-f0-9]{64}$/u);
});
