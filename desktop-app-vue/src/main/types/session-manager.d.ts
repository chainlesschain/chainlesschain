/**
 * Session Manager Type Definitions
 *
 * @module session-manager
 * @description 会话上下文管理类型定义 - 智能压缩、持久化、跨会话连续对话
 */

import { EventEmitter } from 'events';
import { DatabaseManager } from './database';

// ==================== 会话配置 ====================

/**
 * SessionManager 配置选项
 */
export interface SessionManagerOptions {
  /** 数据库实例（必需） */
  database: DatabaseManager;
  /** LLM 管理器实例（用于智能总结） */
  llmManager?: any;
  /** 永久记忆管理器实例 */
  permanentMemoryManager?: any;
  /** 会话存储目录 */
  sessionsDir?: string;
  /** 最大历史消息数（默认 10） */
  maxHistoryMessages?: number;
  /** 触发压缩的消息数阈值（默认 10） */
  compressionThreshold?: number;
  /** 启用自动保存（默认 true） */
  enableAutoSave?: boolean;
  /** 启用智能压缩（默认 true） */
  enableCompression?: boolean;
  /** 启用自动摘要生成（默认 true） */
  enableAutoSummary?: boolean;
  /** 触发自动摘要的消息数阈值（默认 5） */
  autoSummaryThreshold?: number;
  /** 后台自动摘要检查间隔（毫秒，默认 5 分钟） */
  autoSummaryInterval?: number;
  /** 启用后台摘要生成（默认 true） */
  enableBackgroundSummary?: boolean;
  /** 启用预压缩记忆刷新（默认 true） */
  enableMemoryFlush?: boolean;
}

// ==================== 会话数据模型 ====================

/**
 * 会话消息
 */
export interface SessionMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number | string;
  tokens?: number;
  metadata?: Record<string, any>;
}

/**
 * 会话数据
 */
export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: SessionMessage[];
  summary?: string;
  compressed?: boolean;
  compressedHistory?: SessionMessage[];
  tags?: string[];
  metadata?: Record<string, any>;
  stats?: {
    totalMessages?: number;
    totalTokens?: number;
    compressionRatio?: number;
  };
}

/**
 * 创建会话参数
 */
