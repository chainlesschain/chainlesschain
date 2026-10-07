/** One immutable journal view; authentication finishes at its final head check. */
import {
  captureEvolutionEvalLedger,
  readEvolutionEvalLedger,
} from "./evolution-eval-ledger-capture.js";

const AUDITS = new WeakMap();
const HEAD_FIELDS = [
  "ledgerId",
  "identityDigest",
  "epoch",
  "sequence",
  "headDigest",
];
const EMPTY_EVENTS = Object.freeze([]);

function fail(message) {
  const error = new Error(message);
  error.code = "CC_EVOLUTION_EVAL_READONLY_AUDIT_FAILED";
  throw error;
}

function readHead(methods) {
  const current = methods.verify();
  return Object.freeze(
    Object.fromEntries(HEAD_FIELDS.map((field) => [field, current[field]])),
  );
}

function sameHead(left, right) {
  return HEAD_FIELDS.every((field) => left[field] === right[field]);
}

// Events come only from the genuine journal's verified read. Preserve native
// null-prototype references and freeze each event independently; the complete
// journal must not become one RRSI-sized canonical document.
function freezeEvent(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeEvent);
    Object.freeze(value);
  }
  return value;
}

export function createEvolutionEvalReadonlyAudit(ledger) {
  const methods = captureEvolutionEvalLedger(ledger);
  const identity = readHead(methods);
  const events = Object.freeze(
    readEvolutionEvalLedger(methods).map(freezeEvent),
  );
  const byEventId = new Map();
  for (const event of events) {
    if (typeof event.eventId !== "string") continue;
    let matches = byEventId.get(event.eventId);
    if (!matches) byEventId.set(event.eventId, (matches = []));
    matches.push(event);
  }
  for (const matches of byEventId.values()) Object.freeze(matches);
  if (!sameHead(identity, readHead(methods)))
    fail("Ledger changed while capturing the read-only audit");

  let invalidated = false;
  function assertActive() {
    if (invalidated) fail("read-only audit was invalidated by a Ledger change");
  }
  const captured = Object.freeze({
    identity,
    events,
    eventsById(id) {
      assertActive();
      if (typeof id !== "string") fail("audit event ID must be a string");
      return byEventId.get(id) ?? EMPTY_EVENTS;
    },
    assertUnchanged() {
      assertActive();
      let current;
      try {
        current = readHead(methods);
      } catch (error) {
        invalidated = true;
        throw error;
      }
      if (!sameHead(identity, current)) {
        invalidated = true;
        fail(
          "Ledger changed during the read-only audit; retry with a new view",
        );
      }
      return identity;
    },
  });
  const audit = Object.freeze({
    schema: "chainlesschain.evolution-eval-readonly-audit/v1",
  });
  AUDITS.set(audit, { ledger, captured, assertActive });
  return audit;
}

/** Capture does not rescan the journal; the consumer must finish with assertUnchanged. */
export function captureEvolutionEvalReadonlyAudit(audit, ledger) {
  const state = AUDITS.get(audit);
  if (!state || state.ledger !== ledger)
    fail("a genuine read-only audit of the same Ledger journal is required");
  state.assertActive();
  return state.captured;
}
