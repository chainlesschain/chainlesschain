import { createHash } from "node:crypto";
import { effectiveFireAt } from "../schedule-planner.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";

export const AGENDA_SCHEDULER_KIND = "agenda";
export const AGENDA_SCHEDULER_CAPABILITY = "agent.execute";
export const AGENDA_SCHEDULER_MONITOR_CAPABILITY = "monitor.observe";
export const AGENDA_SCHEDULER_ENTRY_KINDS = Object.freeze([
  "wakeup",
  "cron",
  "monitor",
]);
export const AGENDA_SCHEDULER_RETRY_DELAY_MS = 60_000;

function agendaError(
  code,
  message,
  details = undefined,
  cause = undefined,
  { retryable = false, retryAt } = {},
) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  error.retryable = retryable;
  if (retryAt !== undefined) error.retryAt = retryAt;
  return error;
}

function safeFailure(error) {
  return {
    code:
      typeof error?.code === "string" && error.code
        ? error.code.slice(0, 128)
        : "AGENDA_AGENT_EXECUTION_FAILED",
    message:
      typeof error?.message === "string" && error.message
        ? error.message.slice(0, 2_000)
        : "Agenda agent execution failed",
  };
}

function capabilityForEntry(entry) {
  return entry?.kind === "monitor"
    ? AGENDA_SCHEDULER_MONITOR_CAPABILITY
    : AGENDA_SCHEDULER_CAPABILITY;
}

function normalizeMonitorObservation(entry, observation) {
  if (
    !observation ||
    typeof observation !== "object" ||
    Array.isArray(observation) ||
    typeof observation.matched !== "boolean"
  ) {
    throw agendaError(
      "AGENDA_SCHEDULER_MONITOR_RESULT_INVALID",
      `Agenda monitor returned an invalid observation: ${entry.id}`,
    );
  }
  const mtimeMs =
    observation.mtimeMs === null || observation.mtimeMs === undefined
      ? null
      : Number(observation.mtimeMs);
  if (mtimeMs !== null && (!Number.isFinite(mtimeMs) || mtimeMs < 0)) {
    throw agendaError(
      "AGENDA_SCHEDULER_MONITOR_RESULT_INVALID",
      `Agenda monitor returned an invalid mtime: ${entry.id}`,
    );
  }
  const eventId = observation.matched
    ? normalizeIdentifier(observation.eventId, "agenda.monitor.eventId")
    : null;
  const authority = observation.matched
    ? normalizeIdentifier(observation.authority, "agenda.monitor.authority")
    : null;
  const duplicate = observation.matched && entry.lastEventId === eventId;
  const notification =
    observation.notification &&
    typeof observation.notification === "object" &&
    !Array.isArray(observation.notification)
      ? {
          title: String(observation.notification.title || ""),
          body: String(observation.notification.body || ""),
          level: String(observation.notification.level || "success"),
        }
      : null;
  return {
    matched: observation.matched,
    mtimeMs,
    eventId,
    authority,
    duplicate,
    truncated: observation.truncated === true,
    notification,
  };
}

