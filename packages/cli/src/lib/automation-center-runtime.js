import { createHash } from "node:crypto";
import {
  RUNTIME_PAUSE_RESUME,
  SchedulerKernelError,
  canonicalJson,
  normalizeIdentifier,
  normalizeRuntimeControlCapability,
} from "./scheduler-kernel/contract.js";
import {
  RUNTIME_CONTROL_JOB_KINDS,
  RUNTIME_CONTROL_OCCURRENCE_STATUSES,
} from "./scheduler-kernel/store.js";

export const AUTOMATION_CENTER_RUNTIME_SCHEMA =
  "chainlesschain.automation-center-runtime/v1";
export const AUTOMATION_CENTER_RUNTIME_ACTION_ERROR_SCHEMA =
  "chainlesschain.automation-center-runtime-action-error/v1";
export const AUTOMATION_CENTER_RUNTIME_SCHEMA_VERSION = 1;

const ACTIONS = Object.freeze(["pause", "resume"]);
const ACTION_SET = new Set(ACTIONS);
const SAFE_RUNTIME_ERROR_CODES = new Set([
  "AUTOMATION_CENTER_RUNTIME_STORE_REQUIRED",
  "AUTOMATION_CENTER_RUNTIME_CAPABILITY_REQUIRED",
  "AUTOMATION_CENTER_RUNTIME_INVALID_ARGUMENT",
  "AUTOMATION_CENTER_RUNTIME_ACTION_UNSUPPORTED",
  "AUTOMATION_CENTER_RUNTIME_NOT_FOUND",
  "AUTOMATION_CENTER_RUNTIME_KIND_UNSUPPORTED",
  "AUTOMATION_CENTER_RUNTIME_TERMINAL",
  "AUTOMATION_CENTER_RUNTIME_FENCE_CONFLICT",
  "AUTOMATION_CENTER_RUNTIME_CAPABILITY_UNSUPPORTED",
  "AUTOMATION_CENTER_RUNTIME_CAPABILITY_MISMATCH",
  "AUTOMATION_CENTER_RUNTIME_REVISION_CONFLICT",
  "AUTOMATION_CENTER_RUNTIME_STATE_CONFLICT",
]);
const OCCURRENCE_ID_PATTERN = /^occ_[0-9a-f]{64}$/u;
const JOB_KIND_SET = new Set(RUNTIME_CONTROL_JOB_KINDS);
const TERMINAL_STATUSES = new Set(["succeeded", "dead_letter"]);

function runtimeError(code, message, details = undefined) {
  const error = new SchedulerKernelError(code, message, details);
  error.retryable = false;
  return error;
}

function requireStore(schedulerStore) {
  if (
    !schedulerStore ||
    typeof schedulerStore.listRuntimeControlOccurrences !== "function" ||
    typeof schedulerStore.getOccurrence !== "function" ||
    typeof schedulerStore.getOccurrenceControl !== "function" ||
    typeof schedulerStore.getJob !== "function"
  ) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_STORE_REQUIRED",
      "A scheduler store with runtime-control reads is required",
    );
  }
  return schedulerStore;
}

function requireCapabilityResolver(capabilityForKind) {
  if (typeof capabilityForKind !== "function") {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_CAPABILITY_REQUIRED",
      "A runtime-control capability resolver is required",
    );
  }
  return capabilityForKind;
}

function capabilityFor(resolver, jobKind) {
  return normalizeRuntimeControlCapability(resolver(jobKind));
}

function supportsRuntimeControl(capability) {
  return (
    capability.pauseResume === RUNTIME_PAUSE_RESUME.CHECKPOINT_V1 &&
    capability.safePoints.length > 0
  );
}

function assertExpectedInteger(value, field, { positive = false } = {}) {
  const minimum = positive ? 1 : 0;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_INVALID_ARGUMENT",
      `${field} must be a ${positive ? "positive" : "non-negative"} integer`,
    );
  }
  return value;
}

function actionPreview(item, action) {
  return {
    executor: "cli",
    argv: [
      "automation",
      "center-runtime-action",
      item.id,
      action,
      "--expected-fence",
      String(item.fence),
      "--expected-control-revision",
      String(item.control?.revision ?? 0),
      "--json",
    ],
    mutates: true,
  };
}

