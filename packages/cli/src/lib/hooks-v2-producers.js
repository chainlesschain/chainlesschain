/**
 * Best-effort bridge from real runtime producers to Hooks v2.
 * Hook failures never change the surrounding agent or interaction result.
 */
export function emitHooksV2Event(eventName, context = {}, options = {}) {
  void executeHooksV2Event(eventName, context, options);
}

/**
 * Decision-capable producer bridge. Callers at a real gate (PreToolUse,
 * Setup, prompt expansion) await this result; observer producers can keep
 * using emitHooksV2Event().
 */
export async function executeHooksV2Event(
  eventName,
  context = {},
  options = {},
) {
  try {
    const { default: runtime } = await import("./hooks-v2-runtime.js");
    if (!runtime || typeof runtime.executeHooks !== "function") {
      return {
        success: options.failClosed !== true,
        blocked: options.failClosed === true,
        decision: options.failClosed === true ? "block" : "continue",
        unavailable: true,
        results: [],
      };
    }
    return await runtime.executeHooks(eventName, context, options);
  } catch (error) {
    return {
      success: options.failClosed !== true,
      blocked: options.failClosed === true,
      decision: options.failClosed === true ? "block" : "continue",
      error: error?.message || String(error),
      results: [],
    };
  }
}

export function resolvePromptExpansion(prompt, outcome = {}) {
  const base = String(prompt ?? "");
  const updates = [];
  const context = [];
  for (const record of Array.isArray(outcome.results) ? outcome.results : []) {
    if (record?.status !== "success" || !record.result) continue;
    if (typeof record.result.updatedPrompt === "string") {
      updates.push(record.result.updatedPrompt);
    }
    if (typeof record.result.additionalContext === "string") {
      const value = record.result.additionalContext.trim();
      if (value) context.push(value);
    }
  }
  const distinctUpdates = [...new Set(updates)];
  if (distinctUpdates.length > 1) {
    return {
      prompt: base,
      blocked: true,
      reason: "conflicting UserPromptExpansion updatedPrompt results",
    };
  }
  let resolved = distinctUpdates[0] ?? base;
  if (context.length > 0) {
    resolved += `\n\n[hook context]\n${context.join("\n")}`;
  }
  return {
    prompt: resolved,
    blocked: outcome.blocked === true || outcome.decision === "block",
    reason:
      outcome.blockingResult?.reason ||
      outcome.blockingResult?.message ||
      null,
  };
}