function validateMonitorSnapshot(snapshot) {
  if (
    !Number.isSafeInteger(snapshot.intervalMs) ||
    snapshot.intervalMs < 1_000
  ) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda monitor interval is invalid: ${snapshot.id}`,
    );
  }
  if (!Number.isSafeInteger(snapshot.checks) || snapshot.checks < 0) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda monitor check count is invalid: ${snapshot.id}`,
    );
  }
  if (!["command", "file", "http"].includes(snapshot.source)) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda monitor source is invalid: ${snapshot.id}`,
    );
  }
  const sourceValue =
    snapshot.source === "command"
      ? snapshot.command
      : snapshot.source === "file"
        ? snapshot.watchFile
        : snapshot.watchUrl;
  if (typeof sourceValue !== "string" || sourceValue.length === 0) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda monitor source target is missing: ${snapshot.id}`,
    );
  }
  if (
    snapshot.watchChange === true &&
    (snapshot.source !== "file" || snapshot.stopWhen != null)
  ) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda monitor change condition is invalid: ${snapshot.id}`,
    );
  }
  if (snapshot.stopWhen != null) {
    if (typeof snapshot.stopWhen !== "string") {
      throw agendaError(
        "AGENDA_SCHEDULER_ENTRY_INVALID",
        `Agenda monitor stop condition is invalid: ${snapshot.id}`,
      );
    }
    try {
      new RegExp(snapshot.stopWhen);
    } catch (error) {
      throw agendaError(
        "AGENDA_SCHEDULER_ENTRY_INVALID",
        `Agenda monitor stop condition is invalid: ${snapshot.id}`,
        undefined,
        error,
      );
    }
  }
}

function validateEntrySnapshot(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      "Agenda scheduler adapter requires an entry object",
    );
  }
  const plain = { ...entry };
  delete plain.executionLease;
  delete plain.schedulerExecution;
  const snapshot = normalizeJson(plain, "agendaEntrySnapshot");
  snapshot.id = normalizeIdentifier(snapshot.id, "agenda.entry.id");
  if (!AGENDA_SCHEDULER_ENTRY_KINDS.includes(snapshot.kind)) {
    throw agendaError(
      "AGENDA_SCHEDULER_KIND_UNSUPPORTED",
      `Agenda scheduler does not support entry kind: ${snapshot.kind}`,
    );
  }
  if (
    snapshot.kind !== "monitor" &&
    (typeof snapshot.prompt !== "string" || snapshot.prompt.length === 0)
  ) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_INVALID",
      `Agenda prompt is missing: ${snapshot.id}`,
    );
  }
  const schedulable =
    (snapshot.kind === "wakeup" && snapshot.status === "pending") ||
    (["cron", "monitor"].includes(snapshot.kind) &&
      snapshot.status === "active");
  if (!schedulable) {
    throw agendaError(
      "AGENDA_SCHEDULER_ENTRY_TERMINAL",
      `Agenda entry is not schedulable: ${snapshot.id}`,
    );
  }
  if (snapshot.kind === "monitor") validateMonitorSnapshot(snapshot);
  normalizeEpochMs(Number(snapshot.createdAt), "agenda.entry.createdAt");
  const fireAt = effectiveFireAt(snapshot);
  if (fireAt == null) {
    throw agendaError(
      "AGENDA_SCHEDULER_FIRE_TIME_INVALID",
      `Agenda entry has no fire time: ${snapshot.id}`,
    );
  }
  normalizeEpochMs(Number(fireAt), "agenda.entry.fireAt");
  return snapshot;
}

export function agendaEntrySnapshot(entry) {
  return validateEntrySnapshot(entry);
}

export function agendaEntrySnapshotDigest(entry) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.agenda-entry.v1\0", "utf8")
    .update(
      canonicalJson(agendaEntrySnapshot(entry), "agendaEntrySnapshot"),
      "utf8",
    )
    .digest("hex");
}

export function agendaSchedulerJobId(entryId) {
  return `agenda:${normalizeIdentifier(entryId, "agendaEntryId")}`;
}

export function buildAgendaSchedulerJob(entry) {
  const snapshot = agendaEntrySnapshot(entry);
  return {
    id: agendaSchedulerJobId(snapshot.id),
    kind: AGENDA_SCHEDULER_KIND,
    trigger: {
      source: "agent-schedule-store",
      scheduleKind: snapshot.kind,
      expression:
        snapshot.kind === "cron"
          ? snapshot.cron
          : snapshot.kind === "monitor"
            ? `every:${snapshot.intervalMs}`
            : String(snapshot.dueAt),
    },
    payload: {
      entry: snapshot,
      snapshotDigest: agendaEntrySnapshotDigest(snapshot),
    },
    authority: {
      schemaVersion: 1,
      principal: { type: "agenda", id: snapshot.id },
      tenantId: null,
      workspaceId: null,
      requestedCapabilities: [capabilityForEntry(snapshot)],
      authorizationRefs: {
        decisionId: null,
        policyRevision: null,
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    },
    enabled: true,
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
    canonicalJson(comparableJob(current), "currentAgendaJob") ===
      canonicalJson(comparableJob(desired), "desiredAgendaJob")
  );
}

export function syncAgendaSchedulerJob(schedulerStore, entry) {
  const desired = buildAgendaSchedulerJob(entry);
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

export function enqueueAgendaEntry(schedulerStore, entry) {
  const snapshot = agendaEntrySnapshot(entry);
  const job = syncAgendaSchedulerJob(schedulerStore, snapshot);
  const scheduledFor = normalizeEpochMs(
    Number(effectiveFireAt(snapshot)),
    "agenda.entry.fireAt",
  );
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    triggerKey: `${snapshot.kind}:${scheduledFor}`,
  });
}

export function authorizeAgendaOccurrence({ job, occurrence }) {
  try {
    const payload = occurrence?.payload;
    const entry = payload?.entry;
    const authority = occurrence?.authority;
    const expectedDigest = agendaEntrySnapshotDigest(entry);
    const allowed =
      job?.kind === AGENDA_SCHEDULER_KIND &&
      authority?.principal?.type === "agenda" &&
      authority?.principal?.id === entry.id &&
      Array.isArray(authority?.requestedCapabilities) &&
      authority.requestedCapabilities.length === 1 &&
      authority.requestedCapabilities[0] === capabilityForEntry(entry) &&
      payload.snapshotDigest === expectedDigest;
    return {
      allowed,
      reason: allowed ? "agenda_snapshot_bound" : "agenda_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "agenda_authority_malformed" };
  }
}

function recoveredResult(entry, evidence) {
  const result =
    evidence.result && typeof evidence.result === "object"
      ? evidence.result
      : {
          id: entry.id,
          kind: entry.kind,
          action: entry.kind === "monitor" ? "checked" : "fired",
        };
  return { ...result, recovered: true };
}

function matchingExecutionEvidence(
  entry,
  { occurrenceId, snapshotDigest, attempt, status },
) {
  const evidence = entry?.schedulerExecution;
  return (
    evidence?.occurrenceId === occurrenceId &&
    evidence.snapshotDigest === snapshotDigest &&
    evidence.attempt === attempt &&
    evidence.status === status
  );
}

export function createAgendaSchedulerAdapter({
  agendaStore,
  runAgent,
  runMonitor,
  notifyMonitor,
  now = Date.now,
} = {}) {
  if (
    !agendaStore ||
    typeof agendaStore.get !== "function" ||
    typeof agendaStore.bindSchedulerExecution !== "function" ||
    typeof agendaStore.completeSchedulerExecution !== "function"
  ) {
    throw agendaError(
      "AGENDA_SCHEDULER_STORE_REQUIRED",
      "Agenda scheduler adapter requires a compatible AgentScheduleStore",
    );
  }
  if (typeof runAgent !== "function") {
    throw agendaError(
      "AGENDA_SCHEDULER_RUNNER_REQUIRED",
      "Agenda scheduler adapter requires a runAgent function",
    );
  }
  if (typeof now !== "function") {
    throw agendaError(
      "AGENDA_SCHEDULER_CLOCK_REQUIRED",
      "Agenda scheduler adapter requires a clock function",
    );
  }
  return {
    kind: AGENDA_SCHEDULER_KIND,
    async execute({ occurrence }) {
      const payload = occurrence.payload;
      const expected = agendaEntrySnapshot(payload?.entry);
      const expectedDigest = agendaEntrySnapshotDigest(expected);
      if (payload.snapshotDigest !== expectedDigest) {
        throw agendaError(
          "AGENDA_SCHEDULER_SNAPSHOT_INVALID",
          `Agenda occurrence snapshot is invalid: ${occurrence.id}`,
        );
      }
      let current = agendaStore.get(expected.id);
      if (!current) {
        throw agendaError(
          "AGENDA_SCHEDULER_ENTRY_NOT_FOUND",
          `Agenda entry disappeared before execution: ${expected.id}`,
        );
      }
      const prior = current.schedulerExecution;
      if (prior?.occurrenceId === occurrence.id) {
        if (prior.snapshotDigest !== expectedDigest) {
          throw agendaError(
            "AGENDA_SCHEDULER_BINDING_MISMATCH",
            `Agenda execution evidence has a different snapshot: ${expected.id}`,
          );
        }
        if (prior.status === "succeeded") {
          return recoveredResult(expected, prior);
        }
        if (prior.status === "running") {
          throw agendaError(
            "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
            `Agenda execution outcome is unknown; refusing duplicate execution: ${expected.id}`,
          );
        }
      } else if (prior?.status === "running") {
        throw agendaError(
          "AGENDA_SCHEDULER_EXECUTION_CONFLICT",
          `Agenda entry has another unresolved scheduler execution: ${expected.id}`,
        );
      }
      if (agendaEntrySnapshotDigest(current) !== expectedDigest) {
        throw agendaError(
          "AGENDA_SCHEDULER_STALE_SNAPSHOT",
          `Agenda entry changed after occurrence enqueue: ${expected.id}`,
        );
      }

      current = agendaStore.bindSchedulerExecution(expected.id, {
        occurrenceId: occurrence.id,
        snapshotDigest: expectedDigest,
        attempt: occurrence.attempt,
        atMs: now(),
      });
      if (agendaEntrySnapshotDigest(current) !== expectedDigest) {
        const stale = agendaError(
          "AGENDA_SCHEDULER_STALE_SNAPSHOT",
          `Agenda entry changed while binding occurrence: ${expected.id}`,
        );
        agendaStore.completeSchedulerExecution(expected.id, {
          occurrenceId: occurrence.id,
          snapshotDigest: expectedDigest,
          attempt: occurrence.attempt,
          outcome: "failed",
          error: safeFailure(stale),
          atMs: now(),
        });
        throw stale;
      }

      let observation = null;
      let action = null;
      try {
        if (expected.kind === "monitor") {
          if (typeof runMonitor !== "function") {
            throw agendaError(
              "AGENDA_SCHEDULER_MONITOR_RUNNER_REQUIRED",
              "Agenda scheduler monitor execution requires a monitor runner",
            );
          }
          observation = normalizeMonitorObservation(
            expected,
            await runMonitor({
              entry: expected,
              occurrenceId: occurrence.id,
              attempt: occurrence.attempt,
            }),
          );
          action = {
            id: expected.id,
            kind: expected.kind,
            action: observation.matched
              ? observation.duplicate
                ? "duplicate"
                : "matched"
              : "checked",
            ...(observation.matched
              ? {
                  event_id: observation.eventId,
                  authority: observation.authority,
                }
              : {}),
            ...(observation.truncated ? { truncated: true } : {}),
          };
        } else {
          await runAgent({
            entry: expected,
            prompt: expected.prompt,
            runPolicy: expected.runPolicy,
            occurrenceId: occurrence.id,
            attempt: occurrence.attempt,
          });
          action = {
            id: expected.id,
            kind: expected.kind,
            action: "fired",
          };
        }
      } catch (error) {
        let failurePersisted = false;
        try {
          agendaStore.completeSchedulerExecution(expected.id, {
            occurrenceId: occurrence.id,
            snapshotDigest: expectedDigest,
            attempt: occurrence.attempt,
            outcome: "failed",
            error: safeFailure(error),
            atMs: now(),
          });
          failurePersisted = true;
        } catch (completionError) {
          failurePersisted = matchingExecutionEvidence(
            agendaStore.get(expected.id),
            {
              occurrenceId: occurrence.id,
              snapshotDigest: expectedDigest,
              attempt: occurrence.attempt,
              status: "failed",
            },
          );
          if (!failurePersisted) {
            throw agendaError(
              "AGENDA_SCHEDULER_FAILURE_PERSIST_FAILED",
              `Agenda execution failed and its evidence could not be persisted: ${expected.id}`,
              undefined,
              completionError,
            );
          }
        }
        throw agendaError(
          typeof error?.code === "string"
            ? error.code
            : expected.kind === "monitor"
              ? "AGENDA_MONITOR_EXECUTION_FAILED"
              : "AGENDA_AGENT_EXECUTION_FAILED",
          typeof error?.message === "string"
            ? error.message
            : `Agenda ${expected.kind === "monitor" ? "monitor" : "agent"} execution failed: ${expected.id}`,
          undefined,
          error,
          {
            retryable: error?.retryable !== false,
            retryAt: normalizeEpochMs(
              Number(now()) + AGENDA_SCHEDULER_RETRY_DELAY_MS,
              "agenda.retryAt",
            ),
          },
        );
      }

      try {
        const completed = agendaStore.completeSchedulerExecution(expected.id, {
          occurrenceId: occurrence.id,
          snapshotDigest: expectedDigest,
          attempt: occurrence.attempt,
          outcome: "succeeded",
          result: action,
          ...(observation
            ? {
                monitorCheck: {
                  matched: observation.matched,
                  mtimeMs: observation.mtimeMs,
                  eventId: observation.eventId,
                  authority: observation.authority,
                },
              }
            : {}),
          atMs: now(),
        });
        const persistedAction = completed.schedulerExecution?.result || action;
        if (
          observation?.matched &&
          !observation.duplicate &&
          observation.notification
        ) {
          if (typeof notifyMonitor !== "function") {
            return {
              ...persistedAction,
              notifyError: "Agenda monitor notification handler is unavailable",
            };
          }
          try {
            await notifyMonitor(observation.notification);
          } catch (notifyError) {
            return {
              ...persistedAction,
              notifyError:
                typeof notifyError?.message === "string"
                  ? notifyError.message
                  : String(notifyError),
            };
          }
        }
        return persistedAction;
      } catch (completionError) {
        const persisted = agendaStore.get(expected.id);
        if (
          matchingExecutionEvidence(persisted, {
            occurrenceId: occurrence.id,
            snapshotDigest: expectedDigest,
            attempt: occurrence.attempt,
            status: "succeeded",
          })
        ) {
          return recoveredResult(expected, persisted.schedulerExecution);
        }
        throw agendaError(
          "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
          `Agenda agent finished but its durable outcome is unknown; refusing a retry: ${expected.id}`,
          undefined,
          completionError,
        );
      }
    },
    classifyError(error) {
      return {
        retryable: error?.retryable === true,
        ...(error?.retryAt === undefined ? {} : { retryAt: error.retryAt }),
      };
    },
  };
}

export class AgendaSchedulerBridge {
  constructor({
    agendaStore,
    schedulerStore,
    runAgent,
    runMonitor,
    notifyMonitor,
    now = Date.now,
    ownerId,
    leaseMs,
    renewIntervalMs,
  } = {}) {
    if (typeof now !== "function") {
      throw agendaError(
        "AGENDA_SCHEDULER_CLOCK_REQUIRED",
        "Agenda scheduler bridge requires a clock function",
      );
    }
    this.agendaStore = agendaStore;
    this.schedulerStore = schedulerStore;
    this.now = now;
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [
        createAgendaSchedulerAdapter({
          agendaStore,
          runAgent,
          runMonitor,
          notifyMonitor,
          now,
        }),
      ],
      authorize: authorizeAgendaOccurrence,
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(leaseMs === undefined ? {} : { leaseMs }),
      ...(renewIntervalMs === undefined ? {} : { renewIntervalMs }),
    });
  }

  async runDue({ signal } = {}) {
    const results = [];
    const observedOccurrences = new Set();
    const recovered = await this.runtime.runUntilIdle({
      limit: 10_000,
      signal,
      jobKind: AGENDA_SCHEDULER_KIND,
    });
    for (const result of recovered.results) {
      const occurrence = result.occurrence;
      const entry = occurrence?.payload?.entry;
      if (!entry?.id) continue;
      observedOccurrences.add(occurrence.id);
      results.push({
        entry: entry.id,
        kind: entry.kind,
        occurrence: occurrence.id,
        recovered: true,
        result,
      });
    }
    if (signal?.aborted) return results;

    const now = normalizeEpochMs(Number(this.now()), "now");
    const due = [
      ...this.agendaStore.due("wakeup", now),
      ...this.agendaStore.due("cron", now),
      ...this.agendaStore.due("monitor", now),
    ];
    for (const entry of due) {
      const occurrence = enqueueAgendaEntry(this.schedulerStore, entry);
      if (observedOccurrences.has(occurrence.id)) continue;
      const result = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      results.push({
        entry: entry.id,
        kind: entry.kind,
        occurrence: occurrence.id,
        deduplicated: occurrence.deduplicated,
        result,
      });
    }
    return results;
  }
}

export function agendaBridgeAction(entry) {
  const result = entry?.result;
  if (result?.status === "succeeded") {
    return result.result;
  }
  if (result?.status === "busy" || result?.status === "idle") return null;
  return {
    id: entry.entry,
    kind: entry.kind,
    action: "error",
    error: result?.error?.message || `agenda occurrence ${result?.status}`,
    ...(typeof result?.error?.code === "string"
      ? { errorCode: result.error.code }
      : {}),
  };
}
