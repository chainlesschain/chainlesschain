#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { createWindowsNativeEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Native realpath diagnostic: ${detail}`);
};
export function inspectRealpathApiExecution(
  execution,
  settlement,
  manifestDigest,
) {
  requireCondition(
    execution?.status === 0 &&
      execution.signal === null &&
      execution.error === null &&
      execution.stderr === "" &&
      /^sha256:[a-f0-9]{64}$/u.test(manifestDigest) &&
      settlement?.cleanupConfirmed === true &&
      settlement.targetExitCode === 0 &&
      settlement.executionFailed === false &&
      settlement.capabilityCount === 0 &&
      settlement.loopbackExemptionAbsent === true &&
      settlement.manifestDigest === manifestDigest.slice(7) &&
      Number.isSafeInteger(settlement.targetPid) &&
      settlement.targetPid > 0,
    "execution or native cleanup not confirmed",
  );
  const lines = execution.stdout.trim().split(/\r?\n/u);
  requireCondition(
    lines.length === 5 &&
      lines.slice(0, 4).every((line) => line.startsWith("CC_REALPATH_API:")) &&
      lines[4].startsWith("CC_REALPATH_CHILD:"),
    "unique finite control records required",
  );
  const rows = lines
    .slice(0, 4)
    .map((line) => JSON.parse(line.slice("CC_REALPATH_API:".length)));
  const expected = [
    "scratch-libuv",
    "workspace-libuv",
    "scratch-shared",
    "workspace-shared",
  ];
  requireCondition(
    JSON.stringify(rows.map((row) => row.label)) === JSON.stringify(expected),
    "control population/order differs",
  );
  const pid = rows[0].pid;
  requireCondition(
    Number.isSafeInteger(pid) && pid > 0 && pid !== settlement.targetPid,
    "fixture process identity missing",
  );
  for (const [index, row] of rows.entries()) {
    requireCondition(
      row.pid === pid &&
        row.tokenIsAppContainer === 1 &&
        row.share === (index < 2 ? 0 : 7) &&
        row.handleClosed === true &&
        typeof row.openSucceeded === "boolean" &&
        Number.isSafeInteger(row.openError) &&
        (row.openSucceeded ? row.openError === 0 : row.openError > 0) &&
        row.queries?.length === 3,
      "open/token/handle evidence differs",
    );
    for (const [position, query] of row.queries.entries())
      requireCondition(
        query.kind ===
          ["normalized-dos", "opened-dos", "normalized-nt"][position] &&
          query.flags === [0, 8, 2][position] &&
          typeof query.success === "boolean" &&
          Number.isSafeInteger(query.win32Error) &&
          Number.isSafeInteger(query.length) &&
          query.length >= 0 &&
          query.length < 32768 &&
          typeof query.path === "string" &&
          (query.success
            ? row.openSucceeded &&
              query.win32Error === 0 &&
              query.length === query.path.length &&
              query.path.length > 0
            : query.win32Error > 0 && query.length === 0 && query.path === ""),
        "canonical query evidence differs",
      );
  }
  const child = JSON.parse(lines[4].slice("CC_REALPATH_CHILD:".length));
  requireCondition(
    child.pid === settlement.targetPid &&
      child.fixturePid === pid &&
      child.status === 0 &&
      child.signal === null &&
      child.error === null,
    "fixture child exit not confirmed",
  );
  return rows;
}

export async function runRealpathApiDiagnostic(output) {
  requireCondition(
    process.platform === "win32" && path.isAbsolute(output),
    "Windows and absolute new output required",
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const sourceRoot = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-realpath-source-"),
  );
  const source = fs.readFileSync(
    new URL("./diagnostics/windows-realpath-api-probe.cs", import.meta.url),
  );
  const sourceFile = path.join(sourceRoot, "probe.cs"),
    binary = path.join(sourceRoot, "probe.exe");
  fs.writeFileSync(sourceFile, source, { flag: "wx" });
  fs.writeFileSync(
    path.join(sourceRoot, "reference.txt"),
    "immutable reference\n",
    { flag: "wx" },
  );
  const compiler = path.join(
    process.env.SystemRoot,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const build = spawnSync(
    compiler,
    ["/nologo", "/target:exe", "/optimize+", `/out:${binary}`, sourceFile],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 65536,
    },
  );
  requireCondition(
    build.status === 0 && !build.error && !build.signal,
    `fixed fixture compilation failed: ${build.stdout} ${build.stderr}`,
  );
  const report = {
    schema: "chainlesschain.windows-realpath-api-diagnostic/v1",
    startedAt: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    architecture: process.arch,
    osRelease: os.release(),
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    capabilities: {},
    fixtureSourceDigest: evalDigest(source),
    fixtureDigest: evalDigest(fs.readFileSync(binary)),
    diagnosticCompleted: false,
  };
  try {
    const evaluator = createWindowsNativeEvaluator({
      sourceRoot,
      files: ["probe.exe", "reference.txt"],
      wallTimeMs: 10000,
      checkSource: String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const workspace=process.argv[2],scratch=process.argv[3];fs.mkdirSync(path.join(scratch,'tmp'));
const result=cp.spawnSync(path.join(workspace,'probe.exe'),[workspace,scratch],{stdio:'inherit',windowsHide:true,timeout:5000});
process.stdout.write('CC_REALPATH_CHILD:'+JSON.stringify({pid:process.pid,fixturePid:result.pid,status:result.status,signal:result.signal,error:result.error?.code??null})+'\n');
`,
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
    report.observations = inspectRealpathApiExecution(
      report.execution,
      receipt,
      report.manifestDigest,
    );
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
        output: { type: "string" },
      },
    });
    requireCondition(
      values["confirm-native"] === true,
      "explicit --confirm-native required",
    );
    const report = await runRealpathApiDiagnostic(values.output);
    console.log(
      JSON.stringify({
        diagnosticCompleted: report.diagnosticCompleted,
        error: report.error ?? null,
        output: values.output,
      }),
    );
    process.exitCode = report.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
