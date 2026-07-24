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

export class SideEffectLedgerPersistenceError extends Error {
  constructor(operation, sessionId, cause) {
    const detail = cause?.message || String(cause || "unknown persistence error");
    super(`Side-effect ledger ${operation} failed for ${sessionId}: ${detail}`, {
      cause,
    });
    this.name = "SideEffectLedgerPersistenceError";
    this.code =
      operation === "read"
        ? "SIDE_EFFECT_LEDGER_READ_FAILED"
        : "SIDE_EFFECT_LEDGER_PERSIST_FAILED";
    this.operation = operation;
    this.sessionId = sessionId;
  }
}

function persistenceFailure(operation, sessionId, cause, failIfUnavailable) {
  if (!failIfUnavailable) return false;
  throw new SideEffectLedgerPersistenceError(operation, sessionId, cause);
}

/**
 * Append the current ledger as a chained event. This is Critical state:
 * persistence failures reject by default so the guarded operation cannot run.
 * Diagnostic callers may explicitly request advisory best-effort behavior.
 *
 * @param {string} sessionId
 * @param {SideEffectLedger|object} ledger
 * @param {{failIfUnavailable?:boolean}} [opts]
 * @returns {boolean}
 */
export function persistSideEffectLedger(sessionId, ledger, opts = {}) {
  const failIfUnavailable = opts.failIfUnavailable !== false;
  if (!sessionId || !ledger) {
    return persistenceFailure(
      "write",
      sessionId || "<missing-session>",
      new TypeError("sessionId and ledger are required"),
      failIfUnavailable,
    );
  }

  try {
    const snapshot =
      ledger instanceof SideEffectLedger ? ledger.toJSON() : ledger;
    if (!snapshot || !Array.isArray(snapshot.ops)) {
      throw new TypeError("ledger snapshot must contain an ops array");
    }
    _deps.appendEvent(sessionId, SIDE_EFFECT_LEDGER_EVENT, snapshot);
    return true;
  } catch (error) {
    return persistenceFailure("write", sessionId, error, failIfUnavailable);
  }
}

/**
 * Rebuild the ledger from the LATEST persisted snapshot, or an empty ledger when
 * the session never persisted one. Read/corruption errors reject by default.
 *
 * @param {string} sessionId
 * @param {{clock?:Function,failIfUnavailable?:boolean}} [opts]
 * @returns {SideEffectLedger}
 */
export function loadSideEffectLedger(sessionId, opts = {}) {
  const failIfUnavailable = opts.failIfUnavailable !== false;
  let events = [];
  try {
    events = _deps.readEvents(sessionId) || [];
  } catch (error) {
    const fallback = persistenceFailure(
      "read",
      sessionId || "<missing-session>",
      error,
      failIfUnavailable,
    );
    if (fallback === false) return new SideEffectLedger(opts);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (
      e &&
      e.type === SIDE_EFFECT_LEDGER_EVENT &&
      e.data &&
      Array.isArray(e.data.ops)
    ) {
      try {
        return SideEffectLedger.fromJSON(e.data, opts);
      } catch (error) {
        const fallback = persistenceFailure(
          "read",
          sessionId || "<missing-session>",
          error,
          failIfUnavailable,
        );
        if (fallback === false) return new SideEffectLedger(opts);
      }
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
