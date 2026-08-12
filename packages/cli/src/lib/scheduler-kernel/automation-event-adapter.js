import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
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
  getTrigger,
  listTriggers,
} from "../automation-engine.js";
import {
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";
import { SchedulerRuntime } from "./runtime.js";

export const AUTOMATION_EVENT_KIND = "automation-event";
export const AUTOMATION_EVENT_CAPABILITY = "automation.execute";
export const AUTOMATION_EVENT_CHANNEL = "channel_event";
export const AUTOMATION_EVENT_TYPE = "channel.event";
export const AUTOMATION_EVENT_ORIGINS = Object.freeze(["telegram", "webhook"]);

const SCOPE_FIELDS = new Set(["origins", "senders"]);

function eventError(code, message, details = undefined, cause = undefined) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  error.retryable = false;
  return error;
}

function digest(namespace, value) {
  return createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value, namespace), "utf8")
    .digest("hex");
}

function normalizeIsoTime(value, field) {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INVALID",
      `${field} must be a valid timestamp`,
    );
  }
  return new Date(epoch).toISOString();
}

function normalizeIdentifierList(value, field, { required = false } = {}) {
  if (value == null) {
    if (required) {
      throw eventError(
        "AUTOMATION_EVENT_SCOPE_REQUIRED",
        `${field} is required`,
      );
    }
    return [];
  }
  if (!Array.isArray(value) || value.length > 64) {
    throw eventError(
      "AUTOMATION_EVENT_SCOPE_INVALID",
      `${field} must be an array with at most 64 entries`,
    );
  }
  const normalized = [
    ...new Set(
      value.map((entry, index) =>
        normalizeIdentifier(entry, `${field}[${index}]`),
      ),
    ),
  ].sort();
  if (required && normalized.length === 0) {
    throw eventError(
      "AUTOMATION_EVENT_SCOPE_REQUIRED",
      `${field} must not be empty`,
    );
  }
  return normalized;
}

function normalizeEventScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw eventError(
      "AUTOMATION_EVENT_SCOPE_REQUIRED",
      "event trigger config.scope is required",
    );
  }
  const unknown = Object.keys(value).filter((key) => !SCOPE_FIELDS.has(key));
  if (unknown.length > 0) {
    throw eventError(
      "AUTOMATION_EVENT_SCOPE_INVALID",
      "event trigger scope contains unknown fields",
      { fields: unknown.sort() },
    );
  }
  const origins = normalizeIdentifierList(value.origins, "scope.origins", {
    required: true,
  });
  for (const origin of origins) {
    if (!AUTOMATION_EVENT_ORIGINS.includes(origin)) {
      throw eventError(
        "AUTOMATION_EVENT_SCOPE_INVALID",
        `unsupported channel event origin: ${origin}`,
      );
    }
  }
  return {
    origins,
    senders: normalizeIdentifierList(value.senders, "scope.senders"),
  };
}

export function automationEventFlowSnapshot(flow) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INVALID",
      "channel event dispatch requires a flow object",
    );
  }
  const plain = normalizeJson(flow, "automationEventFlow");
  const id = normalizeIdentifier(plain.id, "automationEventFlow.id");
  if (
    typeof plain.name !== "string" ||
    !Array.isArray(plain.nodes) ||
    !Array.isArray(plain.edges) ||
    !Object.values(FLOW_STATUS).includes(plain.status)
  ) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INVALID",
      `automation flow is malformed: ${id}`,
    );
  }
  return {
    id,
    name: plain.name,
    description: typeof plain.description === "string" ? plain.description : "",
    nodes: plain.nodes,
    edges: plain.edges,
    status: plain.status,
    createdBy: typeof plain.createdBy === "string" ? plain.createdBy : null,
    sharedWith: Array.isArray(plain.sharedWith) ? plain.sharedWith : [],
    createdAt: normalizeIsoTime(
      plain.createdAt,
      "automationEventFlow.createdAt",
    ),
    updatedAt: normalizeIsoTime(
      plain.updatedAt,
      "automationEventFlow.updatedAt",
    ),
  };
}

