#!/usr/bin/env node
// Explicit experimental device/descendant diagnostics; never review admission.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { createWindowsNativeNullEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";
import {
  NULL_CHECK_SOURCE,
  NULL_CHILD_SOURCE,
} from "./diagnostics/windows-node-null-v3-fixtures.mjs";
import {
  NULL_ADAPTER_SCHEMA,
  inspectNullRuntimeResult,
} from "./windows-node-null-v3-result.mjs";

const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Experimental Null diagnostic: ${detail}`);
};
export function readNullArtifact(file, bound) {
  const before = fs.lstatSync(file, { bigint: true });
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(bound),
    "bounded single-link plain artifact required",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd, { bigint: true }),
      bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (!n) break;
      size += n;
    }
    const after = fs.fstatSync(fd, { bigint: true }),
      named = fs.lstatSync(file, { bigint: true });
    const reopened = fs.openSync(file, fs.constants.O_RDONLY);
    let current;
    try {
      current = fs.fstatSync(reopened, { bigint: true });
    } finally {
      fs.closeSync(reopened);
    }
    requireCondition(
      size === Number(before.size) &&
        opened.isFile() &&
        opened.nlink === 1n &&
        opened.size === before.size &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
          (key) =>
            before[key] === named[key] &&
            opened[key] === after[key] &&
            after[key] === current[key],
        ),
      "artifact identity or bytes changed during bounded read",
    );
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}
function plainDirectory(directory) {
  const stat = fs.lstatSync(directory, { bigint: true });
  requireCondition(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      fs.realpathSync.native(directory).toLowerCase() ===
        path.resolve(directory).toLowerCase(),
    "plain canonical artifact directory required",
  );
  return stat;
}
function collectFiles(directory, pattern, bound, count) {
  const identity = plainDirectory(directory),
    dir = fs.opendirSync(directory),
    files = [];
  try {
    for (let entry; (entry = dir.readSync());) {
      requireCondition(
        files.length < count &&
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          pattern.test(entry.name),
        "unexpected/extra artifact entry",
      );
      files.push({
        name: entry.name,
        value: JSON.parse(
          readNullArtifact(path.join(directory, entry.name), bound),
        ),
      });
    }
  } finally {
    dir.closeSync();
  }
  const after = plainDirectory(directory);
  requireCondition(
    identity.dev === after.dev && identity.ino === after.ino,
    "artifact directory replaced",
  );
  return files
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => row.value);
}
function observations(scratch) {
  const before = plainDirectory(scratch),
    dir = fs.opendirSync(scratch),
    files = [],
    childErrors = [];
  let count = 0;
  try {
    for (let entry; (entry = dir.readSync());) {
      requireCondition(
        ++count <= 32,
        "scratch entry count exceeds diagnostic bound",
      );
      if (entry.name.startsWith("null-child-error-")) {
        requireCondition(
          /^null-child-error-[1-9][0-9]{0,9}\.json$/u.test(entry.name) &&
            entry.isFile() &&
            !entry.isSymbolicLink() &&
            childErrors.length < 5,
          "unexpected child error artifact",
        );
        childErrors.push(
          JSON.parse(readNullArtifact(path.join(scratch, entry.name), 32768)),
        );
        continue;
      }
      if (!entry.name.startsWith("null-observation-")) continue;
      requireCondition(
        /^null-observation-[1-9][0-9]{0,9}\.json$/u.test(entry.name) &&
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          files.length < 5,
        "unexpected observation entry",
      );
      files.push(
        JSON.parse(readNullArtifact(path.join(scratch, entry.name), 32768)),
      );
    }
  } finally {
    dir.closeSync();
  }
  const after = plainDirectory(scratch);
  requireCondition(
    before.dev === after.dev && before.ino === after.ino,
    "scratch directory replaced",
  );
  return { observations: files, childErrors };
}

export async function runNullRuntimeDiagnostic({ addon, addonDigest, output }) {
  requireCondition(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.version === "v22.22.2" &&
      typeof output === "string" &&
      path.isAbsolute(output),
    "pinned Windows x64 runtime and absolute fresh output required",
  );
  const runtime = readNullArtifact(
    fs.realpathSync.native(process.execPath),
    128 * 1024 * 1024,
  );
  requireCondition(
    evalDigest(runtime) ===
      "sha256:ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3",
    "pinned runtime bytes differ",
  );
  const binary = readNullArtifact(path.resolve(addon), 1024 * 1024);
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(addonDigest) &&
      evalDigest(binary) === addonDigest,
    "independent addon byte digest differs",
  );
  const preload = readNullArtifact(
    fileURLToPath(
      new URL(
        "./diagnostics/windows-node-null-v3-preload.cjs",
        import.meta.url,
      ),
    ),
    65536,
  );
  const adapterManifest = {
    schema: NULL_ADAPTER_SCHEMA,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: process.versions.node,
    nodeModuleVersion: process.versions.modules,
    runtime: {
      path: "../../control/node.exe",
      sha256: evalDigest(runtime).slice(7),
    },
    addon: { path: "windows-node-null-v3.node", sha256: addonDigest.slice(7) },
    preload: {
      path: "windows-node-null-v3-preload.cjs",
      sha256: evalDigest(preload).slice(7),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const source = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-null-v3-source-"),
  );
  fs.mkdirSync(path.join(source, "adapter"));
  const sources = {
    "adapter/windows-node-null-v3.node": binary,
    "adapter/windows-node-null-v3-preload.cjs": preload,
    "adapter/windows-node-null-v3.manifest.json":
      JSON.stringify(adapterManifest) + "\n",
    "child.cjs": NULL_CHILD_SOURCE,
  };
  for (const [file, bytes] of Object.entries(sources))
    fs.writeFileSync(path.join(source, file), bytes, { flag: "wx" });
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.windows-node-null-diagnostic/v3",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    capabilities: {},
    nodeVersion: process.version,
    modulesAbi: process.versions.modules,
    osRelease: os.release(),
    platform: process.platform,
    architecture: process.arch,
    addonDigest,
    adapterManifest,
    source,
    startedAt: new Date().toISOString(),
    diagnosticCompleted: false,
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
    ].map((file) => ({
      file,
      digest: evalDigest(fs.readFileSync(new URL(file, import.meta.url))),
    })),
  };
  try {
    const evaluator = createWindowsNativeNullEvaluator({
      sourceRoot: source,
      files: Object.keys(sources),
      checkSource: NULL_CHECK_SOURCE,
      wallTimeMs: 15000,
    });
    report.manifest = evaluator.manifest;
    report.manifestDigest = evaluator.manifestDigest;
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
    const scratch = evaluator.manifest.scratch,
      identity = plainDirectory(scratch);
    const captured = evaluator.manifest.directories.find(
      (row) => row.path === scratch,
    );
    requireCondition(
      String(identity.dev) === captured.dev &&
        String(identity.ino) === captured.ino,
      "scratch supervisor identity differs",
    );
    const journal = path.join(scratch, "journal.jsonl");
    if (fs.existsSync(journal)) {
      const bytes = readNullArtifact(journal, 65536);
      report.journalRaw = bytes.toString("utf8");
      report.journalDigest = evalDigest(bytes);
      fs.writeFileSync(path.join(output, "journal.jsonl"), bytes, {
        flag: "wx",
      });
    }
    Object.assign(report, observations(scratch));
    const receipts = path.join(scratch, "adapter-receipts");
    report.adapterReceipts = fs.existsSync(receipts)
      ? collectFiles(
          receipts,
          /^runtime-adapter-[1-9][0-9]{0,9}-(installed|exit)\.json$/u,
          32768,
          12,
        )
      : [];
    report.completion = inspectNullRuntimeResult(report);
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
        addon: { type: "string" },
        "addon-digest": { type: "string" },
        output: { type: "string" },
      },
    });
    requireCondition(
      values["confirm-native"] === true,
      "explicit --confirm-native required",
    );
    const r = await runNullRuntimeDiagnostic({
      addon: values.addon,
      addonDigest: values["addon-digest"],
      output: values.output,
    });
    console.log(
      JSON.stringify({
        output: values.output,
        diagnosticCompleted: r.diagnosticCompleted,
        error: r.error ?? null,
      }),
    );
    process.exitCode = r.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
