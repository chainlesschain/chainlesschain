/**
 * PR/CI automation policy — the fail-closed decision engine behind "P1-4 PR/CI
 * Monitor、Auto-fix 与受控合并" of CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-
 * 07-13.md.
 *
 * Letting an agent iterate on CI failures and merge PRs is useful and dangerous.
 * The gap doc pins the guardrails precisely: each failing check may be auto-
 * fixed at most N times within a token/time budget; a fix must read only the
 * CURRENT commit's logs (never chase a stale failure); auto-merge is OFF by
 * default and, when on, requires branch protection, all required checks, an
 * approving review and zero pending approvals — and never pushes a protected
 * branch directly or bypasses protection.
 *
 * This module is those decisions as pure predicates. It holds no state and does
 * no I/O — a caller feeds the observed PR/CI signals and gets an allow/deny with
 * a named reason. Everything defaults to DENY: an unknown or missing signal
 * blocks the automation rather than assuming it is safe.
 */

/** Canonical CI check states. */
export const CHECK_STATE = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  PENDING: "pending",
  NEUTRAL: "neutral",
  ERROR: "error",
});

const CHECK_ALIASES = new Map([
  ["passed", CHECK_STATE.PASSED],
  ["pass", CHECK_STATE.PASSED],
  ["success", CHECK_STATE.PASSED],
  ["succeeded", CHECK_STATE.PASSED],
  ["green", CHECK_STATE.PASSED],
  ["failed", CHECK_STATE.FAILED],
  ["fail", CHECK_STATE.FAILED],
  ["failure", CHECK_STATE.FAILED],
  ["red", CHECK_STATE.FAILED],
  ["pending", CHECK_STATE.PENDING],
  ["queued", CHECK_STATE.PENDING],
  ["in_progress", CHECK_STATE.PENDING],
  ["running", CHECK_STATE.PENDING],
  ["neutral", CHECK_STATE.NEUTRAL],
  ["skipped", CHECK_STATE.NEUTRAL],
  ["cancelled", CHECK_STATE.NEUTRAL],
  ["canceled", CHECK_STATE.NEUTRAL],
  ["error", CHECK_STATE.ERROR],
  ["timed_out", CHECK_STATE.ERROR],
  ["action_required", CHECK_STATE.ERROR],
]);

/** Normalize any provider's check conclusion/status to a canonical state. */
export function normalizeCheckState(value) {
  if (typeof value !== "string") return null;
  return CHECK_ALIASES.get(value.trim().toLowerCase()) || null;
}

/** A failing state that auto-fix could act on. */
function isFailing(state) {
  return state === CHECK_STATE.FAILED || state === CHECK_STATE.ERROR;
}

/**
 * Summarize a set of checks. `allPassed` is true only when there is at least one
 * check and every one is passed or neutral (a bare PR with no checks is NOT
 * "all passed" — required checks must actually exist and run).
 *
 * @param {Array<{name?:string, state?:string, conclusion?:string, status?:string}>} checks
 */
