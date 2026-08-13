import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";
import { schedulerMigrationSourceDigest } from "./store.js";
import {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
} from "./authority-resolver.js";

export const LOOP_SCHEDULER_KIND = "loop-iteration";
export const LOOP_PROCESS_CAPABILITY = "process.execute";
export const LOOP_AGENT_CAPABILITY = "agent.execute";
export const LOOP_SCHEDULER_MIGRATION_SCHEMA_VERSION = 1;

function loopSchedulerError(
  code,
  message,
  details = undefined,
  cause = undefined,
) {
  return new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
}

function normalizedCwd(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_CWD_INVALID",
      "Loop scheduler requires a workspace path",
    );
  }
  const absolute = resolve(cwd);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function normalizeOperands(operands) {
  if (
    !Array.isArray(operands) ||
    operands.length === 0 ||
    operands.some(
      (operand) => typeof operand !== "string" || operand.length === 0,
    )
  ) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_DEFINITION_INVALID",
      "Loop scheduler requires at least one non-empty operand",
    );
  }
  return [...operands];
}

export function loopExecutionSnapshot(definition) {
  if (!definition || typeof definition !== "object") {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_DEFINITION_INVALID",
      "Loop scheduler requires an execution definition",
    );
  }
  return {
    executionId: normalizeIdentifier(
      definition.executionId,
      "loop.executionId",
    ),
    cwd: normalizedCwd(definition.cwd),
    execMode: definition.execMode === true,
    operands: normalizeOperands(definition.operands),
    dynamic: definition.dynamic === true,
  };
}

export function loopExecutionDigest(definition) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.loop-execution.v1\0", "utf8")
    .update(canonicalJson(loopExecutionSnapshot(definition)), "utf8")
    .digest("hex");
}

export function loopMigrationSourceSnapshot({ sessionId, config }) {
  return normalizeJson(
    {
      schemaVersion: LOOP_SCHEDULER_MIGRATION_SCHEMA_VERSION,
      sessionId: normalizeIdentifier(sessionId, "loop.sessionId"),
      config: normalizeJson(config, "loop.config"),
    },
    "loopMigration.source",
  );
}

function latestLoopMigrationMarker(events) {
  return [...events]
    .reverse()
    .find((event) => event?.type === "loop_scheduler_migration")?.data;
}

function appendLoopMigrationMarker({
  sessionId,
  marker,
  readEvents,
  appendEventIfHead,
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const events = readEvents(sessionId);
    const current = latestLoopMigrationMarker(events);
    if (
      current?.state === marker.state &&
      current?.migrationId === marker.migrationId &&
      current?.retirementToken === marker.retirementToken &&
      current?.targetJobId === marker.targetJobId
    ) {
      return current;
    }
    try {
      appendEventIfHead(
        sessionId,
        "loop_scheduler_migration",
        marker,
        events[events.length - 1]?.hash || null,
      );
      return latestLoopMigrationMarker(readEvents(sessionId));
    } catch (error) {
      if (error?.code !== "SESSION_REVISION_STALE" || attempt === 2) {
        throw error;
      }
    }
  }
  throw loopSchedulerError(
    "LOOP_SCHEDULER_MIGRATION_SESSION_BUSY",
    `Saved loop changed repeatedly during migration: ${sessionId}`,
  );
}

