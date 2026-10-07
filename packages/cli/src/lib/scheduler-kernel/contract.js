// Compatibility entry: both hosts share the same implementation and error type.
import schedulerContract from "@chainlesschain/session-core/scheduler-contract";

export const {
  SCHEDULER_SCHEMA_VERSION,
  AUTHORITY_ENVELOPE_VERSION,
  RUNTIME_CONTROL_SCHEMA_VERSION,
  RUNTIME_PAUSE_RESUME,
  RUNTIME_CONTROL_SAFE_POINTS,
  OCCURRENCE_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_JOB_ATTEMPTS,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  MAX_JSON_BYTES,
  SchedulerKernelError,
  invalidArgument,
  normalizeIdentifier,
  normalizeAuthorityEnvelope,
  normalizeJson,
  canonicalJson,
  normalizeEpochMs,
  normalizeMaxAttempts,
  normalizeHistoryLimit,
  normalizeRuntimeControlCapability,
  deriveOccurrenceIdentity,
} = schedulerContract;