export function summarizeChecks(checks = []) {
  const list = Array.isArray(checks) ? checks : [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  const byName = new Map();
  for (const c of list) {
    const state =
      normalizeCheckState(c?.state) ??
      normalizeCheckState(c?.conclusion) ??
      normalizeCheckState(c?.status);
    if (c?.name != null) byName.set(String(c.name), state);
    if (state === CHECK_STATE.PASSED || state === CHECK_STATE.NEUTRAL) passed++;
    else if (isFailing(state)) failed++;
    else pending++; // pending / unknown → not yet decided
  }
  return {
    total: list.length,
    passed,
    failed,
    pending,
    anyFailed: failed > 0,
    allPassed: list.length > 0 && failed === 0 && pending === 0,
    byName,
  };
}

function budgetExhausted(budget) {
  if (!budget || typeof budget !== "object") return false;
  const over = (spent, cap) =>
    cap != null && Number.isFinite(Number(cap)) && Number(spent) >= Number(cap);
  return (
    over(budget.tokensSpent, budget.tokenBudget) ||
    over(budget.timeSpentMs, budget.timeBudgetMs)
  );
}

/**
 * Decide whether an agent may auto-fix ONE failing check right now. Fail-closed:
 * anything unproven denies.
 *
 * @param {object} params
 * @param {object} params.check           {name, state|conclusion, logCommitSha}
 * @param {string} params.headCommitSha   the PR head the fix would target
 * @param {number} params.iteration       fixes already attempted for this check
 * @param {number} params.maxIterations   cap (default 3)
 * @param {object} [params.budget]        {tokensSpent, tokenBudget, timeSpentMs, timeBudgetMs}
 * @returns {{allow:boolean, reason:string}}
 */
export function autoFixDecision(params = {}) {
  const check = params.check || {};
  const state =
    normalizeCheckState(check.state) ?? normalizeCheckState(check.conclusion);
  if (!isFailing(state)) {
    return { allow: false, reason: "check-not-failing" };
  }

  const maxIterations = Number.isFinite(Number(params.maxIterations))
    ? Number(params.maxIterations)
    : 3;
  const iteration = Number(params.iteration) || 0;
  if (iteration >= maxIterations) {
    return { allow: false, reason: "max-iterations-reached" };
  }

  // Only fix the CURRENT failure: the log we would read must belong to the head
  // commit. A missing/older log sha means we cannot prove freshness → deny.
  const logSha = check.logCommitSha == null ? "" : String(check.logCommitSha);
  const headSha =
    params.headCommitSha == null ? "" : String(params.headCommitSha);
  if (!logSha || !headSha) {
    return { allow: false, reason: "commit-sha-unverifiable" };
  }
  if (logSha !== headSha) {
    return { allow: false, reason: "stale-failure-log" };
  }

  if (budgetExhausted(params.budget)) {
    return { allow: false, reason: "budget-exhausted" };
  }

  return { allow: true, reason: "ok" };
}

/**
 * Decide whether a PR may be auto-merged. Fail-closed and exhaustive: every
 * unmet requirement is collected, and merge is allowed ONLY when the list is
 * empty. Auto-merge is off unless `enabled === true`.
 *
 * @param {object} params
 * @param {boolean} params.enabled                  auto-merge explicitly turned on
 * @param {boolean} params.hasOpenPr                a real PR exists (no direct-to-branch)
 * @param {boolean} params.branchProtectionSatisfied
 * @param {boolean} params.reviewApproved
 * @param {number}  params.pendingApprovals         permission approvals still waiting
 * @param {string[]} params.requiredChecks          names that must be present AND passed
 * @param {Array}   params.checks                   observed checks (summarizeChecks input)
 * @param {string}  [params.targetBranch]
 * @returns {{allow:boolean, reason:string, unmet:string[]}}
 */
export function autoMergeDecision(params = {}) {
  const unmet = [];

  if (params.enabled !== true) unmet.push("auto-merge-disabled");
  if (params.hasOpenPr !== true) unmet.push("no-open-pr");
  if (params.branchProtectionSatisfied !== true) {
    unmet.push("branch-protection-unsatisfied");
  }
  if (params.reviewApproved !== true) unmet.push("review-not-approved");
  if (Number(params.pendingApprovals) > 0) unmet.push("pending-approvals");

  const summary = summarizeChecks(params.checks);
  if (summary.anyFailed) unmet.push("checks-failing");
  if (summary.pending > 0) unmet.push("checks-pending");

  // Every REQUIRED check must be present and passed — a required check that
  // never ran is a block, not a pass.
  const required = Array.isArray(params.requiredChecks)
    ? params.requiredChecks
    : [];
  for (const name of required) {
    const state = summary.byName.get(String(name));
    if (state !== CHECK_STATE.PASSED && state !== CHECK_STATE.NEUTRAL) {
      unmet.push(`required-check-missing:${name}`);
    }
  }

  return {
    allow: unmet.length === 0,
    reason: unmet.length === 0 ? "ok" : unmet[0],
    unmet,
  };
}

/**
 * A compact, log-safe status line for the PR status bar (P1-4 "Session 顶部提供
 * PR 状态条"). Carries only coordinates + a checks tally, never a token.
 *
 * @param {object} params {branch, prNumber, checks, reviewApproved, mergeable}
 * @returns {string}
 */
export function describePrStatusBar(params = {}) {
  const parts = [];
  if (params.branch) parts.push(`branch:${params.branch}`);
  if (params.prNumber != null) parts.push(`PR#${params.prNumber}`);
  const s = summarizeChecks(params.checks);
  parts.push(`checks:${s.passed}/${s.total}${s.anyFailed ? " ✗" : ""}`);
  parts.push(
    `review:${params.reviewApproved === true ? "approved" : "pending"}`,
  );
  if (params.mergeable != null) {
    parts.push(`merge:${params.mergeable ? "ready" : "blocked"}`);
  }
  return parts.join(" · ");
}
