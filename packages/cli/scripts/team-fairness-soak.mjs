#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AGING_WINDOW_MS,
  DEFAULT_QUEUE_WAIT_SLO_MS,
  TaskLeaseRegistry,
} from "../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../src/lib/agent-team/team-runner.js";
import { TeamScopeLock } from "../src/lib/agent-team/team-scope-lock.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const EXPECTED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const PRODUCER_KEY = "00-stream-producer";
const PRODUCER_TAIL_KEY = "01-stream-finished";
const DEPENDENCY_LOW_KEY = "10-dependency-low";
const DEPENDENT_HIGH_KEY = "11-dependent-high";
const SCOPE_HOLDER_KEY = "20-scope-holder";
const SCOPE_WAITER_KEY = "21-scope-waiter-high";
const INDEPENDENT_LOW_KEY = "30-independent-low";
const REQUIRED_INVARIANTS = Object.freeze([
  "durationAtLeastThreeSlo",
  "dependencyPriorityDonated",
  "dependencyServedWithinSlo",
  "scopePriorityDonated",
  "scopeWaiterServedWithinSlo",
  "nonConflictingLowAged",
  "nonConflictingLowServedWithinSlo",
  "sustainedHighPriorityService",
  "everyHighTaskSettled",
  "scopeOwnershipReleased",
]);

export const RESULT_SCHEMA = "chainlesschain.team-fairness-soak/v1";
export const AGGREGATE_SCHEMA =
  "chainlesschain.team-fairness-soak-aggregate/v1";
export const FORMAL_QUEUE_WAIT_SLO_MS = DEFAULT_QUEUE_WAIT_SLO_MS;
export const FORMAL_DURATION_MS = FORMAL_QUEUE_WAIT_SLO_MS * 3;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

function evidenceDigest(value) {
  const copy = { ...value };
  delete copy.evidenceDigest;
  return digestValue(copy);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeFullSha(value, label = "release commit") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase full 40-character SHA`);
  }
  return normalized;
}

function normalizeOperatingSystem(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  return String(platform || "unknown").toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceIdentity() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  const changes = git("status", "--porcelain=v1", "--untracked-files=all")
    .split(/\r?\n/u)
    .filter(Boolean);
  return {
    headSha: git("rev-parse", "HEAD").toLowerCase(),
    changes,
  };
}

function runMetadata(env, expectedSha) {
  const githubActions =
    String(env.GITHUB_ACTIONS || "").toLowerCase() === "true";
  const runId = String(env.GITHUB_RUN_ID || "local");
  const runAttempt = positiveInteger(env.GITHUB_RUN_ATTEMPT, 1, "run attempt");
  const repository = String(env.GITHUB_REPOSITORY || "local");
  const workflow = String(env.GITHUB_WORKFLOW || "local");
  const eventName = String(env.GITHUB_EVENT_NAME || "local");
  const serverUrl = String(env.GITHUB_SERVER_URL || "").replace(/\/$/u, "");
  const controlPlaneSha = normalizeFullSha(
    env.CC_TEAM_FAIRNESS_WORKFLOW_SHA || expectedSha,
    "workflow commit",
  );
  return {
    provider: githubActions ? "github-actions" : "local",
    repository,
    workflow,
    eventName,
    runId,
    runAttempt,
    controlPlaneSha,
    runUrl:
      githubActions && serverUrl
        ? `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
        : null,
  };
}

