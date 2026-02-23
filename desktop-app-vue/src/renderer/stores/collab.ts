/**
 * Collab Store - Pinia 状态管理
 * 管理实时协作编辑系统的状态
 *
 * @module collab-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 连接状态
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * 锁类型
 */
export type LockType = 'full' | 'section' | 'paragraph';

/**
 * 冲突解决策略
 */
export type ConflictResolution = 'mine' | 'theirs' | 'merge' | 'custom';

/**
 * 导出格式
 */
export type ExportFormat = 'markdown' | 'html' | 'docx' | 'pdf';

/**
 * 协作文档
 */
export interface CollabDocument {
  id: string;
  title: string;
  content?: string;
  version: number;
  lastModified?: number;
  [key: string]: any;
}

/**
 * 打开的文档
 */
export interface OpenDocument {
  id: string;
  openedAt: number;
}

/**
 * 协作者
 */
export interface Collaborator {
  did: string;
  name: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: number;
  color?: string;
  [key: string]: any;
}

/**
 * 光标位置
 */
export interface CursorPosition {
  line: number;
  column: number;
  selection?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: any;
}

/**
 * 锁数据
 */
export interface Lock {
  id: string;
  knowledgeId: string;
  userDid: string;
  userName?: string;
  lockType: LockType;
  sectionStart?: number;
  sectionEnd?: number;
  acquiredAt: number;
  expiresAt?: number;
  [key: string]: any;
}

/**
 * 锁定区域
 */
export interface LockedSection {
  start?: number;
  end?: number;
}

/**
 * 冲突数据
 */
export interface Conflict {
  id: string;
  knowledgeId: string;
  type: string;
  localContent?: string;
  remoteContent?: string;
  conflictAt: number;
  resolution?: ConflictResolution;
  resolvedAt?: number;
  resolvedByDid?: string;
  [key: string]: any;
}

/**
 * 评论数据
 */
export interface Comment {
  id: string;
  knowledgeId: string;
  authorDid: string;
  authorName?: string;
  content: string;
  lineNumber?: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedByDid?: string;
  createdAt: number;
  replies?: Comment[];
  [key: string]: any;
}

/**
 * 版本历史
 */
export interface Version {
  id: string;
  knowledgeId: string;
  version: number;
  content?: string;
  createdByDid: string;
  createdByName?: string;
  createdAt: number;
  message?: string;
  [key: string]: any;
}

/**
 * 协作统计
 */
export interface CollabStats {
  totalEdits: number;
  totalCollaborators: number;
  totalConflicts: number;
  resolvedConflicts: number;
  [key: string]: any;
}

/**
 * 加载状态
 */
export interface CollabLoadingState {
  document: boolean;
  collaborators: boolean;
  locks: boolean;
  comments: boolean;
  history: boolean;
}

/**
 * 同步更新数据
 */
export interface SyncUpdate {
  type: 'insert' | 'delete' | 'replace';
  position?: number;
  content?: string;
  length?: number;
  [key: string]: any;
}

/**
 * 评论数据（创建）
 */
export interface CommentData {
  content: string;
  lineNumber?: number;
  authorDid: string;
  authorName?: string;
  [key: string]: any;
}

/**
 * API 响应结果
 */
export interface CollabApiResult {
  success: boolean;
  error?: string;
  document?: CollabDocument;
  comments?: Comment[];
  comment?: Comment;
  locks?: Lock[];
  lock?: Lock;
  conflict?: Conflict;
  history?: Version[];
  stats?: CollabStats;
  [key: string]: any;
}

/**
 * Yjs 活跃协作者 (CRDT real-time)
 */
export interface ActiveCollaborator {
  did: string;
  name: string;
  color: string;
  cursor?: any;
}

/**
 * 协作房间 (v2.0.0)
 */
export interface CollabRoom {
  id: string;
  documentId: string;
  topic?: string;
  ownerDid?: string;
  status: string;
  maxParticipants?: number;
  participantCount: number;
  participants?: RoomParticipant[];
}

/**
 * 房间参与者 (v2.0.0)
 */
export interface RoomParticipant {
  did: string;
  name: string;
  role: 'viewer' | 'editor' | 'admin';
  status: 'online' | 'offline' | 'editing';
  joinedAt?: number;
}

