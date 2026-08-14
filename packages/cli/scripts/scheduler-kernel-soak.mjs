#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { nextCronTime } from "../src/lib/agent-schedule-store.js";
import {
  coworkCronFireKey,
  latestCoworkCronTime,
  nextCoworkCronTime,
} from "../src/lib/cowork-cron.js";
import { openSchedulerStore } from "../src/lib/scheduler-kernel/store.js";
import {
  descendantPids,
  linearTailTrend,
  normalizeOperatingSystem,
  resourceCount,
  rssBytes,
  waitForProcessRetirement,
} from "./soak-host-metrics.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const WORKER_PATH = path.join(SCRIPT_DIR, "scheduler-kernel-soak-worker.mjs");
const EXPECTED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CAMPAIGN_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/u;
const RUN_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/u;
const MAX_WORKER_EVENTS = 25_000;
const MAX_WORKER_STDERR_BYTES = 256 * 1024;
const REQUIRED_INVARIANT_NAMES = Object.freeze([
  "twoWorkerContention",
  "beforeExecuteHigherFence",
  "staleSettlementRejected",
  "afterExecuteDeadLettered",
  "afterExecuteNoReplay",
  "heartbeatRenewed",
  "dstSemantics",
  "backlogDrained",
  "databaseQuickCheck",
  "allProcessesRetired",
]);

export const RESULT_SCHEMA = "chainlesschain.scheduler-kernel-soak.v1";
export const AGGREGATE_SCHEMA =
  "chainlesschain.scheduler-kernel-soak-aggregate.v1";

const JOBS = Object.freeze({
  steady: {
    id: "scheduler-soak-steady",
    kind: "scheduler.soak.steady",
    maxAttempts: 3,
  },
  crash: {
    id: "scheduler-soak-crash",
    kind: "scheduler.soak.crash",
    maxAttempts: 3,
  },
  outcome: {
    id: "scheduler-soak-outcome",
    kind: "scheduler.soak.outcome",
    maxAttempts: 1,
  },
  heartbeat: {
    id: "scheduler-soak-heartbeat",
    kind: "scheduler.soak.heartbeat",
    maxAttempts: 2,
  },
});

function positiveNumber(value, fallback, label, { integer = false } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new TypeError(
      `${label} must be a positive${integer ? " integer" : ""}`,
    );
  }
  return parsed;
}

function normalizeFullSha(value, label = "release commit") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a full 40-character SHA`);
  }
  return normalized;
}

function normalizeSeed(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new TypeError(
      "scheduler soak seed must be an unsigned 32-bit integer",
    );
  }
  return parsed;
}

function normalizeCampaign(value) {
  const campaign = String(value || "").trim();
  if (!CAMPAIGN_PATTERN.test(campaign)) {
    throw new TypeError(
      "scheduler soak campaign must use 1-128 letters, digits, '.', '_', ':', or '-'",
    );
  }
  return campaign;
}

function normalizeRunMetadata(value, env, { campaign, expectedSha }) {
  const githubActions =
    String(env.GITHUB_ACTIONS || "").toLowerCase() === "true";
  const runId = String(
    value?.runId ??
      env.CC_SCHEDULER_SOAK_RUN_ID ??
      env.GITHUB_RUN_ID ??
      `local:${campaign}`,
  ).trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new TypeError("scheduler soak run ID is invalid");
  }
  const runAttempt = positiveNumber(
    value?.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? 1,
    1,
    "scheduler soak run attempt",
    { integer: true },
  );
  const repository = String(
    value?.repository ?? env.GITHUB_REPOSITORY ?? "local",
  ).trim();
  const workflow = String(
    value?.workflow ?? env.GITHUB_WORKFLOW ?? "local",
  ).trim();
  const eventName = String(
    value?.eventName ?? env.GITHUB_EVENT_NAME ?? "local",
  ).trim();
  if (!repository || !workflow || !eventName) {
    throw new TypeError(
      "scheduler soak repository, workflow, and event name are required",
    );
  }
  const controlPlaneSha = normalizeFullSha(
    value?.controlPlaneSha ?? env.CC_SCHEDULER_SOAK_WORKFLOW_SHA ?? expectedSha,
    "scheduler soak workflow commit",
  );
  const serverUrl = String(env.GITHUB_SERVER_URL || "").replace(/\/$/u, "");
  return Object.freeze({
    provider: githubActions ? "github-actions" : value?.provider || "local",
    repository,
    workflow,
    eventName,
    runId,
    runAttempt,
    controlPlaneSha,
    runUrl:
      value?.runUrl ??
      (githubActions && serverUrl
        ? `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
        : null),
  });
}

function normalizeProfile(profile) {
  const mode = String(profile?.mode || "smoke").trim();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new TypeError("CC_SCHEDULER_SOAK_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const floor = (value, minimum) => (formal ? Math.max(value, minimum) : value);
  const durationSeconds = floor(
    positiveNumber(
      profile?.durationSeconds,
      formal ? 7_200 : 15,
      "scheduler soak duration seconds",
    ),
    formal ? 7_200 : 1,
  );
  const rounds = floor(
    positiveNumber(profile?.rounds, formal ? 100 : 2, "scheduler soak rounds", {
      integer: true,
    }),
    formal ? 100 : 1,
  );
  const steadyOccurrencesPerRound = floor(
    positiveNumber(
      profile?.steadyOccurrencesPerRound,
      formal ? 10 : 4,
      "steady occurrences per round",
      { integer: true },
    ),
    formal ? 10 : 2,
  );
  const leaseMs = positiveNumber(
    profile?.leaseMs,
    1_000,
    "scheduler soak lease milliseconds",
    { integer: true },
  );
  if (leaseMs < 1_000 || leaseMs > 60_000) {
    throw new TypeError("scheduler soak lease milliseconds must be 1000-60000");
  }
  const pollMs = positiveNumber(
    profile?.pollMs,
    formal ? 50 : 10,
    "scheduler soak poll milliseconds",
    { integer: true },
  );
  if (pollMs > 10_000) {
    throw new TypeError(
      "scheduler soak poll milliseconds must not exceed 10000",
    );
  }
  const requestedCheckpoint = positiveNumber(
    profile?.checkpointIntervalSeconds,
    formal ? 30 : 1,
    "scheduler soak checkpoint interval seconds",
    { integer: true },
  );
  const checkpointIntervalSeconds = Math.min(
    formal ? 60 : 2,
    requestedCheckpoint,
  );
  const cleanupDeadlineMs = Math.min(
    60_000,
    positiveNumber(
      profile?.cleanupDeadlineMs,
      10_000,
      "scheduler soak cleanup deadline milliseconds",
      { integer: true },
    ),
  );
  const maxRssGrowthMb = positiveNumber(
    profile?.maxRssGrowthMb,
    128,
    "scheduler soak maximum RSS growth MiB",
  );
  const maxResourceGrowth = positiveNumber(
    profile?.maxResourceGrowth,
    8,
    "scheduler soak maximum FD or handle growth",
    { integer: true },
  );
  const executionDelayMs = Math.min(
    5_000,
    positiveNumber(
      profile?.executionDelayMs,
      formal ? 50 : 25,
      "scheduler soak execution delay milliseconds",
      { integer: true },
    ),
  );
  const heartbeatDelayMs = Math.min(
    300_000,
    Math.max(
      leaseMs + Math.max(500, Math.ceil(leaseMs / 2)),
      positiveNumber(
        profile?.heartbeatDelayMs,
        leaseMs + Math.max(500, Math.ceil(leaseMs / 2)),
        "scheduler soak heartbeat delay milliseconds",
        { integer: true },
      ),
    ),
  );
  return Object.freeze({
    mode,
    durationSeconds,
    rounds,
    steadyOccurrencesPerRound,
    steadyStateOccurrences: rounds * steadyOccurrencesPerRound,
    leaseMs,
    pollMs,
    checkpointIntervalSeconds,
    cleanupDeadlineMs,
    maxRssGrowthMb,
    maxResourceGrowth,
    executionDelayMs,
    heartbeatDelayMs,
  });
}

export function resolveSchedulerSoakProfile(env = process.env) {
  return normalizeProfile({
    mode: env.CC_SCHEDULER_SOAK_MODE || "smoke",
    durationSeconds: env.CC_SCHEDULER_SOAK_DURATION_SECONDS,
    rounds: env.CC_SCHEDULER_SOAK_ROUNDS,
    steadyOccurrencesPerRound:
      env.CC_SCHEDULER_SOAK_STEADY_OCCURRENCES_PER_ROUND,
    leaseMs: env.CC_SCHEDULER_SOAK_LEASE_MS,
    pollMs: env.CC_SCHEDULER_SOAK_POLL_MS,
    checkpointIntervalSeconds:
      env.CC_SCHEDULER_SOAK_CHECKPOINT_INTERVAL_SECONDS,
    cleanupDeadlineMs: env.CC_SCHEDULER_SOAK_CLEANUP_DEADLINE_MS,
    maxRssGrowthMb: env.CC_SCHEDULER_SOAK_MAX_RSS_GROWTH_MB,
    maxResourceGrowth: env.CC_SCHEDULER_SOAK_MAX_RESOURCE_GROWTH,
    executionDelayMs: env.CC_SCHEDULER_SOAK_EXECUTION_DELAY_MS,
    heartbeatDelayMs: env.CC_SCHEDULER_SOAK_HEARTBEAT_DELAY_MS,
  });
}

export function schedulerSoakRoundDelayMs(
  roundIndex,
  totalRounds,
  durationMs,
  elapsedMs,
) {
  if (
    !Number.isFinite(roundIndex) ||
    !Number.isFinite(totalRounds) ||
    totalRounds <= 1 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(elapsedMs)
  ) {
    return 0;
  }
  const scheduledElapsed =
    (Math.max(0, roundIndex) / Math.max(1, totalRounds - 1)) * durationMs;
  return Math.max(0, scheduledElapsed - Math.max(0, elapsedMs));
}

function safeGitEnvironment() {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) {
    delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function captureSourceIdentity() {
  const options = {
    cwd: REPOSITORY_ROOT,
    env: safeGitEnvironment(),
    encoding: "utf8",
    windowsHide: true,
  };
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], options)
    .trim()
    .toLowerCase();
  const changes = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    options,
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  return { headSha, changes };
}

