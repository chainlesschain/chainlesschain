import { message as antMessage } from "ant-design-vue";
import { createLogger } from "@/utils/logger";

/**
 * AIChatPage 的 coding-agent 事件处理 (FAMILY-... SFC 拆分第三步)。
 *
 * 把 agent 流式事件 → 助手消息/步骤 的处理逻辑从 AIChatPage.vue 抽出:
 * pending-message 维护、step 创建/收尾、助手消息持久化、handleCodingAgentEvent 主分发。
 *
 * **不含** harness 面板刷新 (refreshCodingAgentHarnessPanel) 与 session 确保
 * (ensureCodingAgentSession) —— 那两者分属 harness/session 概念, 留在页面 (后者还被
 * useAiChatWorktree 依赖)。本 composable 与它们零调用耦合。
 *
 * 依赖由页面 setup 注入 (均为页面拥有的可变 ref / store):
 *  - codingAgentStore, currentCodingAgentSessionId
 *  - messages: 聊天消息列表 ref (事件处理就地改它)
 *  - activeConversationId
 *  - agentMessageByRequestId: requestId → 助手消息 的映射 ref
 *  - processedCodingAgentEventIds: 已处理事件 id 的 Set (去重)
 *  - isThinking: 思考态 ref
 */
export function useCodingAgentEvents({
  codingAgentStore,
  currentCodingAgentSessionId,
  messages,
  activeConversationId,
  agentMessageByRequestId,
  processedCodingAgentEventIds,
  isThinking,
  currentHighRiskToolNames,
}) {
  const agentLogger = createLogger("AIChatPageCodingAgent");

  const findMessageById = (messageId) =>
    messages.value.find((message) => message.id === messageId);

  const getPendingAgentMessage = (requestId) => {
    if (!requestId) {
      return null;
    }
    const messageId = agentMessageByRequestId.value[requestId];
    return messageId ? findMessageById(messageId) : null;
  };

  const ensurePendingAgentMessage = (requestId, sessionId) => {
    const existingMessage = getPendingAgentMessage(requestId);
    if (existingMessage) {
      return existingMessage;
    }

    const assistantMessage = {
      id: `msg-${Date.now()}-agent-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      steps: [],
      preview: null,
      savedToMemory: false,
      sessionId,
      requestId,
      persisted: false,
    };

    messages.value.push(assistantMessage);
    if (requestId) {
      agentMessageByRequestId.value = {
        ...agentMessageByRequestId.value,
        [requestId]: assistantMessage.id,
      };
    }
    return assistantMessage;
  };

  const clearPendingAgentMessage = (requestId) => {
    if (!requestId || !agentMessageByRequestId.value[requestId]) {
      return;
    }

    const nextMapping = { ...agentMessageByRequestId.value };
    delete nextMapping[requestId];
    agentMessageByRequestId.value = nextMapping;
  };

  const createAgentStep = (event) => ({
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "running",
    name: event.payload.display || event.payload.tool || "Tool execution",
    title: event.payload.display || event.payload.tool || "Tool execution",
    tool: event.payload.tool || "",
    description: event.payload.display || "",
    params: event.payload.args || {},
    result: null,
    error: null,
    startedAt: event.timestamp,
    logs: [
      {
        timestamp: event.timestamp,
        level: "info",
        message: `Executing ${event.payload.tool || "tool"}`,
      },
    ],
  });

  const getLatestRunningStep = (assistantMessage, toolName) => {
    if (!assistantMessage?.steps?.length) {
      return null;
    }

    for (
      let index = assistantMessage.steps.length - 1;
      index >= 0;
      index -= 1
    ) {
      const step = assistantMessage.steps[index];
      if (step.tool === toolName && step.status === "running") {
        return step;
      }
    }

    return null;
  };

  const finalizeAgentSteps = (assistantMessage) => {
    if (!assistantMessage?.steps?.length) {
      return;
    }

    assistantMessage.steps.forEach((step) => {
      if (step.status === "running") {
        step.status = "completed";
        step.logs = [
          ...(step.logs || []),
          {
            timestamp: new Date().toISOString(),
            level: "success",
            message: "Step completed",
          },
        ];
      }
    });
  };

  const persistAssistantMessage = async (assistantMessage) => {
    if (
      !assistantMessage ||
      assistantMessage.persisted ||
      !activeConversationId.value
    ) {
      return;
    }

    try {
      await window.electronAPI.conversation.addMessage(
        activeConversationId.value,
        {
          role: "assistant",
          content: assistantMessage.content,
          steps: assistantMessage.steps || [],
          preview: assistantMessage.preview || null,
        },
      );
      assistantMessage.persisted = true;
    } catch (error) {
      agentLogger.error("persistAssistantMessage failed:", error);
    }
  };

  const handleCodingAgentEvent = async (event) => {
    if (!event?.id || processedCodingAgentEventIds.has(event.id)) {
      return;
    }

    processedCodingAgentEventIds.add(event.id);

    if (
      event.sessionId &&
      event.sessionId !== currentCodingAgentSessionId.value
    ) {
      return;
    }

    switch (event.type) {
      case "tool.call.started":
      case "tool-executing": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        assistantMessage.steps = [
          ...(assistantMessage.steps || []),
          createAgentStep(event),
        ];
        break;
      }
      case "tool.call.completed":
      case "tool-result": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        const step = getLatestRunningStep(assistantMessage, event.payload.tool);
        if (step) {
          step.status = event.payload.error ? "failed" : "completed";
          step.result = event.payload.error
            ? step.result
            : event.payload.result;
          step.error = event.payload.error || null;
          step.logs = [
            ...(step.logs || []),
            {
              timestamp: event.timestamp,
              level: event.payload.error ? "error" : "success",
              message: event.payload.error
                ? `Tool failed: ${event.payload.error}`
                : "Tool completed",
            },
          ];
          if (step.startedAt) {
            step.duration =
              new Date(event.timestamp).getTime() -
              new Date(step.startedAt).getTime();
          }
        }
        break;
      }
      case "plan.approval_required":
      case "plan-ready": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        assistantMessage.content = event.payload.summary
          ? `${event.payload.summary}\n\n请审批后继续执行。`
          : "计划已生成，等待审批。";
        assistantMessage.timestamp = Date.now();
        isThinking.value = false;
        break;
      }
      case "approval.requested":
      case "approval-requested": {
        antMessage.info(
          "Plan ready. Approve it before write or shell steps can run.",
        );
        break;
      }
      case "approval.high-risk.requested":
      case "high-risk-confirmation-required": {
        const tools = event.payload.tools || [];
        antMessage.warning(
          tools.length > 0
            ? `High-risk confirmation required for: ${tools.join(", ")}`
            : "High-risk confirmation required before execution can continue.",
        );
        break;
      }
      case "approval.high-risk.granted":
      case "high-risk-confirmed": {
        antMessage.success("High-risk execution confirmed.");
        break;
      }
      case "tool.call.failed":
      case "tool-blocked": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        const toolName = event.payload.toolName || "tool";
        let step = getLatestRunningStep(assistantMessage, toolName);

        if (!step) {
          step = {
            id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: "failed",
            name: toolName,
            title: toolName,
            tool: toolName,
            description:
              event.payload.reason ||
              "Blocked by coding-agent permission policy",
            params: {},
            result: null,
            error:
              event.payload.reason ||
              "Blocked by coding-agent permission policy",
            startedAt: event.timestamp,
            logs: [],
          };
          assistantMessage.steps = [...(assistantMessage.steps || []), step];
        }

        step.status = "failed";
        step.error =
          event.payload.reason || "Blocked by coding-agent permission policy";
        step.logs = [
          ...(step.logs || []),
          {
            timestamp: event.timestamp,
            level: "warning",
            message: event.payload.reason || `${toolName} was blocked`,
          },
        ];

        if (!assistantMessage.content) {
          assistantMessage.content = `Blocked ${toolName}. Review the plan and approve it before continuing.`;
        }

        antMessage.warning(event.payload.reason || `${toolName} was blocked`);
        break;
      }
      case "assistant.final":
      case "response-complete": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        assistantMessage.content =
          event.payload.content || assistantMessage.content || "已完成";
        assistantMessage.timestamp = Date.now();
        finalizeAgentSteps(assistantMessage);
        isThinking.value = false;
        await persistAssistantMessage(assistantMessage);
        clearPendingAgentMessage(event.requestId);
        break;
      }
      case "command-response": {
        const result = event.payload.result || {};
        if (!result.error && event.payload.command === "/plan approve") {
          if (
            currentHighRiskToolNames.value.length > 0 ||
            codingAgentStore.requiresHighRiskConfirmation
          ) {
            isThinking.value = false;
            antMessage.success(
              "Plan approved. Waiting for high-risk confirmation.",
            );
          } else {
            isThinking.value = true;
            antMessage.success("Plan approved. Continuing execution.");
          }
          break;
        }

        if (!result.error && event.payload.command === "/plan reject") {
          isThinking.value = false;
          antMessage.info("Plan rejected.");
          break;
        }

        if (!result.error && result.state === "analyzing") {
          isThinking.value = false;
          antMessage.info(result.message || "Plan mode enabled.");
          break;
        }

        if (result.error) {
          isThinking.value = false;
          antMessage.error(result.error);
        } else if (event.payload.command === "/plan approve") {
          isThinking.value = true;
          antMessage.success("计划已批准，继续执行中");
        } else if (event.payload.command === "/plan reject") {
          isThinking.value = false;
          antMessage.info("计划已拒绝");
        } else if (result.state === "analyzing") {
          isThinking.value = false;
          antMessage.info(result.message || "已进入计划模式");
        }
        break;
      }
      case "approval-granted": {
        if (event.payload.approvalType === "high-risk") {
          antMessage.success("High-risk actions confirmed.");
        } else {
          antMessage.success("Plan approval recorded.");
        }
        break;
      }
      case "approval-denied": {
        // Phase J+: ApprovalGate auto-denies emit the same event type but with
        // payload.source === "approval-gate" (plus a richer policy/via/risk
        // shape). Those flow through the dedicated `currentApprovalDenied`
        // alert + watcher → don't double-toast here, and don't clear the
        // thinking spinner (the agent loop continues against ApprovalGate
        // denies until the user changes policy or aborts).
        if (event.payload?.source === "approval-gate") {
          break;
        }
        isThinking.value = false;
        if (event.payload.approvalType === "high-risk") {
          antMessage.info("High-risk actions were not confirmed.");
        } else {
          antMessage.info("Plan approval was denied.");
        }
        break;
      }
      case "error": {
        const assistantMessage = ensurePendingAgentMessage(
          event.requestId,
          event.sessionId,
        );
        assistantMessage.content = event.payload.message
          ? `抱歉，Agent 执行失败：${event.payload.message}`
          : "抱歉，Agent 执行失败。";
        assistantMessage.timestamp = Date.now();
        const failedStep = getLatestRunningStep(
          assistantMessage,
          assistantMessage.steps?.[assistantMessage.steps.length - 1]?.tool,
        );
        if (failedStep) {
          failedStep.status = "failed";
          failedStep.error = event.payload.message || "Unknown error";
        }
        isThinking.value = false;
        await persistAssistantMessage(assistantMessage);
        clearPendingAgentMessage(event.requestId);
        antMessage.error(event.payload.message || "Coding agent error");
        break;
      }
      default:
        break;
    }
  };

  return {
    handleCodingAgentEvent,
    ensurePendingAgentMessage,
  };
}
