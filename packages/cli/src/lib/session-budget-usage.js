import {
  sessionBudgetAdmissionError,
  sessionBudgetUsageUnknownError,
} from "./session-budget-production-root.js";

function isRootUsage(event) {
  return !event?.attribution;
}

export function beginSessionBudgetUsage(
  sessionBudget,
  event,
  operation = "provider usage",
) {
  if (
    !isRootUsage(event) ||
    typeof sessionBudget?.beginUsageSettlement !== "function"
  ) {
    return null;
  }
  const admission = sessionBudget.beginUsageSettlement({ id: event.callId });
  if (!admission?.ok) {
    throw sessionBudgetAdmissionError(admission?.reason, operation);
  }
  return admission;
}

export function recordSessionBudgetUsage(
  sessionBudget,
  event,
  operation = "provider usage settlement",
) {
  if (!isRootUsage(event) || typeof sessionBudget?.recordUsage !== "function") {
    return null;
  }
  const status = sessionBudget.recordUsage({
    ...(event?.callId ? { callId: event.callId } : {}),
    provider: event?.provider || null,
    model: event?.model || null,
    usage: event?.usage || null,
  });
  if (status?.aborted) {
    throw sessionBudgetAdmissionError(status.reason, operation);
  }
  return status;
}

export function markSessionBudgetUsageUnknown(sessionBudget, event) {
  if (
    !isRootUsage(event) ||
    typeof sessionBudget?.markUsageUnknown !== "function"
  ) {
    return null;
  }
  return sessionBudget.markUsageUnknown({ callId: event.callId });
}

export function rejectSessionBudgetUsageUnknown(
  event,
  operation = "provider usage settlement",
) {
  throw sessionBudgetUsageUnknownError(operation, event?.callId || null);
}
