import test from "node:test";
import assert from "node:assert/strict";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import {
  inspectRuntimeCapsuleCompletion,
  runtimeCapsuleCheckSource,
} from "../scripts/verify01-native-runtime-capsule.mjs";

const schema = "chainlesschain/windows-node-runtime-adapter@2";
const digest = "sha256:" + "a".repeat(64);
function sample() {
  const mode = "global-setup";
  const detail = { globalSetupExecuted: true, teardownCompleted: true };
  const inventory = {
    runtime: { modulesAbi: process.versions.modules, executableDigest: digest },
    addons: [],
  };
  const inventoryDigest = outcomeDigest(inventory);
  const stage = "C:\\private\\cc-native-capsule-tree";
  const runtimePath = stage + "\\control\\node.exe";
  const manifest = {
    version: 2,
    capsuleBinding: { inventoryDigest },
    runtime: { path: runtimePath },
  };
  manifest.files = [
    ["workspace\\adapter\\windows-node-runtime-adapter.node", digest],
    ["workspace\\adapter\\windows-node-runtime-preload.cjs", digest],
    ["workspace\\adapter\\windows-node-runtime-adapter.manifest.json", digest],
    [
      "control\\check.cjs",
      evalDigest(runtimeCapsuleCheckSource(mode, inventory)),
    ],
  ].map(([relative, digest]) => ({
    path: stage + "\\" + relative,
    sha256: digest.slice(7),
  }));
  const manifestDigest = evalDigest(JSON.stringify(manifest));
  const native = {
    schema,
    experimental: true,
    admissionEligible: false,
    pid: 100,
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7",
    capabilityCount: 0,
    inJob: true,
    state: 2,
    patches: 3,
    installError: 0,
    supportedPrivateRealpath: true,
    serverMapped: 0,
    clientMapped: 0,
    serverFailures: 0,
    clientFailures: 0,
    realpathMapped: 0,
    realpathFallbacks: 0,
    realpathRejected: 0,
    rootProof: {
      dos: stage,
      nt: "\\Device\\HarddiskVolume3\\private\\cc-native-capsule-tree",
      volumeSerial: "123",
      fileId: "a".repeat(32),
      normalizedNtFlags: 2,
      handlePinned: true,
      ancestorAuthority: "supervisor-private-tree-guards",
      componentPolicy: "pinned-no-reparse-single-link-file-id",
    },
  };
  const adapterReceipts = ["installed", "exit"].map((phase) => ({
    schema,
    experimental: true,
    admissionEligible: false,
    phase,
    pid: 100,
    ppid: 90,
    execPath: runtimePath,
    nodeVersion: process.versions.node,
    manifestSha256: digest.slice(7),
    runtimeSha256: digest.slice(7),
    addonSha256: digest.slice(7),
    preloadSha256: digest.slice(7),
    rootProofSha256: evalDigest(JSON.stringify(native.rootProof)).slice(7),
    ...(phase === "exit" ? { exitCode: 0 } : {}),
    native: structuredClone(native),
  }));
  const rows = [
    "started",
    "builtin-import-started",
    "builtin-imported",
    "support-import-started",
    "support-imported",
    "setup-started",
    "setup-completed",
    "teardown-started",
    "completed",
  ].map((phase, sequence) => ({
    stage: phase,
    sequence,
    mode,
    pid: 100,
    ...(sequence === 0
      ? { nodeVersion: process.version, modulesAbi: process.versions.modules }
      : {}),
    ...(sequence === 8 ? detail : {}),
  }));
  const journal = Buffer.from(
    rows.map((row) => JSON.stringify(row) + "\n").join(""),
  );
  const report = {
    schema: "chainlesschain.native-runtime-capsule-diagnostic/v1",
    runtimeProfile: schema,
    experimental: true,
    admissionEligible: false,
    descendantCoverage: "observed-receipts-only",
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    capabilities: {},
    addonDigest: digest,
    preloadDigest: digest,
    adapterManifestDigest: digest,
    mode,
    nodeVersion: process.version,
    stage,
    inventory,
    inventoryDigest,
    manifest,
    manifestDigest,
    journalDigest: evalDigest(journal),
    adapterReceipts,
    execution: {
      status: 0,
      signal: null,
      error: null,
      stderr: "",
      stdout:
        "CC_NATIVE_CAPSULE:" +
        JSON.stringify({
          mode,
          pid: 100,
          nodeVersion: process.version,
          modulesAbi: process.versions.modules,
          detail,
        }) +
        "\n",
    },
    settlement: {
      targetPid: 100,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      manifestDigest: manifestDigest.slice(7),
      appContainerSid: native.appContainerSid,
    },
  };
  return { report, journal };
}
test("requires original frozen setup completion plus independent installed and exit root proofs", () => {
  const s = sample();
  assert.deepEqual(inspectRuntimeCapsuleCompletion(s.report, s.journal), {
    globalSetupExecuted: true,
    teardownCompleted: true,
  });
});
test("retains real libuv transient failure counters without erasing successful execution", () => {
  const s = sample();
  s.report.adapterReceipts[1].native.serverFailures = 12;
  assert.equal(
    inspectRuntimeCapsuleCompletion(s.report, s.journal).globalSetupExecuted,
    true,
  );
});
test("does not expose threads smoke as an adapted frozen forks contract", () => {
  assert.throws(
    () => runtimeCapsuleCheckSource("vitest-smoke", { addons: [] }),
    /only imports and frozen setup/,
  );
});
test("requires child phase pairs to use the parent's kernel root identity", () => {
  const s = sample();
  const child = structuredClone(s.report.adapterReceipts);
  for (const row of child) {
    row.pid = row.native.pid = 200;
    row.ppid = 100;
    row.native.rootProof.fileId = "b".repeat(32);
    row.rootProofSha256 = evalDigest(
      JSON.stringify(row.native.rootProof),
    ).slice(7);
  }
  s.report.adapterReceipts.push(...child);
  assert.throws(
    () => inspectRuntimeCapsuleCompletion(s.report, s.journal),
    /kernel root proof/,
  );
});
for (const index of [0, 1, 2, 3])
  test(`rejects a valid manifest containing substituted profile artifact ${index}`, () => {
    const s = sample();
    s.report.manifest.files[index].sha256 = "c".repeat(64);
    s.report.manifestDigest = evalDigest(JSON.stringify(s.report.manifest));
    s.report.settlement.manifestDigest = s.report.manifestDigest.slice(7);
    assert.throws(
      () => inspectRuntimeCapsuleCompletion(s.report, s.journal),
      /profile bytes\/checker/,
    );
  });
