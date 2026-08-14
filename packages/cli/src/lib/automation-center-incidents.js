import { createHash } from "node:crypto";
import {
  AUTOMATION_EXECUTION_INCIDENT_STATUS,
  cancelAutomationExecutionIncident,
  getAutomationExecutionIncident,
} from "./automation-execution-incident.js";
import {
  automationSchedulerExecutionId,
  automationSchedulerJobId,
} from "./scheduler-kernel/automation-adapter.js";
import {
  automationEventExecutionId,
  automationEventJobId,
} from "./scheduler-kernel/automation-event-adapter.js";
import {
  SchedulerKernelError,
  normalizeIdentifier,
} from "./scheduler-kernel/contract.js";

export const AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA =
  "chainlesschain.automation-center-incident-action/v1";
export const AUTOMATION_CENTER_INCIDENT_ACTION_ERROR_SCHEMA =
  "chainlesschain.automation-center-incident-action-error/v1";
export const AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA_VERSION = 1;

const INCIDENT_ACTIONS = new Set(["retry", "cancel"]);
const SCHEDULER_TRIGGER_TYPES = new Set(["schedule", "event"]);
const INCIDENT_ID_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_INCIDENT_ERROR_CODES = new Set([
  "AUTOMATION_CENTER_INCIDENT_REVISION_INVALID",
  "AUTOMATION_CENTER_INCIDENT_ACTION_INVALID",
  "AUTOMATION_CENTER_INCIDENT_NOT_FOUND",
  "AUTOMATION_CENTER_INCIDENT_STALE",
  "AUTOMATION_CENTER_INCIDENT_CLOSED",
  "AUTOMATION_CENTER_INCIDENT_RETRY_UNSUPPORTED",
  "AUTOMATION_CENTER_INCIDENT_SCHEDULER_REQUIRED",
  "AUTOMATION_CENTER_INCIDENT_EVIDENCE_CONFLICT",
]);

function incidentActionError(code, message) {
  const error = new SchedulerKernelError(code, message);
  error.retryable = false;
  return error;
}

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_REVISION_INVALID",
      "expectedRevision must be a positive safe integer",
    );
  }
  return revision;
}

function actionPreview(incidentId, action, revision) {
  return {
    executor: "cli",
    argv: [
      "automation",
      "center-incident-action",
      incidentId,
      action,
      "--expected-revision",
      String(revision),
      "--json",
    ],
    mutates: true,
  };
}

function projectedAction(incident, action, available, reason) {
  return {
    id: action,
    available,
    reason: available ? null : reason,
    preview: available
      ? actionPreview(incident.incidentId, action, incident.revision)
      : null,
  };
}

/**
 * Project only identifiers and lifecycle metadata intended for an IDE boundary.
 * In particular, authority, boundary, and details evidence never cross it.
 */
export function projectAutomationCenterIncident(incident) {
  const open = incident.status === AUTOMATION_EXECUTION_INCIDENT_STATUS.OPEN;
  const schedulerBacked =
    Boolean(incident.occurrenceId) &&
    SCHEDULER_TRIGGER_TYPES.has(incident.triggerType);
  return {
    incidentId: incident.incidentId,
    runId: incident.runId,
    occurrenceId: incident.occurrenceId || null,
    triggerType: incident.triggerType,
    category: incident.category,
    code: incident.code,
    status: incident.status,
    revision: incident.revision,
    createdAtMs: incident.createdAtMs,
    updatedAtMs: incident.updatedAtMs,
    actions: [
      projectedAction(
        incident,
        "retry",
        open && schedulerBacked,
        !open
          ? "incident is already closed"
          : "manual incidents cannot be retried safely",
      ),
      projectedAction(incident, "cancel", open, "incident is already closed"),
    ],
  };
}

function retryRequestId(incident, occurrence) {
  const digest = createHash("sha256")
    .update("chainlesschain.automation-center.incident-retry.v1\0", "utf8")
    .update(incident.incidentId, "utf8")
    .update("\0", "utf8")
    .update(String(incident.revision), "utf8")
    .update("\0", "utf8")
    // A dead-letter fence identifies one exact failed scheduler attempt. This
    // keeps repeated clicks idempotent while that attempt is being requeued,
    // but permits a fresh operator retry after the requeued attempt advances
    // its fence and fails again.
    .update(String(occurrence.fence), "utf8")
    .digest("hex");
  return `center-incident-retry-${digest}`;
}

function expectedSchedulerIdentity(incident) {
  if (incident.triggerType === "schedule") {
    return {
      jobId: automationSchedulerJobId(incident.flowId),
      runId: automationSchedulerExecutionId(incident.occurrenceId),
      triggerId: null,
    };
  }
  if (incident.triggerType === "event" && incident.triggerId) {
    return {
      jobId: automationEventJobId(incident.triggerId),
      runId: automationEventExecutionId(incident.occurrenceId),
      triggerId: incident.triggerId,
    };
  }
  throw incidentActionError(
    "AUTOMATION_CENTER_INCIDENT_RETRY_UNSUPPORTED",
    "incident is not bound to a supported scheduler occurrence",
  );
}