function projectedAction(item, capability, action) {
  if (!supportsRuntimeControl(capability)) {
    return {
      id: action,
      available: false,
      reason: "runtime_control_unsupported",
      preview: null,
    };
  }
  const available =
    (action === "pause" && item.runtimeStatus === "running") ||
    (action === "resume" && item.runtimeStatus === "paused");
  let reason = null;
  if (!available) {
    if (action === "pause") {
      reason =
        item.runtimeStatus === "pause_requested"
          ? "pause_already_requested"
          : item.runtimeStatus === "paused"
            ? "already_paused"
            : "occurrence_not_running";
    } else {
      reason = "occurrence_not_paused";
    }
  }
  return {
    id: action,
    available,
    reason,
    preview: available ? actionPreview(item, action) : null,
  };
}

function projectOccurrence(item, resolver) {
  const capability = capabilityFor(resolver, item.jobKind);
  return {
    id: item.id,
    jobId: item.jobId,
    jobKind: item.jobKind,
    status: item.runtimeStatus,
    occurrenceStatus: item.occurrenceStatus,
    scheduledFor: item.scheduledFor,
    attempt: item.attempt,
    maxAttempts: item.maxAttempts,
    fence: item.fence,
    controlRevision: item.control?.revision ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    runtimeControl: supportsRuntimeControl(capability)
      ? {
          pauseResume: capability.pauseResume,
          safePoints: [...capability.safePoints],
        }
      : null,
    actions: ACTIONS.map((action) => projectedAction(item, capability, action)),
  };
}

export function buildAutomationCenterRuntimeProjection(
  schedulerStore,
  {
    capabilityForKind,
    statuses = RUNTIME_CONTROL_OCCURRENCE_STATUSES,
    jobKinds = RUNTIME_CONTROL_JOB_KINDS,
    limit = 50,
  } = {},
) {
  const store = requireStore(schedulerStore);
  const resolver = requireCapabilityResolver(capabilityForKind);
  const items = store
    .listRuntimeControlOccurrences({ statuses, jobKinds, limit })
    .map((item) => projectOccurrence(item, resolver));
  return {
    schema: AUTOMATION_CENTER_RUNTIME_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_RUNTIME_SCHEMA_VERSION,
    items,
  };
}

function deterministicRequestId({
  occurrenceId,
  action,
  expectedFence,
  capability,
  expectedControlRevision,
}) {
  const digest = createHash("sha256")
    .update("chainlesschain.automation-center-runtime.request.v1\0", "utf8")
    .update(
      canonicalJson(
        {
          action,
          capability,
          expectedControlRevision,
          expectedFence,
          occurrenceId,
        },
        "automationCenterRuntime.request",
      ),
      "utf8",
    )
    .digest("hex");
  return `automation-center-runtime:${action}:${digest}`;
}

function sameCapability(left, right) {
  return (
    canonicalJson(left, "runtimeControl.persisted") ===
    canonicalJson(right, "runtimeControl.current")
  );
}

function sanitizeActionResult({
  action,
  requestId,
  deduplicated,
  occurrence,
  control,
  jobKind,
}) {
  return {
    schema: AUTOMATION_CENTER_RUNTIME_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_RUNTIME_SCHEMA_VERSION,
    authority: "cli",
    ok: true,
    action,
    requestId,
    deduplicated: deduplicated === true,
    occurrence: {
      id: occurrence.id,
      jobId: occurrence.jobId,
      jobKind,
      status: occurrence.status,
      attempt: occurrence.attempt,
      maxAttempts: occurrence.maxAttempts,
      fence: occurrence.fence,
      scheduledFor: occurrence.scheduledFor,
      updatedAt: occurrence.updatedAt,
    },
    control: {
      state: control.state,
      revision: control.revision,
      expectedFence: control.expectedFence,
      requestedAt: control.requestedAt,
      pausedAt: control.pausedAt,
      resumedAt: control.resumedAt,
      updatedAt: control.updatedAt,
    },
  };
}