function safeError(error) {
  return {
    name: typeof error?.name === "string" ? error.name.slice(0, 128) : "Error",
    code: typeof error?.code === "string" ? error.code.slice(0, 128) : null,
    message:
      typeof error?.message === "string"
        ? error.message.slice(0, 4_000)
        : String(error).slice(0, 4_000),
    ...(typeof error?.stack === "string"
      ? { stack: error.stack.slice(0, 16_000) }
      : {}),
  };
}

function writeAll(descriptor, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      null,
    );
    if (!Number.isSafeInteger(written) || written <= 0) {
      throw new Error("scheduler soak evidence write made no progress");
    }
    offset += written;
  }
}

function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    writeAll(
      descriptor,
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    if (process.platform !== "win32") {
      let directoryDescriptor;
      try {
        directoryDescriptor = fs.openSync(directory, "r");
        fs.fsyncSync(directoryDescriptor);
      } finally {
        if (directoryDescriptor !== undefined)
          fs.closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function evaluateSchedulerTemporalVectors() {
  const timeZone = "America/New_York";
  const springFrom = Date.parse("2026-03-08T06:59:00Z");
  const springExpected = Date.parse("2026-03-09T06:30:00Z");
  const agendaSpring = nextCronTime("30 2 * * *", springFrom, { timeZone });
  const coworkSpring = nextCoworkCronTime("30 2 * * *", springFrom, {
    timeZone,
  });
  const fallFrom = Date.parse("2026-11-01T04:00:00Z");
  const fallFirstExpected = Date.parse("2026-11-01T05:30:00Z");
  const fallSecondExpected = Date.parse("2026-11-01T06:30:00Z");
  const fallFirst = nextCronTime("30 1 * * *", fallFrom, { timeZone });
  const fallSecond = nextCronTime("30 1 * * *", fallFirst, { timeZone });
  const coworkFallFirst = nextCoworkCronTime("30 1 * * *", fallFrom, {
    timeZone,
  });
  const coworkFallSecond = nextCoworkCronTime("30 1 * * *", coworkFallFirst, {
    timeZone,
  });
  const backlogFirst = Date.parse("2026-01-01T00:00:00Z");
  const backlogThrough = Date.parse("2026-08-12T12:34:56.789Z");
  const backlogExpected = Date.parse("2026-08-12T12:34:56Z");
  const backlogLatest = latestCoworkCronTime(
    "* * * * * *",
    backlogFirst,
    backlogThrough,
    { timeZone: "UTC" },
  );
  const fallSchedule = {
    id: "scheduler-soak-dst",
    cron: "30 1 * * *",
    timeZone,
  };
  const firstFireKey = coworkCronFireKey(fallSchedule, new Date(fallFirst));
  const secondFireKey = coworkCronFireKey(fallSchedule, new Date(fallSecond));
  const passed =
    agendaSpring === springExpected &&
    coworkSpring === springExpected &&
    fallFirst === fallFirstExpected &&
    fallSecond === fallSecondExpected &&
    coworkFallFirst === fallFirstExpected &&
    coworkFallSecond === fallSecondExpected &&
    firstFireKey !== secondFireKey &&
    backlogLatest === backlogExpected;
  return {
    passed,
    timeZone,
    springForward: {
      from: new Date(springFrom).toISOString(),
      expected: new Date(springExpected).toISOString(),
      agenda: new Date(agendaSpring).toISOString(),
      cowork: new Date(coworkSpring).toISOString(),
    },
    fallBack: {
      first: new Date(fallFirst).toISOString(),
      second: new Date(fallSecond).toISOString(),
      coworkFirst: new Date(coworkFallFirst).toISOString(),
      coworkSecond: new Date(coworkFallSecond).toISOString(),
      distinctFireKeys: firstFireKey !== secondFireKey,
    },
    backlog: {
      first: new Date(backlogFirst).toISOString(),
      through: new Date(backlogThrough).toISOString(),
      latest: new Date(backlogLatest).toISOString(),
      expected: new Date(backlogExpected).toISOString(),
    },
  };
}

function profileHasValidFloors(profile) {
  if (!profile || !new Set(["smoke", "formal"]).has(profile.mode)) return false;
  const formal = profile.mode === "formal";
  return (
    Number.isFinite(profile.durationSeconds) &&
    profile.durationSeconds >= (formal ? 7_200 : 1) &&
    Number.isSafeInteger(profile.rounds) &&
    profile.rounds >= (formal ? 100 : 1) &&
    Number.isSafeInteger(profile.steadyOccurrencesPerRound) &&
    profile.steadyOccurrencesPerRound >= (formal ? 10 : 2) &&
    profile.steadyStateOccurrences ===
      profile.rounds * profile.steadyOccurrencesPerRound &&
    (!formal || profile.steadyStateOccurrences >= 1_000) &&
    Number.isSafeInteger(profile.leaseMs) &&
    profile.leaseMs >= 1_000 &&
    profile.leaseMs <= 60_000 &&
    Number.isSafeInteger(profile.pollMs) &&
    profile.pollMs > 0 &&
    profile.pollMs <= 10_000 &&
    Number.isSafeInteger(profile.checkpointIntervalSeconds) &&
    profile.checkpointIntervalSeconds > 0 &&
    Number.isSafeInteger(profile.cleanupDeadlineMs) &&
    profile.cleanupDeadlineMs > 0 &&
    profile.cleanupDeadlineMs <= 60_000 &&
    Number.isFinite(profile.maxRssGrowthMb) &&
    profile.maxRssGrowthMb > 0 &&
    Number.isSafeInteger(profile.maxResourceGrowth) &&
    profile.maxResourceGrowth > 0 &&
    Number.isSafeInteger(profile.executionDelayMs) &&
    profile.executionDelayMs > 0 &&
    profile.executionDelayMs <= 5_000 &&
    Number.isSafeInteger(profile.heartbeatDelayMs) &&
    profile.heartbeatDelayMs > profile.leaseMs &&
    profile.heartbeatDelayMs <= 300_000
  );
}

function profilesEqual(first, second) {
  if (!first || !second) return first === second;
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return (
    JSON.stringify(firstKeys) === JSON.stringify(secondKeys) &&
    firstKeys.every((key) => Object.is(first[key], second[key]))
  );
}

function parseStrictIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function validRunMetadata(value) {
  return (
    value &&
    ["github-actions", "local"].includes(value.provider) &&
    typeof value.repository === "string" &&
    value.repository.length > 0 &&
    typeof value.workflow === "string" &&
    value.workflow.length > 0 &&
    typeof value.eventName === "string" &&
    value.eventName.length > 0 &&
    RUN_ID_PATTERN.test(value.runId || "") &&
    Number.isSafeInteger(value.runAttempt) &&
    value.runAttempt > 0 &&
    FULL_SHA_PATTERN.test(value.controlPlaneSha || "") &&
    (value.runUrl === null ||
      (typeof value.runUrl === "string" && value.runUrl.length > 0))
  );
}

export function validateSchedulerSoakEvidence(value, options = {}) {
  const releaseCommit = normalizeFullSha(
    options.releaseCommit || value?.releaseCommit,
  );
  const seed = normalizeSeed(options.seed ?? value?.seed);
  const campaign = normalizeCampaign(options.campaign || value?.campaign);
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
  if (value?.seed !== seed) issues.push("seed");
  if (value?.campaign !== campaign) issues.push("campaign");
  if (
    value?.source?.clean !== true ||
    value?.source?.changeCount !== 0 ||
    value?.source?.finalClean !== true ||
    value?.source?.finalChangeCount !== 0
  ) {
    issues.push("clean source");
  }
  if (!EXPECTED_OPERATING_SYSTEMS.includes(value?.runner?.operatingSystem)) {
    issues.push("operating system");
  }
  if (!validRunMetadata(value?.execution)) issues.push("run metadata");
  if (!profileHasValidFloors(value?.profile)) issues.push("profile floors");
  if (options.profile && !profilesEqual(value?.profile, options.profile)) {
    issues.push("expected profile");
  }
  if (
    !Number.isFinite(value?.continuousDurationSeconds) ||
    value.continuousDurationSeconds < value?.profile?.durationSeconds
  ) {
    issues.push("continuous duration");
  }
  const startedAt = parseStrictIsoTimestamp(value?.startedAt);
  const completedAt = parseStrictIsoTimestamp(value?.completedAt);
  if (
    startedAt === null ||
    completedAt === null ||
    completedAt < startedAt ||
    completedAt - startedAt < value?.profile?.durationSeconds * 1_000
  ) {
    issues.push("wall-clock duration");
  }
  if (
    REQUIRED_INVARIANT_NAMES.some((name) => value?.invariants?.[name] !== true)
  ) {
    issues.push("invariants");
  }
  const metrics = value?.metrics;
  if (
    metrics?.passed !== true ||
    metrics?.rounds !== value?.profile?.rounds ||
    metrics?.steadyStateOccurrences !==
      value?.profile?.steadyStateOccurrences ||
    metrics?.workerProcessesSpawned !== 2 ||
    metrics?.productiveWorkers !== 2 ||
    !Number.isFinite(metrics?.rssGrowthMb) ||
    metrics.rssGrowthMb < 0 ||
    metrics.rssGrowthMb > value?.profile?.maxRssGrowthMb ||
    !Number.isSafeInteger(metrics?.resourceGrowth) ||
    metrics.resourceGrowth < 0 ||
    metrics.resourceGrowth > value?.profile?.maxResourceGrowth ||
    !Number.isSafeInteger(metrics?.sampleCount) ||
    metrics.sampleCount < 3 ||
    !Array.isArray(metrics?.targets) ||
    metrics.targets.length !== 3 ||
    new Set(metrics.targets.map((entry) => entry?.label)).size !== 3 ||
    metrics.targets.some(
      (entry) =>
        entry?.passed !== true ||
        !Number.isSafeInteger(entry?.sampleCount) ||
        entry.sampleCount < 3 ||
        !Number.isFinite(entry?.rss?.peakGrowthBytes) ||
        entry.rss.peakGrowthBytes < 0 ||
        entry.rss.peakGrowthBytes >
          value?.profile?.maxRssGrowthMb * 1024 * 1024 ||
        !Number.isSafeInteger(entry?.resources?.peakGrowth) ||
        entry.resources.peakGrowth < 0 ||
        entry.resources.peakGrowth > value?.profile?.maxResourceGrowth,
    )
  ) {
    issues.push("resource metrics");
  }
  const totals = value?.totals;
  if (
    totals?.rounds !== value?.profile?.rounds ||
    totals?.steadyOccurrences !== value?.profile?.steadyStateOccurrences ||
    totals?.hardKills !== value?.profile?.rounds * 2 ||
    totals?.effects !==
      value?.profile?.steadyStateOccurrences + value?.profile?.rounds * 2 + 1
  ) {
    issues.push("workload totals");
  }
  const expectedSucceeded =
    value?.profile?.steadyStateOccurrences + value?.profile?.rounds + 1;
  const expectedTotal =
    value?.profile?.steadyStateOccurrences + value?.profile?.rounds * 2 + 1;
  const databaseCounts = value?.database?.statusCounts;
  if (
    value?.database?.quickCheck !== "ok" ||
    databaseCounts?.succeeded !== expectedSucceeded ||
    databaseCounts?.dead_letter !== value?.profile?.rounds ||
    Object.entries(databaseCounts || {}).some(
      ([status, count]) =>
        !["succeeded", "dead_letter"].includes(status) && count !== 0,
    ) ||
    value?.database?.totalOccurrences !== expectedTotal
  ) {
    issues.push("database quick_check or status totals");
  }
  const cleanupProcesses = value?.cleanup?.processes;
  if (
    value?.cleanup?.passed !== true ||
    value?.cleanup?.deadlineMs !== value?.profile?.cleanupDeadlineMs ||
    !Number.isFinite(value?.cleanup?.durationMs) ||
    value.cleanup.durationMs < 0 ||
    value.cleanup.durationMs > value?.profile?.cleanupDeadlineMs ||
    !Array.isArray(cleanupProcesses) ||
    cleanupProcesses.length !== 2 ||
    new Set(cleanupProcesses.map((entry) => entry?.pid)).size !== 2 ||
    cleanupProcesses.some(
      (entry) =>
        !Number.isSafeInteger(entry?.pid) ||
        entry.pid <= 0 ||
        entry.retired !== true ||
        entry.graceful !== true ||
        entry.code !== 0 ||
        entry.signal !== null ||
        entry.error != null,
    )
  ) {
    issues.push("cleanup processes retired");
  }
  if (!Array.isArray(value?.violations) || value.violations.length !== 0) {
    issues.push("violations");
  }
  if (issues.length > 0) {
    throw new Error(`invalid scheduler soak evidence: ${issues.join(", ")}`);
  }
  return value;
}

export function verifySchedulerSoakEvidenceSet(options = {}) {
  const releaseCommit = normalizeFullSha(options.releaseCommit);
  const seed = normalizeSeed(options.seed);
  const campaign = normalizeCampaign(options.campaign);
  const evidenceDir = path.resolve(String(options.evidenceDir || ""));
  const entries = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: readJson(path.join(evidenceDir, name)) }))
    .filter((entry) => entry.value?.schema === RESULT_SCHEMA);
  const operatingSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  if (
    JSON.stringify(operatingSystems) !==
    JSON.stringify(EXPECTED_OPERATING_SYSTEMS)
  ) {
    throw new Error(
      `scheduler soak evidence must contain exactly linux, macos, windows; found ${operatingSystems.join(", ")}`,
    );
  }
  for (const entry of entries) {
    validateSchedulerSoakEvidence(entry.value, {
      releaseCommit,
      seed,
      campaign,
      profile: options.profile,
    });
  }
  const profileJson = JSON.stringify(entries[0].value.profile);
  if (
    entries.some((entry) => JSON.stringify(entry.value.profile) !== profileJson)
  ) {
    throw new Error("scheduler soak profiles differ across operating systems");
  }
  const executionJson = JSON.stringify(entries[0].value.execution);
  if (
    entries.some(
      (entry) => JSON.stringify(entry.value.execution) !== executionJson,
    )
  ) {
    throw new Error(
      "scheduler soak run metadata differs across operating systems",
    );
  }
  if (
    options.profile &&
    !profilesEqual(entries[0].value.profile, options.profile)
  ) {
    throw new Error(
      "scheduler soak profile does not match the requested profile",
    );
  }
  const startedAt = new Date(
    Math.min(...entries.map((entry) => Date.parse(entry.value.startedAt))),
  ).toISOString();
  const completedAt = new Date(
    Math.max(...entries.map((entry) => Date.parse(entry.value.completedAt))),
  ).toISOString();
  const aggregate = {
    schema: AGGREGATE_SCHEMA,
    result: "passed",
    releaseCommit,
    seed,
    campaign,
    verifiedAt: new Date().toISOString(),
    startedAt,
    completedAt,
    continuousDurationSeconds:
      (Date.parse(completedAt) - Date.parse(startedAt)) / 1_000,
    operatingSystems: [...EXPECTED_OPERATING_SYSTEMS],
    profile: entries[0].value.profile,
    execution: entries[0].value.execution,
    totals: entries.reduce(
      (sum, entry) => ({
        rounds: sum.rounds + entry.value.totals.rounds,
        steadyOccurrences:
          sum.steadyOccurrences + entry.value.totals.steadyOccurrences,
        hardKills: sum.hardKills + entry.value.totals.hardKills,
        effects: sum.effects + entry.value.totals.effects,
      }),
      { rounds: 0, steadyOccurrences: 0, hardKills: 0, effects: 0 },
    ),
    evidence: entries.map((entry) => ({
      file: entry.name,
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(path.join(evidenceDir, entry.name)),
      startedAt: entry.value.startedAt,
      completedAt: entry.value.completedAt,
    })),
  };
  if (options.output) atomicWriteJson(options.output, aggregate);
  return aggregate;
}

