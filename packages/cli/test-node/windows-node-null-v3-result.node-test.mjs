import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evalDigest } from "../src/lib/eval/evidence.js";
import {
  inspectNullRuntimeResult,
  NULL_ADAPTER_SCHEMA as schema,
} from "../scripts/windows-node-null-v3-result.mjs";
import { readNullArtifact } from "../scripts/windows-node-null-v3-diagnostic.mjs";
import {
  NULL_CHECK_SOURCE,
  NULL_CHILD_SOURCE,
} from "../scripts/diagnostics/windows-node-null-v3-fixtures.mjs";

const runtimeDigest =
  "ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3";
function sample() {
  const root = "C:\\private\\cc-native-evaluator-Abc123",
    sid = "S-1-15-2-1-2-3-4-5-6-7";
  const proof = {
    dos: root,
    nt: "\\Device\\HarddiskVolume3\\private\\cc-native-evaluator-Abc123",
    volumeSerial: "1",
    fileId: "01000000000000000000000000000000",
    normalizedNtFlags: 2,
    handlePinned: true,
    ancestorAuthority: "supervisor-private-tree-guards",
    componentPolicy: "pinned-no-reparse-single-link-file-id",
  };
  const native = (
    pid,
    mapped = 0,
    launched = 0,
    rejected = 0,
    stage = "fresh",
  ) => ({
    schema,
    experimental: true,
    admissionEligible: false,
    pid,
    appContainerSid: sid,
    capabilityCount: 0,
    inJob: true,
    state: 2,
    patches: 5,
    installError: 0,
    supportedPrivateRealpath: true,
    rootProof: structuredClone(proof),
    nullProof: {
      readAttested: true,
      writeAttested: true,
      object: "\\Device\\Null",
      readAccess: 0x120089,
      writeAccess: 0x120196,
      mode: 32,
    },
    nullFallbacks: mapped,
    nullMapped: mapped,
    nullRejected: 0,
    launches: launched + rejected,
    launched,
    launchRejected: rejected,
    launchError: rejected ? 50 : 0,
    launchStage: stage,
  });
  const trap = {
    handle: "abc",
    objectName: `\\Sessions\\1\\AppContainerNamedObjects\\${sid}\\cc-null-v3-unlisted-100-123`,
    type: "Event",
    inheritable: true,
    expectedTypeIndex: 10,
  };
  const adapterManifest = {
    schema,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: "22.22.2",
    nodeModuleVersion: "127",
    runtime: { path: "../../control/node.exe", sha256: runtimeDigest },
    addon: { path: "windows-node-null-v3.node", sha256: "a".repeat(64) },
    preload: {
      path: "windows-node-null-v3-preload.cjs",
      sha256: "b".repeat(64),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const manifest = {
    version: 1,
    experimentalNullDeviceProfile: schema,
    root,
    workspace: path.win32.join(root, "workspace"),
    control: path.win32.join(root, "control"),
    scratch: path.win32.join(root, "scratch"),
    check: path.win32.join(root, "control/check.cjs"),
    wallTimeMs: 15000,
    runtime: {
      path: path.win32.join(root, "control/node.exe"),
      sha256: runtimeDigest,
      bytes: 87074816,
      dev: "1",
      ino: "2",
    },
    directories: [
      "",
      "control",
      "scratch",
      "workspace",
      "workspace/adapter",
    ].map((rel, i) => ({
      path: path.win32.join(root, rel),
      dev: "1",
      ino: String(i + 1),
    })),
  };
  const aDigest = evalDigest(JSON.stringify(adapterManifest) + "\n").slice(7);
  manifest.files = [
    [
      "workspace/adapter/windows-node-null-v3.node",
      adapterManifest.addon.sha256,
      560640,
    ],
    [
      "workspace/adapter/windows-node-null-v3-preload.cjs",
      adapterManifest.preload.sha256,
      8796,
    ],
    [
      "workspace/adapter/windows-node-null-v3.manifest.json",
      aDigest,
      Buffer.byteLength(JSON.stringify(adapterManifest) + "\n"),
    ],
    [
      "workspace/child.cjs",
      evalDigest(NULL_CHILD_SOURCE).slice(7),
      Buffer.byteLength(NULL_CHILD_SOURCE),
    ],
    [
      "control/check.cjs",
      evalDigest(NULL_CHECK_SOURCE).slice(7),
      Buffer.byteLength(NULL_CHECK_SOURCE),
    ],
  ].map(([file, sha256, bytes], i) => ({
    path: path.win32.join(root, file),
    sha256,
    bytes,
    dev: "1",
    ino: String(i + 10),
  }));
  const observations = [
    "nested",
    "grandchild",
    "concurrent-0",
    "concurrent-1",
    "concurrent-2",
  ].map((mode, i) => ({
    pid: [200, 300, 400, 401, 402][i],
    ppid: mode === "grandchild" ? 200 : 100,
    mode,
    read: 0,
    written: 97,
    nested: mode === "nested" ? 300 : null,
    trap: {
      handle: trap.handle,
      objectName: trap.objectName,
      expectedTypeIndex: 10,
      typeIndex: null,
      present: false,
      inherited: false,
      method: "own-process-handle-snapshot",
      handleCount: 164,
    },
    native: native(
      [200, 300, 400, 401, 402][i],
      mode === "nested" ? 3 : 0,
      mode === "nested" ? 1 : 0,
      0,
      mode === "nested" ? "launched" : "fresh",
    ),
  }));
  const final = native(100, 18, 4, 3, "launch-stdio");
  const frame = {
    pid: 100,
    nested: 200,
    concurrent: [400, 401, 402],
    native: final,
  };
  const rows = [
    { stage: "started" },
    { stage: "installed", native: native(100) },
    { stage: "unlisted-event-started", trap },
    {
      stage: "nested-result",
      childPid: 200,
      status: 0,
      signal: null,
      native: native(100, 3, 1, 0, "launched"),
    },
    {
      stage: "concurrent-completed",
      pids: frame.concurrent,
      native: native(100, 12, 4, 0, "launched"),
    },
    {
      stage: "unlisted-event-closed",
      trapEnd: { sameObjectRetained: true, closed: true },
    },
    {
      stage: "negatives-completed",
      detachedError: "ENOTSUP",
      missingPreloadError: "ENOTSUP",
      native: native(100, 18, 4, 2, "launch-environment"),
    },
    { stage: "unknown-handle-rejected", native: final },
    { stage: "completed", native: final },
  ].map((row, seq) => ({ seq, pid: 100, ...row }));
  const receipts = [100, ...observations.map((row) => row.pid)].flatMap((pid) =>
    ["installed", "exit"].map((phase) => ({
      schema,
      experimental: true,
      admissionEligible: false,
      phase,
      pid,
      ppid: pid === 100 ? 90 : observations.find((row) => row.pid === pid).ppid,
      execPath: manifest.runtime.path,
      nodeVersion: "22.22.2",
      runtimeSha256: runtimeDigest,
      addonSha256: adapterManifest.addon.sha256,
      preloadSha256: adapterManifest.preload.sha256,
      manifestSha256: aDigest,
      rootProofSha256: evalDigest(JSON.stringify(proof)).slice(7),
      ...(phase === "exit" ? { exitCode: 0 } : {}),
      native:
        phase === "installed"
          ? native(pid)
          : pid === 100
            ? structuredClone(final)
            : structuredClone(
                observations.find((row) => row.pid === pid).native,
              ),
    })),
  );
  const r = {
    schema: "chainlesschain.windows-node-null-diagnostic/v3",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    capabilities: {},
    platform: "win32",
    architecture: "x64",
    nodeVersion: "v22.22.2",
    modulesAbi: "127",
    manifest,
    adapterManifest,
    addonDigest: "sha256:" + adapterManifest.addon.sha256,
    childErrors: [],
    observations,
    adapterReceipts: receipts,
    sourceIdentities: [
      "./windows-node-null-v3-diagnostic.mjs",
      "./windows-node-null-v3-result.mjs",
      "./diagnostics/windows-node-null-v3-fixtures.mjs",
      "./diagnostics/windows-node-null-v3.cpp",
      "./diagnostics/windows-node-null-v3.h",
      "./diagnostics/windows-node-null-v3-preload.cjs",
      "../src/lib/process-execution-broker/windows-native-evaluator.js",
      "../src/lib/process-execution-broker/windows-sandbox.cs",
      "../src/lib/process-execution-broker/windows-sandbox-helper.exe",
      "../src/lib/process-execution-broker/windows-sandbox-helper.dll",
    ].map((file) => ({ file, digest: "sha256:" + "b".repeat(64) })),
    execution: {
      status: 0,
      signal: null,
      error: null,
      stderr: "",
      stdout: "CC_NULL_V3:" + JSON.stringify(frame) + "\n",
    },
    settlement: {
      targetPid: 100,
      targetExitCode: 0,
      executionFailed: false,
      cleanupConfirmed: true,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      appContainerSid: sid,
      wallTimeMs: 15000,
    },
  };
  rebind(r);
  setJournal(r, rows);
  return r;
}
function rebind(r) {
  r.manifestDigest = evalDigest(JSON.stringify(r.manifest)).slice(7);
  r.settlement.manifestDigest = r.manifestDigest;
}
function setJournal(r, rows) {
  r.journalRaw = rows.map((row) => JSON.stringify(row) + "\n").join("");
  r.journalDigest = evalDigest(r.journalRaw);
}
function editJournal(r, edit) {
  const rows = r.journalRaw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  edit(rows);
  setJournal(r, rows);
}
test("binds six observed processes, true Null objects, exact source and two-level/parallel inheritance", () => {
  assert.equal(inspectNullRuntimeResult(sample()).concurrent.length, 3);
});
test("excludes a reused numeric value when its kernel object type differs from the retained Event", () => {
  const r = sample();
  Object.assign(r.observations[0].trap, { present: true, typeIndex: 11 });
  assert.equal(inspectNullRuntimeResult(r).nested, 200);
});
for (const [name, edit] of [
  [
    "missing child error collection",
    (r) => {
      delete r.childErrors;
    },
  ],
  [
    "null child error collection",
    (r) => {
      r.childErrors = null;
    },
  ],
  [
    "invalid child error collection",
    (r) => {
      r.childErrors = {};
    },
  ],
  [
    "observed child error",
    (r) => {
      r.childErrors.push({ pid: r.observations[0].pid, error: "ADAPTER_TRAP" });
    },
  ],
  [
    "unknown child error",
    (r) => {
      r.childErrors.push({ pid: 0xffffffff, error: "ADAPTER_TRAP" });
    },
  ],
  [
    "formal promotion",
    (r) => {
      r.formalSample = true;
    },
  ],
  [
    "admission promotion",
    (r) => {
      r.admissionEligible = true;
    },
  ],
  [
    "capability promotion",
    (r) => {
      r.capabilities.null = true;
    },
  ],
  [
    "unassessed provider claim",
    (r) => {
      r.providerAssessed = true;
    },
  ],
  [
    "nonWindows",
    (r) => {
      r.platform = "linux";
    },
  ],
  [
    "wrong architecture",
    (r) => {
      r.architecture = "arm64";
    },
  ],
  [
    "wrong runtime version",
    (r) => {
      r.nodeVersion = "v22.12.0";
    },
  ],
  [
    "wrong ABI",
    (r) => {
      r.modulesAbi = "128";
    },
  ],
  [
    "missing source records",
    (r) => {
      delete r.sourceIdentities;
    },
  ],
  [
    "duplicate source records",
    (r) => {
      r.sourceIdentities[0] = r.sourceIdentities[1];
    },
  ],
  [
    "malformed source digest",
    (r) => {
      r.sourceIdentities[0].digest = "unknown";
    },
  ],
  [
    "wrong recorded preload",
    (r) => {
      r.sourceIdentities[5].digest = "sha256:" + "c".repeat(64);
    },
  ],
  [
    "workspace outside root",
    (r) => {
      r.manifest.workspace = "C:\\outside";
      rebind(r);
    },
  ],
  [
    "wrong checker location",
    (r) => {
      r.manifest.check = "C:\\wrong.cjs";
      rebind(r);
    },
  ],
  [
    "missing directory population",
    (r) => {
      r.manifest.directories.pop();
      rebind(r);
    },
  ],
  [
    "duplicate directory",
    (r) => {
      r.manifest.directories[1] = r.manifest.directories[0];
      rebind(r);
    },
  ],
  [
    "missing directory identity",
    (r) => {
      delete r.manifest.directories[1].ino;
      rebind(r);
    },
  ],
  [
    "zero file identity",
    (r) => {
      r.manifest.files[0].ino = "0";
      rebind(r);
    },
  ],
  [
    "missing file size",
    (r) => {
      delete r.manifest.files[0].bytes;
      rebind(r);
    },
  ],
  [
    "oversized addon",
    (r) => {
      r.manifest.files[0].bytes = 2 * 1024 * 1024;
      rebind(r);
    },
  ],
  [
    "substituted checker",
    (r) => {
      r.manifest.files[4].sha256 = "c".repeat(64);
      rebind(r);
    },
  ],
  [
    "truncated checker",
    (r) => {
      r.manifest.files[4].bytes--;
      rebind(r);
    },
  ],
  [
    "changed root file ID",
    (r) => {
      r.manifest.directories[0].ino = "2";
      rebind(r);
    },
  ],
  [
    "changed root volume",
    (r) => {
      r.manifest.directories[0].dev = "2";
      rebind(r);
    },
  ],
  [
    "network capability",
    (r) => {
      r.settlement.capabilityCount = 1;
    },
  ],
  [
    "loopback exemption",
    (r) => {
      r.settlement.loopbackExemptionAbsent = false;
    },
  ],
  [
    "missing cleanup",
    (r) => {
      r.settlement.cleanupConfirmed = false;
    },
  ],
  [
    "child nonzero exit",
    (r) => {
      r.adapterReceipts[3].exitCode = 1;
    },
  ],
  [
    "unexpected stderr",
    (r) => {
      r.execution.stderr = "failure";
    },
  ],
  [
    "missing frame",
    (r) => {
      r.execution.stdout = "";
    },
  ],
  [
    "duplicate frame",
    (r) => {
      r.execution.stdout += r.execution.stdout;
    },
  ],
  [
    "unbounded completion",
    (r) => {
      r.execution.stdout = "x".repeat(32769);
    },
  ],
  [
    "missing journal",
    (r) => {
      delete r.journalRaw;
    },
  ],
  [
    "journal digest replacement",
    (r) => {
      r.journalRaw += "{}\n";
    },
  ],
  [
    "failure stage hidden",
    (r) =>
      editJournal(r, (rows) => {
        rows[4].stage = "failed";
      }),
  ],
  [
    "reordered stage",
    (r) =>
      editJournal(r, (rows) => {
        [rows[3], rows[4]] = [rows[4], rows[3]];
      }),
  ],
  [
    "child PID overwrites parent journal",
    (r) =>
      editJournal(r, (rows) => {
        rows[3].pid = 200;
      }),
  ],
  [
    "incorrect intermediate counters",
    (r) =>
      editJournal(r, (rows) => {
        rows[3].native.nullMapped = 999;
        rows[3].native.nullFallbacks = 999;
      }),
  ],
  [
    "missing exit phase",
    (r) => {
      r.adapterReceipts.pop();
    },
  ],
  [
    "extra fake process phase",
    (r) => {
      r.adapterReceipts.push(r.adapterReceipts[0]);
    },
  ],
  [
    "missing observation",
    (r) => {
      r.observations.pop();
    },
  ],
  [
    "duplicate child modes",
    (r) => {
      r.observations[4].mode = "concurrent-0";
    },
  ],
  [
    "grandchild parent replaced",
    (r) => {
      r.observations[1].ppid = 100;
    },
  ],
  [
    "PID collision",
    (r) => {
      r.observations[1].pid = 200;
    },
  ],
  [
    "root parent points to descendant",
    (r) => {
      r.adapterReceipts[0].ppid = r.adapterReceipts[1].ppid = 300;
    },
  ],
  [
    "Null is a disk file",
    (r) => {
      r.adapterReceipts[2].native.nullProof.object = "C:\\file";
    },
  ],
  [
    "wrong Null read rights",
    (r) => {
      r.adapterReceipts[2].native.nullProof.readAccess = 0x120196;
    },
  ],
  [
    "missing write attributes",
    (r) => {
      r.adapterReceipts[2].native.nullProof.writeAccess = 0x120116;
    },
  ],
  [
    "asynchronous Null mode",
    (r) => {
      r.adapterReceipts[2].native.nullProof.mode = 0;
    },
  ],
  [
    "unattested Null",
    (r) => {
      r.adapterReceipts[2].native.nullProof.readAttested = false;
    },
  ],
  [
    "wrong child token",
    (r) => {
      r.adapterReceipts[2].native.appContainerSid += "-8";
    },
  ],
  [
    "child outside Job",
    (r) => {
      r.adapterReceipts[2].native.inJob = false;
    },
  ],
  [
    "partial hooks",
    (r) => {
      r.adapterReceipts[2].native.patches = 4;
    },
  ],
  [
    "counter regression",
    (r) => {
      r.adapterReceipts[0].native.nullMapped = 2;
    },
  ],
  [
    "nonEOF Null input",
    (r) => {
      r.observations[0].read = 97;
    },
  ],
  [
    "partial Null write",
    (r) => {
      r.observations[0].written = 96;
    },
  ],
  [
    "fake trap namespace",
    (r) =>
      editJournal(r, (rows) => {
        rows[2].trap.objectName = "fake\\" + rows[2].trap.objectName;
      }),
  ],
  [
    "trap was noninheritable",
    (r) =>
      editJournal(r, (rows) => {
        rows[2].trap.inheritable = false;
      }),
  ],
  [
    "trap prematurely closed",
    (r) =>
      editJournal(r, (rows) => {
        rows[5].trapEnd.sameObjectRetained = false;
      }),
  ],
  [
    "child inherited trap",
    (r) => {
      Object.assign(r.observations[0].trap, {
        present: true,
        typeIndex: 10,
        inherited: true,
      });
    },
  ],
  [
    "same Event type cannot prove exclusion",
    (r) => {
      Object.assign(r.observations[0].trap, { present: true, typeIndex: 10 });
    },
  ],
  [
    "present without type",
    (r) => {
      r.observations[0].trap.present = true;
    },
  ],
  [
    "absent with stale type",
    (r) => {
      r.observations[0].trap.typeIndex = 11;
    },
  ],
  [
    "wrong expected kernel type",
    (r) => {
      r.observations[0].trap.expectedTypeIndex = 11;
    },
  ],
  [
    "missing type evidence",
    (r) => {
      delete r.observations[0].trap.expectedTypeIndex;
    },
  ],
  [
    "unbounded handle snapshot",
    (r) => {
      r.observations[0].trap.handleCount = 26215;
    },
  ],
  [
    "fake snapshot method",
    (r) => {
      r.observations[0].trap.method = "get-handle-after-close";
    },
  ],
])
  test(`rejects ${name}`, () => {
    const r = sample();
    edit(r);
    assert.throws(
      () => inspectNullRuntimeResult(r),
      /Experimental Null diagnostic/,
    );
  });
test("bounded file reader preserves bytes and rejects hardlinks and oversize inputs", () => {
  const parent = fs.realpathSync.native(os.tmpdir()),
    root = fs.mkdtempSync(path.join(parent, "cc-null-reader-")),
    file = path.join(root, "one.json");
  try {
    fs.writeFileSync(file, "123");
    assert.equal(readNullArtifact(file, 3).toString(), "123");
    assert.throws(() => readNullArtifact(file, 2), /bounded single-link/);
    fs.linkSync(file, path.join(root, "alias.json"));
    assert.throws(() => readNullArtifact(file, 3), /bounded single-link/);
  } finally {
    assert.equal(path.dirname(fs.realpathSync.native(root)), parent);
    assert.match(path.basename(root), /^cc-null-reader-/u);
    fs.rmSync(root, { recursive: true });
  }
});