export function automationEventTriggerSnapshot(trigger) {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INVALID",
      "channel event dispatch requires a trigger object",
    );
  }
  const plain = normalizeJson(trigger, "automationEventTrigger");
  const id = normalizeIdentifier(plain.id, "automationEventTrigger.id");
  const flowId = normalizeIdentifier(
    plain.flowId,
    "automationEventTrigger.flowId",
  );
  if (plain.type !== TRIGGER_TYPE.EVENT) {
    throw eventError(
      "AUTOMATION_EVENT_TRIGGER_UNSUPPORTED",
      `automation trigger is not an event trigger: ${id}`,
    );
  }
  const config = normalizeJson(
    plain.config || {},
    "automationEventTrigger.config",
  );
  if (config.event !== AUTOMATION_EVENT_TYPE) {
    throw eventError(
      "AUTOMATION_EVENT_TRIGGER_UNSUPPORTED",
      `event trigger must declare config.event=${AUTOMATION_EVENT_TYPE}: ${id}`,
    );
  }
  return {
    id,
    flowId,
    type: TRIGGER_TYPE.EVENT,
    config: {
      event: AUTOMATION_EVENT_TYPE,
      scope: normalizeEventScope(config.scope),
    },
    enabled: plain.enabled === true,
    createdAt: normalizeIsoTime(
      plain.createdAt,
      "automationEventTrigger.createdAt",
    ),
  };
}

export function normalizeAutomationChannelEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw eventError(
      "AUTOMATION_EVENT_INVALID",
      "channel event must be an object",
    );
  }
  const plain = normalizeJson(event, "automationChannelEvent");
  const origin = normalizeIdentifier(plain.origin, "channelEvent.origin", {
    maxLength: 64,
  });
  if (!AUTOMATION_EVENT_ORIGINS.includes(origin)) {
    throw eventError(
      "AUTOMATION_EVENT_INVALID",
      `unsupported channel event origin: ${origin}`,
    );
  }
  const type = normalizeIdentifier(
    plain.type || AUTOMATION_EVENT_TYPE,
    "channelEvent.type",
  );
  if (type !== AUTOMATION_EVENT_TYPE) {
    throw eventError(
      "AUTOMATION_EVENT_INVALID",
      `channel event type must be ${AUTOMATION_EVENT_TYPE}`,
    );
  }
  const text = typeof plain.text === "string" ? plain.text.trim() : "";
  if (!text || Buffer.byteLength(text, "utf8") > 64 * 1024) {
    throw eventError(
      "AUTOMATION_EVENT_INVALID",
      "channel event text must contain 1 to 65536 UTF-8 bytes",
    );
  }
  return {
    id: normalizeIdentifier(plain.id, "channelEvent.id"),
    type,
    origin,
    sender:
      plain.sender == null
        ? null
        : normalizeIdentifier(plain.sender, "channelEvent.sender"),
    text,
    meta: normalizeJson(plain.meta || {}, "channelEvent.meta"),
    producedAt: normalizeEpochMs(
      Number(plain.producedAt),
      "channelEvent.producedAt",
    ),
  };
}

export function automationChannelEventDigest(event) {
  return digest(
    "chainlesschain.scheduler.automation-channel-event.v1",
    normalizeAutomationChannelEvent(event),
  );
}

export function automationEventDefinitionDigest(flow, trigger) {
  return digest("chainlesschain.scheduler.automation-event-definition.v1", {
    flow: automationEventFlowSnapshot(flow),
    trigger: automationEventTriggerSnapshot(trigger),
  });
}

export function automationEventJobId(triggerId) {
  return `automation-event:${normalizeIdentifier(triggerId, "triggerId")}`;
}

export function automationEventExecutionId(occurrenceId) {
  const id = normalizeIdentifier(occurrenceId, "occurrenceId");
  return `exec-event-${createHash("sha256")
    .update(
      "chainlesschain.scheduler.automation-channel-execution.v1\0",
      "utf8",
    )
    .update(id, "utf8")
    .digest("hex")}`;
}

export function automationEventTriggerKey(event) {
  const normalized = normalizeAutomationChannelEvent(event);
  return `channel:${createHash("sha256")
    .update("chainlesschain.scheduler.automation-channel-trigger.v1\0", "utf8")
    .update(normalized.origin, "utf8")
    .update("\0", "utf8")
    .update(normalized.id, "utf8")
    .digest("hex")}`;
}

