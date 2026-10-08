#!/usr/bin/env node
/** Exact all-file stdio diagnostic. It does not amend capability admission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createWindowsNativeEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`All-file stdio diagnostic: ${message}`);
};
export const ALL_FILE_CHILD_SOURCE = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');
const input=fs.readFileSync(0);
const payload={marker:'all-file-child-ok',pid:process.pid,parentPid:process.ppid,inputBytes:input.length,inputDigest:'sha256:'+crypto.createHash('sha256').update(input).digest('hex'),runtime:process.execPath,nodeVersion:process.version,libuvVersion:process.versions.uv};
fs.writeSync(1,JSON.stringify(payload)+'\n');
fs.writeSync(2,'all-file-stderr-ok\n');
`;
export const ALL_FILE_CHECK_SOURCE = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const workspace=process.argv[2],scratch=process.argv[3];
const descriptors=[];let result,closed=0;
try{
 descriptors.push(fs.openSync(path.join(workspace,'input.bin'),'r'));
 descriptors.push(fs.openSync(path.join(scratch,'stdout.txt'),'wx'));
 descriptors.push(fs.openSync(path.join(scratch,'stderr.txt'),'wx'));
 result=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(workspace,'child.cjs')],{stdio:descriptors,windowsHide:true,timeout:2000});
}finally{for(const fd of descriptors){fs.closeSync(fd);closed++;}}
process.stdout.write('CC_ALL_FILE_STDIO:'+JSON.stringify({mode:'file-file-file',pid:process.pid,status:result.status,signal:result.signal,errorCode:result.error?.code??null,descriptorsClosed:closed,stdout:fs.readFileSync(path.join(scratch,'stdout.txt'),'utf8'),stderr:fs.readFileSync(path.join(scratch,'stderr.txt'),'utf8')})+'\n');
`;

export function inspectAllFileExecution({
  execution,
  settlement,
  manifestDigest,
  runtime,
  input,
}) {
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(manifestDigest ?? "") &&
      settlement?.manifestDigest === manifestDigest.slice(7) &&
      settlement.cleanupConfirmed === true &&
      settlement.capabilityCount === 0 &&
      settlement.loopbackExemptionAbsent === true &&
      settlement.executionFailed === false &&
      settlement.targetExitCode === 0 &&
      Number.isSafeInteger(settlement.targetPid) &&
      settlement.targetPid > 0 &&
      execution?.status === 0 &&
      execution.signal === null &&
      execution.error === null &&
      execution.stderr === "",
    "native completion or cleanup unconfirmed",
  );
  requireCondition(
    typeof execution.stdout === "string" &&
      execution.stdout.length <= 16384 &&
      /^CC_ALL_FILE_STDIO:[^\r\n]+\n$/u.test(execution.stdout),
    "missing or extra output",
  );
  const record = JSON.parse(
    execution.stdout.slice("CC_ALL_FILE_STDIO:".length),
  );
  requireCondition(
    record.mode === "file-file-file" &&
      record.pid === settlement.targetPid &&
      record.status === 0 &&
      record.signal === null &&
      record.errorCode === null &&
      record.descriptorsClosed === 3 &&
      record.stderr === "all-file-stderr-ok\n" &&
      typeof record.stdout === "string" &&
      /^[^\r\n]+\n$/u.test(record.stdout),
    "file child or descriptors unconfirmed",
  );
  const child = JSON.parse(record.stdout);
  requireCondition(
    child.marker === "all-file-child-ok" &&
      Number.isSafeInteger(child.pid) &&
      child.pid > 0 &&
      child.pid !== settlement.targetPid &&
      child.parentPid === settlement.targetPid &&
      child.runtime === runtime.path &&
      child.nodeVersion === runtime.nodeVersion &&
      child.libuvVersion === runtime.libuvVersion &&
      Number.isSafeInteger(input?.bytes) &&
      input.bytes > 0 &&
      /^sha256:[a-f0-9]{64}$/u.test(input.digest ?? "") &&
      child.inputBytes === input.bytes &&
      child.inputDigest === input.digest,
    "stdin bytes, child identity or runtime differs",
  );
  return { record, child, diagnosticCompleted: true, capabilities: {} };
}

export async function runAllFileDiagnostic(evidenceDirectory) {
  requireCondition(
    process.platform === "win32" && path.isAbsolute(evidenceDirectory),
    "Windows and new absolute output required",
  );
  fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
  const sourceRoot = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-all-file-source-"),
  );
  const identity = fs.lstatSync(sourceRoot, { bigint: true });
  const input = randomBytes(97);
  const report = {
    schema: "chainlesschain.windows-all-file-stdio-diagnostic/v1",
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
    diagnosticCompleted: false,
    diagnosticRunnerSha256: hash(
      fs.readFileSync(fileURLToPath(import.meta.url)),
    ),
    checkSourceSha256: hash(ALL_FILE_CHECK_SOURCE),
    childSourceSha256: hash(ALL_FILE_CHILD_SOURCE),
    input: { bytes: input.length, digest: hash(input) },
  };
  let evaluator;
  try {
    fs.writeFileSync(
      path.join(sourceRoot, "child.cjs"),
      ALL_FILE_CHILD_SOURCE,
      { flag: "wx" },
    );
    fs.writeFileSync(path.join(sourceRoot, "input.bin"), input, { flag: "wx" });
    evaluator = createWindowsNativeEvaluator({
      sourceRoot,
      files: ["child.cjs", "input.bin"],
      checkSource: ALL_FILE_CHECK_SOURCE,
      wallTimeMs: 10000,
    });
    report.manifest = evaluator.manifest;
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    report.runtime = {
      ...evaluator.manifest.runtime,
      nodeVersion: process.version,
      libuvVersion: process.versions.uv,
    };
    const { result, receipt } = await evaluator.execute();
    report.settlement = receipt;
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
    report.inspected = inspectAllFileExecution(report);
    requireCondition(
      hash(fs.readFileSync(fileURLToPath(import.meta.url))) ===
        report.diagnosticRunnerSha256,
      "diagnostic runner changed",
    );
    evaluator.dispose();
    evaluator = null;
    report.diagnosticCompleted = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (evaluator) report.stageRetained = true;
  } finally {
    try {
      const current = fs.lstatSync(sourceRoot, { bigint: true });
      requireCondition(
        current.dev === identity.dev &&
          current.ino === identity.ino &&
          !current.isSymbolicLink() &&
          fs.realpathSync.native(sourceRoot) === sourceRoot,
        "source root identity changed",
      );
      fs.rmSync(sourceRoot, { recursive: true });
    } catch (error) {
      report.sourceRetained = true;
      report.diagnosticCompleted = false;
      report.sourceCleanupError = String(error.stack || error);
    }
    for (const key of ["stdout", "stderr"])
      if (report.execution)
        report.execution[`${key}Sha256`] = hash(report.execution[key]);
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
    const report = await runAllFileDiagnostic(values.output);
    console.log(
      JSON.stringify({
        diagnosticCompleted: report.diagnosticCompleted,
        capabilities: report.capabilities,
        error: report.error,
      }),
    );
    process.exitCode = report.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
