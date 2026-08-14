#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  getAutomationExecutionIncident,
  listAutomationExecutionIncidents,
  resolveAutomationExecutionIncidentsForSucceededRun,
  upsertAutomationExecutionIncident,
} from "../src/lib/automation-execution-incident.js";
import { openSchedulerStore } from "../src/lib/scheduler-kernel/store.js";

export const SCHEDULER_RELIABILITY_SOAK_SCHEMA =
  "chainlesschain.scheduler-reliability-soak.v1";
export const SCHEDULER_RELIABILITY_SOAK_AGGREGATE_SCHEMA =
  "chainlesschain.scheduler-reliability-soak-aggregate.v1";
export const SCHEDULER_RELIABILITY_SOAK_SMOKE_AGGREGATE_SCHEMA =
  "chainlesschain.scheduler-reliability-soak-smoke-aggregate-non-qualifying.v1";

const FORMAL_MINIMUM_DURATION_SECONDS = 7_200;
const FORMAL_MINIMUM_CYCLES = 1_000;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const releaseCommitPattern = /^[0-9a-f]{40}$/u;
const expectedOperatingSystems = Object.freeze(["linux", "macos", "windows"]);

function positiveNumber(value, fallback, name, { integer = false } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
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

export function resolveSchedulerReliabilitySoakProfile(env = process.env) {
  const mode = String(env.CC_CLI_SCHEDULER_SOAK_MODE || "smoke").trim();
  if (!new Set(["smoke", "formal"]).has(mode)) {
    throw new Error("CC_CLI_SCHEDULER_SOAK_MODE must be smoke or formal");
  }
  const formal = mode === "formal";
  const floor = (value, minimum) => (formal ? Math.max(value, minimum) : value);
  return Object.freeze({
    mode,
    durationSeconds: floor(
      positiveNumber(
        env.CC_CLI_SCHEDULER_SOAK_DURATION_SECONDS,
        formal ? FORMAL_MINIMUM_DURATION_SECONDS : 5,
        "scheduler reliability soak duration seconds",
      ),
      formal ? FORMAL_MINIMUM_DURATION_SECONDS : 1,
    ),
    cycles: floor(
      positiveNumber(
        env.CC_CLI_SCHEDULER_SOAK_CYCLES,
        formal ? FORMAL_MINIMUM_CYCLES : 3,
        "scheduler reliability soak cycle count",
        { integer: true },
      ),
      formal ? FORMAL_MINIMUM_CYCLES : 1,
    ),
    checkpointIntervalSeconds: Math.min(
      60,
      positiveNumber(
        env.CC_CLI_SCHEDULER_SOAK_CHECKPOINT_INTERVAL_SECONDS,
        formal ? 30 : 1,
        "scheduler reliability soak checkpoint interval seconds",
        { integer: true },
      ),
    ),
  });
}

export function schedulerSoakCycleDelayMs(
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
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
}

function gitWorktreeChanges() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
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

function sha256Json(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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

function assertInvariant(condition, message) {
  if (!condition)
    throw new Error(`scheduler soak invariant failed: ${message}`);
}

function expectSchedulerCode(callback, code) {
  try {
    callback();
  } catch (error) {
    assertInvariant(
      error?.code === code,
      `expected ${code}, got ${error?.code}`,
    );
    return error;
  }
  throw new Error(`scheduler soak invariant failed: expected ${code}`);
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

function schedulerAuthority(index) {
  return {
    schemaVersion: 1,
    principal: { type: "soak", id: "scheduler-reliability-gate" },
    tenantId: null,
    workspaceId: "scheduler-reliability-soak",
    requestedCapabilities: ["scheduler.soak.execute"],
    authorizationRefs: {
      decisionId: `scheduler-soak-decision-${index}`,
      policyRevision: "scheduler-soak-policy-v1",
      grantIds: [],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

/**
 * Exercise a native SQLITE_FULL against the same durable scheduler database
 * used by the cycle loop. The returned evidence is intentionally restricted to
 * allowlisted machine fields: native messages, paths and causes never enter the
 * soak artifact.
 */
export function runSchedulerStorageFaultProbe({
  databaseFile,
  anchorJobId,
  logicalNow,
  DatabaseImplementation = Database,
}) {
  let store = null;
  const open = () =>
    openSchedulerStore({
      file: databaseFile,
      Database: DatabaseImplementation,
      clock: () => logicalNow,
      busyTimeoutMs: 5_000,
    });
  try {
    store = open();
    const before = store.db
      .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
      .get(anchorJobId);
    assertInvariant(Boolean(before), "storage fault anchor job exists");
    const pageCount = store.db.pragma("page_count", { simple: true });
    const originalMaxPageCount = store.db.pragma("max_page_count", {
      simple: true,
    });
    store.db.pragma(`max_page_count = ${pageCount}`);
    const error = expectSchedulerCode(
      () =>
        store._write(() => {
          store.db
            .prepare(
              "UPDATE jobs SET revision = revision + 1, updated_at = ? WHERE job_id = ?",
            )
            .run(logicalNow + 1, anchorJobId);
          store.db
            .prepare(
              `INSERT INTO events
                 (job_id, occurrence_id, event_type, occurred_at,
                  owner_id, fence, data_json)
               VALUES (?, NULL, ?, ?, NULL, NULL, ?)`,
            )
            .run(
              anchorJobId,
              "scheduler_soak_storage_pressure",
              logicalNow + 1,
              JSON.stringify({ payload: "x".repeat(1024 * 1024) }),
            );
        }),
      "SCHEDULER_STORAGE_UNAVAILABLE",
    );
    const sanitizedDetails = {
      phase: "write",
      storageCode: "SQLITE_FULL",
      commitState: "not_committed",
      retryable: false,
    };
    assertInvariant(
      JSON.stringify(error.details) === JSON.stringify(sanitizedDetails),
      "SQLITE_FULL is reported with exact sanitized commit state",
    );
    assertInvariant(error.cause === undefined, "storage cause is not exposed");
    assertInvariant(
      !JSON.stringify({
        code: error.code,
        message: error.message,
        details: error.details,
      }).includes(path.resolve(databaseFile)),
      "storage error does not expose the database path",
    );
    assertInvariant(
      JSON.stringify(
        store.db
          .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
          .get(anchorJobId),
      ) === JSON.stringify(before),
      "SQLITE_FULL rolls back the earlier job update",
    );
    assertInvariant(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = ?")
        .get("scheduler_soak_storage_pressure").count === 0,
      "SQLITE_FULL rolls back the event insert",
    );
    assertInvariant(
      store.db.pragma("quick_check", { simple: true }) === "ok",
      "storage fault quick_check succeeds",
    );
    store.db.pragma(`max_page_count = ${originalMaxPageCount}`);
    store.close();
    store = open();
    assertInvariant(
      store.db.pragma("quick_check", { simple: true }) === "ok",
      "storage fault database reopens cleanly",
    );
    assertInvariant(
      JSON.stringify(
        store.db
          .prepare("SELECT revision, updated_at FROM jobs WHERE job_id = ?")
          .get(anchorJobId),
      ) === JSON.stringify(before),
      "rolled-back scheduler state survives reopen",
    );
    assertInvariant(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = ?")
        .get("scheduler_soak_storage_pressure").count === 0,
      "rolled-back event remains absent after reopen",
    );
    return Object.freeze({
      storageCode: "SQLITE_FULL",
      commitState: "not_committed",
      rollbackVerified: true,
      quickCheckVerified: true,
      reopenVerified: true,
      sanitizedErrorVerified: true,
    });
  } finally {
    try {
      store?.close();
    } catch {
      // Preserve the authoritative probe failure.
    }
  }
}

export function runAutomationIncidentLifecycleProbe({
  databaseFile,
  logicalNow,
  DatabaseImplementation = Database,
}) {
  let db = null;
  const open = () => new DatabaseImplementation(databaseFile);
  const runId = "scheduler-soak-automation-run";
  const input = {
    runId,
    flowId: "scheduler-soak-flow",
    occurrenceId: "scheduler-soak-occurrence",
    triggerType: "schedule",
    triggerId: "scheduler-soak-trigger",
    category: "permission",
    code: "AUTOMATION_PERMISSION_DENIED",
    authorityDigest: sha256Hex("scheduler-soak-authority"),
    boundary: {
      deniedPermissions: ["automation:execute"],
      policyRevision: "scheduler-soak-policy-v1",
      evidenceDigests: [sha256Hex("scheduler-soak-decision")],
    },
    details: {
      actionId: "scheduler-soak-action",
      actionIndex: 0,
      reasonCode: "PERMISSION_DENIED",
      retryable: false,
    },
  };
  try {
    db = open();
    const created = upsertAutomationExecutionIncident(db, input, {
      now: () => logicalNow,
    });
    assertInvariant(created.deduplicated === false, "incident is created");
    const replay = upsertAutomationExecutionIncident(
      db,
      {
        ...input,
        boundary: {
          evidenceDigests: [...input.boundary.evidenceDigests],
          policyRevision: input.boundary.policyRevision,
          deniedPermissions: [...input.boundary.deniedPermissions],
        },
        details: {
          retryable: false,
          reasonCode: "PERMISSION_DENIED",
          actionIndex: 0,
          actionId: "scheduler-soak-action",
        },
      },
      { now: () => logicalNow + 1 },
    );
    assertInvariant(
      replay.deduplicated === true && replay.incidentId === created.incidentId,
      "same incident evidence deduplicates",
    );
    const changed = upsertAutomationExecutionIncident(
      db,
      {
        ...input,
        details: { ...input.details, actionIndex: 1 },
      },
      { now: () => logicalNow + 2 },
    );
    assertInvariant(
      changed.deduplicated === false &&
        changed.incidentId !== created.incidentId,
      "changed evidence creates a distinct observation",
    );
    assertInvariant(
      listAutomationExecutionIncidents(db, { runId }).length === 2,
      "incident observations are both visible",
    );
    assertInvariant(
      db.pragma("quick_check", { simple: true }) === "ok",
      "incident database quick_check succeeds",
    );
    db.close();
    db = open();
    assertInvariant(
      getAutomationExecutionIncident(db, created.incidentId)?.status ===
        "open" &&
        getAutomationExecutionIncident(db, changed.incidentId)?.status ===
          "open",
      "incident observations survive reopen",
    );
    const resolution = resolveAutomationExecutionIncidentsForSucceededRun(
      db,
      runId,
      { now: () => logicalNow + 3 },
    );
    assertInvariant(
      resolution.resolvedCount === 2 &&
        resolution.resolutionCode === "EXECUTION_SUCCEEDED",
      "successful run resolves every open observation",
    );
    db.close();
    db = open();
    const persisted = listAutomationExecutionIncidents(db, { runId });
    assertInvariant(
      persisted.length === 2 &&
        persisted.every(
          (incident) =>
            incident.status === "resolved" &&
            incident.revision === 2 &&
            incident.resolutionCode === "EXECUTION_SUCCEEDED",
        ),
      "incident resolutions survive reopen",
    );
    assertInvariant(
      db.pragma("quick_check", { simple: true }) === "ok",
      "resolved incident database quick_check succeeds",
    );
    return Object.freeze({
      created: true,
      sameEvidenceDeduplicated: true,
      changedEvidenceObserved: true,
      observationCount: 2,
      persistenceVerified: true,
      resolvedCount: 2,
      resolutionCode: "EXECUTION_SUCCEEDED",
      resolutionPersisted: true,
      quickChecks: 2,
    });
  } finally {
    try {
      db?.close();
    } catch {
      // Preserve the authoritative probe failure.
    }
  }
}

export function runSchedulerReliabilityRunProbes({
  schedulerDatabaseFile,
  incidentDatabaseFile,
  anchorJobId,
  logicalNow,
  DatabaseImplementation = Database,
}) {
  return Object.freeze({
    storageFault: runSchedulerStorageFaultProbe({
      databaseFile: schedulerDatabaseFile,
      anchorJobId,
      logicalNow,
      DatabaseImplementation,
    }),
    automationIncident: runAutomationIncidentLifecycleProbe({
      databaseFile: incidentDatabaseFile,
      logicalNow,
      DatabaseImplementation,
    }),
  });
}

function expectedHistoryTypes() {
  return [
    "occurrence_succeeded",
    "occurrence_claimed",
    "occurrence_retry_scheduled",
    "occurrence_renewed",
    "occurrence_claimed",
    "occurrence_enqueued",
  ];
}

/**
 * Execute one complete scheduler durability cycle against a real SQLite file.
 * The controlled clock makes lease and retry boundaries deterministic while
 * close/reopen operations exercise the actual on-disk recovery path.
 */
export function runSchedulerReliabilityCycle({
  databaseFile,
  index,
  logicalNow,
  DatabaseImplementation = Database,
}) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(
      "scheduler soak cycle index must be a non-negative integer",
    );
  }
  if (!Number.isSafeInteger(logicalNow) || logicalNow < 0) {
    throw new Error(
      "scheduler soak logicalNow must be a non-negative epoch ms",
    );
  }
  const cycleId = String(index).padStart(8, "0");
  const jobId = `scheduler-soak-${cycleId}`;
  const ownerA = `scheduler-soak-owner-a-${cycleId}`;
  const ownerB = `scheduler-soak-owner-b-${cycleId}`;
  const triggerKey = `scheduler-soak:cycle:${cycleId}`;
  const scheduledFor = logicalNow;
  let now = logicalNow;
  let store = null;
  let contender = null;
  const open = () =>
    openSchedulerStore({
      file: databaseFile,
      Database: DatabaseImplementation,
      clock: () => now,
      busyTimeoutMs: 5_000,
    });
  try {
    store = open();
    store.createJob({
      id: jobId,
      kind: "scheduler.reliability-soak",
      trigger: { adapter: "soak", cycle: index },
      payload: { cycle: index, operation: "durability-probe" },
      authority: schedulerAuthority(index),
      maxAttempts: 3,
    });
    const occurrence = store.enqueueOccurrence({
      jobId,
      scheduledFor,
      triggerKey,
    });
    const duplicateBeforeClaim = store.enqueueOccurrence({
      jobId,
      scheduledFor,
      triggerKey,
    });
    assertInvariant(
      occurrence.deduplicated === false,
      "first enqueue inserted",
    );
    assertInvariant(
      duplicateBeforeClaim.deduplicated === true &&
        duplicateBeforeClaim.id === occurrence.id,
      "pre-claim enqueue deduplicated",
    );

    const firstClaim = store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: ownerA,
      leaseMs: 1_000,
    });
    assertInvariant(firstClaim?.status === "running", "first claim is running");
    assertInvariant(firstClaim.attempt === 1, "first claim attempt is one");

    contender = open();
    assertInvariant(
      contender.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: ownerB,
        leaseMs: 1_000,
      }) === null,
      "live lease rejects a contender",
    );
    expectSchedulerCode(
      () =>
        contender.renew({
          occurrenceId: occurrence.id,
          ownerId: ownerB,
          fence: firstClaim.fence,
          leaseMs: 1_000,
        }),
      "SCHEDULER_LEASE_LOST",
    );
    contender.close();
    contender = null;

    const originalLeaseExpiry = firstClaim.leaseExpiresAt;
    now += 100;
    const renewed = store.renew({
      occurrenceId: occurrence.id,
      ownerId: ownerA,
      fence: firstClaim.fence,
      leaseMs: 1_000,
    });
    assertInvariant(
      renewed.leaseExpiresAt > originalLeaseExpiry,
      "lease renewal extends expiry",
    );

    const retryAt = now + 50;
    const retry = store.settle({
      occurrenceId: occurrence.id,
      ownerId: ownerA,
      fence: firstClaim.fence,
      outcome: "failed",
      retryable: true,
      retryAt,
      error: { code: "SCHEDULER_SOAK_RETRY", retryable: true },
    });
    assertInvariant(retry.status === "retry_wait", "failure schedules retry");
    assertInvariant(retry.attempt === 1, "retry retains first attempt");
    assertInvariant(
      store.db.pragma("quick_check", { simple: true }) === "ok",
      "pre-restart quick_check",
    );
    store.close();
    store = null;

    store = open();
    const persistedRetry = store.getOccurrence(occurrence.id);
    assertInvariant(
      persistedRetry?.status === "retry_wait",
      "retry survives restart",
    );
    assertInvariant(
      persistedRetry.availableAt === retryAt,
      "retry deadline survives restart",
    );
    const duplicateAfterRetryRestart = store.enqueueOccurrence({
      jobId,
      scheduledFor,
      triggerKey,
    });
    assertInvariant(
      duplicateAfterRetryRestart.deduplicated === true &&
        duplicateAfterRetryRestart.id === occurrence.id,
      "retry restart preserves idempotency",
    );
    assertInvariant(
      store.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: ownerB,
        leaseMs: 1_000,
      }) === null,
      "retry is unavailable before retryAt",
    );
    now = retryAt;
    const secondClaim = store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: ownerB,
      leaseMs: 1_000,
    });
    assertInvariant(
      secondClaim?.status === "running",
      "retry claim is running",
    );
    assertInvariant(secondClaim.attempt === 2, "retry consumes second attempt");
    assertInvariant(
      secondClaim.fence === firstClaim.fence + 1,
      "retry advances fencing token",
    );
    const succeeded = store.settle({
      occurrenceId: occurrence.id,
      ownerId: ownerB,
      fence: secondClaim.fence,
      outcome: "succeeded",
      result: { cycle: index, applied: true },
    });
    assertInvariant(succeeded.status === "succeeded", "retry succeeds");
    assertInvariant(
      store.db.pragma("quick_check", { simple: true }) === "ok",
      "post-retry quick_check",
    );
    store.close();
    store = null;

    store = open();
    const persistedSuccess = store.getOccurrence(occurrence.id);
    assertInvariant(
      persistedSuccess?.status === "succeeded",
      "success survives restart",
    );
    assertInvariant(
      persistedSuccess.result?.cycle === index &&
        persistedSuccess.result?.applied === true,
      "success result survives restart",
    );
    const duplicateAfterSuccessRestart = store.enqueueOccurrence({
      jobId,
      scheduledFor,
      triggerKey,
    });
    assertInvariant(
      duplicateAfterSuccessRestart.deduplicated === true &&
        duplicateAfterSuccessRestart.id === occurrence.id,
      "terminal restart preserves idempotency",
    );
    assertInvariant(
      store.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: ownerA,
        leaseMs: 1_000,
      }) === null,
      "terminal occurrence cannot execute twice",
    );

    const pauseJobId = `${jobId}-pause`;
    store.createJob({
      id: pauseJobId,
      kind: "scheduler.reliability-soak",
      trigger: { adapter: "soak", cycle: index, probe: "pause" },
      payload: { cycle: index, operation: "pause-checkpoint-resume" },
      authority: schedulerAuthority(index),
      maxAttempts: 2,
    });
    const pauseOccurrence = store.enqueueOccurrence({
      jobId: pauseJobId,
      scheduledFor,
      triggerKey: `${triggerKey}:pause`,
    });
    const pauseClaim = store.claimOccurrence({
      occurrenceId: pauseOccurrence.id,
      ownerId: `${ownerA}-pause`,
      leaseMs: 1_000,
    });
    const runtimeControlCapability = {
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["adapter_checkpoint"],
    };
    const pauseRequest = store.requestOccurrencePause({
      occurrenceId: pauseOccurrence.id,
      expectedFence: pauseClaim.fence,
      expectedRevision: 0,
      requestId: `scheduler-soak-pause-${cycleId}`,
      capability: runtimeControlCapability,
    });
    const paused = store.ackOccurrencePause({
      occurrenceId: pauseOccurrence.id,
      ownerId: `${ownerA}-pause`,
      fence: pauseClaim.fence,
      requestId: pauseRequest.pauseRequestId,
      expectedRevision: pauseRequest.revision,
      safePoint: "adapter_checkpoint",
      checkpoint: { cycle: index, cursor: 1 },
    });
    assertInvariant(paused.control.state === "paused", "pause is durable");
    assertInvariant(
      paused.control.checkpoint?.data?.cycle === index,
      "checkpoint data is recorded",
    );
    assertInvariant(
      store.claimOccurrence({
        occurrenceId: pauseOccurrence.id,
        ownerId: `${ownerB}-paused-contender`,
        leaseMs: 1_000,
      }) === null,
      "paused occurrence cannot be claimed",
    );
    store.close();
    store = open();
    const persistedPause = store.getOccurrenceControl(pauseOccurrence.id);
    assertInvariant(
      persistedPause?.state === "paused" &&
        persistedPause.checkpoint?.data?.cycle === index,
      "paused checkpoint survives restart",
    );
    const resumed = store.resumeOccurrence({
      occurrenceId: pauseOccurrence.id,
      expectedRevision: persistedPause.revision,
      requestId: `scheduler-soak-resume-${cycleId}`,
    });
    assertInvariant(resumed.control.state === "resumed", "pause resumes");
    const resumedClaim = store.claimOccurrence({
      occurrenceId: pauseOccurrence.id,
      ownerId: `${ownerB}-resumed`,
      leaseMs: 1_000,
    });
    assertInvariant(
      resumedClaim?.fence === pauseClaim.fence + 1,
      "resume advances the claim fence",
    );
    const resumedSuccess = store.settle({
      occurrenceId: pauseOccurrence.id,
      ownerId: `${ownerB}-resumed`,
      fence: resumedClaim.fence,
      outcome: "succeeded",
      result: { cycle: index, resumed: true },
    });
    assertInvariant(
      resumedSuccess.status === "succeeded",
      "resumed occurrence succeeds",
    );

    const deadLetterJobId = `${jobId}-dead-letter`;
    store.createJob({
      id: deadLetterJobId,
      kind: "scheduler.reliability-soak",
      trigger: { adapter: "soak", cycle: index, probe: "dead-letter" },
      payload: { cycle: index, operation: "dead-letter-requeue" },
      authority: schedulerAuthority(index),
      maxAttempts: 1,
    });
    const deadLetterOccurrence = store.enqueueOccurrence({
      jobId: deadLetterJobId,
      scheduledFor,
      triggerKey: `${triggerKey}:dead-letter`,
    });
    const failingClaim = store.claimOccurrence({
      occurrenceId: deadLetterOccurrence.id,
      ownerId: `${ownerA}-dead-letter`,
      leaseMs: 1_000,
    });
    const deadLetter = store.settle({
      occurrenceId: deadLetterOccurrence.id,
      ownerId: `${ownerA}-dead-letter`,
      fence: failingClaim.fence,
      outcome: "failed",
      retryable: false,
      error: { code: "SCHEDULER_SOAK_DEAD_LETTER" },
    });
    assertInvariant(
      deadLetter.status === "dead_letter",
      "probe reaches dead letter",
    );
    const requeued = store.requeueDeadLetter({
      occurrenceId: deadLetterOccurrence.id,
      expectedFence: deadLetter.fence,
      expectedErrorCode: "SCHEDULER_SOAK_DEAD_LETTER",
      requestId: `scheduler-soak-requeue-${cycleId}`,
    });
    assertInvariant(
      requeued.occurrence.status === "retry_wait",
      "dead letter is requeued",
    );
    const requeuedClaim = store.claimOccurrence({
      occurrenceId: deadLetterOccurrence.id,
      ownerId: `${ownerB}-requeue`,
      leaseMs: 1_000,
    });
    assertInvariant(
      requeuedClaim?.attempt === failingClaim.attempt &&
        requeuedClaim.fence === failingClaim.fence + 1,
      "requeue preserves attempt and advances fence",
    );
    const requeuedSuccess = store.settle({
      occurrenceId: deadLetterOccurrence.id,
      ownerId: `${ownerB}-requeue`,
      fence: requeuedClaim.fence,
      outcome: "succeeded",
      result: { cycle: index, requeued: true },
    });
    assertInvariant(
      requeuedSuccess.status === "succeeded",
      "requeued dead letter succeeds",
    );
    const history = store.history({ occurrenceId: occurrence.id, limit: 20 });
    const historyTypes = history.map((event) => event.type);
    assertInvariant(
      JSON.stringify(historyTypes) === JSON.stringify(expectedHistoryTypes()),
      "durable history is complete and ordered",
    );
    const occurrenceRowCount = store.db
      .prepare("SELECT COUNT(*) AS count FROM occurrences WHERE job_id = ?")
      .get(jobId).count;
    assertInvariant(
      occurrenceRowCount === 1,
      "one logical trigger has one occurrence",
    );
    assertInvariant(
      store.db.pragma("quick_check", { simple: true }) === "ok",
      "final quick_check",
    );

    return Object.freeze({
      index,
      jobId,
      occurrenceId: occurrence.id,
      deduplicatedEnqueues: 3,
      contentionRejected: true,
      staleLeaseRejected: true,
      leaseRenewed: true,
      retryPersisted: true,
      retryDueEnforced: true,
      pauseRequested: true,
      checkpointPersisted: true,
      pausedClaimRejected: true,
      resumed: true,
      deadLettered: true,
      deadLetterRequeued: true,
      restartPersistenceChecks: 3,
      finalStatus: persistedSuccess.status,
      finalAttempt: persistedSuccess.attempt,
      finalFence: persistedSuccess.fence,
      occurrenceRowCount,
      eventCount: history.length,
      historyDigest: sha256Json(historyTypes),
      quickChecks: 3,
    });
  } finally {
    try {
      contender?.close();
    } catch {
      // Preserve the authoritative probe failure.
    }
    try {
      store?.close();
    } catch {
      // Preserve the authoritative probe failure.
    }
  }
}

