const { PlanModeManager, PlanModeState } = require("../plan-mode/index.js");
const { CodingAgentToolAdapter } = require("./coding-agent-tool-adapter.js");

const RISK_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

const PLAN_APPROVED_STATES = new Set(["approved", "executing", "completed"]);

class CodingAgentPermissionGate {
  constructor(options = {}) {
    this.toolAdapter =
      options.toolAdapter || new CodingAgentToolAdapter(options);
    this.planModeManager =
      options.planModeManager ||
      new PlanModeManager({
        autoSavePlans: false,
        maxPlansHistory: 1,
      });
  }

  getToolDescriptor(toolName, options = {}) {
    if (options.toolDescriptor?.name === toolName) {
      return options.toolDescriptor;
    }
    if (typeof this.toolAdapter.getToolDescriptorSync === "function") {
      const cachedTool = this.toolAdapter.getToolDescriptorSync(toolName);
      if (cachedTool) {
        return cachedTool;
      }
    }
    return this.toolAdapter.getCoreTool(toolName);
  }

  getToolCategory(toolName) {
    return this.planModeManager.getToolCategory(toolName);
  }

  isToolAllowedInPlanMode(toolName) {
    return this.planModeManager.isToolAllowedInPlanMode(toolName);
  }

  getRiskLevel(toolName, options = {}) {
    const descriptor = this.getToolDescriptor(toolName, options);
    if (descriptor?.riskLevel) {
      return descriptor.riskLevel;
    }

    if (this.isToolAllowedInPlanMode(toolName)) {
      return RISK_LEVELS.LOW;
    }

    const category = this.getToolCategory(toolName);
    if (category === "execute" || category === "delete") {
      return RISK_LEVELS.HIGH;
    }

    return RISK_LEVELS.MEDIUM;
  }

  evaluateToolCall(options = {}) {
    const { toolName, session = null, confirmed = false } = options;

    if (!toolName) {
      throw new Error("evaluateToolCall requires toolName");
    }

    const descriptor = this.getToolDescriptor(toolName, options);
    const riskLevel =
      descriptor?.riskLevel ||
      this.getRiskLevel(toolName, { toolDescriptor: descriptor });
    const category = this.getToolCategory(toolName);
    const planModeState = session?.planModeState || PlanModeState.INACTIVE;
    const planApproved = PLAN_APPROVED_STATES.has(planModeState);

    if (descriptor?.isReadOnly || riskLevel === RISK_LEVELS.LOW) {
      return {
        toolName,
        allowed: true,
        decision: "allow",
        requiresPlanApproval: false,
        requiresConfirmation: false,
        reason: "Read-only tools are allowed without plan approval.",
        riskLevel,
        category,
        planModeState,
      };
    }

    if (riskLevel === RISK_LEVELS.MEDIUM) {
      if (planApproved) {
        return {
          toolName,
          allowed: true,
          decision: "allow",
          requiresPlanApproval: false,
          requiresConfirmation: false,
          reason: "Plan-approved write tool is allowed.",
          riskLevel,
          category,
          planModeState,
        };
      }

      return {
        toolName,
        allowed: false,
        decision: "require_plan",
        requiresPlanApproval: true,
        requiresConfirmation: false,
        reason: "Write tools require an approved plan before execution.",
        riskLevel,
        category,
        planModeState,
      };
    }

    if (!planApproved) {
      return {
        toolName,
        allowed: false,
        decision: "require_plan",
        requiresPlanApproval: true,
        requiresConfirmation: false,
        reason: "High-risk tools require an approved plan first.",
        riskLevel,
        category,
        planModeState,
      };
    }

    if (!confirmed) {
      return {
        toolName,
        allowed: false,
        decision: "require_confirmation",
        requiresPlanApproval: false,
        requiresConfirmation: true,
        reason: "High-risk tools require an explicit second confirmation.",
        riskLevel,
        category,
        planModeState,
      };
    }

    return {
      toolName,
      allowed: true,
      decision: "allow",
      requiresPlanApproval: false,
      requiresConfirmation: false,
      reason: "High-risk tool confirmed after plan approval.",
      riskLevel,
      category,
      planModeState,
    };
  }

  getToolResultAssessment(payload = {}, session = null, options = {}) {
    const error =
      payload?.result?.error || payload?.error || payload?.message || "";

    const blockedMatch =
      typeof error === "string"
        ? error.match(
            /\[(Plan Mode|Host Policy)\]\s+Tool\s+"([^"]+)"\s+is blocked/i,
          )
        : null;
    const toolName =
      payload?.tool ||
      payload?.toolName ||
      payload?.name ||
      blockedMatch?.[2] ||
      null;

    if (!blockedMatch) {
      return null;
    }

    const evaluation = toolName
      ? this.evaluateToolCall({
          toolName,
          session,
          toolDescriptor: options.toolDescriptor || null,
        })
      : null;

    return {
      blocked: true,
      toolName,
      reason: error,
      source: blockedMatch[1] === "Host Policy" ? "host-policy" : "plan-mode",
      riskLevel: evaluation?.riskLevel || null,
      category: evaluation?.category || null,
      decision: evaluation?.decision || "require_plan",
      requiresPlanApproval: evaluation?.requiresPlanApproval ?? true,
      requiresConfirmation: evaluation?.requiresConfirmation ?? false,
      planModeState:
        evaluation?.planModeState ||
        session?.planModeState ||
        PlanModeState.INACTIVE,
    };
  }

  getPolicySummary(options = {}) {
    const tools = Array.isArray(options.tools)
      ? options.tools
      : this.toolAdapter.listCoreTools();
    const toolsByRisk = {
      low: [],
      medium: [],
      high: [],
    };
    const toolsBySource = {};

    for (const tool of tools) {
      const bucket = toolsByRisk[tool.riskLevel];
      if (bucket) {
        bucket.push(tool.name);
      } else {
        // Defensive: a descriptor with an unknown riskLevel should not crash
        // the policy summary; classify it as medium so it still surfaces.
        toolsByRisk.medium.push(tool.name);
      }
      const source = tool.source || "unknown";
      if (!Array.isArray(toolsBySource[source])) {
        toolsBySource[source] = [];
      }
      toolsBySource[source].push(tool.name);
    }

    return {
      planModeRules: {
        low: "allow",
        medium: "require_plan",
        high: "require_plan_and_confirmation",
      },
      toolsByRisk,
      toolsBySource,
    };
  }

  getHighRiskToolsFromPlanItems(items = []) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item) => {
        const toolName = item?.tool || item?.toolName || null;
        if (!toolName) {
          return null;
        }

        const riskLevel = this.getRiskLevel(toolName);
        if (riskLevel !== RISK_LEVELS.HIGH) {
          return null;
        }

        return {
          toolName,
          riskLevel,
          title: item?.title || toolName,
        };
      })
      .filter(Boolean);
  }
}

module.exports = {
  PLAN_APPROVED_STATES,
  RISK_LEVELS,
  CodingAgentPermissionGate,
};
