#!/usr/bin/env node
/** Experimental GNU Rollup compatibility only. No production admission or release. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createWindowsNativeCapsuleEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

export const GNU_IDENTITY = Object.freeze({
  runtimeDigest:
    "sha256:ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3",
  addonDigest:
    "sha256:a4296f17cddf99ee84cb358c8590d460d36b445775b64e42760d7c8308d60c13",
  nodeVersion: "v22.22.2",
  modulesAbi: "127",
  packageVersion: "4.62.2",
  planDigest:
    "sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0",
  lockDigest:
    "sha256:f70a1beec6cb222e3e4fbcb13711e67681d49c8f8edb5d75f55000832b95455a",
  projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
});
const directory = path.dirname(fileURLToPath(import.meta.url));
const sourcePaths = [
  "diagnostics/windows-rollup-gnu-forwarder.cpp",
  "diagnostics/windows-rollup-gnu-forwarder.def",
];
export const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const insist = (condition, message) => {
  if (!condition) throw Error("GNU forwarder diagnostic: " + message);
};
export function capture(file, bound = 256 * 1024 * 1024) {
  const before = fs.lstatSync(file, { bigint: true });
  insist(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(bound),
    "plain bounded file required",
  );
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file, { bigint: true });
  insist(
    ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
      (key) => before[key] === after[key],
    ) && bytes.length === Number(before.size),
    "input changed during capture",
  );
  return { path: file, bytes: bytes.length, digest: digest(bytes) };
}

/** Bounded x64 PE table reader; rejects truncated tables, malformed ordinals and bad RVAs. */
export function inspectPe(bytes) {
  insist(
    Buffer.isBuffer(bytes) &&
      bytes.length >= 256 &&
      bytes.length <= 256 * 1024 * 1024,
    "PE bytes outside bound",
  );
  const check = (at, length) =>
    insist(
      Number.isSafeInteger(at) && at >= 0 && at + length <= bytes.length,
      "PE bounds",
    );
  const u16 = (at) => {
    check(at, 2);
    return bytes.readUInt16LE(at);
  };
  const u32 = (at) => {
    check(at, 4);
    return bytes.readUInt32LE(at);
  };
  const pe = u32(60);
  insist(
    u16(0) === 0x5a4d && u32(pe) === 0x4550 && u16(pe + 4) === 0x8664,
    "x64 PE signature",
  );
  const optional = pe + 24,
    sectionCount = u16(pe + 6),
    sections = optional + u16(pe + 20);
  insist(
    u16(optional) === 0x20b &&
      sectionCount > 0 &&
      sectionCount <= 96 &&
      u16(pe + 20) >= 128,
    "PE optional header",
  );
  check(sections, sectionCount * 40);
  const offset = (rva) => {
    const found = [];
    for (let i = 0; i < sectionCount; i++) {
      const section = sections + i * 40,
        address = u32(section + 12),
        rawSize = u32(section + 16);
      if (rva >= address && rva - address < rawSize)
        found.push(u32(section + 20) + rva - address);
    }
    insist(found.length === 1, "PE RVA is unmapped or ambiguous");
    check(found[0], 1);
    return found[0];
  };
  const string = (at) => {
    check(at, 1);
    const end = bytes.indexOf(0, at);
    insist(end >= at && end - at <= 512, "PE string bound");
    const value = bytes.toString("ascii", at, end);
    insist(/^[\x21-\x7e]+$/u.test(value), "PE name must be ASCII");
    return value;
  };
  const imports = [];
  const importRva = u32(optional + 120);
  if (importRva) {
    const start = offset(importRva);
    for (let index = 0; ; index++) {
      insist(index < 256, "PE import descriptor bound");
      const item = start + index * 20;
      check(item, 20);
      if (u32(item + 12) === 0) break;
      const dll = string(offset(u32(item + 12)));
      const names = [],
        thunk = offset(u32(item) || u32(item + 16));
      for (let index = 0; ; index++) {
        insist(index < 16384, "PE thunk bound");
        const at = thunk + index * 8;
        check(at, 8);
        const value = bytes.readBigUInt64LE(at);
        if (!value) break;
        if (value & (1n << 63n)) {
          insist(
            (value & ~((1n << 63n) | 0xffffn)) === 0n,
            "PE invalid ordinal bits",
          );
          names.push("#" + String(value & 0xffffn));
        } else {
          insist(value <= 0xffffffffn, "PE import RVA overflow");
          names.push(string(offset(Number(value)) + 2));
        }
      }
      imports.push({ dll, names });
    }
  }
  const exports = {};
  const exportRva = u32(optional + 112),
    exportSize = u32(optional + 116);
  if (exportRva) {
    const table = offset(exportRva);
    check(table, 40);
    const count = u32(table + 24),
      functions = offset(u32(table + 28)),
      names = offset(u32(table + 32)),
      ordinals = offset(u32(table + 36));
    insist(count <= 65536, "PE export count bound");
    for (let index = 0; index < count; index++) {
      const name = string(offset(u32(names + index * 4))),
        ordinal = u16(ordinals + index * 2);
      insist(
        ordinal < u32(table + 20) && !Object.hasOwn(exports, name),
        "PE export ordinal or duplicate",
      );
      const address = u32(functions + ordinal * 4);
      exports[name] =
        address >= exportRva && address < exportRva + exportSize
          ? string(offset(address))
          : null;
    }
  }
  return { imports, exports };
}

