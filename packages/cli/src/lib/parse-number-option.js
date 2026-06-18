/**
 * Parse a user-supplied numeric CLI option value.
 *
 * Command actions often do `parseFloat(options.x)` / `parseInt(options.x)`
 * straight into domain logic. When the flag is malformed (`--weight abc`,
 * `--amount 1,5`) those yield `NaN`, which then flows silently into stored
 * records and math (vote weights, amounts, thresholds) — corrupt data with no
 * error. This helper validates the value is a finite number and otherwise
 * throws a single friendly `Invalid number for <label>: <value>` error
 * (which reads cleanly through the CLI entry boundary).
 *
 * @param {string|number|undefined|null} value  raw option (e.g. `options.weight`)
 * @param {string} label                        user-facing label (e.g. `"--weight"`)
 * @param {*} [fallback]                         returned when `value` is empty (default `undefined`)
 * @returns {number|*} the parsed finite number, or `fallback` when empty
 * @throws {Error} when `value` is non-empty but not a finite number
 */
export function parseNumberOption(value, label, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for ${label}: ${JSON.stringify(value)}`);
  }
  return n;
}

export default parseNumberOption;
