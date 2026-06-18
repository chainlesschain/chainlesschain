/**
 * Parse a user-supplied JSON CLI option value.
 *
 * Many command actions pass raw `--flag` strings straight to `JSON.parse`,
 * so malformed JSON surfaces as a raw `SyntaxError` — an ugly stack trace for
 * actions without a try/catch, and a cryptic "Unexpected token …" for the rest.
 * This helper turns that into a single, friendly `Invalid JSON for <label>: …`
 * error, and consolidates the duplicated `_parseJsonArg` / `_parseMetaV2`
 * helpers that several command files grew independently.
 *
 * @param {string|undefined|null} value  raw option string (e.g. `options.input`)
 * @param {string} label                 user-facing label for errors (e.g. `"--input"`)
 * @param {*} [fallback]                  returned when `value` is empty (default `undefined`)
 * @returns the parsed JSON, or `fallback` when `value` is empty
 * @throws {Error} `Invalid JSON for <label>: <reason>` when `value` is non-empty but unparseable
 */
export function parseJsonOption(value, label, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  // Defensive: a Commander custom parser may have already produced an object.
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`Invalid JSON for ${label}: ${reason}`);
  }
}

export default parseJsonOption;