export interface CreateSessionParams {
  /** 会话标题 */
  title?: string;
  /** 初始系统提示 */
  systemPrompt?: string;
  /** 初始标签 */
  tags?: string[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 加载会话选项
 */
export interface LoadSessionOptions {
  /** 是否包含完整历史消息（默认 false） */
  includeFullHistory?: boolean;
  /** 是否跳过缓存（默认 false） */
  skipCache?: boolean;
}

/**
 * 添加消息选项
 */
export interface AddMessageOptions {
  /** 是否自动保存（默认使用全局配置） */
  autoSave?: boolean;
  /** 是否触发自动总结（默认使用全局配置） */
  autoSummary?: boolean;
  /** 是否触发自动压缩（默认使用全局配置） */
  autoCompress?: boolean;
  /** 消息元数据 */
  metadata?: Record<string, any>;
}

// ==================== 压缩相关 ====================

/**
 * 压缩结果
 */
export interface CompressionResult {
  success: boolean;
  originalMessages: number;
  compressedMessages: number;
  tokensReduced?: number;
  compressionRatio?: number;
  summary?: string;
  error?: string;
}

/**
 * 会话统计信息
 */
export interface SessionStats {
  id: string;
  title: string;
  totalMessages: number;
  totalTokens: number;
  compressedMessages?: number;
  compressionRatio?: number;
  created_at: string;
  updated_at: string;
  lastMessageTime?: string;
  tags?: string[];
}

// ==================== 搜索相关 ====================

/**
 * 会话搜索选项
 */
export interface SearchSessionsOptions {
  /** 限制结果数量（默认 20） */
  limit?: number;
  /** 跳过数量（默认 0） */
  offset?: number;
  /** 按标签筛选 */
  tags?: string[];
  /** 排序方式（默认 updated_at desc） */
  sortBy?: 'created_at' | 'updated_at' | 'title';
  /** 排序方向（默认 desc） */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 会话搜索结果
 */
export interface SearchResult {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

// ==================== 导出/导入相关 ====================

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 是否包含完整消息历史（默认 true） */
  includeMessages?: boolean;
  /** 是否包含元数据（默认 true） */
  includeMetadata?: boolean;
  /** 是否美化 JSON（默认 true） */
  pretty?: boolean;
}

/**
 * 导出 Markdown 选项
 */
export interface ExportMarkdownOptions extends ExportOptions {
  /** 是否包含统计信息（默认 true） */
  includeStats?: boolean;
  /** 是否包含时间戳（默认 true） */
  includeTimestamps?: boolean;
}

/**
 * 导入选项
 */
export interface ImportOptions {
  /** 是否覆盖已存在的会话（默认 false） */
  overwrite?: boolean;
  /** 是否保留原始 ID（默认 false） */
  preserveId?: boolean;
}

// ==================== 模板相关 ====================

/**
 * 会话模板
 */
export interface SessionTemplate {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  systemPrompt?: string;
  initialMessages?: SessionMessage[];
  tags?: string[];
  metadata?: Record<string, any>;
  created_at?: string;
  usage_count?: number;
}

/**
 * 保存模板信息
 */
export interface SaveTemplateInfo {
  name: string;
  description?: string;
  category?: string;
}

/**
 * 从模板创建选项
 */
export interface CreateFromTemplateOptions {
  /** 自定义标题 */
  title?: string;
  /** 额外标签 */
  additionalTags?: string[];
  /** 额外元数据 */
  additionalMetadata?: Record<string, any>;
}

/**
 * 模板列表选项
 */
export interface ListTemplatesOptions {
  /** 按分类筛选 */
  category?: string;
  /** 限制结果数量 */
  limit?: number;
  /** 跳过数量 */
  offset?: number;
}

// ==================== 摘要生成相关 ====================

/**
 * 生成摘要选项
 */
export interface GenerateSummaryOptions {
  /** 强制重新生成（默认 false） */
  force?: boolean;
  /** 摘要最大长度（tokens） */
  maxLength?: number;
  /** 使用的模型 */
  model?: string;
}

/**
 * 批量生成摘要选项
 */
export interface GenerateSummariesBatchOptions {
  /** 是否并行处理（默认 false） */
  parallel?: boolean;
  /** 并行数量（默认 3） */
  concurrency?: number;
  /** 是否仅处理无摘要的会话（默认 true） */
  onlyMissing?: boolean;
}

/**
 * 批量生成摘要结果
 */
export interface BatchSummaryResult {
  total: number;
  success: number;
  failed: number;
  results: Array<{
    sessionId: string;
    success: boolean;
    summary?: string;
    error?: string;
  }>;
}

// ==================== 会话恢复 ====================

/**
 * 恢复会话选项
 */
export interface ResumeSessionOptions {
  /** 是否清除草稿消息（默认 false） */
  clearDraft?: boolean;
  /** 新的系统提示 */
  systemPrompt?: string;
}

/**
 * 恢复会话结果
 */
export interface ResumeSessionResult {
  session: Session;
  resumedFrom: string;
  previousMessages: number;
  effectiveMessages: SessionMessage[];
}

// ==================== 全局统计 ====================

/**
 * 全局统计信息
 */
export interface GlobalStats {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  compressedSessions: number;
  averageMessagesPerSession: number;
  averageTokensPerSession: number;
  topTags: Array<{ tag: string; count: number }>;
  recentActivity: Array<{ date: string; count: number }>;
}

// ==================== 批量操作 ====================

/**
 * 批量删除结果
 */
export interface DeleteMultipleResult {
  deleted: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * 批量添加标签结果
 */
export interface AddTagsMultipleResult {
  updated: string[];
  failed: Array<{ id: string; error: string }>;
}

// ==================== 复制会话选项 ====================

/**
 * 复制会话选项
 */
export interface DuplicateSessionOptions {
  /** 新会话标题（默认为原标题 + " (副本)"） */
  title?: string;
  /** 是否包含消息（默认 true） */
  includeMessages?: boolean;
  /** 是否包含标签（默认 true） */
  includeTags?: boolean;
  /** 是否包含摘要（默认 false） */
  includeSummary?: boolean;
}

// ==================== SessionManager 类 ====================

/**
 * 会话管理器类
 */
export declare class SessionManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** LLM 管理器 */
  llmManager: any;
  /** 永久记忆管理器 */
  permanentMemoryManager: any;
  /** 会话存储目录 */
  sessionsDir: string;
  /** 最大历史消息数 */
  maxHistoryMessages: number;
  /** 压缩阈值 */
  compressionThreshold: number;
  /** 启用自动保存 */
  enableAutoSave: boolean;
  /** 启用压缩 */
  enableCompression: boolean;
  /** 启用自动摘要 */
  enableAutoSummary: boolean;
  /** 自动摘要阈值 */
  autoSummaryThreshold: number;
  /** 自动摘要间隔 */
  autoSummaryInterval: number;
  /** 启用后台摘要 */
  enableBackgroundSummary: boolean;
  /** 启用记忆刷新 */
  enableMemoryFlush: boolean;
  /** Prompt 压缩器 */
  promptCompressor: any;
  /** 会话缓存 */
  sessionCache: Map<string, Session>;

  /**
   * 构造函数
   */
  constructor(options: SessionManagerOptions);

  /**
   * 初始化会话管理器
   */
  initialize(): Promise<void>;

  /**
   * 创建新会话
   */
  createSession(params?: CreateSessionParams): Promise<Session>;

  /**
   * 加载会话
   */
  loadSession(sessionId: string, options?: LoadSessionOptions): Promise<Session>;

  /**
   * 添加消息到会话
   */
  addMessage(sessionId: string, message: SessionMessage, options?: AddMessageOptions): Promise<void>;

  /**
   * 压缩会话
   */
  compressSession(sessionId: string): Promise<CompressionResult>;

  /**
   * 刷新记忆（在压缩前）
   */
  flushMemoryBeforeCompaction(sessionId: string): Promise<void>;

  /**
   * 保存会话
   */
  saveSession(sessionId: string): Promise<void>;

  /**
   * 保存会话到文件
   */
  saveSessionToFile(session: Session): Promise<void>;

  /**
   * 从文件加载会话
   */
  loadSessionFromFile(sessionId: string): Promise<Session>;

  /**
   * 获取有效消息（用于 LLM 上下文）
   */
  getEffectiveMessages(sessionId: string): Promise<SessionMessage[]>;

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * 列出会话
   */
  listSessions(options?: SearchSessionsOptions): Promise<SearchResult>;

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string): Promise<SessionStats>;

  /**
   * 清理旧会话
   */
  cleanupOldSessions(daysToKeep?: number): Promise<number>;

  /**
   * 搜索会话
   */
  searchSessions(query: string, options?: SearchSessionsOptions): Promise<SearchResult>;

  /**
   * 添加标签
   */
  addTags(sessionId: string, tags: string[]): Promise<void>;

  /**
   * 移除标签
   */
  removeTags(sessionId: string, tags: string[]): Promise<void>;

  /**
   * 获取所有标签
   */
  getAllTags(): Promise<string[]>;

  /**
   * 按标签查找会话
   */
  findSessionsByTags(tags: string[], options?: SearchSessionsOptions): Promise<SearchResult>;

  /**
   * 导出到 JSON
   */
  exportToJSON(sessionId: string, options?: ExportOptions): Promise<string>;

  /**
   * 导出到 Markdown
   */
  exportToMarkdown(sessionId: string, options?: ExportMarkdownOptions): Promise<string>;

  /**
   * 从 JSON 导入
   */
  importFromJSON(jsonData: string | object, options?: ImportOptions): Promise<Session>;

  /**
   * 导出多个会话
   */
  exportMultiple(sessionIds: string[], options?: ExportOptions): Promise<string>;

  /**
   * 生成摘要
   */
  generateSummary(sessionId: string, options?: GenerateSummaryOptions): Promise<string>;

  /**
   * 批量生成摘要
   */
  generateSummariesBatch(options?: GenerateSummariesBatchOptions): Promise<BatchSummaryResult>;

  /**
   * 恢复会话
   */
  resumeSession(sessionId: string, options?: ResumeSessionOptions): Promise<ResumeSessionResult>;

  /**
   * 获取最近会话
   */
  getRecentSessions(count?: number): Promise<Session[]>;

  /**
   * 保存为模板
   */
  saveAsTemplate(sessionId: string, templateInfo: SaveTemplateInfo): Promise<string>;

  /**
   * 从模板创建会话
   */
  createFromTemplate(templateId: string, options?: CreateFromTemplateOptions): Promise<Session>;

  /**
   * 列出模板
   */
  listTemplates(options?: ListTemplatesOptions): Promise<SessionTemplate[]>;

  /**
   * 删除模板
   */
  deleteTemplate(templateId: string): Promise<void>;

  /**
   * 批量删除会话
   */
  deleteMultiple(sessionIds: string[]): Promise<DeleteMultipleResult>;

  /**
   * 批量添加标签
   */
  addTagsToMultiple(sessionIds: string[], tags: string[]): Promise<AddTagsMultipleResult>;

  /**
   * 获取全局统计
   */
  getGlobalStats(): Promise<GlobalStats>;

  /**
   * 更新标题
   */
  updateTitle(sessionId: string, title: string): Promise<void>;

  /**
   * 复制会话
   */
  duplicateSession(sessionId: string, options?: DuplicateSessionOptions): Promise<Session>;

  /**
   * 重命名标签
   */
  renameTag(oldTag: string, newTag: string): Promise<void>;

  /**
   * 启动后台摘要生成
   */
  startBackgroundSummary(): void;

  /**
   * 停止后台摘要生成
   */
  stopBackgroundSummary(): void;

  /**
   * 销毁管理器
   */
  destroy(): void;

  // ==================== 事件 ====================

  on(event: 'session-created', listener: (session: Session) => void): this;
  on(event: 'session-updated', listener: (sessionId: string) => void): this;
  on(event: 'session-deleted', listener: (sessionId: string) => void): this;
  on(event: 'message-added', listener: (sessionId: string, message: SessionMessage) => void): this;
  on(event: 'session-compressed', listener: (sessionId: string, result: CompressionResult) => void): this;
  on(event: 'summary-generated', listener: (sessionId: string, summary: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== 导出函数 ====================

/**
 * 获取会话管理器实例（单例模式）
 */
export function getSessionManager(options?: SessionManagerOptions): SessionManager;

/**
 * 创建新的会话管理器实例
 */
export function createSessionManager(options: SessionManagerOptions): SessionManager;
