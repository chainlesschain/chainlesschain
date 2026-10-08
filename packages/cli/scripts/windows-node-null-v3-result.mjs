import path from "node:path";
import { evalDigest } from "../src/lib/eval/evidence.js";
import {
  NULL_CHECK_SOURCE,
  NULL_CHILD_SOURCE,
} from "./diagnostics/windows-node-null-v3-fixtures.mjs";

export const NULL_ADAPTER_SCHEMA =
  "chainlesschain/windows-node-runtime-adapter@3";
const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Experimental Null diagnostic: ${detail}`);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pidValid = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const bareDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const unsignedDecimal = (value, positive = true) =>
  typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,19}$/u : /^(?:0|[1-9][0-9]{0,19})$/u).test(
    value,
  ) &&
  BigInt(value) <= 0xffffffffffffffffn;
const pathIdentity = (row) =>
  row && unsignedDecimal(row.dev) && unsignedDecimal(row.ino);
const fileIdentity = (row, bound) =>
  pathIdentity(row) &&
  Number.isSafeInteger(row.bytes) &&
  row.bytes > 0 &&
  row.bytes <= bound &&
  bareDigest(row.sha256);
const SOURCE_FILES = Object.freeze([
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
]);
const COUNTERS = Object.freeze([
  "nullFallbacks",
  "nullMapped",
  "nullRejected",
  "launches",
  "launched",
  "launchRejected",
]);

function exactCounters(native, mapped, launched, rejected, stage) {
  requireCondition(
    native.nullFallbacks === mapped &&
      native.nullMapped === mapped &&
      native.nullRejected === 0 &&
      native.launches === launched + rejected &&
      native.launched === launched &&
      native.launchRejected === rejected &&
      native.launchError === (rejected ? 50 : 0) &&
      native.launchStage === stage,
    "exact fixture stage Null/launch counters differ",
  );
}

export function inspectNullRuntimeResult(report) {
  const manifest = report?.manifest,
    receipt = report?.settlement,
    result = report?.execution;
  requireCondition(
    report?.schema === "chainlesschain.windows-node-null-diagnostic/v3" &&
      report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.providerAssessed === false &&
      report.fullReviewPackReady === false &&
      report.platform === "win32" &&
      report.architecture === "x64" &&
      report.nodeVersion === "v22.22.2" &&
      report.modulesAbi === "127" &&
      equal(report.capabilities, {}) &&
      manifest?.version === 1 &&
      manifest.experimentalNullDeviceProfile === NULL_ADAPTER_SCHEMA &&
      bareDigest(report.manifestDigest) &&
      report.manifestDigest === evalDigest(JSON.stringify(manifest)).slice(7),
    "scope/guarded manifest differs",
  );
  // These records establish completeness and internal byte bindings only.
  // They do not authenticate a compiler, a build, or an external source tree.
  requireCondition(
    Array.isArray(report.sourceIdentities) &&
      report.sourceIdentities.length === SOURCE_FILES.length &&
      new Set(report.sourceIdentities.map((row) => row.file)).size ===
        SOURCE_FILES.length &&
      report.sourceIdentities.every(
        (row) =>
          SOURCE_FILES.includes(row.file) &&
          typeof row.digest === "string" &&
          /^sha256:[a-f0-9]{64}$/u.test(row.digest),
      ),
    "complete unique local source identity records required",
  );
  requireCondition(
    typeof manifest.root === "string" &&
      /^[A-Za-z]:\\/u.test(manifest.root) &&
      path.win32.normalize(manifest.root) === manifest.root &&
      /^cc-native-evaluator-[A-Za-z0-9_-]{6}$/u.test(
        path.win32.basename(manifest.root),
      ) &&
      manifest.workspace === path.win32.join(manifest.root, "workspace") &&
      manifest.control === path.win32.join(manifest.root, "control") &&
      manifest.scratch === path.win32.join(manifest.root, "scratch") &&
      manifest.check === path.win32.join(manifest.root, "control/check.cjs") &&
      manifest.runtime?.path ===
        path.win32.join(manifest.root, "control/node.exe") &&
      fileIdentity(manifest.runtime, 128 * 1024 * 1024) &&
      manifest.runtime.sha256 ===
        "ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3",
    "fixed private layout/runtime identity differs",
  );
  const expectedDirectories = [
    "",
    "control",
    "scratch",
    "workspace",
    "workspace/adapter",
  ].map((relative) => path.win32.join(manifest.root, relative));
  requireCondition(
    Array.isArray(manifest.directories) &&
      manifest.directories.length === expectedDirectories.length &&
      new Set(manifest.directories.map((row) => row.path)).size ===
        expectedDirectories.length &&
      manifest.directories.every(
        (row) => expectedDirectories.includes(row.path) && pathIdentity(row),
      ),
    "exact guarded directory population/identities required",
  );
  requireCondition(
    result?.status === 0 &&
      Array.isArray(report.childErrors) &&
      report.childErrors.length === 0 &&
      result.signal === null &&
      result.error === null &&
      result.stderr === "" &&
      receipt?.targetExitCode === 0 &&
      receipt.executionFailed === false &&
      receipt.cleanupConfirmed === true &&
      receipt.capabilityCount === 0 &&
      receipt.loopbackExemptionAbsent === true &&
      receipt.manifestDigest === report.manifestDigest &&
      pidValid(receipt.targetPid) &&
      receipt.wallTimeMs === 15000 &&
      manifest.wallTimeMs === 15000 &&
      /^S-1-15-2(?:-[0-9]+){7}$/u.test(receipt.appContainerSid),
    "execution/token/cleanup differs",
  );
  requireCondition(
    receipt.appContainerSid
      .split("-")
      .slice(4)
      .every(
        (value) =>
          unsignedDecimal(value, false) && BigInt(value) <= 0xffffffffn,
      ),
    "canonical native SID components required",
  );
  const adapter = report.adapterManifest;
  requireCondition(
    adapter?.schema === NULL_ADAPTER_SCHEMA &&
      adapter.experimental === true &&
      adapter.admissionEligible === false &&
      adapter.expectedSidEnvironment === "CC_WINDOWS_APPCONTAINER_SID" &&
      adapter.nodeVersion === report.nodeVersion.slice(1) &&
      adapter.nodeModuleVersion === report.modulesAbi &&
      adapter.runtime?.path === "../../control/node.exe" &&
      adapter.addon?.path === "windows-node-null-v3.node" &&
      adapter.preload?.path === "windows-node-null-v3-preload.cjs" &&
      adapter.receiptDirectory === "../../scratch/adapter-receipts" &&
      [
        adapter.runtime.sha256,
        adapter.addon.sha256,
        adapter.preload.sha256,
      ].every(bareDigest) &&
      adapter.runtime.sha256 === manifest.runtime.sha256 &&
      "sha256:" + adapter.addon.sha256 === report.addonDigest,
    "fixed adapter/runtime contract differs",
  );
  requireCondition(
    report.sourceIdentities.find(
      (row) => row.file === "./diagnostics/windows-node-null-v3-preload.cjs",
    ).digest ===
      "sha256:" + adapter.preload.sha256,
    "local preload record differs from guarded preload bytes",
  );
  const adapterDigest = evalDigest(JSON.stringify(adapter) + "\n").slice(7);
  const expectedFiles = [
    [
      "workspace/adapter/windows-node-null-v3.node",
      adapter.addon.sha256,
      1024 * 1024,
    ],
    [
      "workspace/adapter/windows-node-null-v3-preload.cjs",
      adapter.preload.sha256,
      65536,
    ],
    [
      "workspace/adapter/windows-node-null-v3.manifest.json",
      adapterDigest,
      16384,
      Buffer.byteLength(JSON.stringify(adapter) + "\n"),
    ],
    [
      "workspace/child.cjs",
      evalDigest(NULL_CHILD_SOURCE).slice(7),
      1024 * 1024,
      Buffer.byteLength(NULL_CHILD_SOURCE),
    ],
    [
      "control/check.cjs",
      evalDigest(NULL_CHECK_SOURCE).slice(7),
      1024 * 1024,
      Buffer.byteLength(NULL_CHECK_SOURCE),
    ],
  ];
  requireCondition(
    Array.isArray(manifest.files) &&
      manifest.files.length === expectedFiles.length &&
      new Set(manifest.files.map((row) => row.path)).size ===
        expectedFiles.length,
    "exact guarded source population required",
  );
  for (const [relative, digest, bound, bytes] of expectedFiles) {
    const entries = manifest.files.filter(
      (row) => row.path === path.win32.join(manifest.root, relative),
    );
    requireCondition(
      entries.length === 1 &&
        fileIdentity(entries[0], bound) &&
        entries[0].sha256 === digest &&
        (bytes === undefined || entries[0].bytes === bytes),
      "checker/profile bytes not bound to guarded manifest",
    );
  }
  requireCondition(
    typeof result.stdout === "string" &&
      Buffer.byteLength(result.stdout) > 0 &&
      Buffer.byteLength(result.stdout) <= 32768,
    "bounded completion bytes required",
  );
  const frames = result.stdout.trim().split(/\r?\n/u);
  requireCondition(
    frames.length === 1 && frames[0].startsWith("CC_NULL_V3:"),
    "unique bounded completion frame required",
  );
  const frame = JSON.parse(frames[0].slice("CC_NULL_V3:".length)),
    rootPid = receipt.targetPid;
  requireCondition(
    frame.pid === rootPid &&
      Array.isArray(frame.concurrent) &&
      frame.concurrent.length === 3,
    "actual parent/concurrent population differs",
  );
  const journal = report.journalRaw;
  requireCondition(
    typeof journal === "string" &&
      Buffer.byteLength(journal) > 0 &&
      Buffer.byteLength(journal) <= 65536 &&
      journal.endsWith("\n") &&
      evalDigest(journal) === report.journalDigest,
    "complete journal bytes/digest required",
  );
  const rows = journal
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const stages = [
    "started",
    "installed",
    "unlisted-event-started",
    "nested-result",
    "concurrent-completed",
    "unlisted-event-closed",
    "negatives-completed",
    "unknown-handle-rejected",
    "completed",
  ];
  requireCondition(
    rows.length === stages.length &&
      rows.every(
        (row, index) =>
          row.seq === index &&
          row.pid === rootPid &&
          row.stage === stages[index],
      ),
    "journal stage order/parent identity differs",
  );
  requireCondition(
    rows[3].childPid === frame.nested &&
      rows[3].status === 0 &&
      rows[3].signal === null &&
      rows[3].error === undefined &&
      equal(rows[4].pids, frame.concurrent) &&
      equal(rows.at(-1).native, frame.native) &&
      rows[6].detachedError === "ENOTSUP" &&
      rows[6].missingPreloadError === "ENOTSUP" &&
      rows[5].trapEnd?.sameObjectRetained === true &&
      rows[5].trapEnd.closed === true,
    "actual launch/negative/retained trap bindings differ",
  );
  const trap = rows[2].trap;
  const objectParts =
    typeof trap?.objectName === "string" ? trap.objectName.split("\\") : [];
  const expectedEventPrefix = `cc-null-v3-unlisted-${rootPid}-`;
  const ticks = objectParts[5]?.startsWith(expectedEventPrefix)
    ? objectParts[5].slice(expectedEventPrefix.length)
    : null;
  requireCondition(
    trap?.type === "Event" &&
      Number.isSafeInteger(trap.expectedTypeIndex) &&
      trap.expectedTypeIndex > 0 &&
      trap.expectedTypeIndex <= 65535 &&
      trap.inheritable === true &&
      /^[1-9a-f][0-9a-f]{0,15}$/u.test(trap.handle) &&
      BigInt("0x" + trap.handle) < 0xfffffffffffffffdn &&
      objectParts.length === 6 &&
      objectParts[0] === "" &&
      objectParts[1] === "Sessions" &&
      unsignedDecimal(objectParts[2], false) &&
      BigInt(objectParts[2]) <= 0xffffffffn &&
      objectParts[3] === "AppContainerNamedObjects" &&
      objectParts[4] === receipt.appContainerSid &&
      unsignedDecimal(ticks, false),
    "unique actual inheritable trap required",
  );
  requireCondition(
    Array.isArray(report.observations) &&
      report.observations.length === 5 &&
      Array.isArray(report.adapterReceipts) &&
      report.adapterReceipts.length === 12,
    "exact observation/phase population required",
  );
  const modes = [
    "nested",
    "grandchild",
    "concurrent-0",
    "concurrent-1",
    "concurrent-2",
  ];
  requireCondition(
    equal(report.observations.map((row) => row.mode).sort(), [...modes].sort()),
    "exact child mode population required",
  );
  const nested = report.observations.find((row) => row.mode === "nested"),
    grandchild = report.observations.find((row) => row.mode === "grandchild");
  requireCondition(
    nested.pid === frame.nested &&
      nested.nested === grandchild.pid &&
      grandchild.ppid === nested.pid &&
      grandchild.nested === null &&
      report.observations
        .filter((row) => row.mode.startsWith("concurrent-"))
        .every(
          (row) =>
            row.pid === frame.concurrent[Number(row.mode.at(-1))] &&
            row.nested === null,
        ),
    "two-level and concurrent process topology differs",
  );
  const pids = [rootPid, ...report.observations.map((row) => row.pid)];
  requireCondition(
    pids.every(pidValid) && new Set(pids).size === 6,
    "unique real process identities required",
  );
  const rootInstalled = report.adapterReceipts.find(
    (row) => row.pid === rootPid && row.phase === "installed",
  );
  requireCondition(
    pidValid(rootInstalled?.ppid) && !pids.includes(rootInstalled.ppid),
    "supervisor parent cannot be one of the observed descendants",
  );
  const rootProof = rootInstalled?.native?.rootProof;
  const rootEntry = manifest.directories?.find(
    (row) => row.path === manifest.root,
  );
  requireCondition(
    rootProof?.dos === manifest.root &&
      /^\\Device\\[^\\]+\\/u.test(rootProof.nt) &&
      unsignedDecimal(rootProof.volumeSerial) &&
      /^[a-f0-9]{32}$/u.test(rootProof.fileId) &&
      rootEntry &&
      (BigInt(rootProof.volumeSerial) & 0xffffffffn).toString() ===
        rootEntry.dev &&
      Buffer.from(rootProof.fileId, "hex").readBigUInt64LE().toString() ===
        rootEntry.ino &&
      rootProof.normalizedNtFlags === 2 &&
      rootProof.handlePinned === true &&
      rootProof.ancestorAuthority === "supervisor-private-tree-guards" &&
      rootProof.componentPolicy === "pinned-no-reparse-single-link-file-id",
    "kernel root proof differs from supervisor directory identity",
  );
  function nativeProof(n, pid) {
    requireCondition(
      n?.schema === NULL_ADAPTER_SCHEMA &&
        n.experimental === true &&
        n.admissionEligible === false &&
        n.pid === pid &&
        n.appContainerSid === receipt.appContainerSid &&
        n.capabilityCount === 0 &&
        n.inJob === true &&
        n.state === 2 &&
        n.patches === 5 &&
        n.installError === 0 &&
        n.supportedPrivateRealpath === true &&
        equal(n.rootProof, rootProof) &&
        n.nullProof?.readAttested === true &&
        n.nullProof.writeAttested === true &&
        n.nullProof.object === "\\Device\\Null" &&
        n.nullProof.readAccess === 0x120089 &&
        n.nullProof.writeAccess === 0x120196 &&
        n.nullProof.mode === 0x20,
      "actual native token/kernel object/rights/protection proof differs",
    );
    for (const key of COUNTERS)
      requireCondition(
        Number.isSafeInteger(n[key]) && n[key] >= 0,
        "native counters must be finite nonnegative integers",
      );
    requireCondition(
      n.nullMapped <= n.nullFallbacks &&
        n.nullRejected <= n.nullFallbacks &&
        n.launched + n.launchRejected <= n.launches,
      "native call population inconsistent",
    );
  }
  for (const pid of pids) {
    const phases = report.adapterReceipts.filter((row) => row.pid === pid);
    const installed = phases.find((row) => row.phase === "installed"),
      exit = phases.find((row) => row.phase === "exit");
    requireCondition(
      phases.length === 2 && installed && exit && exit.exitCode === 0,
      "complete unique installed/exit phase pair required",
    );
    const observation = report.observations.find((row) => row.pid === pid);
    for (const row of phases) {
      requireCondition(
        row.schema === NULL_ADAPTER_SCHEMA &&
          row.experimental === true &&
          row.admissionEligible === false &&
          pidValid(row.ppid) &&
          row.ppid !== pid &&
          (observation
            ? row.ppid === observation.ppid
            : row.ppid === rootInstalled.ppid) &&
          row.execPath === manifest.runtime.path &&
          row.nodeVersion === adapter.nodeVersion &&
          row.runtimeSha256 === adapter.runtime.sha256 &&
          row.addonSha256 === adapter.addon.sha256 &&
          row.preloadSha256 === adapter.preload.sha256 &&
          row.manifestSha256 === adapterDigest &&
          row.rootProofSha256 ===
            evalDigest(JSON.stringify(rootProof)).slice(7),
        "process phase identity/bytes differ",
      );
      nativeProof(row.native, pid);
    }
    exactCounters(installed.native, 0, 0, 0, "fresh");
    for (const key of COUNTERS)
      requireCondition(
        exit.native[key] >= installed.native[key],
        "native counters regressed",
      );
    if (observation) {
      requireCondition(
        observation.read === 0 &&
          observation.written === 97 &&
          (observation.mode === "grandchild" || observation.ppid === rootPid) &&
          observation.trap?.handle === trap.handle &&
          observation.trap.objectName === trap.objectName &&
          observation.trap.expectedTypeIndex === trap.expectedTypeIndex &&
          ((observation.trap.present === false &&
            observation.trap.typeIndex === null) ||
            (observation.trap.present === true &&
              Number.isSafeInteger(observation.trap.typeIndex) &&
              observation.trap.typeIndex > 0 &&
              observation.trap.typeIndex <= 65535 &&
              observation.trap.typeIndex !== trap.expectedTypeIndex)) &&
          observation.trap.inherited === false &&
          observation.trap.method === "own-process-handle-snapshot" &&
          Number.isSafeInteger(observation.trap.handleCount) &&
          observation.trap.handleCount > 0 &&
          observation.trap.handleCount <= 26214,
        "actual EOF/write/lineage/own bounded handle snapshot differs",
      );
      nativeProof(observation.native, pid);
      requireCondition(
        equal(observation.native, exit.native),
        "child observation/exit receipt differs",
      );
      const launchedNested = observation.mode === "nested";
      exactCounters(
        exit.native,
        launchedNested ? 3 : 0,
        launchedNested ? 1 : 0,
        0,
        launchedNested ? "launched" : "fresh",
      );
    } else
      requireCondition(
        equal(installed.native, rows[1].native) &&
          equal(exit.native, frame.native),
        "parent journal/frame/phase differs",
      );
  }
  const expectedStages = [
    [1, 0, 0, 0, "fresh"],
    [3, 3, 1, 0, "launched"],
    [4, 12, 4, 0, "launched"],
    [6, 18, 4, 2, "launch-environment"],
    [7, 18, 4, 3, "launch-stdio"],
    [8, 18, 4, 3, "launch-stdio"],
  ];
  let previousNative = null;
  for (const [index, mapped, launched, rejected, stage] of expectedStages) {
    const native = rows[index].native;
    nativeProof(native, rootPid);
    exactCounters(native, mapped, launched, rejected, stage);
    if (previousNative)
      requireCondition(
        COUNTERS.every((key) => native[key] >= previousNative[key]),
        "journal native counters regressed",
      );
    previousNative = native;
  }
  nativeProof(frame.native, rootPid);
  requireCondition(
    frame.native.nullMapped === 18 &&
      frame.native.nullFallbacks === 18 &&
      frame.native.nullRejected === 0 &&
      frame.native.launched === 4 &&
      frame.native.launchRejected === 3 &&
      frame.native.launches === 7 &&
      frame.native.launchError === 50 &&
      frame.native.launchStage === "launch-stdio" &&
      rows[7].native.launched === 4 &&
      rows[7].native.launchRejected === 3 &&
      rows[7].native.launchStage === "launch-stdio",
    "actual mappings and fail-closed launch results differ",
  );
  return frame;
}
