#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runMcpSecurityMatrix } from "./ide-roadmap-mcp-security-gate.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const formalResultSchema = "chainlesschain.cli-mcp-security-soak-formal.v3";
const smokeResultSchema =
  "chainlesschain.cli-mcp-security-soak-smoke-non-qualifying.v2";
const formalAggregateSchema =
  "chainlesschain.cli-mcp-security-soak-formal-aggregate.v3";
const smokeAggregateSchema =
  "chainlesschain.cli-mcp-security-soak-smoke-aggregate-non-qualifying.v2";
const innerEvidenceSchema =
  "chainlesschain.ide-roadmap-mcp-security-evidence.v4";
const executionContextBoundarySchema =
  "chainlesschain.cli-mcp-execution-context-live-soak.v2";
const executionContextSampleSchema =
  "chainlesschain.cli-mcp-execution-context-live-sample.v2";
const releaseCommitPattern = /^[0-9a-f]{40}$/u;
const expectedOperatingSystems = Object.freeze(["linux", "macos", "windows"]);
const minimumFormalExecutionContextSamples = 3;
const maximumFormalExecutionContextSchedulingLatenessSeconds = 1_200;
const executionContextProbeTimeoutMs = 15 * 60 * 1_000;
const executionContextTestRelativePath =
  "packages/cli/__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js";
const executionContextTestPath = path.join(
  repoRoot,
  ...executionContextTestRelativePath.split("/"),
);
const executionContextReportPrefixes = Object.freeze({
  linux: "mcp-materialized-capsule-live-Linux",
  macos: "mcp-materialized-capsule-live-macOS",
  windows: "mcp-materialized-capsule-live-Windows",
});
const executionContextAssertionDefinitions = Object.freeze([
  Object.freeze({
    id: "host-effects-boundary",
    ancestor: "live materialized MCP capsule sandbox chain",
    title:
      "denies host effects through the real Client -> Broker -> OS path or fails closed on macOS",
    expectedStatus: () => "passed",
  }),
  Object.freeze({
    id: "capsule-byte-replacement",
    ancestor: "live materialized MCP capsule sandbox chain",
    title:
      "rejects a materialized capsule byte replacement before Broker spawn",
    expectedStatus: () => "passed",
  }),
  Object.freeze({
    id: "windows-observer-compilation",
    ancestor: "materialized MCP capsule host observer helpers",
    title: "compiles the Windows WMI observer with PowerShell 5.1 assemblies",
    expectedStatus: (operatingSystem) =>
      operatingSystem === "windows" ? "passed" : "skipped",
  }),
  Object.freeze({
    id: "windows-live-observer-calibration",
    ancestor: "materialized MCP capsule host observer helpers",
    title:
      "binds a nonce-bearing short-lived child start to its PID and parent",
    expectedStatus: (operatingSystem) =>
      operatingSystem === "windows" ? "passed" : "skipped",
  }),
  Object.freeze({
    id: "live-mode-negative-gate",
    ancestor: "live materialized MCP capsule sandbox chain gate",
    title: "requires CC_SANDBOX_LIVE=1 on a supported platform",
    expectedStatus: () => "skipped",
  }),
]);
const maximumExecutionContextReportBytes = 16 * 1024 * 1024;
const require = createRequire(import.meta.url);

function executionContextReportFile(operatingSystem, sampleIndex) {
  const prefix = executionContextReportPrefixes[operatingSystem];
  if (!prefix || !Number.isSafeInteger(sampleIndex) || sampleIndex < 0) {
    throw new Error("execution-context report identity is invalid");
  }
  return `${prefix}-${String(sampleIndex).padStart(3, "0")}.json`;
}

function positiveNumber(value, fallback, name, { integer = false } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(`${name} must be a positive${integer ? " integer" : ""}`);
  }
  return parsed;
}

export function resolveMcpSecuritySoakProfile(env = process.env) {
  const mode = String(env.CC_CLI_MCP_SECURITY_SOAK_MODE || "smoke").trim();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new Error("CC_CLI_MCP_SECURITY_SOAK_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const floor = (value, minimum) => (formal ? Math.max(value, minimum) : value);
  const executionContextSamples = formal
    ? Math.max(
        positiveNumber(
          env.CC_CLI_MCP_SECURITY_SOAK_EXECUTION_CONTEXT_SAMPLES,
          minimumFormalExecutionContextSamples,
          "MCP execution-context live sample count",
          { integer: true },
        ),
        minimumFormalExecutionContextSamples,
      )
    : 0;
  return Object.freeze({
    mode,
    durationSeconds: floor(
      positiveNumber(
        env.CC_CLI_MCP_SECURITY_SOAK_DURATION_SECONDS,
        formal ? 7_200 : 5,
        "MCP security soak duration seconds",
      ),
      formal ? 7_200 : 1,
    ),
    cycles: floor(
      positiveNumber(
        env.CC_CLI_MCP_SECURITY_SOAK_CYCLES,
        formal ? 100 : 2,
        "MCP security soak cycle count",
        { integer: true },
      ),
      formal ? 100 : 1,
    ),
    checkpointIntervalSeconds: Math.min(
      60,
      positiveNumber(
        env.CC_CLI_MCP_SECURITY_SOAK_CHECKPOINT_INTERVAL_SECONDS,
        formal ? 30 : 1,
        "MCP security soak checkpoint interval seconds",
        { integer: true },
      ),
    ),
    executionContextSamples,
  });
}

export function securitySoakCycleDelayMs(
  nextCycleIndex,
  targetCycles,
  durationMs,
  elapsedMs,
) {
  if (
    !Number.isFinite(nextCycleIndex) ||
    !Number.isFinite(targetCycles) ||
    targetCycles <= 1 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(elapsedMs)
  ) {
    return 0;
  }
  const scheduledElapsedMs =
    (Math.max(0, nextCycleIndex) / (targetCycles - 1)) * durationMs;
  return Math.max(0, scheduledElapsedMs - Math.max(0, elapsedMs));
}

function normalizeOperatingSystem(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return platform;
}

function normalizeReleaseCommit(candidate) {
  const value = String(candidate || "")
    .trim()
    .toLowerCase();
  if (!releaseCommitPattern.test(value)) {
    throw new Error(`release commit must be a full 40-character SHA: ${value}`);
  }
  return value;
}

function gitHead() {
  return normalizeReleaseCommit(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
}

function gitWorktreeChanges() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
}

function atomicWriteJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, resolved);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

