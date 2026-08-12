import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  advanceScheduleNextAt,
  adjudicateSchedulerScheduleFire,
  bindSchedulerScheduleFire,
  completeSchedulerScheduleFire,
  coworkCronFireKey,
  ensureScheduleNextAt,
  getSchedule,
  hasSecondsResolution,
  latestCoworkCronTime,
  loadSchedules,
  parseCron,
} from "../cowork-cron.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";
import {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
} from "./authority-resolver.js";

export const COWORK_CRON_SCHEDULER_KIND = "cowork-cron";
export const COWORK_CRON_SCHEDULER_CAPABILITY = "cowork.task.execute";
export const COWORK_CRON_SCHEDULER_RETRY_DELAY_MS = 60_000;

function coworkCronError(
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
        : "COWORK_CRON_TASK_FAILED",
    message:
      typeof error?.message === "string" && error.message
        ? error.message.slice(0, 2_000)
        : "Cowork cron task failed",
  };
}

function normalizedCwd(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw coworkCronError(
      "COWORK_CRON_CWD_INVALID",
      "Cowork cron scheduler requires a workspace path",
    );
  }
  const absolute = resolve(cwd);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function normalizeCreatedAt(value) {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch)) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      "Cowork cron schedule createdAt is invalid",
    );
  }
  return new Date(epoch).toISOString();
}

export function coworkCronScheduleSnapshot(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      "Cowork cron scheduler requires a schedule object",
    );
  }
  const id = normalizeIdentifier(schedule.id, "coworkCron.schedule.id");
  if (typeof schedule.cron !== "string" || schedule.cron.length === 0) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      `Cowork cron expression is missing: ${id}`,
    );
  }
  try {
    parseCron(schedule.cron, { timeZone: schedule.timeZone });
  } catch (cause) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      `Cowork cron expression is invalid: ${id}`,
      undefined,
      cause,
    );
  }
  if (
    typeof schedule.userMessage !== "string" ||
    schedule.userMessage.length === 0
  ) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      `Cowork cron userMessage is missing: ${id}`,
    );
  }
  const templateId =
    schedule.templateId === null || schedule.templateId === undefined
      ? null
      : normalizeIdentifier(
          String(schedule.templateId),
          "coworkCron.schedule.templateId",
        );
  const files = normalizeJson(
    Array.isArray(schedule.files) ? schedule.files : [],
    "coworkCron.schedule.files",
  );
  if (files.some((file) => typeof file !== "string" || file.length === 0)) {
    throw coworkCronError(
      "COWORK_CRON_SNAPSHOT_INVALID",
      `Cowork cron files are invalid: ${id}`,
    );
  }
  const timeZone =
    parseCron(schedule.cron, { timeZone: schedule.timeZone }).timeZone || null;
  return {
    id,
    cron: schedule.cron.trim(),
    ...(timeZone ? { timeZone } : {}),
    missedRunPolicy: "collapse",
    templateId,
    userMessage: schedule.userMessage,
    files,
    enabled: schedule.enabled === true,
    createdAt: normalizeCreatedAt(schedule.createdAt),
  };
}

export function coworkCronScheduleDigest(schedule) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.cowork-cron.v1\0", "utf8")
    .update(
      canonicalJson(
        coworkCronScheduleSnapshot(schedule),
        "coworkCronScheduleSnapshot",
      ),
      "utf8",
    )
    .digest("hex");
}

export function coworkCronWorkspaceId(cwd) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.cowork-workspace.v1\0", "utf8")
    .update(normalizedCwd(cwd), "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function coworkCronSchedulerJobId(cwd, scheduleId) {
  return `cowork-cron:${coworkCronWorkspaceId(cwd)}:${normalizeIdentifier(
    scheduleId,
    "coworkCron.scheduleId",
  )}`;
}

