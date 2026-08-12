import { createHash, randomUUID } from "node:crypto";
import { nextCronTime } from "../agent-schedule-store.js";
import { executeRoutine } from "../routine-store.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";
import {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
} from "./authority-resolver.js";

export const ROUTINE_SCHEDULER_KIND = "routine";
export const ROUTINE_SCHEDULER_CAPABILITY = "agent.execute";
export const ROUTINE_SCHEDULER_CHANNELS = Object.freeze({
  SCHEDULED: "scheduled",
  MANUAL: "manual",
  GITHUB: "github",
});

function routineError(code, message, details = undefined, cause = undefined) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  error.retryable = false;
  return error;
}

function normalizeRoutine(routine) {
  if (!routine || typeof routine !== "object" || Array.isArray(routine)) {
    throw routineError(
      "SCHEDULER_ROUTINE_INVALID",
      "Routine scheduler adapter requires a routine object",
    );
  }
  const id = normalizeIdentifier(routine.id, "routine.id");
  const name = normalizeIdentifier(routine.name, "routine.name");
  if (typeof routine.prompt !== "string" || routine.prompt.length === 0) {
    throw routineError(
      "SCHEDULER_ROUTINE_INVALID",
      `Routine prompt is missing: ${id}`,
    );
  }
  if (
    !routine.trigger ||
    typeof routine.trigger !== "object" ||
    Array.isArray(routine.trigger) ||
    typeof routine.trigger.kind !== "string"
  ) {
    throw routineError(
      "SCHEDULER_ROUTINE_INVALID",
      `Routine trigger is missing: ${id}`,
    );
  }
  return {
    id,
    name,
    prompt: routine.prompt,
    trigger: routine.trigger,
    enabled: routine.enabled === true,
    createdAt: normalizeEpochMs(
      Number(routine.createdAt ?? 0),
      "routine.createdAt",
    ),
    lastFiredAt:
      routine.lastFiredAt === null || routine.lastFiredAt === undefined
        ? null
        : normalizeEpochMs(Number(routine.lastFiredAt), "routine.lastFiredAt"),
    lastSeenGithubEventId:
      routine.lastSeenGithubEventId === null ||
      routine.lastSeenGithubEventId === undefined
        ? null
        : normalizeIdentifier(
            String(routine.lastSeenGithubEventId),
            "routine.lastSeenGithubEventId",
          ),
  };
}

export function routineSnapshot(routine) {
  return normalizeRoutine(routine);
}

export function routineDefinitionSnapshot(routine) {
  const snapshot = normalizeRoutine(routine);
  return {
    id: snapshot.id,
    name: snapshot.name,
    prompt: snapshot.prompt,
    trigger: snapshot.trigger,
    enabled: snapshot.enabled,
    createdAt: snapshot.createdAt,
  };
}

export function routineSnapshotDigest(routine) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.routine.v1\0", "utf8")
    .update(canonicalJson(routineSnapshot(routine), "routineSnapshot"), "utf8")
    .digest("hex");
}

export function routineDefinitionDigest(routine) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.routine-definition.v1\0", "utf8")
    .update(
      canonicalJson(
        routineDefinitionSnapshot(routine),
        "routineDefinitionSnapshot",
      ),
      "utf8",
    )
    .digest("hex");
}

function normalizeChannel(channel) {
  if (!Object.values(ROUTINE_SCHEDULER_CHANNELS).includes(channel)) {
    throw routineError(
      "SCHEDULER_ROUTINE_INVALID_CHANNEL",
      `Unsupported routine scheduler channel: ${channel}`,
    );
  }
  return channel;
}

export function routineSchedulerJobId(routineId, channel) {
  return `routine:${normalizeIdentifier(routineId, "routineId")}:${normalizeChannel(channel)}`;
}

function normalizeGithubEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub event must be an object",
    );
  }
  if (event.id === null || event.id === undefined) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub event requires an id",
    );
  }
  if (event.type === null || event.type === undefined) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub event requires a type",
    );
  }
  const rawCreatedAt = event.createdAt ?? event.created_at;
  const createdAt = Number.isSafeInteger(rawCreatedAt)
    ? rawCreatedAt
    : Date.parse(rawCreatedAt);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub event requires a valid created_at timestamp",
    );
  }
  return {
    id: normalizeIdentifier(String(event.id), "githubEvent.id"),
    type: normalizeIdentifier(String(event.type), "githubEvent.type"),
    createdAt,
  };
}

function normalizeGithubBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub batch must be an object",
    );
  }
  if (!Array.isArray(batch.events) || batch.events.length === 0) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub batch requires at least one event",
    );
  }
  if (batch.cursorAfter === null || batch.cursorAfter === undefined) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub batch requires a cursorAfter value",
    );
  }
  return {
    repo: normalizeIdentifier(batch.repo, "github.repo"),
    cursorBefore:
      batch.cursorBefore === null || batch.cursorBefore === undefined
        ? null
        : normalizeIdentifier(
            String(batch.cursorBefore),
            "github.cursorBefore",
          ),
    cursorAfter: normalizeIdentifier(
      String(batch.cursorAfter),
      "github.cursorAfter",
    ),
    events: batch.events.map(normalizeGithubEvent),
  };
}

function githubEventIsAfter(eventId, cursor) {
  if (cursor === null || cursor === undefined) return true;
  const candidate = normalizeIdentifier(String(eventId), "githubEvent.id");
  const previous = normalizeIdentifier(String(cursor), "github.cursorBefore");
  if (/^\d+$/.test(candidate) && /^\d+$/.test(previous)) {
    return BigInt(candidate) > BigInt(previous);
  }
  return candidate > previous;
}

export function routineGithubBatch(routine, events, cursorAfter) {
  const definition = routineDefinitionSnapshot(routine);
  if (definition.trigger.kind !== "github") {
    throw routineError(
      "SCHEDULER_ROUTINE_NOT_GITHUB_DRIVEN",
      `Routine is not driven by GitHub: ${definition.id}`,
    );
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw routineError(
      "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
      "Routine GitHub batch requires at least one event",
    );
  }
  return {
    repo: normalizeIdentifier(
      String(definition.trigger.repo),
      "routine.trigger.repo",
    ),
    cursorBefore:
      routine.lastSeenGithubEventId === null ||
      routine.lastSeenGithubEventId === undefined
        ? null
        : normalizeIdentifier(
            String(routine.lastSeenGithubEventId),
            "routine.lastSeenGithubEventId",
          ),
    cursorAfter: normalizeIdentifier(String(cursorAfter), "github.cursorAfter"),
    events: events.map(normalizeGithubEvent),
  };
}

export function routineGithubBatchDigest(batch) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.routine-github-batch.v1\0", "utf8")
    .update(
      canonicalJson(normalizeGithubBatch(batch), "routineGithubBatch"),
      "utf8",
    )
    .digest("hex");
}

export function routineGithubSchedulerJobId(routineId, batchDigest) {
  return `${routineSchedulerJobId(
    routineId,
    ROUTINE_SCHEDULER_CHANNELS.GITHUB,
  )}:${normalizeIdentifier(batchDigest, "githubBatchDigest")}`;
}

export function routineSchedulerRunId(occurrenceId) {
  return `run-scheduler-${normalizeIdentifier(occurrenceId, "occurrenceId")}`;
}

