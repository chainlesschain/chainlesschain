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

import { snapshotMcpJsonRpcInput } from "./mcp-call-ledger.js";

/** Bind startup-only authority without retaining caller-owned mutable data. */
export function captureUnattendedActionPolicy(policy) {
  if (policy == null) return null;
  try {
    const snapshot = snapshotMcpJsonRpcInput(policy);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      throw new TypeError();
    for (const flag of ["unattended", "protectedBranch", "budgetExhausted"]) {
      if (snapshot[flag] !== undefined && typeof snapshot[flag] !== "boolean")
        throw new TypeError();
    }
    if (
      snapshot.allowlist !== undefined &&
      (!Array.isArray(snapshot.allowlist) ||
        snapshot.allowlist.some((value) => typeof value !== "string"))
    )
      throw new TypeError();
    if (
      snapshot.trigger !== undefined &&
      (!snapshot.trigger ||
        typeof snapshot.trigger !== "object" ||
        Array.isArray(snapshot.trigger) ||
        (snapshot.trigger.trusted !== undefined &&
          typeof snapshot.trigger.trusted !== "boolean"))
    )
      throw new TypeError();
    return snapshot;
  } catch {
    const error = new TypeError("Unattended action policy is invalid");
    error.code = "CC_UNATTENDED_POLICY_INVALID";
    throw error;
  }
}

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

// Fixed built-ins with local effects. Peer annotations and generic runtime
// descriptors cannot add to this list. Shell/Git have their own command
// ceilings; opaque executors and persistent/delegated runs remain unknown.
const LOCAL_TOOL_ACTION_CLASS = Object.freeze({
  read_file: ACTION_CLASS.READ,
  search_files: ACTION_CLASS.READ,
  list_dir: ACTION_CLASS.READ,
  list_skills: ACTION_CLASS.READ,
  search_sessions: ACTION_CLASS.READ,
  ask_user_question: ACTION_CLASS.READ,
  write_file: ACTION_CLASS.LOCAL_WRITE,
  edit_file: ACTION_CLASS.LOCAL_WRITE,
  edit_file_hashed: ACTION_CLASS.LOCAL_WRITE,
  delete_file: ACTION_CLASS.LOCAL_WRITE,
  move_file: ACTION_CLASS.LOCAL_WRITE,
  notebook_edit: ACTION_CLASS.LOCAL_WRITE,
  todo_write: ACTION_CLASS.LOCAL_WRITE,
  check_shell: ACTION_CLASS.LOCAL_WRITE,
});