function assertInvariant(
  condition,
  message,
  code = "SCHEDULER_SOAK_INVARIANT",
) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function delay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createWorkerProcess({
  db,
  effectsDir,
  owner,
  workerId = owner,
  jobKind,
  pause = "none",
  once = false,
  leaseMs,
  pollMs,
  activeWorkers,
}) {
  const argumentsList = [
    WORKER_PATH,
    "--db",
    db,
    "--effects-dir",
    effectsDir,
    "--owner",
    owner,
    "--worker-id",
    workerId,
    "--job-kind",
    jobKind,
    "--pause",
    pause,
    "--lease-ms",
    String(leaseMs),
    "--poll-ms",
    String(pollMs),
    ...(once ? ["--once"] : []),
  ];
  const child = spawn(process.execPath, argumentsList, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  const waiters = new Set();
  let stdoutBuffer = "";
  let stderr = "";
  let parseError = null;
  let closed = false;
  let workerHandle = null;
  child.stdin.on("error", (error) => {
    // A checkpoint worker can exit between the writable check and write(2).
    // Keep EPIPE inside the worker result instead of emitting it unhandled.
    if (!closed) parseError ||= error;
  });

  const dispatch = (line) => {
    if (!line.trim()) return;
    if (events.length >= MAX_WORKER_EVENTS) {
      parseError ||= new Error(`worker ${workerId} exceeded event budget`);
      return;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      parseError ||= new Error(`worker ${workerId} emitted invalid JSON`, {
        cause: error,
      });
      return;
    }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      dispatch(stdoutBuffer.slice(0, newline));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (Buffer.byteLength(stderr, "utf8") < MAX_WORKER_STDERR_BYTES) {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > MAX_WORKER_STDERR_BYTES) {
        stderr = Buffer.from(stderr, "utf8")
          .subarray(0, MAX_WORKER_STDERR_BYTES)
          .toString("utf8");
      }
    }
  });
  const done = new Promise((resolve) => {
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
      parseError ||= error;
    });
    child.once("close", (code, signal) => {
      closed = true;
      activeWorkers.delete(workerHandle);
      dispatch(stdoutBuffer);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(
            `worker ${workerId} exited before expected event: code=${code} signal=${signal || "none"}`,
          ),
        );
      }
      waiters.clear();
      resolve({
        code,
        signal,
        events,
        stderr,
        error: parseError || spawnError,
      });
    });
  });

  const waitFor = (predicate, timeoutMs, label = "worker event") => {
    const prior = events.find(predicate);
    if (prior) return Promise.resolve(prior);
    if (closed) {
      return Promise.reject(
        new Error(`worker ${workerId} already exited before ${label}`),
      );
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(
          new Error(
            `${label} timed out for ${workerId}; stderr=${stderr.slice(-2_000)} events=${JSON.stringify(events.slice(-20))}`,
          ),
        );
      }, timeoutMs);
      waiters.add(waiter);
    });
  };

  const send = (command) => {
    if (closed || !child.stdin.writable) {
      throw new Error(`worker ${workerId} control stream is closed`);
    }
    child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  workerHandle = {
    child,
    pid: child.pid,
    owner,
    workerId,
    jobKind,
    events,
    done,
    waitFor,
    send,
    get stderr() {
      return stderr;
    },
  };
  if (!closed) activeWorkers.add(workerHandle);
  return workerHandle;
}