function expectedTotals(cycles, { runProbes = false } = {}) {
  return Object.freeze({
    cycles,
    jobsCreated: cycles * 3,
    occurrencesCreated: cycles * 3,
    deduplicatedEnqueues: cycles * 3,
    claims: cycles * 6,
    contentionRejections: cycles,
    staleLeaseRejections: cycles,
    leaseRenewals: cycles,
    retriesScheduled: cycles,
    pauseRequests: cycles,
    checkpointsPersisted: cycles,
    pausedClaimRejections: cycles,
    resumes: cycles,
    deadLetters: cycles,
    deadLetterRequeues: cycles,
    restartPersistenceChecks: cycles * 3,
    successfulSettlements: cycles * 3,
    databaseQuickChecks: cycles * 3,
    storageFaultProbes: runProbes ? 1 : 0,
    incidentLifecycleProbes: runProbes ? 1 : 0,
    incidentObservations: runProbes ? 2 : 0,
    incidentResolutions: runProbes ? 2 : 0,
    duplicateExecutions: 0,
    invariantViolations: 0,
  });
}

function validateRunProbeEvidence(probes) {
  const issues = [];
  const hasExactFields = (value, fields) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...fields].sort());
  if (!hasExactFields(probes, ["automationIncident", "storageFault"])) {
    issues.push("run probe fields");
  }
  const storageFault = probes?.storageFault;
  if (
    !hasExactFields(storageFault, [
      "commitState",
      "quickCheckVerified",
      "reopenVerified",
      "rollbackVerified",
      "sanitizedErrorVerified",
      "storageCode",
    ])
  ) {
    issues.push("storage fault fields");
  }
  if (storageFault?.storageCode !== "SQLITE_FULL") {
    issues.push("storage fault code");
  }
  if (storageFault?.commitState !== "not_committed") {
    issues.push("storage fault commit state");
  }
  if (storageFault?.rollbackVerified !== true) {
    issues.push("storage fault rollback");
  }
  if (storageFault?.quickCheckVerified !== true) {
    issues.push("storage fault quick_check");
  }
  if (storageFault?.reopenVerified !== true) {
    issues.push("storage fault reopen");
  }
  if (storageFault?.sanitizedErrorVerified !== true) {
    issues.push("storage fault sanitization");
  }
  const incident = probes?.automationIncident;
  if (
    !hasExactFields(incident, [
      "changedEvidenceObserved",
      "created",
      "observationCount",
      "persistenceVerified",
      "quickChecks",
      "resolutionCode",
      "resolutionPersisted",
      "resolvedCount",
      "sameEvidenceDeduplicated",
    ])
  ) {
    issues.push("incident fields");
  }
  if (incident?.created !== true) issues.push("incident creation");
  if (incident?.sameEvidenceDeduplicated !== true) {
    issues.push("incident deduplication");
  }
  if (incident?.changedEvidenceObserved !== true) {
    issues.push("incident changed observation");
  }
  if (incident?.observationCount !== 2) {
    issues.push("incident observation count");
  }
  if (incident?.persistenceVerified !== true) {
    issues.push("incident persistence");
  }
  if (
    incident?.resolvedCount !== 2 ||
    incident?.resolutionCode !== "EXECUTION_SUCCEEDED"
  ) {
    issues.push("incident resolution");
  }
  if (incident?.resolutionPersisted !== true) {
    issues.push("incident resolution persistence");
  }
  if (incident?.quickChecks !== 2) issues.push("incident quick_check");
  if (issues.length > 0) {
    throw new Error(
      `invalid scheduler reliability run probes: ${issues.join(", ")}`,
    );
  }
}

