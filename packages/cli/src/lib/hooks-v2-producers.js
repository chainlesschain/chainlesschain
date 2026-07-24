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
