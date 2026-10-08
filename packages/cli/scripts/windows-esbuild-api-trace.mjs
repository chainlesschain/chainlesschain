#!/usr/bin/env node
/** Independent esbuild API trace. No result translation or production admission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  capture,
  digest,
  inspectPe,
  GNU_IDENTITY,
} from "./windows-rollup-gnu-forwarder.mjs";
import { createWindowsNativeCapsuleEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const nativeSources = [
  "windows-esbuild-trace-launcher.cpp",
  "windows-esbuild-trace-shim.cpp",
];
export const ESBUILD_DIGEST =
  "sha256:ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3";
const insist = (value, message) => {
  if (!value) throw Error("esbuild API trace: " + message);
};
export const TRACE_CHECK_SOURCE = String.raw`
const path=require('node:path');const loaded={exports:{}};
process.dlopen(loaded,path.join(process.argv[2],'adapter/esbuild-trace-launcher.node'));
const result=JSON.parse(loaded.exports.run());
process.stdout.write('CC_ESBUILD_TRACE:'+JSON.stringify(result)+'\n');
if(!result.completed)process.exitCode=2;
`;
export function inspectEsbuildTrace(report) {
  insist(
    report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.status === "NOT_ADMITTED" &&
      report.resultTranslation === false,
    "scope differs",
  );
  insist(
    report.schema === "chainlesschain.windows-esbuild-api-trace/v1" &&
      report.esbuild.digest === ESBUILD_DIGEST &&
      report.runtime.digest === GNU_IDENTITY.runtimeDigest &&
      report.checkDigest === digest(TRACE_CHECK_SOURCE),
    "fixed inputs differ",
  );
  insist(
    report.driver?.digest === capture(fileURLToPath(import.meta.url)).digest &&
      report.sources?.length === 2 &&
      report.sources.every(
        (row, index) =>
          row.digest ===
          capture(path.join(directory, "diagnostics", nativeSources[index]))
            .digest,
      ),
    "source identity differs",
  );
  insist(
    report.manifest?.version === 2 &&
      digest(JSON.stringify(report.manifest)) === report.manifestDigest &&
      report.settlement?.manifestDigest === report.manifestDigest.slice(7) &&
      report.manifest.files.length === 5 &&
      report.manifest.runtime.sha256 === GNU_IDENTITY.runtimeDigest.slice(7),
    "guarded manifest differs",
  );
  const expectedFiles = [
    ["esbuild.exe", ESBUILD_DIGEST],
    ["entry.js", digest("export const answer = 42;\n")],
    ...report.outputs.map((row) => [
      "adapter/" + path.win32.basename(row.path),
      row.digest,
    ]),
  ];
  insist(
    report.outputs.length === 2 &&
      expectedFiles.every(([file, hash]) => {
        const matches = report.manifest.files.filter(
          (row) =>
            row.path === path.win32.join(report.manifest.workspace, file),
        );
        return matches.length === 1 && "sha256:" + matches[0].sha256 === hash;
      }) &&
      report.manifest.files.some(
        (row) =>
          row.path ===
            path.win32.join(report.manifest.root, "control/check.cjs") &&
          "sha256:" + row.sha256 === report.checkDigest,
      ),
    "guarded source bytes differ",
  );
  insist(
    report.execution?.status === 0 &&
      report.execution.signal === null &&
      report.execution.error === null &&
      report.settlement?.cleanupConfirmed === true &&
      report.settlement.executionFailed === false &&
      report.settlement.capabilityCount === 0 &&
      report.settlement.loopbackExemptionAbsent === true &&
      report.settlement.targetExitCode === 0,
    "root or cleanup differs",
  );
  const frames = report.execution.stdout.trim().split(/\r?\n/u);
  insist(
    frames.length === 1 && frames[0].startsWith("CC_ESBUILD_TRACE:"),
    "unique launcher frame required",
  );
  const launcher = JSON.parse(frames[0].slice("CC_ESBUILD_TRACE:".length));
  insist(
    launcher.completed === true &&
      launcher.stage === "completed" &&
      launcher.error === 0 &&
      launcher.consoleMode === "detached" &&
      launcher.loaderStrategy === "primary-thread-apc" &&
      launcher.rootPid === report.settlement.targetPid &&
      launcher.childPid !== launcher.rootPid &&
      Number.isSafeInteger(launcher.childPid) &&
      launcher.childPid > 0 &&
      launcher.appContainerSid === report.settlement.appContainerSid &&
      launcher.capabilityCount === 0 &&
      launcher.exactHandles === true &&
      launcher.leafRestricted === true &&
      launcher.imagePinned === true &&
      launcher.rootTokenProven === true &&
      launcher.childTokenProven === true &&
      [0, 1].includes(launcher.childExit),
    "child proof differs",
  );
  insist(
    typeof report.execution.stderr === "string" &&
      (launcher.childExit === 0
        ? report.execution.stderr === ""
        : report.execution.stderr.includes("Cannot read directory") &&
          report.execution.stderr.includes("Access is denied")),
    "child stderr does not describe the expected directory rejection",
  );
  insist(
    typeof report.traceRaw === "string" &&
      digest(report.traceRaw) === report.traceDigest,
    "trace bytes differ",
  );
  const rows = report.traceRaw
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  insist(
    rows.length >= 4 &&
      rows.length <= 512 &&
      rows
        .map((row) => row.sequence)
        .sort((left, right) => left - right)
        .every((sequence, index) => sequence === index + 1) &&
      rows.every(
        (row, index) =>
          row.pid === launcher.childPid &&
          row.patches === (index === 0 ? 0 : 2) &&
          row.overflow === 0,
      ),
    "trace population differs",
  );
  insist(
    rows[0].api === "identity-accepted" &&
      rows[1].api === "installed" &&
      rows.at(-1).api === "exit" &&
      rows[0].success &&
      rows[1].success &&
      rows.at(-1).success,
    "shim lifecycle missing",
  );
  const resolved = rows.filter((row) => row.api.startsWith("resolve:"));
  const denied = rows.filter((row) => row.success === false && row.error === 5);
  insist(
    resolved.length > 0 && denied.length > 0,
    "no actual dynamic API denial observed",
  );
  return {
    launcher,
    resolved: resolved.map((row) => row.api),
    denied,
    rows: rows.length,
  };
}
export async function runEsbuildTrace({ compiler, headers, esbuild, output }) {
  insist(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.version === GNU_IDENTITY.nodeVersion,
    "fixed Windows runtime required",
  );
  for (const value of [compiler, headers, esbuild, output])
    insist(path.isAbsolute(value), "absolute paths required");
  insist(
    path.basename(compiler) === "x86_64-w64-mingw32-clang++.exe" &&
      compiler.includes("llvm-mingw-20261006-ucrt-x86_64"),
    "selected compiler required",
  );
  const runtime = capture(fs.realpathSync.native(process.execPath)),
    binary = capture(esbuild);
  insist(
    runtime.digest === GNU_IDENTITY.runtimeDigest &&
      binary.digest === ESBUILD_DIGEST,
    "runtime or esbuild digest differs",
  );
  const imported = inspectPe(fs.readFileSync(esbuild)).imports;
  insist(
    imported
      .flatMap((row) => row.names)
      .filter((name) => name === "GetProcAddress").length === 2,
    "fixed esbuild import shape differs",
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.windows-esbuild-api-trace/v1",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    status: "NOT_ADMITTED",
    resultTranslation: false,
    completed: false,
    runtime,
    esbuild: binary,
    checkDigest: digest(TRACE_CHECK_SOURCE),
    commands: [],
    startedAt: new Date().toISOString(),
  };
  try {
    report.sources = nativeSources.map((name) =>
      capture(path.join(directory, "diagnostics", name)),
    );
    report.driver = capture(fileURLToPath(import.meta.url));
    report.headers = [
      "node_api.h",
      "node_api_types.h",
      "js_native_api.h",
      "js_native_api_types.h",
      "node_version.h",
    ].map((name) => capture(path.join(headers, name)));
    const bin = path.dirname(compiler);
    report.compiler = [
      ...new Set([
        compiler,
        path.join(bin, "clang-23.exe"),
        path.join(bin, "ld.lld.exe"),
        ...fs
          .readdirSync(bin)
          .filter((name) => name.endsWith(".dll"))
          .map((name) => path.join(bin, name)),
      ]),
    ].map((file) => capture(file));
    report.compilerScope =
      "recorded source, header, compiler and adjacent DLL bytes; not hermetic";
    report.outputs = [];
    for (const [index, name] of [
      "esbuild-trace-launcher.node",
      "esbuild-trace-shim.dll",
    ].entries()) {
      const target = path.join(output, name),
        args = [
          "-std=c++17",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-static",
          "-shared",
          "-I",
          headers,
          report.sources[index].path,
          "-ladvapi32",
          "-Wl,--no-insert-timestamp",
          "-o",
          target,
        ];
      const run = spawnSync(compiler, args, {
        windowsHide: true,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      });
      report.commands.push({
        executable: compiler,
        args,
        status: run.status,
        signal: run.signal,
        error: run.error?.message ?? null,
        stdout: run.stdout,
        stderr: run.stderr,
      });
      insist(
        run.status === 0 && !run.signal && !run.error,
        "native compile failed",
      );
      report.outputs.push(capture(target));
    }
    const sourceRoot = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-esbuild-trace-source-",
      ),
    );
    report.sourceRoot = sourceRoot;
    fs.mkdirSync(path.join(sourceRoot, "adapter"));
    fs.copyFileSync(
      esbuild,
      path.join(sourceRoot, "esbuild.exe"),
      fs.constants.COPYFILE_EXCL,
    );
    const entry = "export const answer = 42;\n";
    fs.writeFileSync(path.join(sourceRoot, "entry.js"), entry, { flag: "wx" });
    for (const row of report.outputs)
      fs.copyFileSync(
        row.path,
        path.join(sourceRoot, "adapter", path.basename(row.path)),
        fs.constants.COPYFILE_EXCL,
      );
    const snapshots = [
      { path: "esbuild.exe", bytes: binary.bytes, digest: binary.digest },
      {
        path: "entry.js",
        bytes: Buffer.byteLength(entry),
        digest: digest(entry),
      },
      ...report.outputs.map((row) => ({
        path: "adapter/" + path.basename(row.path),
        bytes: row.bytes,
        digest: row.digest,
      })),
    ];
    const binding = {
      inventoryDigest: digest(JSON.stringify(snapshots)),
      lockDigest: GNU_IDENTITY.lockDigest,
      planDigest: GNU_IDENTITY.planDigest,
      projectCommit: GNU_IDENTITY.projectCommit,
      runtime: {
        platform: "win32",
        architecture: "x64",
        nodeVersion: process.version,
        modulesAbi: process.versions.modules,
        executableDigest: runtime.digest,
      },
    };
    const evaluator = createWindowsNativeCapsuleEvaluator({
      sourceRoot,
      snapshots,
      binding,
      checkSource: TRACE_CHECK_SOURCE,
      wallTimeMs: 15000,
    });
    report.manifest = evaluator.manifest;
    report.manifestDigest = "sha256:" + evaluator.manifestDigest;
    const { result, receipt } = await evaluator.execute();
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    report.settlement = receipt;
    const launcherLines = (result.stdout ?? "").trim().split(/\r?\n/u);
    if (
      launcherLines.length === 1 &&
      launcherLines[0].startsWith("CC_ESBUILD_TRACE:")
    ) {
      try {
        report.launcherObservation = JSON.parse(
          launcherLines[0].slice("CC_ESBUILD_TRACE:".length),
        );
      } catch {
        // Preserve malformed stdout in execution; it cannot prove a launcher result.
      }
    }
    const traceFile = path.join(
      evaluator.manifest.scratch,
      "esbuild-api-trace.jsonl",
    );
    if (fs.existsSync(traceFile)) {
      report.traceRaw = fs.readFileSync(traceFile, "utf8");
      report.traceDigest = digest(report.traceRaw);
      fs.writeFileSync(path.join(output, "trace.jsonl"), report.traceRaw, {
        flag: "wx",
      });
    }
    report.observations = inspectEsbuildTrace(report);
    report.completed = true;
  } catch (error) {
    report.error = error.message;
    if (error.nativeEvaluator) report.failure = error.nativeEvaluator;
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        compiler: { type: "string" },
        headers: { type: "string" },
        esbuild: { type: "string" },
        output: { type: "string" },
        "confirm-native": { type: "boolean" },
      },
    });
    insist(
      values["confirm-native"] === true,
      "explicit native confirmation required",
    );
    const report = await runEsbuildTrace(values);
    console.log(
      JSON.stringify({
        completed: report.completed,
        error: report.error ?? null,
        output: values.output,
      }),
    );
    process.exitCode = report.completed ? 0 : 2;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