function validateCycleEvidence(cycle, index) {
  const issues = [];
  if (cycle?.index !== index) issues.push("sequence");
  if (cycle?.jobId !== `scheduler-soak-${String(index).padStart(8, "0")}`) {
    issues.push("job identity");
  }
  if (!/^occ_[0-9a-f]{64}$/u.test(cycle?.occurrenceId || "")) {
    issues.push("occurrence identity");
  }
  if (cycle?.deduplicatedEnqueues !== 3) issues.push("deduplication");
  if (cycle?.contentionRejected !== true) issues.push("contention");
  if (cycle?.staleLeaseRejected !== true) issues.push("stale lease");
  if (cycle?.leaseRenewed !== true) issues.push("lease renewal");
  if (cycle?.retryPersisted !== true) issues.push("retry persistence");
  if (cycle?.retryDueEnforced !== true) issues.push("retry deadline");
  if (cycle?.pauseRequested !== true) issues.push("pause request");
  if (cycle?.checkpointPersisted !== true)
    issues.push("checkpoint persistence");
  if (cycle?.pausedClaimRejected !== true)
    issues.push("paused claim rejection");
  if (cycle?.resumed !== true) issues.push("resume");
  if (cycle?.deadLettered !== true) issues.push("dead letter");
  if (cycle?.deadLetterRequeued !== true) issues.push("dead-letter requeue");
  if (cycle?.restartPersistenceChecks !== 3) issues.push("restart persistence");
  if (cycle?.finalStatus !== "succeeded") issues.push("settlement");
  if (cycle?.finalAttempt !== 2 || cycle?.finalFence !== 2) {
    issues.push("attempt or fence");
  }
  if (cycle?.occurrenceRowCount !== 1) issues.push("occurrence count");
  if (cycle?.eventCount !== 6) issues.push("history count");
  if (!/^sha256:[0-9a-f]{64}$/u.test(cycle?.historyDigest || "")) {
    issues.push("history digest");
  }
  if (cycle?.quickChecks !== 3) issues.push("database checks");
  if (issues.length > 0) {
    throw new Error(
      `invalid scheduler reliability cycle ${index}: ${issues.join(", ")}`,
    );
  }
}

