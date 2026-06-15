/**
 * Parse the inline arguments of the REPL `/review` slash command into the
 * option shape that `runReview` (commands/review.js) expects. Pure — no I/O —
 * so it is fully unit-testable.
 *
 * Supported forms (a small, useful subset of `cc review`):
 *   /review                     working tree vs HEAD, bugs + cleanup, medium
 *   /review high | low | medium effort tier
 *   /review --security          security-focused lens (/security-review)
 *   /review --simplify          cleanup-only lens (no bug hunt)
 *   /review --fix               apply fixes (auto-checkpointed, reversible)
 *   /review --staged            review staged changes (git diff --cached)
 *   /review --base <ref>        review this branch vs <ref> (<ref>...HEAD)
 *   /review --range <A..B>      review an explicit revision range
 *
 * @param {string} rest the text after "/review"
 * @returns {{ opts: object, errors: string[] }}
 */
export function parseReviewReplArgs(rest) {
  const tokens = String(rest || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const opts = {
    effort: undefined,
    security: false,
    simplify: false,
    fix: false,
    staged: false,
    base: null,
    range: null,
  };
  const errors = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const lower = t.toLowerCase();
    if (lower === "low" || lower === "medium" || lower === "high") {
      opts.effort = lower;
    } else if (t === "--security") {
      opts.security = true;
    } else if (t === "--simplify") {
      opts.simplify = true;
    } else if (t === "--fix") {
      opts.fix = true;
    } else if (t === "--staged") {
      opts.staged = true;
    } else if (t === "--base") {
      const v = tokens[++i];
      if (!v) errors.push("--base needs a ref (e.g. /review --base main)");
      else opts.base = v;
    } else if (t === "--range") {
      const v = tokens[++i];
      if (!v) errors.push("--range needs a range (e.g. /review --range A..B)");
      else opts.range = v;
    } else if (t === "-e" || t === "--effort") {
      const v = tokens[++i];
      const vl = v ? v.toLowerCase() : "";
      if (vl === "low" || vl === "medium" || vl === "high") opts.effort = vl;
      else errors.push(`invalid effort "${v}" (expected low|medium|high)`);
    } else {
      errors.push(`unknown argument "${t}"`);
    }
  }

  if (opts.security && opts.simplify) {
    errors.push("--security and --simplify are mutually exclusive");
  }

  return { opts, errors };
}

/** Short one-line description of the configured review, for a status line. Pure. */
export function describeReviewArgs(opts = {}) {
  const lens = opts.security
    ? "security"
    : opts.simplify
      ? "cleanup-only"
      : "bugs + cleanup";
  const scope = opts.range
    ? `range ${opts.range}`
    : opts.base
      ? `${opts.base}...HEAD`
      : opts.staged
        ? "staged changes"
        : "working tree vs HEAD";
  const action = opts.fix ? "applying fixes" : "read-only";
  return `${scope} · ${opts.effort || "medium"} effort · ${lens} · ${action}`;
}
