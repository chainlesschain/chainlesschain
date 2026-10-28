import { runMeteredDirectModelCall } from "./direct-model-usage.js";

// A verdict is small. Keep its output bounded even when the authoring model has
// a much larger default; a caller's smaller limit still wins.
export const GOAL_MODEL_MAX_OUTPUT_TOKENS = 2048;

export function goalModelCallError(reason, cause) {
  const details = {
    max_turns: ["error_max_turns", "No model turns remain for Goal evaluation"],
    "cost-budget-exhausted": [
      "error_max_budget",
      "The run cost budget is exhausted",
    ],
    "usage-unknown": [
      "error_goal_usage_unknown",
      "Goal model usage is unknown; reconcile the request before continuing",
    ],
    cancelled: ["error_goal_cancelled", "Goal model evaluation was cancelled"],
  }[reason];
  return Object.assign(new Error(details[1], { cause }), {
    goalModelFailure: true,
    endReason: reason,
    subtype: details[0],
  });
}

/** One auxiliary Goal call, charged to the same run as the authoring loop. */
export async function runGoalModelCall({
  sessionId,
  persist,
  sessionBudget,
  iterationBudget,
  costBudget,
  signal,
  operationId,
  chat,
  chatOptions,
  prompt,
  onUsage,
}) {
  const signals = [signal, sessionBudget?.signal].filter(Boolean);
  const dispatchSignal =
    signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const checkCancellation = () => {
    if (dispatchSignal?.aborted)
      throw goalModelCallError("cancelled", dispatchSignal.reason);
  };
  checkCancellation();
  if (costBudget.exceeded()) throw goalModelCallError("cost-budget-exhausted");
  if (iterationBudget.isExhausted()) throw goalModelCallError("max_turns");
  const outputLimit = chatOptions.maxOutputTokens;
  const maxOutputTokens =
    Number.isSafeInteger(outputLimit) && outputLimit > 0
      ? Math.min(outputLimit, GOAL_MODEL_MAX_OUTPUT_TOKENS)
      : GOAL_MODEL_MAX_OUTPUT_TOKENS;

  let dispatched = false;
  let settled;
  // Reserve synchronously before awaiting persistence; other agents can share
  // this iteration budget and must not take the same final turn meanwhile.
  iterationBudget.consume();
  try {
    settled = await runMeteredDirectModelCall({
      // Ephemeral runs still settle usage in memory. The callback below writes
      // no session file when persistence is disabled, and makes no durable claim.
      sessionId: sessionId || "ephemeral-goal-evaluation",
      persist: async (type, event) => {
        if (persist) await persist(type, event);
        if (type === "token_usage") onUsage(event);
      },
      provider: chatOptions.provider,
      model: chatOptions.model,
      source: "model",
      operationId,
      sessionBudget,
      dispatchSignal: dispatchSignal || null,
      includeSettlement: true,
      call: () => {
        checkCancellation();
        dispatched = true;
        return chat([{ role: "user", content: prompt }], {
          ...chatOptions,
          signal: dispatchSignal,
          maxOutputTokens,
          enabledToolNames: [],
        });
      },
    });
  } catch (error) {
    if (
      error?.runtimeLedgerPersistence ||
      error?.goalModelFailure ||
      error?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED" ||
      (typeof error?.code === "string" &&
        error.code.startsWith("CC_SESSION_BUDGET_"))
    )
      throw error;
    checkCancellation();
    // A failed request is not a negative verdict that authorizes another turn.
    if (dispatched) throw goalModelCallError("usage-unknown", error);
    throw error;
  }
  if (settled.settlement !== "known") throw goalModelCallError("usage-unknown");
  checkCancellation();
  if (costBudget.exceeded()) throw goalModelCallError("cost-budget-exhausted");
  return settled.result;
}