export function resolveTeamFairnessProfile(env = process.env) {
  const mode = String(env.CC_TEAM_FAIRNESS_MODE || "smoke").toLowerCase();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new TypeError("CC_TEAM_FAIRNESS_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const queueWaitSloMs = formal
    ? Math.max(
        FORMAL_QUEUE_WAIT_SLO_MS,
        positiveInteger(
          env.CC_TEAM_FAIRNESS_QUEUE_WAIT_SLO_MS,
          FORMAL_QUEUE_WAIT_SLO_MS,
          "queue-wait SLO",
        ),
      )
    : positiveInteger(
        env.CC_TEAM_FAIRNESS_QUEUE_WAIT_SLO_MS,
        400,
        "queue-wait SLO",
      );
  const durationMs = Math.max(
    queueWaitSloMs * 3,
    positiveInteger(
      env.CC_TEAM_FAIRNESS_DURATION_MS,
      formal ? FORMAL_DURATION_MS : 1_200,
      "fairness duration",
    ),
  );
  const agingWindowMs = formal
    ? Math.min(
        Math.floor(queueWaitSloMs / 4),
        positiveInteger(
          env.CC_TEAM_FAIRNESS_AGING_WINDOW_MS,
          DEFAULT_AGING_WINDOW_MS,
          "aging window",
        ),
      )
    : positiveInteger(
        env.CC_TEAM_FAIRNESS_AGING_WINDOW_MS,
        Math.max(1, Math.floor(queueWaitSloMs / 4)),
        "aging window",
      );
  const producerIntervalMs = positiveInteger(
    env.CC_TEAM_FAIRNESS_PRODUCER_INTERVAL_MS,
    formal ? 50 : 20,
    "producer interval",
  );
  const highTaskDelayMs = positiveInteger(
    env.CC_TEAM_FAIRNESS_HIGH_TASK_DELAY_MS,
    formal ? 25 : 10,
    "high task delay",
  );
  const highTasksPerTick = positiveInteger(
    env.CC_TEAM_FAIRNESS_HIGH_TASKS_PER_TICK,
    2,
    "high tasks per tick",
  );
  const initialHighTasks = positiveInteger(
    env.CC_TEAM_FAIRNESS_INITIAL_HIGH_TASKS,
    20,
    "initial high tasks",
  );
  const scopeHoldMs = Math.min(
    queueWaitSloMs - Math.max(1, producerIntervalMs),
    positiveInteger(
      env.CC_TEAM_FAIRNESS_SCOPE_HOLD_MS,
      Math.floor(queueWaitSloMs * 0.8),
      "scope hold",
    ),
  );
  if (scopeHoldMs <= 0 || agingWindowMs >= queueWaitSloMs) {
    throw new TypeError("fairness profile cannot satisfy its queue-wait SLO");
  }
  return Object.freeze({
    mode,
    queueWaitSloMs,
    durationMs,
    agingWindowMs,
    producerIntervalMs,
    highTaskDelayMs,
    highTasksPerTick,
    initialHighTasks,
    scopeHoldMs,
    teammates: 3,
  });
}

function initialTasks(profile) {
  const tasks = [
    {
      key: PRODUCER_KEY,
      title: "Sustained high-priority task producer",
      priority: "high",
      metadata: { scopePaths: [".cc/fairness/producer"] },
    },
    {
      key: PRODUCER_TAIL_KEY,
      title: "Producer terminal successor",
      priority: "high",
      dependsOn: [PRODUCER_KEY],
      metadata: { scopePaths: [".cc/fairness/producer-tail"] },
    },
    {
      key: SCOPE_HOLDER_KEY,
      title: "Scope holder",
      priority: "high",
      metadata: { scopePaths: ["src"] },
    },
    {
      key: SCOPE_WAITER_KEY,
      title: "High-priority scope waiter",
      priority: "high",
      metadata: { scopePaths: ["src/agent/worker.js"] },
    },
    {
      key: DEPENDENCY_LOW_KEY,
      title: "Low-priority dependency",
      priority: "low",
      metadata: { scopePaths: [".cc/fairness/dependency"] },
    },
    {
      key: DEPENDENT_HIGH_KEY,
      title: "High-priority dependent",
      priority: "high",
      dependsOn: [DEPENDENCY_LOW_KEY],
      metadata: { scopePaths: [".cc/fairness/dependent"] },
    },
    {
      key: INDEPENDENT_LOW_KEY,
      title: "Low-priority non-conflicting successor",
      priority: "low",
      metadata: { scopePaths: ["docs"] },
    },
  ];
  for (let index = 0; index < profile.initialHighTasks; index += 1) {
    tasks.push(highTaskDefinition(`initial-${index}`));
  }
  return tasks;
}

function highTaskDefinition(identity) {
  return {
    key: `high-stream-${identity}`,
    title: `Sustained high-priority work ${identity}`,
    priority: "high",
    metadata: { scopePaths: [`.cc/fairness/stream/${identity}`] },
  };
}

function claimObservation(events, key) {
  const event = events.find(
    (candidate) => candidate.type === "task:claimed" && candidate.key === key,
  );
  return event
    ? {
        claimedAt: new Date(event.ts).toISOString(),
        queueWaitMs: event.schedulingPriority?.queueWaitMs ?? null,
        schedulingPriority: event.schedulingPriority || null,
      }
    : null;
}

function maximumGap(values) {
  let maximum = 0;
  for (let index = 1; index < values.length; index += 1) {
    maximum = Math.max(maximum, values[index] - values[index - 1]);
  }
  return maximum;
}

function safeError(error) {
  return {
    code: error?.code || "TEAM_FAIRNESS_SOAK_FAILED",
    message: String(error?.message || error).slice(0, 4096),
  };
}

function writeExclusiveJson(output, value) {
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function defaultOutputPath() {
  return path.join(
    os.tmpdir(),
    `cc-team-fairness-${process.pid}-${Date.now()}.json`,
  );
}

function assertOutputOutsideRepository(output) {
  const relative = path.relative(REPOSITORY_ROOT, path.resolve(output));
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new Error(
      "formal fairness evidence must be written outside the repository",
    );
  }
}

export async function runTeamFairnessSoak({
  env = process.env,
  sourceProvider = sourceIdentity,
  output = env.CC_TEAM_FAIRNESS_OUTPUT || defaultOutputPath(),
} = {}) {
  const profile = resolveTeamFairnessProfile(env);
  if (profile.mode === "formal") assertOutputOutsideRepository(output);
  const initialSource = await sourceProvider();
  const expectedSha = normalizeFullSha(
    env.CC_TEAM_FAIRNESS_EXPECTED_SHA || initialSource.headSha,
  );
  const startedAt = new Date().toISOString();
  const report = {
    schema: RESULT_SCHEMA,
    status: "running",
    releaseCommit: expectedSha,
    headSha: normalizeFullSha(initialSource.headSha, "HEAD commit"),
    expectedSha,
    exactShaVerified:
      normalizeFullSha(initialSource.headSha, "HEAD commit") === expectedSha,
    startedAt,
    completedAt: null,
    source: {
      clean: initialSource.changes.length === 0,
      changeCount: initialSource.changes.length,
      finalClean: false,
      finalChangeCount: null,
    },
    runner: {
      operatingSystem: normalizeOperatingSystem(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    execution: runMetadata(env, expectedSha),
    profile,
    continuousDurationMs: 0,
    workload: null,
    observations: null,
    invariants: null,
    summary: null,
    violations: [],
  };

  try {
    if (!report.exactShaVerified) {
      throw new Error(`HEAD ${report.headSha} does not match ${expectedSha}`);
    }
    if (profile.mode === "formal" && !report.source.clean) {
      throw new Error(
        "formal fairness soak requires a clean exact-SHA checkout",
      );
    }

    const registry = new TaskLeaseRegistry({
      now: Date.now,
      defaultTtlMs: Math.max(60_000, profile.durationMs * 3),
      maxAttempts: 1,
      queueWaitSloMs: profile.queueWaitSloMs,
      agingWindowMs: profile.agingWindowMs,
    });
    const inserted = registry.addTasks(initialTasks(profile));
    if (!inserted.ok)
      throw new Error(`could not seed fairness graph: ${inserted.reason}`);
    const scopeLock = new TeamScopeLock();
    const events = [];
    let producerStartedMonotonic = null;
    let producerCompletedMonotonic = null;
    let producerStartedAt = null;
    let producerCompletedAt = null;
    let producerTicks = 0;
    let dynamicHighTasks = 0;
    let runner;

    runner = new TeamRunner(registry, {
      teammates: profile.teammates,
      ttlMs: Math.max(60_000, profile.durationMs * 3),
      maxTasks:
        profile.initialHighTasks +
        Math.ceil(profile.durationMs / profile.producerIntervalMs) *
          profile.highTasksPerTick +
        100,
      scopeLock,
      now: Date.now,
      onEvent: (event) => {
        if (
          event.type === "task:claimed" ||
          (event.type === "task:priority-donated" &&
            event.waiterKey === SCOPE_WAITER_KEY)
        ) {
          events.push(clone(event));
        }
      },
      runTask: async ({ key }) => {
        if (key === PRODUCER_KEY) {
          producerStartedMonotonic = performance.now();
          producerStartedAt = new Date().toISOString();
          let sequence = 0;
          while (
            performance.now() - producerStartedMonotonic <
            profile.durationMs
          ) {
            await sleep(profile.producerIntervalMs);
            const batch = Array.from({ length: profile.highTasksPerTick }, () =>
              highTaskDefinition(`dynamic-${sequence++}`),
            );
            const added = registry.addTasks(batch);
            if (!added.ok) {
              throw new Error(
                `could not append high-priority work: ${added.reason}`,
              );
            }
            producerTicks += 1;
            dynamicHighTasks += batch.length;
            runner.notifyWorkAvailable();
          }
          producerCompletedMonotonic = performance.now();
          producerCompletedAt = new Date().toISOString();
          return { producerTicks, dynamicHighTasks };
        }
        if (key === SCOPE_HOLDER_KEY) await sleep(profile.scopeHoldMs);
        else if (key.startsWith("high-stream-")) {
          await sleep(profile.highTaskDelayMs);
        } else {
          await sleep(1);
        }
        return { key };
      },
    });

    const summary = await runner.run();
    report.continuousDurationMs =
      producerCompletedMonotonic - producerStartedMonotonic;
    const dependency = claimObservation(events, DEPENDENCY_LOW_KEY);
    const scopeHolder = claimObservation(events, SCOPE_HOLDER_KEY);
    const scopeWaiter = claimObservation(events, SCOPE_WAITER_KEY);
    const independent = claimObservation(events, INDEPENDENT_LOW_KEY);
    const scopeDonations = events.filter(
      (event) =>
        event.type === "task:priority-donated" &&
        event.waiterKey === SCOPE_WAITER_KEY,
    );
    const highClaims = events
      .filter(
        (event) =>
          event.type === "task:claimed" && event.key.startsWith("high-stream-"),
      )
      .map((event) => event.ts)
      .sort((left, right) => left - right);
    const producerStartMs = Date.parse(producerStartedAt);
    const producerCompletedMs = Date.parse(producerCompletedAt);
    const continuousClaims = highClaims.filter(
      (timestamp) =>
        timestamp >= producerStartMs && timestamp <= producerCompletedMs,
    );
    const maxHighServiceGapMs = maximumGap(continuousClaims);
    const highServiceSpanMs =
      continuousClaims.length > 1
        ? continuousClaims.at(-1) - continuousClaims[0]
        : 0;
    const highTasksAdded = profile.initialHighTasks + dynamicHighTasks;
    const highTasksCompleted = registry
      .list()
      .filter(
        (task) =>
          task.key.startsWith("high-stream-") && task.status === "completed",
      ).length;

    report.workload = {
      producerStartedAt,
      producerCompletedAt,
      producerTicks,
      initialHighTasks: profile.initialHighTasks,
      dynamicHighTasks,
      highTasksAdded,
      highTasksCompleted,
      highClaimsDuringProducer: continuousClaims.length,
      highServiceSpanMs,
      maxHighServiceGapMs,
    };
    report.observations = {
      dependencyLow: dependency,
      scopeHolder,
      scopeWaiter,
      independentLow: independent,
      scopeDonationCount: scopeDonations.length,
      firstScopeDonation: scopeDonations[0] || null,
    };
    const gapLimitMs = Math.max(500, profile.producerIntervalMs * 10);
    report.invariants = {
      durationAtLeastThreeSlo:
        profile.durationMs >= profile.queueWaitSloMs * 3 &&
        report.continuousDurationMs >= profile.durationMs,
      dependencyPriorityDonated:
        dependency?.schedulingPriority?.donation > 0 &&
        dependency?.schedulingPriority?.criticalPathBoost > 0,
      dependencyServedWithinSlo:
        dependency?.queueWaitMs >= 0 &&
        dependency.queueWaitMs <= profile.queueWaitSloMs,
      scopePriorityDonated:
        scopeDonations.length > 0 &&
        scopeDonations.some(
          (event) =>
            event.holderKey === SCOPE_HOLDER_KEY &&
            event.waiterPriority?.base === 2,
        ),
      scopeWaiterServedWithinSlo:
        scopeWaiter?.queueWaitMs >= profile.scopeHoldMs &&
        scopeWaiter.queueWaitMs <= profile.queueWaitSloMs,
      nonConflictingLowAged:
        independent?.schedulingPriority?.sloUrgent === true &&
        independent?.schedulingPriority?.aging > 0,
      nonConflictingLowServedWithinSlo:
        independent?.queueWaitMs >= 0 &&
        independent.queueWaitMs <= profile.queueWaitSloMs,
      sustainedHighPriorityService:
        continuousClaims.length > 0 &&
        highServiceSpanMs >= profile.durationMs - gapLimitMs &&
        maxHighServiceGapMs <= gapLimitMs,
      everyHighTaskSettled:
        highTasksCompleted === highTasksAdded && registry.allDone(),
      scopeOwnershipReleased: scopeLock.status().count === 0,
    };
    report.summary = summary;
    if (!Object.values(report.invariants).every(Boolean)) {
      throw new Error(
        `fairness invariants failed: ${Object.entries(report.invariants)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(", ")}`,
      );
    }

    const finalSource = await sourceProvider();
    report.headSha = normalizeFullSha(finalSource.headSha, "final HEAD commit");
    report.source.finalClean = finalSource.changes.length === 0;
    report.source.finalChangeCount = finalSource.changes.length;
    report.exactShaVerified = report.headSha === expectedSha;
    if (
      !report.exactShaVerified ||
      (profile.mode === "formal" && !report.source.finalClean)
    ) {
      throw new Error("fairness soak source identity changed during execution");
    }
    report.status = "passed";
    report.completedAt = new Date().toISOString();
    report.evidenceDigest = evidenceDigest(report);
    validateTeamFairnessEvidence(report, {
      releaseCommit: expectedSha,
      mode: profile.mode,
    });
    writeExclusiveJson(path.resolve(output), report);
    return report;
  } catch (error) {
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    report.violations.push(safeError(error));
    report.evidenceDigest = evidenceDigest(report);
    try {
      writeExclusiveJson(path.resolve(output), report);
    } catch (writeError) {
      error.evidenceWriteError = safeError(writeError);
    }
    error.evidence = report;
    throw error;
  }
}

function profileValid(profile, mode) {
  if (!profile || profile.mode !== mode) return false;
  const formal = mode === "formal";
  return (
    Number.isSafeInteger(profile.queueWaitSloMs) &&
    profile.queueWaitSloMs >= (formal ? FORMAL_QUEUE_WAIT_SLO_MS : 1) &&
    Number.isSafeInteger(profile.durationMs) &&
    profile.durationMs >= profile.queueWaitSloMs * 3 &&
    Number.isSafeInteger(profile.agingWindowMs) &&
    profile.agingWindowMs > 0 &&
    profile.agingWindowMs < profile.queueWaitSloMs &&
    Number.isSafeInteger(profile.producerIntervalMs) &&
    profile.producerIntervalMs > 0 &&
    Number.isSafeInteger(profile.highTaskDelayMs) &&
    profile.highTaskDelayMs > 0 &&
    Number.isSafeInteger(profile.highTasksPerTick) &&
    profile.highTasksPerTick > 0 &&
    Number.isSafeInteger(profile.initialHighTasks) &&
    profile.initialHighTasks > 0 &&
    Number.isSafeInteger(profile.scopeHoldMs) &&
    profile.scopeHoldMs > 0 &&
    profile.scopeHoldMs < profile.queueWaitSloMs &&
    profile.teammates === 3
  );
}

export function validateTeamFairnessEvidence(value, options = {}) {
  const releaseCommit = normalizeFullSha(
    options.releaseCommit || value?.releaseCommit,
  );
  const mode = String(options.mode || value?.profile?.mode || "formal");
  const issues = [];
  if (value?.schema !== RESULT_SCHEMA) issues.push("schema");
  if (value?.status !== "passed") issues.push("status");
  if (
    value?.releaseCommit !== releaseCommit ||
    value?.headSha !== releaseCommit ||
    value?.expectedSha !== releaseCommit ||
    value?.exactShaVerified !== true
  ) {
    issues.push("exact SHA");
  }
  if (!EXPECTED_OPERATING_SYSTEMS.includes(value?.runner?.operatingSystem)) {
    issues.push("operating system");
  }
  if (!profileValid(value?.profile, mode)) issues.push("profile");
  if (
    !Number.isFinite(value?.continuousDurationMs) ||
    value.continuousDurationMs < value?.profile?.durationMs
  ) {
    issues.push("continuous duration");
  }
  const startedAt = Date.parse(value?.startedAt);
  const completedAt = Date.parse(value?.completedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt + value?.profile?.durationMs
  ) {
    issues.push("wall-clock duration");
  }
  if (
    mode === "formal" &&
    (value?.source?.clean !== true ||
      value?.source?.changeCount !== 0 ||
      value?.source?.finalClean !== true ||
      value?.source?.finalChangeCount !== 0)
  ) {
    issues.push("source cleanliness");
  }
  if (
    !value?.execution ||
    !FULL_SHA_PATTERN.test(value.execution.controlPlaneSha || "") ||
    value.execution.controlPlaneSha !== releaseCommit ||
    !Number.isSafeInteger(value.execution.runAttempt) ||
    value.execution.runAttempt <= 0
  ) {
    issues.push("execution identity");
  }
  if (
    mode === "formal" &&
    (value?.execution?.provider !== "github-actions" ||
      value?.execution?.eventName !== "workflow_dispatch")
  ) {
    issues.push("formal execution provider");
  }
  if (
    !value?.invariants ||
    REQUIRED_INVARIANTS.some(
      (invariant) => value.invariants[invariant] !== true,
    )
  ) {
    issues.push("invariants");
  }
  const slo = value?.profile?.queueWaitSloMs;
  const dependency = value?.observations?.dependencyLow;
  const scopeWaiter = value?.observations?.scopeWaiter;
  const independent = value?.observations?.independentLow;
  if (
    !Number.isFinite(dependency?.queueWaitMs) ||
    dependency.queueWaitMs < 0 ||
    dependency.queueWaitMs > slo ||
    dependency?.schedulingPriority?.donation <= 0 ||
    dependency?.schedulingPriority?.criticalPathBoost <= 0
  ) {
    issues.push("dependency observation");
  }
  if (
    !Number.isFinite(scopeWaiter?.queueWaitMs) ||
    scopeWaiter.queueWaitMs < value?.profile?.scopeHoldMs ||
    scopeWaiter.queueWaitMs > slo ||
    value?.observations?.scopeDonationCount <= 0 ||
    value?.observations?.firstScopeDonation?.holderKey !== SCOPE_HOLDER_KEY ||
    value?.observations?.firstScopeDonation?.waiterKey !== SCOPE_WAITER_KEY
  ) {
    issues.push("scope observation");
  }
  if (
    !Number.isFinite(independent?.queueWaitMs) ||
    independent.queueWaitMs < 0 ||
    independent.queueWaitMs > slo ||
    independent?.schedulingPriority?.sloUrgent !== true ||
    independent?.schedulingPriority?.aging <= 0
  ) {
    issues.push("aging observation");
  }
  const gapLimitMs = Math.max(500, value?.profile?.producerIntervalMs * 10);
  if (
    !Number.isSafeInteger(value?.workload?.highTasksAdded) ||
    value.workload.highTasksAdded <= 0 ||
    value.workload.highTasksCompleted !== value.workload.highTasksAdded ||
    value.workload.highClaimsDuringProducer <= 0 ||
    value.workload.highServiceSpanMs <
      value?.profile?.durationMs - gapLimitMs ||
    value.workload.maxHighServiceGapMs > gapLimitMs ||
    value?.summary?.done !== true
  ) {
    issues.push("sustained workload");
  }
  if (!Array.isArray(value?.violations) || value.violations.length !== 0) {
    issues.push("violations");
  }
  if (
    typeof value?.evidenceDigest !== "string" ||
    value.evidenceDigest !== evidenceDigest(value)
  ) {
    issues.push("evidence digest");
  }
  if (issues.length > 0) {
    throw new Error(`invalid Team fairness evidence: ${issues.join(", ")}`);
  }
  return value;
}

export function verifyTeamFairnessEvidenceSet(
  evidenceDirectory,
  { releaseCommit, mode = "formal", output = null } = {},
) {
  const expectedSha = normalizeFullSha(releaseCommit);
  const documents = fs
    .readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) =>
      JSON.parse(
        fs.readFileSync(path.join(evidenceDirectory, entry.name), "utf8"),
      ),
    );
  if (documents.length !== EXPECTED_OPERATING_SYSTEMS.length) {
    throw new Error("fairness aggregate requires exactly three evidence files");
  }
  for (const document of documents) {
    validateTeamFairnessEvidence(document, {
      releaseCommit: expectedSha,
      mode,
    });
  }
  const byOperatingSystem = new Map(
    documents.map((document) => [document.runner.operatingSystem, document]),
  );
  if (
    EXPECTED_OPERATING_SYSTEMS.some(
      (operatingSystem) => !byOperatingSystem.has(operatingSystem),
    )
  ) {
    throw new Error(
      "fairness aggregate is missing a required operating system",
    );
  }
  const identity = documents[0];
  if (
    documents.some(
      (document) =>
        JSON.stringify(document.profile) !== JSON.stringify(identity.profile) ||
        document.execution.runId !== identity.execution.runId ||
        document.execution.runAttempt !== identity.execution.runAttempt ||
        document.execution.controlPlaneSha !==
          identity.execution.controlPlaneSha,
    )
  ) {
    throw new Error("fairness evidence matrix does not share one identity");
  }
  const aggregate = {
    schema: AGGREGATE_SCHEMA,
    status: "passed",
    releaseCommit: expectedSha,
    profile: identity.profile,
    execution: identity.execution,
    operatingSystems: EXPECTED_OPERATING_SYSTEMS.map((operatingSystem) => ({
      operatingSystem,
      evidenceDigest: byOperatingSystem.get(operatingSystem).evidenceDigest,
      continuousDurationMs:
        byOperatingSystem.get(operatingSystem).continuousDurationMs,
      maxQueueWaitMs: Math.max(
        byOperatingSystem.get(operatingSystem).observations.dependencyLow
          .queueWaitMs,
        byOperatingSystem.get(operatingSystem).observations.scopeWaiter
          .queueWaitMs,
        byOperatingSystem.get(operatingSystem).observations.independentLow
          .queueWaitMs,
      ),
    })),
    verifiedAt: new Date().toISOString(),
  };
  aggregate.evidenceDigest = evidenceDigest(aggregate);
  if (output) writeExclusiveJson(path.resolve(output), aggregate);
  return aggregate;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length)
        throw new TypeError(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--verify-evidence-dir")
      options.evidenceDirectory = next();
    else if (argument === "--release-commit") options.releaseCommit = next();
    else if (argument === "--mode") options.mode = next();
    else if (argument === "--output") options.output = next();
    else throw new TypeError(`unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.evidenceDirectory) {
    const aggregate = verifyTeamFairnessEvidenceSet(options.evidenceDirectory, {
      releaseCommit: options.releaseCommit,
      mode: options.mode || "formal",
      output: options.output,
    });
    process.stdout.write(
      `Team fairness aggregate passed: ${aggregate.operatingSystems.length} platforms\n`,
    );
    return;
  }
  const report = await runTeamFairnessSoak({ output: options.output });
  process.stdout.write(
    `Team fairness soak passed: ${Math.round(report.continuousDurationMs)}ms, ${report.workload.highTasksCompleted} high-priority tasks\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
