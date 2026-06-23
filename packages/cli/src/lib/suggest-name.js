/**
 * suggest-name — "did you mean?" suggestions for a mistyped identifier.
 *
 * Combines substring containment (a partial name) with bounded Levenshtein edit
 * distance (single-char typos / transpositions) so `cc mcp remove cotnext7`
 * suggests `context7`. Pure + dependency-free; reusable by any command that
 * resolves a user-supplied name against a known set (MCP servers, skills, …).
 *
 * Claude-Code 2.1.186 parity: `mcp get/remove` typo suggestions.
 */

/** Levenshtein edit distance between two strings (iterative two-row, O(n*m)). */
export function editDistance(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/**
 * Rank candidates by closeness to `target` and return up to `limit` names.
 * A candidate qualifies if it contains `target` (or vice-versa) as a
 * case-insensitive substring, OR is within `maxDistance` edits (default scales
 * with target length, capped at 3). Exact matches are excluded (not a typo).
 * Output is ordered: substring matches first, then by edit distance, then
 * alphabetically (stable).
 *
 * @param {string} target
 * @param {string[]} candidates
 * @param {{ limit?: number, maxDistance?: number }} [opts]
 * @returns {string[]}
 */
export function suggestNames(target, candidates, opts = {}) {
  const t = String(target ?? "")
    .trim()
    .toLowerCase();
  if (!t || !Array.isArray(candidates)) return [];
  const limit = opts.limit ?? 3;
  const maxDistance =
    opts.maxDistance ?? Math.min(3, Math.max(1, Math.floor(t.length / 3)));
  const scored = [];
  for (const raw of candidates) {
    const name = String(raw ?? "");
    if (!name) continue;
    const lc = name.toLowerCase();
    if (lc === t) continue; // exact match isn't a "did you mean"
    const contains = lc.includes(t) || t.includes(lc);
    const dist = editDistance(t, lc);
    if (contains || dist <= maxDistance) {
      scored.push({ name, contains: contains ? 0 : 1, dist });
    }
  }
  scored.sort((a, b) => {
    if (a.contains !== b.contains) return a.contains - b.contains;
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return scored.slice(0, limit).map((s) => s.name);
}

/**
 * Build a `<noun> "<target>" not found` message, appending a `— did you mean
 * "x", "y"?` hint when there are close candidates. Returns just the base when
 * there are none.
 *
 * @param {string} target
 * @param {string[]} candidates
 * @param {{ noun?: string, limit?: number, maxDistance?: number }} [opts]
 * @returns {string}
 */
export function notFoundWithSuggestion(target, candidates, opts = {}) {
  const noun = opts.noun || "item";
  const base = `${noun} "${target}" not found`;
  const hints = suggestNames(target, candidates, opts);
  if (!hints.length) return base;
  return `${base} — did you mean ${hints.map((h) => `"${h}"`).join(", ")}?`;
}
