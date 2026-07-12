/**
 * Persist the explicit turn→checkpoint binding table ([[turn-binding.js]]) as a
 * tamper-evident chained event in the session transcript — the first half of the
 * P1 gap "把绑定作为新链式事件落 jsonl-session-store.js（继承哈希链防篡改，替代
 * 易失的 `_checkpointMarks`）".
 *
 * The REPL's in-process `_checkpointMarks` array is lost the moment the session
 * ends or the process exits, so a resumed session can't offer a coverage-aware
 * rewind for anything from before the restart. Snapshotting the whole
 * `TurnBindingLog` into an append-only `turn_checkpoint_binding` event makes the
 * binding survive resume AND inherit the transcript's hash chain (tamper
 * evidence), exactly like every other session event.
 *
 * All I/O is delegated to the canonical session store via `_deps` so this module
 * stays pure-testable (inject an in-memory append/read pair — no fs, no home dir).
 */

import {
  appendEvent as storeAppendEvent,
  readEvents as storeReadEvents,
} from "../harness/jsonl-session-store.js";
import {
  TurnBindingLog,
  resolveRestorePlan,
  selectTurnRange,
  RESTORE_SCOPE,
} from "./turn-binding.js";

/** Event type carrying a full TurnBindingLog snapshot. */
export const TURN_BINDING_EVENT = "turn_checkpoint_binding";

// Injected so tests can drive persistence without touching the real sessions dir.
export const _deps = {
  appendEvent: storeAppendEvent,
  readEvents: storeReadEvents,
};

/**
 * Append the current binding table as a new chained event. Each call writes the
 * FULL table (append-only snapshot), so the newest event is authoritative — a
 * later `loadTurnBindingLog` never has to merge partial deltas across a chain
 * that a compaction could have truncated.
 *
 * Best-effort: a persistence failure must not crash the turn it is recording, so
 * the caller gets `false` instead of a throw.
 *
 * @param {string} sessionId
 * @param {TurnBindingLog|object} log  a TurnBindingLog or its toJSON() shape
 * @returns {boolean} true when the snapshot was written
 */
export function persistTurnBinding(sessionId, log) {
  if (!sessionId || !log) return false;
  const snapshot = log instanceof TurnBindingLog ? log.toJSON() : log;
  if (!snapshot || !Array.isArray(snapshot.turns)) return false;
  try {
    _deps.appendEvent(sessionId, TURN_BINDING_EVENT, snapshot);
    return true;
  } catch {
    // Persistence is advisory — never let it break the agent turn.
    return false;
  }
}

/**
 * Rebuild the TurnBindingLog from the LATEST persisted snapshot in a session
 * transcript. Returns an empty log when the session has no binding event (or on
 * any read error) so callers can treat "never persisted" and "unreadable" alike.
 *
 * @param {string} sessionId
 * @returns {TurnBindingLog}
 */
export function loadTurnBindingLog(sessionId) {
  let events = [];
  try {
    events = _deps.readEvents(sessionId) || [];
  } catch {
    return new TurnBindingLog();
  }
  // Newest snapshot wins — scan backwards for the first well-formed one.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (
      e &&
      e.type === TURN_BINDING_EVENT &&
      e.data &&
      Array.isArray(e.data.turns)
    ) {
      return TurnBindingLog.fromJSON(e.data);
    }
  }
  return new TurnBindingLog();
}

/**
 * Compose load + plan: resolve the honest restore plan for one turn of a
 * PERSISTED session, so a resumed `/rewind` can show coverage warnings for a
 * turn taken before the restart. Delegates the over-promise guards to
 * `resolveRestorePlan` (unknown turn → a "nothing to restore" plan).
 *
 * @param {string} sessionId
 * @param {string} turnId
 * @param {string} [scope]  one of RESTORE_SCOPE
 */
export function resolveRestorePlanFromSession(
  sessionId,
  turnId,
  scope = RESTORE_SCOPE.BOTH,
) {
  const log = loadTurnBindingLog(sessionId);
  return resolveRestorePlan(log.get(turnId), scope);
}

/**
 * Compose load + range select for "Summarize from here / up to here" over a
 * persisted session's turns.
 */
export function selectTurnRangeFromSession(sessionId, range = {}) {
  return selectTurnRange(loadTurnBindingLog(sessionId), range);
}
