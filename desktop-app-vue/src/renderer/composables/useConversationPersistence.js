import { nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import { logger } from "@/utils/logger";
import { MessageType } from "../utils/messageTypes";

/**
 * ChatPanel 对话持久化子系统。从 ChatPanel.vue 提取的 ~180 LOC composable。
 *
 * 职责（2 个 IPC-bound 方法）：
 *   - createConversation: 调 conversation.create IPC，写 currentConversation +
 *     emit("conversationLoaded")
 *   - loadConversation: 项目模式下加载 conversation.getByProject 第一项 +
 *     最近 N 条消息；反序列化 metadata；修复采访消息 currentIndex 越界；
 *     非项目模式直接清空对话
 *
 * 跨平台行为差异由 contextMode (project/file/global) 控制。
 *
 * @param {Object} deps
 * @param {import('vue').Ref<Array>} deps.messages
 * @param {import('vue').Ref<Object>} deps.currentConversation
 * @param {import('vue').Ref<string>} deps.contextMode
 * @param {Object} deps.props - ChatPanel props
 * @param {number} [deps.maxMessagesInMemory=200] - loadConversation 分页上限
 * @param {Function} deps.scrollToBottom
 * @param {Function} deps.emit
 */
export function useConversationPersistence({
  messages,
  currentConversation,
  contextMode,
  props,
  maxMessagesInMemory = 200,
  scrollToBottom,
  emit,
}) {
  /**
   * 创建对话
   */
  const createConversation = async () => {
    try {
      if (!window.electronAPI?.conversation) {
        logger.warn("[ChatPanel] 对话API未实现，跳过创建");
        return;
      }

      const conversationData = {
        id: `conv_${Date.now()}`,
        title:
          contextMode.value === "project"
            ? "项目对话"
            : contextMode.value === "file"
              ? "文件对话"
              : "新对话",
        project_id: contextMode.value === "project" ? props.projectId : null,
        context_type: contextMode.value,
        context_data:
          contextMode.value === "file" && props.currentFile
            ? {
                file_id: props.currentFile.id,
                file_name: props.currentFile.file_name,
              }
            : null,
      };

      const result =
        await window.electronAPI.conversation.create(conversationData);

      // API 返回 { success, data }
      if (result && result.success && result.data) {
        currentConversation.value = result.data;
        emit("conversationLoaded", currentConversation.value);
      } else {
        throw new Error(result?.error || "创建对话失败");
      }
    } catch (error) {
      logger.error("创建对话失败:", error);
      antMessage.error("创建对话失败");
    }
  };

  /**
   * 加载对话
   */
  const loadConversation = async () => {
    try {
      if (!window.electronAPI?.conversation) {
        logger.warn("[ChatPanel] 对话API未实现，跳过加载");
        messages.value = [];
        currentConversation.value = null;
        return;
      }

      if (contextMode.value === "project") {
        const result = await window.electronAPI.conversation.getByProject(
          props.projectId,
        );

        let conversation = null;
        if (
          result &&
          result.success &&
          Array.isArray(result.data) &&
          result.data.length > 0
        ) {
          conversation = result.data[0];
        } else if (result && !result.success) {
          logger.warn("[ChatPanel] 获取项目对话失败:", result.error);
        }

        if (conversation) {
          currentConversation.value = conversation;

          // 分页：只加载最近 N 条
          const loadedMessages =
            await window.electronAPI.conversation.getMessages(conversation.id, {
              limit: maxMessagesInMemory,
              offset: 0,
            });

          let rawMessages = [];
          if (
            loadedMessages &&
            loadedMessages.success &&
            Array.isArray(loadedMessages.data)
          ) {
            rawMessages = loadedMessages.data;
          } else if (Array.isArray(loadedMessages)) {
            rawMessages = loadedMessages;
          }

          // 恢复 INTERVIEW / TASK_PLAN 等特殊消息类型 + 反序列化 metadata
          messages.value = rawMessages.map((msg) => {
            let metadata = msg.metadata;
            if (typeof metadata === "string") {
              try {
                metadata = JSON.parse(metadata);
              } catch (e) {
                logger.error("[ChatPanel] metadata 解析失败:", e, metadata);
              }
            }

            if (msg.message_type) {
              return {
                ...msg,
                type: msg.message_type,
                metadata,
              };
            }
            // 向后兼容：旧消息无 message_type
            return {
              ...msg,
              metadata,
            };
          });

          // 数据修复：采访消息 currentIndex 越界 → 截到 totalQuestions
          messages.value.forEach((msg) => {
            if (msg.type === MessageType.INTERVIEW && msg.metadata) {
              const currentIdx = msg.metadata.currentIndex || 0;
              const totalQuestions = msg.metadata.questions?.length || 0;

              logger.info("[ChatPanel] 🔍 检查采访消息", {
                messageId: msg.id,
                currentIndex: currentIdx,
                totalQuestions,
              });

              if (currentIdx > totalQuestions) {
                logger.warn("[ChatPanel] 🔧 修复损坏的采访消息数据", {
                  messageId: msg.id,
                  原currentIndex: currentIdx,
                  问题总数: totalQuestions,
                  修复为: totalQuestions,
                });
                msg.metadata.currentIndex = totalQuestions;
              }
            }
          });

          logger.info(
            "[ChatPanel] 💾 从数据库恢复了",
            messages.value.length,
            "条消息",
          );

          emit("conversationLoaded", conversation);

          await nextTick();
          scrollToBottom();
        } else {
          messages.value = [];
          currentConversation.value = null;
        }
      } else {
        // 非项目模式 — 清空对话
        messages.value = [];
        currentConversation.value = null;
      }
    } catch (error) {
      logger.error("加载对话失败:", error);
      // 不显示错误消息，API 可能未实现
    }
  };

  return {
    createConversation,
    loadConversation,
  };
}