export function migrateSavedLoopSession({
  schedulerStore,
  sessionId,
  config,
  definition,
  readEvents,
  appendEventIfHead,
}) {
  if (
    typeof readEvents !== "function" ||
    typeof appendEventIfHead !== "function"
  ) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_MIGRATION_SESSION_STORE_REQUIRED",
      "Loop migration requires session read and compare-append functions",
    );
  }
  const snapshot = loopMigrationSourceSnapshot({ sessionId, config });
  const desired = buildLoopSchedulerJob(definition);
  desired.authority = bindSchedulerAuthorityPolicy(
    schedulerStore,
    desired.authority,
  );
  const sourceScope = { store: "jsonl-session", sessionId: snapshot.sessionId };
  const existing = schedulerStore.getActiveDomainMigrationBySource({
    domain: "loop-iteration",
    sourceScope,
    sourceId: snapshot.sessionId,
  });
  const prepared =
    existing ||
    schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "loop-iteration",
          sourceId: snapshot.sessionId,
          sourceScope,
          source: snapshot,
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
  if (
    prepared.entries.length !== 1 ||
    prepared.entries[0].domain !== "loop-iteration"
  ) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
      "Loop session belongs to an invalid mixed-domain migration",
    );
  }
  if (
    prepared.entries[0].sourceDigest !==
      schedulerMigrationSourceDigest(snapshot) ||
    prepared.entries[0].targetJobId !== desired.id
  ) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_MIGRATION_SOURCE_CHANGED",
      `Saved loop changed after migration started: ${snapshot.sessionId}`,
    );
  }
  let migration = prepared;
  if (["rolling_back", "rolled_back"].includes(migration.state)) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_MIGRATION_STATE_CONFLICT",
      `Loop migration cannot resume from state ${migration.state}`,
    );
  }
  if (migration.state === "prepared") {
    migration = schedulerStore.applyDomainMigration(migration.id);
  }
  if (migration.state === "applied") {
    migration = schedulerStore.verifyDomainMigration(migration.id, {
      sources: [{ entryId: migration.entries[0].entryId, source: snapshot }],
    });
  }
  const retiring =
    migration.state === "retiring"
      ? migration
      : migration.state === "retired"
        ? migration
        : schedulerStore.beginDomainMigrationRetirement(migration.id);
  const entry = retiring.entries[0];
  const retiredMarker = appendLoopMigrationMarker({
    sessionId: snapshot.sessionId,
    readEvents,
    appendEventIfHead,
    marker: {
      schemaVersion: LOOP_SCHEDULER_MIGRATION_SCHEMA_VERSION,
      state: "retired",
      migrationId: migration.id,
      retirementToken: entry.retirementToken,
      targetJobId: entry.targetJobId,
      compatibility: "explicit-resume-only",
    },
  });
  schedulerStore.confirmDomainMigrationEntryRetired({
    migrationId: migration.id,
    entryId: entry.entryId,
    retirementToken: entry.retirementToken,
    source: retiredMarker,
  });
  return schedulerStore.getDomainMigration(migration.id);
}

export function rollbackSavedLoopMigration({
  schedulerStore,
  sessionId,
  config,
  migrationId,
  readEvents,
  appendEventIfHead,
}) {
  const migration = schedulerStore.beginDomainMigrationRollback(migrationId);
  if (
    migration.entries.length !== 1 ||
    migration.entries[0].domain !== "loop-iteration" ||
    migration.entries[0].sourceId !== sessionId
  ) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
      "Loop rollback cannot operate on this migration",
    );
  }
  schedulerStore.rollbackDomainMigrationTargets(migrationId);
  const entry = migration.entries[0];
  appendLoopMigrationMarker({
    sessionId,
    readEvents,
    appendEventIfHead,
    marker: {
      schemaVersion: LOOP_SCHEDULER_MIGRATION_SCHEMA_VERSION,
      state: "rolled_back",
      migrationId,
      retirementToken: entry.retirementToken,
      targetJobId: entry.targetJobId,
      compatibility: "explicit-resume-only",
    },
  });
  schedulerStore.confirmDomainMigrationEntrySourceRestored({
    migrationId,
    entryId: entry.entryId,
    retirementToken: entry.retirementToken,
    source: loopMigrationSourceSnapshot({ sessionId, config }),
  });
  return schedulerStore.getDomainMigration(migrationId);
}