/** Execution guard for built-ins; an opaque host/MCP executor stays unknown. */
export function evaluateUnattendedToolAction(
  name,
  args,
  policy,
  { external = false } = {},
) {
  let actionClass = null;
  if (!external) {
    actionClass = Object.hasOwn(TOOL_ACTION_CLASS, name)
      ? TOOL_ACTION_CLASS[name]
      : Object.hasOwn(LOCAL_TOOL_ACTION_CLASS, name)
        ? LOCAL_TOOL_ACTION_CLASS[name]
        : null;
    if (["run_shell", "git"].includes(name)) actionClass = ACTION_CLASS.READ;
    // Persistent child runs do not yet carry a durable parent effect ceiling.
    if (
      name === "schedule" &&
      ["list", "cancel"].includes(String(args?.action || "").toLowerCase())
    )
      actionClass = ACTION_CLASS.LOCAL_WRITE;
  }
  return {
    actionClass,
    ...evaluateUnattendedAction({ ...policy, actionClass, attended: false }),
  };
}

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
function classifyShellSegments(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const segments = command
    .split(/&&|\|\||[;&\n]|\|/)
    .map((part) =>
      part
        .trim()
        .replace(/^(?:env\s+)?(?:sudo\s+)?(?:command\s+)?/i, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  const classifySegment = (segment) => {
    // Substitution and executable search/filter options can hide effects
    // inside a nominally read-only command. Unsupported syntax is unknown.
    if (
      /[$`'"\\^(){}]/.test(segment) ||
      /(?:^|\s)(?:-exec(?:dir)?|-ok(?:dir)?|--pre)(?:\s|=|$)/.test(segment)
    )
      return null;
    if (
      /^git(?:\s|$)/.test(segment) &&
      !hasKnownGitOptions(segment.split(/\s+/).slice(1))
    )
      return null;
    if (/^git\s+push(?:\s|$)/.test(segment)) return ACTION_CLASS.PUSH;
    if (/^git\s+(?:add|commit|fetch)(?:\s|$)/.test(segment))
      return ACTION_CLASS.LOCAL_WRITE;
    if (/^git\s+(?:merge|rebase|cherry-pick)(?:\s|$)/.test(segment)) {
      return ACTION_CLASS.MERGE;
    }
    if (/^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+publish(?:\s|$)/.test(segment)) {
      return ACTION_CLASS.PUBLISH;
    }
    if (
      /^(?:terraform\s+(?:apply|destroy)|pulumi\s+up|kubectl\s+(?:apply|delete|rollout)|helm\s+(?:install|upgrade)|docker\s+push)(?:\s|$)/.test(
        segment,
      )
    ) {
      return segment.startsWith("docker push")
        ? ACTION_CLASS.DEPLOY
        : ACTION_CLASS.INFRA_MUTATION;
    }
    if (
      /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+run\s+(?:deploy|rollout)(?:\s|$)/.test(
        segment,
      )
    )
      return ACTION_CLASS.DEPLOY;
    if (
      /^(?:git\s+(?:status|diff|log|show)(?:\s|$)|git\s+branch\s*$|(?:ls|dir|pwd|cat|type|rg|grep|find|where)(?:\s|$))/.test(
        segment,
      )
    ) {
      return ACTION_CLASS.READ;
    }
    if (
      /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:test|run\s+(?:test|lint|build)|install)(?:\s|$)/.test(
        segment,
      ) ||
      /^(?:pytest|vitest|jest|cargo\s+test|go\s+test)(?:\s|$)/.test(segment)
    ) {
      return ACTION_CLASS.LOCAL_WRITE;
    }
    if (/^echo(?:\s|$)/.test(segment) && />/.test(segment)) {
      return ACTION_CLASS.LOCAL_WRITE;
    }
    return null;
  };
  return segments.map((segment) => ({
    command: segment,
    actionClass: classifySegment(segment),
  }));
}

const ACTION_RANK = [
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

// Unknown Git options may select executable helpers (upload-pack,
// receive-pack, rebase --exec, custom merge strategies, external diff, ...).
// Accept complete known options only; Git's long-option abbreviations do not
// inherit authority. These are command-specific because -s means different
// things for status, commit and merge.
const SAFE_GIT_OPTIONS = Object.freeze({
  status: [
    "--short",
    "-s",
    "--branch",
    "-b",
    "--porcelain",
    "--porcelain=v1",
    "--porcelain=v2",
    "--untracked-files",
    "--untracked-files=all",
    "--untracked-files=no",
    "--ignored",
  ],
  diff: [
    "--stat",
    "--name-only",
    "--name-status",
    "--numstat",
    "--shortstat",
    "--patch",
    "-p",
    "--no-patch",
    "-s",
    "--cached",
    "--staged",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-color",
  ],
  log: [
    "--oneline",
    "--stat",
    "--name-only",
    "--name-status",
    "--patch",
    "-p",
    "--no-patch",
    "--all",
    "--graph",
    "--decorate",
    "--no-color",
    "-n",
  ],
  show: [
    "--oneline",
    "--stat",
    "--name-only",
    "--name-status",
    "--patch",
    "-p",
    "--no-patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ],
  "rev-parse": [
    "--show-toplevel",
    "--git-dir",
    "--is-inside-work-tree",
    "--verify",
    "--short",
  ],
  "ls-files": [
    "--cached",
    "--others",
    "--modified",
    "--deleted",
    "--exclude-standard",
    "--stage",
    "--error-unmatch",
  ],
  branch: [],
  remote: ["-v"],
  add: [
    "--all",
    "-A",
    "--force",
    "-f",
    "--update",
    "-u",
    "--intent-to-add",
    "-N",
    "--dry-run",
    "-n",
    "--verbose",
    "-v",
  ],
  commit: [
    "-m",
    "--message",
    "-a",
    "--all",
    "--amend",
    "--no-verify",
    "--allow-empty",
    "--allow-empty-message",
    "--signoff",
    "-s",
    "--no-gpg-sign",
    "--quiet",
    "-q",
    "--dry-run",
  ],
  fetch: [
    "--all",
    "--prune",
    "-p",
    "--tags",
    "-t",
    "--no-tags",
    "--quiet",
    "-q",
    "--verbose",
    "-v",
    "--dry-run",
    "--no-recurse-submodules",
    "--unshallow",
  ],
  push: [
    "-u",
    "--set-upstream",
    "--force",
    "-f",
    "--force-with-lease",
    "--no-verify",
    "--dry-run",
    "-n",
    "--all",
    "--mirror",
    "--tags",
    "--delete",
    "-d",
  ],
  merge: [
    "--ff-only",
    "--no-ff",
    "--squash",
    "--abort",
    "--continue",
    "--quit",
    "--no-edit",
    "--no-verify",
    "--no-gpg-sign",
  ],
  rebase: [
    "--abort",
    "--continue",
    "--skip",
    "--quit",
    "--autostash",
    "--no-autostash",
    "--no-gpg-sign",
  ],
  "cherry-pick": [
    "--abort",
    "--continue",
    "--skip",
    "--quit",
    "--no-commit",
    "-n",
    "--no-gpg-sign",
  ],
});

function hasKnownGitOptions(argv) {
  const [subcommand, ...args] = argv;
  const known = SAFE_GIT_OPTIONS[subcommand];
  if (!Array.isArray(known)) return false;
  let pathOperands = false;
  let valueOperand = false;
  return args.every((value) => {
    if (valueOperand) {
      valueOperand = false;
      return true;
    }
    if (/^[a-z][a-z0-9+.-]*::/i.test(value)) return false;
    if (pathOperands) return true;
    if (value === "--") {
      pathOperands = true;
      return true;
    }
    if (!value.startsWith("-")) return true;
    if (
      ["log", "show"].includes(subcommand) &&
      /^--(?:format|pretty)=/.test(value)
    )
      return true;
    if (subcommand === "log" && /^(?:-\d+|--max-count=\d+)$/.test(value))
      return true;
    if (subcommand === "fetch" && /^--depth=\d+$/.test(value)) return true;
    if (subcommand === "commit" && /^--message=/.test(value)) return true;
    if (!known.includes(value)) return false;
    if (
      (subcommand === "commit" && ["-m", "--message"].includes(value)) ||
      (subcommand === "log" && value === "-n")
    )
      valueOperand = true;
    return true;
  });
}

export function classifyShellAction(command) {
  const segments = classifyShellSegments(command);
  if (!segments.length || segments.some((segment) => !segment.actionClass))
    return null;
  return segments.reduce(
    (highest, { actionClass }) =>
      ACTION_RANK.indexOf(actionClass) > ACTION_RANK.indexOf(highest)
        ? actionClass
        : highest,
    null,
  );
}

function pushNeedsMergeAuthorization(argv) {
  const positional = [];
  for (const value of argv) {
    if (
      [
        "-u",
        "--set-upstream",
        "--force",
        "-f",
        "--force-with-lease",
        "--no-verify",
        "--dry-run",
        "-n",
      ].includes(value)
    )
      continue;
    if (value.startsWith("-")) return true;
    positional.push(value);
  }
  // Require an explicit remote AND every destination ref. Git configuration
  // controls omitted refspecs and may include protected branches.
  if (positional.length < 2) return true;
  return positional.slice(1).some((refspec) => {
    const destination = refspec.replace(/^\+/, "").split(":").at(-1);
    if (
      !destination ||
      !/^[a-z0-9._/-]+$/i.test(destination) ||
      destination.toUpperCase() === "HEAD"
    )
      return true;
    const branch = destination.replace(/^refs\/heads\//, "");
    return (
      /^(?:main|master|develop|production)$/i.test(branch) ||
      (/^refs\//.test(destination) && !destination.startsWith("refs/heads/"))
    );
  });
}

/** Classify the exact argv used by the git tool, never a shell string. */
export function evaluateUnattendedGitAction(argv, params = {}) {
  const validArgv =
    Array.isArray(argv) && argv.every((value) => typeof value === "string");
  const subcommand = validArgv ? argv[0] : null;
  const actionClass =
    !validArgv || !hasKnownGitOptions(argv)
      ? null
      : subcommand === "push"
        ? ACTION_CLASS.PUSH
        : ["merge", "rebase", "cherry-pick"].includes(subcommand)
          ? ACTION_CLASS.MERGE
          : ["add", "commit", "fetch"].includes(subcommand)
            ? ACTION_CLASS.LOCAL_WRITE
            : [
                  "status",
                  "diff",
                  "log",
                  "show",
                  "rev-parse",
                  "ls-files",
                ].includes(subcommand) ||
                (subcommand === "branch" && argv.length === 1) ||
                (subcommand === "remote" &&
                  argv.slice(1).every((value) => value === "-v"))
              ? ACTION_CLASS.READ
              : null;
  return {
    actionClass,
    ...evaluateUnattendedAction({
      ...params,
      actionClass,
      protectedBranch:
        params.protectedBranch === true ||
        (subcommand === "push" && pushNeedsMergeAuthorization(argv.slice(1))),
    }),
  };
}

/** Apply the unattended policy to a shell command, including protected push targets. */
export function evaluateUnattendedShellAction(command, params = {}) {
  const segments = classifyShellSegments(command);
  const verdicts = (segments.length ? segments : [{ actionClass: null }]).map(
    (segment) => ({
      actionClass: segment.actionClass,
      ...evaluateUnattendedAction({
        ...params,
        actionClass: segment.actionClass,
        protectedBranch:
          params.protectedBranch === true ||
          (segment.actionClass === ACTION_CLASS.PUSH &&
            pushNeedsMergeAuthorization(segment.command.split(/\s+/).slice(2))),
      }),
    }),
  );
  // An allowlist grants individual classes, never all lower-ranked actions.
  const denied = verdicts.find((verdict) => !verdict.allow);
  if (denied) return denied;
  return verdicts.reduce((highest, current) =>
    ACTION_RANK.indexOf(current.actionClass) >
    ACTION_RANK.indexOf(highest.actionClass)
      ? current
      : highest,
  );
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