/**
 * 版本快照 (v2.0.0)
 */
export interface VersionSnapshot {
  id: string;
  documentId: string;
  version: number;
  gitTag?: string;
  contentHash?: string;
  authorDid?: string;
  message?: string;
  createdAt: number;
}

/**
 * Collab Store 状态
 */
export interface CollabState {
  // 文档管理
  currentDocument: CollabDocument | null;
  openDocuments: OpenDocument[];
  // 用户感知
  collaborators: Collaborator[];
  cursorPositions: Record<string, CursorPosition>;
  // 锁管理
  locks: Lock[];
  myLocks: Lock[];
  // 冲突管理
  pendingConflicts: Conflict[];
  conflictHistory: Conflict[];
  // 评论管理
  comments: Comment[];
  unresolvedCommentCount: number;
  // 版本历史
  versionHistory: Version[];
  previewVersion: Version | null;
  // 统计信息
  stats: CollabStats;
  // 加载状态
  loading: CollabLoadingState;
  // 连接状态
  connectionStatus: ConnectionStatus;
  // 错误状态
  error: string | null;
  // Yjs CRDT 实时协作状态
  yjsConnected: boolean;
  yjsSynced: boolean;
  activeCollaborators: ActiveCollaborator[];
  // 协作房间 (v2.0.0)
  currentRoom: CollabRoom | null;
  activeRooms: CollabRoom[];
  versionSnapshots: VersionSnapshot[];
}

// ==================== Store ====================