export function matchesAutomationChannelEvent(trigger, event) {
  const snapshot = automationEventTriggerSnapshot(trigger);
  const normalized = normalizeAutomationChannelEvent(event);
  const scope = snapshot.config.scope;
  return (
    scope.origins.includes(normalized.origin) &&
    (scope.senders.length === 0 ||
      (normalized.sender != null && scope.senders.includes(normalized.sender)))
  );
}

export function buildAutomationEventJob(flow, trigger, executionAuthority) {
  const flowSnapshot = automationEventFlowSnapshot(flow);
  const triggerSnapshot = automationEventTriggerSnapshot(trigger);
  if (triggerSnapshot.flowId !== flowSnapshot.id) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INVALID",
      `automation trigger does not belong to flow: ${triggerSnapshot.id}`,
    );
  }
  const definitionDigest = automationEventDefinitionDigest(
    flowSnapshot,
    triggerSnapshot,
  );
  const normalizedExecutionAuthority =
    normalizeAutomationExecutionAuthoritySnapshot(
      executionAuthority,
      flowSnapshot,
    );
  return {
    id: automationEventJobId(triggerSnapshot.id),
    kind: AUTOMATION_EVENT_KIND,
    trigger: {
      source: "event-runtime",
      channel: AUTOMATION_EVENT_CHANNEL,
      type: AUTOMATION_EVENT_TYPE,
      origins: triggerSnapshot.config.scope.origins,
    },
    payload: {
      channel: AUTOMATION_EVENT_CHANNEL,
      flow: flowSnapshot,
      trigger: triggerSnapshot,
      definitionDigest,
      executionAuthority: normalizedExecutionAuthority,
      executionAuthorityDigest: automationExecutionAuthorityDigest(
        normalizedExecutionAuthority,
        flowSnapshot,
      ),
    },
    authority: automationSchedulerAuthority(
      normalizedExecutionAuthority,
      flowSnapshot,
      AUTOMATION_EVENT_CAPABILITY,
    ),
    enabled:
      flowSnapshot.status === FLOW_STATUS.ACTIVE && triggerSnapshot.enabled,
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
    current != null &&
    canonicalJson(comparableJob(current), "currentAutomationEventJob") ===
      canonicalJson(comparableJob(desired), "desiredAutomationEventJob")
  );
}

export function syncAutomationEventJob(
  schedulerStore,
  flow,
  trigger,
  executionAuthority,
) {
  const desired = buildAutomationEventJob(flow, trigger, executionAuthority);
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
    return schedulerStore.updateJob(
      current.id,
      current.revision,
      comparableJob(desired),
    );
  } catch (error) {
    if (error?.code !== "SCHEDULER_REVISION_CONFLICT") throw error;
    const latest = schedulerStore.getJob(desired.id);
    if (sameJob(latest, desired)) return latest;
    throw error;
  }
}

export function enqueueAutomationChannelEvent(
  schedulerStore,
  flow,
  trigger,
  event,
  executionAuthority,
) {
  const normalizedEvent = normalizeAutomationChannelEvent(event);
  if (!matchesAutomationChannelEvent(trigger, normalizedEvent)) {
    throw eventError(
      "AUTOMATION_EVENT_SCOPE_DENIED",
      `channel event is outside trigger scope: ${trigger.id}`,
    );
  }
  const jobId = automationEventJobId(trigger.id);
  const triggerKey = automationEventTriggerKey(normalizedEvent);
  const eventDigest = automationChannelEventDigest(normalizedEvent);
  const prior = schedulerStore.listOccurrencesByTrigger({
    jobId,
    triggerKey,
    limit: 2,
  });
  if (prior.length > 1) {
    throw eventError(
      "AUTOMATION_EVENT_DUPLICATE_EVIDENCE",
      `multiple scheduler occurrences exist for one channel event: ${trigger.id}`,
    );
  }
  if (prior.length === 1) {
    if (prior[0].payload?.eventDigest !== eventDigest) {
      throw eventError(
        "AUTOMATION_EVENT_ID_COLLISION",
        `channel event id was reused with different content: ${normalizedEvent.id}`,
      );
    }
    return { ...prior[0], deduplicated: true };
  }

  const job = syncAutomationEventJob(
    schedulerStore,
    flow,
    trigger,
    executionAuthority,
  );
  if (!job.enabled) {
    throw eventError(
      "AUTOMATION_EVENT_DEFINITION_INACTIVE",
      `automation event trigger is not active: ${trigger.id}`,
    );
  }
  return schedulerStore.enqueueOccurrence({
    jobId: job.id,
    scheduledFor: normalizedEvent.producedAt,
    availableAt: normalizedEvent.producedAt,
    triggerKey,
    payload: {
      ...job.payload,
      event: normalizedEvent,
      eventDigest,
    },
  });
}

