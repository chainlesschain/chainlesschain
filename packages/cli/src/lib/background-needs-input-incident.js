import { createHash } from "node:crypto";

export const NEEDS_INPUT_INCIDENT_SCHEMA_VERSION = 1;
export const DEFAULT_NEEDS_INPUT_NOTIFICATION_STALE_MS = 60_000;
export const NEEDS_INPUT_NOTIFICATION_STATUS = Object.freeze({
  PENDING: "pending",
  DELIVERING: "delivering",
  DELIVERED: "delivered",
  PARTIAL: "partial",
  UNCONFIGURED: "unconfigured",
  FAILED: "failed",
  OUTCOME_UNKNOWN: "outcome_unknown",
});

function boundedText(value, maxLength) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function requiredId(value, field) {
  const normalized = boundedText(value, 256);
  if (!normalized) throw new Error(`${field} is required`);
  if ([...normalized].some((character) => character.codePointAt(0) < 32)) {
    throw new Error(`${field} contains a control character`);
  }
  return normalized;
}

function epochMs(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative epoch millisecond`);
  }
  return normalized;
}

function incidentDigest(runId, requestId) {
  return createHash("sha256")
    .update(`chainlesschain.background-needs-input.v1\0${runId}\0${requestId}`)
    .digest("hex");
}

export function createNeedsInputIncident({
  runId,
  sessionId = null,
  requestId,
  now = Date.now(),
} = {}) {
  const normalizedRunId = requiredId(runId, "runId");
  const normalizedRequestId = requiredId(requestId, "requestId");
  const createdAt = epochMs(now, "now");
  return {
    schemaVersion: NEEDS_INPUT_INCIDENT_SCHEMA_VERSION,
    incidentId: incidentDigest(normalizedRunId, normalizedRequestId),
    runId: normalizedRunId,
    sessionId: sessionId == null ? null : requiredId(sessionId, "sessionId"),
    requestId: normalizedRequestId,
    status: "needs_input",
    createdAt,
    updatedAt: createdAt,
    notification: {
      status: NEEDS_INPUT_NOTIFICATION_STATUS.PENDING,
      attempts: 0,
    },
  };
}

export function buildNeedsInputNotification(incident) {
  const runId = requiredId(incident?.runId, "incident.runId");
  const incidentId = requiredId(incident?.incidentId, "incident.incidentId");
  return {
    title: "Background agent needs input",
    body: `Run ${runId} is waiting for human input. Resume with: cc attach ${runId}\nIncident: ${incidentId}`,
    level: "info",
    taskId: runId,
  };
}

export function claimNeedsInputNotification(
  incident,
  {
    retry = false,
    force = false,
    now = Date.now(),
    staleAfterMs = DEFAULT_NEEDS_INPUT_NOTIFICATION_STALE_MS,
  } = {},
) {
  if (!incident || incident.status !== "needs_input") {
    return { applied: false, reason: "incident_not_pending", incident };
  }
  const status = incident.notification?.status;
  const retryable = new Set([
    NEEDS_INPUT_NOTIFICATION_STATUS.FAILED,
    NEEDS_INPUT_NOTIFICATION_STATUS.UNCONFIGURED,
  ]);
  const claimAt = epochMs(now, "now");
  const normalizedStaleAfterMs = epochMs(staleAfterMs, "staleAfterMs");
  const deliveryStartedAt = Number(incident.notification?.startedAt);
  const deliveryIsStale =
    status === NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERING &&
    (!Number.isSafeInteger(deliveryStartedAt) ||
      deliveryStartedAt < 0 ||
      claimAt - deliveryStartedAt >= normalizedStaleAfterMs);
  const canClaim =
    status === NEEDS_INPUT_NOTIFICATION_STATUS.PENDING ||
    (retry && retryable.has(status)) ||
    (force &&
      (status !== NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERING ||
        deliveryIsStale));
  if (!canClaim) {
    return {
      applied: false,
      reason:
        status === NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERING
          ? "delivery_in_progress"
          : "delivery_not_retryable",
      incident,
    };
  }
  const startedAt = claimAt;
  const attempt = Number(incident.notification?.attempts || 0) + 1;
  return {
    applied: true,
    reason: null,
    attempt,
    incident: {
      ...incident,
      updatedAt: startedAt,
      notification: {
        status: NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERING,
        attempts: attempt,
        startedAt,
      },
    },
  };
}

function safeError(error) {
  return {
    code: boundedText(error?.code, 128) || "NOTIFICATION_OUTCOME_UNKNOWN",
    message:
      boundedText(error?.message || error, 1_000) ||
      "Notification delivery outcome is unknown",
  };
}

function channelNames(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((entry) => boundedText(entry, 64)).filter(Boolean)),
  ]
    .sort()
    .slice(0, 32);
}

export function settleNeedsInputNotification(
  incident,
  { attempt, result = null, error = null, now = Date.now() } = {},
) {
  if (
    !incident ||
    incident.notification?.status !==
      NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERING ||
    incident.notification?.attempts !== attempt
  ) {
    return { applied: false, reason: "delivery_claim_changed", incident };
  }
  const settledAt = epochMs(now, "now");
  const delivered = channelNames(result?.delivered);
  const failed = channelNames(result?.failed);
  const channels = Math.max(0, Number(result?.channels) || 0);
  let status;
  if (error) status = NEEDS_INPUT_NOTIFICATION_STATUS.OUTCOME_UNKNOWN;
  else if (channels === 0)
    status = NEEDS_INPUT_NOTIFICATION_STATUS.UNCONFIGURED;
  else if (delivered.length > 0 && failed.length > 0) {
    status = NEEDS_INPUT_NOTIFICATION_STATUS.PARTIAL;
  } else if (delivered.length > 0) {
    status = NEEDS_INPUT_NOTIFICATION_STATUS.DELIVERED;
  } else {
    status = NEEDS_INPUT_NOTIFICATION_STATUS.FAILED;
  }
  return {
    applied: true,
    reason: null,
    incident: {
      ...incident,
      updatedAt: settledAt,
      notification: {
        status,
        attempts: attempt,
        startedAt: incident.notification.startedAt,
        settledAt,
        channels,
        delivered,
        failed,
        ...(error ? { error: safeError(error) } : {}),
      },
    },
  };
}

export function closeNeedsInputIncident(
  incident,
  { status = "resolved", now = Date.now() } = {},
) {
  if (!incident || incident.status !== "needs_input") return incident;
  if (status !== "resolved" && status !== "cancelled") {
    throw new Error(
      "needs-input incident close status must be resolved or cancelled",
    );
  }
  const closedAt = epochMs(now, "now");
  return {
    ...incident,
    status,
    updatedAt: closedAt,
    closedAt,
  };
}