export const useCollabStore = defineStore('collab', {
  state: (): CollabState => ({
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

    connectionStatus: 'disconnected',

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,

    // ==========================================
    // Yjs CRDT 实时协作状态
    // ==========================================

    // Yjs IPC 连接状态
    yjsConnected: false,

    // Yjs 同步完成状态
    yjsSynced: false,

    // 当前活跃的 CRDT 协作者
    activeCollaborators: [],

    // ==========================================
    // 协作房间 (v2.0.0)
    // ==========================================

    // 当前协作房间
    currentRoom: null,

    // 活跃房间列表
    activeRooms: [],

    // 版本快照
    versionSnapshots: [],
  }),

  getters: {
    /**
     * 是否有未解决的冲突
     */
    hasUnresolvedConflicts(): boolean {
      return this.pendingConflicts.length > 0;
    },

    /**
     * 当前文档是否被锁定
     */
    isDocumentLocked(): boolean {
      return this.locks.some((lock) => lock.lockType === 'full');
    },

    /**
     * 获取我的锁定区域
     */
    myLockedSections(): LockedSection[] {
      return this.myLocks.map((lock) => ({
        start: lock.sectionStart,
        end: lock.sectionEnd,
      }));
    },

    /**
     * 在线协作者数量
     */
    onlineCollaboratorCount(): number {
      return this.collaborators.filter((c) => c.isOnline).length;
    },

    /**
     * 是否正在加载
     */
    isLoading(): boolean {
      return Object.values(this.loading).some((loading) => loading);
    },

    /**
     * 是否已连接
     */
    isConnected(): boolean {
      return this.connectionStatus === 'connected';
    },

    /**
     * Yjs CRDT 是否已连接并同步
     */
    isYjsReady(): boolean {
      return this.yjsConnected && this.yjsSynced;
    },

    /**
     * 活跃 CRDT 协作者数量
     */
    activeCollaboratorCount(): number {
      return this.activeCollaborators.length;
    },
  },

  actions: {
    // ==========================================
    // 文档操作
    // ==========================================

    /**
     * 打开协作文档
     */
    async openDocument(
      knowledgeId: string,
      userDid: string,
      userName: string
    ): Promise<CollabApiResult> {
      this.loading.document = true;
      this.error = null;

      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:open-document', {
          knowledgeId,
          userDid,
          userName,
        });

        if (result.success && result.document) {
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
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading.document = false;
      }
    },

    /**
     * 关闭协作文档
     */
    async closeDocument(knowledgeId: string, userDid: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:close-document', {
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
        this.error = (error as Error).message;
        throw error;
      }
    },

    // ==========================================
    // 同步操作
    // ==========================================

    /**
     * 同步更新
     */
    async syncUpdate(
      knowledgeId: string,
      update: SyncUpdate,
      userDid: string
    ): Promise<CollabApiResult> {
      try {
        return await (window as any).electronAPI.invoke('collab:sync-update', {
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
    async updateCursor(
      knowledgeId: string,
      userDid: string,
      cursorData: CursorPosition
    ): Promise<void> {
      try {
        await (window as any).electronAPI.invoke('collab:update-cursor', {
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
    setCollaborators(collaborators: Collaborator[]): void {
      this.collaborators = collaborators;
    },

    /**
     * 更新光标位置（本地状态）
     */
    updateCursorPosition(userDid: string, position: CursorPosition): void {
      this.cursorPositions[userDid] = position;
    },

    // ==========================================
    // 锁操作
    // ==========================================

    /**
     * 加载锁列表
     */
    async loadLocks(knowledgeId: string): Promise<CollabApiResult> {
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
    async acquireLock(
      knowledgeId: string,
      userDid: string,
      lockType: LockType,
      sectionStart?: number,
      sectionEnd?: number
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:acquire-lock', {
          knowledgeId,
          userDid,
          lockType,
          sectionStart,
          sectionEnd,
        });

        if (result.success && result.lock) {
          this.myLocks.push(result.lock);
          this.locks.push(result.lock);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取锁失败:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    /**
     * 释放锁
     */
    async releaseLock(lockId: string, userDid: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:release-lock', {
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
    async requestConflictResolution(
      knowledgeId: string,
      conflictData: Partial<Conflict>
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:request-conflict-resolution', {
          knowledgeId,
          conflictData,
        });

        if (result.success && result.conflict) {
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
    async resolveConflict(
      conflictId: string,
      resolution: ConflictResolution,
      resolvedByDid: string
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:resolve-conflict', {
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
    async loadComments(knowledgeId: string): Promise<CollabApiResult> {
      this.loading.comments = true;
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-comments', {
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
    async addComment(knowledgeId: string, commentData: CommentData): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:add-inline-comment', {
          knowledgeId,
          ...commentData,
        });

        if (result.success && result.comment) {
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
    async resolveComment(commentId: string, resolvedByDid: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:resolve-comment', {
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
    async loadVersionHistory(
      knowledgeId: string,
      options: Record<string, any> = {}
    ): Promise<CollabApiResult> {
      this.loading.history = true;
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-document-history', {
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
    async restoreVersion(
      knowledgeId: string,
      versionId: string,
      restoredByDid: string
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:restore-version', {
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
    async loadStats(knowledgeId: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-stats', {
          knowledgeId,
        });

        if (result.success && result.stats) {
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
    async exportWithComments(
      knowledgeId: string,
      format: ExportFormat = 'markdown'
    ): Promise<CollabApiResult> {
      try {
        return await (window as any).electronAPI.invoke('collab:export-with-comments', {
          knowledgeId,
          format,
        });
      } catch (error) {
        console.error('[CollabStore] 导出失败:', error);
        throw error;
      }
    },

    // ==========================================
    // Yjs CRDT 实时协作操作
    // ==========================================

    /**
     * 连接 Yjs IPC Provider (CRDT 实时同步)
     */
    async connectYjs(documentId: string): Promise<void> {
      this.loading.document = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('collab:yjs-connect', {
          documentId,
        });

        if (result?.success) {
          this.yjsConnected = true;
        } else {
          this.error = result?.error || 'Failed to connect Yjs';
        }
      } catch (e: any) {
        console.error('[CollabStore] Yjs 连接失败:', e);
        this.error = e.message;
      } finally {
        this.loading.document = false;
      }
    },

    /**
     * 断开 Yjs IPC Provider 连接
     */
    async disconnectYjs(documentId: string): Promise<void> {
      try {
        await (window as any).electronAPI?.invoke('collab:yjs-disconnect', {
          documentId,
        });

        this.yjsConnected = false;
        this.yjsSynced = false;
        this.activeCollaborators = [];
      } catch (e: any) {
        console.error('[CollabStore] Yjs 断开连接失败:', e);
        this.error = e.message;
      }
    },

    /**
     * 设置 Yjs 同步状态
     */
    setYjsSynced(synced: boolean): void {
      this.yjsSynced = synced;
    },

    /**
     * 更新活跃 CRDT 协作者列表
     */
    updateActiveCollaborators(
      collaborators: Array<{ did: string; name: string; color: string; cursor?: any }>
    ): void {
      this.activeCollaborators = collaborators;
    },

    // ==========================================
    // 协作房间操作 (v2.0.0)
    // ==========================================

    /**
     * 创建协作房间
     */
    async createRoom(
      documentId: string,
      options: { maxParticipants?: number; permissions?: Record<string, any> } = {}
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:create-room', {
          documentId,
          ...options,
        });

        if (result.success && result.room) {
          this.currentRoom = result.room as CollabRoom;
          this.activeRooms.push(result.room as CollabRoom);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 创建房间失败:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    /**
     * 加入协作房间
     */
    async joinRoom(roomId: string, documentId: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:join-room', {
          roomId,
          documentId,
        });

        if (result.success && result.room) {
          this.currentRoom = result.room as CollabRoom;
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 加入房间失败:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    /**
     * 离开协作房间
     */
    async leaveRoom(roomId: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:leave-room', {
          roomId,
        });

        if (result.success) {
          this.activeRooms = this.activeRooms.filter((r) => r.id !== roomId);
          if (this.currentRoom?.id === roomId) {
            this.currentRoom = null;
          }
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 离开房间失败:', error);
        throw error;
      }
    },

    /**
     * 邀请用户到房间
     */
    async inviteUser(
      roomId: string,
      inviteeDid: string,
      role: string = 'editor'
    ): Promise<CollabApiResult> {
      try {
        return await (window as any).electronAPI.invoke('collab:invite-user', {
          roomId,
          inviteeDid,
          role,
        });
      } catch (error) {
        console.error('[CollabStore] 邀请用户失败:', error);
        throw error;
      }
    },

    /**
     * 获取活跃房间列表
     */
    async loadActiveRooms(): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-active-rooms');

        if (result.success) {
          this.activeRooms = (result.rooms || []) as CollabRoom[];
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取活跃房间失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 权限操作 (v2.0.0)
    // ==========================================

    /**
     * 设置参与者角色
     */
    async setParticipantRole(
      roomId: string,
      targetDid: string,
      role: string
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:set-role', {
          roomId,
          targetDid,
          role,
        });

        if (result.success && this.currentRoom?.id === roomId) {
          const participant = this.currentRoom.participants?.find((p) => p.did === targetDid);
          if (participant) {
            participant.role = role as 'viewer' | 'editor' | 'admin';
          }
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 设置角色失败:', error);
        throw error;
      }
    },

    /**
     * 获取房间参与者
     */
    async loadParticipants(roomId: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-participants', {
          roomId,
        });

        if (result.success && this.currentRoom?.id === roomId) {
          this.currentRoom.participants = (result.participants || []) as RoomParticipant[];
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取参与者失败:', error);
        throw error;
      }
    },

    // ==========================================
    // Git 版本快照操作 (v2.0.0)
    // ==========================================

    /**
     * 创建版本快照
     */
    async createSnapshot(
      documentId: string,
      message: string,
      authorDid: string
    ): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:create-snapshot', {
          documentId,
          message,
          authorDid,
        });

        if (result.success && result.snapshot) {
          this.versionSnapshots.unshift(result.snapshot as VersionSnapshot);
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 创建快照失败:', error);
        throw error;
      }
    },

    /**
     * 获取版本快照列表
     */
    async loadSnapshots(documentId: string): Promise<CollabApiResult> {
      try {
        const result: CollabApiResult = await (window as any).electronAPI.invoke('collab:get-snapshots', {
          documentId,
        });

        if (result.success) {
          this.versionSnapshots = (result.snapshots || []) as VersionSnapshot[];
        }

        return result;
      } catch (error) {
        console.error('[CollabStore] 获取快照失败:', error);
        throw error;
      }
    },

    /**
     * 恢复版本快照
     */
    async restoreSnapshot(
      documentId: string,
      snapshotId: string
    ): Promise<CollabApiResult> {
      try {
        return await (window as any).electronAPI.invoke('collab:restore-snapshot', {
          documentId,
          snapshotId,
        });
      } catch (error) {
        console.error('[CollabStore] 恢复快照失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 重置
    // ==========================================

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});
