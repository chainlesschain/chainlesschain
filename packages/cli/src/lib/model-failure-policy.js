import { isAbortError } from "./abort-utils.js";

// Admission failures are not provider outages, even when their causes contain
// HTTP status codes or retryable/authentication words.
export function isTerminalModelFailure(error) {
  const visited = new Set();
  for (let current = error; current; current = current.cause) {
    if (visited.has(current) || visited.size >= 32) return true;
    visited.add(current);
    if (
      current.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED" ||
      current.runtimeLedgerPersistence === true ||
      current.workflowEffectOutcomeUnknown === true ||
      /^(?:CC|ERR)_SESSION_BUDGET_/u.test(current.code || "") ||
      isAbortError(current)
    ) {
      return true;
    }
  }
  return false;
}
