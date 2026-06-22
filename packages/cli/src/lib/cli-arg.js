/**
 * cli-arg — validating commander option coercers.
 *
 * Bare `parseInt` / `parseFloat` / `Number` used as a commander coercer
 * (`.option("--limit <n>", "...", parseInt)`) silently yield NaN on bad input
 * (`--limit abc`), threading NaN into whatever the action does with the option.
 * These factories validate at parse time and raise a commander
 * `InvalidArgumentError`, so a typo fails with the standard
 * `error: option '--limit <n>' argument 'abc' is invalid` message and exit 1 —
 * instead of a silently-corrupt run.
 *
 * Drop-in replacements:
 *   .option("--limit <n>", "...", parseInt)      ->  intArg("--limit")
 *   .option("--rate <n>",  "...", parseFloat)    ->  floatArg("--rate")
 *   .option("--eps <n>",   "...", Number)        ->  floatArg("--eps")
 *
 * Behaviour for valid and omitted values is identical to the bare coercer
 * (the coercer only runs when the option is supplied with a value); only the
 * NaN-on-bad-input case changes.
 *
 * @param {string} name  option label for the message (e.g. "--limit")
 * @param {{min?: number, max?: number}} [opts]
 */
import { InvalidArgumentError } from "commander";
import { numericOption } from "./cli-numeric.js";

function makeArg(integer) {
  return (name, opts = {}) =>
    (raw) => {
      try {
        return numericOption(raw, { ...opts, name, integer });
      } catch (err) {
        throw new InvalidArgumentError(err.message);
      }
    };
}

export const intArg = makeArg(true);
export const floatArg = makeArg(false);

export default { intArg, floatArg };
