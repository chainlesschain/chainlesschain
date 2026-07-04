/**
 * Auto-pin policy for compaction (OPT-IN).
 *
 * Phase 7.7 gave the compressor a deterministic pin mechanism: a message the
 * predicate marks is pulled out before any strategy and re-inserted verbatim,
 * so it survives compaction no matter what the (non-deterministic) LLM summary
 * drops. What was deliberately left unbuilt is the *policy* — deciding WHICH
 * messages to auto-pin — because auto-pinning reorders the hot agent loop's
 * context and is a product-UX call.
 *
 * This module supplies that policy, but strictly opt-in: it only ever produces
 * a predicate when the caller explicitly enables auto-pin. When disabled it
 * returns null and the caller passes NO predicate, so the compressor falls back
 * to its default (pin only messages already tagged `pinned:true`) and behaviour
 * is byte-identical to before.
 *
 * Default policy when enabled: pin the ORIGINAL TASK — the first user turn —
 * because that is the single fact most likely to scroll out of the recent
 * window yet most important to keep (the coding agent's goal). Explicit
 * `pinned:true` messages are always honored on top of it. A token cap keeps a
 * pathologically large first turn from itself blowing the budget.
 */

const DEFAULT_MAX_PIN_TOKENS = 2000;

/**
 * Normalize the opt-in value into a config object, or null when auto-pin is off.
 * Accepts: falsy (off), `true` (defaults on), or a config object
 * `{ firstUserGoal?, maxPinTokens? }`.
 */
export function resolveAutoPinConfig(opt) {
  if (!opt) return null;
  const cfg = typeof opt === "object" ? opt : {};
  return {
    firstUserGoal: cfg.firstUserGoal !== false, // default true when enabled
    maxPinTokens: Number.isFinite(cfg.maxPinTokens)
      ? cfg.maxPinTokens
      : DEFAULT_MAX_PIN_TOKENS,
  };
}

/** Coarse char/4 token estimate — matches the compressor's own heuristic. */
function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function contentString(m) {
  if (!m) return "";
  return typeof m.content === "string"
    ? m.content
    : JSON.stringify(m.content || "");
}

/**
 * Build an `isPinned(message)` predicate for `compress({ isPinned })`, or null
 * when auto-pin is disabled (caller then passes no predicate → default).
 *
 * The predicate combines explicit pins (`pinned:true`/`_pin`) with the policy's
 * auto-selected messages, matched by identity against `messages` (compress
 * filters the same array, so identity is stable).
 */
export function buildAutoPinPredicate(messages, opt) {
  const cfg = resolveAutoPinConfig(opt);
  if (!cfg) return null;
  if (!Array.isArray(messages)) {
    return (m) => !!m && (m.pinned === true || m._pin === true);
  }

  const auto = new Set();
  if (cfg.firstUserGoal) {
    const firstUser = messages.find((m) => m && m.role === "user");
    // Skip a first turn that is itself huge — pinning it would defeat the point
    // (it would dominate the very budget compaction is trying to reclaim).
    if (
      firstUser &&
      estimateTokens(contentString(firstUser)) <= cfg.maxPinTokens
    ) {
      auto.add(firstUser);
    }
  }

  return (m) => !!m && (m.pinned === true || m._pin === true || auto.has(m));
}

/**
 * Explain what the policy would pin for `messages` (for `--dry-run` / logging).
 * Returns `{ enabled, reasons: [{ role, preview, why }] }`.
 */
export function describeAutoPin(messages, opt) {
  const cfg = resolveAutoPinConfig(opt);
  if (!cfg) return { enabled: false, reasons: [] };
  const reasons = [];
  const list = Array.isArray(messages) ? messages : [];
  for (const m of list) {
    if (m && (m.pinned === true || m._pin === true)) {
      reasons.push({ role: m.role, preview: preview(m), why: "explicit pin" });
    }
  }
  if (cfg.firstUserGoal) {
    const firstUser = list.find((m) => m && m.role === "user");
    if (
      firstUser &&
      estimateTokens(contentString(firstUser)) <= cfg.maxPinTokens
    ) {
      reasons.push({
        role: "user",
        preview: preview(firstUser),
        why: "original task (first user turn)",
      });
    }
  }
  return { enabled: true, reasons };
}

function preview(m) {
  return contentString(m).replace(/\s+/g, " ").slice(0, 80);
}