export function inspectForwardingClosure({ addon, runtime, forwarder }) {
  const dependencies = addon.imports.filter(
    (row) => row.dll.toLowerCase() === "libnode.dll",
  );
  insist(
    dependencies.length === 1 && dependencies[0].names.length === 41,
    "exact GNU libnode import population required",
  );
  const symbols = dependencies[0].names;
  insist(
    new Set(symbols).size === 41 &&
      symbols.every((name) => /^napi_[a-z_0-9]+$/u.test(name)),
    "GNU imports must be unique N-API functions",
  );
  insist(
    symbols.every((name) => Object.hasOwn(runtime.exports, name)),
    "runtime lacks a required N-API export",
  );
  insist(
    symbols.every((name) => forwarder.exports[name] === "node.exe." + name),
    "forwarder target differs",
  );
  insist(
    Object.keys(forwarder.exports).length === 43 &&
      Object.hasOwn(forwarder.exports, "napi_register_module_v1") &&
      Object.hasOwn(forwarder.exports, "node_api_module_get_api_version_v1"),
    "forwarder export population differs",
  );
  return { importedFunctions: symbols, allForwardedToPinnedNode: true };
}

function runtimeIdentity() {
  insist(
    process.platform === "win32" &&
      process.arch === "x64" &&
      process.version === GNU_IDENTITY.nodeVersion &&
      process.versions.modules === GNU_IDENTITY.modulesAbi,
    "fixed local Windows runtime required",
  );
  const runtime = capture(fs.realpathSync.native(process.execPath));
  insist(
    runtime.digest === GNU_IDENTITY.runtimeDigest,
    "runtime digest differs",
  );
  return runtime;
}

