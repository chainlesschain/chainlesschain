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

const PLAN_APPROVED_STATES = Object.freeze(["approved", "executing", "completed"]);

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
  isReadOnlyGitCommand,
  normalizeGitCommand,
  resolveToolPolicy,
};
