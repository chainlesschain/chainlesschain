const { PlanModeManager, PlanModeState } = require("../plan-mode/index.js");
const { CodingAgentToolAdapter } = require("./coding-agent-tool-adapter.js");
const {
  PLAN_APPROVED_STATES,
  RISK_LEVELS,
  evaluateToolPolicy,
} = require("../../../../../packages/cli/src/runtime/coding-agent-policy.cjs");

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
    const {
      toolName,
      session = null,
      confirmed = false,
      toolArgs = null,
    } = options;

    if (!toolName) {
      throw new Error("evaluateToolCall requires toolName");
    }

    const descriptor = this.getToolDescriptor(toolName, options);
    const planModeState = session?.planModeState || PlanModeState.INACTIVE;
    const evaluation = evaluateToolPolicy({
      toolName,
      toolDescriptor: descriptor,
      planModeState,
      confirmed,
      toolArgs,
    });

    return {
      ...evaluation,
      category: evaluation.category || this.getToolCategory(toolName),
      riskLevel:
        evaluation.riskLevel ||
        descriptor?.riskLevel ||
        this.getRiskLevel(toolName, { toolDescriptor: descriptor }),
      planModeState,
    };
  }

  /**
   * Consults a session-core ApprovalGate for the session's policy and folds
   * that decision into the Plan Mode evaluation. Avoids dual approval (Plan
   * Mode confirmation + ApprovalGate confirmation) by letting policy-driven
   * `allow` short-circuit `requiresConfirmation`.
   *
   * Managed Agents parity Phase H.
   *
   * @param {object} opts - forwarded to `evaluateToolCall` plus
   *   - `approvalGate`: session-core ApprovalGate instance
   *   - `sessionId`: used to look up session policy
   * @returns {Promise<object>} evaluation merged with `{ approvalGate: {...} }`
   */
  async evaluateToolCallWithApprovalGate(opts = {}) {
    const evaluation = this.evaluateToolCall(opts);
    const { approvalGate, sessionId } = opts;

    if (!approvalGate || typeof approvalGate.decide !== "function") {
      return evaluation;
    }

    const gateResult = await approvalGate.decide({
      sessionId,
      riskLevel: evaluation.riskLevel,
      tool: opts.toolName,
      args: opts.toolArgs || null,
    });

    const merged = {
      ...evaluation,
      approvalGate: {
        decision: gateResult.decision,
        via: gateResult.via,
        policy: gateResult.policy,
        riskLevel: gateResult.riskLevel,
      },
    };

    if (gateResult.decision === "deny") {
      merged.decision = "deny";
      merged.allowed = false;
      merged.requiresConfirmation = false;
      merged.denyReason = `ApprovalGate denied (${gateResult.via})`;
    } else if (gateResult.decision === "allow" && gateResult.via === "policy") {
      merged.requiresConfirmation = false;
    }

    return merged;
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