export function buildForwarder({ compiler, headers, addon, output }) {
  const runtime = runtimeIdentity();
  for (const value of [compiler, headers, addon, output])
    insist(path.isAbsolute(value), "absolute build paths required");
  insist(
    path.basename(compiler) === "x86_64-w64-mingw32-clang++.exe" &&
      compiler.includes("llvm-mingw-20261006-ucrt-x86_64"),
    "selected LLVM-MinGW toolchain required",
  );
  const addonIdentity = capture(addon);
  insist(
    addonIdentity.digest === GNU_IDENTITY.addonDigest,
    "frozen GNU addon digest differs",
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.windows-rollup-gnu-build/v1",
    experimental: true,
    admissionEligible: false,
    completed: false,
    commands: [],
    runtime,
    addon: addonIdentity,
    compilerClosure:
      "recorded compiler executables and adjacent DLLs; not hermetic",
  };
  try {
    report.sources = sourcePaths.map((relative) =>
      capture(path.join(directory, relative)),
    );
    report.headers = [
      "node_api.h",
      "node_api_types.h",
      "js_native_api.h",
      "js_native_api_types.h",
      "node_version.h",
    ].map((name) => capture(path.join(headers, name), 1024 * 1024));
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
    const binary = path.join(output, "libnode.dll");
    const args = [
      "-std=c++17",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-static",
      "-shared",
      "-I",
      headers,
      ...report.sources.map((row) => row.path),
      "-ladvapi32",
      "-Wl,--no-insert-timestamp",
      "-o",
      binary,
    ];
    const result = spawnSync(compiler, args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    report.commands.push({
      executable: compiler,
      args,
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    insist(
      result.status === 0 && !result.signal && !result.error,
      "compiler failed",
    );
    report.output = capture(binary);
    report.closure = inspectForwardingClosure({
      addon: inspectPe(fs.readFileSync(addon)),
      runtime: inspectPe(fs.readFileSync(runtime.path)),
      forwarder: inspectPe(fs.readFileSync(binary)),
    });
    for (const before of [
      runtime,
      addonIdentity,
      ...report.sources,
      ...report.headers,
      ...report.compiler,
    ])
      insist(
        capture(before.path).digest === before.digest,
        "build input changed",
      );
    report.completed = true;
  } catch (error) {
    report.error = error.message;
  }
  fs.writeFileSync(
    path.join(output, "build.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report;
}

export const GNU_EXPECTED = Object.freeze({
  parseBytes: 168,
  parseDigest:
    "sha256:f498ae4db00a25ed85053cdba098cdb03da94787cb89b32680276af822da0d35",
  hashes: {
    xxhashBase16: "2109c9fcc8c72313b44d193fff26f891",
    xxhashBase36: "b8o6skfu8ubtkyilf15ggmgir",
    xxhashBase64Url: "hCcn8yMcjE7RNGT__JviR",
  },
});
export const GNU_CHECK_SOURCE = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const workspace=process.argv[2],scratch=process.argv[3],journal=fs.openSync(path.join(scratch,'gnu-journal.jsonl'),'wx');
let sequence=0;function record(stage,detail={}){fs.writeSync(journal,JSON.stringify({sequence:sequence++,stage,pid:process.pid,...detail})+'\n');fs.fsyncSync(journal);}
const digest=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
record('started');
let missingDllRejected=false;try{process.dlopen({exports:{}},path.join(workspace,'rollup-gnu.node'));}catch(error){missingDllRejected=error.code==='ERR_DLOPEN_FAILED';}assert.ok(missingDllRejected);record('without-forwarder-rejected');
const module={exports:{}};process.dlopen(module,path.join(workspace,'adapter/libnode.dll'));
const native=JSON.parse(module.exports);record('forwarder-loaded',{native});
const addon={exports:{}};process.dlopen(addon,path.join(workspace,'rollup-gnu.node'));
const api=addon.exports;assert.deepEqual(Object.keys(api).sort(),['ParseTask','parse','parseAsync','xxhashBase16','xxhashBase36','xxhashBase64Url']);
assert.equal(typeof api.ParseTask,'function');record('addon-loaded');
const input='export const answer = 42;',sync=api.parse(input,false,false);
assert.ok(Buffer.isBuffer(sync));record('parsed-sync',{bytes:sync.length,digest:digest(sync)});
const asyncResult=await api.parseAsync(input,false,false);
assert.ok(Buffer.isBuffer(asyncResult));assert.ok(sync.equals(asyncResult));record('parsed-async',{bytes:asyncResult.length,digest:digest(asyncResult)});
const hashes=Object.fromEntries(['xxhashBase16','xxhashBase36','xxhashBase64Url'].map(key=>[key,api[key](Buffer.from(input))]));
let invalidRejected=false;try{api.parse(42,false,false);}catch{invalidRejected=true;}assert.ok(invalidRejected);
const changed=api.parse('export const answer = 43;',false,false);assert.ok(!sync.equals(changed));
const detail={native,missingDllRejected,parseBytes:sync.length,parseDigest:digest(sync),asyncDigest:digest(asyncResult),hashes,invalidRejected,changedInputDiffers:true};
record('completed',detail);process.stdout.write('CC_GNU_FORWARDER:'+JSON.stringify(detail)+'\n');
})().catch(error=>{record('failed',{error:error.message});process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>fs.closeSync(journal));
`;

export function inspectGnuResult(report) {
  const receipt = report.settlement,
    execution = report.execution;
  insist(
    report.schema === "chainlesschain.windows-rollup-gnu-diagnostic/v1" &&
      typeof report.buildRaw === "string" &&
      digest(report.buildRaw) === report.buildDigest,
    "build receipt bytes differ",
  );
  const build = JSON.parse(report.buildRaw);
  const expectedSources = [
    ...sourcePaths,
    "windows-rollup-gnu-forwarder.mjs",
  ].map((relative) => capture(path.join(directory, relative)));
  insist(
    Array.isArray(report.sourceIdentity) &&
      report.sourceIdentity.length === expectedSources.length &&
      report.sourceIdentity.every(
        (row, index) =>
          row.bytes === expectedSources[index].bytes &&
          row.digest === expectedSources[index].digest,
      ) &&
      build.schema === "chainlesschain.windows-rollup-gnu-build/v1" &&
      build.completed === true &&
      build.experimental === true &&
      build.admissionEligible === false &&
      build.output.digest === report.forwarder.digest &&
      build.output.bytes === report.forwarder.bytes &&
      build.runtime.digest === GNU_IDENTITY.runtimeDigest &&
      build.addon.digest === GNU_IDENTITY.addonDigest &&
      build.sources.length === 2 &&
      build.sources.every(
        (row, index) =>
          row.digest === expectedSources[index].digest &&
          row.bytes === expectedSources[index].bytes,
      ),
    "source or build identity differs",
  );
  insist(
    report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.status === "NOT_ADMITTED" &&
      report.providerAssessed === false &&
      report.runtime?.digest === GNU_IDENTITY.runtimeDigest &&
      report.addon?.digest === GNU_IDENTITY.addonDigest &&
      report.checkDigest === digest(GNU_CHECK_SOURCE),
    "scope or pinned identities differ",
  );
  insist(
    execution?.status === 0 &&
      execution.signal === null &&
      execution.error === null &&
      execution.stderr === "" &&
      receipt?.cleanupConfirmed === true &&
      receipt.executionFailed === false &&
      receipt.targetExitCode === 0 &&
      receipt.capabilityCount === 0 &&
      receipt.loopbackExemptionAbsent === true,
    "execution or cleanup incomplete",
  );
  insist(
    digest(JSON.stringify(report.manifest)) === report.manifestDigest &&
      receipt.manifestDigest === report.manifestDigest.slice(7) &&
      report.manifest.runtime.sha256 === GNU_IDENTITY.runtimeDigest.slice(7) &&
      report.manifest.version === 2 &&
      report.manifest.files.length === 3 &&
      report.manifest.runtime.path ===
        path.win32.join(report.manifest.root, "control/node.exe") &&
      report.manifest.workspace ===
        path.win32.join(report.manifest.root, "workspace") &&
      report.manifest.scratch ===
        path.win32.join(report.manifest.root, "scratch"),
    "manifest binding differs",
  );
  const binding = report.manifest.capsuleBinding;
  insist(
    binding.lockDigest === GNU_IDENTITY.lockDigest &&
      binding.planDigest === GNU_IDENTITY.planDigest &&
      binding.projectCommit === GNU_IDENTITY.projectCommit &&
      binding.runtime.platform === "win32" &&
      binding.runtime.architecture === "x64" &&
      binding.runtime.nodeVersion === GNU_IDENTITY.nodeVersion &&
      binding.runtime.modulesAbi === GNU_IDENTITY.modulesAbi &&
      binding.runtime.executableDigest === GNU_IDENTITY.runtimeDigest &&
      binding.inventoryDigest ===
        digest(
          JSON.stringify([
            {
              path: "rollup-gnu.node",
              bytes: report.addon.bytes,
              digest: report.addon.digest,
            },
            {
              path: "adapter/libnode.dll",
              bytes: report.forwarder.bytes,
              digest: report.forwarder.digest,
            },
          ]),
        ),
    "capsule inventory or runtime binding differs",
  );
  for (const [suffix, expected] of [
    ["workspace/rollup-gnu.node", GNU_IDENTITY.addonDigest],
    ["workspace/adapter/libnode.dll", report.forwarder.digest],
    ["control/check.cjs", report.checkDigest],
  ]) {
    const matches = report.manifest.files.filter(
      (row) => row.path === path.win32.join(report.manifest.root, suffix),
    );
    insist(
      matches.length === 1 && "sha256:" + matches[0].sha256 === expected,
      "guarded file binding differs",
    );
  }
  insist(
    digest(report.journalRaw) === report.journalDigest,
    "journal digest differs",
  );
  const rows = report.journalRaw
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const stages = [
    "started",
    "without-forwarder-rejected",
    "forwarder-loaded",
    "addon-loaded",
    "parsed-sync",
    "parsed-async",
    "completed",
  ];
  insist(
    rows.length === stages.length &&
      rows.every(
        (row, index) =>
          row.sequence === index &&
          row.stage === stages[index] &&
          row.pid === receipt.targetPid,
      ),
    "journal population differs",
  );
  const lines = execution.stdout.trim().split(/\r?\n/u);
  insist(
    lines.length === 1 && lines[0].startsWith("CC_GNU_FORWARDER:"),
    "unique frame missing",
  );
  const frame = JSON.parse(lines[0].slice("CC_GNU_FORWARDER:".length));
  const detail = Object.fromEntries(
    Object.entries(rows.at(-1)).filter(
      ([key]) => !["stage", "sequence", "pid"].includes(key),
    ),
  );
  insist(
    JSON.stringify(frame) === JSON.stringify(detail),
    "journal and frame differ",
  );
  const proof = frame.native;
  insist(
    proof.pid === receipt.targetPid &&
      proof.appContainerSid === receipt.appContainerSid &&
      proof.capabilityCount === 0 &&
      proof.inJob === true &&
      proof.forwardedSymbols === 41 &&
      proof.sameFunctionAddresses === true &&
      JSON.stringify(proof) === JSON.stringify(rows[2].native),
    "native token or function identity differs",
  );
  insist(
    frame.parseBytes === GNU_EXPECTED.parseBytes &&
      frame.parseDigest === GNU_EXPECTED.parseDigest &&
      frame.asyncDigest === GNU_EXPECTED.parseDigest &&
      JSON.stringify(frame.hashes) === JSON.stringify(GNU_EXPECTED.hashes) &&
      frame.missingDllRejected === true &&
      frame.invalidRejected === true &&
      frame.changedInputDiffers === true &&
      rows[4].digest === frame.parseDigest &&
      rows[5].digest === frame.asyncDigest &&
      rows[4].bytes === frame.parseBytes &&
      rows[5].bytes === frame.parseBytes,
    "GNU export behavior differs",
  );
  return frame;
}

export async function runGnuDiagnostic({ build, addon, output }) {
  const runtime = runtimeIdentity();
  for (const value of [build, addon, output])
    insist(path.isAbsolute(value), "absolute diagnostic paths required");
  const buildBytes = fs.readFileSync(build),
    record = JSON.parse(buildBytes);
  insist(
    record.completed === true &&
      record.runtime.digest === runtime.digest &&
      record.addon.digest === GNU_IDENTITY.addonDigest,
    "completed pinned build required",
  );
  const forwarder = capture(record.output.path),
    addonIdentity = capture(addon);
  insist(
    forwarder.digest === record.output.digest &&
      addonIdentity.digest === GNU_IDENTITY.addonDigest,
    "build output or addon changed",
  );
  const currentSources = sourcePaths.map((relative) =>
    capture(path.join(directory, relative)),
  );
  insist(
    currentSources.every(
      (item, index) => item.digest === record.sources[index]?.digest,
    ),
    "build source differs",
  );
  inspectForwardingClosure({
    addon: inspectPe(fs.readFileSync(addon)),
    runtime: inspectPe(fs.readFileSync(runtime.path)),
    forwarder: inspectPe(fs.readFileSync(forwarder.path)),
  });
  fs.mkdirSync(output, { mode: 0o700 });
  const sourceRoot = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-gnu-forwarder-source-"),
  );
  fs.mkdirSync(path.join(sourceRoot, "adapter"));
  fs.copyFileSync(
    addon,
    path.join(sourceRoot, "rollup-gnu.node"),
    fs.constants.COPYFILE_EXCL,
  );
  fs.copyFileSync(
    forwarder.path,
    path.join(sourceRoot, "adapter/libnode.dll"),
    fs.constants.COPYFILE_EXCL,
  );
  const snapshots = [
    {
      path: "rollup-gnu.node",
      bytes: addonIdentity.bytes,
      digest: addonIdentity.digest,
    },
    {
      path: "adapter/libnode.dll",
      bytes: forwarder.bytes,
      digest: forwarder.digest,
    },
  ];
  const report = {
    schema: "chainlesschain.windows-rollup-gnu-diagnostic/v1",
    experimental: true,
    admissionEligible: false,
    status: "NOT_ADMITTED",
    formalSample: false,
    providerAssessed: false,
    completed: false,
    runtime,
    addon: addonIdentity,
    forwarder,
    sourceIdentity: [
      ...currentSources,
      capture(fileURLToPath(import.meta.url)),
    ],
    buildRaw: buildBytes.toString("utf8"),
    buildDigest: digest(buildBytes),
    checkDigest: digest(GNU_CHECK_SOURCE),
    osRelease: os.release(),
    sourceRoot,
    startedAt: new Date().toISOString(),
  };
  try {
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
      checkSource: GNU_CHECK_SOURCE,
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
    const journal = path.join(evaluator.manifest.scratch, "gnu-journal.jsonl");
    if (fs.existsSync(journal)) {
      report.journalRaw = fs.readFileSync(journal, "utf8");
      report.journalDigest = digest(report.journalRaw);
      fs.writeFileSync(path.join(output, "journal.jsonl"), report.journalRaw, {
        flag: "wx",
      });
    }
    report.behavior = inspectGnuResult(report);
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
        mode: { type: "string" },
        compiler: { type: "string" },
        headers: { type: "string" },
        addon: { type: "string" },
        output: { type: "string" },
        build: { type: "string" },
        "confirm-native": { type: "boolean" },
      },
    });
    insist(
      ["build", "diagnostic"].includes(values.mode),
      "mode must be build or diagnostic",
    );
    insist(
      values.mode !== "diagnostic" || values["confirm-native"] === true,
      "explicit native confirmation required",
    );
    const report =
      values.mode === "build"
        ? buildForwarder(values)
        : await runGnuDiagnostic(values);
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