export function buildCoworkCronSchedulerJob(cwd, schedule) {
  const workspace = normalizedCwd(cwd);
  const snapshot = coworkCronScheduleSnapshot(schedule);
  return {
    id: coworkCronSchedulerJobId(workspace, snapshot.id),
    kind: COWORK_CRON_SCHEDULER_KIND,
    trigger: {
      source: "cowork-schedules-jsonl",
      expression: snapshot.cron,
      resolution: hasSecondsResolution(snapshot.cron) ? "second" : "minute",
      ...(snapshot.timeZone ? { timeZone: snapshot.timeZone } : {}),
      missedRunPolicy: snapshot.missedRunPolicy,
    },
    payload: {
      cwd: workspace,
      schedule: snapshot,
      snapshotDigest: coworkCronScheduleDigest(snapshot),
    },
    authority: {
      schemaVersion: 1,
      principal: { type: "cowork-cron", id: snapshot.id },
      tenantId: null,
      workspaceId: coworkCronWorkspaceId(workspace),
      requestedCapabilities: [COWORK_CRON_SCHEDULER_CAPABILITY],
      authorizationRefs: {
        decisionId: null,
        policyRevision: null,
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    },
    enabled: snapshot.enabled,
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
    canonicalJson(comparableJob(current), "currentCoworkCronJob") ===
      canonicalJson(comparableJob(desired), "desiredCoworkCronJob")
  );
}

export function syncCoworkCronSchedulerJob(schedulerStore, cwd, schedule) {
  const desired = buildCoworkCronSchedulerJob(cwd, schedule);
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

export function coworkCronScheduledFor(schedule, at) {
  const date = at instanceof Date ? new Date(at.getTime()) : new Date(at);
  if (!Number.isFinite(date.getTime())) {
    throw coworkCronError(
      "COWORK_CRON_FIRE_TIME_INVALID",
      "Cowork cron fire time is invalid",
    );
  }
  const matcher = parseCron(schedule.cron, { timeZone: schedule.timeZone });
  if (!matcher(date)) {
    throw coworkCronError(
      "COWORK_CRON_NOT_DUE",
      `Cowork cron schedule is not due: ${schedule.id}`,
    );
  }
  if (matcher.hasSeconds) date.setMilliseconds(0);
  else date.setSeconds(0, 0);
  return normalizeEpochMs(date.getTime(), "coworkCron.scheduledFor");
}

export function enqueueCoworkCronSchedule(schedulerStore, cwd, schedule, at) {
  const job = syncCoworkCronSchedulerJob(schedulerStore, cwd, schedule);
  const scheduledFor = coworkCronScheduledFor(schedule, at);
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    triggerKey: coworkCronFireKey(schedule, new Date(scheduledFor)),
  });
}