export function authorizeAutomationEventOccurrence({ job, occurrence }) {
  try {
    const payload = occurrence?.payload;
    const flow = automationEventFlowSnapshot(payload?.flow);
    const trigger = automationEventTriggerSnapshot(payload?.trigger);
    const event = normalizeAutomationChannelEvent(payload?.event);
    const executionAuthority = normalizeAutomationExecutionAuthoritySnapshot(
      payload?.executionAuthority,
      flow,
    );
    const executionAuthorityDigest = automationExecutionAuthorityDigest(
      executionAuthority,
      flow,
    );
    const expectedAuthority = automationSchedulerAuthority(
      executionAuthority,
      flow,
      AUTOMATION_EVENT_CAPABILITY,
    );
    const allowed =
      job?.kind === AUTOMATION_EVENT_KIND &&
      payload?.channel === AUTOMATION_EVENT_CHANNEL &&
      payload?.definitionDigest ===
        automationEventDefinitionDigest(flow, trigger) &&
      payload?.eventDigest === automationChannelEventDigest(event) &&
      trigger.flowId === flow.id &&
      matchesAutomationChannelEvent(trigger, event) &&
      occurrence?.triggerKey === automationEventTriggerKey(event) &&
      payload?.executionAuthorityDigest === executionAuthorityDigest &&
      canonicalJson(
        occurrence?.authority,
        "automationEventOccurrenceAuthority",
      ) ===
        canonicalJson(expectedAuthority, "expectedAutomationEventAuthority");
    return {
      allowed,
      reason: allowed
        ? "automation_event_snapshot_bound"
        : "automation_event_authority_mismatch",
    };
  } catch {
    return { allowed: false, reason: "automation_event_authority_malformed" };
  }
}

function existingExecutionResult(db, occurrence, expectedFlow) {
  const executionId = automationEventExecutionId(occurrence.id);
  const execution = getExecution(db, executionId);
  if (!execution) return null;
  if (
    execution.flowId !== expectedFlow.id ||
    execution.triggerType !== TRIGGER_TYPE.EVENT
  ) {
    throw eventError(
      "AUTOMATION_EVENT_EXECUTION_BINDING_MISMATCH",
      `automation event execution evidence is mismatched: ${occurrence.id}`,
    );
  }
  if (execution.status === EXECUTION_STATUS.RUNNING) {
    throw eventError(
      "AUTOMATION_EVENT_OUTCOME_UNKNOWN",
      `automation event outcome is unknown; refusing replay: ${execution.id}`,
      { executionId: execution.id },
    );
  }
  if (execution.status !== EXECUTION_STATUS.SUCCESS) {
    throw eventError(
      "AUTOMATION_EVENT_EXECUTION_FAILED",
      `automation event execution did not succeed: ${execution.id}`,
      { executionId: execution.id, status: execution.status },
    );
  }
  return execution;
}

