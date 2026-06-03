import { ref, computed } from "vue";
import { message as antMessage } from "ant-design-vue";

/**
 * AIChatPage 的 coding-agent 审批面板逻辑 (FAMILY-... SFC 拆分第五步)。
 *
 * plan 审批 / 高风险确认 / 阻断工具展示 / 权限放宽 + 对应处理器。从 AIChatPage.vue 抽出。
 *
 * **必须在 useCodingAgentEvents 调用之前** 取值 —— 产出的 currentHighRiskToolNames 被事件
 * composable 注入消费。处理器对 ensureCodingAgentSession (页面) 与 ensurePendingAgentMessage
 * (事件 composable) 走 **lazy 注入** (闭包运行时解析; 同 useAiChatWorktree 模式)。
 *
 * 注入: codingAgentStore, currentCodingAgentSessionId, isThinking,
 *       ensureCodingAgentSession (lazy), ensurePendingAgentMessage (lazy)。
 */
export function useAgentApprovals({
  codingAgentStore,
  sessionCoreStore,
  currentCodingAgentSessionId,
  isThinking,
  ensureCodingAgentSession,
  ensurePendingAgentMessage,
}) {
  const currentPlanModeState = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return null;
    }
    return codingAgentStore.currentSession?.planModeState || null;
  });

  const currentApprovalRequest = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return null;
    }
    if (currentPlanModeState.value !== "plan_ready") {
      return null;
    }
    return codingAgentStore.latestApprovalRequest?.payload || null;
  });

  const approvalPanelTitle = computed(() => {
    if (currentApprovalRequest.value) {
      return "Plan approval required";
    }

    if (needsHighRiskConfirmation.value) {
      return "High-risk confirmation required";
    }

    return "Approval required";
  });

  const approvalPanelSummary = computed(() => {
    if (currentApprovalRequest.value) {
      return approvalRequestDescription.value;
    }

    if (needsHighRiskConfirmation.value) {
      return highRiskConfirmationDescription.value;
    }

    return "";
  });

  const approvalPlanItems = computed(() => {
    const rawItems = Array.isArray(
      codingAgentStore.currentSession?.lastPlanItems,
    )
      ? codingAgentStore.currentSession.lastPlanItems
      : Array.isArray(currentApprovalRequest.value?.items)
        ? currentApprovalRequest.value.items
        : [];

    return rawItems.map((item, index) => {
      if (typeof item === "string") {
        return {
          key: `plan-item-${index}`,
          title: item,
          tool: null,
          description: null,
        };
      }

      return {
        key: item?.id || `plan-item-${index}`,
        title:
          item?.title ||
          item?.summary ||
          item?.name ||
          item?.action ||
          `Step ${index + 1}`,
        tool: item?.tool || item?.toolName || null,
        description: item?.description || item?.reason || null,
      };
    });
  });

  const approvalPolicyMediumTools = computed(() => {
    return codingAgentStore.permissionPolicy?.toolsByRisk?.medium || [];
  });

  const approvalPolicyHighTools = computed(() => {
    return codingAgentStore.permissionPolicy?.toolsByRisk?.high || [];
  });

  const showApprovalPanel = computed(() => {
    return Boolean(
      currentApprovalRequest.value || needsHighRiskConfirmation.value,
    );
  });

  const currentBlockedTool = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return null;
    }
    if (
      !currentApprovalRequest.value &&
      !codingAgentStore.requiresHighRiskConfirmation
    ) {
      return null;
    }
    return codingAgentStore.latestBlockedToolEvent?.payload || null;
  });

  // Phase J+: surface ApprovalGate `approval.denied` events. Distinct from
  // `currentBlockedTool` (Plan Mode / Permission Gate) because the recovery
  // path is different — the user typically needs to flip the per-session
  // policy (strict→trusted) via the session-core API or `cc session policy`.
  const currentApprovalDenied = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return null;
    }
    return codingAgentStore.latestApprovalDeniedEvent?.payload || null;
  });

  const planActionLabel = computed(() => {
    return currentPlanModeState.value &&
      currentPlanModeState.value !== "inactive"
      ? "Show Plan"
      : "Plan";
  });

  const subAgentSummaryItems = computed(() => {
    const bucket = codingAgentStore.currentSessionSubAgents;
    if (!bucket) {
      return [];
    }
    const active = (bucket.active || []).map((sub) => ({
      id: sub.id,
      color: "processing",
      label: `▶ ${sub.role || "sub"}`,
    }));
    const recent = (bucket.history || []).slice(0, 3).map((sub) => ({
      id: sub.id,
      color: sub.status === "failed" ? "error" : "success",
      label: `${sub.status === "failed" ? "✗" : "✓"} ${sub.role || "sub"}`,
    }));
    return [...active, ...recent];
  });

  const approvalRequestDescription = computed(() => {
    const policy = codingAgentStore.permissionPolicy;
    const mediumTools = policy?.toolsByRisk?.medium || [];
    const highTools = policy?.toolsByRisk?.high || [];
    const details = [];

    if (mediumTools.length > 0) {
      details.push(`Plan approval unlocks: ${mediumTools.join(", ")}`);
    }

    if (highTools.length > 0) {
      details.push(
        `High-risk tools still need extra confirmation: ${highTools.join(", ")}`,
      );
    }

    return (
      details.join(". ") ||
      "This plan includes controlled operations. Approve it before the agent can continue."
    );
  });

  const blockedToolDescription = computed(() => {
    if (!currentBlockedTool.value) {
      return "";
    }

    const riskSuffix = currentBlockedTool.value.riskLevel
      ? `Risk: ${currentBlockedTool.value.riskLevel}.`
      : "";

    return `${currentBlockedTool.value.reason || "The tool was blocked by the desktop permission gate."} ${riskSuffix}`.trim();
  });

  const isRelaxingPolicy = ref(false);
  const handleRelaxApprovalPolicy = async () => {
    const sessionId = currentCodingAgentSessionId.value;
    if (!sessionId) {
      antMessage.warning("No active coding-agent session.");
      return;
    }
    if (isRelaxingPolicy.value) {
      return;
    }
    isRelaxingPolicy.value = true;
    try {
      const result = await sessionCoreStore.setPolicy(sessionId, "trusted");
      if (result) {
        antMessage.success(
          `Session policy set to 'trusted'. Retry the tool to continue.`,
        );
      } else {
        antMessage.error(
          sessionCoreStore.lastError || "Failed to set session policy.",
        );
      }
    } catch (error) {
      antMessage.error(
        `Failed to set session policy: ${error.message || error}`,
      );
    } finally {
      isRelaxingPolicy.value = false;
    }
  };

  const approvalDeniedDescription = computed(() => {
    const event = currentApprovalDenied.value;
    if (!event) {
      return "";
    }

    const parts = [];
    if (event.reason) {
      parts.push(event.reason);
    } else {
      parts.push("ApprovalGate denied this tool call.");
    }
    if (event.policy) {
      parts.push(`Policy: ${event.policy}.`);
    }
    if (event.riskLevel) {
      parts.push(`Risk: ${event.riskLevel}.`);
    }
    if (event.policy === "strict") {
      parts.push(
        "Relax the per-session policy (e.g. set to 'trusted') to allow this tool.",
      );
    }
    return parts.join(" ");
  });

  const currentHighRiskToolNames = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return [];
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return [];
    }
    return codingAgentStore.currentSession?.highRiskToolNames || [];
  });

  const needsHighRiskConfirmation = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return false;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return false;
    }
    return codingAgentStore.requiresHighRiskConfirmation;
  });

  const highRiskConfirmationDescription = computed(() => {
    if (currentHighRiskToolNames.value.length === 0) {
      return "This approved plan still needs explicit confirmation before high-risk steps can run.";
    }

    return `Confirm before continuing. High-risk tools: ${currentHighRiskToolNames.value.join(", ")}.`;
  });

  const continueApprovedPlanExecution = async () => {
    const result = await codingAgentStore.sendMessage(
      "Proceed with the approved plan and carry out the approved changes.",
    );
    if (!result?.success) {
      throw new Error(
        result?.error || "Failed to continue after plan approval",
      );
    }
    ensurePendingAgentMessage(result.requestId, result.sessionId);
  };

  const ensureHighRiskConfirmation = async () => {
    if (!codingAgentStore.requiresHighRiskConfirmation) {
      return true;
    }

    antMessage.warning(
      "Confirm the pending high-risk actions in the approval panel before continuing.",
    );
    return false;
  };

  const handleEnterPlanMode = async () => {
    try {
      await ensureCodingAgentSession();
      if (
        currentPlanModeState.value &&
        currentPlanModeState.value !== "inactive"
      ) {
        await codingAgentStore.showPlan();
        return;
      }

      await codingAgentStore.enterPlanMode();
    } catch (error) {
      antMessage.error("进入计划模式失败: " + error.message);
    }
  };

  const handleApprovePlan = async () => {
    try {
      await ensureCodingAgentSession();
      isThinking.value = true;
      await codingAgentStore.respondApproval({
        approvalType: "plan",
        decision: "granted",
      });
      if (codingAgentStore.requiresHighRiskConfirmation) {
        isThinking.value = false;
        antMessage.info(
          "Plan approved. Confirm the high-risk actions in the approval panel to continue.",
        );
        return;
      }
      await continueApprovedPlanExecution();
    } catch (error) {
      isThinking.value = false;
      antMessage.error("批准计划失败: " + error.message);
    }
  };

  const handleRejectPlan = async () => {
    try {
      await ensureCodingAgentSession();
      await codingAgentStore.respondApproval({
        approvalType: "plan",
        decision: "denied",
      });
      isThinking.value = false;
    } catch (error) {
      antMessage.error("拒绝计划失败: " + error.message);
    }
  };

  const handleConfirmHighRisk = async () => {
    try {
      await ensureCodingAgentSession();
      isThinking.value = true;
      await codingAgentStore.respondApproval({
        approvalType: "high-risk",
        decision: "granted",
      });
      await continueApprovedPlanExecution();
    } catch (error) {
      isThinking.value = false;
      antMessage.error("确认高风险操作失败: " + error.message);
    }
  };

  const handleRejectHighRisk = async () => {
    try {
      await ensureCodingAgentSession();
      await codingAgentStore.respondApproval({
        approvalType: "high-risk",
        decision: "denied",
      });
      isThinking.value = false;
      antMessage.info("High-risk actions were cancelled.");
    } catch (error) {
      antMessage.error("取消高风险操作失败: " + error.message);
    }
  };

  return {
    currentApprovalRequest,
    approvalPanelTitle,
    approvalPanelSummary,
    approvalPlanItems,
    approvalPolicyMediumTools,
    approvalPolicyHighTools,
    showApprovalPanel,
    currentBlockedTool,
    currentApprovalDenied,
    planActionLabel,
    subAgentSummaryItems,
    blockedToolDescription,
    isRelaxingPolicy,
    handleRelaxApprovalPolicy,
    approvalDeniedDescription,
    currentHighRiskToolNames,
    needsHighRiskConfirmation,
    highRiskConfirmationDescription,
    ensureHighRiskConfirmation,
    handleEnterPlanMode,
    handleApprovePlan,
    handleRejectPlan,
    handleConfirmHighRisk,
    handleRejectHighRisk,
  };
}