export function runAutomationCenterRuntimeAction(
  schedulerStore,
  {
    capabilityForKind,
    occurrenceId,
    action,
    expectedFence,
    expectedControlRevision,
  } = {},
) {
  const store = requireStore(schedulerStore);
  const resolver = requireCapabilityResolver(capabilityForKind);
  const id = normalizeIdentifier(occurrenceId, "occurrenceId");
  const normalizedAction = normalizeIdentifier(action, "action", {
    maxLength: 16,
  });
  if (!ACTION_SET.has(normalizedAction)) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_ACTION_UNSUPPORTED",
      "Runtime action must be pause or resume",
    );
  }
  const fence = assertExpectedInteger(expectedFence, "expectedFence", {
    positive: true,
  });
  const revision = assertExpectedInteger(
    expectedControlRevision,
    "expectedControlRevision",
  );

  // Every mutation starts from fresh durable evidence. Full occurrence/job
  // records stay inside this trusted boundary and are never returned.
  const occurrence = store.getOccurrence(id);
  if (!occurrence) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_NOT_FOUND",
      `Scheduler occurrence does not exist: ${id}`,
    );
  }
  const job = store.getJob(occurrence.jobId);
  if (!job || !JOB_KIND_SET.has(job.kind)) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_KIND_UNSUPPORTED",
      "Scheduler occurrence kind is not Automation Center controllable",
    );
  }
  if (TERMINAL_STATUSES.has(occurrence.status)) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_TERMINAL",
      `Scheduler occurrence is terminal: ${id}`,
    );
  }
  if (occurrence.fence !== fence) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_FENCE_CONFLICT",
      `Scheduler occurrence fence changed: ${id}`,
      { expectedFence: fence, actualFence: occurrence.fence },
    );
  }

  const capability = capabilityFor(resolver, job.kind);
  if (!supportsRuntimeControl(capability)) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_CAPABILITY_UNSUPPORTED",
      "Scheduler runtime does not declare checkpoint pause/resume",
    );
  }
  const control = store.getOccurrenceControl(id);
  if (control && !sameCapability(control.capability, capability)) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_CAPABILITY_MISMATCH",
      `Scheduler runtime-control capability changed: ${id}`,
    );
  }
  const requestId = deterministicRequestId({
    occurrenceId: id,
    action: normalizedAction,
    expectedFence: fence,
    capability,
    expectedControlRevision: revision,
  });

  const priorRequestId =
    normalizedAction === "pause"
      ? control?.pauseRequestId
      : control?.resumeRequestId;
  if (priorRequestId === requestId) {
    return sanitizeActionResult({
      action: normalizedAction,
      requestId,
      deduplicated: true,
      occurrence,
      control,
      jobKind: job.kind,
    });
  }

  const actualRevision = control?.revision ?? 0;
  if (actualRevision !== revision) {
    throw runtimeError(
      "AUTOMATION_CENTER_RUNTIME_REVISION_CONFLICT",
      `Scheduler occurrence control revision changed: ${id}`,
      { expectedRevision: revision, actualRevision },
    );
  }

  let result;
  if (normalizedAction === "pause") {
    if (occurrence.status !== "running" || control !== null) {
      throw runtimeError(
        "AUTOMATION_CENTER_RUNTIME_STATE_CONFLICT",
        `Scheduler occurrence is not pausable: ${id}`,
      );
    }
    const nextControl = store.requestOccurrencePause({
      occurrenceId: id,
      expectedFence: fence,
      expectedRevision: revision,
      requestId,
      capability,
    });
    result = {
      occurrence: store.getOccurrence(id),
      control: nextControl,
      deduplicated: nextControl.deduplicated,
    };
  } else {
    if (
      occurrence.status !== "retry_wait" ||
      control?.state !== "paused" ||
      control.expectedFence !== fence
    ) {
      throw runtimeError(
        "AUTOMATION_CENTER_RUNTIME_STATE_CONFLICT",
        `Scheduler occurrence is not resumable: ${id}`,
      );
    }
    result = store.resumeOccurrence({
      occurrenceId: id,
      expectedRevision: revision,
      requestId,
    });
    result.deduplicated = result.control.deduplicated;
  }

  return sanitizeActionResult({
    action: normalizedAction,
    requestId,
    deduplicated: result.deduplicated,
    occurrence: result.occurrence,
    control: result.control,
    jobKind: job.kind,
  });
}

export function automationCenterRuntimeActionErrorEnvelope(
  error,
  { occurrenceId = null, action = null } = {},
) {
  const candidateCode =
    typeof error?.code === "string"
      ? error.code.slice(0, 128)
      : "AUTOMATION_CENTER_RUNTIME_ACTION_FAILED";
  const code = SAFE_RUNTIME_ERROR_CODES.has(candidateCode)
    ? candidateCode
    : "AUTOMATION_CENTER_RUNTIME_ACTION_FAILED";
  return {
    schema: AUTOMATION_CENTER_RUNTIME_ACTION_ERROR_SCHEMA,
    schemaVersion: AUTOMATION_CENTER_RUNTIME_SCHEMA_VERSION,
    authority: "cli",
    ok: false,
    occurrenceId:
      typeof occurrenceId === "string" &&
      OCCURRENCE_ID_PATTERN.test(occurrenceId)
        ? occurrenceId
        : null,
    action: ACTION_SET.has(action) ? action : null,
    error: {
      code,
      // Runtime error details can contain fences and internal scheduler state.
      // Keep the IDE-facing error envelope intentionally minimal.
      message: "Automation Center runtime action failed",
      retryable: error?.retryable === true,
    },
  };
}