export function createAutomationEventAdapter({ db, now = Date.now } = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw eventError(
      "AUTOMATION_EVENT_DATABASE_REQUIRED",
      "automation event adapter requires a compatible database",
    );
  }
  return {
    kind: AUTOMATION_EVENT_KIND,
    async execute({ occurrence }) {
      const payload = occurrence?.payload;
      const expectedFlow = automationEventFlowSnapshot(payload?.flow);
      const expectedTrigger = automationEventTriggerSnapshot(payload?.trigger);
      const expectedEvent = normalizeAutomationChannelEvent(payload?.event);
      if (
        payload?.channel !== AUTOMATION_EVENT_CHANNEL ||
        payload?.definitionDigest !==
          automationEventDefinitionDigest(expectedFlow, expectedTrigger) ||
        payload?.eventDigest !== automationChannelEventDigest(expectedEvent)
      ) {
        throw eventError(
          "AUTOMATION_EVENT_SNAPSHOT_INVALID",
          `automation event occurrence snapshot is invalid: ${occurrence?.id}`,
        );
      }

      const recovered = existingExecutionResult(db, occurrence, expectedFlow);
      if (recovered) return recovered;

      const currentFlow = getFlow(db, expectedFlow.id);
      const currentTrigger = getTrigger(db, expectedTrigger.id);
      if (
        !currentFlow ||
        currentFlow.status !== FLOW_STATUS.ACTIVE ||
        !currentTrigger?.enabled
      ) {
        throw eventError(
          "AUTOMATION_EVENT_DEFINITION_INACTIVE",
          `automation event definition is no longer active: ${expectedTrigger.id}`,
        );
      }
      if (
        automationEventDefinitionDigest(currentFlow, currentTrigger) !==
        payload.definitionDigest
      ) {
        throw eventError(
          "AUTOMATION_EVENT_STALE_SNAPSHOT",
          `automation event definition changed after enqueue: ${expectedTrigger.id}`,
        );
      }

      reserveAutomationExecutionAuthority(
        db,
        currentFlow,
        occurrence.id,
        payload.executionAuthority,
        payload.executionAuthorityDigest,
        { now },
      );

      let execution;
      try {
        execution = executeFlow(db, expectedFlow.id, {
          inputData: { event: expectedEvent },
          triggerType: TRIGGER_TYPE.EVENT,
          executionId: automationEventExecutionId(occurrence.id),
        });
      } catch (cause) {
        if (cause?.code === "AUTOMATION_EXECUTION_OUTCOME_UNKNOWN") {
          throw eventError(
            "AUTOMATION_EVENT_OUTCOME_UNKNOWN",
            cause.message,
            { executionId: automationEventExecutionId(occurrence.id) },
            cause,
          );
        }
        throw cause;
      }
      if (execution.status !== EXECUTION_STATUS.SUCCESS) {
        throw eventError(
          "AUTOMATION_EVENT_EXECUTION_FAILED",
          `automation event execution failed: ${execution.id}`,
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

export class AutomationEventDispatcher {
  constructor({
    db,
    schedulerStore,
    ownerId,
    leaseMs,
    renewIntervalMs,
    now = Date.now,
  } = {}) {
    this.db = db;
    this.schedulerStore = schedulerStore;
    this.runtime = new SchedulerRuntime({
      store: schedulerStore,
      adapters: [createAutomationEventAdapter({ db, now })],
      authorize: authorizeAutomationEventOccurrence,
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(leaseMs === undefined ? {} : { leaseMs }),
      ...(renewIntervalMs === undefined ? {} : { renewIntervalMs }),
    });
  }

  async dispatch(event, { signal } = {}) {
    const normalizedEvent = normalizeAutomationChannelEvent(event);
    const matches = [];
    const rejected = [];
    for (const trigger of listTriggers(this.db)) {
      if (!trigger.enabled || trigger.type !== TRIGGER_TYPE.EVENT) continue;
      try {
        if (!matchesAutomationChannelEvent(trigger, normalizedEvent)) continue;
        const flow = getFlow(this.db, trigger.flowId);
        if (!flow || flow.status !== FLOW_STATUS.ACTIVE) continue;
        matches.push({ flow, trigger });
      } catch (error) {
        rejected.push({
          triggerId: trigger.id,
          code: error?.code || "AUTOMATION_EVENT_SCOPE_INVALID",
          message: String(error?.message || error).slice(0, 1000),
        });
      }
    }
    matches.sort((a, b) => a.trigger.id.localeCompare(b.trigger.id));

    const results = [];
    for (const match of matches) {
      let occurrence;
      try {
        occurrence = enqueueAutomationChannelEvent(
          this.schedulerStore,
          match.flow,
          match.trigger,
          normalizedEvent,
          automationExecutionAuthoritySnapshot(this.db, match.flow),
        );
      } catch (error) {
        if (!String(error?.code || "").startsWith("AUTOMATION_EXECUTION_")) {
          throw error;
        }
        rejected.push({
          triggerId: match.trigger.id,
          code: error?.code || "AUTOMATION_EXECUTION_PREFLIGHT_REJECTED",
          message: String(error?.message || error).slice(0, 1000),
        });
        continue;
      }
      const result = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      results.push({
        flowId: match.flow.id,
        triggerId: match.trigger.id,
        occurrenceId: occurrence.id,
        deduplicated: occurrence.deduplicated === true,
        result,
      });
    }
    return {
      eventId: normalizedEvent.id,
      matched: matches.length,
      rejected,
      results,
    };
  }
}
