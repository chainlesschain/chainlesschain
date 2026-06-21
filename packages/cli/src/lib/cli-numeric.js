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
 * @param {boolean} [opts.integer=false] parse as integer (parseInt) vs float (Number)
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
  const n = integer ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n)) {
    return fail(
      `${name} must be a ${integer ? "whole " : ""}number (got ${JSON.stringify(String(raw))})`,
    );
  }
  if (min != null && n < min) return fail(`${name} must be >= ${min}`);
  if (max != null && n > max) return fail(`${name} must be <= ${max}`);
  return n;
}