for (const [name, edit] of [
  [
    "profile substitution",
    (r) => {
      r.runtimeProfile += "-other";
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
      r.capabilities.realpath = true;
    },
  ],
  [
    "full descendants claim",
    (r) => {
      r.descendantCoverage = "all";
    },
  ],
  [
    "unrun setup",
    (r) => {
      r.execution.status = 1;
    },
  ],
  [
    "unconfirmed Job",
    (r) => {
      r.settlement.cleanupConfirmed = false;
    },
  ],
  [
    "wrong inventory",
    (r) => {
      r.inventory.runtime.modulesAbi = "wrong";
    },
  ],
  [
    "missing receipt",
    (r) => {
      r.adapterReceipts.pop();
    },
  ],
  [
    "extra duplicate receipt",
    (r) => {
      r.adapterReceipts.push(r.adapterReceipts[0]);
    },
  ],
  [
    "duplicate phase pair",
    (r) => {
      r.adapterReceipts[1].phase = "installed";
    },
  ],
  [
    "unobserved parent",
    (r) => {
      r.adapterReceipts.forEach((row) => {
        row.pid++;
      });
    },
  ],
  [
    "wrong runtime",
    (r) => {
      r.adapterReceipts[0].runtimeSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong preload",
    (r) => {
      r.adapterReceipts[0].preloadSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong manifest",
    (r) => {
      r.adapterReceipts[0].manifestSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong PID token",
    (r) => {
      r.adapterReceipts[0].native.pid++;
    },
  ],
  [
    "outside root proof",
    (r) => {
      r.adapterReceipts[0].native.rootProof.dos = "C:\\outside";
    },
  ],
  [
    "opened NT proof",
    (r) => {
      r.adapterReceipts[0].native.rootProof.normalizedNtFlags = 10;
    },
  ],
  [
    "unpinned root",
    (r) => {
      r.adapterReceipts[0].native.rootProof.handlePinned = false;
    },
  ],
  [
    "unverified reparse policy",
    (r) => {
      r.adapterReceipts[0].native.rootProof.componentPolicy = "resolve-only";
    },
  ],
  [
    "changed kernel root identity",
    (r) => {
      r.adapterReceipts[1].native.rootProof.fileId = "b".repeat(32);
    },
  ],
  [
    "adapter installation failure",
    (r) => {
      r.adapterReceipts[0].native.installError = 5;
    },
  ],
  [
    "observed process nonzero exit",
    (r) => {
      r.adapterReceipts[1].exitCode = 1;
    },
  ],
])
  test(`rejects ${name}`, () => {
    const s = sample();
    edit(s.report);
    assert.throws(() => inspectRuntimeCapsuleCompletion(s.report, s.journal));
  });
