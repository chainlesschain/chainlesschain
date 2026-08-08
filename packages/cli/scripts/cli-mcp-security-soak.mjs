#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runMcpSecurityMatrix } from "./ide-roadmap-mcp-security-gate.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const resultSchema = "chainlesschain.cli-mcp-security-soak.v1";
const aggregateSchema = "chainlesschain.cli-mcp-security-soak-aggregate.v1";
const innerEvidenceSchema =
  "chainlesschain.ide-roadmap-mcp-security-evidence.v4";
const releaseCommitPattern = /^[0-9a-f]{40}$/u;
const expectedOperatingSystems = Object.freeze(["linux", "macos", "windows"]);

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

function validateSoakEvidence(value, { releaseCommit }) {
  const issues = [];
  const operatingSystem = value?.runner?.operatingSystem;
  const profile = value?.profile;
  if (value?.schema !== resultSchema) issues.push("schema");
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
    !new Set(["smoke", "formal"]).has(profile?.mode) ||
    !Number.isInteger(profile?.cycles) ||
    profile.cycles < (profile?.mode === "formal" ? 100 : 1) ||
    !Number.isFinite(profile?.durationSeconds) ||
    profile.durationSeconds < (profile?.mode === "formal" ? 7_200 : 1)
  ) {
    issues.push("profile floors");
  }
  if (
    !Number.isFinite(value?.continuousDurationSeconds) ||
    value.continuousDurationSeconds < profile?.durationSeconds
  ) {
    issues.push("continuous duration");
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
  if (value?.violations?.length !== 0) issues.push("violations");
  if (issues.length > 0) {
    throw new Error(`invalid MCP security soak evidence: ${issues.join(", ")}`);
  }
  return value;
}

export async function runMcpSecuritySoak(options = {}) {
  const env = options.env || process.env;
  const profile = options.profile || resolveMcpSecuritySoakProfile(env);
  const headSha = gitHead();
  const worktreeChanges = gitWorktreeChanges();
  const expectedShaCandidate =
    options.releaseCommit || env.CC_CLI_MCP_SECURITY_SOAK_EXPECTED_SHA || "";
  const expectedSha = expectedShaCandidate
    ? normalizeReleaseCommit(expectedShaCandidate)
    : null;
  const output =
    options.output ||
    env.CC_CLI_MCP_SECURITY_SOAK_OUTPUT ||
    path.join(os.tmpdir(), `cli-mcp-security-soak-${process.platform}.json`);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let rssMaximumBytes = process.memoryUsage().rss;
  let failedCycleEvidence = null;
  const report = {
    schema: resultSchema,
    status: "running",
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
      operatingSystem: normalizeOperatingSystem(),
      architecture: process.arch,
      nodeVersion: process.version,
    },
    profile,
    cycles: [],
    totals: expectedTotals(0, normalizeOperatingSystem()),
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
    report.checkpointedAt = new Date().toISOString();
    report.continuousDurationSeconds = (performance.now() - started) / 1_000;
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
    for (let index = 0; index < profile.cycles; index += 1) {
      const delayMs = securitySoakCycleDelayMs(
        index,
        profile.cycles,
        profile.durationSeconds * 1_000,
        performance.now() - started,
      );
      if (delayMs > 0) {
        await waitWithCheckpoints(
          delayMs,
          profile.checkpointIntervalSeconds * 1_000,
          checkpoint,
        );
      }
      const cycleStarted = performance.now();
      let evidence;
      try {
        evidence = await runMcpSecurityMatrix({
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
        durationMs: performance.now() - cycleStarted,
        evidence,
      });
      report.totals = expectedTotals(
        report.cycles.length,
        report.runner.operatingSystem,
      );
      rssMaximumBytes = Math.max(rssMaximumBytes, process.memoryUsage().rss);
      checkpoint();
    }
    const finalHeadSha = gitHead();
    const finalWorktreeChanges = gitWorktreeChanges();
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
    report.finishedAt = new Date().toISOString();
    report.continuousDurationSeconds = (performance.now() - started) / 1_000;
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
  const evidenceDir = path.resolve(options.evidenceDir || "");
  const entries = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: readJson(path.join(evidenceDir, name)) }))
    .filter((entry) => entry.value?.schema === resultSchema);
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
  for (const entry of entries) {
    validateSoakEvidence(entry.value, { releaseCommit });
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
  const aggregate = {
    schema: aggregateSchema,
    releaseCommit,
    result: "passed",
    verifiedAt: new Date().toISOString(),
    operatingSystems: [...expectedOperatingSystems],
    profile,
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
        `verified MCP security soak ${aggregate.releaseCommit}: ${aggregate.hostCycles} host cycles, ${aggregate.unapprovedEffectSamples} unapproved effects, ${aggregate.codeSnapshotRaceSamples} Linux races, ${aggregate.codeSnapshotFailClosedProbes} macOS fail-closed probes, zero escapes\n`,
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