export function buildRoutineSchedulerJob(
  routine,
  { channel = ROUTINE_SCHEDULER_CHANNELS.SCHEDULED, githubBatch } = {},
) {
  const normalizedChannel = normalizeChannel(channel);
  const snapshot =
    normalizedChannel !== ROUTINE_SCHEDULER_CHANNELS.SCHEDULED
      ? routineDefinitionSnapshot(routine)
      : routineSnapshot(routine);
  const snapshotType =
    normalizedChannel !== ROUTINE_SCHEDULER_CHANNELS.SCHEDULED
      ? "definition"
      : "state";
  const snapshotDigest =
    snapshotType === "definition"
      ? routineDefinitionDigest(snapshot)
      : routineSnapshotDigest(snapshot);
  const github =
    normalizedChannel === ROUTINE_SCHEDULER_CHANNELS.GITHUB
      ? routineGithubBatch(
          routine,
          githubBatch?.events,
          githubBatch?.cursorAfter,
        )
      : null;
  const githubDigest = github ? routineGithubBatchDigest(github) : null;
  return {
    id: github
      ? routineGithubSchedulerJobId(snapshot.id, githubDigest)
      : routineSchedulerJobId(snapshot.id, normalizedChannel),
    kind: ROUTINE_SCHEDULER_KIND,
    trigger: {
      source: "routine-store",
      channel: normalizedChannel,
      routineKind: snapshot.trigger.kind,
      ...(github ? { batchDigest: githubDigest } : {}),
    },
    payload: {
      channel: normalizedChannel,
      routine: snapshot,
      snapshotType,
      snapshotDigest,
      ...(github ? { github, githubDigest } : {}),
    },
    authority: {
      schemaVersion: 1,
      principal: { type: "routine", id: snapshot.id },
      tenantId: null,
      workspaceId: null,
      requestedCapabilities: [ROUTINE_SCHEDULER_CAPABILITY],
      authorizationRefs: {
        decisionId: null,
        policyRevision: null,
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    },
    enabled:
      normalizedChannel === ROUTINE_SCHEDULER_CHANNELS.MANUAL
        ? true
        : snapshot.enabled,
    // More than one claim is required to recover a process crash. Deterministic
    // run evidence prevents a completed/unknown agent outcome from executing
    // twice, while ordinary adapter failures remain explicitly non-retryable.
    maxAttempts: 3,
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

function sameJob(current, desired) {
  return (
    current !== null &&
    canonicalJson(comparableJob(current), "currentJob") ===
      canonicalJson(comparableJob(desired), "desiredJob")
  );
}

export function syncRoutineSchedulerJob(schedulerStore, routine, options = {}) {
  const desired = buildRoutineSchedulerJob(routine, options);
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
  if (sameJob(current, desired)) return current;
  try {
    return schedulerStore.updateJob(current.id, current.revision, {
      kind: desired.kind,
      trigger: desired.trigger,
      payload: desired.payload,
      authority: desired.authority,
      enabled: desired.enabled,
      maxAttempts: desired.maxAttempts,
    });
  } catch (error) {
    if (error?.code !== "SCHEDULER_REVISION_CONFLICT") throw error;
    const latest = schedulerStore.getJob(desired.id);
    if (sameJob(latest, desired)) return latest;
    throw error;
  }
}

export function scheduledRoutineFireAt(routine) {
  const snapshot = routineSnapshot(routine);
  if (snapshot.trigger.kind === "once") {
    return normalizeEpochMs(Number(snapshot.trigger.at), "routine.trigger.at");
  }
  if (snapshot.trigger.kind === "cron") {
    const from = snapshot.lastFiredAt ?? snapshot.createdAt;
    const scheduledFor = nextCronTime(snapshot.trigger.cron, from);
    if (scheduledFor === null) {
      throw routineError(
        "SCHEDULER_ROUTINE_NO_NEXT_FIRE",
        `Routine cron has no next occurrence: ${snapshot.id}`,
      );
    }
    return scheduledFor;
  }
  throw routineError(
    "SCHEDULER_ROUTINE_NOT_TIME_DRIVEN",
    `Routine is not driven by cron/once: ${snapshot.id}`,
  );
}

export function enqueueScheduledRoutine(schedulerStore, routine) {
  const job = syncRoutineSchedulerJob(schedulerStore, routine, {
    channel: ROUTINE_SCHEDULER_CHANNELS.SCHEDULED,
  });
  const scheduledFor = scheduledRoutineFireAt(routine);
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    triggerKey: `${routine.trigger.kind}:${scheduledFor}`,
  });
}

export function enqueueManualRoutine(
  schedulerStore,
  routine,
  { now = Date.now(), requestId = randomUUID() } = {},
) {
  const scheduledFor = normalizeEpochMs(Number(now), "now");
  const request = normalizeIdentifier(requestId, "requestId");
  const job = syncRoutineSchedulerJob(schedulerStore, routine, {
    channel: ROUTINE_SCHEDULER_CHANNELS.MANUAL,
  });
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    triggerKey: `manual:${request}`,
  });
}

