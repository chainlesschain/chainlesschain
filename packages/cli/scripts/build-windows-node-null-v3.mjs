#!/usr/bin/env node
/** Local experimental build only. Never downloads, installs, or publishes. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const requireCondition = (value, message) => {
  if (!value) throw new Error(`Experimental runtime adapter build: ${message}`);
};
function identify(file, bound = 256 * 1024 * 1024) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireCondition(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1n &&
      stat.size > 0n &&
      stat.size <= BigInt(bound),
    "bounded plain build input required",
  );
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file, { bigint: true });
  requireCondition(
    bytes.length === Number(stat.size) &&
      ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => stat[key] === after[key],
      ),
    "build input identity changed",
  );
  return { path: file, bytes: bytes.length, digest: evalDigest(bytes) };
}

export function buildWindowsNullV3Adapter({ compiler, headers, output }) {
  requireCondition(
    process.platform === "win32" && process.arch === "x64",
    "Windows x64 required",
  );
  for (const value of [compiler, headers, output])
    requireCondition(
      typeof value === "string" && path.isAbsolute(value),
      "explicit absolute compiler/header/output paths required",
    );
  requireCondition(
    path.basename(compiler) === "x86_64-w64-mingw32-clang++.exe" &&
      compiler.includes("llvm-mingw-20261006-ucrt-x86_64"),
    "use the explicitly selected LLVM-MinGW 20261006 toolchain",
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.windows-node-null-adapter-build/v3",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    startedAt: new Date().toISOString(),
    commands: [],
    completed: false,
    attestationScope:
      "recorded source, Node headers, compiler executables/DLLs, runtime and output bytes; not a hermetic toolchain closure",
    reproducibility:
      "original linker flags retained; PE timestamps can change output hashes between builds; attest each produced binary independently",
  };
  const invoke = (executable, args) => {
    const result = spawnSync(executable, args, {
      cwd: repository,
      windowsHide: true,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    const record = {
      executable,
      args,
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
    report.commands.push(record);
    requireCondition(
      result.status === 0 && result.signal === null && !result.error,
      "local compiler or selftest failed; retained report contains details",
    );
    return record;
  };
  try {
    const source = path.join(
      repository,
      "packages/cli/scripts/diagnostics/windows-node-null-v3.cpp",
    );
    const preload = path.join(
      repository,
      "packages/cli/scripts/diagnostics/windows-node-null-v3-preload.cjs",
    );
    const bin = path.dirname(compiler);
    report.source = identify(source);
    report.nullHeader = identify(
      path.join(path.dirname(source), "windows-node-null-v3.h"),
    );
    report.preload = identify(preload);
    report.node = {
      version: process.version,
      modulesAbi: process.versions.modules,
      ...identify(process.execPath),
    };
    report.nodeHeaders = [
      "node_api.h",
      "node_api_types.h",
      "js_native_api.h",
      "js_native_api_types.h",
      "node_version.h",
    ].map((name) => identify(path.join(headers, name), 1024 * 1024));
    // The tiny target driver delegates to clang-23 and dynamically linked LLVM.
    // Record those bytes too, rather than treating the wrapper hash as enough.
    const executables = [
      compiler,
      path.join(bin, "clang-23.exe"),
      path.join(bin, "ld.lld.exe"),
    ];
    const dlls = fs
      .readdirSync(bin)
      .filter((name) => name.toLowerCase().endsWith(".dll"))
      .sort()
      .map((name) => path.join(bin, name));
    report.compilerFiles = [...new Set([...executables, ...dlls])].map((file) =>
      identify(file),
    );
    report.compilerVersion = invoke(compiler, ["--version"]).stdout;
    const addon = path.join(output, "windows-node-null-v3.node");
    const selftest = path.join(output, "windows-node-null-v3-selftest.exe");
    const flags = [
      "-std=c++17",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-static",
    ];
    // Same flags and binary basenames as the reviewed local prototype builds.
    invoke(compiler, [
      ...flags,
      "-shared",
      "-I",
      headers,
      source,
      "-ladvapi32",
      "-o",
      addon,
    ]);
    invoke(compiler, [
      ...flags,
      "-DCC_RUNTIME_ADAPTER_SELF_TEST",
      "-I",
      headers,
      source,
      "-ladvapi32",
      "-o",
      selftest,
    ]);
    const testRun = invoke(selftest, []);
    const rows = testRun.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    requireCondition(rows.length === 2, "two native selftest frames required");
    const [nullEvidence, evidence] = rows;
    requireCondition(
      [
        "nullObjectAccessMode",
        "wrongRightsAndTypesRejected",
        "exactNullMapping",
        "eofAndFullWrite",
        "crtShapeNegatives",
        "breakawayRejected",
      ].every((key) => nullEvidence[key] === true),
      "native Null selftest incomplete",
    );
    report.nullSelftestEvidence = nullEvidence;
    requireCondition(
      evidence.parserCases === 21 &&
        evidence.readonlySwapAndRollback === true &&
        evidence.privateRealpathBoundaryAndIdentity === true &&
        evidence.realpathSizeContract === true &&
        evidence.outsideAndHardlinkRejected === true &&
        evidence.wrongPidRejected === true &&
        evidence.retryRejected === true &&
        evidence.patches === 0,
      "native selftest evidence incomplete",
    );
    report.selftestEvidence = evidence;
    report.outputs = [identify(addon), identify(selftest)];
    for (const before of [
      report.source,
      report.nullHeader,
      report.preload,
      report.node,
      ...report.nodeHeaders,
      ...report.compilerFiles,
    ])
      requireCondition(
        identify(before.path).digest === before.digest,
        "recorded build input changed during compilation",
      );
    report.completed = true;
  } catch (error) {
    report.error = error.message;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, "build-report.json"),
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
        compiler: { type: "string" },
        headers: { type: "string" },
        output: { type: "string" },
      },
    });
    const report = buildWindowsNullV3Adapter(values);
    console.log(
      JSON.stringify({
        completed: report.completed,
        error: report.error ?? null,
        output: values.output,
      }),
    );
    process.exitCode = report.completed ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
