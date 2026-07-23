"use strict";

const RISK_LEVELS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const TOOL_CATEGORIES = Object.freeze({
  READ: "read",
  SEARCH: "search",
  ANALYZE: "analyze",
  WRITE: "write",
  EXECUTE: "execute",
  DELETE: "delete",
  SKILL: "skill",
  AGENT: "agent",
});

const TOOL_DECISIONS = Object.freeze({
  ALLOW: "allow",
  REQUIRE_PLAN: "require_plan",
  REQUIRE_CONFIRMATION: "require_confirmation",
});

const PLAN_APPROVED_STATES = Object.freeze([
  "approved",
  "executing",
  "completed",
]);

const READ_ONLY_GIT_SUBCOMMANDS = Object.freeze([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
]);

const TOOL_POLICY_METADATA = Object.freeze({
  read_file: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  list_dir: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  search_files: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.SEARCH,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  code_intelligence: {
    // Read-only semantic navigation via LSP (definition/references/hover/
    // symbols/diagnostics/rename-preview). It never mutates the workspace — a
    // rename returns a preview, not an applied edit — so it is auto-approved and
    // available in plan mode, like search_files.
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.ANALYZE,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  edit_file: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  edit_file_hashed: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  write_file: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  delete_file: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  move_file: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  notebook_edit: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "plan",
    isReadOnly: false,
  },
  run_shell: {
    riskLevel: RISK_LEVELS.HIGH,
    category: TOOL_CATEGORIES.EXECUTE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: true,
    approvalFlow: "policy",
    isReadOnly: false,
  },
  git: {
    riskLevel: RISK_LEVELS.HIGH,
    category: TOOL_CATEGORIES.EXECUTE,
    availableInPlanMode: false,
    planModeBehavior: "readonly-conditional",
    requiresPlanApproval: true,
    requiresConfirmation: true,
    approvalFlow: "policy",
    isReadOnly: false,
    readOnlySubcommands: READ_ONLY_GIT_SUBCOMMANDS,
  },
  // Polls a background run_shell task (output + completion). Read-only: it never
  // starts new work — the spawn already happened, gated, under run_shell. The
  // optional kill flag terminates a task the agent itself launched, so it stays
  // low-risk and is allowed during plan mode.
  check_shell: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  list_skills: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.SKILL,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  // Expand a user-defined slash command (.claude/commands/*.md) into its prompt
  // text. Read-only by design: the agent path disables `!`cmd`` bang execution,
  // so only $ARGUMENTS / @file (read) substitution runs — no un-gated shell.
  // Plan-mode-safe (returns text the model then acts on via its normal tools).
  slash_command: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.SKILL,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  search_sessions: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.SEARCH,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  run_skill: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.SKILL,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: false,
    approvalFlow: "policy",
    isReadOnly: false,
  },
  run_code: {
    riskLevel: RISK_LEVELS.HIGH,
    category: TOOL_CATEGORIES.EXECUTE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: true,
    approvalFlow: "policy",
    isReadOnly: false,
  },
  spawn_sub_agent: {
    riskLevel: RISK_LEVELS.HIGH,
    category: TOOL_CATEGORIES.AGENT,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: true,
    approvalFlow: "policy",
    isReadOnly: false,
  },
  web_fetch: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  web_search: {
    riskLevel: RISK_LEVELS.MEDIUM,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  todo_write: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: false,
  },
  ask_user_question: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  // Sends an outbound notification to the user's own channels/device. No
  // workspace mutation and no un-gated shell; blocked in plan mode (an
  // external side effect) but otherwise auto — it targets the user, not a
  // third party.
  notify: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: false,
  },
  // Persists a wakeup/cron/monitor entry for `cc agenda run` to execute later.
  // Writing the schedule is itself harmless (a JSONL row under the user's
  // config dir); the eventual `cc agent`/shell run is gated when the agenda
  // consumer executes it. Blocked in plan mode (schedules future side effects).
  schedule: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: false,
  },
  // Copies a finished deliverable (report/patch/screenshot/log) into the
  // user's own ~/.chainlesschain/artifacts store with metadata. Reads a
  // workspace file, writes only under the user's config dir — no third-party
  // egress. Blocked in plan mode (publishing is a side effect of DONE work,
  // not analysis).
  publish_artifact: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.WRITE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: false,
  },
  // Attaches to the user's own debuggable Chrome over loopback CDP and
  // observes one tab (console/network/DOM/optional screenshot) for a bounded
  // window. Observation only — it never clicks, types, or navigates; the
  // optional reload re-runs the page the user already has open, and the
  // screenshot goes to a generated temp path (never an agent-chosen one), so
  // the tool stays read-only and plan-mode safe.
  browser_state: {
    riskLevel: RISK_LEVELS.LOW,
    category: TOOL_CATEGORIES.READ,
    availableInPlanMode: true,
    planModeBehavior: "allow",
    requiresPlanApproval: false,
    requiresConfirmation: false,
    approvalFlow: "auto",
    isReadOnly: true,
  },
  // DRIVES the user's connected Chrome over loopback CDP — clicks, typing,
  // key presses, navigation, screenshots, text assertions. Unlike
  // browser_state (pure observation, the default) this mutates the page and
  // acts inside whatever session that browser is logged into, so it carries
  // the same gating as run_shell/run_code: HIGH risk (the ApprovalGate
  // CONFIRMs HIGH even on the trusted/auto tier, so auto mode still prompts),
  // blocked in plan mode, plan approval + explicit confirmation required.
  browser_act: {
    riskLevel: RISK_LEVELS.HIGH,
    category: TOOL_CATEGORIES.EXECUTE,
    availableInPlanMode: false,
    planModeBehavior: "blocked",
    requiresPlanApproval: true,
    requiresConfirmation: true,
    approvalFlow: "policy",
    isReadOnly: false,
  },
});

