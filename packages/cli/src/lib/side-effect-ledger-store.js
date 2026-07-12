/**
 * Persist the side-effect ledger ([[side-effect-ledger.js]]) as a tamper-evident
 * chained session event so a worker that crashed mid `git push` / `file-write` /
 * `package-install` can rebuild its ledger on recovery and reconcile WITHOUT
 * repeating a side-effect it already issued.
 *
 * Same shape as [[turn-binding-store.js]]: each persist writes the FULL ledger
 * snapshot (newest wins), all I/O is delegated to the canonical session store
 * via `_deps` so the module stays pure-testable.
 */

import {
  appendEvent as storeAppendEvent,
  readEvents as storeReadEvents,
} from "../harness/jsonl-session-store.js";
import {
  SideEffectLedger,
  reconcileSideEffects,
} from "./side-effect-ledger.js";

/** Event type carrying a full SideEffectLedger snapshot. */
export const SIDE_EFFECT_LEDGER_EVENT = "side_effect_ledger";

export const _deps = {
  appendEvent: storeAppendEvent,
  readEvents: storeReadEvents,
};

/**
 * Append the current ledger as a chained event. Best-effort — a persistence
 * failure must not crash the operation it is guarding.
 *
 * @param {string} sessionId
 * @param {SideEffectLedger|object} ledger
 * @returns {boolean}
 */
export function persistSideEffectLedger(sessionId, ledger) {
  if (!sessionId || !ledger) return false;
  const snapshot =
    ledger instanceof SideEffectLedger ? ledger.toJSON() : ledger;
  if (!snapshot || !Array.isArray(snapshot.ops)) return false;
  try {
    _deps.appendEvent(sessionId, SIDE_EFFECT_LEDGER_EVENT, snapshot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild the ledger from the LATEST persisted snapshot, or an empty ledger when
 * the session never persisted one (or on read error).
 *
 * @param {string} sessionId
 * @param {{clock?:Function}} [opts]
 * @returns {SideEffectLedger}
 */
export function loadSideEffectLedger(sessionId, opts = {}) {
  let events = [];
  try {
    events = _deps.readEvents(sessionId) || [];
  } catch {
    return new SideEffectLedger(opts);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (
      e &&
      e.type === SIDE_EFFECT_LEDGER_EVENT &&
      e.data &&
      Array.isArray(e.data.ops)
    ) {
      return SideEffectLedger.fromJSON(e.data, opts);
    }
  }
  return new SideEffectLedger(opts);
}

/**
 * Load + reconcile in one step: the recovery entry point. Returns the plan a
 * restarting worker uses to decide, per op, redo / inspect / skip.
 *
 * @param {string} sessionId
 * @returns {{plans:Array, redo:string[], inspect:string[], skip:string[]}}
 */
export function reconcileSessionSideEffects(sessionId) {
  return reconcileSideEffects(loadSideEffectLedger(sessionId));
}
