import test from "node:test";
import assert from "node:assert/strict";
import { inspectRealpathApiExecution } from "../scripts/windows-realpath-api-diagnostic.mjs";

function sample() {
  const rows = [
    "scratch-libuv",
    "workspace-libuv",
    "scratch-shared",
    "workspace-shared",
  ].map((label, index) => ({
    label,
    pid: 200,
    tokenIsAppContainer: 1,
    share: index < 2 ? 0 : 7,
    handleClosed: true,
    openSucceeded: true,
    openError: 0,
    queries: ["normalized-dos", "opened-dos", "normalized-nt"].map(
      (kind, i) => {
        const path =
          i === 2 ? "\\Device\\HarddiskVolume3\\private\\scratch\\tmp" : "";
        return {
          kind,
          flags: [0, 8, 2][i],
          success: i === 2,
          win32Error: i === 2 ? 0 : 5,
          length: path.length,
          path,
        };
      },
    ),
  }));
  const child = {
    pid: 100,
    fixturePid: 200,
    status: 0,
    signal: null,
    error: null,
  };
  return {
    rows,
    child,
    execution: { status: 0, signal: null, error: null, stderr: "" },
    settlement: {
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      targetPid: 100,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      manifestDigest: "a".repeat(64),
    },
    digest: "sha256:" + "a".repeat(64),
  };
}
function inspect(s) {
  s.execution.stdout =
    s.rows
      .map((row) => "CC_REALPATH_API:" + JSON.stringify(row) + "\n")
      .join("") +
    "CC_REALPATH_CHILD:" +
    JSON.stringify(s.child) +
    "\n";
  return inspectRealpathApiExecution(s.execution, s.settlement, s.digest);
}
test("retains denied DOS and successful normalized NT outcomes as distinct observations", () => {
  assert.equal(inspect(sample())[0].queries[2].success, true);
});
test("can observe an open failure without converting it into a canonical success", () => {
  const s = sample();
  s.rows[0].openSucceeded = false;
  s.rows[0].openError = 5;
  for (const q of s.rows[0].queries)
    Object.assign(q, { success: false, win32Error: 5, length: 0, path: "" });
  assert.equal(inspect(s)[0].openSucceeded, false);
});
for (const [name, edit] of [
  [
    "missing control",
    (s) => {
      s.rows.pop();
    },
  ],
  [
    "extra control",
    (s) => {
      s.rows.push(s.rows[0]);
    },
  ],
  [
    "control reorder",
    (s) => {
      [s.rows[0], s.rows[1]] = [s.rows[1], s.rows[0]];
    },
  ],
  [
    "control label substitution",
    (s) => {
      s.rows[0].label = "other";
    },
  ],
  [
    "fixture PID mismatch",
    (s) => {
      s.rows[1].pid++;
    },
  ],
  [
    "parent PID used as fixture",
    (s) => {
      s.rows[0].pid = 100;
    },
  ],
  [
    "unbound spawned process",
    (s) => {
      s.child.fixturePid++;
    },
  ],
  [
    "missing child status",
    (s) => {
      delete s.child.status;
    },
  ],
  [
    "child nonzero exit",
    (s) => {
      s.child.status = 84;
    },
  ],
  [
    "supervisor PID mismatch",
    (s) => {
      s.child.pid++;
    },
  ],
  [
    "non AppContainer token",
    (s) => {
      s.rows[0].tokenIsAppContainer = 0;
    },
  ],
  [
    "wrong libuv share mode",
    (s) => {
      s.rows[0].share = 7;
    },
  ],
  [
    "unclosed handle",
    (s) => {
      s.rows[0].handleClosed = false;
    },
  ],
  [
    "missing query",
    (s) => {
      s.rows[0].queries.pop();
    },
  ],
  [
    "wrong flags",
    (s) => {
      s.rows[0].queries[2].flags = 8;
    },
  ],
  [
    "wrong canonical kind",
    (s) => {
      s.rows[0].queries[2].kind = "opened-nt";
    },
  ],
  [
    "success with error",
    (s) => {
      s.rows[0].queries[2].win32Error = 5;
    },
  ],
  [
    "failure with path",
    (s) => {
      s.rows[0].queries[0].path = "guessed";
    },
  ],
  [
    "success length mismatch",
    (s) => {
      s.rows[0].queries[2].length++;
    },
  ],
  [
    "oversized result",
    (s) => {
      s.rows[0].queries[2].length = 32768;
    },
  ],
  [
    "nonzero target exit",
    (s) => {
      s.execution.status = 1;
    },
  ],
  [
    "unexpected stderr",
    (s) => {
      s.execution.stderr = "error";
    },
  ],
  [
    "unconfirmed cleanup",
    (s) => {
      s.settlement.cleanupConfirmed = false;
    },
  ],
  [
    "network capability",
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
    "manifest substitution",
    (s) => {
      s.settlement.manifestDigest = "b".repeat(64);
    },
  ],
  [
    "unbound manifest digest",
    (s) => {
      s.digest = "";
    },
  ],
])
  test(`rejects ${name}`, () => {
    const s = sample();
    edit(s);
    assert.throws(() => inspect(s), /Native realpath diagnostic/);
  });
