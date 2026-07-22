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

/**
 * Agent tools whose effect maps to a high-risk action class that can be cleanly
 * blocked at the tool layer. `git push` / npm-publish-via-shell are deliberately
 * NOT here — they ride the `git` / `run_shell` tools (which also do read-only
 * work) and stay governed by the shell policy, not a blanket tool removal.
 */
export const TOOL_ACTION_CLASS = Object.freeze({
  publish_artifact: ACTION_CLASS.PUBLISH,
  notify: ACTION_CLASS.EXTERNAL_MESSAGE,
});

/**
 * The agent tools an UNATTENDED run must be denied — the enforcement projection
 * of `evaluateUnattendedAction` onto the tool layer (P1-8). A scheduled
 * `cc agent` run passes the result as `--disallowed-tools`, so the model can
 * never even call a denied high-risk tool. An attended run — or one whose class
 * is on the allowlist — yields no restriction. PURE; result is sorted so the
 * spawned argv is stable.
 *
 * @param {{attended?:boolean, allowlist?:string[], trigger?:object, budgetExhausted?:boolean}} p
 * @returns {string[]} tool names to disallow
 */
export function unattendedDisallowedTools(p = {}) {
  const out = [];
  for (const [tool, actionClass] of Object.entries(TOOL_ACTION_CLASS)) {
    const verdict = evaluateUnattendedAction({
      actionClass,
      attended: p.attended === true,
      allowlist: p.allowlist,
      trigger: p.trigger,
      budgetExhausted: p.budgetExhausted,
    });
    if (!verdict.allow) out.push(tool);
  }
  return out.sort();
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
 * Classify a shell command before it reaches the process broker. This is a
 * deliberately conservative, token-free classifier: compound commands use
 * the highest-risk segment and unknown commands remain unknown so an
 * unattended caller can fail closed.
 */
export function classifyShellAction(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  const segments = command
    .split(/&&|\|\||[;\n]|\|/)
    .map((part) =>
      part
        .trim()
        .replace(/^(?:env\s+)?(?:sudo\s+)?(?:command\s+)?/i, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  const classifySegment = (segment) => {
    if (/^git\s+push\b/.test(segment)) return ACTION_CLASS.PUSH;
    if (/^git\s+(?:merge|rebase|cherry-pick)\b/.test(segment)) {
      return ACTION_CLASS.MERGE;
    }
    if (/^(?:npm|pnpm|yarn|bun)\s+publish\b/.test(segment)) {
      return ACTION_CLASS.PUBLISH;
    }
    if (
      /^(?:terraform\s+(?:apply|destroy)|pulumi\s+up|kubectl\s+(?:apply|delete|rollout)|helm\s+(?:install|upgrade)|docker\s+push)\b/.test(
        segment,
      )
    ) {
      return segment.startsWith("docker push")
        ? ACTION_CLASS.DEPLOY
        : ACTION_CLASS.INFRA_MUTATION;
    }
    if (/\b(?:deploy|rollout)\b/.test(segment)) return ACTION_CLASS.DEPLOY;
    if (/^(?:git\s+(?:status|diff|log|show|branch)|ls\b|dir\b|pwd\b|cat\b|type\b|rg\b|grep\b|find\b|where\b)/.test(segment)) {
      return ACTION_CLASS.READ;
    }
    if (/^(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|lint|build)|install\b)/.test(segment) || /^(?:pytest|vitest|jest|cargo\s+test|go\s+test)\b/.test(segment)) {
      return ACTION_CLASS.LOCAL_WRITE;
    }
    if (/^echo\b/.test(segment) && />/.test(segment)) {
      return ACTION_CLASS.LOCAL_WRITE;
    }
    return null;
  };
  const rank = [
    ACTION_CLASS.READ,
    ACTION_CLASS.LOCAL_WRITE,
    ACTION_CLASS.COMMIT,
    ACTION_CLASS.PUSH,
    ACTION_CLASS.PUBLISH,
    ACTION_CLASS.MERGE,
    ACTION_CLASS.DEPLOY,
    ACTION_CLASS.INFRA_MUTATION,
    ACTION_CLASS.EXTERNAL_MESSAGE,
  ];
  const classified = segments.map(classifySegment);
  return classified.reduce((highest, current) => {
    if (!current) return null;
    if (!highest) return current;
    return rank.indexOf(current) > rank.indexOf(highest) ? current : highest;
  }, null);
}

/** Apply the unattended policy to a shell command, including protected push targets. */
export function evaluateUnattendedShellAction(command, params = {}) {
  const actionClass = classifyShellAction(command);
  const protectedBranch =
    params.protectedBranch === true ||
    /\bgit\s+push\b[^\n]*(?:^|\s)(?:main|master|develop|production)(?:\s|$)/i.test(
      command || "",
    );
  return {
    actionClass,
    ...evaluateUnattendedAction({
    ...params,
    actionClass,
    protectedBranch,
    }),
  };
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
