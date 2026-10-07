/** Capture the actual journal; never follow a v2 journal back to its source Ledger. */
import { isProxy } from "node:util/types";
import {
  EvolutionLedger,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import { isEvolutionLedgerV2Journal } from "./evolution-ledger-v2-journal.js";

export function captureEvolutionEvalLedger(ledger) {
  if (!ledger || isProxy(ledger))
    throw new TypeError("Eval requires a genuine Ledger journal");
  const methods = {};
  for (const name of ["read", "verify", "appendDomainEvent"]) {
    if (ledger instanceof EvolutionLedger)
      methods[name] = (...args) =>
        Reflect.apply(EvolutionLedger.prototype[name], ledger, args);
    else if (isEvolutionLedgerV2Journal(ledger)) {
      const method = Object.getOwnPropertyDescriptor(ledger, name)?.value;
      if (typeof method !== "function" || isProxy(method))
        throw new TypeError("Eval v2 journal method is missing");
      methods[name] = (...args) => Reflect.apply(method, ledger, args);
    } else throw new TypeError("Eval requires a genuine Ledger journal");
  }
  return Object.freeze(methods);
}

/** Complete, contiguous census with bookends; defaults must not truncate at 10,000. */
export function readEvolutionEvalLedger(methods) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = methods.verify();
    const events = methods.read({
      afterSequence: 0,
      limit: EVOLUTION_LEDGER_MAX_EVENTS,
    });
    const after = methods.verify();
    if (
      !["ledgerId", "identityDigest", "epoch", "headDigest", "sequence"].every(
        (name) => before[name] === after[name],
      )
    )
      continue;
    if (
      events.length !== after.sequence ||
      events.some((event, index) => event.sequence !== index + 1)
    )
      throw new Error("Eval requires complete contiguous Ledger coverage");
    return events;
  }
  throw new Error("Ledger changed during Eval census; retry audit");
}
