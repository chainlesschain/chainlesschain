/**
 * REPL turn-binding PRODUCER — closes the incremental-gap 仍欠 item "REPL 自身
 * 作为显式表生产者（交互 turn 实时喂+持久化，镜像 headless 接线；现 REPL 只消费）".
 *
 * Wraps the SHARED feeder core ([[turn-binding.js]] `createTurnBindingFeed` —
 * the exact mapping the headless runner uses, so the two producers can never
 * drift) with the three REPL-specific concerns:
 *
 *   1. Rehydrate: the first turn loads the session's persisted table
 *      (`loadTurnBindingLog`) so an interactive continuation of a headless (or
 *      earlier REPL) run APPENDS to the existing table instead of clobbering it.
 *   2. Timeline supersede: the live REPL can shrink its conversation
 *      (`/rewind`, `/clear`, auto-compaction), so each new turn prunes records
 *      anchored at/after its own offset — under `pickPersistedTurn`'s
 *      exact-offset matching a stale record from the discarded timeline would
 *      otherwise shadow the new turn and could offer the wrong checkpoint.
 *   3. Per-settle persistence: `persistTurnBinding` after each turn, including
 *      tool-free turns. Failures are reported through `onError` and fail closed
 *      by default; tests/diagnostics may explicitly request advisory mode.
 *
 * I/O goes through `_deps` so tests drive the producer hermetically.
 */

import { createTurnBindingFeed } from "../lib/turn-binding.js";
import {
  loadTurnBindingLog,
  persistTurnBinding,
} from "../lib/turn-binding-store.js";

// Injected so tests can seed the persisted table / capture snapshots without
// touching the real sessions directory.
export const _deps = {
  loadTurnBindingLog,
  persistTurnBinding,
  now: () => Date.now(),
};

/**
 * @param {{sessionId?: string, nonce?: string, failClosed?:boolean,
 *          onError?:(error:Error, phase:string)=>void}} [opts]
 * @returns {object|null}  null when the session cannot persist (no sessionId)
 */
export function createReplTurnBindingProducer({
  sessionId,
  nonce,
  onError,
  failClosed = true,
} = {}) {
  if (!sessionId) return null;
  // Per-process nonce (mirrors the headless runner's per-run nonce): restored
  // turn ids keep their original nonce, new ids can't collide across resumes.
  const runNonce = nonce || String(_deps.now());
  let feed = null;
  let lastError = null;
  const report = (error, phase) => {
    lastError = error instanceof Error ? error : new Error(String(error));
    try {
      onError?.(lastError, phase);
    } catch {
      // Reporting must not replace the underlying recovery warning.
    }
  };
  const rejectOr = (error, phase, fallback) => {
    report(error, phase);
    if (failClosed) throw lastError;
    return fallback;
  };
  return {
    /**
     * Anchor a new interactive turn. Call just AFTER the user message was
     * appended, with `conversationOffset = messages.length` — the exact-match
     * contract `pickPersistedTurn` relies on.
     */
    beginTurn(conversationOffset) {
      try {
        if (!feed) {
          feed = createTurnBindingFeed({
            log: _deps.loadTurnBindingLog(sessionId),
            nonce: runNonce,
          });
        }
        return feed.beginTurn(conversationOffset, { supersede: true });
      } catch (error) {
        return rejectOr(error, "load", null);
      }
    },
    /** Fold one agent-loop event into the current turn (fed by agentLoop). */
    handleEvent(event) {
      if (!feed) return false;
      try {
        return feed.handleEvent(event);
      } catch (error) {
        return rejectOr(error, "event", false);
      }
    },
    /** Persist the table after a settled turn (dirty-gated, fail-closed). */
    persistIfDirty() {
      if (!feed || !feed.isDirty()) return false;
      let ok = false;
      try {
        ok = _deps.persistTurnBinding(sessionId, feed.log);
      } catch (error) {
        return rejectOr(error, "persist", false);
      }
      if (!ok) {
        return rejectOr(
          new Error("turn-binding snapshot was not persisted"),
          "persist",
          false,
        );
      }
      feed.clearDirty();
      lastError = null;
      return true;
    },
    lastError: () => lastError,
    sessionId: () => sessionId,
    /** The live table (for tests / future in-process consumers). */
    log: () => (feed ? feed.log : null),
  };
}