function validateSoakEvidence(value, { releaseCommit, allowSmoke }) {
  const issues = [];
  const profile = value?.profile;
  const operatingSystem = value?.runner?.operatingSystem;
  if (value?.schema !== SCHEDULER_RELIABILITY_SOAK_SCHEMA)
    issues.push("schema");
  if (value?.status !== "passed") issues.push("status");
  if (value?.releaseCommit !== releaseCommit) issues.push("release commit");
  if (value?.headSha !== releaseCommit) issues.push("HEAD");
  if (value?.expectedSha !== releaseCommit) issues.push("expected SHA");
  if (value?.exactShaVerified !== true) issues.push("exact SHA verification");
  if (
    (profile?.mode === "formal" && value?.qualifyingEvidence !== true) ||
    (profile?.mode === "smoke" && value?.qualifyingEvidence !== false)
  ) {
    issues.push("qualifying evidence");
  }
  if (value?.developmentOverride === true) issues.push("development override");
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
  const profileModeValid =
    profile?.mode === "formal" || (allowSmoke && profile?.mode === "smoke");
  const minimumDuration =
    profile?.mode === "formal" ? FORMAL_MINIMUM_DURATION_SECONDS : 1;
  const minimumCycles = profile?.mode === "formal" ? FORMAL_MINIMUM_CYCLES : 1;
  if (
    !profileModeValid ||
    !Number.isFinite(profile?.durationSeconds) ||
    profile.durationSeconds < minimumDuration ||
    !Number.isInteger(profile?.cycles) ||
    profile.cycles < minimumCycles
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
      try {
        validateCycleEvidence(value.cycles[index], index);
      } catch (error) {
        issues.push(error.message);
      }
    }
  }
  try {
    validateRunProbeEvidence(value?.runProbes);
  } catch (error) {
    issues.push(error.message);
  }
  const totals = expectedTotals(profile?.cycles || 0, { runProbes: true });
  if (JSON.stringify(value?.totals) !== JSON.stringify(totals)) {
    issues.push("totals");
  }
  if (value?.violations?.length !== 0) issues.push("violations");
  if (issues.length > 0) {
    throw new Error(
      `invalid scheduler reliability soak evidence: ${issues.join(", ")}`,
    );
  }
  return value;
}

