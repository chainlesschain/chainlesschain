#!/usr/bin/env node
/** Independent private-drive entry proof. Never production admission or a formal sample. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  capture,
  digest,
  GNU_IDENTITY,
} from "./windows-rollup-gnu-forwarder.mjs";
import { ESBUILD_DIGEST } from "./windows-esbuild-api-trace.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
export const PRIVATE_MAP_SCHEMA =
  "chainlesschain.windows-esbuild-private-map/v1";
export const ENTRY_SOURCE = "export const answer = 42;\n";
export const BUNDLE_DIGEST =
  "sha256:a665166e9ad45f6b74dfc00bf116547d14b374b345ba0474cfcdb5c366006c07";
export const NATIVE_SOURCES = [
  "windows-esbuild-private-map-supervisor.cpp",
  "windows-esbuild-private-map-shim.cpp",
];
const insist = (value, message) => {
  if (!value) throw new Error("esbuild private-map diagnostic: " + message);
};

function knownMapSnapshot(row) {
  if (!row || typeof row !== "object") return false;
  if (row.status === "absent")
    return row.characters === 0 && row.error === 2 && row.valueHex === "";
  return (
    row.status === "mapped" &&
    Number.isSafeInteger(row.characters) &&
    row.characters > 0 &&
    row.characters <= 4096 &&
    row.error === 0 &&
    typeof row.valueHex === "string" &&
    row.valueHex.length === row.characters * 4 &&
    /^[a-f0-9]+$/u.test(row.valueHex) &&
    row.valueHex.endsWith("0000")
  );
}

export function inspectPrivateMap(report) {
  insist(
    report.schema === PRIVATE_MAP_SCHEMA &&
      report.experimental === true &&
      report.status === "NOT_ADMITTED" &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.resultTranslation === false,
    "scope differs",
  );
  insist(
    report.esbuild?.digest === ESBUILD_DIGEST &&
      report.runtime?.digest === GNU_IDENTITY.runtimeDigest &&
      report.driver?.digest ===
        capture(fileURLToPath(import.meta.url)).digest &&
      report.sources?.length === 2 &&
      report.sources.every(
        (row, index) =>
          row.digest ===
          capture(path.join(directory, "diagnostics", NATIVE_SOURCES[index]))
            .digest,
      ),
    "fixed inputs differ",
  );
  insist(
    typeof report.root === "string" &&
      /^[A-Za-z]:\\/u.test(report.root) &&
      report.outputs?.length === 2 &&
      report.outputs.every(
        (row, index) =>
          path.win32.basename(row.path) ===
            ["supervisor.exe", "shim.dll"][index] &&
          /^sha256:[a-f0-9]{64}$/u.test(row.digest),
      ) &&
      report.stagedInputs?.length === 3,
    "staged artifact inventory differs",
  );
  const expected = [
    ["esbuild.exe", ESBUILD_DIGEST],
    ["shim.dll", report.outputs[1].digest],
    ["entry.js", digest(ENTRY_SOURCE)],
  ];
  insist(
    expected.every(
      ([name, hash]) =>
        report.stagedInputs.filter(
          (row) =>
            row.path === path.win32.join(report.root, "workspace", name) &&
            row.digest === hash,
        ).length === 1,
    ),
    "staged bytes differ",
  );
  insist(
    report.execution?.status === 0 &&
      report.execution.signal === null &&
      report.execution.error === null &&
      report.execution.stderr === "",
    "supervisor did not exit cleanly",
  );
  const frames = report.execution.stdout.trim().split(/\r?\n/u);
  insist(frames.length === 1, "unique supervisor frame required");
  const native = JSON.parse(frames[0]);
  insist(
    native.experimental === true &&
      native.status === "NOT_ADMITTED" &&
      native.completed === true &&
      native.stage === "completed" &&
      native.error === 0 &&
      native.setterStatus === 0 &&
      native.hostNonElevatedUnrestricted === true &&
      Number.isSafeInteger(native.rootPid) &&
      native.rootPid > 0 &&
      Number.isSafeInteger(native.childPid) &&
      native.childPid > 0 &&
      native.childPid !== native.rootPid &&
      native.childExit === 0 &&
      native.childTokenProven === true &&
      /^S-1-15-2-(?:\d+-){6}\d+$/u.test(native.appContainerSid) &&
      native.capabilityCount === 0 &&
      native.imagePinned === true &&
      native.leafRestricted === true &&
      native.exactHandleCount === 5 &&
      native.mapPrepared === true &&
      native.mapInstalled === true &&
      native.parentMapUnchanged === true &&
      native.cleanupConfirmed === true &&
      native.childCreated === true &&
      native.jobAssigned === true &&
      native.childWaitStatus === 0 &&
      native.childExitRead === true &&
      native.childExited === true &&
      native.jobQuerySucceeded === true &&
      native.jobActiveProcesses === 0 &&
      native.profileDeleted === true &&
      native.loopbackExemptionAbsent === true &&
      /^\\Device\\HarddiskVolume\d+\\/u.test(native.guardedRootNt) &&
      native.guardedRootNt.slice(
        native.guardedRootNt.indexOf("\\", "\\Device\\".length),
      ) === report.root.slice(2) &&
      /^[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/u.test(native.guardedRootFileId),
    "native authority proof differs",
  );
  insist(
    [native.beforeMap, native.afterSetterMap, native.afterChildMap].every(
      knownMapSnapshot,
    ) &&
      [native.afterSetterMap, native.afterChildMap].every((row) =>
        ["status", "characters", "error", "valueHex"].every(
          (key) => row[key] === native.beforeMap[key],
        ),
      ),
    "parent mapping was not conclusively observed unchanged",
  );
  insist(
    typeof native.directTerminationAttempted === "boolean" &&
      typeof native.directTerminationSucceeded === "boolean" &&
      Number.isSafeInteger(native.directTerminationError) &&
      native.directTerminationError >= 0 &&
      (native.directTerminationAttempted ||
        (!native.directTerminationSucceeded &&
          native.directTerminationError === 0)) &&
      (!native.directTerminationSucceeded ||
        native.directTerminationError === 0),
    "direct termination observation differs",
  );
  insist(
    typeof report.trace?.text === "string" &&
      digest(report.trace.text) === report.trace.digest,
    "trace bytes differ",
  );
  const rows = report.trace.text
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  insist(
    rows.length >= 20 &&
      rows.length <= 512 &&
      rows.every(
        (row, index) =>
          row.sequence === index + 1 &&
          row.pid === native.childPid &&
          row.overflow === 0,
      ),
    "trace population differs",
  );
  const installedIndex = rows.findIndex((row) => row.api === "installed");
  insist(
    installedIndex > 0 &&
      rows.every(
        (row, index) => row.patches === (index < installedIndex ? 0 : 2),
      ) &&
      rows[0].api === "identity-accepted" &&
      rows[0].success === true &&
      rows.at(-1).api === "exit" &&
      rows.at(-1).success === true,
    "shim lifecycle differs",
  );
  const one = (api, predicate) => {
    const matches = rows.filter((row) => row.api === api);
    insist(
      matches.length === 1 && predicate(matches[0]),
      "missing or invalid " + api,
    );
    return matches[0];
  };
  one(
    "device-map-handle-access",
    (row) => row.success === true && row.error === 0 && row.kind === 3,
  );
  one(
    "device-map-supervisor-handle",
    (row) => row.success === true && row.kind === 3,
  );
  one(
    "device-map-root-proven",
    (row) => row.success === true && row.requestedPath === native.guardedRootNt,
  );
  one(
    "device-map-file-id-proven",
    (row) =>
      row.success === true && row.requestedPath === native.guardedRootFileId,
  );
  one(
    "namespace-host-root-denied",
    (row) =>
      row.success === true && row.error === 5 && row.requestedPath === "C:\\",
  );
  one(
    "namespace-workspace-write-denied",
    (row) =>
      row.success === true &&
      row.error === 5 &&
      row.requestedPath === "X:\\workspace\\forbidden.txt",
  );
  one(
    "namespace-traversal-confined",
    (row) => row.success === true && row.requestedPath === native.guardedRootNt,
  );
  one("installed", (row) => row.success === true && row.patches === 2);
  for (const name of ["CreateFileW", "GetFileInformationByHandleEx"])
    one("resolve:" + name, (row) => row.success === true);
  insist(
    rows.some(
      (row) =>
        row.api === "CreateFileW" &&
        row.requestedPath === "X:\\" &&
        row.kind === 0x80000000 &&
        row.success === true,
    ) &&
      rows.some(
        (row) =>
          row.api === "GetFileInformationByHandleEx" &&
          row.requestedPath === native.guardedRootNt &&
          row.kind === 11 &&
          row.success === true,
      ) &&
      rows.some(
        (row) =>
          row.api === "CreateFileW" &&
          row.requestedPath === "X:\\workspace\\entry.js" &&
          row.kind === 0x80000000 &&
          row.success === true,
      ) &&
      rows.some(
        (row) =>
          row.api === "CreateFileW" &&
          row.requestedPath === "X:\\scratch\\bundle.js" &&
          row.kind === 0x40000000 &&
          row.success === true,
      ),
    "real directory/entry/bundle operations absent",
  );
  insist(
    report.childStdout?.text === "" &&
      report.childStdout.digest === digest("") &&
      typeof report.childStderr?.text === "string" &&
      digest(report.childStderr.text) === report.childStderr.digest &&
      /scratch[\\/]bundle\.js/u.test(report.childStderr.text) &&
      !/\[ERROR\]|Access is denied/u.test(report.childStderr.text),
    "child output differs",
  );
  insist(
    typeof report.bundle?.text === "string" &&
      digest(report.bundle.text) === report.bundle.digest &&
      report.bundle.digest === BUNDLE_DIGEST,
    "bundle bytes differ",
  );
  return { native, rows: rows.length, bundleDigest: report.bundle.digest };
}

export async function runPrivateMap({ compiler, esbuild, output }) {
  insist(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.version === GNU_IDENTITY.nodeVersion,
    "fixed Windows driver runtime required",
  );
  for (const value of [compiler, esbuild, output])
    insist(path.isAbsolute(value), "absolute paths required");
  insist(
    path.basename(compiler) === "x86_64-w64-mingw32-clang++.exe" &&
      compiler.includes("llvm-mingw-20261006-ucrt-x86_64"),
    "fixed compiler family required",
  );
  const runtime = capture(fs.realpathSync.native(process.execPath)),
    binary = capture(esbuild);
  insist(
    runtime.digest === GNU_IDENTITY.runtimeDigest &&
      binary.digest === ESBUILD_DIGEST,
    "runtime or frozen binary differs",
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: PRIVATE_MAP_SCHEMA,
    experimental: true,
    status: "NOT_ADMITTED",
    admissionEligible: false,
    formalSample: false,
    resultTranslation: false,
    completed: false,
    runtime,
    esbuild: binary,
    driver: capture(fileURLToPath(import.meta.url)),
    sources: NATIVE_SOURCES.map((name) =>
      capture(path.join(directory, "diagnostics", name)),
    ),
    commands: [],
    startedAt: new Date().toISOString(),
  };
  try {
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
      "recorded sources, compiler and adjacent DLL bytes; not hermetic";
    report.outputs = [];
    for (const [index, name] of ["supervisor.exe", "shim.dll"].entries()) {
      const target = path.join(output, name);
      const args = [
        "-std=c++17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-static",
        ...(index === 0 ? ["-municode"] : ["-shared"]),
        report.sources[index].path,
        "-ladvapi32",
        ...(index === 0 ? ["-luserenv", "-lbcrypt", "-lshell32"] : []),
        "-Wl,--no-insert-timestamp",
        "-o",
        target,
      ];
      const run = spawnSync(compiler, args, {
        encoding: "utf8",
        windowsHide: true,
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
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-esbuild-private-map-"),
    );
    report.root = root;
    fs.mkdirSync(path.join(root, "workspace"));
    fs.mkdirSync(path.join(root, "scratch"));
    fs.copyFileSync(
      esbuild,
      path.join(root, "workspace/esbuild.exe"),
      fs.constants.COPYFILE_EXCL,
    );
    fs.copyFileSync(
      report.outputs[1].path,
      path.join(root, "workspace/shim.dll"),
      fs.constants.COPYFILE_EXCL,
    );
    fs.writeFileSync(path.join(root, "workspace/entry.js"), ENTRY_SOURCE, {
      flag: "wx",
    });
    report.stagedInputs = ["esbuild.exe", "shim.dll", "entry.js"].map((name) =>
      capture(path.join(root, "workspace", name)),
    );
    const run = spawnSync(
      report.outputs[0].path,
      [root, report.outputs[1].digest.slice(7)],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    report.execution = {
      status: run.status,
      signal: run.signal,
      error: run.error?.message ?? null,
      stdout: run.stdout,
      stderr: run.stderr,
    };
    for (const [name, key] of [
      ["trace.jsonl", "trace"],
      ["stdout", "childStdout"],
      ["stderr", "childStderr"],
      ["bundle.js", "bundle"],
    ]) {
      const source = path.join(root, "scratch", name);
      if (fs.existsSync(source)) {
        const bytes = fs.readFileSync(source);
        fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
        report[key] = { digest: digest(bytes), text: bytes.toString("utf8") };
      }
    }
    report.observations = inspectPrivateMap(report);
    report.completed = true;
  } catch (error) {
    report.error = error.message;
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
        esbuild: { type: "string" },
        output: { type: "string" },
        "confirm-native": { type: "boolean" },
      },
    });
    insist(
      values["confirm-native"] === true,
      "explicit native confirmation required",
    );
    const report = await runPrivateMap(values);
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
