/**
 * Unattended-action policy — the fail-closed guard behind P1-8's
 * "默认禁止无人值守发布、合并或修改共享基础设施" of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md.
 *
 * A scheduled or event-driven session runs with NO human watching, and P1-8 is
 * explicit that external trigger content is untrusted by default. [[cost-budget.js]]
 * already caps USD spend and [[schedule-planner.js]] decides WHEN a task fires,
 * but nothing decides WHAT a fired task may irreversibly do. Publishing a
 * package, merging a PR, deploying, or mutating shared infrastructure while
 * unattended is exactly the class of action that must never happen ambiently.
 *
 * This module is that pure decision. Given an action's risk class and the run's
 * context (attended? trigger trusted? explicitly allowlisted? within budget?) it
 * returns allow/deny with a named reason. Everything defaults to DENY: an
 * unrecognized action on an unattended run is refused, not assumed safe.
 *
 * PURE: no fs / clock / RNG / process.
 */

/** Canonical action classes, ordered low → high consequence. */
export const ACTION_CLASS = Object.freeze({
  READ: "read",
  LOCAL_WRITE: "local_write", // edit files in the worktree
  COMMIT: "commit", // local commit (reversible, not shared)
  PUSH: "push", // push a branch to a remote
  PUBLISH: "publish", // npm publish / release — irreversible & public
  MERGE: "merge", // merge a PR into a shared branch
  DEPLOY: "deploy", // deploy / roll out
  INFRA_MUTATION: "infra_mutation", // modify shared infrastructure
  EXTERNAL_MESSAGE: "external_message", // send mail / chat / webhook outward
});

const ACTION_ALIASES = new Map([
  ["read", ACTION_CLASS.READ],
  ["local_write", ACTION_CLASS.LOCAL_WRITE],
  ["write", ACTION_CLASS.LOCAL_WRITE],
  ["edit", ACTION_CLASS.LOCAL_WRITE],
  ["commit", ACTION_CLASS.COMMIT],
  ["push", ACTION_CLASS.PUSH],
  ["publish", ACTION_CLASS.PUBLISH],
  ["release", ACTION_CLASS.PUBLISH],
  ["merge", ACTION_CLASS.MERGE],
  ["deploy", ACTION_CLASS.DEPLOY],
  ["rollout", ACTION_CLASS.DEPLOY],
  ["infra_mutation", ACTION_CLASS.INFRA_MUTATION],
  ["infra", ACTION_CLASS.INFRA_MUTATION],
  ["external_message", ACTION_CLASS.EXTERNAL_MESSAGE],
  ["message", ACTION_CLASS.EXTERNAL_MESSAGE],
  ["notify", ACTION_CLASS.EXTERNAL_MESSAGE],
]);

/** Actions that are safe to run unattended (local, reversible, not shared). */
const LOW_RISK = new Set([
  ACTION_CLASS.READ,
  ACTION_CLASS.LOCAL_WRITE,
  ACTION_CLASS.COMMIT,
]);

/**
 * Actions that touch a shared / public / irreversible surface and therefore
 * require attendance (or an explicit allowlist entry) when unattended.
 */
const HIGH_RISK = new Set([
  ACTION_CLASS.PUBLISH,
  ACTION_CLASS.MERGE,
  ACTION_CLASS.DEPLOY,
  ACTION_CLASS.INFRA_MUTATION,
  ACTION_CLASS.EXTERNAL_MESSAGE,
]);

/** Normalize an action label to a canonical class, or null when unrecognized. */
export function normalizeActionClass(value) {
  if (typeof value !== "string") return null;
  return ACTION_ALIASES.get(value.trim().toLowerCase()) || null;
}

/** Coarse risk tier for an action: "low" | "high" | "conditional" | "unknown". */
export function classifyActionRisk(actionClass) {
  const a = normalizeActionClass(actionClass);
  if (a == null) return "unknown";
  if (LOW_RISK.has(a)) return "low";
  if (HIGH_RISK.has(a)) return "high";
  return "conditional"; // push — depends on branch protection
}

/**
 * Decide whether a fired task may perform one action. Fail-closed.
 *
 * @param {object} params
 * @param {string}  params.actionClass         action label (normalized)
 * @param {boolean} params.attended            a human is watching this run
 * @param {object}  [params.trigger]           {trusted?:boolean} — event source trust
 * @param {string[]} [params.allowlist]        action classes pre-approved for unattended
 * @param {boolean} [params.protectedBranch]   the push/merge targets a protected branch
 * @param {boolean} [params.budgetExhausted]   the run's budget is spent
 * @returns {{allow:boolean, reason:string}}
 */
export function evaluateUnattendedAction(params = {}) {
  const action = normalizeActionClass(params.actionClass);

  // A hard budget cap blocks everything, attended or not.
  if (params.budgetExhausted === true) {
    return { allow: false, reason: "budget-exhausted" };
  }

  // Unrecognized action: a human may vet it, but an unattended run must not.
  if (action == null) {
    return params.attended === true
      ? { allow: true, reason: "attended" }
      : { allow: false, reason: "unknown-action-unattended" };
  }

  // A watching human can authorize anything within budget.
  if (params.attended === true) return { allow: true, reason: "attended" };

  // ── Unattended from here on ──
  const allowlist = new Set(
    (Array.isArray(params.allowlist) ? params.allowlist : [])
      .map((a) => normalizeActionClass(a))
      .filter(Boolean),
  );

  // A push to a PROTECTED branch is effectively a merge into shared state.
  const effective =
    action === ACTION_CLASS.PUSH && params.protectedBranch === true
      ? ACTION_CLASS.MERGE
      : action;

  if (LOW_RISK.has(effective)) return { allow: true, reason: "low-risk" };

  // A plain push to an unprotected branch is allowed unattended.
  if (effective === ACTION_CLASS.PUSH)
    return { allow: true, reason: "push-unprotected" };

  // High-risk unattended: external trigger content is untrusted by default, and
  // even a trusted trigger must be on the explicit allowlist.
  if (params.trigger && params.trigger.trusted === false) {
    return { allow: false, reason: "untrusted-trigger" };
  }
  if (!allowlist.has(effective)) {
    return { allow: false, reason: "requires-attendance" };
  }
  return { allow: true, reason: "allowlisted" };
}