function normalizeGitCommand(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^git\s+/i, "").trim();
}

function isReadOnlyGitCommand(command) {
  const normalized = normalizeGitCommand(command);
  if (!normalized) return false;
  const [subcommand] = normalized.split(/\s+/);
  return READ_ONLY_GIT_SUBCOMMANDS.includes((subcommand || "").toLowerCase());
}

/**
 * Classify a git command as DESTRUCTIVE — one that discards working-tree
 * changes, deletes untracked files, or rewrites history/refs and therefore
 * cannot be cleanly undone. Used to require confirmation before the `git`
 * tool runs such a command in auto mode (Claude-Code 2.1.183 parity:
 * "destructive git commands blocked when unintended").
 *
 * Conservative by design — common, recoverable operations (plain `reset`,
 * `restore --staged`, branch switches, `--force-with-lease`, `rebase
 * --continue`) are NOT flagged, so the guard only interrupts genuinely
 * irrecoverable actions.
 */
function isDangerousGitCommand(command) {
  const normalized = normalizeGitCommand(command);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const sub = (tokens[0] || "").toLowerCase();
  const rest = tokens.slice(1);
  const lower = rest.map((t) => t.toLowerCase());
  const has = (...flags) => flags.some((f) => lower.includes(f));

  switch (sub) {
    case "reset":
      // --hard/--merge/--keep overwrite the working tree irrecoverably
      // (plain/--soft/--mixed only move HEAD/index and are reflog-recoverable).
      return has("--hard", "--merge", "--keep");
    case "clean":
      // Deletes untracked files — irrecoverable.
      return true;
    case "commit":
      // `--amend` rewrites the last commit (history rewrite); a plain commit is
      // not flagged. (Claude-Code 2.1.183 blocks amend of commits the agent did
      // not make this session; we conservatively confirm on any amend.)
      return has("--amend");
    case "checkout":
      // Discard working-tree changes: `checkout -- <path>`, `checkout .`,
      // or `-f`/`--force` (a plain branch checkout is not flagged).
      return (
        lower.includes("--") || lower.includes(".") || has("-f", "--force")
      );
    case "restore":
      // Worktree restore discards changes; a pure `--staged` restore only
      // unstages and is recoverable.
      return !(has("--staged", "-s") && !has("--worktree", "-w"));
    case "switch":
      return has("-f", "--force", "--discard-changes");
    case "push":
      // Rewrites or deletes remote refs:
      //   --force/-f           → force overwrite remote history
      //   a `+refspec` token   → per-ref force push (e.g. `push origin +main`)
      //   --delete/-d, or a    → delete a remote branch/ref
      //     `:dst` token (empty-source refspec, e.g. `push origin :main`)
      //   --mirror             → can delete remote refs to mirror local
      // `--force-with-lease`/`--force-if-includes` are the safe forms (distinct
      // tokens from `--force`) and are NOT flagged; a normal `src:dst` refspec
      // does not start with `:` so it is not flagged either.
      return (
        has("--force", "-f", "--delete", "-d", "--mirror") ||
        rest.some((t) => t.startsWith("+") || t.startsWith(":"))
      );
    case "branch":
      // `-D` (force delete, case-sensitive — `-d` only deletes merged branches)
      // or an explicit `--delete --force`.
      return rest.includes("-D") || (has("--delete") && has("-f", "--force"));
    case "stash":
      return ["drop", "clear"].includes(lower[0] || "");
    case "reflog":
      return ["expire", "delete"].includes(lower[0] || "");
    case "update-ref":
      return has("-d", "--delete");
    case "filter-branch":
    case "filter-repo":
      return true;
    case "gc":
      return lower.some((t) => t.startsWith("--prune"));
    case "rebase":
      // History rewrite; control sub-actions (--abort/--continue/etc.) are safe.
      return ![
        "--abort",
        "--continue",
        "--skip",
        "--quit",
        "--edit-todo",
        "--show-current-patch",
      ].includes(lower[0] || "");
    default:
      return false;
  }
}

