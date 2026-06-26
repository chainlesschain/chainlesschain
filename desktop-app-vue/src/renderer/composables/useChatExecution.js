import { nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import { logger } from "@/utils/logger";
import {
  MessageType,
  createIntentConfirmationMessage,
} from "../utils/messageTypes";
import {
  cleanForIPC,
  buildSmartContextHistory,
} from "../components/projects/chatPanelUtils";

/**
 * ChatPanel 对话执行子系统。从 ChatPanel.vue 提取的 ~400 LOC composable。
 *
 * 职责（4 个公开方法，互相调用形成核心 chat send 闭环）：
 *   - understandUserIntent: 调 IPC 跑意图理解，产 IntentConfirmationMessage
 *   - executeChatWithInput: aiChat IPC 主路径，4 步 thinkingState 流程，
 *     处理 PPT/Word generated 副作用，写回 assistant 消息
 *   - handleIntentConfirm: 用户点"确认理解" → executeChatWithInput
 *   - handleIntentCorrect: 用户点"重新理解" → understandUserIntent
 *
 * understandUserIntent 在 catch 兜底也会调 executeChatWithInput，所以四
 * 函数形成强耦合集。
 *
 * @param {Object} deps - 由父组件注入
 * @param {import('vue').Ref<Array>} deps.messages
 * @param {import('vue').Ref<Object>} deps.currentConversation
 * @param {import('vue').Ref<string>} deps.contextMode
 * @param {import('vue').Ref<boolean>} deps.isLoading
 * @param {Object} deps.thinkingState - reactive() 对象
 * @param {Object} deps.props - ChatPanel props
 * @param {Function} deps.scrollToBottom
 * @param {Function} deps.createConversation
 * @param {Function} deps.updateThinkingState
 * @param {Function} deps.getProjectFiles
 * @param {Function} deps.cleanupOldMessages
 * @param {Function} deps.safeSetTimeout
 * @param {Function} deps.emit
 */
export function useChatExecution({
  messages,
  currentConversation,
  contextMode,
  isLoading,
  thinkingState,
  props,
  scrollToBottom,
  createConversation,
  updateThinkingState,
  getProjectFiles,
  cleanupOldMessages,
  safeSetTimeout,
  emit,
}) {
  /**
   * 处理意图确认
   * 用户确认 AI 的理解是正确的，继续执行原有的对话流程
   */
  const handleIntentConfirm = async ({
    messageId,
    originalInput,
    understanding,
  }) => {
    logger.info("[ChatPanel] ✅ 用户确认意图理解正确");

    const intentMsg = messages.value.find((m) => m.id === messageId);
    if (intentMsg) {
      intentMsg.metadata.status = "confirmed";
      messages.value = [...messages.value];
    }

    const finalInput = understanding.correctedInput || originalInput;
    await executeChatWithInput(finalInput);
  };

  /**
   * 处理意图纠正
   * 用户认为 AI 理解有误，提供了纠正内容
   */
  const handleIntentCorrect = async ({ messageId, correction }) => {
    logger.info("[ChatPanel] 🔄 用户提供了纠正内容:", correction);

    const intentMsg = messages.value.find((m) => m.id === messageId);
    if (intentMsg) {
      intentMsg.metadata.status = "corrected";
      intentMsg.metadata.correction = correction;
      messages.value = [...messages.value];
    }

    await understandUserIntent(correction);
  };

  /**
   * 理解用户意图（纠错 + 意图识别）
   * @param {string} input - 用户输入
   * @returns {Promise<Object>}
   */
  const understandUserIntent = async (input) => {
    logger.info("[ChatPanel] 🤔 开始理解用户意图:", input);

    try {
      const result = await window.electronAPI.project.understandIntent({
        userInput: input,
        projectId: props.projectId,
        contextMode: contextMode.value,
      });

      logger.info("[ChatPanel] ✅ 意图理解完成:", result);

      const confirmationMsg = createIntentConfirmationMessage(input, result);
      messages.value.push(confirmationMsg);

      if (currentConversation.value && currentConversation.value.id) {
        await window.electronAPI.conversation.createMessage({
          id: confirmationMsg.id,
          conversation_id: currentConversation.value.id,
          role: "system",
          content: confirmationMsg.content,
          timestamp: confirmationMsg.timestamp,
          type: MessageType.INTENT_CONFIRMATION,
          metadata: cleanForIPC(confirmationMsg.metadata),
        });
      }

      await nextTick();
      scrollToBottom();

      return result;
    } catch (error) {
      logger.error("[ChatPanel] ❌ 意图理解失败:", error);
      antMessage.error("意图理解失败: " + error.message);

      // 理解失败兜底：直接执行原始输入
      await executeChatWithInput(input);
      throw error;
    }
  };

  /**
   * 执行对话（使用确认后的输入）
   * @param {string} input
   */
  const executeChatWithInput = async (input) => {
    logger.info("[ChatPanel] 🚀 执行对话，输入:", input);

    isLoading.value = true;

    updateThinkingState({
      show: true,
      stage: "理解您的需求...",
      progress: 10,
      showProgress: true,
      progressText: "正在分析问题",
      steps: [
        {
          title: "理解需求",
          status: "in-progress",
          description: "分析用户输入的问题",
        },
        {
          title: "检索知识",
          status: "pending",
          description: "从知识库中查找相关信息",
        },
        { title: "生成回复", status: "pending", description: "使用AI生成答案" },
        { title: "完成", status: "pending", description: "返回结果" },
      ],
      streamingContent: "",
      showCancelButton: true,
    });

    try {
      const userMessage = {
        id: `msg_${Date.now()}_user`,
        conversation_id: currentConversation.value?.id,
        role: "user",
        content: input,
        timestamp: Date.now(),
      };

      if (!Array.isArray(messages.value)) {
        logger.warn("[ChatPanel] messages.value 不是数组，重新初始化为空数组");
        messages.value = [];
      }

      messages.value.push(userMessage);

      if (!currentConversation.value) {
        updateThinkingState({ stage: "创建对话...", progress: 15 });
        await createConversation();

        if (!currentConversation.value) {
          throw new Error("创建对话失败，无法发送消息");
        }
      }

      await window.electronAPI.conversation.createMessage({
        id: userMessage.id,
        conversation_id: currentConversation.value.id,
        role: "user",
        content: userMessage.content,
        timestamp: userMessage.timestamp,
      });

      await nextTick();
      scrollToBottom();

      thinkingState.steps[0].status = "completed";
      thinkingState.steps[1].status = "in-progress";
      updateThinkingState({
        stage: "检索相关知识...",
        progress: 30,
        progressText: "查找相关信息",
      });

      const project = await window.electronAPI.project.get(props.projectId);
      const projectInfo = project
        ? {
            name: project.name,
            description: project.description || "",
            type: project.project_type || "general",
          }
        : null;
      const rawFileList = await getProjectFiles();

      const fileList = Array.isArray(rawFileList)
        ? rawFileList.map((file) => ({
            id: file.id,
            file_name: file.file_name,
            file_path: file.file_path,
            file_type: file.file_type,
            content: file.content,
            size: file.size,
          }))
        : [];

      thinkingState.steps[1].status = "completed";
      thinkingState.steps[2].status = "in-progress";
      updateThinkingState({
        stage: "生成回复...",
        progress: 50,
        progressText: "AI正在思考答案",
      });

      const conversationHistory = buildSmartContextHistory(messages.value);

      const cleanCurrentFile = props.currentFile
        ? {
            id: props.currentFile.id,
            file_name: props.currentFile.file_name,
            file_path: props.currentFile.file_path,
            file_type: props.currentFile.file_type,
            content: props.currentFile.content,
            size: props.currentFile.size,
          }
        : null;

      // 取消通过 project:cancelAiChat IPC 实现
      const response = await window.electronAPI.project.aiChat({
        projectId: props.projectId,
        userMessage: input,
        conversationHistory,
        contextMode: contextMode.value,
        currentFile: cleanCurrentFile,
        projectInfo,
        fileList,
      });

      logger.info("[ChatPanel] AI响应:", response);

      if (response.cancelled) {
        logger.info("[ChatPanel] AI对话已被用户取消，跳过后续处理");
        thinkingState.show = false;
        return;
      }

      thinkingState.steps[2].status = "completed";
      thinkingState.steps[3].status = "in-progress";
      updateThinkingState({
        stage: "处理结果...",
        progress: 90,
        progressText: "几乎完成了",
      });

      if (response.pptGenerated && response.pptResult) {
        logger.info("[ChatPanel] ✅ PPT已生成:", response.pptResult);
        antMessage.success({
          content: `🎉 PPT文件已生成！\n文件名: ${response.pptResult.fileName}\n幻灯片数: ${response.pptResult.slideCount}`,
          duration: 5,
        });

        safeSetTimeout(() => {
          logger.info("[ChatPanel] 延迟刷新文件树");
          emit("files-changed");
        }, 2000);
      }

      if (response.wordGenerated && response.wordResult) {
        logger.info("[ChatPanel] ✅ Word文档已生成:", response.wordResult);
        antMessage.success({
          content: `📝 Word文档已生成！\n文件名: ${response.wordResult.fileName}\n文件大小: ${(response.wordResult.fileSize / 1024).toFixed(2)} KB`,
          duration: 5,
        });

        // Mirror the PPT branch: use safeSetTimeout so the timer is cleared on
        // unmount instead of firing emit("files-changed") on a torn-down context.
        safeSetTimeout(() => {
          logger.info("[ChatPanel] 延迟刷新文件树（Word）");
          emit("files-changed");
        }, 2000);
      }

      const assistantMessage = {
        id: `msg_${Date.now()}_assistant`,
        conversation_id: currentConversation.value.id,
        role: "assistant",
        content: response.conversationResponse || "抱歉，我没有理解你的问题。",
        timestamp: Date.now(),
        fileOperations: response.fileOperations || [],
        hasFileOperations: response.hasFileOperations || false,
        ragSources: response.ragSources || [],
        pptGenerated: response.pptGenerated || false,
        pptResult: response.pptResult || null,
        wordGenerated: response.wordGenerated || false,
        wordResult: response.wordResult || null,
      };

      if (!Array.isArray(messages.value)) {
        logger.warn(
          "[ChatPanel] messages.value 不是数组（assistant），重新初始化为空数组",
        );
        messages.value = [];
      }

      messages.value.push(assistantMessage);

      cleanupOldMessages();

      if (currentConversation.value && currentConversation.value.id) {
        await window.electronAPI.conversation.createMessage({
          id: assistantMessage.id,
          conversation_id: currentConversation.value.id,
          role: "assistant",
          content: assistantMessage.content,
          timestamp: assistantMessage.timestamp,
          metadata: cleanForIPC({
            hasFileOperations: assistantMessage.hasFileOperations,
            fileOperationCount: assistantMessage.fileOperations.length,
          }),
        });
      } else {
        logger.warn("[ChatPanel] 无法保存助手消息：当前对话不存在");
      }

      if (response.hasFileOperations && response.fileOperations.length > 0) {
        const successCount = response.fileOperations.filter(
          (op) => op.success === true || op.status === "success",
        ).length;
        const errorCount = response.fileOperations.filter(
          (op) => op.success === false || op.status === "error",
        ).length;

        logger.info("[ChatPanel] 文件操作统计:", {
          total: response.fileOperations.length,
          successCount,
          errorCount,
          operations: response.fileOperations,
        });

        if (successCount > 0) {
          antMessage.success(`成功执行 ${successCount} 个文件操作`);
          emit("files-changed");
        }

        if (errorCount > 0) {
          antMessage.warning(`${errorCount} 个文件操作失败`);
        }
      }

      thinkingState.steps[3].status = "completed";
      updateThinkingState({
        stage: "完成！",
        progress: 100,
        progressText: "回复已生成",
      });

      safeSetTimeout(() => {
        thinkingState.show = false;
      }, 500);

      await nextTick();
      scrollToBottom();
    } catch (error) {
      logger.error("[ChatPanel] 执行对话失败:", error);
      antMessage.error("对话失败: " + error.message);

      updateThinkingState({
        show: true,
        stage: "发生错误",
        progress: 100,
        status: "exception",
        progressText: error.message,
      });

      safeSetTimeout(() => {
        thinkingState.show = false;
      }, 2000);
    } finally {
      isLoading.value = false;
    }
  };

  return {
    handleIntentConfirm,
    handleIntentCorrect,
    understandUserIntent,
    executeChatWithInput,
  };
}
