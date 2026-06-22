/**
 * cli-numeric — validated parsing for user-supplied numeric CLI options.
 *
 * `parseInt`/`Number` on a bad arg yields NaN that silently corrupts whatever
 * consumes it (a `LIMIT NaN`, a `Date.now()+NaN` deadline, a stored NaN config).
 * This centralizes parse → validate → fall-back-or-throw so a command either
 * fails LOUDLY with a clear message or falls back to a sane default — never
 * threads NaN downstream.
 *
 * @param {*} raw  the option value (string from commander, or undefined)
 * @param {object} [opts]
 * @param {string} [opts.name="value"]   label for error messages (e.g. "--limit")
 * @param {boolean} [opts.integer=false] require a whole number (rejects 1.5);
 *                                       parsing is strict either way (Number,
 *                                       not parseInt — "12abc" is rejected)
 * @param {number} [opts.min]            inclusive lower bound
 * @param {number} [opts.max]            inclusive upper bound
 * @param {number} [opts.fallback]       returned for missing/invalid input; when
 *                                       omitted, invalid input THROWS instead
 * @returns {number}
 */
export function numericOption(raw, opts = {}) {
  const { name = "value", integer = false, min, max } = opts;
  const hasFallback = Object.prototype.hasOwnProperty.call(opts, "fallback");
  const fail = (msg) => {
    if (hasFallback) return opts.fallback;
    throw new Error(msg);
  };

  if (raw == null || raw === "") return fail(`${name} is required`);
  if (typeof raw === "string" && raw.trim() === "")
    return fail(`${name} is required`);
  // Number() (NOT parseInt) so trailing junk is rejected instead of silently
  // truncated: parseInt("12abc") === 12 and parseInt("0x10", 10) === 0 would
  // slip a corrupt value through. Number("12abc") is NaN; whole numbers given
  // via exponent ("1e3" -> 1000) still parse, and a fractional value is
  // rejected in integer mode.
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    return fail(
      `${name} must be a ${integer ? "whole " : ""}number (got ${JSON.stringify(String(raw))})`,
    );
  }
  if (min != null && n < min) return fail(`${name} must be >= ${min}`);
  if (max != null && n > max) return fail(`${name} must be <= ${max}`);
  return n;
}
