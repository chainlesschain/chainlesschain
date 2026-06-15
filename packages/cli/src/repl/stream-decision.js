/**
 * Decide whether the REPL may stream the answer live (token-by-token) instead of
 * replaying the finished text. Pure → unit-testable.
 *
 * Safety invariant: live streaming is ONLY allowed when no AssistantResponse
 * hook is registered. Such a hook can rewrite or suppress the final answer, and
 * once tokens are on screen they can't be un-printed. If we can't determine the
 * hook count (a query error → pass arHookCount < 0), we stay safe (no streaming).
 * `CC_REPL_STREAM=0` forces the replay regardless.
 */
export function shouldStreamLive({ streamEnv, arHookCount = 0 } = {}) {
  if (streamEnv === "0") return false;
  // 0 → no rewrite/suppress hook → safe. Anything else (hooks present, or -1 for
  // "unknown") → fall back to the replay.
  return arHookCount === 0;
}
