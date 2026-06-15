/**
 * Micro-compaction (Claude-Code `/microcompact` parity). Where full compaction
 * summarizes the whole history when it grows large, micro-compaction is
 * surgical: it trims the bulkiest OLD items — large tool results — in place,
 * keeping the conversation flow and the most-recent messages verbatim. Because
 * it only SHORTENS a tool message's content (never removes the message), it can
 * never orphan a tool_call→tool_result pair, so it's safe to run any time.
 *
 * Pure → unit-testable.
 */

const DEFAULT_KEEP_RECENT = 6; // last N messages kept verbatim
const DEFAULT_MAX_TOOL_CHARS = 400; // trim older tool results longer than this

/**
 * @param {Array} messages  OpenAI-shaped messages ({role, content, …}).
 * @param {object} [opts]    { keepRecent, maxToolChars }
 * @returns {{ messages: Array, stats: {trimmed:number, saved:number, kept:number} }}
 *          A NEW array (originals untouched); `saved` ≈ characters freed.
 */
export function microCompact(messages, opts = {}) {
  if (!Array.isArray(messages)) {
    return { messages, stats: { trimmed: 0, saved: 0, kept: 0 } };
  }
  const keepRecent = Number.isFinite(opts.keepRecent)
    ? opts.keepRecent
    : DEFAULT_KEEP_RECENT;
  const maxChars = Number.isFinite(opts.maxToolChars)
    ? opts.maxToolChars
    : DEFAULT_MAX_TOOL_CHARS;
  // messages at index >= cutoff are "recent" and never touched.
  const cutoff = Math.max(0, messages.length - keepRecent);

  let trimmed = 0;
  let saved = 0;
  const out = messages.map((m, i) => {
    if (i >= cutoff) return m; // recent → verbatim
    if (!m || m.role !== "tool") return m; // only old tool results
    const content = typeof m.content === "string" ? m.content : "";
    if (content.length <= maxChars) return m; // small enough already
    trimmed += 1;
    saved += content.length - maxChars;
    const head = content.slice(0, maxChars);
    return {
      ...m,
      content: `${head}\n… [tool result trimmed — ${content.length} chars; older context dropped to save space]`,
      _microCompacted: true,
    };
  });

  return { messages: out, stats: { trimmed, saved, kept: keepRecent } };
}
