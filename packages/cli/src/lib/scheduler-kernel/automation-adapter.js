import { createHash } from "node:crypto";
import { nextCronTime } from "../agent-schedule-store.js";
import {
  automationExecutionAuthorityDigest,
  automationExecutionAuthoritySnapshot,
  automationSchedulerAuthority,
  normalizeAutomationExecutionAuthoritySnapshot,
  reserveAutomationExecutionAuthority,
} from "../automation-execution-authority.js";
import {
  EXECUTION_STATUS,
  FLOW_STATUS,
  TRIGGER_TYPE,
  executeFlow,
  getExecution,
  getFlow,
  listFlows,
} from "../automation-engine.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";

export const AUTOMATION_SCHEDULER_KIND = "automation";
export const AUTOMATION_SCHEDULER_CAPABILITY = "automation.execute";
export const AUTOMATION_SCHEDULER_CHANNEL = "scheduled";
export const AUTOMATION_SCHEDULER_MAX_CATCHUP_STEPS = 527_040;

function automationError(
  code,
  message,
  details = undefined,
  cause = undefined,
) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  // Flow execution may eventually perform connector side effects. Unless a
  // future adapter can prove an attempt did not start, never replay it merely
  // because the process or settlement failed.
  error.retryable = false;
  return error;
}

function normalizeIsoTime(value, field) {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_INVALID",
      `${field} must be a valid timestamp`,
    );
  }
  return new Date(epoch).toISOString();
}

function normalizeFlow(flow) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_INVALID",
      "Automation scheduler requires a flow object",
    );
  }
  const plain = normalizeJson(flow, "automationFlow");
  const id = normalizeIdentifier(plain.id, "automationFlow.id");
  if (typeof plain.name !== "string" || plain.name.length === 0) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_INVALID",
      `Automation flow name is missing: ${id}`,
    );
  }
  if (!Array.isArray(plain.nodes) || !Array.isArray(plain.edges)) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_INVALID",
      `Automation flow graph is malformed: ${id}`,
    );
  }
  if (!Object.values(FLOW_STATUS).includes(plain.status)) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_INVALID",
      `Automation flow status is invalid: ${id}`,
    );
  }
  if (typeof plain.schedule !== "string" || plain.schedule.length === 0) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_UNSCHEDULED",
      `Automation flow has no cron schedule: ${id}`,
    );
  }
  // Parsing here binds the accepted cron dialect into the snapshot contract.
  nextCronTime(plain.schedule, Date.now());
  return {
    id,
    name: plain.name,
    description: typeof plain.description === "string" ? plain.description : "",
    nodes: plain.nodes,
    edges: plain.edges,
    status: plain.status,
    schedule: plain.schedule,
    createdBy: typeof plain.createdBy === "string" ? plain.createdBy : null,
    sharedWith: Array.isArray(plain.sharedWith) ? plain.sharedWith : [],
    createdAt: normalizeIsoTime(plain.createdAt, "automationFlow.createdAt"),
    updatedAt: normalizeIsoTime(plain.updatedAt, "automationFlow.updatedAt"),
  };
}

export function automationFlowSnapshot(flow) {
  return normalizeFlow(flow);
}

export function automationFlowSnapshotDigest(flow) {
  return createHash("sha256")
    .update("chainlesschain.scheduler.automation-flow.v1\0", "utf8")
    .update(
      canonicalJson(automationFlowSnapshot(flow), "automationFlowSnapshot"),
      "utf8",
    )
    .digest("hex");
}

export function automationSchedulerJobId(flowId) {
  return `automation:${normalizeIdentifier(flowId, "automationFlowId")}:scheduled`;
}

export function automationSchedulerExecutionId(occurrenceId) {
  const id = normalizeIdentifier(occurrenceId, "occurrenceId");
  const digest = createHash("sha256")
    .update("chainlesschain.scheduler.automation-execution.v1\0", "utf8")
    .update(id, "utf8")
    .digest("hex");
  return `exec-scheduler-${digest}`;
}