export function loopWorkspaceId(cwd) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.loop-workspace.v1\0", "utf8")
    .update(normalizedCwd(cwd), "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function loopSchedulerJobId(executionId) {
  const id = normalizeIdentifier(executionId, "loop.executionId");
  const digest = createHash("sha256")
    .update("chainlesschain.scheduler.loop-job.v1\0", "utf8")
    .update(id, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `loop:${digest}`;
}

export function buildLoopSchedulerJob(definition) {
  const snapshot = loopExecutionSnapshot(definition);
  const capability = snapshot.execMode
    ? LOOP_PROCESS_CAPABILITY
    : LOOP_AGENT_CAPABILITY;
  return {
    id: loopSchedulerJobId(snapshot.executionId),
    kind: LOOP_SCHEDULER_KIND,
    trigger: { source: "loop", mode: "interval" },
    payload: {
      definition: snapshot,
      snapshotDigest: loopExecutionDigest(snapshot),
    },
    authority: {
      schemaVersion: 1,
      principal: { type: "loop", id: snapshot.executionId },
      tenantId: null,
      workspaceId: loopWorkspaceId(snapshot.cwd),
      requestedCapabilities: [capability],
      authorizationRefs: {
        decisionId: null,
        policyRevision: null,
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    },
    enabled: true,
    // A reclaimed first attempt is not replayed. The second claim exists only
    // so the adapter can publish an explicit outcome-unknown dead letter.
    maxAttempts: 2,
  };
}

function comparableJob(job) {
  return {
    kind: job.kind,
    trigger: job.trigger,
    payload: job.payload,
    authority: job.authority,
    enabled: job.enabled,
    maxAttempts: job.maxAttempts,
  };
}

export function syncLoopSchedulerJob(schedulerStore, definition) {
  const desired = buildLoopSchedulerJob(definition);
  desired.authority = bindSchedulerAuthorityPolicy(
    schedulerStore,
    desired.authority,
  );
  let current = schedulerStore.getJob(desired.id);
  if (!current) {
    try {
      return schedulerStore.createJob(desired);
    } catch (error) {
      if (error?.code !== "SCHEDULER_CONFLICT") throw error;
      current = schedulerStore.getJob(desired.id);
    }
  }
  if (
    canonicalJson(comparableJob(current), "currentLoopJob") ===
    canonicalJson(comparableJob(desired), "desiredLoopJob")
  ) {
    return current;
  }
  throw loopSchedulerError(
    "LOOP_SCHEDULER_DEFINITION_CONFLICT",
    `Saved loop execution definition changed: ${definition.executionId}`,
  );
}

export function enqueueLoopIteration(
  schedulerStore,
  definition,
  iteration,
  { scheduledFor, availableAt } = {},
) {
  if (!Number.isSafeInteger(iteration) || iteration < 1) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_ITERATION_INVALID",
      "Loop iteration must be a positive integer",
    );
  }
  const job = syncLoopSchedulerJob(schedulerStore, definition);
  const scheduled = normalizeEpochMs(scheduledFor, "loop.scheduledFor");
  // An iteration remains the same logical firing when a saved Loop session is
  // migrated and the target job revision advances. Reuse the durable terminal
  // outcome instead of deriving a second occurrence from the new revision.
  return schedulerStore.enqueueOccurrenceOncePerTrigger({
    jobId: job.id,
    scheduledFor: scheduled,
    availableAt: normalizeEpochMs(availableAt ?? scheduled, "loop.availableAt"),
    triggerKey: `iteration:${iteration}`,
  });
}

