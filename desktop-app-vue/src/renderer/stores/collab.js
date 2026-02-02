/**
 * Collab Store - Pinia 状态管理
 * 管理实时协作编辑系统的状态
 *
 * @module collab-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

export const useCollabStore = defineStore('collab', {
  state: () => ({
    // ==========================================
    // 文档管理
    // ==========================================

    // 当前打开的协作文档
    currentDocument: null,

    // 打开的文档列表
    openDocuments: [],

    // ==========================================
    // 用户感知
    // ==========================================

    // 当前文档的协作者列表
    collaborators: [],

    // 协作者光标位置
    cursorPositions: {},

    // ==========================================
    // 锁管理
    // ==========================================

    // 当前文档的锁列表
    locks: [],

    // 我持有的锁
    myLocks: [],

    // ==========================================
    // 冲突管理
    // ==========================================

    // 待解决的冲突
    pendingConflicts: [],

    // 冲突历史
    conflictHistory: [],

    // ==========================================
    // 评论管理
    // ==========================================

    // 当前文档的评论
    comments: [],

    // 未解决的评论数
    unresolvedCommentCount: 0,

    // ==========================================
    // 版本历史
    // ==========================================

    // 文档版本历史
    versionHistory: [],

    // 当前预览的版本
    previewVersion: null,

    // ==========================================
    // 统计信息
    // ==========================================

    // 协作统计
    stats: {
      totalEdits: 0,
      totalCollaborators: 0,
      totalConflicts: 0,
      resolvedConflicts: 0,
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      document: false,
      collaborators: false,
      locks: false,
      comments: false,
      history: false,
    },

    // ==========================================
    // 连接状态
    // ==========================================

    connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected'

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,
  }),

  getters: {
    /**
     * 是否有未解决的冲突
     */
    hasUnresolvedConflicts: (state) => {
      return state.pendingConflicts.length > 0;
    },

    /**
     * 当前文档是否被锁定
     */
    isDocumentLocked: (state) => {
      return state.locks.some((lock) => lock.lockType === 'full');
    },

    /**
     * 获取我的锁定区域
     */
    myLockedSections: (state) => {
      return state.myLocks.map((lock) => ({
        start: lock.sectionStart,
        end: lock.sectionEnd,
      }));
    },

    /**
     * 在线协作者数量
     */
    onlineCollaboratorCount: (state) => {
      return state.collaborators.filter((c) => c.isOnline).length;
    },

    /**
     * 是否正在加载
     */
    isLoading: (state) => {
      return Object.values(state.loading).some((loading) => loading);
    },

    /**
     * 是否已连接
     */
    isConnected: (state) => {
      return state.connectionStatus === 'connected';
    },
  },

  actions: {
    // ==========================================
    // 文档操作
    // ==========================================

    /**
     * 打开协作文档
     */
    async openDocument(knowledgeId, userDid, userName) {
      this.loading.document = true;
      this.error = null;

      try {
        const result = await window.electronAPI.invoke('collab:open-document', {
          knowledgeId,
          userDid,
          userName,
        });

        if (result.success) {
          this.currentDocument = result.document;
          this.connectionStatus = 'connected';

          // 添加到打开文档列表
          if (!this.openDocuments.find((d) => d.id === knowledgeId)) {
            this.openDocuments.push({
              id: knowledgeId,
              openedAt: Date.now(),
            });
          }

          // 加载相关数据
          await Promise.all([
            this.loadComments(knowledgeId),
            this.loadLocks(knowledgeId),
          ]);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 打开文档失败:', error);
        this.error = error.message;
        throw error;
      } finally {
        this.loading.document = false;
      }
    },

    /**
     * 关闭协作文档
     */
    async closeDocument(knowledgeId, userDid) {
      try {
        const result = await window.electronAPI.invoke('collab:close-document', {
          knowledgeId,
          userDid,
        });

        if (result.success) {
          // 从打开文档列表移除
          this.openDocuments = this.openDocuments.filter((d) => d.id !== knowledgeId);

          // 如果是当前文档，清空
          if (this.currentDocument?.id === knowledgeId) {
            this.currentDocument = null;
            this.collaborators = [];
            this.locks = [];
            this.comments = [];
            this.connectionStatus = 'disconnected';
          }
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 关闭文档失败:', error);
        this.error = error.message;
        throw error;
      }
    },

    // ==========================================
    // 同步操作
    // ==========================================

    /**
     * 同步更新
     */
    async syncUpdate(knowledgeId, update, userDid) {
      try {
        return await window.electronAPI.invoke('collab:sync-update', {
          knowledgeId,
          update,
          userDid,
        });
      } catch (error) {
        console.error('[CollabStore] 同步更新失败:', error);
        throw error;
      }
    },

    /**
     * 更新光标位置
     */
    async updateCursor(knowledgeId, userDid, cursorData) {
      try {
        await window.electronAPI.invoke('collab:update-cursor', {
          knowledgeId,
          userDid,
          cursorData,
        });
      } catch (error) {
        console.error('[CollabStore] 更新光标失败:', error);
      }
    },

    /**
     * 设置协作者列表（从感知数据更新）
     */
    setCollaborators(collaborators) {
      this.collaborators = collaborators;
    },

    /**
     * 更新光标位置（本地状态）
     */
    updateCursorPosition(userDid, position) {
      this.cursorPositions[userDid] = position;
    },

    // ==========================================
    // 锁操作
    // ==========================================

    /**
     * 加载锁列表
     */
    async loadLocks(knowledgeId) {
      this.loading.locks = true;
      try {
        // 获取文档的所有锁
        const currentLocks = this.locks.filter((l) => l.knowledgeId === knowledgeId);
        return { success: true, locks: currentLocks };
      } finally {
        this.loading.locks = false;
      }
    },

    /**
     * 获取段落锁
     */
    async acquireLock(knowledgeId, userDid, lockType, sectionStart, sectionEnd) {
      try {
        const result = await window.electronAPI.invoke('collab:acquire-lock', {
          knowledgeId,
          userDid,
          lockType,
          sectionStart,
          sectionEnd,
        });

        if (result.success) {
          this.myLocks.push(result.lock);
          this.locks.push(result.lock);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取锁失败:', error);
        this.error = error.message;
        throw error;
      }
    },

    /**
     * 释放锁
     */
    async releaseLock(lockId, userDid) {
      try {
        const result = await window.electronAPI.invoke('collab:release-lock', {
          lockId,
          userDid,
        });

        if (result.success) {
          this.myLocks = this.myLocks.filter((l) => l.id !== lockId);
          this.locks = this.locks.filter((l) => l.id !== lockId);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 释放锁失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 冲突操作
    // ==========================================

    /**
     * 请求冲突解决
     */
    async requestConflictResolution(knowledgeId, conflictData) {
      try {
        const result = await window.electronAPI.invoke('collab:request-conflict-resolution', {
          knowledgeId,
          conflictData,
        });

        if (result.success) {
          this.pendingConflicts.push(result.conflict);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 请求冲突解决失败:', error);
        throw error;
      }
    },

    /**
     * 解决冲突
     */
    async resolveConflict(conflictId, resolution, resolvedByDid) {
      try {
        const result = await window.electronAPI.invoke('collab:resolve-conflict', {
          conflictId,
          resolution,
          resolvedByDid,
        });

        if (result.success) {
          // 移动到历史
          const conflict = this.pendingConflicts.find((c) => c.id === conflictId);
          if (conflict) {
            this.conflictHistory.unshift({ ...conflict, resolution, resolvedAt: Date.now() });
            this.pendingConflicts = this.pendingConflicts.filter((c) => c.id !== conflictId);
          }
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 解决冲突失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 评论操作
    // ==========================================

    /**
     * 加载评论
     */
    async loadComments(knowledgeId) {
      this.loading.comments = true;
      try {
        const result = await window.electronAPI.invoke('collab:get-comments', {
          knowledgeId,
        });

        if (result.success) {
          this.comments = result.comments || [];
          this.unresolvedCommentCount = this.comments.filter((c) => !c.resolved).length;
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 加载评论失败:', error);
        throw error;
      } finally {
        this.loading.comments = false;
      }
    },

    /**
     * 添加行内评论
     */
    async addComment(knowledgeId, commentData) {
      try {
        const result = await window.electronAPI.invoke('collab:add-inline-comment', {
          knowledgeId,
          ...commentData,
        });

        if (result.success) {
          this.comments.push(result.comment);
          this.unresolvedCommentCount++;
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 添加评论失败:', error);
        throw error;
      }
    },

    /**
     * 解决评论
     */
    async resolveComment(commentId, resolvedByDid) {
      try {
        const result = await window.electronAPI.invoke('collab:resolve-comment', {
          commentId,
          resolvedByDid,
        });

        if (result.success) {
          const comment = this.comments.find((c) => c.id === commentId);
          if (comment) {
            comment.resolved = true;
            comment.resolvedAt = Date.now();
            this.unresolvedCommentCount--;
          }
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 解决评论失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 版本历史操作
    // ==========================================

    /**
     * 获取文档历史
     */
    async loadVersionHistory(knowledgeId, options = {}) {
      this.loading.history = true;
      try {
        const result = await window.electronAPI.invoke('collab:get-document-history', {
          knowledgeId,
          ...options,
        });

        if (result.success) {
          this.versionHistory = result.history || [];
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 加载版本历史失败:', error);
        throw error;
      } finally {
        this.loading.history = false;
      }
    },

    /**
     * 恢复版本
     */
    async restoreVersion(knowledgeId, versionId, restoredByDid) {
      try {
        const result = await window.electronAPI.invoke('collab:restore-version', {
          knowledgeId,
          versionId,
          restoredByDid,
        });

        return result;
      } catch (error) {
        console.error('[CollabStore] 恢复版本失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 统计操作
    // ==========================================

    /**
     * 获取协作统计
     */
    async loadStats(knowledgeId) {
      try {
        const result = await window.electronAPI.invoke('collab:get-stats', {
          knowledgeId,
        });

        if (result.success) {
          this.stats = result.stats;
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取统计失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 导出操作
    // ==========================================

    /**
     * 导出带评论的文档
     */
    async exportWithComments(knowledgeId, format = 'markdown') {
      try {
        return await window.electronAPI.invoke('collab:export-with-comments', {
          knowledgeId,
          format,
        });
      } catch (error) {
        console.error('[CollabStore] 导出失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 重置
    // ==========================================

    /**
     * 重置所有状态
     */
    reset() {
      this.$reset();
    },
  },
});
