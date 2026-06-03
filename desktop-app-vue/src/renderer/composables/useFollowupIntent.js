import { nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import { logger } from "@/utils/logger";
import { createUserMessage } from "../utils/messageTypes";
import {
  createIntentSystemMessage,
  mergeRequirements,
  addClarificationToTaskPlan,
} from "../utils/followupIntentHelper";
import { cleanForIPC } from "../components/projects/chatPanelUtils";

/**
 * ChatPanel 后续输入意图子系统。从 ChatPanel.vue 提取的 ~200 LOC composable。
 *
 * 处理 4 种 follow-up intent（用户在任务执行过程中又发了一条消息）：
 *   - CONTINUE_EXECUTION: 催促，加确认消息，继续
 *   - MODIFY_REQUIREMENT: 修改需求，暂停当前任务，合并需求后重新 startTaskPlanning
 *   - CLARIFICATION: 补充说明，追加到任务上下文，继续执行
 *   - CANCEL_TASK: 取消任务，置状态 + 添加取消消息
 *
 * 内部 helper saveMessageToDb / updateMessageInDb 通过闭包共享。
 *
 * @param {Object} deps
 * @param {import('vue').Ref<Array>} deps.messages
 * @param {import('vue').Ref<Object>} deps.currentConversation
 * @param {Function} deps.scrollToBottom
 * @param {Function} deps.startTaskPlanning - useTaskPlanning 提供，
 *   MODIFY_REQUIREMENT 分支需要它把合并后的需求重新规划
 */
export function useFollowupIntent({
  messages,
  currentConversation,
  scrollToBottom,
  startTaskPlanning,
}) {
  /**
   * 保存消息到数据库
   */
  const saveMessageToDb = async (message) => {
    if (!currentConversation.value || !currentConversation.value.id) {
      logger.warn("[ChatPanel] 无当前对话，无法保存消息");
      return;
    }

    try {
      await window.electronAPI.conversation.createMessage({
        id: message.id,
        conversation_id: currentConversation.value.id,
        role: message.role || "system",
        content: message.content,
        timestamp: message.timestamp,
        type: message.type,
        metadata: cleanForIPC(message.metadata),
      });
    } catch (error) {
      logger.error("[ChatPanel] 保存消息失败:", error);
    }
  };

  /**
   * 更新消息到数据库
   */
  const updateMessageInDb = async (message) => {
    if (!currentConversation.value || !currentConversation.value.id) {
      logger.warn("[ChatPanel] 无当前对话，无法更新消息");
      return;
    }

    try {
      await window.electronAPI.conversation.updateMessage({
        id: message.id,
        conversation_id: currentConversation.value.id,
        metadata: cleanForIPC(message.metadata),
      });
    } catch (error) {
      logger.error("[ChatPanel] 更新消息失败:", error);
    }
  };

  /**
   * 处理后续输入的不同意图
   * @param {string} intent
   * @param {string} userInput
   * @param {string} extractedInfo
   * @param {string} reason
   * @param {Object} executingTask
   */
  const handleFollowupIntent = async (
    intent,
    userInput,
    extractedInfo,
    reason,
    executingTask,
  ) => {
    logger.info(`[ChatPanel] 📋 处理后续输入意图: ${intent}`);

    const userMessage = createUserMessage(
      userInput,
      currentConversation.value?.id,
    );
    messages.value.push(userMessage);

    if (currentConversation.value && currentConversation.value.id) {
      try {
        await window.electronAPI.conversation.createMessage({
          id: userMessage.id,
          conversation_id: currentConversation.value.id,
          role: "user",
          content: userInput,
          timestamp: userMessage.timestamp,
        });
      } catch (error) {
        logger.error("[ChatPanel] 保存用户消息失败:", error);
      }
    }

    switch (intent) {
      case "CONTINUE_EXECUTION": {
        logger.info("[ChatPanel] ✅ 用户催促继续执行，无需操作");

        const continueMessage = createIntentSystemMessage(intent, userInput, {
          reason,
          extractedInfo,
        });
        messages.value.push(continueMessage);
        await saveMessageToDb(continueMessage);

        antMessage.info("继续执行任务中...");
        break;
      }

      case "MODIFY_REQUIREMENT": {
        logger.info("[ChatPanel] ⚠️ 用户修改需求:", extractedInfo);

        if (executingTask) {
          executingTask.metadata.status = "paused";
          executingTask.metadata.pauseReason = "用户修改需求";
          messages.value = [...messages.value];
          await updateMessageInDb(executingTask);
        }

        const modifyMessage = createIntentSystemMessage(intent, userInput, {
          reason,
          extractedInfo,
        });
        messages.value.push(modifyMessage);
        await saveMessageToDb(modifyMessage);

        const originalRequirement =
          executingTask?.metadata?.plan?.description || "原始需求";
        const mergedInput = mergeRequirements(originalRequirement, userInput);

        antMessage.warning("检测到需求变更，正在重新规划任务...");

        await nextTick();
        scrollToBottom();

        await startTaskPlanning(mergedInput);
        break;
      }

      case "CLARIFICATION": {
        logger.info("[ChatPanel] 📝 用户补充说明:", extractedInfo);

        if (
          executingTask &&
          executingTask.metadata &&
          executingTask.metadata.plan
        ) {
          const updatedPlan = addClarificationToTaskPlan(
            executingTask.metadata.plan,
            extractedInfo || userInput,
          );
          executingTask.metadata.plan = updatedPlan;
          messages.value = [...messages.value];
          await updateMessageInDb(executingTask);
        }

        const clarifyMessage = createIntentSystemMessage(intent, userInput, {
          reason,
          extractedInfo,
        });
        messages.value.push(clarifyMessage);
        await saveMessageToDb(clarifyMessage);

        antMessage.success("已记录补充信息，继续执行任务...");

        // 可选：调用 AI 服务使用更新后的上下文重新生成响应
        break;
      }

      case "CANCEL_TASK": {
        logger.info("[ChatPanel] ❌ 用户取消任务");

        if (executingTask) {
          executingTask.metadata.status = "cancelled";
          executingTask.metadata.cancelReason = reason;
          messages.value = [...messages.value];
          await updateMessageInDb(executingTask);
        }

        const cancelMessage = createIntentSystemMessage(intent, userInput, {
          reason,
        });
        messages.value.push(cancelMessage);
        await saveMessageToDb(cancelMessage);

        antMessage.info("任务已取消");
        break;
      }

      default:
        logger.warn("[ChatPanel] ⚠️ 未知意图类型:", intent);
        antMessage.warning("无法识别您的意图，请重新表述");
    }

    await nextTick();
    scrollToBottom();
  };

  return {
    handleFollowupIntent,
  };
}