function readBoundedJsonEvidence(filePath, label) {
  const resolved = path.resolve(String(filePath || ""));
  let descriptor;
  try {
    const pathStat = fs.lstatSync(resolved);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file`);
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (
      !openedStat.isFile() ||
      openedStat.size <= 0 ||
      openedStat.size > maximumExecutionContextReportBytes
    ) {
      throw new Error(
        `${label} must contain 1-${maximumExecutionContextReportBytes} bytes`,
      );
    }
    if (
      pathStat.dev !== openedStat.dev ||
      pathStat.ino !== openedStat.ino ||
      pathStat.size !== openedStat.size
    ) {
      throw new Error(`${label} identity changed while opening`);
    }
    const bytes = fs.readFileSync(descriptor);
    const finalStat = fs.fstatSync(descriptor);
    if (
      finalStat.dev !== openedStat.dev ||
      finalStat.ino !== openedStat.ino ||
      finalStat.size !== openedStat.size ||
      bytes.length !== openedStat.size
    ) {
      throw new Error(`${label} changed while reading`);
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new Error(`${label} is not valid UTF-8`, { cause });
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      throw new Error(`${label} is not valid JSON`, { cause });
    }
    return Object.freeze({
      resolved,
      value,
      sha256: sha256Bytes(bytes),
    });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function expectedExecutionContextAssertions(operatingSystem) {
  return executionContextAssertionDefinitions.map((definition) => ({
    id: definition.id,
    fullName: `${definition.ancestor} ${definition.title}`,
    status: definition.expectedStatus(operatingSystem),
  }));
}

function smokeExecutionContextBoundary() {
  return {
    schema: executionContextBoundarySchema,
    result: "not_run_non_qualifying_smoke",
    scope: "pr-smoke-without-live-execution-context-sample",
    sampleCount: 0,
    minimumSampleCount: minimumFormalExecutionContextSamples,
    minimumStartSpanSeconds: 7_200,
    observedStartSpanSeconds: 0,
    longRunning: false,
    freshIsolatePerSample: false,
    qualifyingForSingleLiveSample: false,
    qualifyingForLongRunningMatrix: false,
    completeSkillMcpSecurityClosure: false,
    samples: [],
  };
}

/**
 * Parse the exact bytes emitted by Vitest's JSON reporter for the live
 * materialized-capsule integration test. Timing and exact-SHA metadata come
 * from the same host process that spawned this dedicated Vitest process; the
 * aggregate later re-reads these exact bytes and compares the full sample.
 */
export function parseMcpExecutionContextVitestEvidence({
  filePath,
  operatingSystem,
  releaseCommit,
  sampleIndex,
  scheduledElapsedSeconds,
  startedAt,
  finishedAt,
  startedElapsedSeconds,
  finishedElapsedSeconds,
} = {}) {
  if (!expectedOperatingSystems.includes(operatingSystem)) {
    throw new Error(
      `execution-context operating system is invalid: ${String(operatingSystem)}`,
    );
  }
  const normalizedReleaseCommit = normalizeReleaseCommit(releaseCommit);
  const expectedReportFile = executionContextReportFile(
    operatingSystem,
    sampleIndex,
  );
  if (path.basename(String(filePath || "")) !== expectedReportFile) {
    throw new Error(
      `execution-context report for ${operatingSystem} must be named ${expectedReportFile}`,
    );
  }
  const report = readBoundedJsonEvidence(
    filePath,
    `${operatingSystem} MCP execution-context Vitest report`,
  );
  const value = report.value;
  const issues = [];
  const countFields = [
    "numTotalTestSuites",
    "numPassedTestSuites",
    "numFailedTestSuites",
    "numPendingTestSuites",
    "numTotalTests",
    "numPassedTests",
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
  ];
  for (const field of countFields) {
    if (!Number.isSafeInteger(value?.[field]) || value[field] < 0) {
      issues.push(`reporter ${field}`);
    }
  }
  if (value?.success !== true) issues.push("reporter success");
  if (
    value?.numTotalTestSuites <= 0 ||
    value?.numPassedTestSuites !== value?.numTotalTestSuites ||
    value?.numFailedTestSuites !== 0 ||
    value?.numPendingTestSuites !== 0
  ) {
    issues.push("reporter suite totals");
  }
  if (
    value?.numFailedTests !== 0 ||
    value?.numTodoTests !== 0 ||
    value?.numTotalTests !==
      value?.numPassedTests + value?.numPendingTests + value?.numTodoTests
  ) {
    issues.push("reporter test totals");
  }
  if (!Array.isArray(value?.testResults) || value.testResults.length !== 1) {
    issues.push("exactly one test file result");
  }
  const testResult = value?.testResults?.[0];
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  const reporterStartedAtMs = value?.startTime;
  const testFileStartedAtMs = testResult?.startTime;
  const testFileFinishedAtMs = testResult?.endTime;
  if (
    !Number.isSafeInteger(reporterStartedAtMs) ||
    reporterStartedAtMs <= 0 ||
    !Number.isFinite(testFileStartedAtMs) ||
    !Number.isFinite(testFileFinishedAtMs) ||
    testFileStartedAtMs < reporterStartedAtMs ||
    testFileFinishedAtMs < testFileStartedAtMs ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    reporterStartedAtMs < startedAtMs ||
    testFileFinishedAtMs > finishedAtMs
  ) {
    issues.push("reporter run interval binding");
  }
  const normalizedTestName = String(testResult?.name || "").replaceAll(
    "\\",
    "/",
  );
  if (
    normalizedTestName !== executionContextTestRelativePath &&
    !normalizedTestName.endsWith(`/${executionContextTestRelativePath}`)
  ) {
    issues.push("test file identity");
  }
  if (testResult?.status !== "passed") issues.push("test file status");
  const assertions = Array.isArray(testResult?.assertionResults)
    ? testResult.assertionResults
    : [];
  if (!Array.isArray(testResult?.assertionResults)) {
    issues.push("assertion results");
  }
  const statusCounts = { passed: 0, skipped: 0 };
  for (const assertion of assertions) {
    if (!new Set(["passed", "skipped"]).has(assertion?.status)) {
      issues.push(`unexpected assertion status ${String(assertion?.status)}`);
      continue;
    }
    statusCounts[assertion.status] += 1;
    if (
      !Array.isArray(assertion?.failureMessages) ||
      assertion.failureMessages.length !== 0
    ) {
      issues.push(`assertion failure payload ${String(assertion?.fullName)}`);
    }
  }
  if (
    value?.numTotalTests !== assertions.length ||
    value?.numPassedTests !== statusCounts.passed ||
    value?.numPendingTests !== statusCounts.skipped
  ) {
    issues.push("assertion count reconciliation");
  }
  const requiredAssertions = [];
  for (const definition of executionContextAssertionDefinitions) {
    const fullName = `${definition.ancestor} ${definition.title}`;
    const matches = assertions.filter(
      (assertion) =>
        assertion?.title === definition.title &&
        assertion?.fullName === fullName &&
        JSON.stringify(assertion?.ancestorTitles) ===
          JSON.stringify([definition.ancestor]),
    );
    const expectedStatus = definition.expectedStatus(operatingSystem);
    if (matches.length !== 1) {
      issues.push(`required assertion ${definition.id} count`);
    } else if (matches[0].status !== expectedStatus) {
      issues.push(
        `required assertion ${definition.id} status ${String(matches[0].status)}`,
      );
    }
    requiredAssertions.push({
      id: definition.id,
      fullName,
      status: matches.length === 1 ? matches[0].status : null,
    });
  }
  if (issues.length > 0) {
    throw new Error(
      `invalid ${operatingSystem} MCP execution-context Vitest evidence: ${issues.join(", ")}`,
    );
  }
  if (
    !Number.isFinite(scheduledElapsedSeconds) ||
    scheduledElapsedSeconds < 0 ||
    !Number.isFinite(startedElapsedSeconds) ||
    startedElapsedSeconds < scheduledElapsedSeconds ||
    !Number.isFinite(finishedElapsedSeconds) ||
    finishedElapsedSeconds < startedElapsedSeconds ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    finishedAtMs < startedAtMs
  ) {
    throw new Error(
      `invalid ${operatingSystem} MCP execution-context sample timing`,
    );
  }
  return {
    schema: executionContextSampleSchema,
    result: "passed",
    releaseCommit: normalizedReleaseCommit,
    operatingSystem,
    sampleIndex,
    scheduledElapsedSeconds,
    startedAt,
    finishedAt,
    startedElapsedSeconds,
    finishedElapsedSeconds,
    schedulingLatenessSeconds: startedElapsedSeconds - scheduledElapsedSeconds,
    freshIsolate: true,
    invocation: "spawned-node-vitest-process",
    rawReportFile: expectedReportFile,
    rawReportSha256: report.sha256,
    testSource: {
      path: executionContextTestRelativePath,
      sha256: sha256File(executionContextTestPath),
    },
    reporter: {
      totalTestSuites: value.numTotalTestSuites,
      passedTestSuites: value.numPassedTestSuites,
      totalTests: value.numTotalTests,
      passedTests: value.numPassedTests,
      skippedTests: value.numPendingTests,
      failedTests: value.numFailedTests,
      runStartedAtMs: reporterStartedAtMs,
      testFileStartedAtMs,
      testFileFinishedAtMs,
    },
    requiredAssertions,
  };
}

function validateExecutionContextSample(
  value,
  { operatingSystem, releaseCommit, sampleIndex },
) {
  const issues = [];
  if (
    !exactKeys(value, [
      "schema",
      "result",
      "releaseCommit",
      "operatingSystem",
      "sampleIndex",
      "scheduledElapsedSeconds",
      "startedAt",
      "finishedAt",
      "startedElapsedSeconds",
      "finishedElapsedSeconds",
      "schedulingLatenessSeconds",
      "freshIsolate",
      "invocation",
      "rawReportFile",
      "rawReportSha256",
      "testSource",
      "reporter",
      "requiredAssertions",
    ]) ||
    value?.schema !== executionContextSampleSchema ||
    value?.result !== "passed" ||
    value?.releaseCommit !== releaseCommit ||
    value?.operatingSystem !== operatingSystem ||
    value?.sampleIndex !== sampleIndex ||
    value?.freshIsolate !== true ||
    value?.invocation !== "spawned-node-vitest-process" ||
    value?.rawReportFile !==
      executionContextReportFile(operatingSystem, sampleIndex) ||
    !/^sha256:[a-f0-9]{64}$/u.test(value?.rawReportSha256 || "")
  ) {
    issues.push("formal live sample identity");
  }
  const startedAtMs = Date.parse(value?.startedAt);
  const finishedAtMs = Date.parse(value?.finishedAt);
  if (
    !Number.isFinite(value?.scheduledElapsedSeconds) ||
    value.scheduledElapsedSeconds < 0 ||
    !Number.isFinite(value?.startedElapsedSeconds) ||
    value.startedElapsedSeconds < value.scheduledElapsedSeconds ||
    !Number.isFinite(value?.finishedElapsedSeconds) ||
    value.finishedElapsedSeconds < value.startedElapsedSeconds ||
    !Number.isFinite(value?.schedulingLatenessSeconds) ||
    Math.abs(
      value.schedulingLatenessSeconds -
        (value.startedElapsedSeconds - value.scheduledElapsedSeconds),
    ) > 0.001 ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    finishedAtMs < startedAtMs
  ) {
    issues.push("live sample timing");
  }
  if (
    !exactKeys(value?.testSource, ["path", "sha256"]) ||
    value?.testSource?.path !== executionContextTestRelativePath ||
    value?.testSource?.sha256 !== sha256File(executionContextTestPath)
  ) {
    issues.push("live test source identity");
  }
  if (
    !exactKeys(value?.reporter, [
      "totalTestSuites",
      "passedTestSuites",
      "totalTests",
      "passedTests",
      "skippedTests",
      "failedTests",
      "runStartedAtMs",
      "testFileStartedAtMs",
      "testFileFinishedAtMs",
    ]) ||
    !Number.isSafeInteger(value?.reporter?.totalTestSuites) ||
    value.reporter.totalTestSuites <= 0 ||
    value?.reporter?.passedTestSuites !== value?.reporter?.totalTestSuites ||
    !Number.isSafeInteger(value?.reporter?.totalTests) ||
    value.reporter.totalTests <= 0 ||
    !Number.isSafeInteger(value?.reporter?.passedTests) ||
    !Number.isSafeInteger(value?.reporter?.skippedTests) ||
    value?.reporter?.failedTests !== 0 ||
    value.reporter.passedTests + value.reporter.skippedTests !==
      value.reporter.totalTests ||
    !Number.isSafeInteger(value?.reporter?.runStartedAtMs) ||
    value.reporter.runStartedAtMs < startedAtMs ||
    !Number.isFinite(value?.reporter?.testFileStartedAtMs) ||
    value.reporter.testFileStartedAtMs < value.reporter.runStartedAtMs ||
    !Number.isFinite(value?.reporter?.testFileFinishedAtMs) ||
    value.reporter.testFileFinishedAtMs < value.reporter.testFileStartedAtMs ||
    value.reporter.testFileFinishedAtMs > finishedAtMs
  ) {
    issues.push("live reporter totals");
  }
  if (
    JSON.stringify(value?.requiredAssertions) !==
    JSON.stringify(expectedExecutionContextAssertions(operatingSystem))
  ) {
    issues.push("live platform sentinels");
  }
  if (issues.length > 0) {
    throw new Error(
      `invalid ${operatingSystem} MCP execution-context sample ${sampleIndex}: ${issues.join(", ")}`,
    );
  }
  return value;
}

export function buildMcpExecutionContextSoakEvidence({
  operatingSystem,
  releaseCommit,
  durationSeconds,
  samples,
} = {}) {
  const normalizedReleaseCommit = normalizeReleaseCommit(releaseCommit);
  if (!expectedOperatingSystems.includes(operatingSystem)) {
    throw new Error("execution-context soak operating system is invalid");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 7_200) {
    throw new Error(
      "execution-context soak duration must be at least 7200 seconds",
    );
  }
  if (
    !Array.isArray(samples) ||
    samples.length < minimumFormalExecutionContextSamples
  ) {
    throw new Error(
      `execution-context soak requires at least ${minimumFormalExecutionContextSamples} live samples`,
    );
  }
  const validatedSamples = samples.map((sample, sampleIndex) =>
    validateExecutionContextSample(sample, {
      operatingSystem,
      releaseCommit: normalizedReleaseCommit,
      sampleIndex,
    }),
  );
  const scheduleOriginElapsedSeconds =
    validatedSamples[0].startedElapsedSeconds;
  let maximumObservedSchedulingLatenessSeconds = 0;
  for (let index = 0; index < validatedSamples.length; index += 1) {
    const sample = validatedSamples[index];
    const expectedScheduledElapsedSeconds =
      scheduleOriginElapsedSeconds +
      (index / (validatedSamples.length - 1)) * durationSeconds;
    if (
      Math.abs(
        sample.scheduledElapsedSeconds - expectedScheduledElapsedSeconds,
      ) > 0.001
    ) {
      throw new Error(
        `execution-context sample ${index} is not on the evenly-spaced formal schedule`,
      );
    }
    if (
      index > 0 &&
      sample.startedElapsedSeconds <
        validatedSamples[index - 1].finishedElapsedSeconds
    ) {
      throw new Error(
        `execution-context sample ${index} overlaps or precedes the prior fresh isolate`,
      );
    }
    maximumObservedSchedulingLatenessSeconds = Math.max(
      maximumObservedSchedulingLatenessSeconds,
      sample.schedulingLatenessSeconds,
    );
  }
  if (
    maximumObservedSchedulingLatenessSeconds >
    maximumFormalExecutionContextSchedulingLatenessSeconds
  ) {
    throw new Error(
      `execution-context live sample scheduling exceeded ${maximumFormalExecutionContextSchedulingLatenessSeconds} seconds`,
    );
  }
  const observedStartSpanSeconds =
    validatedSamples.at(-1).startedElapsedSeconds -
    validatedSamples[0].startedElapsedSeconds;
  if (observedStartSpanSeconds < durationSeconds) {
    throw new Error(
      `execution-context live sample start span ${observedStartSpanSeconds} is below ${durationSeconds} seconds`,
    );
  }
  return {
    schema: executionContextBoundarySchema,
    result: "passed",
    scope: "fresh-isolate-live-samples-spanning-formal-soak",
    releaseCommit: normalizedReleaseCommit,
    operatingSystem,
    sampleCount: validatedSamples.length,
    minimumSampleCount: minimumFormalExecutionContextSamples,
    minimumStartSpanSeconds: durationSeconds,
    observedStartSpanSeconds,
    scheduleOriginElapsedSeconds,
    sampleIntervalStrategy: "evenly-spaced-from-first-live-start",
    maximumAllowedSchedulingLatenessSeconds:
      maximumFormalExecutionContextSchedulingLatenessSeconds,
    maximumObservedSchedulingLatenessSeconds,
    longRunning: true,
    freshIsolatePerSample: true,
    qualifyingForSingleLiveSample: true,
    qualifyingForLongRunningMatrix: true,
    completeSkillMcpSecurityClosure: false,
    samples: validatedSamples,
  };
}

function validateExecutionContextBoundary(
  value,
  { operatingSystem, releaseCommit, profile },
) {
  if (profile?.mode === "smoke") {
    if (
      JSON.stringify(value) !== JSON.stringify(smokeExecutionContextBoundary())
    ) {
      throw new Error(
        `invalid ${operatingSystem} MCP execution-context boundary: non-qualifying smoke boundary`,
      );
    }
    return value;
  }
  const rebuilt = buildMcpExecutionContextSoakEvidence({
    operatingSystem,
    releaseCommit,
    durationSeconds: profile?.durationSeconds,
    samples: value?.samples,
  });
  if (
    value?.sampleCount !== profile?.executionContextSamples ||
    JSON.stringify(value) !== JSON.stringify(rebuilt)
  ) {
    throw new Error(
      `invalid ${operatingSystem} MCP execution-context boundary: formal repeated live evidence`,
    );
  }
  return value;
}

function prepareExecutionContextEvidenceDirectory(candidate) {
  const resolved = path.resolve(String(candidate || ""));
  if (!candidate) {
    throw new Error(
      "formal MCP security soak requires an execution-context evidence directory",
    );
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        "execution-context evidence path must be a non-symlink directory",
      );
    }
    if (fs.readdirSync(resolved).length !== 0) {
      throw new Error(
        "execution-context evidence directory must be empty before a formal soak",
      );
    }
  } else {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function resolveInstalledVitestEntry() {
  const cliRoot = path.join(repoRoot, "packages", "cli");
  const packageJson = require.resolve("vitest/package.json", {
    paths: [cliRoot],
  });
  const entry = path.join(path.dirname(packageJson), "vitest.mjs");
  const stat = fs.statSync(entry);
  if (!stat.isFile()) {
    throw new Error("the exact installed Vitest entry is not a regular file");
  }
  return entry;
}

function runFreshExecutionContextProbe({ outputFile, env }) {
  if (fs.existsSync(outputFile)) {
    throw new Error(
      `refusing to overwrite execution-context evidence ${path.basename(outputFile)}`,
    );
  }
  const cliRoot = path.join(repoRoot, "packages", "cli");
  const testPath = executionContextTestRelativePath.replace(
    /^packages\/cli\//u,
    "",
  );
  const result = spawnSync(
    process.execPath,
    [
      resolveInstalledVitestEntry(),
      "run",
      "--configLoader",
      "runner",
      "--pool",
      "forks",
      "--maxWorkers",
      "1",
      "--fileParallelism=false",
      "--reporter=json",
      `--outputFile=${outputFile}`,
      testPath,
    ],
    {
      cwd: cliRoot,
      env: { ...env, CC_SANDBOX_LIVE: "1" },
      encoding: "utf8",
      windowsHide: true,
      timeout: executionContextProbeTimeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || result.signal) {
    const detail = String(
      result.error?.message || result.stderr || result.stdout || "no output",
    )
      .replace(/\s+/gu, " ")
      .slice(0, 500);
    throw new Error(
      `fresh execution-context Vitest process failed (status=${String(result.status)}, signal=${String(result.signal)}): ${detail}`,
    );
  }
}

function assertExactCleanSource(
  expectedSha,
  label,
  { getHead = gitHead, getChanges = gitWorktreeChanges } = {},
) {
  const observedHead = getHead();
  const changes = getChanges();
  if (observedHead !== expectedSha || changes.length > 0) {
    throw new Error(
      `${label} refused source drift: head=${observedHead}, changes=${changes.length}`,
    );
  }
}

function safeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: String(error?.message || error || "unknown error")
      .replace(/\s+/gu, " ")
      .slice(0, 500),
  };
}

async function waitWithCheckpoints(delayMs, checkpointIntervalMs, checkpoint) {
  const deadline = performance.now() + Math.max(0, delayMs);
  for (;;) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return;
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, Math.min(remainingMs, checkpointIntervalMs)),
    );
    checkpoint();
  }
}

function validateInnerEvidence(value, { releaseCommit, operatingSystem }) {
  const issues = [];
  if (value?.schema !== innerEvidenceSchema) issues.push("inner schema");
  if (value?.releaseCommit !== releaseCommit) issues.push("inner commit");
  if (value?.result !== "passed") issues.push("inner result");
  if (value?.runner?.operatingSystem !== operatingSystem) {
    issues.push("inner operating system");
  }
  if (
    value?.matrix?.requiredRunsPerTool !== 1 ||
    value?.matrix?.sampleCount !== 3 ||
    value?.matrix?.passCount !== 3 ||
    value?.matrix?.unapprovedTransportCallCount !== 0 ||
    value?.matrix?.unapprovedMutationCount !== 0 ||
    value?.matrix?.unapprovedLedgerRecordCount !== 0 ||
    value?.matrix?.samples?.length !== 3 ||
    value.matrix.samples.some(
      (sample) =>
        sample?.pass !== true ||
        sample?.mutationCount !== 0 ||
        sample?.ledgerRecordCount !== 0,
    )
  ) {
    issues.push("inner unapproved matrix");
  }
  if (
    value?.approvedProbe?.pass !== true ||
    value?.approvedProbe?.transportCallCount !== 1 ||
    value?.staleHostReadPolicyProbe?.pass !== true ||
    value?.staleHostReadPolicyProbe?.sampleCount !== 2 ||
    value?.staleHostReadPolicyProbe?.transportCallCount !== 0 ||
    value?.staleHostReadPolicyProbe?.mutationCount !== 0 ||
    value?.staleHostReadPolicyProbe?.ledgerRecordCount !== 0
  ) {
    issues.push("inner approved or stale-policy probes");
  }
  const race = value?.codeSnapshotRaceProbe;
  if (operatingSystem === "linux") {
    if (
      race?.required !== true ||
      race?.pass !== true ||
      race?.backend !== "linux-fd-code-snapshot" ||
      race?.mechanism !==
        "verified-o_tmpfile-copy-inherited-fd-module-compile-v1" ||
      race?.handleAtomic !== true ||
      race?.entrySnapshotAtomic !== true ||
      race?.runtimeLaunchAtomic !== true ||
      race?.sharedLibraryClosure !== false ||
      race?.requiredRuns !== 1 ||
      race?.sampleCount !== 1 ||
      race?.passCount !== 1 ||
      race?.sourceReplacementObserved !== true ||
      race?.originalSnapshotExecuted !== true ||
      race?.maliciousPathExecuted !== false ||
      race?.exitCode !== 0 ||
      !Number.isSafeInteger(race?.stdoutBytes) ||
      race.stdoutBytes <= 0 ||
      race?.stderrBytes !== 0 ||
      race?.samples?.length !== 1 ||
      race.samples[0]?.id !== "code-snapshot-race-0" ||
      race.samples[0]?.iteration !== 0 ||
      race.samples[0]?.pass !== true ||
      race.samples[0]?.sourceReplacementObserved !== true ||
      race.samples[0]?.originalSnapshotExecuted !== true ||
      race.samples[0]?.maliciousPathExecuted !== false ||
      race.samples[0]?.exitCode !== 0 ||
      race.samples[0]?.stdoutBytes !== race.stdoutBytes ||
      race.samples[0]?.stderrBytes !== 0
    ) {
      issues.push("Linux entry snapshot race");
    }
  } else if (operatingSystem === "macos") {
    if (
      race?.required !== false ||
      race?.pass !== true ||
      race?.reason !== "macos-atomic-runtime-exec-unavailable-fail-closed" ||
      race?.failClosed !== true ||
      race?.candidateBackend !== "macos-fd-code-snapshot" ||
      race?.adapterReason !== "macos_atomic_runtime_exec_unavailable" ||
      race?.runtimeProbeReason !== "public_api_has_no_descriptor_bound_exec" ||
      race?.entrySnapshotAtomic !== false ||
      race?.runtimeLaunchAtomic !== false ||
      race?.requiredRuns !== 0 ||
      race?.sampleCount !== 0 ||
      race?.passCount !== 0 ||
      race?.samples?.length !== 0
    ) {
      issues.push("macOS fail-closed snapshot probe");
    }
  } else if (operatingSystem === "windows") {
    if (
      race?.required !== false ||
      race?.pass !== true ||
      race?.requiredRuns !== 0 ||
      race?.sampleCount !== 0 ||
      race?.passCount !== 0 ||
      race?.samples?.length !== 0 ||
      race?.reason !==
        "windows-code-snapshot-covered-by-separate-strict-gate-not-evaluated"
    ) {
      issues.push("Windows race delegation");
    }
  }
  if (
    value?.invariants?.annotationsAreHintsOnly !== true ||
    value?.invariants?.defaultConfirmationRequired !== true ||
    value?.invariants?.hostAuthorizationRequiredForTrustedRead !== true ||
    value?.invariants?.unapprovedEffectsBeforeTransport !== 0 ||
    value?.invariants?.unapprovedMutations !== 0 ||
    value?.invariants?.unapprovedLedgerWrites !== 0 ||
    value?.invariants?.claimedReadRemainsUnknownWithoutHostAuthorization !==
      true ||
    value?.invariants?.staleHostReadCannotDowngradeRisk !== true
  ) {
    issues.push("inner invariants");
  }
  if (issues.length > 0) {
    throw new Error(`invalid MCP security soak cycle: ${issues.join(", ")}`);
  }
  return value;
}

function expectedTotals(cycles, operatingSystem) {
  return Object.freeze({
    hostCycles: cycles,
    unapprovedEffectSamples: cycles * 3,
    unapprovedTransportCalls: 0,
    unapprovedMutations: 0,
    unapprovedLedgerWrites: 0,
    approvedMutationProbes: cycles,
    staleHostReadPolicySamples: cycles * 2,
    codeSnapshotRaceSamples: operatingSystem === "linux" ? cycles : 0,
    codeSnapshotFailClosedProbes: operatingSystem === "macos" ? cycles : 0,
    atomicPathReplacementEscapes: 0,
  });
}

function validateSoakEvidence(value, { releaseCommit, allowSmoke = false }) {
  const issues = [];
  const operatingSystem = value?.runner?.operatingSystem;
  const profile = value?.profile;
  const mode = profile?.mode;
  const expectedSchema =
    mode === "formal"
      ? formalResultSchema
      : mode === "smoke"
        ? smokeResultSchema
        : null;
  if (value?.schema !== expectedSchema) issues.push("schema");
  if (mode === "smoke" && !allowSmoke) {
    issues.push("non-qualifying smoke is not allowed");
  }
  if (
    value?.qualifyingEvidence !== (mode === "formal") ||
    value?.releaseGateEligible !== (mode === "formal")
  ) {
    issues.push("qualification flags");
  }
  if (value?.releaseCommit !== releaseCommit) issues.push("release commit");
  if (value?.headSha !== releaseCommit) issues.push("HEAD");
  if (value?.expectedSha !== releaseCommit) issues.push("expected SHA");
  if (value?.status !== "passed") issues.push("status");
  if (value?.exactShaVerified !== true) issues.push("exact SHA verification");
  if (
    value?.source?.clean !== true ||
    value?.source?.changeCount !== 0 ||
    value?.source?.finalClean !== true ||
    value?.source?.finalChangeCount !== 0
  ) {
    issues.push("clean source");
  }
  if (!expectedOperatingSystems.includes(operatingSystem)) {
    issues.push("operating system");
  }
  if (
    !new Set(["smoke", "formal"]).has(mode) ||
    !Number.isInteger(profile?.cycles) ||
    profile.cycles < (profile?.mode === "formal" ? 100 : 1) ||
    !Number.isFinite(profile?.durationSeconds) ||
    profile.durationSeconds < (profile?.mode === "formal" ? 7_200 : 1) ||
    !Number.isSafeInteger(profile?.executionContextSamples) ||
    (profile?.mode === "formal"
      ? profile.executionContextSamples < minimumFormalExecutionContextSamples
      : profile.executionContextSamples !== 0)
  ) {
    issues.push("profile floors");
  }
  if (
    !Number.isFinite(value?.continuousDurationSeconds) ||
    value.continuousDurationSeconds < profile?.durationSeconds
  ) {
    issues.push("continuous duration");
  }
  const outerStartedAtMs = Date.parse(value?.startedAt);
  const outerFinishedAtMs = Date.parse(value?.finishedAt);
  if (
    !Number.isFinite(outerStartedAtMs) ||
    !Number.isFinite(outerFinishedAtMs) ||
    outerFinishedAtMs < outerStartedAtMs
  ) {
    issues.push("outer wall-clock interval");
  }
  if (
    !Array.isArray(value?.cycles) ||
    value.cycles.length !== profile?.cycles
  ) {
    issues.push("cycle count");
  } else {
    for (let index = 0; index < value.cycles.length; index += 1) {
      const cycle = value.cycles[index];
      if (cycle?.index !== index) issues.push(`cycle sequence ${index}`);
      try {
        validateInnerEvidence(cycle?.evidence, {
          releaseCommit,
          operatingSystem,
        });
      } catch (error) {
        issues.push(`cycle ${index}: ${error.message}`);
      }
    }
  }
  const totals = expectedTotals(profile?.cycles || 0, operatingSystem);
  if (JSON.stringify(value?.totals) !== JSON.stringify(totals)) {
    issues.push("totals");
  }
  try {
    validateExecutionContextBoundary(value?.executionContextBoundary, {
      operatingSystem,
      releaseCommit,
      profile,
    });
    if (
      mode === "formal" &&
      value.executionContextBoundary.samples.some(
        (sample) =>
          sample.finishedElapsedSeconds > value.continuousDurationSeconds ||
          Date.parse(sample.startedAt) < outerStartedAtMs ||
          Date.parse(sample.finishedAt) > outerFinishedAtMs,
      )
    ) {
      issues.push("live samples outside outer soak interval");
    }
  } catch (error) {
    issues.push(error.message);
  }
  if (value?.violations?.length !== 0) issues.push("violations");
  if (issues.length > 0) {
    throw new Error(`invalid MCP security soak evidence: ${issues.join(", ")}`);
  }
  return value;
}

export async function runMcpSecuritySoak(options = {}) {
  const env = options.env || process.env;
  const profile = options.profile || resolveMcpSecuritySoakProfile(env);
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const wallNowIso = options.wallNowIso || (() => new Date().toISOString());
  const waitForDelay = options.waitForDelay || waitWithCheckpoints;
  const getHead = options.gitHead || gitHead;
  const getChanges = options.gitWorktreeChanges || gitWorktreeChanges;
  const executeSecurityMatrix =
    options.runSecurityMatrix || runMcpSecurityMatrix;
  const operatingSystem = options.operatingSystem || normalizeOperatingSystem();
  if (!expectedOperatingSystems.includes(operatingSystem)) {
    throw new Error("MCP security soak operating system is invalid");
  }
  const headSha = getHead();
  const worktreeChanges = getChanges();
  const expectedShaCandidate =
    options.releaseCommit || env.CC_CLI_MCP_SECURITY_SOAK_EXPECTED_SHA || "";
  const expectedSha = expectedShaCandidate
    ? normalizeReleaseCommit(expectedShaCandidate)
    : null;
  const executionContextDirectoryCandidate =
    options.executionContextDirectory ||
    env.CC_CLI_MCP_SECURITY_SOAK_EXECUTION_CONTEXT_DIR ||
    "";
  const executeExecutionContextProbe =
    options.runExecutionContextProbe || runFreshExecutionContextProbe;
  const output =
    options.output ||
    env.CC_CLI_MCP_SECURITY_SOAK_OUTPUT ||
    path.join(os.tmpdir(), `cli-mcp-security-soak-${process.platform}.json`);
  const startedAt = wallNowIso();
  const started = monotonicNow();
  let rssMaximumBytes = process.memoryUsage().rss;
  let failedCycleEvidence = null;
  const report = {
    schema: profile.mode === "formal" ? formalResultSchema : smokeResultSchema,
    status: "running",
    qualifyingEvidence: profile.mode === "formal",
    releaseGateEligible: profile.mode === "formal",
    startedAt,
    releaseCommit: headSha,
    headSha,
    expectedSha,
    exactShaVerified:
      Boolean(expectedSha) &&
      expectedSha === headSha &&
      worktreeChanges.length === 0,
    source: {
      clean: worktreeChanges.length === 0,
      changeCount: worktreeChanges.length,
      finalClean: null,
      finalChangeCount: null,
    },
    runner: {
      operatingSystem,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    profile,
    executionContextBoundary:
      profile.mode === "formal"
        ? {
            schema: executionContextBoundarySchema,
            result: "pending",
            scope: "fresh-isolate-live-samples-spanning-formal-soak",
            sampleCount: 0,
            minimumSampleCount: minimumFormalExecutionContextSamples,
            minimumStartSpanSeconds: profile.durationSeconds,
            observedStartSpanSeconds: 0,
            longRunning: false,
            freshIsolatePerSample: true,
            qualifyingForSingleLiveSample: false,
            qualifyingForLongRunningMatrix: false,
            completeSkillMcpSecurityClosure: false,
            samples: [],
          }
        : smokeExecutionContextBoundary(),
    cycles: [],
    totals: expectedTotals(0, operatingSystem),
    rss: {
      beforeBytes: rssMaximumBytes,
      maximumBytes: rssMaximumBytes,
      afterBytes: null,
      growthBytes: null,
      peakGrowthBytes: 0,
    },
    violations: [],
  };
  const checkpoint = () => {
    report.checkpointedAt = wallNowIso();
    report.continuousDurationSeconds = (monotonicNow() - started) / 1_000;
    report.rss.maximumBytes = rssMaximumBytes;
    atomicWriteJson(output, report);
  };
  checkpoint();
  try {
    if (!expectedSha) {
      throw new Error("an exact expected release SHA is required");
    }
    if (expectedSha !== headSha) {
      throw new Error(
        `exact SHA mismatch: expected ${expectedSha}, got ${headSha}`,
      );
    }
    if (worktreeChanges.length > 0) {
      throw new Error(
        `exact SHA source verification refused ${worktreeChanges.length} worktree change(s)`,
      );
    }
    const executionContextSamples = [];
    let executionContextTargets = [];
    let nextExecutionContextSample = 0;
    let executionContextDirectory = null;
    const runExecutionContextSample = async (
      sampleIndex,
      scheduledElapsedSeconds,
    ) => {
      assertExactCleanSource(
        headSha,
        `execution-context sample ${sampleIndex} preflight`,
        { getHead, getChanges },
      );
      const rawReportFile = executionContextReportFile(
        report.runner.operatingSystem,
        sampleIndex,
      );
      const rawReportPath = path.join(executionContextDirectory, rawReportFile);
      const startedAtForSample = wallNowIso();
      const startedElapsedSeconds = (monotonicNow() - started) / 1_000;
      const effectiveScheduledElapsedSeconds =
        scheduledElapsedSeconds ?? startedElapsedSeconds;
      await Promise.resolve(
        executeExecutionContextProbe({
          outputFile: rawReportPath,
          operatingSystem: report.runner.operatingSystem,
          releaseCommit: headSha,
          sampleIndex,
          env,
        }),
      );
      const finishedElapsedSeconds = (monotonicNow() - started) / 1_000;
      const finishedAtForSample = wallNowIso();
      assertExactCleanSource(
        headSha,
        `execution-context sample ${sampleIndex} completion`,
        { getHead, getChanges },
      );
      const sample = parseMcpExecutionContextVitestEvidence({
        filePath: rawReportPath,
        operatingSystem: report.runner.operatingSystem,
        releaseCommit: headSha,
        sampleIndex,
        scheduledElapsedSeconds: effectiveScheduledElapsedSeconds,
        startedAt: startedAtForSample,
        finishedAt: finishedAtForSample,
        startedElapsedSeconds,
        finishedElapsedSeconds,
      });
      executionContextSamples.push(sample);
      report.executionContextBoundary.sampleCount =
        executionContextSamples.length;
      report.executionContextBoundary.samples = [...executionContextSamples];
      rssMaximumBytes = Math.max(rssMaximumBytes, process.memoryUsage().rss);
      checkpoint();
      return sample;
    };
    if (profile.mode === "formal") {
      executionContextDirectory = prepareExecutionContextEvidenceDirectory(
        executionContextDirectoryCandidate,
      );
      const firstSample = await runExecutionContextSample(0, null);
      executionContextTargets = Array.from(
        { length: profile.executionContextSamples },
        (_, index) =>
          firstSample.startedElapsedSeconds +
          (index / (profile.executionContextSamples - 1)) *
            profile.durationSeconds,
      );
      nextExecutionContextSample = 1;
    }
    for (let index = 0; index < profile.cycles; index += 1) {
      const cycleTargetElapsedSeconds =
        profile.cycles <= 1
          ? 0
          : (index / (profile.cycles - 1)) * profile.durationSeconds;
      while (
        nextExecutionContextSample < executionContextTargets.length &&
        executionContextTargets[nextExecutionContextSample] <=
          cycleTargetElapsedSeconds
      ) {
        const target = executionContextTargets[nextExecutionContextSample];
        await waitForDelay(
          Math.max(0, target * 1_000 - (monotonicNow() - started)),
          profile.checkpointIntervalSeconds * 1_000,
          checkpoint,
        );
        await runExecutionContextSample(nextExecutionContextSample, target);
        nextExecutionContextSample += 1;
      }
      const delayMs = securitySoakCycleDelayMs(
        index,
        profile.cycles,
        profile.durationSeconds * 1_000,
        monotonicNow() - started,
      );
      if (delayMs > 0) {
        await waitForDelay(
          delayMs,
          profile.checkpointIntervalSeconds * 1_000,
          checkpoint,
        );
      }
      const cycleStarted = monotonicNow();
      let evidence;
      try {
        evidence = await executeSecurityMatrix({
          releaseCommit: headSha,
          runs: 1,
        });
        validateInnerEvidence(evidence, {
          releaseCommit: headSha,
          operatingSystem: report.runner.operatingSystem,
        });
      } catch (error) {
        failedCycleEvidence = error?.evidence || null;
        throw Object.assign(
          new Error(
            `MCP security soak cycle ${index} failed: ${error.message}`,
          ),
          { cause: error },
        );
      }
      report.cycles.push({
        index,
        durationMs: monotonicNow() - cycleStarted,
        evidence,
      });
      report.totals = expectedTotals(
        report.cycles.length,
        report.runner.operatingSystem,
      );
      rssMaximumBytes = Math.max(rssMaximumBytes, process.memoryUsage().rss);
      checkpoint();
    }
    while (nextExecutionContextSample < executionContextTargets.length) {
      const target = executionContextTargets[nextExecutionContextSample];
      await waitForDelay(
        Math.max(0, target * 1_000 - (monotonicNow() - started)),
        profile.checkpointIntervalSeconds * 1_000,
        checkpoint,
      );
      await runExecutionContextSample(nextExecutionContextSample, target);
      nextExecutionContextSample += 1;
    }
    if (profile.mode === "formal") {
      report.executionContextBoundary = buildMcpExecutionContextSoakEvidence({
        operatingSystem: report.runner.operatingSystem,
        releaseCommit: headSha,
        durationSeconds: profile.durationSeconds,
        samples: executionContextSamples,
      });
      checkpoint();
    }
    const finalHeadSha = getHead();
    const finalWorktreeChanges = getChanges();
    report.source.finalClean = finalWorktreeChanges.length === 0;
    report.source.finalChangeCount = finalWorktreeChanges.length;
    report.exactShaVerified =
      report.exactShaVerified &&
      finalHeadSha === headSha &&
      finalWorktreeChanges.length === 0;
    if (finalHeadSha !== headSha || finalWorktreeChanges.length > 0) {
      throw new Error(
        `exact SHA source changed during soak: head=${finalHeadSha}, changes=${finalWorktreeChanges.length}`,
      );
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.violations.push(safeError(error));
    if (failedCycleEvidence) report.failedCycleEvidence = failedCycleEvidence;
  } finally {
    report.finishedAt = wallNowIso();
    report.continuousDurationSeconds = (monotonicNow() - started) / 1_000;
    report.rss.afterBytes = process.memoryUsage().rss;
    rssMaximumBytes = Math.max(rssMaximumBytes, report.rss.afterBytes);
    report.rss.maximumBytes = rssMaximumBytes;
    report.rss.growthBytes = report.rss.afterBytes - report.rss.beforeBytes;
    report.rss.peakGrowthBytes = rssMaximumBytes - report.rss.beforeBytes;
    atomicWriteJson(output, report);
  }
  if (report.status !== "passed") {
    throw Object.assign(
      new Error(report.violations[0]?.message || "MCP security soak failed"),
      {
        evidence: report,
      },
    );
  }
  return report;
}

export function verifyMcpSecuritySoakEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  if (!options.evidenceDir) {
    throw new Error("MCP security soak evidence directory is required");
  }
  const evidenceDir = path.resolve(options.evidenceDir);
  const jsonNames = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (jsonNames.length !== expectedOperatingSystems.length) {
    throw new Error(
      `MCP security soak evidence must contain exactly three JSON files; found ${jsonNames.length}`,
    );
  }
  const recognizedSchemas = new Set([formalResultSchema, smokeResultSchema]);
  const entries = jsonNames
    .map((name) => ({ name, value: readJson(path.join(evidenceDir, name)) }))
    .map((entry) => {
      if (!recognizedSchemas.has(entry.value?.schema)) {
        throw new Error(
          `MCP security soak evidence ${entry.name} has an unrecognized schema`,
        );
      }
      return entry;
    });
  const actualOperatingSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  if (
    JSON.stringify(actualOperatingSystems) !==
    JSON.stringify(expectedOperatingSystems)
  ) {
    throw new Error(
      `MCP security soak evidence must contain exactly linux, macos, windows; found ${actualOperatingSystems.join(", ")}`,
    );
  }
  const modes = [
    ...new Set(entries.map((entry) => entry.value?.profile?.mode)),
  ];
  if (modes.length !== 1 || !new Set(["formal", "smoke"]).has(modes[0])) {
    throw new Error(
      `MCP security soak evidence mixes or omits profile modes: ${modes.join(", ")}`,
    );
  }
  const mode = modes[0];
  const allowSmoke = options.allowSmoke === true;
  if (mode === "smoke" && !allowSmoke) {
    throw new Error(
      "MCP security aggregate requires formal evidence; pass --allow-smoke only for a non-qualifying PR aggregate",
    );
  }
  for (const entry of entries) {
    validateSoakEvidence(entry.value, { releaseCommit, allowSmoke });
  }
  const firstProfile = JSON.stringify(entries[0].value.profile);
  if (
    entries.some(
      (entry) => JSON.stringify(entry.value.profile) !== firstProfile,
    )
  ) {
    throw new Error(
      "MCP security soak profiles differ across operating systems",
    );
  }
  const profile = entries[0].value.profile;
  let executionContextEvidence;
  if (mode === "formal") {
    if (!options.executionContextEvidenceDir) {
      throw new Error(
        "formal MCP security aggregate requires the raw execution-context evidence directory",
      );
    }
    const rawDirectory = path.resolve(options.executionContextEvidenceDir);
    const rawDirectoryStat = fs.lstatSync(rawDirectory);
    if (rawDirectoryStat.isSymbolicLink() || !rawDirectoryStat.isDirectory()) {
      throw new Error(
        "execution-context evidence directory must be a non-symlink directory",
      );
    }
    const rawNames = fs.readdirSync(rawDirectory).sort();
    const expectedRawNames = expectedOperatingSystems
      .flatMap((operatingSystem) =>
        Array.from({ length: profile.executionContextSamples }, (_, index) =>
          executionContextReportFile(operatingSystem, index),
        ),
      )
      .sort();
    if (JSON.stringify(rawNames) !== JSON.stringify(expectedRawNames)) {
      throw new Error(
        `execution-context evidence must contain exactly ${expectedRawNames.join(", ")}; found ${rawNames.join(", ")}`,
      );
    }
    const entriesByOperatingSystem = new Map(
      entries.map((entry) => [entry.value.runner.operatingSystem, entry]),
    );
    executionContextEvidence = expectedOperatingSystems.map(
      (operatingSystem) => {
        const platformBoundary =
          entriesByOperatingSystem.get(operatingSystem)?.value
            ?.executionContextBoundary;
        const parsedSamples = platformBoundary.samples.map((sample, index) =>
          parseMcpExecutionContextVitestEvidence({
            filePath: path.join(rawDirectory, sample.rawReportFile),
            operatingSystem,
            releaseCommit,
            sampleIndex: index,
            scheduledElapsedSeconds: sample.scheduledElapsedSeconds,
            startedAt: sample.startedAt,
            finishedAt: sample.finishedAt,
            startedElapsedSeconds: sample.startedElapsedSeconds,
            finishedElapsedSeconds: sample.finishedElapsedSeconds,
          }),
        );
        if (
          JSON.stringify(parsedSamples) !==
          JSON.stringify(platformBoundary.samples)
        ) {
          throw new Error(
            `${operatingSystem} execution-context raw reports do not match their platform soak evidence`,
          );
        }
        return {
          operatingSystem,
          releaseCommit,
          sampleCount: parsedSamples.length,
          minimumStartSpanSeconds: platformBoundary.minimumStartSpanSeconds,
          observedStartSpanSeconds: platformBoundary.observedStartSpanSeconds,
          maximumObservedSchedulingLatenessSeconds:
            platformBoundary.maximumObservedSchedulingLatenessSeconds,
          samples: parsedSamples.map((sample) => ({
            releaseCommit: sample.releaseCommit,
            operatingSystem: sample.operatingSystem,
            sampleIndex: sample.sampleIndex,
            scheduledElapsedSeconds: sample.scheduledElapsedSeconds,
            startedAt: sample.startedAt,
            finishedAt: sample.finishedAt,
            startedElapsedSeconds: sample.startedElapsedSeconds,
            finishedElapsedSeconds: sample.finishedElapsedSeconds,
            schedulingLatenessSeconds: sample.schedulingLatenessSeconds,
            freshIsolate: sample.freshIsolate,
            invocation: sample.invocation,
            rawReportFile: sample.rawReportFile,
            rawReportSha256: sample.rawReportSha256,
            testSourceSha256: sample.testSource.sha256,
            reporter: sample.reporter,
            requiredAssertions: sample.requiredAssertions,
          })),
        };
      },
    );
  } else {
    if (options.executionContextEvidenceDir) {
      throw new Error(
        "non-qualifying smoke aggregate cannot consume formal execution-context evidence",
      );
    }
    executionContextEvidence = [];
  }
  const formal = mode === "formal";
  const aggregate = {
    schema: formal ? formalAggregateSchema : smokeAggregateSchema,
    releaseCommit,
    result: formal ? "passed" : "non_qualifying_smoke_passed",
    qualifyingEvidence: formal,
    releaseGateEligible: formal,
    verifiedAt: new Date().toISOString(),
    operatingSystems: [...expectedOperatingSystems],
    profile,
    executionContextBoundary: {
      schema: executionContextBoundarySchema,
      scope: formal
        ? "fresh-isolate-live-samples-spanning-formal-soak-on-each-platform"
        : "pr-smoke-without-live-execution-context-sample",
      sampleCount: formal
        ? expectedOperatingSystems.length * profile.executionContextSamples
        : 0,
      samplesPerOperatingSystem: formal ? profile.executionContextSamples : 0,
      minimumSamplesPerOperatingSystem: minimumFormalExecutionContextSamples,
      minimumStartSpanSeconds: formal ? profile.durationSeconds : 0,
      minimumObservedStartSpanSeconds: formal
        ? Math.min(
            ...executionContextEvidence.map(
              (entry) => entry.observedStartSpanSeconds,
            ),
          )
        : 0,
      longRunning: formal,
      freshIsolatePerSample: formal,
      qualifyingForSingleLiveSample: formal,
      qualifyingForLongRunningMatrix: formal,
      completeSkillMcpSecurityClosure: false,
      operatingSystems: formal ? [...expectedOperatingSystems] : [],
      evidence: executionContextEvidence,
    },
    hostCycles: entries.reduce(
      (total, entry) => total + entry.value.totals.hostCycles,
      0,
    ),
    unapprovedEffectSamples: entries.reduce(
      (total, entry) => total + entry.value.totals.unapprovedEffectSamples,
      0,
    ),
    unapprovedTransportCalls: 0,
    unapprovedMutations: 0,
    unapprovedLedgerWrites: 0,
    approvedMutationProbes: entries.reduce(
      (total, entry) => total + entry.value.totals.approvedMutationProbes,
      0,
    ),
    staleHostReadPolicySamples: entries.reduce(
      (total, entry) => total + entry.value.totals.staleHostReadPolicySamples,
      0,
    ),
    codeSnapshotRaceOperatingSystems: ["linux"],
    codeSnapshotRaceSamples: entries.reduce(
      (total, entry) => total + entry.value.totals.codeSnapshotRaceSamples,
      0,
    ),
    codeSnapshotFailClosedOperatingSystems: ["macos"],
    codeSnapshotFailClosedProbes: entries.reduce(
      (total, entry) => total + entry.value.totals.codeSnapshotFailClosedProbes,
      0,
    ),
    atomicPathReplacementEscapes: 0,
    evidence: entries.map((entry) => ({
      file: entry.name,
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(path.join(evidenceDir, entry.name)),
    })),
  };
  if (options.output) atomicWriteJson(options.output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--release-commit") {
      options.releaseCommit = argv[++index];
    } else if (argument === "--output") {
      options.output = argv[++index];
    } else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else if (argument === "--execution-context-evidence-dir") {
      options.executionContextEvidenceDir = argv[++index];
    } else if (argument === "--execution-context-dir") {
      options.executionContextDirectory = argv[++index];
    } else if (argument === "--allow-smoke") {
      options.allowSmoke = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.evidenceDir) {
      const aggregate = verifyMcpSecuritySoakEvidenceSet(options);
      process.stdout.write(
        `verified MCP security ${aggregate.profile.mode} ${aggregate.releaseCommit}: ${aggregate.hostCycles} host cycles, ${aggregate.executionContextBoundary.sampleCount} fresh-isolate live execution-context samples across at least ${aggregate.executionContextBoundary.minimumObservedStartSpanSeconds.toFixed(3)} seconds per formal platform, ${aggregate.unapprovedEffectSamples} unapproved effects, ${aggregate.codeSnapshotRaceSamples} Linux races, ${aggregate.codeSnapshotFailClosedProbes} macOS fail-closed probes, zero escapes; ${aggregate.releaseGateEligible ? "release-gate eligible for this defined scope" : "non-qualifying smoke only"}\n`,
      );
    } else {
      const evidence = await runMcpSecuritySoak(options);
      process.stdout.write(
        `MCP security soak passed on ${evidence.runner.operatingSystem}: ${evidence.cycles.length} host cycles over ${evidence.continuousDurationSeconds.toFixed(3)} seconds\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