function normalizeRiskLevel(value, fallback = RISK_LEVELS.MEDIUM) {
  if (value === RISK_LEVELS.LOW) return RISK_LEVELS.LOW;
  if (value === RISK_LEVELS.MEDIUM) return RISK_LEVELS.MEDIUM;
  if (value === RISK_LEVELS.HIGH) return RISK_LEVELS.HIGH;
  return fallback;
}

function clonePolicy(policy) {
  return JSON.parse(JSON.stringify(policy));
}

function getToolPolicyMetadata(toolName) {
  return TOOL_POLICY_METADATA[toolName] || null;
}

function resolveToolPolicy(toolName, descriptor = null) {
  const base = clonePolicy(
    getToolPolicyMetadata(toolName) || {
      riskLevel: RISK_LEVELS.MEDIUM,
      category: TOOL_CATEGORIES.EXECUTE,
      availableInPlanMode: false,
      planModeBehavior: "blocked",
      requiresPlanApproval: false,
      requiresConfirmation: false,
      approvalFlow: "policy",
      isReadOnly: false,
    },
  );

  if (descriptor?.riskLevel) {
    base.riskLevel = normalizeRiskLevel(descriptor.riskLevel, base.riskLevel);
  }

  if (descriptor?.category) {
    base.category = descriptor.category;
  }

  if (typeof descriptor?.availableInPlanMode === "boolean") {
    base.availableInPlanMode = descriptor.availableInPlanMode;
  }

  if (descriptor?.planModeBehavior) {
    base.planModeBehavior = descriptor.planModeBehavior;
  }

  if (typeof descriptor?.requiresPlanApproval === "boolean") {
    base.requiresPlanApproval = descriptor.requiresPlanApproval;
  }

  if (typeof descriptor?.requiresConfirmation === "boolean") {
    base.requiresConfirmation = descriptor.requiresConfirmation;
  }

  if (descriptor?.approvalFlow) {
    base.approvalFlow = descriptor.approvalFlow;
  }

  if (Array.isArray(descriptor?.readOnlySubcommands)) {
    base.readOnlySubcommands = [...descriptor.readOnlySubcommands];
  }

  if (descriptor?.isReadOnly === true) {
    base.isReadOnly = true;
    base.riskLevel = RISK_LEVELS.LOW;
    base.category = descriptor?.category || TOOL_CATEGORIES.READ;
    if (typeof descriptor?.availableInPlanMode !== "boolean") {
      base.availableInPlanMode = true;
    }
    if (!descriptor?.planModeBehavior) {
      base.planModeBehavior = "allow";
    }
    if (typeof descriptor?.requiresPlanApproval !== "boolean") {
      base.requiresPlanApproval = false;
    }
    if (typeof descriptor?.requiresConfirmation !== "boolean") {
      base.requiresConfirmation = false;
    }
    if (!descriptor?.approvalFlow) {
      base.approvalFlow = "auto";
    }
  }

  return base;
}

