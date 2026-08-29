import contract from "./hook-runtime-contract.cjs";

export const {
  HOOK_EVENT_SCHEMA_VERSION,
  HOOK_EVENT_TYPES,
  HOOK_EVENT_CONTRACTS,
  DECISION_EVENTS,
  HOOK_PRIORITY,
  HOOK_EXECUTION_MODE,
  DEFAULT_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  MAX_HOOK_CONTEXT_BYTES,
  stableStringify,
  validateHookEvent,
  normalizeHookPriority,
  normalizeHookTimeoutMs,
  normalizeHookExecutionMode,
} = contract;

export default contract;