export function authorizeLoopOccurrence({ job, occurrence }) {
  try {
    const definition = occurrence?.payload?.definition;
    const snapshot = loopExecutionSnapshot(definition);
    const expectedCapability = snapshot.execMode
      ? LOOP_PROCESS_CAPABILITY
      : LOOP_AGENT_CAPABILITY;
    const authority = occurrence.authority;
    const allowed =
      job?.kind === LOOP_SCHEDULER_KIND &&
      occurrence.payload.snapshotDigest === loopExecutionDigest(snapshot) &&
      authority?.principal?.type === "loop" &&
      authority?.principal?.id === snapshot.executionId &&
      authority?.workspaceId === loopWorkspaceId(snapshot.cwd) &&
      Array.isArray(authority?.requestedCapabilities) &&
      authority.requestedCapabilities.length === 1 &&
      authority.requestedCapabilities[0] === expectedCapability;
    return {
      allowed,
      reason: allowed
        ? "loop_snapshot_bound"
        : "loop_snapshot_or_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "loop_authority_malformed" };
  }
}

function normalizeOptionalInteger(value, field, { minimum = 0 } = {}) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_RESULT_INVALID",
      `${field} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function persistedIterationResult(iteration, result) {
  const output = String(result?.output || "");
  return {
    iteration,
    exitCode: normalizeOptionalInteger(result?.exitCode, "loop.exitCode", {
      minimum: Number.MIN_SAFE_INTEGER,
    }),
    signal:
      result?.signal === null || result?.signal === undefined
        ? null
        : String(result.signal).slice(0, 128),
    durationMs: normalizeOptionalInteger(result?.durationMs, "loop.durationMs"),
    done: result?.done === true,
    nextDelayMs: normalizeOptionalInteger(
      result?.nextDelayMs,
      "loop.nextDelayMs",
    ),
    matchedUntil: result?.matchedUntil === true,
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputDigest: createHash("sha256").update(output, "utf8").digest("hex"),
  };
}

export function createLoopSchedulerAdapter({ runIteration } = {}) {
  if (typeof runIteration !== "function") {
    throw loopSchedulerError(
      "LOOP_SCHEDULER_RUNNER_REQUIRED",
      "Loop scheduler adapter requires a runIteration function",
    );
  }
  const transientResults = new Map();
  return {
    kind: LOOP_SCHEDULER_KIND,
    async adjudicate({ occurrence, adjudication }) {
      if (adjudication.decision === "confirmed_applied") {
        const match = /^iteration:(\d+)$/.exec(occurrence.triggerKey);
        return {
          settled: true,
          result: {
            iteration: match ? Number(match[1]) : null,
            status: "adjudicated-applied",
            adjudicationRequestId: adjudication.requestId,
          },
        };
      }
      return { continue: true };
    },
    async execute({ occurrence, signal, adjudication }) {
      const definition = loopExecutionSnapshot(occurrence?.payload?.definition);
      if (
        occurrence.payload.snapshotDigest !== loopExecutionDigest(definition)
      ) {
        throw loopSchedulerError(
          "LOOP_SCHEDULER_SNAPSHOT_INVALID",
          `Loop occurrence snapshot is invalid: ${occurrence.id}`,
        );
      }
      const match = /^iteration:(\d+)$/.exec(occurrence.triggerKey);
      const iteration = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(iteration) || iteration < 1) {
        throw loopSchedulerError(
          "LOOP_SCHEDULER_ITERATION_INVALID",
          `Loop occurrence iteration key is invalid: ${occurrence.id}`,
        );
      }
      const authorizedRetry =
        adjudication?.decision === "confirmed_not_applied" &&
        adjudication.expectedAttempt + 1 === occurrence.attempt;
      if (occurrence.attempt > 1 && !authorizedRetry) {
        throw loopSchedulerError(
          "LOOP_SCHEDULER_OUTCOME_UNKNOWN",
          `Loop iteration may already have produced side effects; refusing replay: ${occurrence.id}`,
        );
      }
      const result =
        (await runIteration(iteration, { signal, definition })) || {};
      const persisted = persistedIterationResult(iteration, result);
      transientResults.set(occurrence.id, {
        ...persisted,
        output: result.output,
      });
      return persisted;
    },
    classifyError() {
      return { retryable: false };
    },
    consumeResult(occurrenceId) {
      const result = transientResults.get(occurrenceId) || null;
      transientResults.delete(occurrenceId);
      return result;
    },
  };
}

export class LoopSchedulerBridge {
  constructor({
    schedulerStore,
    definition,
    runIteration,
    ownerId,
    leaseMs,
    renewIntervalMs,
    authorityResolver,
  } = {}) {
    if (!schedulerStore) {
      throw loopSchedulerError(
        "LOOP_SCHEDULER_STORE_REQUIRED",
        "Loop scheduler bridge requires a scheduler store",
      );
    }
    this.schedulerStore = schedulerStore;
    this.definition = loopExecutionSnapshot(definition);
    this.job = syncLoopSchedulerJob(schedulerStore, this.definition);
    this.adapter = createLoopSchedulerAdapter({ runIteration });
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [this.adapter],
      authorize:
        authorityResolver ||
        createSchedulerAuthorityResolver({
          store: schedulerStore,
          validate: authorizeLoopOccurrence,
        }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(leaseMs === undefined ? {} : { leaseMs }),
      ...(renewIntervalMs === undefined ? {} : { renewIntervalMs }),
    });
  }

  async runIteration(iteration, { scheduledFor, signal } = {}) {
    const occurrence = enqueueLoopIteration(
      this.schedulerStore,
      this.definition,
      iteration,
      { scheduledFor },
    );
    const result = await this.runtime.runOccurrence(occurrence.id, { signal });
    if (result.status === "succeeded") {
      const transient = this.adapter.consumeResult(occurrence.id);
      return {
        ...(transient || result.result || {}),
        ...(result.alreadySettled || !transient ? { recovered: true } : {}),
        output: transient?.output || "",
        schedulerOccurrenceId: occurrence.id,
      };
    }
    if (result.status === "busy") {
      throw loopSchedulerError(
        "LOOP_SCHEDULER_BUSY",
        `Loop iteration is already owned by another driver: ${iteration}`,
      );
    }
    throw loopSchedulerError(
      result.error?.code || "LOOP_SCHEDULER_EXECUTION_FAILED",
      result.error?.message || `Loop iteration failed: ${iteration}`,
      { status: result.status, occurrenceId: occurrence.id },
    );
  }
}
