/**
 * Best-effort bridge from real runtime producers to Hooks v2.
 * Hook failures never change the surrounding agent or interaction result.
 */
export function emitHooksV2Event(eventName, context = {}, options = {}) {
  void import("./hooks-v2-runtime.js")
    .then(({ default: runtime }) => {
      if (!runtime || typeof runtime.executeHooks !== "function") return;
      return runtime.executeHooks(eventName, context, options);
    })
    .catch(() => {
      // Hooks are an optional extension; producer delivery is best-effort.
    });
}

