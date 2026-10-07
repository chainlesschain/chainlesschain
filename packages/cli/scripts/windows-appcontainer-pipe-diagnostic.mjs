#!/usr/bin/env node
/** Fixed Win32 API diagnostic only. No sandbox/helper changes or support grants. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createWindowsNativeEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fixture = new URL(
  "./diagnostics/windows-pipe-api-probe.cs",
  import.meta.url,
);
export const PIPE_DIAGNOSTIC_UPSTREAM = Object.freeze({
  nodeVersion: "v22.22.2",
  libuvVersion: "1.51.0",
  nodeCommit: "2645dc73720b1b4f27c49f395d3c66025ce126cc",
  tagObject: "c7462cf36736a20ed7b8d701dedbe713dff0e1df",
  sources: [
    {
      path: "deps/uv/src/win/pipe.c",
      sha256:
        "sha256:4d370ce0bc10f8ae429f8acb2c7688d74b753e0177f347f5f3d337647e77ca38",
    },
    {
      path: "deps/uv/src/win/process-stdio.c",
      sha256:
        "sha256:7367280da2315b8cf16d42870a972164763b1967f8e39bd141b27726237872d8",
    },
  ],
  windowsApiDocumentation:
    "https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea",
});
const checkSource = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const workspace=process.argv[2],scratch=process.argv[3];
for(const [name,directory]of Object.entries({TMP:'tmp',TEMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'home/AppData/Roaming',LOCALAPPDATA:'home/AppData/Local'})){
 const target=path.join(scratch,directory);fs.mkdirSync(target,{recursive:true});process.env[name]=target;
}
const result=cp.spawnSync(path.join(workspace,'pipe-api-probe.exe'),[],{stdio:'inherit',windowsHide:true,timeout:5000});
process.stdout.write('CC_PIPE_CHILD:'+JSON.stringify({pid:process.pid,status:result.status,signal:result.signal,errorCode:result.error?.code??null})+'\n');
// Separate exact finite controls for UV_IGNORE versus inherited/all-file stdin.
const child=path.join(workspace,'file-child.cjs');
for(const mode of ['ignore-stdin','inherit-stdin','file-stdin']){
 const out=fs.openSync(path.join(scratch,mode+'.out'),'wx'),err=fs.openSync(path.join(scratch,mode+'.err'),'wx');
 const input=mode==='file-stdin'?fs.openSync(path.join(workspace,'input.txt'),'r'):null;
 let value;try{value=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',child],{stdio:[mode==='ignore-stdin'?'ignore':mode==='inherit-stdin'?'inherit':input,out,err],windowsHide:true,timeout:1200});}
 finally{fs.closeSync(out);fs.closeSync(err);if(input!==null)fs.closeSync(input);}
 process.stdout.write('CC_FILE_STDIO:'+JSON.stringify({mode,pid:process.pid,status:value.status,signal:value.signal,errorCode:value.error?.code??null,output:fs.readFileSync(path.join(scratch,mode+'.out'),'utf8')})+'\n');
}
`;

export function inspectPipeDiagnosticOutput(
  stdout,
  { appContainer, targetPid } = {},
) {
  const lines = stdout.trim().split(/\r?\n/u);
  requireCondition(
    appContainer === 1 || (appContainer === 0 && lines.length === 6),
    "Invalid API control scope or extra host output",
  );
  const records = lines
    .filter((line) => line.startsWith("CC_PIPE_API:"))
    .map((line) => JSON.parse(line.slice(12)));
  const expected = [
    "libuv-name-1",
    "libuv-name-2",
    "libuv-name-3",
    "local-dot",
    "local-extended",
    "nul-stdin",
  ];
  requireCondition(
    JSON.stringify(records.map((row) => row.label)) ===
      JSON.stringify(expected),
    "Win32 records incomplete or reordered",
  );
  const pid = records[0].pid;
  for (const row of records)
    requireCondition(
      Number.isSafeInteger(pid) &&
        pid > 0 &&
        pid !== targetPid &&
        row.pid === pid &&
        row.tokenIsAppContainer === appContainer &&
        typeof row.success === "boolean" &&
        row.handleClosed === true &&
        Number.isSafeInteger(row.win32Error) &&
        (row.success ? row.win32Error === 0 : row.win32Error > 0) &&
        Number.isSafeInteger(row.elapsedMs) &&
        row.elapsedMs >= 0,
      "Win32 identity/error/handle evidence differs",
    );
  return records;
}

export function inspectNativePipeDiagnosticExecution(
  execution,
  settlement,
  manifestDigest,
) {
  requireCondition(
    settlement?.cleanupConfirmed === true &&
      settlement.capabilityCount === 0 &&
      settlement.loopbackExemptionAbsent === true &&
      settlement.manifestDigest === manifestDigest?.slice(7) &&
      Number.isSafeInteger(settlement.targetPid) &&
      settlement.targetPid > 0 &&
      settlement.targetExitCode === 0 &&
      settlement.executionFailed === false &&
      execution?.status === 0 &&
      execution.signal === null &&
      execution.error === null,
    "Native execution or cleanup is unconfirmed",
  );
  const records = inspectPipeDiagnosticOutput(execution.stdout, {
    appContainer: 1,
    targetPid: settlement.targetPid,
  });
  const lines = execution.stdout.trim().split(/\r?\n/u);
  requireCondition(
    lines.length === 10 &&
      lines[6].startsWith("CC_PIPE_CHILD:") &&
      lines.slice(7).every((line) => line.startsWith("CC_FILE_STDIO:")),
    "Native child/stdio records incomplete or extra",
  );
  const child = JSON.parse(lines[6].slice("CC_PIPE_CHILD:".length));
  requireCondition(
    child.pid === settlement.targetPid &&
      child.status === 0 &&
      child.signal === null &&
      child.errorCode === null,
    "Win32 fixture child did not exit cleanly",
  );
  const fileStdio = lines
    .slice(7)
    .map((line) => JSON.parse(line.slice("CC_FILE_STDIO:".length)));
  requireCondition(
    JSON.stringify(fileStdio.map((row) => row.mode)) ===
      JSON.stringify(["ignore-stdin", "inherit-stdin", "file-stdin"]),
    "File stdio control order changed",
  );
  for (const row of fileStdio) {
    requireCondition(
      row.pid === settlement.targetPid &&
        (row.status === null || Number.isSafeInteger(row.status)) &&
        (row.signal === null || typeof row.signal === "string") &&
        (row.errorCode === null || typeof row.errorCode === "string") &&
        typeof row.output === "string",
      "File stdio control identity or result changed",
    );
    if (row.status === 0) {
      const payload = JSON.parse(row.output);
      requireCondition(
        row.signal === null &&
          row.errorCode === null &&
          payload.marker === "file-child-ok" &&
          Number.isSafeInteger(payload.pid) &&
          payload.pid > 0 &&
          payload.pid !== settlement.targetPid,
        "File stdio success proof changed",
      );
    }
  }
  return { records, fileStdio };
}

export async function runPipeDiagnostic(evidenceDirectory) {
  requireCondition(
    process.platform === "win32" && path.isAbsolute(evidenceDirectory),
    "Windows and absolute new output required",
  );
  fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
  const sourceRoot = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pipe-api-source-"),
  );
  const identity = fs.lstatSync(sourceRoot, { bigint: true });
  const compiler = path.join(
    process.env.SystemRoot,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const binary = path.join(sourceRoot, "pipe-api-probe.exe");
  const source = fs.readFileSync(fixture);
  const sourceFile = path.join(sourceRoot, "pipe-api-probe.cs");
  fs.writeFileSync(sourceFile, source, { flag: "wx" });
  const report = {
    schema: "chainlesschain.windows-appcontainer-pipe-api-diagnostic/v1",
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    libuvVersion: process.versions.uv,
    osRelease: os.release(),
    formalSample: false,
    providerAssessed: false,
    fullReviewPackAssessed: false,
    capabilities: {},
    fixtureSourceSha256: hash(source),
    diagnosticRunnerSha256: hash(
      fs.readFileSync(fileURLToPath(import.meta.url)),
    ),
    checkSourceSha256: hash(checkSource),
    compilerSha256: hash(fs.readFileSync(compiler)),
    upstreamReference: PIPE_DIAGNOSTIC_UPSTREAM,
    upstreamRuntimeMatches:
      process.version === PIPE_DIAGNOSTIC_UPSTREAM.nodeVersion &&
      process.versions.uv === PIPE_DIAGNOSTIC_UPSTREAM.libuvVersion,
    diagnosticCompleted: false,
  };
  let evaluator;
  try {
    const compiled = spawnSync(
      compiler,
      [
        "/nologo",
        "/target:exe",
        "/platform:x64",
        "/optimize+",
        `/out:${binary}`,
        sourceFile,
      ],
      { encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 65536 },
    );
    requireCondition(
      compiled.status === 0 && !compiled.error,
      `Diagnostic compilation failed: ${compiled.stderr || compiled.stdout || compiled.error}`,
    );
    report.fixtureBinarySha256 = hash(fs.readFileSync(binary));
    const host = spawnSync(binary, [], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 65536,
    });
    report.host = {
      status: host.status,
      signal: host.signal,
      error: host.error?.message ?? null,
      stdout: host.stdout || "",
      stderr: host.stderr || "",
    };
    requireCondition(
      host.status === 0 && !host.error && !host.signal,
      "Host API control failed",
    );
    report.host.records = inspectPipeDiagnosticOutput(host.stdout, {
      appContainer: 0,
    });
    fs.writeFileSync(
      path.join(sourceRoot, "file-child.cjs"),
      "process.stdout.write(JSON.stringify({marker:'file-child-ok',pid:process.pid}));\n",
      { flag: "wx" },
    );
    fs.writeFileSync(path.join(sourceRoot, "input.txt"), "private-input\n", {
      flag: "wx",
    });
    evaluator = createWindowsNativeEvaluator({
      sourceRoot,
      files: ["pipe-api-probe.exe", "file-child.cjs", "input.txt"],
      checkSource,
      wallTimeMs: 15000,
    });
    report.manifest = evaluator.manifest;
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    const { result, receipt } = await evaluator.execute();
    report.settlement = receipt;
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
    requireCondition(
      result.status === 0 &&
        !result.error &&
        !result.signal &&
        receipt.targetExitCode === 0 &&
        receipt.executionFailed === false,
      "Native API control did not complete",
    );
    const inspected = inspectNativePipeDiagnosticExecution(
      report.execution,
      receipt,
      report.manifestDigest,
    );
    report.nativeRecords = inspected.records;
    report.fileStdio = inspected.fileStdio;
    requireCondition(
      hash(fs.readFileSync(fixture)) === report.fixtureSourceSha256 &&
        hash(fs.readFileSync(binary)) === report.fixtureBinarySha256 &&
        hash(fs.readFileSync(fileURLToPath(import.meta.url))) ===
          report.diagnosticRunnerSha256,
      "Diagnostic source or binary changed",
    );
    report.diagnosticCompleted = true;
  } catch (error) {
    report.error = String(error.stack || error);
  } finally {
    if (evaluator) {
      if (!report.diagnosticCompleted) report.stageRetained = true;
      else
        try {
          evaluator.dispose();
        } catch (error) {
          report.diagnosticCompleted = false;
          report.stageRetained = true;
          report.cleanupError = String(error.stack || error);
        }
    }
    try {
      const current = fs.lstatSync(sourceRoot, { bigint: true });
      requireCondition(
        current.dev === identity.dev &&
          current.ino === identity.ino &&
          !current.isSymbolicLink() &&
          fs.realpathSync.native(sourceRoot) === sourceRoot,
        "Diagnostic source root identity changed",
      );
      fs.rmSync(sourceRoot, { recursive: true });
    } catch (error) {
      report.sourceRetained = true;
      report.diagnosticCompleted = false;
      report.sourceCleanupError = String(error.stack || error);
    }
    for (const capture of [report.host, report.execution].filter(Boolean))
      for (const key of ["stdout", "stderr"])
        capture[`${key}Sha256`] = hash(capture[key]);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(evidenceDirectory, "report.json"),
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
        output: { type: "string" },
        "confirm-native": { type: "boolean" },
      },
    });
    requireCondition(
      values["confirm-native"] === true && values.output,
      "--confirm-native --output NEW_ABSOLUTE_DIR required",
    );
    const report = await runPipeDiagnostic(values.output);
    console.log(
      JSON.stringify({
        diagnosticCompleted: report.diagnosticCompleted,
        nativeRecords: report.nativeRecords,
        fileStdio: report.fileStdio,
        stageRetained: report.stageRetained,
        error: report.error,
      }),
    );
    process.exitCode = report.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
