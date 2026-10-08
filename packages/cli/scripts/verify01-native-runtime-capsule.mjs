#!/usr/bin/env node
/** Separate experimental runtime profile; frozen package bytes remain intact. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { createWindowsNativeCapsuleEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";
import {
  inspectNativeCapsuleSource,
  nativeCapsuleCheckSource,
  inspectNativeCapsuleCompletion,
} from "./verify01-native-capsule.mjs";

import { inspectRuntimeAdapterProcessReceipt } from "./windows-node-runtime-diagnostic.mjs";

const PROFILE = "chainlesschain/windows-node-runtime-adapter@2";
const MODES = ["package-import", "global-setup"];
const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Experimental runtime capsule: ${detail}`);
};
function readPlain(file, bound) {
  const before = fs.lstatSync(file, { bigint: true });
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(bound),
    "bounded plain artifact required",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd, { bigint: true }),
      named = fs.lstatSync(file, { bigint: true });
    requireCondition(
      size === Number(before.size) &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every((key) =>
          [opened, after, named].every((stat) => stat[key] === before[key]),
        ),
      "artifact identity/bytes changed",
    );
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}

export function runtimeCapsuleCheckSource(mode, inventory) {
  requireCondition(
    MODES.includes(mode),
    "only imports and frozen setup are supported",
  );
  const original = nativeCapsuleCheckSource(mode, inventory);
  const anchor = "process.env.CI='1';";
  requireCondition(
    original.split(anchor).length === 2,
    "fixed checker installation anchor differs",
  );
  return original.replace(
    anchor,
    String.raw`
fs.mkdirSync(path.join(scratch,'adapter-receipts'));
const runtimeAdapter=require(path.join(workspace,'adapter/windows-node-runtime-preload.cjs'));
const contract=runtimeAdapter.childContract();
process.env.NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main '+contract.environment.NODE_OPTIONS;
process.env.CI='1';
`,
  );
}

export function inspectRuntimeCapsuleCompletion(report, journal) {
  requireCondition(
    report?.schema === "chainlesschain.native-runtime-capsule-diagnostic/v1" &&
      report.runtimeProfile === PROFILE &&
      report.experimental === true &&
      report.admissionEligible === false &&
      report.descendantCoverage === "observed-receipts-only" &&
      MODES.includes(report.mode) &&
      report.capabilities &&
      Object.keys(report.capabilities).length === 0 &&
      [
        report.addonDigest,
        report.preloadDigest,
        report.adapterManifestDigest,
      ].every((value) => /^sha256:[a-f0-9]{64}$/u.test(value)),
    "runtime profile/scope differs",
  );
  const completion = inspectNativeCapsuleCompletion(report, journal);
  for (const [relative, digest] of [
    ["workspace/adapter/windows-node-runtime-adapter.node", report.addonDigest],
    [
      "workspace/adapter/windows-node-runtime-preload.cjs",
      report.preloadDigest,
    ],
    [
      "workspace/adapter/windows-node-runtime-adapter.manifest.json",
      report.adapterManifestDigest,
    ],
    [
      "control/check.cjs",
      evalDigest(runtimeCapsuleCheckSource(report.mode, report.inventory)),
    ],
  ]) {
    const file = path.win32.join(report.stage, relative);
    const entries = report.manifest.files?.filter((row) => row.path === file);
    requireCondition(
      entries?.length === 1 && entries[0].sha256 === digest.slice(7),
      "profile bytes/checker differ from supervisor-guarded manifest",
    );
  }
  requireCondition(
    Array.isArray(report.adapterReceipts) &&
      report.adapterReceipts.length >= 2 &&
      report.adapterReceipts.length <= 128 &&
      report.adapterReceipts.length % 2 === 0,
    "complete bounded adapter process receipts required",
  );
  const parentPid = report.settlement.targetPid;
  const parentProof = report.adapterReceipts.find(
    (row) => row.pid === parentPid && row.phase === "installed",
  )?.native?.rootProof;
  requireCondition(parentProof, "parent kernel root proof missing");
  const pids = [...new Set(report.adapterReceipts.map((row) => row.pid))];
  requireCondition(
    pids.includes(parentPid) &&
      pids.length * 2 === report.adapterReceipts.length,
    "duplicate phases or missing parent receipts",
  );
  for (const pid of pids) {
    const installed = report.adapterReceipts.filter(
      (row) => row.pid === pid && row.phase === "installed",
    );
    const exits = report.adapterReceipts.filter(
      (row) => row.pid === pid && row.phase === "exit",
    );
    requireCondition(
      Number.isSafeInteger(pid) &&
        pid > 0 &&
        installed.length === 1 &&
        exits.length === 1,
      "unique real process phase pair required",
    );
    for (const row of [installed[0], exits[0]])
      inspectRuntimeAdapterProcessReceipt(row, {
        pid,
        phase: row.phase,
        ...(pid === parentPid ? {} : { ppid: parentPid }),
        privateRoot: report.stage,
        runtimePath: report.manifest.runtime.path,
        appContainerSid: report.settlement.appContainerSid,
        nodeVersion: report.nodeVersion.slice(1),
        runtimeDigest: report.inventory.runtime.executableDigest,
        addonDigest: report.addonDigest,
        preloadDigest: report.preloadDigest,
        adapterManifestDigest: report.adapterManifestDigest,
        rootProof: parentProof,
      });
    requireCondition(
      exits[0].exitCode === 0 && installed[0].ppid === exits[0].ppid,
      "observed adapted child did not exit successfully",
    );
    for (const key of [
      "serverMapped",
      "clientMapped",
      "realpathMapped",
      "realpathRejected",
    ])
      requireCondition(
        Number.isSafeInteger(installed[0].native[key]) &&
          installed[0].native[key] >= 0 &&
          Number.isSafeInteger(exits[0].native[key]) &&
          exits[0].native[key] >= installed[0].native[key],
        "adapter counters regressed or differ",
      );
  }
  return completion;
}

export async function runRuntimeCapsuleDiagnostic({
  addon,
  addonDigest,
  output,
  mode,
  ...options
}) {
  requireCondition(
    process.platform === "win32" &&
      process.arch === "x64" &&
      path.isAbsolute(output),
    "Windows x64 and absolute new output required",
  );
  requireCondition(MODES.includes(mode), "unsupported diagnostic mode");
  const source = inspectNativeCapsuleSource(options);
  const binary = readPlain(path.resolve(addon), 1024 * 1024);
  requireCondition(
    evalDigest(binary) === addonDigest,
    "independent addon digest differs",
  );
  const preload = readPlain(
    fileURLToPath(
      new URL(
        "./diagnostics/windows-node-runtime-preload.cjs",
        import.meta.url,
      ),
    ),
    65536,
  );
  const manifest = {
    schema: PROFILE,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: process.versions.node,
    nodeModuleVersion: process.versions.modules,
    runtime: {
      path: "../../control/node.exe",
      sha256: source.binding.runtime.executableDigest.slice(7),
    },
    addon: {
      path: "windows-node-runtime-adapter.node",
      sha256: addonDigest.slice(7),
    },
    preload: {
      path: "windows-node-runtime-preload.cjs",
      sha256: evalDigest(preload).slice(7),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  const sourceRoot = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-runtime-capsule-source-",
    ),
  );
  // A fresh source tree keeps all registry/Git bytes independent of the profile.
  for (const snapshot of source.snapshots) {
    const target = path.join(sourceRoot, snapshot.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(
      path.join(options.root, snapshot.path),
      target,
      fs.constants.COPYFILE_EXCL,
    );
  }
  const extras = [
    ["adapter/windows-node-runtime-adapter.node", binary],
    ["adapter/windows-node-runtime-preload.cjs", preload],
    ["adapter/windows-node-runtime-adapter.manifest.json", manifestBytes],
  ];
  fs.mkdirSync(path.join(sourceRoot, "adapter"));
  for (const [file, bytes] of extras)
    fs.writeFileSync(path.join(sourceRoot, file), bytes, { flag: "wx" });
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.native-runtime-capsule-diagnostic/v1",
    runtimeProfile: PROFILE,
    experimental: true,
    admissionEligible: false,
    descendantCoverage: "observed-receipts-only",
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    durableAuthorityAssessed: false,
    capabilities: {},
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    mode,
    inventory: source.report.inventory,
    inventoryDigest: source.report.inventoryDigest,
    registryContentVerified: true,
    addonDigest,
    preloadDigest: evalDigest(preload),
    adapterManifestDigest: evalDigest(manifestBytes),
    sourceRoot,
    diagnosticCompleted: false,
    sourceIdentities: [
      "./verify01-native-runtime-capsule.mjs",
      "./verify01-native-capsule.mjs",
      "./windows-node-runtime-diagnostic.mjs",
      "./diagnostics/windows-node-runtime-adapter.cpp",
      "./diagnostics/windows-node-runtime-preload.cjs",
      "../src/lib/process-execution-broker/windows-sandbox.cs",
      "../src/lib/process-execution-broker/windows-sandbox-helper.exe",
      "../src/lib/process-execution-broker/windows-sandbox-helper.dll",
    ].map((file) => ({
      file,
      digest: evalDigest(fs.readFileSync(new URL(file, import.meta.url))),
    })),
  };
  try {
    const evaluator = createWindowsNativeCapsuleEvaluator({
      sourceRoot,
      snapshots: [
        ...source.snapshots,
        ...extras.map(([file, bytes]) => ({
          path: file,
          bytes: bytes.length,
          digest: evalDigest(bytes),
        })),
      ],
      binding: source.binding,
      checkSource: runtimeCapsuleCheckSource(mode, report.inventory),
      wallTimeMs: 15000,
    });
    report.stage = evaluator.root;
    report.manifest = evaluator.manifest;
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    const { result, receipt } = await evaluator.execute();
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    report.settlement = receipt;
    fs.writeFileSync(path.join(output, "stdout.txt"), result.stdout ?? "", {
      flag: "wx",
    });
    fs.writeFileSync(path.join(output, "stderr.txt"), result.stderr ?? "", {
      flag: "wx",
    });
    const journalPath = path.join(
      evaluator.manifest.scratch,
      "capsule-journal.jsonl",
    );
    const journal = fs.existsSync(journalPath)
      ? readPlain(journalPath, 65536)
      : null;
    if (journal) {
      report.journalDigest = evalDigest(journal);
      fs.writeFileSync(path.join(output, "journal.jsonl"), journal, {
        flag: "wx",
      });
    }
    report.adapterReceipts = [];
    const receiptsPath = path.join(
      evaluator.manifest.scratch,
      "adapter-receipts",
    );
    for (const file of fs.existsSync(receiptsPath)
      ? fs.readdirSync(receiptsPath).sort()
      : []) {
      requireCondition(
        /^runtime-adapter-[1-9][0-9]*-(installed|exit)\.json$/u.test(file),
        "unknown receipt file",
      );
      requireCondition(
        report.adapterReceipts.length < 128,
        "too many adapter receipts",
      );
      report.adapterReceipts.push(
        JSON.parse(
          readPlain(
            path.join(evaluator.manifest.scratch, "adapter-receipts", file),
            32768,
          ),
        ),
      );
    }
    requireCondition(
      result.status === 0 && receipt.targetExitCode === 0,
      "native runtime check failed; inspect preserved raw stderr and settlement",
    );
    report.completion = inspectRuntimeCapsuleCompletion(report, journal);
    report.diagnosticCompleted = true;
  } catch (error) {
    report.error = error.message;
    if (error.nativeEvaluator) report.failure = error.nativeEvaluator;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "confirm-native": { type: "boolean" },
        root: { type: "string" },
        addon: { type: "string" },
        "addon-digest": { type: "string" },
        "lock-digest": { type: "string" },
        "tarball-dir": { type: "string" },
        "tarball-manifest": { type: "string" },
        "tarball-manifest-digest": { type: "string" },
        output: { type: "string" },
        mode: { type: "string", default: "package-import" },
      },
    });
    requireCondition(
      values["confirm-native"] === true,
      "explicit --confirm-native required",
    );
    const bytes = readPlain(values["tarball-manifest"], 1024 * 1024);
    requireCondition(
      evalDigest(bytes) === values["tarball-manifest-digest"],
      "registry manifest digest differs",
    );
    const registryManifest = JSON.parse(bytes.toString("utf8"));
    requireCondition(
      registryManifest.schema ===
        "chainlesschain.native-review-registry-artifacts/v1",
      "registry schema differs",
    );
    const r = await runRuntimeCapsuleDiagnostic({
      root: values.root,
      addon: values.addon,
      addonDigest: values["addon-digest"],
      lockDigest: values["lock-digest"],
      registry: {
        root: values["tarball-dir"],
        artifacts: registryManifest.artifacts,
      },
      output: values.output,
      mode: values.mode,
    });
    console.log(
      JSON.stringify({
        diagnosticCompleted: r.diagnosticCompleted,
        error: r.error ?? null,
        output: values.output,
      }),
    );
    process.exitCode = r.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