async function requireWorkerSuccess(worker, timeoutMs, label) {
  const result = await withTimeout(worker.done, timeoutMs, label);
  assertInvariant(
    result.code === 0 && result.signal === null && !result.error,
    `${label} failed: code=${result.code} signal=${result.signal || "none"} ${result.error?.message || result.stderr}`,
    "SCHEDULER_SOAK_WORKER_FAILED",
  );
  return result;
}

function requestDescendantKills(snapshot) {
  if (!snapshot.available) return [];
  return [...snapshot.pids].reverse().map((pid) => {
    try {
      process.kill(pid, "SIGKILL");
      return { pid, requested: true, alreadyRetired: false, error: null };
    } catch (error) {
      return {
        pid,
        requested: false,
        alreadyRetired: error?.code === "ESRCH",
        error: error?.code === "ESRCH" ? null : safeError(error),
      };
    }
  });
}

async function stopWorker(worker, timeoutMs) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  const remaining = () => Math.max(1, Math.floor(deadline - performance.now()));
  if (worker.child.exitCode == null && worker.child.signalCode == null) {
    try {
      worker.send({ type: "stop" });
    } catch {
      // The exit result below remains authoritative.
    }
  }
  let result;
  let forced = false;
  let descendants = null;
  let descendantKillRequests = [];
  try {
    const gracefulBudget = Math.min(
      remaining(),
      Math.max(500, Math.min(2_000, Math.floor(timeoutMs / 4))),
    );
    result = await withTimeout(
      worker.done,
      gracefulBudget,
      "worker graceful stop",
    );
  } catch {
    forced = true;
    descendants = descendantPids(worker.pid);
    worker.child.kill("SIGKILL");
    descendantKillRequests = requestDescendantKills(descendants);
    result = await withTimeout(worker.done, remaining(), "worker forced stop");
  }
  const retirement = await waitForProcessRetirement(worker.pid, {
    timeoutMs: remaining(),
  });
  const descendantRetirements = descendants?.available
    ? await Promise.all(
        descendants.pids.map(async (pid) => ({
          pid,
          ...(await waitForProcessRetirement(pid, {
            timeoutMs: remaining(),
          })),
        })),
      )
    : [];
  const durationMs = performance.now() - started;
  return {
    pid: worker.pid,
    retired:
      retirement.retired &&
      durationMs <= timeoutMs &&
      (!descendants?.available ||
        descendantRetirements.every((entry) => entry.retired)),
    durationMs,
    code: result.code,
    signal: result.signal,
    graceful:
      !forced &&
      result.code === 0 &&
      result.signal === null &&
      result.error == null,
    error: result.error == null ? null : safeError(result.error),
    descendants,
    descendantKillRequests,
    descendantRetirements,
  };
}

async function hardKillWorker(worker, timeoutMs) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  const remaining = () => Math.max(1, Math.floor(deadline - performance.now()));
  const descendants = descendantPids(worker.pid);
  const killed = worker.child.kill("SIGKILL");
  const descendantKillRequests = requestDescendantKills(descendants);
  assertInvariant(killed, `worker ${worker.workerId} could not be hard-killed`);
  const exit = await withTimeout(
    worker.done,
    remaining(),
    "hard-killed worker exit",
  );
  const rootRetirement = await waitForProcessRetirement(worker.pid, {
    timeoutMs: remaining(),
  });
  const descendantRetirements = descendants.available
    ? await Promise.all(
        descendants.pids.map(async (pid) => ({
          pid,
          ...(await waitForProcessRetirement(pid, {
            timeoutMs: remaining(),
          })),
        })),
      )
    : [];
  const durationMs = performance.now() - started;
  return {
    pid: worker.pid,
    exitCode: exit.code,
    signal: exit.signal,
    descendants,
    descendantKillRequests,
    rootRetired: rootRetirement.retired,
    rootRetirementMs: Math.round(rootRetirement.elapsedMs),
    durationMs,
    descendantRetirements,
    passed:
      rootRetirement.retired &&
      durationMs <= timeoutMs &&
      descendants.available &&
      descendantKillRequests.every(
        (entry) => entry.requested || entry.alreadyRetired,
      ) &&
      descendantRetirements.every((entry) => entry.retired),
  };
}

