/**
 * Session Store - Pinia 状态管理
 * 管理会话列表、当前会话、标签、模板等状态
 *
 * @module session-store
 * @version 1.0.0
 * @since 2026-01-17
 */

import { logger, createLogger } from '@/utils/logger';
import { defineStore } from "pinia";

export const useSessionStore = defineStore("session", {
  state: () => ({
    // 会话列表
    sessions: [],

    // 当前选中的会话（用于详情展示）
    currentSession: null,

    // 选中的会话 ID 列表（用于批量操作）
    selectedIds: [],

    // 所有标签
    allTags: [],

    // 模板列表
    templates: [],

    // 全局统计
    globalStats: {
      totalSessions: 0,
      totalMessages: 0,
      totalTokensSaved: 0,
      uniqueTags: 0,
      totalTemplates: 0,
    },

    // 筛选条件
    filters: {
      searchQuery: "",
      selectedTags: [],
      sortBy: "updated_at",
      sortOrder: "desc",
    },

    // 分页
    pagination: {
      offset: 0,
      limit: 20,
      total: 0,
    },

    // 加载状态
    loading: false,
    loadingDetail: false,
    loadingTags: false,
    loadingTemplates: false,
    loadingStats: false,

    // 错误状态
    error: null,
  }),

  getters: {
    /**
     * 根据筛选条件过滤后的会话列表
     */
    filteredSessions: (state) => {
      let result = [...state.sessions];

      // 按标签筛选
      if (state.filters.selectedTags.length > 0) {
        result = result.filter((session) => {
          const sessionTags = session.tags || [];
          return state.filters.selectedTags.some((tag) =>
            sessionTags.includes(tag),
          );
        });
      }

      return result;
    },

    /**
     * 是否有选中的会话
     */
    hasSelectedSessions: (state) => {
      return state.selectedIds.length > 0;
    },

    /**
     * 选中的会话数量
     */
    selectedCount: (state) => {
      return state.selectedIds.length;
    },

    /**
     * 当前会话是否已加载
     */
    hasCurrentSession: (state) => {
      return !!state.currentSession;
    },

    /**
     * 获取当前会话的消息列表
     */
    currentMessages: (state) => {
      if (!state.currentSession) {return [];}
      return state.currentSession.messages || [];
    },

    /**
     * 获取当前会话的标签
     */
    currentTags: (state) => {
      if (!state.currentSession) {return [];}
      return state.currentSession.tags || [];
    },

    /**
     * 是否正在加载
     */
    isLoading: (state) => {
      return (
        state.loading ||
        state.loadingDetail ||
        state.loadingTags ||
        state.loadingTemplates ||
        state.loadingStats
      );
    },
  },

  actions: {
    /**
     * 加载会话列表
     */
    async loadSessions(options = {}) {
      this.loading = true;
      this.error = null;

      try {
        const params = {
          offset: options.offset ?? this.pagination.offset,
          limit: options.limit ?? this.pagination.limit,
          sortBy: options.sortBy ?? this.filters.sortBy,
          sortOrder: options.sortOrder ?? this.filters.sortOrder,
        };

        const result = await window.electronAPI.invoke("session:list", params);

        if (result) {
          if (params.offset === 0) {
            this.sessions = result.sessions || [];
          } else {
            this.sessions.push(...(result.sessions || []));
          }

          this.pagination = {
            offset: params.offset,
            limit: params.limit,
            total: result.total || this.sessions.length,
          };
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 加载会话列表失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 搜索会话
     */
    async searchSessions(query, options = {}) {
      this.loading = true;
      this.error = null;

      try {
        const searchOptions = {
          searchTitle: options.searchTitle ?? true,
          searchContent: options.searchContent ?? true,
          limit: options.limit ?? 50,
        };

        const result = await window.electronAPI.invoke(
          "session:search",
          query,
          searchOptions,
        );

        if (result) {
          this.sessions = result;
          this.filters.searchQuery = query;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 搜索会话失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 按标签查找会话
     */
    async findByTags(tags, options = {}) {
      this.loading = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "session:find-by-tags",
          tags,
          options,
        );

        if (result) {
          this.sessions = result;
          this.filters.selectedTags = tags;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 按标签查找失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 加载会话详情
     */
    async loadSessionDetail(sessionId) {
      this.loadingDetail = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke(
          "session:load",
          sessionId,
        );

        if (result) {
          this.currentSession = result;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 加载会话详情失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loadingDetail = false;
      }
    },

    /**
     * 删除会话
     */
    async deleteSession(sessionId) {
      try {
        await window.electronAPI.invoke("session:delete", sessionId);

        // 从列表中移除
        this.sessions = this.sessions.filter((s) => s.id !== sessionId);

        // 如果删除的是当前会话，清空当前会话
        if (this.currentSession?.id === sessionId) {
          this.currentSession = null;
        }

        // 从选中列表中移除
        this.selectedIds = this.selectedIds.filter((id) => id !== sessionId);

        return { success: true };
      } catch (error) {
        logger.error("[SessionStore] 删除会话失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 批量删除会话
     */
    async deleteMultiple(sessionIds) {
      try {
        const result = await window.electronAPI.invoke(
          "session:delete-multiple",
          sessionIds,
        );

        // 从列表中移除
        this.sessions = this.sessions.filter((s) => !sessionIds.includes(s.id));

        // 如果删除了当前会话，清空当前会话
        if (sessionIds.includes(this.currentSession?.id)) {
          this.currentSession = null;
        }

        // 清空选中列表
        this.selectedIds = this.selectedIds.filter(
          (id) => !sessionIds.includes(id),
        );

        return result;
      } catch (error) {
        logger.error("[SessionStore] 批量删除失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 添加标签到会话
     */
    async addTags(sessionId, tags) {
      try {
        const result = await window.electronAPI.invoke(
          "session:add-tags",
          sessionId,
          tags,
        );

        // 更新列表中的会话
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.tags = result.tags || [...(session.tags || []), ...tags];
        }

        // 更新当前会话
        if (this.currentSession?.id === sessionId) {
          this.currentSession.tags = result.tags;
        }

        // 刷新所有标签
        await this.loadAllTags();

        return result;
      } catch (error) {
        logger.error("[SessionStore] 添加标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 移除会话标签
     */
    async removeTags(sessionId, tags) {
      try {
        const result = await window.electronAPI.invoke(
          "session:remove-tags",
          sessionId,
          tags,
        );

        // 更新列表中的会话
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.tags = result.tags;
        }

        // 更新当前会话
        if (this.currentSession?.id === sessionId) {
          this.currentSession.tags = result.tags;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 移除标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 批量添加标签
     */
    async addTagsToMultiple(sessionIds, tags) {
      try {
        const result = await window.electronAPI.invoke(
          "session:add-tags-multiple",
          sessionIds,
          tags,
        );

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        // 刷新所有标签
        await this.loadAllTags();

        return result;
      } catch (error) {
        logger.error("[SessionStore] 批量添加标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 加载所有标签
     */
    async loadAllTags() {
      this.loadingTags = true;

      try {
        const result = await window.electronAPI.invoke("session:get-all-tags");
        this.allTags = result || [];
        return result;
      } catch (error) {
        logger.error("[SessionStore] 加载标签失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loadingTags = false;
      }
    },

    /**
     * 导出会话为 JSON
     */
    async exportToJSON(sessionId, options = {}) {
      try {
        return await window.electronAPI.invoke(
          "session:export-json",
          sessionId,
          options,
        );
      } catch (error) {
        logger.error("[SessionStore] 导出 JSON 失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 导出会话为 Markdown
     */
    async exportToMarkdown(sessionId, options = {}) {
      try {
        return await window.electronAPI.invoke(
          "session:export-markdown",
          sessionId,
          options,
        );
      } catch (error) {
        logger.error("[SessionStore] 导出 Markdown 失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 批量导出会话
     */
    async exportMultiple(sessionIds, options = {}) {
      try {
        return await window.electronAPI.invoke(
          "session:export-multiple",
          sessionIds,
          options,
        );
      } catch (error) {
        logger.error("[SessionStore] 批量导出失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 从 JSON 导入会话
     */
    async importFromJSON(jsonData, options = {}) {
      try {
        const result = await window.electronAPI.invoke(
          "session:import-json",
          jsonData,
          options,
        );

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 导入 JSON 失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 生成会话摘要
     */
    async generateSummary(sessionId, options = {}) {
      try {
        const result = await window.electronAPI.invoke(
          "session:generate-summary",
          sessionId,
          options,
        );

        // 更新当前会话
        if (this.currentSession?.id === sessionId) {
          this.currentSession.summary = result.summary;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 生成摘要失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 恢复会话
     */
    async resumeSession(sessionId, options = {}) {
      try {
        return await window.electronAPI.invoke(
          "session:resume",
          sessionId,
          options,
        );
      } catch (error) {
        logger.error("[SessionStore] 恢复会话失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 保存为模板
     */
    async saveAsTemplate(sessionId, templateInfo) {
      try {
        const result = await window.electronAPI.invoke(
          "session:save-as-template",
          sessionId,
          templateInfo,
        );

        // 刷新模板列表
        await this.loadTemplates();

        return result;
      } catch (error) {
        logger.error("[SessionStore] 保存模板失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 从模板创建会话
     */
    async createFromTemplate(templateId, options = {}) {
      try {
        const result = await window.electronAPI.invoke(
          "session:create-from-template",
          templateId,
          options,
        );

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 从模板创建失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 加载模板列表
     */
    async loadTemplates(options = {}) {
      this.loadingTemplates = true;

      try {
        const result = await window.electronAPI.invoke(
          "session:list-templates",
          options,
        );
        this.templates = result || [];
        return result;
      } catch (error) {
        logger.error("[SessionStore] 加载模板失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loadingTemplates = false;
      }
    },

    /**
     * 删除模板
     */
    async deleteTemplate(templateId) {
      try {
        await window.electronAPI.invoke("session:delete-template", templateId);

        // 从列表中移除
        this.templates = this.templates.filter((t) => t.id !== templateId);

        return { success: true };
      } catch (error) {
        logger.error("[SessionStore] 删除模板失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 加载全局统计
     */
    async loadGlobalStats() {
      this.loadingStats = true;

      try {
        const result = await window.electronAPI.invoke(
          "session:get-global-stats",
        );
        if (result) {
          this.globalStats = result;
        }
        return result;
      } catch (error) {
        logger.error("[SessionStore] 加载全局统计失败:", error);
        this.error = error.message;
        throw error;
      } finally {
        this.loadingStats = false;
      }
    },

    /**
     * 更新会话标题
     */
    async updateTitle(sessionId, title) {
      try {
        const result = await window.electronAPI.invoke(
          "session:update-title",
          sessionId,
          title,
        );

        // 更新列表中的会话
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.title = title;
        }

        // 更新当前会话
        if (this.currentSession?.id === sessionId) {
          this.currentSession.title = title;
        }

        return result;
      } catch (error) {
        logger.error("[SessionStore] 更新标题失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ============================================================
    // 会话复制功能
    // ============================================================

    /**
     * 复制会话
     */
    async duplicateSession(sessionId, options = {}) {
      try {
        const result = await window.electronAPI.invoke(
          "session:duplicate",
          sessionId,
          options,
        );

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        // 刷新全局统计
        await this.loadGlobalStats();

        return result;
      } catch (error) {
        logger.error("[SessionStore] 复制会话失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    // ============================================================
    // 标签管理功能
    // ============================================================

    /**
     * 重命名标签
     */
    async renameTag(oldTag, newTag) {
      try {
        const result = await window.electronAPI.invoke(
          "session:rename-tag",
          oldTag,
          newTag,
        );

        // 刷新标签列表
        await this.loadAllTags();

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 重命名标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 合并标签
     */
    async mergeTags(sourceTags, targetTag) {
      try {
        const result = await window.electronAPI.invoke(
          "session:merge-tags",
          sourceTags,
          targetTag,
        );

        // 刷新标签列表
        await this.loadAllTags();

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 合并标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 删除标签
     */
    async deleteTag(tag) {
      try {
        const result = await window.electronAPI.invoke(
          "session:delete-tag",
          tag,
        );

        // 刷新标签列表
        await this.loadAllTags();

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 删除标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 批量删除标签
     */
    async deleteTags(tags) {
      try {
        const result = await window.electronAPI.invoke(
          "session:delete-tags",
          tags,
        );

        // 刷新标签列表
        await this.loadAllTags();

        // 刷新会话列表
        await this.loadSessions({ offset: 0 });

        return result;
      } catch (error) {
        logger.error("[SessionStore] 批量删除标签失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 获取标签详情
     */
    async getTagDetails(tag, options = {}) {
      try {
        return await window.electronAPI.invoke(
          "session:get-tag-details",
          tag,
          options,
        );
      } catch (error) {
        logger.error("[SessionStore] 获取标签详情失败:", error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 设置筛选条件
     */
    setFilters(filters) {
      this.filters = { ...this.filters, ...filters };
    },

    /**
     * 清空筛选条件
     */
    clearFilters() {
      this.filters = {
        searchQuery: "",
        selectedTags: [],
        sortBy: "updated_at",
        sortOrder: "desc",
      };
    },

    /**
     * 选中会话
     */
    selectSession(sessionId) {
      if (!this.selectedIds.includes(sessionId)) {
        this.selectedIds.push(sessionId);
      }
    },

    /**
     * 取消选中会话
     */
    deselectSession(sessionId) {
      this.selectedIds = this.selectedIds.filter((id) => id !== sessionId);
    },

    /**
     * 切换会话选中状态
     */
    toggleSelection(sessionId) {
      if (this.selectedIds.includes(sessionId)) {
        this.deselectSession(sessionId);
      } else {
        this.selectSession(sessionId);
      }
    },

    /**
     * 全选
     */
    selectAll() {
      this.selectedIds = this.sessions.map((s) => s.id);
    },

    /**
     * 全不选
     */
    deselectAll() {
      this.selectedIds = [];
    },

    /**
     * 设置当前会话
     */
    setCurrentSession(session) {
      this.currentSession = session;
    },

    /**
     * 清空当前会话
     */
    clearCurrentSession() {
      this.currentSession = null;
    },

    /**
     * 清空错误
     */
    clearError() {
      this.error = null;
    },

    /**
     * 重置状态
     */
    reset() {
      this.sessions = [];
      this.currentSession = null;
      this.selectedIds = [];
      this.allTags = [];
      this.templates = [];
      this.globalStats = {
        totalSessions: 0,
        totalMessages: 0,
        totalTokensSaved: 0,
        uniqueTags: 0,
        totalTemplates: 0,
      };
      this.filters = {
        searchQuery: "",
        selectedTags: [],
        sortBy: "updated_at",
        sortOrder: "desc",
      };
      this.pagination = {
        offset: 0,
        limit: 20,
        total: 0,
      };
      this.loading = false;
      this.loadingDetail = false;
      this.loadingTags = false;
      this.loadingTemplates = false;
      this.loadingStats = false;
      this.error = null;
    },
  },
});