export function buildAutomationSchedulerJob(flow, executionAuthority) {
  const snapshot = automationFlowSnapshot(flow);
  const normalizedExecutionAuthority =
    normalizeAutomationExecutionAuthoritySnapshot(executionAuthority, snapshot);
  return {
    id: automationSchedulerJobId(snapshot.id),
    kind: AUTOMATION_SCHEDULER_KIND,
    trigger: {
      source: "automation-engine",
      channel: AUTOMATION_SCHEDULER_CHANNEL,
      cron: snapshot.schedule,
    },
    payload: {
      channel: AUTOMATION_SCHEDULER_CHANNEL,
      flow: snapshot,
      snapshotDigest: automationFlowSnapshotDigest(snapshot),
      executionAuthority: normalizedExecutionAuthority,
      executionAuthorityDigest: automationExecutionAuthorityDigest(
        normalizedExecutionAuthority,
        snapshot,
      ),
    },
    authority: automationSchedulerAuthority(
      normalizedExecutionAuthority,
      snapshot,
      AUTOMATION_SCHEDULER_CAPABILITY,
    ),
    enabled: snapshot.status === FLOW_STATUS.ACTIVE,
    // A reclaimed occurrence needs a second attempt to read deterministic
    // execution evidence. Adapter errors themselves remain non-retryable.
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
    canonicalJson(comparableJob(current), "currentAutomationJob") ===
      canonicalJson(comparableJob(desired), "desiredAutomationJob")
  );
}

export function syncAutomationSchedulerJob(
  schedulerStore,
  flow,
  executionAuthority,
) {
  const desired = buildAutomationSchedulerJob(flow, executionAuthority);
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

function latestEnqueuedScheduledFor(schedulerStore, jobId) {
  const event = schedulerStore
    .history({ jobId, limit: 100 })
    .find(
      (candidate) =>
        candidate.type === "occurrence_enqueued" &&
        Number.isSafeInteger(candidate.data?.scheduledFor),
    );
  return event?.data?.scheduledFor ?? null;
}

/**
 * Return the next logical occurrence, collapsing missed cron periods to the
 * latest due minute. This preserves the existing Agenda invariant: downtime
 * causes one catch-up execution, never an unbounded replay storm.
 */
export function scheduledAutomationFireAt(schedulerStore, flow, now) {
  const snapshot = automationFlowSnapshot(flow);
  const currentTime = normalizeEpochMs(Number(now), "now");
  const jobId = automationSchedulerJobId(snapshot.id);
  const lastEnqueued = latestEnqueuedScheduledFor(schedulerStore, jobId);
  const definitionUpdatedAt = Date.parse(snapshot.updatedAt);
  const initial = normalizeEpochMs(
    Math.max(lastEnqueued ?? 0, definitionUpdatedAt),
    "automation schedule cursor",
  );
  let next = nextCronTime(snapshot.schedule, initial);
  if (next === null) {
    throw automationError(
      "AUTOMATION_SCHEDULER_NO_NEXT_FIRE",
      `Automation cron has no next occurrence: ${snapshot.id}`,
    );
  }
  let latestDue = null;
  let steps = 0;
  while (next <= currentTime) {
    latestDue = next;
    steps += 1;
    if (steps > AUTOMATION_SCHEDULER_MAX_CATCHUP_STEPS) {
      throw automationError(
        "AUTOMATION_SCHEDULER_CATCHUP_RANGE_EXCEEDED",
        `Automation cron catch-up exceeds the supported range: ${snapshot.id}`,
      );
    }
    next = nextCronTime(snapshot.schedule, next);
    if (next === null) break;
  }
  return latestDue ?? next;
}

export function enqueueScheduledAutomation(
  schedulerStore,
  flow,
  now,
  executionAuthority,
) {
  const job = syncAutomationSchedulerJob(
    schedulerStore,
    flow,
    executionAuthority,
  );
  if (!job.enabled) {
    throw automationError(
      "AUTOMATION_SCHEDULER_FLOW_NOT_ACTIVE",
      `Automation flow is not active: ${flow.id}`,
    );
  }
  const scheduledFor = scheduledAutomationFireAt(schedulerStore, flow, now);
  if (scheduledFor === null || scheduledFor > now) return null;
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor,
    triggerKey: `cron:${scheduledFor}`,
  });
}