export function authorizeCoworkCronOccurrence({ job, occurrence }) {
  try {
    const payload = occurrence?.payload;
    const schedule = payload?.schedule;
    const authority = occurrence?.authority;
    const expectedDigest = coworkCronScheduleDigest(schedule);
    const allowed =
      job?.kind === COWORK_CRON_SCHEDULER_KIND &&
      authority?.principal?.type === "cowork-cron" &&
      authority?.principal?.id === schedule.id &&
      authority?.workspaceId === coworkCronWorkspaceId(payload.cwd) &&
      Array.isArray(authority?.requestedCapabilities) &&
      authority.requestedCapabilities.length === 1 &&
      authority.requestedCapabilities[0] === COWORK_CRON_SCHEDULER_CAPABILITY &&
      payload.snapshotDigest === expectedDigest;
    return {
      allowed,
      reason: allowed
        ? "cowork_cron_snapshot_bound"
        : "cowork_cron_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "cowork_cron_authority_malformed" };
  }
}

function matchingEvidence(
  schedule,
  { occurrenceId, snapshotDigest, attempt, status },
) {
  const evidence = schedule?.schedulerExecution;
  return (
    evidence?.occurrenceId === occurrenceId &&
    evidence.snapshotDigest === snapshotDigest &&
    evidence.attempt === attempt &&
    evidence.status === status
  );
}

function recoveredResult(schedule, evidence) {
  const result =
    evidence.result && typeof evidence.result === "object"
      ? evidence.result
      : {
          scheduleId: schedule.id,
          deliveryId: evidence.deliveryId,
          status: schedule.lastStatus || "completed",
        };
  return { ...result, recovered: true };
}

function recoveredLegacyResult(schedule, deliveryId) {
  return {
    scheduleId: schedule.id,
    deliveryId,
    taskId: null,
    status: schedule.lastStatus || "completed",
    recovered: true,
    legacyEvidence: true,
  };
}

export function createCoworkCronSchedulerAdapter({ runTask, now } = {}) {
  if (typeof runTask !== "function") {
    throw coworkCronError(
      "COWORK_CRON_RUNNER_REQUIRED",
      "Cowork cron scheduler adapter requires a runTask function",
    );
  }
  if (typeof now !== "function") {
    throw coworkCronError(
      "COWORK_CRON_CLOCK_REQUIRED",
      "Cowork cron scheduler adapter requires a clock function",
    );
  }
  return {
    kind: COWORK_CRON_SCHEDULER_KIND,
    async adjudicate({ occurrence, adjudication }) {
      const payload = occurrence.payload;
      const cwd = normalizedCwd(payload.cwd);
      const expected = coworkCronScheduleSnapshot(payload.schedule);
      const expectedDigest = coworkCronScheduleDigest(expected);
      if (payload.snapshotDigest !== expectedDigest) {
        throw coworkCronError(
          "COWORK_CRON_ADJUDICATION_SNAPSHOT_INVALID",
          `Cowork cron adjudication snapshot is invalid: ${occurrence.id}`,
        );
      }
      adjudicateSchedulerScheduleFire(cwd, expected.id, {
        deliveryId: occurrence.triggerKey,
        occurrenceId: occurrence.id,
        snapshotDigest: expectedDigest,
        attempt: adjudication.expectedAttempt,
        decision: adjudication.decision,
        requestId: adjudication.requestId,
        at: now(),
      });
      if (adjudication.decision === "confirmed_applied") {
        return {
          settled: true,
          result: {
            scheduleId: expected.id,
            deliveryId: occurrence.triggerKey,
            status: "adjudicated-applied",
            adjudicationRequestId: adjudication.requestId,
          },
        };
      }
      return { continue: true };
    },
    async execute({ occurrence, signal }) {
      const payload = occurrence.payload;
      const expected = coworkCronScheduleSnapshot(payload?.schedule);
      const expectedDigest = coworkCronScheduleDigest(expected);
      if (payload.snapshotDigest !== expectedDigest) {
        throw coworkCronError(
          "COWORK_CRON_SNAPSHOT_INVALID",
          `Cowork cron occurrence snapshot is invalid: ${occurrence.id}`,
        );
      }
      const cwd = normalizedCwd(payload.cwd);
      let current = getSchedule(cwd, expected.id);
      if (!current) {
        throw coworkCronError(
          "COWORK_CRON_SCHEDULE_NOT_FOUND",
          `Cowork cron schedule disappeared: ${expected.id}`,
        );
      }
      const prior = current.schedulerExecution;
      if (prior?.occurrenceId === occurrence.id) {
        if (prior.snapshotDigest !== expectedDigest) {
          throw coworkCronError(
            "COWORK_CRON_BINDING_MISMATCH",
            `Cowork cron evidence has a different snapshot: ${expected.id}`,
          );
        }
        if (prior.status === "succeeded") {
          return recoveredResult(current, prior);
        }
        if (prior.status === "running") {
          throw coworkCronError(
            "COWORK_CRON_OUTCOME_UNKNOWN",
            `Cowork cron task outcome is unknown; refusing duplicate execution: ${expected.id}`,
          );
        }
      } else if (prior?.status === "running") {
        throw coworkCronError(
          "COWORK_CRON_EXECUTION_CONFLICT",
          `Cowork cron schedule has another unresolved execution: ${expected.id}`,
        );
      }
      const deliveryId = occurrence.triggerKey;
      if (current.lastDeliveryId === deliveryId) {
        return recoveredLegacyResult(current, deliveryId);
      }
      if (coworkCronScheduleDigest(current) !== expectedDigest) {
        throw coworkCronError(
          "COWORK_CRON_STALE_SNAPSHOT",
          `Cowork cron schedule changed after enqueue: ${expected.id}`,
        );
      }
      if (current.enabled !== true) {
        throw coworkCronError(
          "COWORK_CRON_DISABLED",
          `Cowork cron schedule was disabled: ${expected.id}`,
        );
      }

      current = bindSchedulerScheduleFire(cwd, expected.id, {
        deliveryId,
        occurrenceId: occurrence.id,
        snapshotDigest: expectedDigest,
        attempt: occurrence.attempt,
        at: now(),
      });
      if (current.lastDeliveryId === deliveryId) {
        return recoveredLegacyResult(current, deliveryId);
      }
      if (coworkCronScheduleDigest(current) !== expectedDigest) {
        const stale = coworkCronError(
          "COWORK_CRON_STALE_SNAPSHOT",
          `Cowork cron schedule changed while binding: ${expected.id}`,
        );
        completeSchedulerScheduleFire(cwd, expected.id, {
          deliveryId,
          occurrenceId: occurrence.id,
          snapshotDigest: expectedDigest,
          attempt: occurrence.attempt,
          outcome: "failed",
          error: safeFailure(stale),
          at: now(),
        });
        throw stale;
      }

      let taskResult;
      try {
        taskResult = await runTask({
          templateId: expected.templateId,
          userMessage: expected.userMessage,
          files: expected.files,
          cwd,
          scheduleId: expected.id,
          deliveryId,
          schedulerOccurrenceId: occurrence.id,
          signal,
        });
        if (taskResult?.status !== "completed") {
          throw coworkCronError(
            "COWORK_CRON_TASK_REPORTED_FAILED",
            typeof taskResult?.result?.summary === "string"
              ? taskResult.result.summary
              : `Cowork cron task returned a non-completed status: ${taskResult?.status || "missing"}`,
            {
              taskId:
                typeof taskResult?.taskId === "string"
                  ? taskResult.taskId
                  : null,
              status:
                typeof taskResult?.status === "string"
                  ? taskResult.status
                  : null,
            },
          );
        }
      } catch (error) {
        const retryAt = normalizeEpochMs(
          new Date(now()).getTime() + COWORK_CRON_SCHEDULER_RETRY_DELAY_MS,
          "coworkCron.retryAt",
        );
        let persisted = false;
        try {
          completeSchedulerScheduleFire(cwd, expected.id, {
            deliveryId,
            occurrenceId: occurrence.id,
            snapshotDigest: expectedDigest,
            attempt: occurrence.attempt,
            outcome: "failed",
            error: safeFailure(error),
            retryAt,
            at: now(),
          });
          persisted = true;
        } catch (completionError) {
          persisted = matchingEvidence(getSchedule(cwd, expected.id), {
            occurrenceId: occurrence.id,
            snapshotDigest: expectedDigest,
            attempt: occurrence.attempt,
            status: "failed",
          });
          if (!persisted) {
            throw coworkCronError(
              "COWORK_CRON_FAILURE_PERSIST_FAILED",
              `Cowork cron failure evidence could not be persisted: ${expected.id}`,
              undefined,
              completionError,
            );
          }
        }
        throw coworkCronError(
          typeof error?.code === "string"
            ? error.code
            : "COWORK_CRON_TASK_FAILED",
          typeof error?.message === "string"
            ? error.message
            : `Cowork cron task failed: ${expected.id}`,
          undefined,
          error,
          { retryable: true, retryAt },
        );
      }

      const action = {
        scheduleId: expected.id,
        deliveryId,
        taskId: taskResult?.taskId || null,
        status: taskResult?.status || "completed",
      };
      try {
        completeSchedulerScheduleFire(cwd, expected.id, {
          deliveryId,
          occurrenceId: occurrence.id,
          snapshotDigest: expectedDigest,
          attempt: occurrence.attempt,
          outcome: "succeeded",
          result: action,
          at: now(),
        });
        return action;
      } catch (completionError) {
        const persisted = getSchedule(cwd, expected.id);
        if (
          matchingEvidence(persisted, {
            occurrenceId: occurrence.id,
            snapshotDigest: expectedDigest,
            attempt: occurrence.attempt,
            status: "succeeded",
          })
        ) {
          return recoveredResult(persisted, persisted.schedulerExecution);
        }
        throw coworkCronError(
          "COWORK_CRON_OUTCOME_UNKNOWN",
          `Cowork cron task finished but durable outcome is unknown; refusing retry: ${expected.id}`,
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

export class CoworkCronSchedulerBridge {
  constructor({
    cwd,
    schedulerStore,
    runTask,
    now = () => new Date(),
    ownerId,
    leaseMs,
    renewIntervalMs,
    authorityResolver,
  } = {}) {
    if (!schedulerStore) {
      throw coworkCronError(
        "COWORK_CRON_SCHEDULER_STORE_REQUIRED",
        "Cowork cron bridge requires a scheduler store",
      );
    }
    if (typeof now !== "function") {
      throw coworkCronError(
        "COWORK_CRON_CLOCK_REQUIRED",
        "Cowork cron bridge requires a clock function",
      );
    }
    this.cwd = normalizedCwd(cwd);
    this.schedulerStore = schedulerStore;
    this.now = now;
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [createCoworkCronSchedulerAdapter({ runTask, now })],
      authorize:
        authorityResolver ||
        createSchedulerAuthorityResolver({
          store: schedulerStore,
          validate: authorizeCoworkCronOccurrence,
        }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(leaseMs === undefined ? {} : { leaseMs }),
      ...(renewIntervalMs === undefined ? {} : { renewIntervalMs }),
    });
  }

  async runDue({ signal } = {}) {
    const results = [];
    const observed = new Set();
    const recovered = await this.runtime.runUntilIdle({
      limit: 10_000,
      signal,
      jobKind: COWORK_CRON_SCHEDULER_KIND,
      workspaceId: coworkCronWorkspaceId(this.cwd),
    });
    for (const result of recovered.results) {
      const occurrence = result.occurrence;
      const schedule = occurrence?.payload?.schedule;
      if (!schedule?.id) continue;
      observed.add(occurrence.id);
      results.push({
        schedule: schedule.id,
        occurrence: occurrence.id,
        recovered: true,
        result,
      });
    }
    if (signal?.aborted) return results;

    const at = this.now();
    const date = at instanceof Date ? new Date(at.getTime()) : new Date(at);
    if (!Number.isFinite(date.getTime())) {
      throw coworkCronError(
        "COWORK_CRON_FIRE_TIME_INVALID",
        "Cowork cron bridge clock returned an invalid date",
      );
    }
    const schedules = loadSchedules(this.cwd, { failOnMalformed: true });
    for (const loadedSchedule of schedules) {
      let schedule = loadedSchedule;
      if (schedule.enabled !== true) continue;
      if (!Number.isSafeInteger(Number(schedule.nextAt))) {
        schedule = ensureScheduleNextAt(this.cwd, schedule.id, date);
      }
      if (schedule?.nextAt === null) continue;
      const scheduledFor = schedule?.nextAt;
      if (
        typeof scheduledFor !== "number" ||
        !Number.isSafeInteger(scheduledFor) ||
        scheduledFor > date.getTime()
      ) {
        continue;
      }
      const collapsedFor = latestCoworkCronTime(
        schedule.cron,
        scheduledFor,
        date.getTime(),
        { timeZone: schedule.timeZone },
      );
      const scheduledDate = new Date(collapsedFor);
      const deliveryId = coworkCronFireKey(schedule, scheduledDate);
      if (schedule.lastDeliveryId === deliveryId) {
        advanceScheduleNextAt(this.cwd, schedule.id, {
          expectedNextAt: scheduledFor,
          from: date,
        });
        continue;
      }
      const occurrence = enqueueCoworkCronSchedule(
        this.schedulerStore,
        this.cwd,
        schedule,
        scheduledDate,
      );
      advanceScheduleNextAt(this.cwd, schedule.id, {
        expectedNextAt: scheduledFor,
        from: scheduledDate,
      });
      if (observed.has(occurrence.id)) continue;
      const result = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      results.push({
        schedule: schedule.id,
        occurrence: occurrence.id,
        deduplicated: occurrence.deduplicated,
        result,
      });
    }
    return results;
  }
}

export class CoworkCronKernelScheduler {
  constructor({
    cwd = process.cwd(),
    schedulerStore,
    runTask,
    now = () => new Date(),
    intervalMs,
    onEvent,
    ownerId = `cowork-cron:${process.pid}:${randomUUID()}`,
    leaseMs,
  } = {}) {
    this.cwd = normalizedCwd(cwd);
    this.schedulerStore = schedulerStore;
    this.now = now;
    this.onEvent = onEvent;
    this._intervalPinned = typeof intervalMs === "number";
    this.intervalMs = intervalMs || 60_000;
    this._timer = null;
    this._tickPromise = null;
    this.bridge = new CoworkCronSchedulerBridge({
      cwd: this.cwd,
      schedulerStore,
      runTask,
      now,
      ownerId,
      ...(leaseMs === undefined ? {} : { leaseMs }),
    });
  }

  _emit(event) {
    if (typeof this.onEvent !== "function") return;
    try {
      this.onEvent(event);
    } catch {
      // Observers cannot break the scheduler.
    }
  }

  _adaptInterval() {
    if (this._intervalPinned) return;
    const schedules = loadSchedules(this.cwd);
    const wantsSeconds = schedules.some(
      (schedule) =>
        schedule.enabled === true && hasSecondsResolution(schedule.cron),
    );
    const desired = wantsSeconds ? 1_000 : 60_000;
    if (desired === this.intervalMs) return;
    this.intervalMs = desired;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = setInterval(() => void this.tick(), this.intervalMs);
      this._emit({ type: "scheduler-retuned", intervalMs: this.intervalMs });
    }
  }

  start() {
    if (this._timer) return;
    this._adaptInterval();
    void this.tick();
    this._timer = setInterval(() => void this.tick(), this.intervalMs);
    this._emit({ type: "scheduler-started", intervalMs: this.intervalMs });
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._emit({ type: "scheduler-stopped" });
  }

  async tick({ signal } = {}) {
    if (this._tickPromise) return this._tickPromise;
    this._tickPromise = (async () => {
      try {
        this._adaptInterval();
        const entries = await this.bridge.runDue({ signal });
        for (const entry of entries) {
          const result = entry.result;
          if (result.status === "succeeded") {
            this._emit({
              type: "schedule-completed",
              id: entry.schedule,
              occurrenceId: entry.occurrence,
              ...result.result,
            });
          } else if (result.status === "retry_wait") {
            this._emit({
              type: "schedule-retry",
              id: entry.schedule,
              occurrenceId: entry.occurrence,
              error: result.error?.message,
            });
          } else if (!["busy", "idle"].includes(result.status)) {
            this._emit({
              type: "schedule-failed",
              id: entry.schedule,
              occurrenceId: entry.occurrence,
              error: result.error?.message || result.status,
            });
          }
        }
        return entries;
      } catch (error) {
        this._emit({ type: "scheduler-error", error: error.message });
        return [];
      } finally {
        this._tickPromise = null;
      }
    })();
    return this._tickPromise;
  }
}