function evaluateToolPolicy(options = {}) {
  const {
    toolName,
    toolDescriptor = null,
    planModeState = "inactive",
    confirmed = false,
    toolArgs = null,
  } = options;

  if (!toolName) {
    throw new Error("evaluateToolPolicy requires toolName");
  }

  const policy = resolveToolPolicy(toolName, toolDescriptor);
  const readOnlyGitAllowed =
    toolName === "git" &&
    policy.planModeBehavior === "readonly-conditional" &&
    isReadOnlyGitCommand(toolArgs?.command);
  const planApproved = PLAN_APPROVED_STATES.includes(planModeState);

  if (policy.isReadOnly || policy.riskLevel === RISK_LEVELS.LOW) {
    return {
      toolName,
      allowed: true,
      decision: TOOL_DECISIONS.ALLOW,
      requiresPlanApproval: false,
      requiresConfirmation: false,
      reason: "Read-only tools are allowed without plan approval.",
      riskLevel: policy.riskLevel,
      category: policy.category,
      planModeState,
      planModeBehavior: policy.planModeBehavior,
      readOnlySubcommands: policy.readOnlySubcommands || [],
    };
  }

  if (readOnlyGitAllowed) {
    return {
      toolName,
      allowed: true,
      decision: TOOL_DECISIONS.ALLOW,
      requiresPlanApproval: false,
      requiresConfirmation: false,
      reason: "Read-only git commands are allowed during plan mode.",
      riskLevel: RISK_LEVELS.LOW,
      category: TOOL_CATEGORIES.READ,
      planModeState,
      planModeBehavior: policy.planModeBehavior,
      readOnlySubcommands: policy.readOnlySubcommands || [],
    };
  }

  if (policy.riskLevel === RISK_LEVELS.MEDIUM) {
    if (planApproved) {
      return {
        toolName,
        allowed: true,
        decision: TOOL_DECISIONS.ALLOW,
        requiresPlanApproval: false,
        requiresConfirmation: false,
        reason: "Plan-approved write tool is allowed.",
        riskLevel: policy.riskLevel,
        category: policy.category,
        planModeState,
        planModeBehavior: policy.planModeBehavior,
        readOnlySubcommands: policy.readOnlySubcommands || [],
      };
    }

    return {
      toolName,
      allowed: false,
      decision: TOOL_DECISIONS.REQUIRE_PLAN,
      requiresPlanApproval: true,
      requiresConfirmation: false,
      reason: "Write tools require an approved plan before execution.",
      riskLevel: policy.riskLevel,
      category: policy.category,
      planModeState,
      planModeBehavior: policy.planModeBehavior,
      readOnlySubcommands: policy.readOnlySubcommands || [],
    };
  }

  if (!planApproved) {
    return {
      toolName,
      allowed: false,
      decision: TOOL_DECISIONS.REQUIRE_PLAN,
      requiresPlanApproval: true,
      requiresConfirmation: false,
      reason: "High-risk tools require an approved plan first.",
      riskLevel: policy.riskLevel,
      category: policy.category,
      planModeState,
      planModeBehavior: policy.planModeBehavior,
      readOnlySubcommands: policy.readOnlySubcommands || [],
    };
  }

  if (policy.requiresConfirmation && !confirmed) {
    return {
      toolName,
      allowed: false,
      decision: TOOL_DECISIONS.REQUIRE_CONFIRMATION,
      requiresPlanApproval: false,
      requiresConfirmation: true,
      reason: "High-risk tools require an explicit second confirmation.",
      riskLevel: policy.riskLevel,
      category: policy.category,
      planModeState,
      planModeBehavior: policy.planModeBehavior,
      readOnlySubcommands: policy.readOnlySubcommands || [],
    };
  }

  return {
    toolName,
    allowed: true,
    decision: TOOL_DECISIONS.ALLOW,
    requiresPlanApproval: false,
    requiresConfirmation: false,
    reason: policy.requiresConfirmation
      ? "High-risk tool confirmed after plan approval."
      : "Tool allowed after plan approval.",
    riskLevel: policy.riskLevel,
    category: policy.category,
    planModeState,
    planModeBehavior: policy.planModeBehavior,
    readOnlySubcommands: policy.readOnlySubcommands || [],
  };
}

module.exports = {
  PLAN_APPROVED_STATES,
  READ_ONLY_GIT_SUBCOMMANDS,
  RISK_LEVELS,
  TOOL_CATEGORIES,
  TOOL_DECISIONS,
  TOOL_POLICY_METADATA,
  evaluateToolPolicy,
  getToolPolicyMetadata,
  isDangerousGitCommand,
  isReadOnlyGitCommand,
  normalizeGitCommand,
  resolveToolPolicy,
};
