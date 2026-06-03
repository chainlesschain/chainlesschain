import { reactive } from "vue";
import { message as antMessage } from "ant-design-vue";
import { logger } from "@/utils/logger";

/**
 * ChatPanel 消息内存管理 + 滚动 + 思考状态 子系统。
 * 从 ChatPanel.vue 提取的 ~130 LOC composable。
 *
 * 由于多个其他 composable 都依赖这里导出的 scrollToBottom / cleanupOld-
 * Messages / updateThinkingState，这个 composable 必须在所有其他
 * use* 之前调用（它是无外部 composable 依赖的叶子节点）。
 *
 * 返回 6 个方法 + 1 个内部 reactive 状态：
 *   - cleanupOldMessages: 超过 cleanupThreshold 时裁到 maxMessagesInMemory
 *   - scrollToBottom: 优先用 VirtualMessageList.scrollToBottom，失败回退
 *     到 messagesContainer.scrollTop
 *   - handleLoadMoreMessages: 分页加载历史（pageSize 默认 50），加载
 *     完成后若超过阈值再裁末尾
 *   - handleScrollToBottom: 滚到底部事件回调（标记已读 hook 点）
 *   - handleCancelThinking: 取消 AI 思考，调 project.cancelAiChat IPC
 *   - updateThinkingState: Object.assign 思考状态
 *   - messageLoadState: 分页状态（暴露供测试 / 极端情况查询）
 *
 * @param {Object} deps
 * @param {import('vue').Ref<Array>} deps.messages
 * @param {import('vue').Ref<Object>} deps.currentConversation
 * @param {import('vue').Ref<boolean>} deps.isLoading
 * @param {Object} deps.thinkingState - reactive()
 * @param {import('vue').Ref} deps.virtualListRef
 * @param {import('vue').Ref} deps.messagesContainer
 * @param {number} [deps.maxMessagesInMemory=200]
 * @param {number} [deps.cleanupThreshold=220]
 * @param {number} [deps.pageSize=50]
 */
export function useMessageMemory({
  messages,
  currentConversation,
  isLoading,
  thinkingState,
  virtualListRef,
  messagesContainer,
  maxMessagesInMemory = 200,
  cleanupThreshold = 220,
  pageSize = 50,
}) {
  const messageLoadState = reactive({
    currentPage: 0,
    pageSize,
    hasMore: true,
    isLoadingMore: false,
  });

  /**
   * 清理过多的消息以释放内存
   */
  const cleanupOldMessages = () => {
    if (messages.value.length > cleanupThreshold) {
      const messagesToRemove = messages.value.length - maxMessagesInMemory;
      logger.info(
        `[ChatPanel] 🧹 消息数量超过阈值(${cleanupThreshold})，清理最旧的${messagesToRemove}条消息`,
      );

      messages.value = messages.value.slice(-maxMessagesInMemory);

      logger.info(
        `[ChatPanel] ✅ 清理完成，当前消息数: ${messages.value.length}`,
      );
    }
  };

  /**
   * 滚动到底部（使用虚拟列表）
   */
  const scrollToBottom = () => {
    if (virtualListRef.value) {
      virtualListRef.value.scrollToBottom();
    } else if (messagesContainer.value) {
      // 后备方案：虚拟列表未初始化
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  };

  /**
   * 加载更多历史消息（分页）
   */
  const handleLoadMoreMessages = async () => {
    if (messageLoadState.isLoadingMore || !messageLoadState.hasMore) {
      return;
    }

    if (!currentConversation.value) {
      return;
    }

    try {
      messageLoadState.isLoadingMore = true;

      const nextPage = messageLoadState.currentPage + 1;
      const offset = nextPage * messageLoadState.pageSize;

      const result = await window.electronAPI.conversation.getMessages(
        currentConversation.value.id,
        {
          limit: messageLoadState.pageSize,
          offset,
        },
      );

      const loadedMessages = result?.data || [];

      if (loadedMessages.length > 0) {
        // 在前面插入历史消息
        messages.value.unshift(
          ...loadedMessages.map((msg) => {
            if (msg.message_type) {
              return { ...msg, type: msg.message_type };
            }
            return msg;
          }),
        );

        // 加载历史后若超过阈值 → 移除末尾最新消息（保留刚加载的历史）
        if (messages.value.length > cleanupThreshold) {
          const messagesToRemove = messages.value.length - maxMessagesInMemory;
          logger.info(
            `[ChatPanel] 🧹 加载历史消息后超过阈值，移除末尾${messagesToRemove}条最新消息`,
          );
          messages.value = messages.value.slice(0, maxMessagesInMemory);
        }

        messageLoadState.currentPage = nextPage;
        logger.info(`[ChatPanel] 📜 加载了${loadedMessages.length}条历史消息`);
      } else {
        messageLoadState.hasMore = false;
        logger.info("[ChatPanel] 📜 没有更多历史消息");
      }
    } catch (error) {
      logger.error("[ChatPanel] 加载历史消息失败:", error);
      antMessage.error("加载历史消息失败");
    } finally {
      messageLoadState.isLoadingMore = false;
    }
  };

  /**
   * 滚动到底部事件回调（hook 点：标记已读等）
   */
  const handleScrollToBottom = () => {
    logger.info("[ChatPanel] 📍 已滚动到底部");
  };

  /**
   * 取消 AI 思考 / 生成
   */
  const handleCancelThinking = async () => {
    logger.info("[ChatPanel] ⛔ 用户取消了AI思考");
    isLoading.value = false;
    thinkingState.show = false;

    try {
      if (window.electronAPI?.project?.cancelAiChat) {
        await window.electronAPI.project.cancelAiChat();
      }
    } catch (error) {
      logger.warn("[ChatPanel] 取消请求失败:", error);
    }

    antMessage.info("已取消");
  };

  /**
   * 更新思考过程状态
   */
  const updateThinkingState = (updates) => {
    Object.assign(thinkingState, updates);
  };

  return {
    cleanupOldMessages,
    scrollToBottom,
    handleLoadMoreMessages,
    handleScrollToBottom,
    handleCancelThinking,
    updateThinkingState,
    messageLoadState,
  };
}