export async function runSchedulerReliabilitySoak(options = {}) {
  const env = options.env || process.env;
  const profile =
    options.profile || resolveSchedulerReliabilitySoakProfile(env);
  const allowDirtySmoke =
    options.allowDirtySmoke === true ||
    env.CC_CLI_SCHEDULER_SOAK_ALLOW_DIRTY_SMOKE === "1";
  if (allowDirtySmoke && profile.mode !== "smoke") {
    throw new Error(
      "dirty-source override is available only for non-qualifying smoke runs",
    );
  }
  const headSha = gitHead();
  const worktreeChanges = gitWorktreeChanges();
  const expectedShaCandidate =
    options.releaseCommit || env.CC_CLI_SCHEDULER_SOAK_EXPECTED_SHA || "";
  const expectedSha = expectedShaCandidate
    ? normalizeReleaseCommit(expectedShaCandidate)
    : null;
  const output =
    options.output ||
    env.CC_CLI_SCHEDULER_SOAK_OUTPUT ||
    path.join(
      os.tmpdir(),
      `scheduler-reliability-soak-${process.platform}.json`,
    );
  const ownsWorkingDirectory = !options.workingDirectory;
  const workingDirectory = options.workingDirectory
    ? path.resolve(options.workingDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), "cc-scheduler-soak-"));
  fs.mkdirSync(workingDirectory, { recursive: true });
  const databaseFile = path.join(workingDirectory, "scheduler.db");
  const incidentDatabaseFile = path.join(
    workingDirectory,
    "automation-incidents.db",
  );
  const started = performance.now();
  const report = {
    schema: SCHEDULER_RELIABILITY_SOAK_SCHEMA,
    status: "running",
    startedAt: new Date().toISOString(),
    releaseCommit: headSha,
    headSha,
    expectedSha,
    exactShaVerified:
      Boolean(expectedSha) &&
      expectedSha === headSha &&
      worktreeChanges.length === 0,
    qualifyingEvidence: false,
    developmentOverride: allowDirtySmoke,
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
    runProbes: null,
    totals: expectedTotals(0),
    violations: [],
  };
  const checkpoint = () => {
    report.checkpointedAt = new Date().toISOString();
    report.continuousDurationSeconds = (performance.now() - started) / 1_000;
    atomicWriteJson(output, report);
  };
  checkpoint();
  try {
    if (!expectedSha)
      throw new Error("an exact expected release SHA is required");
    if (expectedSha !== headSha) {
      throw new Error(
        `exact SHA mismatch: expected ${expectedSha}, got ${headSha}`,
      );
    }
    if (worktreeChanges.length > 0 && !allowDirtySmoke) {
      throw new Error(
        `exact SHA source verification refused ${worktreeChanges.length} worktree change(s)`,
      );
    }
    const logicalEpoch = Date.now();
    for (let index = 0; index < profile.cycles; index += 1) {
      const delayMs = schedulerSoakCycleDelayMs(
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
      report.cycles.push(
        runSchedulerReliabilityCycle({
          databaseFile,
          index,
          logicalNow: logicalEpoch + index * 10_000,
          DatabaseImplementation: options.DatabaseImplementation || Database,
        }),
      );
      report.totals = expectedTotals(report.cycles.length);
      checkpoint();
    }
    report.runProbes = runSchedulerReliabilityRunProbes({
      schedulerDatabaseFile: databaseFile,
      incidentDatabaseFile,
      anchorJobId: "scheduler-soak-00000000",
      logicalNow: logicalEpoch + profile.cycles * 10_000,
      DatabaseImplementation: options.DatabaseImplementation || Database,
    });
    report.totals = expectedTotals(report.cycles.length, { runProbes: true });
    checkpoint();
    const remainingDurationMs =
      profile.durationSeconds * 1_000 - (performance.now() - started);
    if (remainingDurationMs > 0) {
      await waitWithCheckpoints(
        remainingDurationMs,
        profile.checkpointIntervalSeconds * 1_000,
        checkpoint,
      );
    }
    const finalHeadSha = gitHead();
    const finalWorktreeChanges = gitWorktreeChanges();
    report.source.finalClean = finalWorktreeChanges.length === 0;
    report.source.finalChangeCount = finalWorktreeChanges.length;
    report.exactShaVerified =
      expectedSha === headSha &&
      finalHeadSha === headSha &&
      worktreeChanges.length === 0 &&
      finalWorktreeChanges.length === 0;
    if (finalHeadSha !== headSha) {
      throw new Error(`HEAD changed during scheduler soak: ${finalHeadSha}`);
    }
    if (finalWorktreeChanges.length > 0 && !allowDirtySmoke) {
      throw new Error(
        `source changed during scheduler soak: ${finalWorktreeChanges.length} worktree change(s)`,
      );
    }
    report.qualifyingEvidence =
      profile.mode === "formal" && report.exactShaVerified;
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.violations.push(safeError(error));
  } finally {
    report.finishedAt = new Date().toISOString();
    report.continuousDurationSeconds = (performance.now() - started) / 1_000;
    if (ownsWorkingDirectory) {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
    atomicWriteJson(output, report);
  }
  if (report.status !== "passed") {
    throw Object.assign(
      new Error(
        report.violations[0]?.message || "scheduler reliability soak failed",
      ),
      { evidence: report },
    );
  }
  return report;
}

export function verifySchedulerReliabilitySoakEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const allowSmoke = options.allowSmoke === true;
  const evidenceDirectory = path.resolve(options.evidenceDir || "");
  const entries = fs
    .readdirSync(evidenceDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      path: path.join(evidenceDirectory, name),
      value: readJson(path.join(evidenceDirectory, name)),
    }))
    .filter(
      (entry) => entry.value?.schema === SCHEDULER_RELIABILITY_SOAK_SCHEMA,
    );
  const actualOperatingSystems = entries
    .map((entry) => entry.value?.runner?.operatingSystem)
    .sort();
  if (
    JSON.stringify(actualOperatingSystems) !==
    JSON.stringify(expectedOperatingSystems)
  ) {
    throw new Error(
      `scheduler reliability soak evidence must contain exactly linux, macos, windows; found ${actualOperatingSystems.join(", ")}`,
    );
  }
  for (const entry of entries)
    validateSoakEvidence(entry.value, { releaseCommit, allowSmoke });
  const profileJson = JSON.stringify(entries[0].value.profile);
  if (
    entries.some((entry) => JSON.stringify(entry.value.profile) !== profileJson)
  ) {
    throw new Error(
      "scheduler reliability soak profiles differ across operating systems",
    );
  }
  const profile = entries[0].value.profile;
  const smoke = profile.mode === "smoke";
  if (smoke && !allowSmoke) {
    throw new Error(
      "scheduler reliability aggregate requires formal evidence; pass --allow-smoke only for a non-qualifying PR aggregate",
    );
  }
  const aggregateTotals = entries.reduce((totals, entry) => {
    for (const [key, value] of Object.entries(entry.value.totals)) {
      totals[key] = (totals[key] || 0) + value;
    }
    return totals;
  }, {});
  const aggregate = {
    schema: smoke
      ? SCHEDULER_RELIABILITY_SOAK_SMOKE_AGGREGATE_SCHEMA
      : SCHEDULER_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
    name: smoke
      ? "scheduler-reliability-smoke-aggregate-non-qualifying"
      : "scheduler-reliability-formal-aggregate",
    releaseCommit,
    result: smoke ? "non_qualifying_smoke_passed" : "passed",
    qualifyingEvidence: !smoke,
    releaseGateEligible: !smoke,
    verifiedAt: new Date().toISOString(),
    operatingSystems: [...expectedOperatingSystems],
    profile,
    totals: aggregateTotals,
    invariants: {
      exactShaPlatformCount: 3,
      duplicateExecutions: 0,
      invariantViolations: 0,
      completePlatformMatrix: true,
    },
    evidence: entries.map((entry) => ({
      file: entry.name,
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(entry.path),
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
    } else if (argument === "--allow-dirty-smoke") {
      options.allowDirtySmoke = true;
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
      const aggregate = verifySchedulerReliabilitySoakEvidenceSet(options);
      process.stdout.write(
        `verified scheduler reliability ${aggregate.profile.mode} ${aggregate.releaseCommit}: ${aggregate.totals.cycles} cycles across linux, macos, windows; ${aggregate.releaseGateEligible ? "release-gate eligible" : "non-qualifying smoke only"}\n`,
      );
    } else {
      const evidence = await runSchedulerReliabilitySoak(options);
      process.stdout.write(
        `scheduler reliability soak passed on ${evidence.runner.operatingSystem}: ${evidence.cycles.length} cycles over ${evidence.continuousDurationSeconds.toFixed(3)} seconds${evidence.qualifyingEvidence ? "" : " (non-qualifying smoke)"}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