function createMetricsTracker(targets, profile) {
  const samples = [];
  const windowsSnapshot = () => {
    if (normalizeOperatingSystem() !== "windows") return null;
    const identifiers = targets.map((target) => target.pid).join(",");
    try {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ErrorActionPreference='Stop'; Get-Process -Id ${identifiers} | ForEach-Object { '{0},{1},{2}' -f $_.Id,$_.WorkingSet64,$_.HandleCount }`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 10_000 },
      );
      return new Map(
        output
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => {
            const [pid, rss, resources] = line.trim().split(",").map(Number);
            return [pid, { rssBytes: rss, resources }];
          })
          .filter(
            ([pid, value]) =>
              Number.isSafeInteger(pid) &&
              Number.isFinite(value.rssBytes) &&
              Number.isFinite(value.resources),
          ),
      );
    } catch {
      return null;
    }
  };
  const sample = () => {
    const capturedAt = new Date().toISOString();
    const batch = windowsSnapshot();
    const targetSamples = targets.map((target) => {
      const batched = batch?.get(target.pid);
      const rss =
        batched?.rssBytes ??
        (target.pid === process.pid
          ? process.memoryUsage().rss
          : rssBytes(target.pid));
      const resources = batched
        ? { kind: "handle", count: batched.resources }
        : resourceCount(target.pid);
      return {
        label: target.label,
        pid: target.pid,
        rssBytes: rss,
        resourceKind: resources.kind,
        resources: resources.count,
      };
    });
    samples.push({ capturedAt, targets: targetSamples });
    return targetSamples;
  };
  const summarize = () => {
    const maxRssGrowthBytes = profile.maxRssGrowthMb * 1024 * 1024;
    const targetSummaries = targets.map((target) => {
      const values = samples
        .map((entry) =>
          entry.targets.find((item) => item.label === target.label),
        )
        .filter(Boolean);
      const rssValues = values
        .map((entry) => entry.rssBytes)
        .filter(Number.isFinite);
      const resourceValues = values
        .map((entry) => entry.resources)
        .filter(Number.isFinite);
      const rssBefore = rssValues[0] ?? null;
      const rssAfter = rssValues.at(-1) ?? null;
      const rssMaximum = rssValues.length > 0 ? Math.max(...rssValues) : null;
      const resourceBefore = resourceValues[0] ?? null;
      const resourceAfter = resourceValues.at(-1) ?? null;
      const resourceMaximum =
        resourceValues.length > 0 ? Math.max(...resourceValues) : null;
      const rssGrowth =
        rssBefore === null || rssMaximum === null
          ? null
          : rssMaximum - rssBefore;
      const resourceGrowth =
        resourceBefore === null || resourceMaximum === null
          ? null
          : resourceMaximum - resourceBefore;
      const rssTrend = linearTailTrend(rssValues);
      const resourceTrend = linearTailTrend(resourceValues);
      return {
        label: target.label,
        pid: target.pid,
        sampleCount: values.length,
        rss: {
          beforeBytes: rssBefore,
          afterBytes: rssAfter,
          maximumBytes: rssMaximum,
          peakGrowthBytes: rssGrowth,
          trend: rssTrend,
        },
        resources: {
          kind: values.find((entry) => entry.resourceKind !== "unavailable")
            ?.resourceKind,
          before: resourceBefore,
          after: resourceAfter,
          maximum: resourceMaximum,
          peakGrowth: resourceGrowth,
          trend: resourceTrend,
        },
        passed:
          rssValues.length >= 3 &&
          resourceValues.length >= 3 &&
          rssGrowth !== null &&
          rssGrowth <= maxRssGrowthBytes &&
          rssTrend.projectedTailGrowth <= maxRssGrowthBytes &&
          resourceGrowth !== null &&
          resourceGrowth <= profile.maxResourceGrowth &&
          resourceTrend.projectedTailGrowth <= profile.maxResourceGrowth,
      };
    });
    const maximumRssGrowth = Math.max(
      0,
      ...targetSummaries.map((entry) => entry.rss.peakGrowthBytes || 0),
    );
    const maximumResourceGrowth = Math.max(
      0,
      ...targetSummaries.map((entry) => entry.resources.peakGrowth || 0),
    );
    return {
      passed: targetSummaries.every((entry) => entry.passed),
      workerProcessesSpawned: Math.max(0, targets.length - 1),
      productiveWorkers: 0,
      rssGrowthMb: maximumRssGrowth / (1024 * 1024),
      resourceGrowth: maximumResourceGrowth,
      targets: targetSummaries,
      sampleCount: samples.length,
    };
  };
  return { sample, summarize };
}

function schedulerAuthority(seed) {
  return {
    schemaVersion: 1,
    principal: { type: "scheduler-soak", id: `scheduler-soak-${seed}` },
    tenantId: null,
    workspaceId: null,
    requestedCapabilities: ["scheduler.soak.execute"],
    authorizationRefs: {
      decisionId: `scheduler-soak-decision-${seed}`,
      policyRevision: "scheduler-soak-v1",
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function seedSchedulerJobs(store, seed) {
  const authority = schedulerAuthority(seed);
  for (const job of Object.values(JOBS)) {
    store.createJob({
      id: job.id,
      kind: job.kind,
      trigger: { source: "scheduler-soak", seed },
      payload: { resultValue: job.id },
      authority,
      maxAttempts: job.maxAttempts,
    });
  }
}

function enqueueOccurrence(store, job, triggerKey, payload = {}) {
  const scheduledFor = Date.now();
  return store.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    availableAt: scheduledFor,
    triggerKey,
    payload,
  });
}

async function waitForOccurrences(store, occurrenceIds, options = {}) {
  const deadline = performance.now() + options.timeoutMs;
  for (;;) {
    const occurrences = occurrenceIds.map((id) => store.getOccurrence(id));
    const failed = occurrences.find(
      (occurrence) => occurrence?.status === "dead_letter",
    );
    if (failed) {
      throw new Error(
        `steady occurrence dead-lettered: ${failed.id} ${JSON.stringify(failed.lastError)}`,
      );
    }
    if (occurrences.every((occurrence) => occurrence?.status === "succeeded")) {
      return occurrences;
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `occurrences did not settle: ${JSON.stringify(occurrences.map((entry) => ({ id: entry?.id, status: entry?.status })))}`,
      );
    }
    await delay(options.pollMs);
    await options.onPoll?.();
  }
}

async function waitForLeaseExpiry(
  store,
  occurrenceId,
  onWait,
  timeoutMs = 60_000,
) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const occurrence = store.getOccurrence(occurrenceId);
    const remaining = (occurrence?.leaseExpiresAt ?? Date.now()) - Date.now();
    if (remaining <= 0) return occurrence;
    if (performance.now() >= deadline) {
      throw new Error(
        `lease expiry timed out for ${occurrenceId}; leaseExpiresAt=${occurrence?.leaseExpiresAt}`,
      );
    }
    await delay(
      Math.min(remaining + 25, 250, Math.max(1, deadline - performance.now())),
    );
    await onWait?.();
  }
}

function effectPath(effectsDir, occurrenceId) {
  return path.join(effectsDir, `${occurrenceId}.json`);
}

function readEffects(effectsDir) {
  if (!fs.existsSync(effectsDir)) return [];
  return fs
    .readdirSync(effectsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const value = readJson(path.join(effectsDir, name));
      assertInvariant(
        name === `${value.occurrenceId}.json`,
        `effect filename does not bind its occurrence: ${name}`,
      );
      assertInvariant(
        value.kind === "scheduler-soak-local-effect" &&
          /^[0-9a-f]{64}$/u.test(value.resultDigest),
        `effect evidence is malformed: ${name}`,
      );
      return value;
    });
}

async function waitUntilTimestamp(
  timestamp,
  { onWait, timeoutMs = 60_000, label = "wall-clock wait" } = {},
) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const remaining = timestamp - Date.now();
    if (remaining <= 0) return;
    if (performance.now() >= deadline) {
      throw new Error(`${label} timed out before ${timestamp}`);
    }
    await delay(
      Math.min(remaining, 250, Math.max(1, deadline - performance.now())),
    );
    await onWait?.();
  }
}

async function waitForWorkerReady(worker, timeoutMs) {
  return worker.waitFor(
    (event) => event.type === "ready",
    timeoutMs,
    "worker ready",
  );
}

async function retireSuccessfulWorker(worker, timeoutMs, label) {
  const result = await requireWorkerSuccess(worker, timeoutMs, label);
  const retirement = await waitForProcessRetirement(worker.pid, { timeoutMs });
  assertInvariant(
    retirement.retired,
    `${label} process ${worker.pid} did not retire`,
    "SCHEDULER_SOAK_PROCESS_LEAK",
  );
  return {
    pid: worker.pid,
    retired: retirement.retired,
    retirementMs: Math.round(retirement.elapsedMs),
    code: result.code,
    signal: result.signal,
  };
}

function workerScenarioTimeout(profile) {
  return Math.max(
    15_000,
    profile.cleanupDeadlineMs,
    profile.heartbeatDelayMs + profile.leaseMs * 4,
  );
}

async function runHeartbeatScenario(context) {
  const {
    store,
    profile,
    db,
    effectsDir,
    activeWorkers,
    campaign,
    seed,
    retirements,
  } = context;
  const timeoutMs = workerScenarioTimeout(profile);
  const occurrence = enqueueOccurrence(
    store,
    JOBS.heartbeat,
    `${campaign}:${seed}:heartbeat`,
    {
      resultValue: "heartbeat-renewal",
      executionDelayMs: profile.heartbeatDelayMs,
    },
  );
  const winner = createWorkerProcess({
    db,
    effectsDir,
    owner: `heartbeat-winner-${seed}`,
    jobKind: JOBS.heartbeat.kind,
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(winner, timeoutMs);
  const claimed = await winner.waitFor(
    (event) =>
      event.type === "claimed" && event.occurrence?.id === occurrence.id,
    timeoutMs,
    "heartbeat claim",
  );
  const initialLeaseExpiresAt = claimed.occurrence.leaseExpiresAt;
  let renewedWhileRunning = null;
  const renewalDeadline = performance.now() + profile.leaseMs * 2;
  while (performance.now() < renewalDeadline) {
    const current = store.getOccurrence(occurrence.id);
    if (
      current?.status === "running" &&
      current.leaseExpiresAt > initialLeaseExpiresAt
    ) {
      renewedWhileRunning = current;
      break;
    }
    await delay(Math.max(10, Math.min(profile.pollMs, 100)));
  }
  assertInvariant(
    renewedWhileRunning,
    "heartbeat worker did not advance its fenced lease",
  );
  // Do not run host probes in this timing-critical window: Windows handle/RSS
  // probes may launch PowerShell and outlive the deliberately long execution.
  await waitUntilTimestamp(initialLeaseExpiresAt + 25, {
    timeoutMs,
    label: "original heartbeat lease expiry",
  });
  const protectedOccurrence = store.getOccurrence(occurrence.id);
  assertInvariant(
    protectedOccurrence?.status === "running" &&
      protectedOccurrence.leaseExpiresAt > Date.now(),
    "heartbeat lease was not live beyond its original expiry",
  );

  const contender = createWorkerProcess({
    db,
    effectsDir,
    owner: `heartbeat-contender-${seed}`,
    jobKind: JOBS.heartbeat.kind,
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(contender, timeoutMs);
  const contenderResult = await requireWorkerSuccess(
    contender,
    timeoutMs,
    "heartbeat contender",
  );
  const contenderRetirement = await waitForProcessRetirement(contender.pid, {
    timeoutMs,
  });
  assertInvariant(
    contenderRetirement.retired,
    "heartbeat contender process did not retire",
    "SCHEDULER_SOAK_PROCESS_LEAK",
  );
  retirements.push({
    pid: contender.pid,
    retired: contenderRetirement.retired,
    role: "heartbeat-contender",
  });
  const winnerRetirement = await retireSuccessfulWorker(
    winner,
    timeoutMs,
    "heartbeat winner",
  );
  retirements.push({ ...winnerRetirement, role: "heartbeat-winner" });

  const settled = store.getOccurrence(occurrence.id);
  const renewals = store
    .history({ occurrenceId: occurrence.id })
    .filter((event) => event.type === "occurrence_renewed");
  const effect = readJson(effectPath(effectsDir, occurrence.id));
  const contenderClaimed = contenderResult.events.some(
    (event) => event.type === "claimed",
  );
  assertInvariant(
    settled?.status === "succeeded",
    "heartbeat work did not settle",
  );
  assertInvariant(
    renewals.length > 0,
    "heartbeat history has no lease renewal",
  );
  assertInvariant(
    !contenderClaimed,
    "contender stole a renewed heartbeat lease",
  );
  return {
    occurrenceId: occurrence.id,
    initialLeaseExpiresAt,
    renewedLeaseExpiresAt: renewedWhileRunning.leaseExpiresAt,
    protectedLeaseExpiresAt: protectedOccurrence.leaseExpiresAt,
    renewalEvents: renewals.length,
    contenderClaimed,
    finalStatus: settled.status,
    effect: {
      owner: effect.owner,
      fence: effect.fence,
      sha256: sha256File(effectPath(effectsDir, occurrence.id)),
    },
    winnerRetirement,
    contenderRetirement: {
      pid: contender.pid,
      retired: contenderRetirement.retired,
      retirementMs: Math.round(contenderRetirement.elapsedMs),
    },
    passed: true,
  };
}

async function runBeforeExecuteCrashScenario(context, roundIndex) {
  const {
    store,
    profile,
    db,
    effectsDir,
    activeWorkers,
    campaign,
    seed,
    sample,
    retirements,
  } = context;
  const timeoutMs = workerScenarioTimeout(profile);
  const occurrence = enqueueOccurrence(
    store,
    JOBS.crash,
    `${campaign}:${seed}:before-execute:${roundIndex}`,
    { resultValue: `before-execute-${roundIndex}` },
  );
  const crashedOwner = `before-crashed-${seed}-${roundIndex}`;
  const crashed = createWorkerProcess({
    db,
    effectsDir,
    owner: crashedOwner,
    jobKind: JOBS.crash.kind,
    pause: "before-execute",
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(crashed, timeoutMs);
  const firstCheckpoint = await crashed.waitFor(
    (event) =>
      event.type === "checkpoint" &&
      event.checkpoint === "before-execute" &&
      event.occurrence?.id === occurrence.id,
    timeoutMs,
    "before-execute crash checkpoint",
  );
  const noEffectBeforeKill = !fs.existsSync(
    effectPath(effectsDir, occurrence.id),
  );
  assertInvariant(
    noEffectBeforeKill,
    "before-execute worker wrote an early effect",
  );
  const hardKill = await hardKillWorker(crashed, timeoutMs);
  retirements.push({
    pid: crashed.pid,
    retired: hardKill.passed,
    role: "before-execute-crashed",
  });
  assertInvariant(hardKill.passed, "before-execute hard-killed process leaked");
  await waitForLeaseExpiry(store, occurrence.id, sample, timeoutMs);

  const replacementOwner = `before-replacement-${seed}-${roundIndex}`;
  const replacement = createWorkerProcess({
    db,
    effectsDir,
    owner: replacementOwner,
    jobKind: JOBS.crash.kind,
    pause: "before-execute",
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(replacement, timeoutMs);
  const secondCheckpoint = await replacement.waitFor(
    (event) =>
      event.type === "checkpoint" &&
      event.checkpoint === "before-execute" &&
      event.occurrence?.id === occurrence.id,
    timeoutMs,
    "before-execute replacement checkpoint",
  );
  let staleError = null;
  try {
    store.settle({
      occurrenceId: occurrence.id,
      ownerId: crashedOwner,
      fence: firstCheckpoint.occurrence.fence,
      outcome: "succeeded",
      result: { stale: true },
    });
  } catch (error) {
    staleError = error;
  }
  assertInvariant(
    staleError?.code === "SCHEDULER_LEASE_LOST",
    `stale settlement was not fenced: ${staleError?.code || "no-error"}`,
  );
  assertInvariant(
    secondCheckpoint.occurrence.fence > firstCheckpoint.occurrence.fence,
    "replacement did not receive a higher fence",
  );
  replacement.send({ type: "resume", checkpoint: "before-execute" });
  const replacementRetirement = await retireSuccessfulWorker(
    replacement,
    timeoutMs,
    "before-execute replacement",
  );
  retirements.push({
    ...replacementRetirement,
    role: "before-execute-replacement",
  });

  const settled = store.getOccurrence(occurrence.id);
  const matchingEffects = readEffects(effectsDir).filter(
    (effect) => effect.occurrenceId === occurrence.id,
  );
  assertInvariant(
    settled?.status === "succeeded" && matchingEffects.length === 1,
    "before-execute replacement did not produce one durable result",
  );
  return {
    occurrenceId: occurrence.id,
    firstClaim: firstCheckpoint.occurrence,
    replacementClaim: secondCheckpoint.occurrence,
    noEffectBeforeKill,
    hardKill,
    staleSettlement: {
      rejected: staleError?.code === "SCHEDULER_LEASE_LOST",
      error: safeError(staleError),
    },
    finalStatus: settled.status,
    effectCount: matchingEffects.length,
    effect: matchingEffects[0],
    replacementRetirement,
    passed: true,
  };
}

async function runAfterExecuteCrashScenario(context, roundIndex) {
  const {
    store,
    profile,
    db,
    effectsDir,
    activeWorkers,
    campaign,
    seed,
    sample,
    retirements,
  } = context;
  const timeoutMs = workerScenarioTimeout(profile);
  const occurrence = enqueueOccurrence(
    store,
    JOBS.outcome,
    `${campaign}:${seed}:after-execute:${roundIndex}`,
    { resultValue: `after-execute-${roundIndex}` },
  );
  const crashed = createWorkerProcess({
    db,
    effectsDir,
    owner: `after-crashed-${seed}-${roundIndex}`,
    jobKind: JOBS.outcome.kind,
    pause: "after-execute",
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(crashed, timeoutMs);
  const checkpoint = await crashed.waitFor(
    (event) =>
      event.type === "checkpoint" &&
      event.checkpoint === "after-execute" &&
      event.occurrence?.id === occurrence.id,
    timeoutMs,
    "after-execute crash checkpoint",
  );
  const authoritativeEffectPath = effectPath(effectsDir, occurrence.id);
  const effectBefore = readJson(authoritativeEffectPath);
  const hashBefore = sha256File(authoritativeEffectPath);
  const countBefore = readEffects(effectsDir).filter(
    (effect) => effect.occurrenceId === occurrence.id,
  ).length;
  const hardKill = await hardKillWorker(crashed, timeoutMs);
  retirements.push({
    pid: crashed.pid,
    retired: hardKill.passed,
    role: "after-execute-crashed",
  });
  assertInvariant(hardKill.passed, "after-execute hard-killed process leaked");
  await waitForLeaseExpiry(store, occurrence.id, sample, timeoutMs);

  const observer = createWorkerProcess({
    db,
    effectsDir,
    owner: `after-observer-${seed}-${roundIndex}`,
    jobKind: JOBS.outcome.kind,
    once: true,
    leaseMs: profile.leaseMs,
    pollMs: profile.pollMs,
    activeWorkers,
  });
  await waitForWorkerReady(observer, timeoutMs);
  const observerResult = await requireWorkerSuccess(
    observer,
    timeoutMs,
    "after-execute observer",
  );
  const observerRetirement = await waitForProcessRetirement(observer.pid, {
    timeoutMs,
  });
  assertInvariant(
    observerRetirement.retired,
    "after-execute observer process did not retire",
    "SCHEDULER_SOAK_PROCESS_LEAK",
  );
  retirements.push({
    pid: observer.pid,
    retired: observerRetirement.retired,
    role: "after-execute-observer",
  });

  const settled = store.getOccurrence(occurrence.id);
  const hashAfter = sha256File(authoritativeEffectPath);
  const matchingEffects = readEffects(effectsDir).filter(
    (effect) => effect.occurrenceId === occurrence.id,
  );
  const observerClaimed = observerResult.events.some(
    (event) => event.type === "claimed",
  );
  assertInvariant(
    settled?.status === "dead_letter" &&
      settled.lastError?.code === "lease_expired",
    "after-execute uncertainty was not dead-lettered",
  );
  assertInvariant(
    !observerClaimed &&
      countBefore === 1 &&
      matchingEffects.length === 1 &&
      hashAfter === hashBefore,
    "after-execute effect was replayed or changed",
  );
  return {
    occurrenceId: occurrence.id,
    claim: checkpoint.occurrence,
    hardKill,
    effect: {
      owner: effectBefore.owner,
      fence: effectBefore.fence,
      countBefore,
      countAfter: matchingEffects.length,
      hashBefore,
      hashAfter,
    },
    observerClaimed,
    finalStatus: settled.status,
    lastError: settled.lastError,
    observerRetirement: {
      pid: observer.pid,
      retired: observerRetirement.retired,
      retirementMs: Math.round(observerRetirement.elapsedMs),
    },
    passed: true,
  };
}

function emptyInvariants() {
  return {
    twoWorkerContention: false,
    beforeExecuteHigherFence: false,
    staleSettlementRejected: false,
    afterExecuteDeadLettered: false,
    afterExecuteNoReplay: false,
    heartbeatRenewed: false,
    dstSemantics: false,
    backlogDrained: false,
    databaseQuickCheck: false,
    allProcessesRetired: false,
  };
}

function occurrenceStatusCounts(store) {
  return Object.fromEntries(
    store.db
      .prepare(
        "SELECT status, COUNT(*) AS count FROM occurrences GROUP BY status ORDER BY status",
      )
      .all()
      .map((row) => [row.status, Number(row.count)]),
  );
}

async function waitForPerformanceTarget(target, onWait) {
  while (performance.now() < target) {
    await delay(Math.min(250, Math.max(1, target - performance.now())));
    await onWait?.();
  }
}

export async function runSchedulerKernelSoak(options = {}) {
  const profile = normalizeProfile(
    options.profile || resolveSchedulerSoakProfile(options.env || process.env),
  );
  const expectedSha = normalizeFullSha(
    options.expectedSha ||
      options.releaseCommit ||
      options.env?.CC_SCHEDULER_SOAK_EXPECTED_SHA ||
      process.env.CC_SCHEDULER_SOAK_EXPECTED_SHA,
  );
  const seed = normalizeSeed(
    options.seed ??
      options.env?.CC_SCHEDULER_SOAK_SEED ??
      process.env.CC_SCHEDULER_SOAK_SEED,
  );
  const campaign = normalizeCampaign(
    options.campaign ||
      options.env?.CC_SCHEDULER_SOAK_CAMPAIGN ||
      process.env.CC_SCHEDULER_SOAK_CAMPAIGN,
  );
  const execution = normalizeRunMetadata(
    options.execution,
    options.env || process.env,
    { campaign, expectedSha },
  );
  const output = path.resolve(
    String(
      options.output ||
        options.env?.CC_SCHEDULER_SOAK_OUTPUT ||
        process.env.CC_SCHEDULER_SOAK_OUTPUT ||
        path.join(
          os.tmpdir(),
          `scheduler-kernel-soak-${normalizeOperatingSystem()}.json`,
        ),
    ),
  );
  const sourceProvider = options.sourceProvider || captureSourceIdentity;
  const startedAt = new Date().toISOString();
  const initialSource = await sourceProvider();
  const initialHeadSha = normalizeFullSha(
    initialSource?.headSha,
    "HEAD commit",
  );
  const initialChanges = Array.isArray(initialSource?.changes)
    ? initialSource.changes
    : [];
  const report = {
    schema: RESULT_SCHEMA,
    status: "running",
    releaseCommit: expectedSha,
    headSha: initialHeadSha,
    expectedSha,
    exactShaVerified: initialHeadSha === expectedSha,
    seed,
    campaign,
    startedAt,
    completedAt: null,
    source: {
      clean: initialChanges.length === 0,
      changeCount: initialChanges.length,
      finalClean: false,
      finalChangeCount: null,
    },
    runner: {
      operatingSystem: normalizeOperatingSystem(),
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      pid: process.pid,
    },
    execution,
    profile,
    continuousDurationSeconds: 0,
    temporal: null,
    heartbeat: null,
    rounds: [],
    invariants: emptyInvariants(),
    metrics: {
      passed: false,
      rounds: 0,
      steadyStateOccurrences: 0,
      workerProcessesSpawned: 0,
      productiveWorkers: 0,
      rssGrowthMb: 0,
      resourceGrowth: 0,
      targets: [],
      sampleCount: 0,
    },
    totals: {
      rounds: 0,
      steadyOccurrences: 0,
      hardKills: 0,
      effects: 0,
    },
    database: { quickCheck: null },
    cleanup: {
      passed: false,
      deadlineMs: profile.cleanupDeadlineMs,
      durationMs: 0,
      processes: [],
    },
    checkpoints: { writeCount: 0, lastWrittenAt: null },
    violations: [],
  };
  const writeCheckpoint = () => {
    report.checkpoints.writeCount += 1;
    report.checkpoints.lastWrittenAt = new Date().toISOString();
    atomicWriteJson(output, report);
  };
  writeCheckpoint();

  let temporaryRoot = null;
  let store = null;
  const activeWorkers = new Set();
  const transientRetirements = [];
  try {
    assertInvariant(
      report.exactShaVerified,
      `HEAD ${initialHeadSha} does not match expected release commit ${expectedSha}`,
      "SCHEDULER_SOAK_SHA_MISMATCH",
    );
    assertInvariant(
      report.source.clean,
      `scheduler soak requires a clean checkout; found ${initialChanges.length} changes`,
      "SCHEDULER_SOAK_DIRTY_SOURCE",
    );

    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-scheduler-kernel-soak-"),
    );
    const db = path.join(temporaryRoot, "scheduler.sqlite3");
    const effectsDir = path.join(temporaryRoot, "effects");
    fs.mkdirSync(effectsDir, { recursive: true, mode: 0o700 });
    store = openSchedulerStore({ file: db });
    seedSchedulerJobs(store, seed);

    const longWorkers = [0, 1].map((index) =>
      createWorkerProcess({
        db,
        effectsDir,
        owner: `steady-${seed}-${index + 1}`,
        workerId: `steady-${index + 1}`,
        jobKind: JOBS.steady.kind,
        pause: "before-execute",
        leaseMs: profile.leaseMs,
        pollMs: profile.pollMs,
        activeWorkers,
      }),
    );
    const timeoutMs = workerScenarioTimeout(profile);
    await Promise.all(
      longWorkers.map((worker) => waitForWorkerReady(worker, timeoutMs)),
    );
    const metricsTracker = createMetricsTracker(
      [
        { label: "coordinator", pid: process.pid },
        ...longWorkers.map((worker) => ({
          label: worker.workerId,
          pid: worker.pid,
        })),
      ],
      profile,
    );
    metricsTracker.sample();
    const soakStarted = performance.now();
    const checkpointIntervalMs = profile.checkpointIntervalSeconds * 1_000;
    let nextCheckpointAt = soakStarted + checkpointIntervalMs;
    const checkpointPoll = () => {
      if (performance.now() < nextCheckpointAt) return;
      report.continuousDurationSeconds =
        (performance.now() - soakStarted) / 1_000;
      report.totals.rounds = report.rounds.length;
      report.totals.steadyOccurrences = report.rounds.reduce(
        (total, round) => total + round.steady.occurrenceIds.length,
        0,
      );
      writeCheckpoint();
      while (nextCheckpointAt <= performance.now()) {
        nextCheckpointAt += checkpointIntervalMs;
      }
    };
    const scenarioContext = {
      store,
      profile,
      db,
      effectsDir,
      activeWorkers,
      campaign,
      seed,
      sample: checkpointPoll,
      retirements: transientRetirements,
    };

    report.temporal = evaluateSchedulerTemporalVectors();
    assertInvariant(
      report.temporal.passed,
      "scheduler DST or backlog temporal vector failed",
    );
    report.heartbeat = await runHeartbeatScenario(scenarioContext);

    const resumedCheckpoints = new Set();
    const resumeSteadyCheckpoints = () => {
      for (const worker of longWorkers) {
        for (const event of worker.events) {
          if (
            event.type !== "checkpoint" ||
            event.checkpoint !== "before-execute"
          ) {
            continue;
          }
          const key = `${worker.workerId}:${event.sequence}`;
          if (resumedCheckpoints.has(key)) continue;
          worker.send({ type: "resume", checkpoint: "before-execute" });
          resumedCheckpoints.add(key);
        }
      }
    };
    const steadyOccurrenceIds = [];
    for (let roundIndex = 0; roundIndex < profile.rounds; roundIndex += 1) {
      const delayMs = schedulerSoakRoundDelayMs(
        roundIndex,
        profile.rounds,
        profile.durationSeconds * 1_000,
        performance.now() - soakStarted,
      );
      await waitForPerformanceTarget(
        performance.now() + delayMs,
        checkpointPoll,
      );
      const steady = Array.from(
        { length: profile.steadyOccurrencesPerRound },
        (_, occurrenceIndex) =>
          enqueueOccurrence(
            store,
            JOBS.steady,
            `${campaign}:${seed}:steady:${roundIndex}:${occurrenceIndex}`,
            {
              resultValue: `steady-${roundIndex}-${occurrenceIndex}`,
              executionDelayMs: profile.executionDelayMs,
            },
          ),
      );
      const currentIds = new Set(steady.map((occurrence) => occurrence.id));
      steadyOccurrenceIds.push(...currentIds);
      const contentionClaims = await Promise.all(
        longWorkers.map((worker) =>
          worker.waitFor(
            (event) =>
              event.type === "checkpoint" &&
              event.checkpoint === "before-execute" &&
              currentIds.has(event.occurrence?.id),
            timeoutMs,
            `steady contention round ${roundIndex + 1}`,
          ),
        ),
      );
      resumeSteadyCheckpoints();
      const settledSteady = await waitForOccurrences(store, [...currentIds], {
        timeoutMs,
        pollMs: profile.pollMs,
        onPoll: () => {
          resumeSteadyCheckpoints();
          checkpointPoll();
        },
      });
      const beforeExecute = await runBeforeExecuteCrashScenario(
        scenarioContext,
        roundIndex,
      );
      const afterExecute = await runAfterExecuteCrashScenario(
        scenarioContext,
        roundIndex,
      );
      const steadyEffects = readEffects(effectsDir).filter((effect) =>
        currentIds.has(effect.occurrenceId),
      );
      report.rounds.push({
        round: roundIndex + 1,
        steady: {
          occurrenceIds: [...currentIds],
          contentionClaims: contentionClaims.map((event) => ({
            workerId: event.workerId,
            owner: event.owner,
            occurrence: event.occurrence,
          })),
          statuses: settledSteady.map((occurrence) => occurrence.status),
          effectOwners: steadyEffects.map((effect) => effect.owner),
        },
        beforeExecute,
        afterExecute,
      });
      report.totals = {
        rounds: report.rounds.length,
        steadyOccurrences: steadyOccurrenceIds.length,
        hardKills: report.rounds.length * 2,
        effects: readEffects(effectsDir).length,
      };
      metricsTracker.sample();
      writeCheckpoint();
    }

    await waitForPerformanceTarget(
      soakStarted + profile.durationSeconds * 1_000,
      checkpointPoll,
    );
    resumeSteadyCheckpoints();
    await waitForOccurrences(store, steadyOccurrenceIds, {
      timeoutMs,
      pollMs: profile.pollMs,
      onPoll: () => {
        resumeSteadyCheckpoints();
        checkpointPoll();
      },
    });
    metricsTracker.sample();
    report.continuousDurationSeconds =
      (performance.now() - soakStarted) / 1_000;

    const steadyEffects = readEffects(effectsDir).filter((effect) =>
      steadyOccurrenceIds.includes(effect.occurrenceId),
    );
    const productiveOwners = new Set(
      steadyEffects.map((effect) => effect.owner),
    );
    const steadyOwners = new Set(longWorkers.map((worker) => worker.owner));
    const productiveWorkers = [...steadyOwners].filter((owner) =>
      productiveOwners.has(owner),
    ).length;
    const metricSummary = metricsTracker.summarize();
    report.metrics = {
      ...metricSummary,
      passed: metricSummary.passed && productiveWorkers === 2,
      rounds: profile.rounds,
      steadyStateOccurrences: steadyOccurrenceIds.length,
      productiveWorkers,
    };

    const cleanupStarted = performance.now();
    const cleanupProcesses = await Promise.all(
      longWorkers.map((worker) =>
        stopWorker(worker, profile.cleanupDeadlineMs),
      ),
    );
    const cleanupDurationMs = performance.now() - cleanupStarted;
    report.cleanup = {
      passed:
        cleanupDurationMs <= profile.cleanupDeadlineMs &&
        cleanupProcesses.every(
          (entry) =>
            entry.retired &&
            entry.graceful &&
            entry.code === 0 &&
            entry.signal === null,
        ),
      deadlineMs: profile.cleanupDeadlineMs,
      durationMs: cleanupDurationMs,
      processes: cleanupProcesses,
    };

    store.close();
    store = null;
    const verifiedStore = openSchedulerStore({ file: db });
    try {
      const quickCheck = verifiedStore.db.pragma("quick_check(1)", {
        simple: true,
      });
      const statusCounts = occurrenceStatusCounts(verifiedStore);
      const totalOccurrences = Object.values(statusCounts).reduce(
        (total, count) => total + count,
        0,
      );
      report.database = {
        ...verifiedStore.schemaInfo(),
        quickCheck,
        statusCounts,
        totalOccurrences,
      };
    } finally {
      verifiedStore.close();
    }

    const effects = readEffects(effectsDir);
    const expectedEffects = steadyOccurrenceIds.length + profile.rounds * 2 + 1;
    const expectedSucceeded = steadyOccurrenceIds.length + profile.rounds + 1;
    const statusCounts = report.database.statusCounts;
    const noBacklog =
      (statusCounts.queued || 0) === 0 &&
      (statusCounts.retry_wait || 0) === 0 &&
      (statusCounts.running || 0) === 0 &&
      (statusCounts.succeeded || 0) === expectedSucceeded &&
      (statusCounts.dead_letter || 0) === profile.rounds;
    const beforeEvidence = report.rounds.map((round) => round.beforeExecute);
    const afterEvidence = report.rounds.map((round) => round.afterExecute);
    report.totals = {
      rounds: report.rounds.length,
      steadyOccurrences: steadyOccurrenceIds.length,
      hardKills: report.rounds.length * 2,
      effects: effects.length,
    };
    report.invariants = {
      twoWorkerContention:
        productiveWorkers === 2 &&
        report.rounds.every(
          (round) =>
            new Set(round.steady.contentionClaims.map((claim) => claim.owner))
              .size === 2,
        ),
      beforeExecuteHigherFence: beforeEvidence.every(
        (entry) => entry.replacementClaim.fence > entry.firstClaim.fence,
      ),
      staleSettlementRejected: beforeEvidence.every(
        (entry) => entry.staleSettlement.rejected,
      ),
      afterExecuteDeadLettered: afterEvidence.every(
        (entry) =>
          entry.finalStatus === "dead_letter" &&
          entry.lastError?.code === "lease_expired",
      ),
      afterExecuteNoReplay:
        effects.length === expectedEffects &&
        afterEvidence.every(
          (entry) =>
            entry.effect.countBefore === 1 &&
            entry.effect.countAfter === 1 &&
            entry.effect.hashBefore === entry.effect.hashAfter,
        ),
      heartbeatRenewed:
        report.heartbeat.passed &&
        report.heartbeat.renewalEvents > 0 &&
        report.heartbeat.contenderClaimed === false,
      dstSemantics:
        report.temporal.passed &&
        report.temporal.fallBack.distinctFireKeys === true,
      backlogDrained: report.temporal.passed && noBacklog,
      databaseQuickCheck: report.database.quickCheck === "ok",
      allProcessesRetired:
        activeWorkers.size === 0 &&
        transientRetirements.every((entry) => entry.retired) &&
        report.cleanup.passed,
    };

    assertInvariant(
      report.continuousDurationSeconds >= profile.durationSeconds,
      "scheduler soak did not satisfy its continuous duration floor",
    );
    assertInvariant(
      report.metrics.passed,
      "scheduler soak resource bounds failed",
    );
    assertInvariant(
      Object.values(report.invariants).every(Boolean),
      `scheduler soak invariants failed: ${Object.entries(report.invariants)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
        .join(", ")}; cleanup=${JSON.stringify(report.cleanup)}`,
    );
    assertInvariant(
      report.database.totalOccurrences ===
        steadyOccurrenceIds.length + profile.rounds * 2 + 1,
      "scheduler soak occurrence accounting is incomplete",
    );

    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = null;
    const finalSource = await sourceProvider();
    const finalHeadSha = normalizeFullSha(
      finalSource?.headSha,
      "final HEAD commit",
    );
    const finalChanges = Array.isArray(finalSource?.changes)
      ? finalSource.changes
      : [];
    report.source.finalClean = finalChanges.length === 0;
    report.source.finalChangeCount = finalChanges.length;
    report.headSha = finalHeadSha;
    report.exactShaVerified =
      initialHeadSha === expectedSha && finalHeadSha === expectedSha;
    assertInvariant(
      report.exactShaVerified && report.source.finalClean,
      "scheduler soak source identity changed during execution",
      "SCHEDULER_SOAK_SOURCE_CHANGED",
    );

    report.status = "passed";
    report.completedAt = new Date().toISOString();
    report.violations = [];
    writeCheckpoint();
    validateSchedulerSoakEvidence(report, {
      releaseCommit: expectedSha,
      seed,
      campaign,
    });
    return report;
  } catch (error) {
    const emergencyWorkers = [...activeWorkers];
    for (const worker of emergencyWorkers) {
      try {
        const descendants = descendantPids(worker.pid);
        worker.child.kill("SIGKILL");
        requestDescendantKills(descendants);
      } catch {
        // Best-effort cleanup is followed by explicit failed evidence.
      }
    }
    await Promise.allSettled(
      emergencyWorkers.map((worker) =>
        withTimeout(
          worker.done,
          profile.cleanupDeadlineMs,
          "emergency worker cleanup",
        ),
      ),
    );
    try {
      store?.close();
    } catch {
      // Preserve the first failure.
    }
    store = null;
    if (temporaryRoot) {
      try {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        temporaryRoot = null;
      } catch {
        // The failed evidence remains authoritative for cleanup failures.
      }
    }
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    report.violations.push(safeError(error));
    try {
      writeCheckpoint();
    } catch (writeError) {
      error.evidenceWriteError = safeError(writeError);
    }
    error.evidence = report;
    throw error;
  }
}

function parseCoordinatorArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length)
        throw new TypeError(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--verify-evidence-dir") options.evidenceDir = next();
    else if (argument === "--release-commit") options.releaseCommit = next();
    else if (argument === "--seed") options.seed = next();
    else if (argument === "--campaign") options.campaign = next();
    else if (argument === "--output") options.output = next();
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new TypeError(`unknown scheduler soak option: ${argument}`);
  }
  return options;
}

function schedulerSoakUsage() {
  return [
    "Usage:",
    "  node packages/cli/scripts/scheduler-kernel-soak.mjs",
    "  node packages/cli/scripts/scheduler-kernel-soak.mjs --verify-evidence-dir DIR --release-commit SHA --seed N --campaign ID --output FILE",
    "",
    "Run mode reads CC_SCHEDULER_SOAK_* environment variables.",
  ].join("\n");
}

async function main() {
  try {
    const arguments_ = parseCoordinatorArguments(process.argv.slice(2));
    if (arguments_.help) {
      process.stdout.write(`${schedulerSoakUsage()}\n`);
      return;
    }
    if (arguments_.evidenceDir) {
      const aggregate = verifySchedulerSoakEvidenceSet({
        evidenceDir: arguments_.evidenceDir,
        releaseCommit: arguments_.releaseCommit,
        seed: arguments_.seed,
        campaign: arguments_.campaign,
        profile: resolveSchedulerSoakProfile(),
        output: arguments_.output,
      });
      process.stdout.write(
        `${JSON.stringify({ result: aggregate.result, output: arguments_.output })}\n`,
      );
      return;
    }
    const report = await runSchedulerKernelSoak({
      expectedSha: arguments_.releaseCommit,
      seed: arguments_.seed,
      campaign: arguments_.campaign,
      output: arguments_.output,
    });
    process.stdout.write(
      `${JSON.stringify({ status: report.status, output: arguments_.output || process.env.CC_SCHEDULER_SOAK_OUTPUT })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

const invokedAsMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) await main();