export function enqueueGithubRoutine(
  schedulerStore,
  routine,
  events,
  cursorAfter,
  { availableAt } = {},
) {
  const githubBatch = routineGithubBatch(routine, events, cursorAfter);
  const job = syncRoutineSchedulerJob(schedulerStore, routine, {
    channel: ROUTINE_SCHEDULER_CHANNELS.GITHUB,
    githubBatch,
  });
  const scheduledFor = Math.max(
    ...githubBatch.events.map((event) => event.createdAt),
  );
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    availableAt: normalizeEpochMs(
      Number(availableAt ?? scheduledFor),
      "github.availableAt",
    ),
    triggerKey: `github:${githubBatch.cursorAfter}:${routineGithubBatchDigest(
      githubBatch,
    )}`,
  });
}

export function authorizeRoutineOccurrence({ job, occurrence }) {
  try {
    const payload = occurrence?.payload;
    const authority = occurrence?.authority;
    const routineId = payload?.routine?.id;
    const channel = normalizeChannel(payload?.channel);
    const expectedSnapshotType =
      channel === ROUTINE_SCHEDULER_CHANNELS.SCHEDULED ? "state" : "definition";
    const expectedDigest =
      payload?.snapshotType === "definition"
        ? routineDefinitionDigest(payload.routine)
        : payload?.snapshotType === "state"
          ? routineSnapshotDigest(payload.routine)
          : null;
    const github =
      channel === ROUTINE_SCHEDULER_CHANNELS.GITHUB
        ? normalizeGithubBatch(payload?.github)
        : null;
    const expectedGithubDigest = github
      ? routineGithubBatchDigest(github)
      : null;
    const allowed =
      job?.kind === ROUTINE_SCHEDULER_KIND &&
      typeof routineId === "string" &&
      authority?.principal?.type === "routine" &&
      authority?.principal?.id === routineId &&
      Array.isArray(authority?.requestedCapabilities) &&
      authority.requestedCapabilities.length === 1 &&
      authority.requestedCapabilities[0] === ROUTINE_SCHEDULER_CAPABILITY &&
      payload?.snapshotType === expectedSnapshotType &&
      payload?.snapshotDigest === expectedDigest &&
      (channel === ROUTINE_SCHEDULER_CHANNELS.GITHUB
        ? payload?.routine?.trigger?.kind === "github" &&
          github.repo === payload.routine.trigger.repo &&
          payload?.githubDigest === expectedGithubDigest
        : payload?.github === undefined && payload?.githubDigest === undefined);
    return {
      allowed,
      reason: allowed ? "routine_snapshot_bound" : "routine_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "routine_authority_malformed" };
  }
}

export function createRoutineSchedulerAdapter({ routineStore, runAgent } = {}) {
  if (!routineStore || typeof routineStore.get !== "function") {
    throw routineError(
      "SCHEDULER_ROUTINE_STORE_REQUIRED",
      "Routine scheduler adapter requires a RoutineStore",
    );
  }
  if (typeof runAgent !== "function") {
    throw routineError(
      "SCHEDULER_ROUTINE_RUNNER_REQUIRED",
      "Routine scheduler adapter requires a runAgent function",
    );
  }
  return {
    kind: ROUTINE_SCHEDULER_KIND,
    async execute({ occurrence }) {
      const payload = occurrence.payload;
      const expected = payload?.routine;
      if (!expected) {
        throw routineError(
          "SCHEDULER_ROUTINE_SNAPSHOT_INVALID",
          "Routine occurrence snapshot is missing or invalid",
        );
      }
      const expectedDigest =
        payload?.snapshotType === "definition"
          ? routineDefinitionDigest(expected)
          : payload?.snapshotType === "state"
            ? routineSnapshotDigest(expected)
            : null;
      if (payload.snapshotDigest !== expectedDigest) {
        throw routineError(
          "SCHEDULER_ROUTINE_SNAPSHOT_INVALID",
          "Routine occurrence snapshot is missing or invalid",
        );
      }
      if (
        payload.channel === ROUTINE_SCHEDULER_CHANNELS.GITHUB &&
        (payload.githubDigest !== routineGithubBatchDigest(payload.github) ||
          payload.github.repo !== expected.trigger.repo)
      ) {
        throw routineError(
          "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
          "Routine GitHub occurrence batch is missing or invalid",
        );
      }
      const current = routineStore.get(expected.id);
      if (!current) {
        throw routineError(
          "SCHEDULER_ROUTINE_NOT_FOUND",
          `Routine disappeared before execution: ${expected.id}`,
        );
      }
      const schedulerRunId = routineSchedulerRunId(occurrence.id);
      const existingRun = routineStore.getRun?.(schedulerRunId) ?? null;
      if (
        existingRun &&
        (existingRun.routineId !== expected.id ||
          existingRun.schedulerOccurrenceId !== occurrence.id ||
          existingRun.schedulerSnapshotDigest !== payload.snapshotDigest)
      ) {
        throw routineError(
          "SCHEDULER_ROUTINE_RUN_BINDING_MISMATCH",
          `Routine run evidence does not match occurrence: ${occurrence.id}`,
        );
      }
      const currentDigest =
        payload.snapshotType === "definition"
          ? routineDefinitionDigest(current)
          : routineSnapshotDigest(current);
      if (!existingRun && currentDigest !== payload.snapshotDigest) {
        throw routineError(
          "SCHEDULER_ROUTINE_STALE_SNAPSHOT",
          `Routine changed after occurrence enqueue: ${expected.id}`,
        );
      }
      if (
        payload.channel !== ROUTINE_SCHEDULER_CHANNELS.MANUAL &&
        !existingRun &&
        current.enabled !== true
      ) {
        throw routineError(
          "SCHEDULER_ROUTINE_DISABLED",
          `Routine was disabled before scheduled execution: ${expected.id}`,
        );
      }
      const execution = await executeRoutine(routineStore, current, runAgent, {
        trigger:
          payload.channel === ROUTINE_SCHEDULER_CHANNELS.MANUAL
            ? "manual"
            : payload.channel === ROUTINE_SCHEDULER_CHANNELS.GITHUB
              ? `github:${payload.github.events
                  .map((event) => event.type)
                  .join(",")}`
              : current.trigger.kind,
        runId: schedulerRunId,
        schedulerOccurrenceId: occurrence.id,
        schedulerSnapshotDigest: payload.snapshotDigest,
      });
      if (execution.status !== "ok") {
        throw routineError(
          "SCHEDULER_ROUTINE_EXECUTION_FAILED",
          `Routine agent run failed: ${expected.id}`,
          { runId: execution.runId, exitCode: execution.exitCode },
        );
      }
      return execution;
    },
    classifyError(error) {
      return { retryable: error?.retryable !== false };
    },
  };
}

function completedRunId(result) {
  if (
    result.status === "succeeded" &&
    typeof result.result?.runId === "string"
  ) {
    return result.result.runId;
  }
  return null;
}

export class RoutineSchedulerBridge {
  constructor({
    routineStore,
    schedulerStore,
    runAgent,
    now = Date.now,
    ownerId,
    leaseMs,
    renewIntervalMs,
    authorityResolver,
  } = {}) {
    if (typeof now !== "function") {
      throw routineError(
        "SCHEDULER_ROUTINE_CLOCK_REQUIRED",
        "Routine scheduler bridge requires a clock function",
      );
    }
    this.routineStore = routineStore;
    this.schedulerStore = schedulerStore;
    this.now = now;
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [createRoutineSchedulerAdapter({ routineStore, runAgent })],
      authorize:
        authorityResolver ||
        createSchedulerAuthorityResolver({
          store: schedulerStore,
          validate: authorizeRoutineOccurrence,
        }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(leaseMs === undefined ? {} : { leaseMs }),
      ...(renewIntervalMs === undefined ? {} : { renewIntervalMs }),
    });
  }

  async trigger(routine, { requestId, signal } = {}) {
    const occurrence = enqueueManualRoutine(this.schedulerStore, routine, {
      now: this.now(),
      ...(requestId === undefined ? {} : { requestId }),
    });
    const result = await this.runtime.runOccurrence(occurrence.id, { signal });
    return { routine: routine.id, occurrence: occurrence.id, result };
  }

  async pollGithub(routine, { fetchEvents, signal } = {}) {
    if (typeof fetchEvents !== "function") {
      throw routineError(
        "SCHEDULER_ROUTINE_GITHUB_FETCHER_REQUIRED",
        "Routine GitHub scheduler requires a fetchEvents function",
      );
    }
    const current = this.routineStore.get(routine.id);
    if (
      !current ||
      current.enabled !== true ||
      current.trigger?.kind !== "github"
    ) {
      return null;
    }
    const fetchedEvents = (await fetchEvents(current.trigger.repo)) || [];
    if (!Array.isArray(fetchedEvents)) {
      throw routineError(
        "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
        "Routine GitHub event source must return an array",
      );
    }
    const events = fetchedEvents.map(normalizeGithubEvent);
    const newestId =
      events.length > 0
        ? normalizeIdentifier(String(events[0]?.id ?? ""), "githubEvent.id")
        : null;
    if (newestId === "") {
      throw routineError(
        "SCHEDULER_ROUTINE_GITHUB_EVENT_INVALID",
        "Routine GitHub event is missing an id",
      );
    }
    const wanted = Array.isArray(current.trigger.events)
      ? current.trigger.events
      : null;
    const fresh = events.filter((event) => {
      if (wanted?.length > 0 && !wanted.includes(event?.type)) return false;
      return (
        event?.id !== null &&
        event?.id !== undefined &&
        githubEventIsAfter(event.id, current.lastSeenGithubEventId)
      );
    });
    if (fresh.length === 0) {
      if (
        newestId &&
        githubEventIsAfter(newestId, current.lastSeenGithubEventId)
      ) {
        this.routineStore.update(current.id, {
          lastSeenGithubEventId: newestId,
        });
      }
      return null;
    }

    // Enqueue the immutable event batch before advancing the legacy cursor.
    // A crash in between leaves a recoverable occurrence and may only cause a
    // deduplicated re-enqueue of the same batch on the next poll.
    const occurrence = enqueueGithubRoutine(
      this.schedulerStore,
      current,
      fresh,
      newestId,
      { availableAt: this.now() },
    );
    this.routineStore.update(current.id, {
      lastSeenGithubEventId: newestId,
    });
    const result = await this.runtime.runOccurrence(occurrence.id, { signal });
    return {
      routine: current.id,
      occurrence: occurrence.id,
      deduplicated: occurrence.deduplicated,
      result,
    };
  }

  async runDue({ signal } = {}) {
    const results = [];
    const observedOccurrences = new Set();
    const recovered = await this.runtime.runUntilIdle({
      limit: 10_000,
      signal,
      jobKind: ROUTINE_SCHEDULER_KIND,
    });
    for (const result of recovered.results) {
      const occurrence = result.occurrence;
      const routineId = occurrence?.payload?.routine?.id;
      if (typeof routineId !== "string") continue;
      observedOccurrences.add(occurrence.id);
      results.push({
        routine: routineId,
        occurrence: occurrence.id,
        deduplicated: false,
        recovered: true,
        result,
      });
    }
    if (signal?.aborted) return results;

    const now = normalizeEpochMs(Number(this.now()), "now");
    const due = this.routineStore.due(now);
    for (const routine of due) {
      const occurrence = enqueueScheduledRoutine(this.schedulerStore, routine);
      if (observedOccurrences.has(occurrence.id)) continue;
      const result = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      results.push({
        routine: routine.id,
        occurrence: occurrence.id,
        deduplicated: occurrence.deduplicated,
        result,
      });
    }
    return results;
  }
}

export function routineBridgeRunId(entry) {
  const result = entry?.result ?? entry;
  return (
    completedRunId(result) ??
    (typeof result?.error?.details?.runId === "string"
      ? result.error.details.runId
      : null)
  );
}
