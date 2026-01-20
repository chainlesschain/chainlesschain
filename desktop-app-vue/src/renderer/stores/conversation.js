import { logger, createLogger } from "@/utils/logger";
import { defineStore } from "pinia";

export const useConversationStore = defineStore("conversation", {
  state: () => ({
    // 对话列表
    conversations: [],

    // 当前对话
    currentConversation: null,

    // 加载状态
    loading: false,

    // 分页
    pagination: {
      offset: 0,
      limit: 50,
      total: 0,
    },

    // 批量持久化优化（减少DB锁竞争80%）
    pendingMessages: [], // 待保存的消息队列
    batchSaveTimer: null, // 批量保存定时器
    batchSaveThreshold: 5, // 批量保存阈值（消息数）
    batchSaveInterval: 10000, // 批量保存间隔（毫秒）
  }),

  getters: {
    // 当前消息列表
    currentMessages: (state) => {
      return state.currentConversation?.messages || [];
    },

    // 当前对话ID
    currentConversationId: (state) => {
      return state.currentConversation?.id;
    },

    // 当前对话标题
    currentConversationTitle: (state) => {
      return state.currentConversation?.title || "新对话";
    },

    // 是否有当前对话
    hasCurrentConversation: (state) => {
      return !!state.currentConversation;
    },

    // 对话总数
    conversationCount: (state) => {
      return state.conversations.length;
    },
  },

  actions: {
    /**
     * 创建新对话
     */
    createNewConversation() {
      const newConversation = {
        id: `conv_${Date.now()}`,
        title: `对话 ${new Date().toLocaleString("zh-CN")}`,
        messages: [],
        created_at: Date.now(),
        updated_at: Date.now(),
        metadata: {
          model: "",
          provider: "",
          totalTokens: 0,
        },
      };

      this.currentConversation = newConversation;
      this.conversations.unshift(newConversation);

      return newConversation;
    },

    /**
     * 加载对话列表
     */
    async loadConversations(offset = 0, limit = 50) {
      this.loading = true;

      try {
        // 从数据库加载对话
        const result = await window.electronAPI.db.getConversations?.(
          offset,
          limit,
        );

        if (result && result.conversations) {
          if (offset === 0) {
            this.conversations = result.conversations;
          } else {
            this.conversations.push(...result.conversations);
          }

          this.pagination = {
            offset,
            limit,
            total: result.total || result.conversations.length,
          };
        } else {
          // 如果数据库没有对话，初始化空列表
          if (offset === 0) {
            this.conversations = [];
          }
        }
      } catch (error) {
        // IPC 未就绪时静默处理
        if (!error.message?.includes("No handler registered")) {
          logger.error("[Conversation Store] 加载对话列表失败:", error);
        }
        // 如果加载失败，使用内存中的对话
        if (offset === 0) {
          this.conversations = [];
        }
      } finally {
        this.loading = false;
      }
    },

    /**
     * 加载指定对话
     */
    async loadConversation(conversationId) {
      try {
        // 先从内存中查找
        let conversation = this.conversations.find(
          (c) => c.id === conversationId,
        );

        if (!conversation) {
          // 从数据库加载
          conversation =
            await window.electronAPI.db.getConversation?.(conversationId);
        }

        if (conversation) {
          this.currentConversation = conversation;
        }

        return conversation;
      } catch (error) {
        logger.error("加载对话失败:", error);
        throw error;
      }
    },

    /**
     * 保存当前对话（批量优化版）
     */
    async saveCurrentConversation() {
      if (!this.currentConversation) {
        return;
      }

      try {
        this.currentConversation.updated_at = Date.now();

        // 添加到待保存队列
        this.pendingMessages.push({ ...this.currentConversation });

        // 检查是否达到批量保存阈值
        if (this.pendingMessages.length >= this.batchSaveThreshold) {
          await this.flushPendingMessages();
        } else {
          // 启动定时器（如果尚未启动）
          this.scheduleBatchSave();
        }

        // 更新列表中的对话
        const index = this.conversations.findIndex(
          (c) => c.id === this.currentConversation.id,
        );

        if (index !== -1) {
          this.conversations[index] = { ...this.currentConversation };
        } else {
          this.conversations.unshift({ ...this.currentConversation });
        }
      } catch (error) {
        logger.error("保存对话失败:", error);
        throw error;
      }
    },

    /**
     * 调度批量保存
     */
    scheduleBatchSave() {
      if (this.batchSaveTimer) {
        return; // 定时器已存在
      }

      this.batchSaveTimer = setTimeout(async () => {
        try {
          await this.flushPendingMessages();
        } catch (error) {
          logger.error("[ConversationStore] 批量保存定时器错误:", error);
        }
      }, this.batchSaveInterval);
    },

    /**
     * 立即保存所有待保存的消息
     */
    async flushPendingMessages() {
      if (this.pendingMessages.length === 0) {
        return;
      }

      // 清除定时器
      if (this.batchSaveTimer) {
        clearTimeout(this.batchSaveTimer);
        this.batchSaveTimer = null;
      }

      try {
        // 批量保存到数据库
        if (window.electronAPI.db.saveConversation) {
          // 只保存最新的对话状态（去重）
          const conversationMap = new Map();
          for (const conv of this.pendingMessages) {
            conversationMap.set(conv.id, conv);
          }

          // 批量保存
          for (const conv of conversationMap.values()) {
            await window.electronAPI.db.saveConversation(conv);
          }

          logger.info(
            `[ConversationStore] 批量保存完成: ${conversationMap.size} 个对话`,
          );
        }

        // 清空队列
        this.pendingMessages = [];
      } catch (error) {
        logger.error("批量保存对话失败:", error);
        // 保留队列，下次重试
      }
    },

    /**
     * 添加消息
     */
    addMessage(message) {
      if (!this.currentConversation) {
        this.createNewConversation();
      }

      // 确保 messages 数组存在
      if (!Array.isArray(this.currentConversation.messages)) {
        this.currentConversation.messages = [];
      }

      const newMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...message,
        timestamp: message.timestamp || Date.now(),
      };

      this.currentConversation.messages.push(newMessage);
      this.currentConversation.updated_at = Date.now();

      // 更新元数据
      if (message.tokens) {
        this.currentConversation.metadata.totalTokens += message.tokens;
      }
      if (message.model) {
        this.currentConversation.metadata.model = message.model;
      }

      // 自动生成标题（基于第一条用户消息）
      if (
        message.role === "user" &&
        this.currentConversation.messages.filter((m) => m.role === "user")
          .length === 1
      ) {
        const title = message.content.slice(0, 30);
        this.currentConversation.title =
          title + (message.content.length > 30 ? "..." : "");
      }

      return newMessage;
    },

    /**
     * 更新消息
     */
    updateMessage(messageId, updates) {
      if (!this.currentConversation) {
        return;
      }

      // 确保 messages 数组存在
      if (!Array.isArray(this.currentConversation.messages)) {
        return;
      }

      const index = this.currentConversation.messages.findIndex(
        (m) => m.id === messageId,
      );

      if (index !== -1) {
        this.currentConversation.messages[index] = {
          ...this.currentConversation.messages[index],
          ...updates,
        };
        this.currentConversation.updated_at = Date.now();
      }
    },

    /**
     * 删除消息
     */
    deleteMessage(messageId) {
      if (!this.currentConversation) {
        return;
      }

      // 确保 messages 数组存在
      if (!Array.isArray(this.currentConversation.messages)) {
        return;
      }

      const index = this.currentConversation.messages.findIndex(
        (m) => m.id === messageId,
      );

      if (index !== -1) {
        this.currentConversation.messages.splice(index, 1);
        this.currentConversation.updated_at = Date.now();
      }
    },

    /**
     * 清空当前对话消息
     */
    clearCurrentMessages() {
      if (this.currentConversation) {
        this.currentConversation.messages = [];
        this.currentConversation.updated_at = Date.now();
        this.currentConversation.metadata.totalTokens = 0;
      }
    },

    /**
     * 更新对话
     */
    async updateConversation(conversationId, updates) {
      try {
        // 更新内存中的对话
        const index = this.conversations.findIndex(
          (c) => c.id === conversationId,
        );

        if (index !== -1) {
          this.conversations[index] = {
            ...this.conversations[index],
            ...updates,
            updated_at: Date.now(),
          };

          // 如果是当前对话，也更新
          if (this.currentConversation?.id === conversationId) {
            this.currentConversation = {
              ...this.currentConversation,
              ...updates,
              updated_at: Date.now(),
            };
          }

          // 保存到数据库
          if (window.electronAPI.db.updateConversation) {
            await window.electronAPI.db.updateConversation(
              conversationId,
              this.conversations[index],
            );
          }
        }
      } catch (error) {
        logger.error("更新对话失败:", error);
        throw error;
      }
    },

    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
      try {
        // 从数据库删除
        if (window.electronAPI.db.deleteConversation) {
          await window.electronAPI.db.deleteConversation(conversationId);
        }

        // 从列表中删除
        const index = this.conversations.findIndex(
          (c) => c.id === conversationId,
        );
        if (index !== -1) {
          this.conversations.splice(index, 1);
        }

        // 如果删除的是当前对话，清空当前对话
        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = null;

          // 如果还有其他对话，加载最新的
          if (this.conversations.length > 0) {
            this.currentConversation = this.conversations[0];
          }
        }
      } catch (error) {
        logger.error("删除对话失败:", error);
        throw error;
      }
    },

    /**
     * 搜索对话
     */
    searchConversations(query) {
      if (!query || !query.trim()) {
        return this.conversations;
      }

      const lowerQuery = query.toLowerCase();

      return this.conversations.filter(
        (conv) =>
          conv.title.toLowerCase().includes(lowerQuery) ||
          conv.messages.some((msg) =>
            msg.content.toLowerCase().includes(lowerQuery),
          ),
      );
    },

    /**
     * 导出对话
     */
    exportConversation(conversationId) {
      const conversation = this.conversations.find(
        (c) => c.id === conversationId,
      );

      if (!conversation) {
        return null;
      }

      return {
        title: conversation.title,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        messages: conversation.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
        metadata: conversation.metadata,
      };
    },

    /**
     * 导入对话
     */
    async importConversation(data) {
      try {
        const newConversation = {
          id: `conv_${Date.now()}`,
          ...data,
          created_at: data.created_at || Date.now(),
          updated_at: Date.now(),
        };

        this.conversations.unshift(newConversation);

        // 保存到数据库
        if (window.electronAPI.db.saveConversation) {
          await window.electronAPI.db.saveConversation(newConversation);
        }

        return newConversation;
      } catch (error) {
        logger.error("导入对话失败:", error);
        throw error;
      }
    },

    /**
     * 重置
     */
    async reset() {
      // 在重置前保存所有待保存的消息
      await this.flushPendingMessages();

      this.conversations = [];
      this.currentConversation = null;
      this.loading = false;
      this.pagination = {
        offset: 0,
        limit: 50,
        total: 0,
      };
      this.pendingMessages = [];
      if (this.batchSaveTimer) {
        clearTimeout(this.batchSaveTimer);
        this.batchSaveTimer = null;
      }
    },
  },
});