function assertExactSchedulerEvidence(incident, occurrence) {
  const expected = expectedSchedulerIdentity(incident);
  const payloadFlowId = occurrence?.payload?.flow?.id;
  const payloadTriggerId = occurrence?.payload?.trigger?.id ?? null;
  const statusCanBeInitialOrDeduplicated =
    occurrence?.status === "dead_letter" || occurrence?.status === "retry_wait";
  if (
    !occurrence ||
    occurrence.id !== incident.occurrenceId ||
    occurrence.jobId !== expected.jobId ||
    incident.runId !== expected.runId ||
    payloadFlowId !== incident.flowId ||
    payloadTriggerId !== expected.triggerId ||
    !statusCanBeInitialOrDeduplicated ||
    !Number.isSafeInteger(occurrence.fence) ||
    occurrence.fence < 1 ||
    occurrence.lastError?.code !== incident.code
  ) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_EVIDENCE_CONFLICT",
      "scheduler dead-letter evidence no longer matches the incident",
    );
  }
  return expected;
}

function safeOccurrence(result) {
  return {
    occurrenceId: result.occurrence.id,
    status: result.occurrence.status,
    fence: result.occurrence.fence,
    attempt: result.occurrence.attempt,
  };
}

export function runAutomationCenterIncidentAction(
  db,
  schedulerStore,
  { incidentId, action, expectedRevision, now = Date.now } = {},
) {
  const id = normalizeIdentifier(incidentId, "incidentId");
  if (!INCIDENT_ACTIONS.has(action)) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_ACTION_INVALID",
      `unsupported Automation Center incident action: ${action}`,
    );
  }
  const revision = positiveRevision(expectedRevision);
  const incident = getAutomationExecutionIncident(db, id);
  if (!incident) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_NOT_FOUND",
      `automation execution incident was not found: ${id}`,
    );
  }
  if (incident.revision !== revision) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_STALE",
      `automation execution incident changed before ${action}: ${id}`,
    );
  }
  if (incident.status !== AUTOMATION_EXECUTION_INCIDENT_STATUS.OPEN) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_CLOSED",
      `automation execution incident is already closed: ${id}`,
    );
  }

  if (action === "cancel") {
    const cancelled = cancelAutomationExecutionIncident(db, id, {
      expectedRevision: revision,
      resolutionCode: "OPERATOR_CANCELLED",
      now,
    });
    return {
      schema: AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA,
      schemaVersion: AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA_VERSION,
      authority: "cli",
      ok: true,
      incidentId: id,
      action,
      previousRevision: revision,
      incident: projectAutomationCenterIncident(cancelled),
      result: { status: cancelled.status },
    };
  }

  if (!SCHEDULER_TRIGGER_TYPES.has(incident.triggerType)) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_RETRY_UNSUPPORTED",
      "manual incidents cannot be retried without risking duplicate authority or effects",
    );
  }
  if (
    !schedulerStore ||
    typeof schedulerStore.getOccurrence !== "function" ||
    typeof schedulerStore.requeueDeadLetter !== "function"
  ) {
    throw incidentActionError(
      "AUTOMATION_CENTER_INCIDENT_SCHEDULER_REQUIRED",
      "retry requires the scheduler store",
    );
  }
  const occurrence = schedulerStore.getOccurrence(incident.occurrenceId);
  assertExactSchedulerEvidence(incident, occurrence);
  const requeued = schedulerStore.requeueDeadLetter({
    occurrenceId: incident.occurrenceId,
    expectedFence: occurrence.fence,
    expectedErrorCode: incident.code,
    requestId: retryRequestId(incident, occurrence),
  });
  return {
    schema: AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA_VERSION,
    authority: "cli",
    ok: true,
    incidentId: id,
    action,
    previousRevision: revision,
    // A retry request is not a resolution. The original incident remains open
    // until the scheduler-backed run produces authoritative success evidence.
    incident: projectAutomationCenterIncident(incident),
    result: {
      requestId: requeued.requestId,
      deduplicated: requeued.deduplicated === true,
      occurrence: safeOccurrence(requeued),
    },
  };
}

export function automationCenterIncidentActionErrorEnvelope(
  error,
  { incidentId = null, action = null } = {},
) {
  const candidateCode =
    typeof error?.code === "string"
      ? error.code.slice(0, 128)
      : "AUTOMATION_CENTER_INCIDENT_ACTION_FAILED";
  const code = SAFE_INCIDENT_ERROR_CODES.has(candidateCode)
    ? candidateCode
    : "AUTOMATION_CENTER_INCIDENT_ACTION_FAILED";
  return {
    schema: AUTOMATION_CENTER_INCIDENT_ACTION_ERROR_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_INCIDENT_ACTION_SCHEMA_VERSION,
    authority: "cli",
    ok: false,
    incidentId:
      typeof incidentId === "string" && INCIDENT_ID_PATTERN.test(incidentId)
        ? incidentId
        : null,
    action: INCIDENT_ACTIONS.has(action) ? action : null,
    error: {
      code,
      // Do not serialize error.details: scheduler and incident evidence is an
      // internal trust-boundary object and can include sensitive material.
      message: "Automation Center incident action failed",
      retryable: error?.retryable === true,
    },
  };
}
