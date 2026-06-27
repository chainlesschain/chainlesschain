/**
 * safeJsonParse — JSON.parse that returns `fallback` instead of throwing on
 * malformed (or null/empty) input.
 *
 * Use it for DB columns parsed inside a list `.map()` / loop: an unguarded
 * `JSON.parse(row.col)` lets ONE corrupt cell throw out of the whole function,
 * crashing the entire list load (the unguarded-JSON.parse-in-list-loop bug
 * class — a single bad row should be skipped, not fail every other row).
 *
 * @param {unknown} text      the raw string (or null/undefined)
 * @param {*} [fallback=null] returned on null/empty/parse failure
 * @returns {*}
 */
export function safeJsonParse(text, fallback = null) {
  if (text == null || text === "") return fallback;
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