export function authorizeAutomationOccurrence({ job, occurrence }) {
  try {
    const payload = occurrence?.payload;
    const authority = occurrence?.authority;
    const flowId = payload?.flow?.id;
    const expectedDigest = automationFlowSnapshotDigest(payload?.flow);
    const executionAuthority = normalizeAutomationExecutionAuthoritySnapshot(
      payload?.executionAuthority,
      payload?.flow,
    );
    const executionAuthorityDigest = automationExecutionAuthorityDigest(
      executionAuthority,
      payload?.flow,
    );
    const expectedAuthority = automationSchedulerAuthority(
      executionAuthority,
      payload?.flow,
      AUTOMATION_SCHEDULER_CAPABILITY,
    );
    const allowed =
      job?.kind === AUTOMATION_SCHEDULER_KIND &&
      payload?.channel === AUTOMATION_SCHEDULER_CHANNEL &&
      executionAuthority.flowId === flowId &&
      payload?.executionAuthorityDigest === executionAuthorityDigest &&
      canonicalJson(authority, "automationOccurrenceAuthority") ===
        canonicalJson(expectedAuthority, "expectedAutomationAuthority") &&
      payload?.snapshotDigest === expectedDigest;
    return {
      allowed,
      reason: allowed
        ? "automation_snapshot_bound"
        : "automation_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "automation_authority_malformed" };
  }
}

function existingExecutionResult(db, occurrence, expected) {
  const executionId = automationSchedulerExecutionId(occurrence.id);
  const execution = getExecution(db, executionId);
  if (!execution) return null;
  if (
    execution.flowId !== expected.id ||
    execution.triggerType !== TRIGGER_TYPE.SCHEDULE
  ) {
    throw automationError(
      "AUTOMATION_SCHEDULER_EXECUTION_BINDING_MISMATCH",
      `Automation execution evidence does not match occurrence: ${occurrence.id}`,
    );
  }
  if (execution.status === EXECUTION_STATUS.RUNNING) {
    throw automationError(
      "AUTOMATION_SCHEDULER_OUTCOME_UNKNOWN",
      `Automation outcome is unknown; refusing duplicate execution: ${execution.id}`,
      { executionId: execution.id },
    );
  }
  if (execution.status !== EXECUTION_STATUS.SUCCESS) {
    throw automationError(
      "AUTOMATION_SCHEDULER_EXECUTION_FAILED",
      `Automation execution did not succeed: ${execution.id}`,
      { executionId: execution.id, status: execution.status },
    );
  }
  return execution;
}

export function createAutomationSchedulerAdapter({ db, now = Date.now } = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw automationError(
      "AUTOMATION_SCHEDULER_DATABASE_REQUIRED",
      "Automation scheduler adapter requires a compatible database",
    );
  }
  return {
    kind: AUTOMATION_SCHEDULER_KIND,
    async execute({ occurrence }) {
      const payload = occurrence?.payload;
      const expected = automationFlowSnapshot(payload?.flow);
      const expectedDigest = automationFlowSnapshotDigest(expected);
      if (
        payload?.channel !== AUTOMATION_SCHEDULER_CHANNEL ||
        payload?.snapshotDigest !== expectedDigest
      ) {
        throw automationError(
          "AUTOMATION_SCHEDULER_SNAPSHOT_INVALID",
          `Automation occurrence snapshot is invalid: ${occurrence?.id}`,
        );
      }

      // A prior process may have committed the flow result and died before the
      // scheduler settlement. Durable success is authoritative even if the flow
      // was subsequently paused or edited.
      const recovered = existingExecutionResult(db, occurrence, expected);
      if (recovered) return recovered;

      const current = getFlow(db, expected.id);
      if (!current) {
        throw automationError(
          "AUTOMATION_SCHEDULER_FLOW_NOT_FOUND",
          `Automation flow disappeared before execution: ${expected.id}`,
        );
      }
      if (current.status !== FLOW_STATUS.ACTIVE) {
        throw automationError(
          "AUTOMATION_SCHEDULER_FLOW_NOT_ACTIVE",
          `Automation flow is not active: ${expected.id}`,
        );
      }
      if (automationFlowSnapshotDigest(current) !== expectedDigest) {
        throw automationError(
          "AUTOMATION_SCHEDULER_STALE_SNAPSHOT",
          `Automation flow changed after occurrence enqueue: ${expected.id}`,
        );
      }

      reserveAutomationExecutionAuthority(
        db,
        current,
        occurrence.id,
        payload.executionAuthority,
        payload.executionAuthorityDigest,
        { now },
      );

      let execution;
      try {
        execution = executeFlow(db, expected.id, {
          inputData: {},
          triggerType: TRIGGER_TYPE.SCHEDULE,
          executionId: automationSchedulerExecutionId(occurrence.id),
        });
      } catch (cause) {
        if (cause?.code === "AUTOMATION_EXECUTION_OUTCOME_UNKNOWN") {
          throw automationError(
            "AUTOMATION_SCHEDULER_OUTCOME_UNKNOWN",
            cause.message,
            { executionId: automationSchedulerExecutionId(occurrence.id) },
            cause,
          );
        }
        throw cause;
      }
      if (execution.status !== EXECUTION_STATUS.SUCCESS) {
        throw automationError(
          "AUTOMATION_SCHEDULER_EXECUTION_FAILED",
          `Automation execution failed: ${execution.id}`,
          { executionId: execution.id, error: execution.error },
        );
      }
      return execution;
    },
    classifyError() {
      return { retryable: false };
    },
  };
}

