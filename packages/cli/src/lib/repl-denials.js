/**
 * repl-denials — record + render the policy denials seen during an agent run,
 * so the interactive REPL's `/permissions denials` can review what got blocked
 * AND a headless run (`cc agent -p`) can print an end-of-run summary (Claude-
 * Code 2.1.193 parity: "auto-mode denial reasons … /permissions recent
 * denials"). The helpers are generic (not REPL-specific) and shared by both.
 *
 * A *denial* is a tool call the agent was NOT allowed to run — blocked by the
 * shell policy, an ApprovalGate tier, a settings permission rule, or a hook. It
 * is distinct from a tool that ran and *failed* (non-zero exit, missing file):
 * those carry an `error` but none of the denial markers below, so they are not
 * recorded here.
 *
 * Pure + dependency-free so it unit-tests without the REPL runtime.
 */

/** Keep the most recent N denials per session (bounded ring buffer). */
export const MAX_RECENT_DENIALS = 20;

/** Error-message prefixes agent-core attaches to a blocked tool call. */
const DENIAL_PREFIX = /^\s*\[(Shell Policy|Permission|ApprovalGate|Hook)\]/;

/** Map a `[Prefix]` to a short `via` label when no structured field carries one. */
function viaFromPrefix(errStr) {
  const m = DENIAL_PREFIX.exec(errStr);
  if (!m) return null;
  return (
    {
      "Shell Policy": "shell-policy",
      Permission: "settings",
      ApprovalGate: "gate",
      Hook: "hook",
    }[m[1]] || "policy"
  );
}

/**
 * Classify a tool-result as a policy denial and extract a structured record,
 * or return null when it is not a denial. Detection prefers the structured
 * markers agent-core attaches (`approval.decision` / `policy.decision` /
 * `shellCommandPolicy.allowed`) and falls back to the error-message prefix.
 *
 * @param {object} ev  { tool, result, error, argsSummary }
 * @returns {{tool:string,summary:string,reason:string,via:string,rule:(string|null)}|null}
 */
export function classifyDenial(ev = {}) {
  const { tool, result, error, argsSummary } = ev;
  const errStr = String(error || (result && result.error) || "").trim();
  const approval = result && result.approval;
  const policy = result && result.policy;
  const shellPol = result && result.shellCommandPolicy;
  const denied =
    (approval && approval.decision === "deny") ||
    (policy && policy.decision === "deny") ||
    (shellPol && shellPol.allowed === false) ||
    DENIAL_PREFIX.test(errStr);
  if (!denied) return null;
  const via =
    (approval && approval.via) ||
    (policy && policy.via) ||
    (shellPol ? "shell-policy" : viaFromPrefix(errStr)) ||
    "policy";
  const rule = (policy && policy.rule) || (shellPol && shellPol.ruleId) || null;
  const chain =
    result && Array.isArray(result.permissionChain)
      ? result.permissionChain
      : null;
  return {
    tool: tool || "?",
    summary: String(
      argsSummary || (shellPol && shellPol.normalizedCommand) || "",
    ).slice(0, 200),
    reason: errStr || "(denied)",
    via,
    rule,
    ...(chain ? { chain } : {}),
  };
}

/**
 * One compact line for a layer-by-layer permission chain, e.g.
 * `settings-rules→no-match · shell-policy→warn · approval-gate→deny (user-deny, trusted)`.
 * Returns null when there is nothing to explain.
 */
export function formatDenialChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const parts = chain.map((step) => {
    const base = `${step.layer}→${step.outcome ?? "?"}`;
    const detail = [
      step.rule ? String(step.rule) : null,
      step.via && step.via !== step.outcome ? String(step.via) : null,
      step.policy ? String(step.policy) : null,
    ].filter(Boolean);
    return detail.length ? `${base} (${detail.join(", ")})` : base;
  });
  return parts.join(" · ");
}

/** Two denials are "the same" attempt when tool + command + rule + via match. */
function sameDenial(a, b) {
  return (
    a &&
    b &&
    a.tool === b.tool &&
    a.summary === b.summary &&
    a.via === b.via &&
    a.rule === b.rule
  );
}

/**
 * Append a denial to a bounded most-recent-last ring buffer (mutates + returns
 * it). Drops the oldest entries beyond `max`. No-op on a bad log/record.
 *
 * Consecutive identical denials are COALESCED: a model that hits a policy block
 * usually retries the same command several times, which would otherwise flood
 * the cap and evict other distinct denials. A repeat bumps the last entry's
 * `count` and refreshes its `at` instead of appending.
 */
export function recordDenial(log, record, max = MAX_RECENT_DENIALS) {
  if (!Array.isArray(log) || !record) return log;
  const last = log[log.length - 1];
  if (sameDenial(last, record)) {
    last.count = (last.count || 1) + 1;
    if (typeof record.at === "number") last.at = record.at;
    return log;
  }
  log.push(record);
  while (log.length > max) log.shift();
  return log;
}

/**
 * Render the denial log most-recent-first for `/permissions denials`. Times are
 * relative ("12s ago") when a record carries a numeric `at`; `now` is injectable
 * for deterministic tests.
 *
 * @param {Array} log
 * @param {{now?:number}} [opts]
 * @returns {string}
 */
export function formatDenials(log, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  if (!Array.isArray(log) || log.length === 0) {
    return "  (no tool calls were denied this session)";
  }
  const lines = [`  Recent denials (most recent first, ${log.length}):`];
  for (let i = log.length - 1; i >= 0; i--) {
    const d = log[i] || {};
    const ago =
      typeof d.at === "number"
        ? ` · ${Math.max(0, Math.round((now - d.at) / 1000))}s ago`
        : "";
    const where = d.rule ? `${d.via}:${d.rule}` : d.via || "policy";
    const what = d.summary ? `${d.tool} ${d.summary}` : d.tool || "?";
    const times = d.count > 1 ? ` ×${d.count}` : "";
    lines.push(`  • ${what}${times}  [${where}${ago}]`);
    const chainLine = formatDenialChain(d.chain);
    if (chainLine) lines.push(`      chain: ${chainLine}`);
    if (d.reason) lines.push(`      ${d.reason}`);
  }
  return lines.join("\n");
}
