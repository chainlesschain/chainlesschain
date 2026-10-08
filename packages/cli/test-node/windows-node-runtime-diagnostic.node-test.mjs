import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { evalDigest } from "../src/lib/eval/evidence.js";
import {
  inspectRuntimeAdapterResult,
  inspectRuntimeAdapterProcessReceipt,
  runtimeAdapterDiagnosticIdentity as identity,
} from "../scripts/windows-node-runtime-diagnostic.mjs";

const schema = identity.schema;
const stage = "C:\\Temp\\private-runtime";
const workspace = path.win32.join(stage, "workspace");
const scratch = path.win32.join(stage, "scratch");
const executable = path.win32.join(stage, "control/node.exe");
const sid = "S-1-15-2-1-2-3-4-5-6-7";
const inputDigest = evalDigest(
  Buffer.from(Array.from({ length: 97 }, (_, i) => (i * 17 + 5) % 256)),
).slice(7);
const rootProof = {
  dos: stage,
  nt: "\\Device\\HarddiskVolume3\\Temp\\private-runtime",
  volumeSerial: "123456",
  fileId: "0123456789abcdef0123456789abcdef",
  normalizedNtFlags: 2,
  handlePinned: true,
  ancestorAuthority: "supervisor-private-tree-guards",
  componentPolicy: "pinned-no-reparse-single-link-file-id",
};
const native = (pid, exit = false) => ({
  schema,
  experimental: true,
  admissionEligible: false,
  pid,
  appContainerSid: sid,
  capabilityCount: 0,
  inJob: true,
  state: 2,
  patches: 3,
  installError: 0,
  supportedPrivateRealpath: true,
  rootProof: structuredClone(rootProof),
  serverMapped: pid === 100 && exit ? 10 : 0,
  clientMapped: pid === 100 && exit ? 10 : 0,
  serverFailures: 0,
  clientFailures: 0,
  realpathMapped: exit ? (pid === 100 ? 2 : 1) : 0,
  realpathFallbacks: exit ? (pid === 100 ? 3 : 1) : 0,
  realpathRejected: exit && pid === 100 ? 1 : 0,
});
function fixture() {
  const adapterManifest = {
    schema,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: "22.22.2",
    nodeModuleVersion: "127",
    runtime: {
      path: "../../control/node.exe",
      sha256: identity.runtimeDigest.slice(7),
    },
    addon: {
      path: "windows-node-runtime-adapter.node",
      sha256: identity.addonDigest.slice(7),
    },
    preload: {
      path: "windows-node-runtime-preload.cjs",
      sha256: identity.preloadDigest.slice(7),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const adapterManifestRaw = JSON.stringify(adapterManifest) + "\n";
  const manifest = {
    version: 1,
    root: stage,
    workspace,
    scratch,
    runtime: { path: executable, sha256: identity.runtimeDigest.slice(7) },
    files: [
      [
        "workspace/adapter/windows-node-runtime-adapter.node",
        identity.addonDigest,
      ],
      [
        "workspace/adapter/windows-node-runtime-preload.cjs",
        identity.preloadDigest,
      ],
      [
        "workspace/adapter/windows-node-runtime-adapter.manifest.json",
        evalDigest(adapterManifestRaw),
      ],
      ["workspace/child.cjs", identity.childDigest],
      ["control/check.cjs", identity.checkDigest],
    ].map(([relative, digest]) => ({
      path: path.win32.join(stage, relative),
      sha256: digest.slice(7),
    })),
  };
  const frame = {
    schema,
    pid: 100,
    native: native(100, true),
    observations: ["sync", "async", "fork"].map((mode, index) => ({
      marker: "cc-adapted-child",
      mode,
      pid: 200 + index,
      ppid: 100,
      inputDigest,
      bytes: 97,
      resolvedSelf: path.win32.join(workspace, "child.cjs"),
    })),
    realpaths: [
      {
        label: "scratch",
        requested: path.win32.join(scratch, "tmp"),
        resolved: path.win32.join(scratch, "tmp"),
        mappedBefore: 0,
        mappedAfter: 1,
      },
      {
        label: "workspace",
        requested: path.win32.join(workspace, "child.cjs"),
        resolved: path.win32.join(workspace, "child.cjs"),
        mappedBefore: 1,
        mappedAfter: 2,
      },
    ],
    outside: {
      requested: path.win32.dirname(stage),
      result: null,
      error: "EPERM",
      fallbacksBefore: 2,
      fallbacksAfter: 3,
      rejectedBefore: 0,
      rejectedAfter: 1,
      mappedBefore: 2,
      mappedAfter: 2,
    },
  };
  const stages = [
    "started",
    "installed",
    "realpath-started",
    "realpath-completed",
    "outside-started",
    "outside-completed",
    "sync-started",
    "sync-completed",
    "async-started",
    "async-completed",
    "fork-started",
    "fork-completed",
    "completed",
  ];
  const journal = stages.map((stage, seq) => ({ stage, seq, pid: 100 }));
  journal[1].native = native(100);
  journal[3].realpaths = structuredClone(frame.realpaths);
  journal[5].outside = structuredClone(frame.outside);
  for (let i = 0; i < 3; i++) journal[7 + i * 2].childPid = 200 + i;
  Object.assign(
    journal[12],
    structuredClone({
      native: frame.native,
      observations: frame.observations,
      realpaths: frame.realpaths,
      outside: frame.outside,
    }),
  );
  const journalRaw =
    journal.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const manifestDigest = evalDigest(JSON.stringify(manifest));
  const report = {
    schema: "chainlesschain.windows-node-runtime-diagnostic/v2",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    providerAssessed: false,
    capabilities: {},
    platform: "win32",
    architecture: "x64",
    nodeVersion: "v22.22.2",
    stage,
    manifest,
    manifestDigest,
    runtimeDigest: identity.runtimeDigest,
    addonDigest: identity.addonDigest,
    preloadDigest: identity.preloadDigest,
    inputDigest,
    adapterManifestRaw,
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: "CC_NODE_RUNTIME:" + JSON.stringify(frame) + "\n",
      stderr: "",
    },
    settlement: {
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      manifestDigest: manifestDigest.slice(7),
      targetPid: 100,
      appContainerSid: sid,
    },
    journalRaw,
    journalDigest: evalDigest(journalRaw),
    adapterReceipts: [100, 200, 201, 202].flatMap((pid) =>
      ["installed", "exit"].map((phase) => ({
        schema,
        experimental: true,
        admissionEligible: false,
        pid,
        ppid: pid === 100 ? 55 : 100,
        phase,
        execPath: executable,
        nodeVersion: "22.22.2",
        manifestSha256: evalDigest(adapterManifestRaw).slice(7),
        runtimeSha256: identity.runtimeDigest.slice(7),
        addonSha256: identity.addonDigest.slice(7),
        preloadSha256: identity.preloadDigest.slice(7),
        rootProofSha256: evalDigest(JSON.stringify(rootProof)).slice(7),
        native: native(pid, phase === "exit"),
        ...(phase === "exit" ? { exitCode: 0 } : {}),
      })),
    ),
  };
  return { report, frame, journal };
}
const replaceFrame = (report, frame) => {
  report.execution.stdout = "CC_NODE_RUNTIME:" + JSON.stringify(frame) + "\n";
};

test("complete bounded runtime evidence validates without admitting a formal capability", () => {
  const { report, frame } = fixture();
  assert.deepEqual(inspectRuntimeAdapterResult(report), frame);
  assert.equal(report.admissionEligible, false);
  assert.deepEqual(report.capabilities, {});
});

function expectedReceipt(report, row) {
  return {
    pid: row.pid,
    ppid: row.ppid,
    phase: row.phase,
    privateRoot: stage,
    runtimePath: executable,
    appContainerSid: sid,
    nodeVersion: "22.22.2",
    runtimeDigest: report.runtimeDigest,
    addonDigest: report.addonDigest,
    preloadDigest: report.preloadDigest,
    adapterManifestDigest: evalDigest(report.adapterManifestRaw),
    rootProof,
  };
}
test("standalone observed-process validator accepts installation and exit without asserting descendant completeness", () => {
  const { report } = fixture();
  for (const row of report.adapterReceipts)
    assert.equal(
      inspectRuntimeAdapterProcessReceipt(row, expectedReceipt(report, row)),
      row,
    );
});
test("observed receipt uses the supervisor's explicit Node version", () => {
  const { report } = fixture();
  const row = report.adapterReceipts[0];
  const expected = { ...expectedReceipt(report, row), nodeVersion: "22.12.0" };
  row.nodeVersion = "22.12.0";
  assert.equal(inspectRuntimeAdapterProcessReceipt(row, expected), row);
  assert.throws(() =>
    inspectRuntimeAdapterProcessReceipt(row, {
      ...expected,
      nodeVersion: "22.22.2",
    }),
  );
});
test("pipe-busy retries remain evidence and do not invalidate successful process operation", () => {
  const { report, frame, journal } = fixture();
  frame.native.serverFailures = 12;
  frame.native.serverFirstError = 231;
  frame.native.serverLastError = 0;
  report.adapterReceipts[1].native = structuredClone(frame.native);
  journal[12].native = structuredClone(frame.native);
  report.journalRaw =
    journal.map((row) => JSON.stringify(row)).join("\n") + "\n";
  report.journalDigest = evalDigest(report.journalRaw);
  replaceFrame(report, frame);
  assert.equal(inspectRuntimeAdapterResult(report).native.serverFailures, 12);
  const row = report.adapterReceipts[1];
  assert.equal(
    inspectRuntimeAdapterProcessReceipt(row, expectedReceipt(report, row)),
    row,
  );
});
for (const [label, change] of [
  ["wrong identity", (r) => r.pid++],
  ["partial patch", (r) => (r.native.patches = 2)],
  ["wrong root", (r) => (r.native.rootProof.dos += "-other")],
  ["wrong proof digest", (r) => (r.rootProofSha256 = "0".repeat(64))],
  ["wrong binary hash", (r) => (r.addonSha256 = "0".repeat(64))],
  ["failed exit", (r) => (r.exitCode = 1)],
]) {
  test(`standalone observed-process validator rejects ${label}`, () => {
    const { report } = fixture();
    const row = report.adapterReceipts[1],
      expected = expectedReceipt(report, row);
    change(row);
    assert.throws(() => inspectRuntimeAdapterProcessReceipt(row, expected));
  });
}

for (const [label, change] of [
  ["formal sample", (r) => (r.formalSample = true)],
  ["admission enabled", (r) => (r.admissionEligible = true)],
  ["promoted capability", (r) => (r.capabilities.pipe = true)],
  ["unconfirmed cleanup", (r) => (r.settlement.cleanupConfirmed = false)],
  ["nonzero capabilities", (r) => (r.settlement.capabilityCount = 1)],
  ["loopback exemption", (r) => (r.settlement.loopbackExemptionAbsent = false)],
  ["timed out execution", (r) => (r.execution.status = 125)],
  ["hidden stderr", (r) => (r.execution.stderr = "failure")],
  ["wrong runtime hash", (r) => (r.runtimeDigest = "sha256:" + "0".repeat(64))],
  ["wrong binary hash", (r) => (r.addonDigest = "sha256:" + "0".repeat(64))],
  ["wrong preload hash", (r) => (r.preloadDigest = "sha256:" + "0".repeat(64))],
  ["changed native manifest", (r) => (r.manifest.root = "C:\\elsewhere")],
  ["changed raw adapter manifest", (r) => (r.adapterManifestRaw += " ")],
  ["wrong input digest", (r) => (r.inputDigest = "0".repeat(64))],
  ["duplicate output frame", (r) => (r.execution.stdout += r.execution.stdout)],
  ["missing child receipt", (r) => r.adapterReceipts.pop()],
  [
    "duplicate child receipt",
    (r) => (r.adapterReceipts[7] = structuredClone(r.adapterReceipts[6])),
  ],
  ["wrong receipt parent", (r) => (r.adapterReceipts[4].ppid = 999)],
  [
    "wrong receipt executable",
    (r) => (r.adapterReceipts[3].execPath = "C:\\outside\\node.exe"),
  ],
  [
    "wrong receipt manifest hash",
    (r) => (r.adapterReceipts[5].manifestSha256 = "0".repeat(64)),
  ],
  [
    "wrong receipt root hash",
    (r) => (r.adapterReceipts[3].rootProofSha256 = "0".repeat(64)),
  ],
  [
    "wrong child SID",
    (r) => (r.adapterReceipts[4].native.appContainerSid = "S-1-15-2-99"),
  ],
  ["partial child patch", (r) => (r.adapterReceipts[3].native.patches = 2)],
  ["failed child exit", (r) => (r.adapterReceipts[3].exitCode = 1)],
  [
    "unused child realpath adapter",
    (r) => (r.adapterReceipts[3].native.realpathMapped = 0),
  ],
  ["missing journal", (r) => delete r.journalRaw],
  ["changed journal bytes", (r) => (r.journalRaw += "\n")],
]) {
  test(`${label} is rejected`, () => {
    const { report } = fixture();
    change(report);
    assert.throws(() => inspectRuntimeAdapterResult(report));
  });
}

for (const [label, change] of [
  ["wrong target PID", (f) => (f.pid = 999)],
  ["root prefix outside", (f) => (f.native.rootProof.dos += "-outside")],
  [
    "opened rather than canonical name",
    (f) => (f.native.rootProof.normalizedNtFlags = 10),
  ],
  ["unpinned root", (f) => (f.native.rootProof.handlePinned = false)],
  ["bad file identity", (f) => (f.native.rootProof.fileId = "unproven")],
  ["unused pipe hooks", (f) => (f.native.serverMapped = 0)],
  ["invalid pipe failure count", (f) => (f.native.serverFailures = -1)],
  ["wrong child data", (f) => (f.observations[0].bytes = 96)],
  [
    "duplicate child PID",
    (f) => (f.observations[1].pid = f.observations[0].pid),
  ],
  ["missing fork", (f) => f.observations.pop()],
  [
    "wrong canonical child file",
    (f) => (f.observations[1].resolvedSelf = "C:\\outside.txt"),
  ],
  [
    "wrong workspace realpath",
    (f) => (f.realpaths[1].resolved = "C:\\outside.txt"),
  ],
  ["realpath did not reach hook", (f) => (f.realpaths[0].mappedAfter = 0)],
  ["outside realpath succeeded", (f) => (f.outside.result = "C:\\Temp")],
  [
    "outside open failed before hook",
    (f) => (f.outside.fallbacksAfter = f.outside.fallbacksBefore),
  ],
  ["outside handle wrongly mapped", (f) => f.outside.mappedAfter++],
  ["fake outside path inside root", (f) => (f.outside.requested = stage)],
]) {
  test(`${label} is rejected`, () => {
    const { report, frame } = fixture();
    change(frame);
    replaceFrame(report, frame);
    assert.throws(() => inspectRuntimeAdapterResult(report));
  });
}

for (const [label, change] of [
  ["failed middle phase", (j) => (j[4].stage = "failed")],
  ["reordered phase", (j) => j.reverse()],
  ["missing phase", (j) => j.splice(4, 1)],
  ["wrong journal PID", (j) => (j[3].pid = 999)],
  ["different child completion", (j) => (j[9].childPid = 999)],
  [
    "changed canonical result",
    (j) => (j[3].realpaths[0].resolved = "C:\\other"),
  ],
  ["changed completion", (j) => (j[12].native.patches = 2)],
]) {
  test(`rehashing cannot hide ${label}`, () => {
    const { report, journal } = fixture();
    change(journal);
    report.journalRaw =
      journal.map((row) => JSON.stringify(row)).join("\n") + "\n";
    report.journalDigest = evalDigest(report.journalRaw);
    assert.throws(() => inspectRuntimeAdapterResult(report));
  });
}