export class AutomationSchedulerBridge {
  constructor({
    db,
    schedulerStore,
    now = Date.now,
    ownerId,
    leaseMs,
    renewIntervalMs,
  } = {}) {
    if (typeof now !== "function") {
      throw automationError(
        "AUTOMATION_SCHEDULER_CLOCK_REQUIRED",
        "Automation scheduler bridge requires a clock function",
      );
    }
    this.db = db;
    this.schedulerStore = schedulerStore;
    this.now = now;
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db, now })],
      authorize: authorizeAutomationOccurrence,
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
      jobKind: AUTOMATION_SCHEDULER_KIND,
    });
    for (const result of recovered.results) {
      const occurrence = result.occurrence;
      const flowId = occurrence?.payload?.flow?.id;
      if (typeof flowId !== "string") continue;
      observedOccurrences.add(occurrence.id);
      results.push({
        flow: flowId,
        occurrence: occurrence.id,
        recovered: true,
        result,
      });
    }
    if (signal?.aborted) return results;

    const now = normalizeEpochMs(Number(this.now()), "now");
    const flows = listFlows(this.db, {
      status: FLOW_STATUS.ACTIVE,
      limit: 10_000,
    }).filter((flow) => typeof flow.schedule === "string" && flow.schedule);
    for (const flow of flows) {
      let occurrence;
      try {
        occurrence = enqueueScheduledAutomation(
          this.schedulerStore,
          flow,
          now,
          automationExecutionAuthoritySnapshot(this.db, flow),
        );
      } catch (error) {
        if (!String(error?.code || "").startsWith("AUTOMATION_EXECUTION_")) {
          throw error;
        }
        results.push({
          flow: flow.id,
          occurrence: null,
          rejected: true,
          result: {
            status: "rejected",
            error: {
              code: error?.code || "AUTOMATION_EXECUTION_PREFLIGHT_REJECTED",
              message: String(error?.message || error).slice(0, 1000),
            },
          },
        });
        continue;
      }
      if (!occurrence || observedOccurrences.has(occurrence.id)) continue;
      const result = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      results.push({
        flow: flow.id,
        occurrence: occurrence.id,
        deduplicated: occurrence.deduplicated,
        result,
      });
    }
    return results;
  }
}
