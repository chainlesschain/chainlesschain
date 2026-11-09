import {
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
} from "./runtime-usage-ledger.js";
/**
 * Local model-call recovery from the host's verified event sample.
 * No observabilityScope authority or complete billing assurance is granted.
 */
const MAX_PENDING_CALLS = 100_000;

function sameIdentity(left, right) {
  return (
    right !== null &&
    ["provider", "model", "source", "operationId"].every(
      (key) => (left[key] ?? null) === (right[key] ?? null),
    )
  );
}

export function createSessionModelUsageRecoveryProjection() {
  // Retain only unresolved calls, not the entire settled session history.
  const calls = new Map();
  function remember(id, record) {
    if (!calls.has(id) && calls.size >= MAX_PENDING_CALLS) {
      throw Object.assign(
        new Error("Local model usage recovery exceeds 100000 pending calls"),
        {
          code: "CC_MODEL_USAGE_RECOVERY_CAPACITY",
        },
      );
    }
    calls.set(id, record);
  }
  return {
    accept(event) {
      const id = event?.data?.callId;
      if (typeof id !== "string" || !id) return;
      const previous = calls.get(id);
      if (event.type === "model_usage_started") {
        // A reused historical id is conservatively pending again; no stored
        // token settlement is removed and no known charge is reset.
        if (!previous)
          remember(id, {
            status: "started",
            ...projectRuntimeUsageBoundary(event.data, "started"),
          });
      } else if (event.type === "model_usage_unknown") {
        const observed = projectRuntimeUsageBoundary(event.data, "unknown");
        if (!previous) remember(id, { status: "unknown", ...observed });
        else if (sameIdentity(previous, observed)) previous.status = "unknown";
      } else if (event.type === "token_usage" && previous) {
        try {
          const projected = projectRuntimeTokenUsage(event.data);
          const observed = projectRuntimeUsageBoundary(projected, "started");
          if (
            event.data.source != null &&
            event.data.source !== observed.source
          )
            return;
          if (sameIdentity(previous, observed)) calls.delete(id);
        } catch {
          // Keep the interrupted call unknown when the shared runtime ledger
          // rejects a malformed/ambiguous token settlement.
        }
      }
    },
    finish() {
      const unsettledCallIds = [];
      const unknownCallIds = [];
      for (const [id, record] of calls) {
        if (record.status === "started") unsettledCallIds.push(id);
        else if (record.status === "unknown") unknownCallIds.push(id);
      }
      const byCode = [];
      if (unsettledCallIds.length)
        byCode.push(
          Object.freeze({
            code: "model-usage-unsettled",
            count: unsettledCallIds.length,
          }),
        );
      if (unknownCallIds.length)
        byCode.push(
          Object.freeze({
            code: "model-usage-unknown",
            count: unknownCallIds.length,
          }),
        );
      return Object.freeze({
        schema: "chainlesschain.local-session-model-usage-recovery/v1",
        assurance: "recorded-model-call-ledger-only",
        billingComplete: false,
        telemetryComplete: byCode.length === 0,
        retainedCallCount: calls.size,
        unsettledCallIds: Object.freeze(unsettledCallIds),
        unknownCallIds: Object.freeze(unknownCallIds),
        unknownEvidence: Object.freeze({ byCode: Object.freeze(byCode) }),
      });
    },
  };
}
export function formatSessionModelUsageRecoveryNotice(sessionId, recovery) {
  const ids = [
    ...(recovery?.unsettledCallIds || []),
    ...(recovery?.unknownCallIds || []),
  ];
  if (!ids.length) return null;
  // JSON quoting prevents persisted identifiers from injecting terminal lines.
  const listed = ids
    .slice(0, 20)
    .map((id) => JSON.stringify(id))
    .join(", ");
  const remaining = ids.length > 20 ? ` (+${ids.length - 20} more)` : "";
  return `[recovery] Session ${JSON.stringify(sessionId)} has interrupted model request(s) ${listed}${remaining}; usage and cost remain unknown. Original prompt may not have been saved. Inspect the saved session and reconcile provider usage before explicitly resubmitting; requests are not retried automatically.`;
}
