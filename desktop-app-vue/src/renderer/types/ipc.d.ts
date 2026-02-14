/**
 * IPC 通道类型定义
 *
 * @description 定义 IPC 通信的通道名称和数据类型
 */

// ==================== IPC 响应类型 ====================

/**
 * 通用 IPC 响应
 */
export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==================== IPC 重试配置 ====================

/**
 * IPC 重试配置
 */
export interface IPCRetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

/**
 * IPC 重试选项
 */
export interface IPCRetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  silentErrors?: boolean;
}

// ==================== IPC 通道名称常量 ====================

/**
 * 项目相关通道
 */
export type ProjectChannel =
  | 'project:get-all'
  | 'project:get'
  | 'project:create'
  | 'project:update'
  | 'project:delete';

/**
 * 模板相关通道
 */
export type TemplateChannel =
  | 'template:getAll'
  | 'template:getById'
  | 'template:create'
  | 'template:update'
  | 'template:delete';

/**
 * 通知相关通道
 */
export type NotificationChannel =
  | 'notification:get-all'
  | 'notification:mark-read'
  | 'notification:clear-all'
  | 'notification:show';

/**
 * 聊天相关通道
 */
export type ChatChannel =
  | 'chat:get-sessions'
  | 'chat:get-session'
  | 'chat:create-session'
  | 'chat:delete-session'
  | 'chat:get-messages'
  | 'chat:send-message';

/**
 * 好友相关通道
 */
export type FriendChannel =
  | 'friend:get-friends'
  | 'friend:add'
  | 'friend:remove'
  | 'friend:send-message';

/**
 * LLM 相关通道
 */
export type LLMChannel =
  | 'llm:check-status'
  | 'llm:query'
  | 'llm:chat'
  | 'llm:stream-chat'
  | 'llm:cancel-stream';

/**
 * 系统相关通道
 */
export type SystemChannel =
  | 'system:get-version'
  | 'system:minimize'
  | 'system:maximize'
  | 'system:close'
  | 'system:is-maximized'
  | 'system:open-external'
  | 'system:show-in-folder'
  | 'system:get-path'
  | 'system:get-platform';

/**
 * 文件相关通道
 */
export type FileChannel =
  | 'file:read'
  | 'file:write'
  | 'file:exists'
  | 'file:mkdir'
  | 'file:readdir'
  | 'file:unlink'
  | 'file:stat'
  | 'file:select'
  | 'file:select-directory'
  | 'file:save';

/**
 * 日志相关通道
 */
export type LoggerChannel =
  | 'logger:write'
  | 'logger:get-logs'
  | 'logger:clear';

/**
 * 数据库相关通道
 */
export type DatabaseChannel =
  | 'db:query'
  | 'db:run'
  | 'db:get-knowledge-items'
  | 'db:add-knowledge-item'
  | 'db:update-knowledge-item'
  | 'db:delete-knowledge-item'
  | 'db:search-knowledge-items';

/**
 * RAG 相关通道
 */
export type RAGChannel =
  | 'rag:search'
  | 'rag:add-document'
  | 'rag:delete-document'
  | 'rag:reindex';

/**
 * P2P 相关通道
 */
export type P2PChannel =
  | 'p2p:connect'
  | 'p2p:disconnect'
  | 'p2p:send'
  | 'p2p:broadcast'
  | 'p2p:get-peers'
  | 'p2p:on-message';

/**
 * DID 相关通道
 */
export type DIDChannel =
  | 'did:create'
  | 'did:resolve'
  | 'did:sign'
  | 'did:verify';

/**
 * MCP 相关通道
 */
export type MCPChannel =
  | 'mcp:list-servers'
  | 'mcp:connect'
  | 'mcp:disconnect'
  | 'mcp:call-tool';

/**
 * 多媒体相关通道
 */
export type MultimediaChannel =
  | 'multimedia:upload-image'
  | 'multimedia:compress-image'
  | 'multimedia:transcribe-audio'
  | 'multimedia:process-video'
  | 'multimedia:get-video-info';

/**
 * 会话管理相关通道
 */
export type SessionChannel =
  | 'session:create'
  | 'session:get'
  | 'session:list'
  | 'session:update'
  | 'session:delete'
  | 'session:compress'
  | 'session:search';

/**
 * 记忆系统相关通道
 */
export type MemoryChannel =
  | 'memory:save-daily'
  | 'memory:get-daily'
  | 'memory:search'
  | 'memory:get-insights';

/**
 * Hooks 系统相关通道
 */
export type HooksChannel =
  | 'hooks:register'
  | 'hooks:unregister'
  | 'hooks:list'
  | 'hooks:trigger';

/**
 * Plan Mode 相关通道
 */
export type PlanModeChannel =
  | 'plan-mode:enter'
  | 'plan-mode:exit'
  | 'plan-mode:get-plan'
  | 'plan-mode:approve'
  | 'plan-mode:reject';

/**
 * Skills 系统相关通道
 */
export type SkillsChannel =
  | 'skills:list'
  | 'skills:get'
  | 'skills:execute'
  | 'skills:install'
  | 'skills:uninstall';

/**
 * Context Engineering 相关通道
 */
export type ContextChannel =
  | 'context:optimize'
  | 'context:get-stats'
  | 'context:compress'
  | 'context:restore';

/**
 * 权限系统相关通道
 */
export type PermissionChannel =
  | 'permission:check'
  | 'permission:grant'
  | 'permission:revoke'
  | 'permission:list';

/**
 * 团队管理相关通道
 */
export type TeamChannel =
  | 'team:create'
  | 'team:get'
  | 'team:list'
  | 'team:update'
  | 'team:delete'
  | 'team:add-member'
  | 'team:remove-member';

/**
 * 所有 IPC 通道类型
 */
export type IPCChannel =
  | ProjectChannel
  | TemplateChannel
  | NotificationChannel
  | ChatChannel
  | FriendChannel
  | LLMChannel
  | SystemChannel
  | FileChannel
  | LoggerChannel
  | DatabaseChannel
  | RAGChannel
  | P2PChannel
  | DIDChannel
  | MCPChannel
  | MultimediaChannel
  | SessionChannel
  | MemoryChannel
  | HooksChannel
  | PlanModeChannel
  | SkillsChannel
  | ContextChannel
  | PermissionChannel
  | TeamChannel;

// ==================== IPC 事件类型 ====================

/**
 * IPC 事件监听器
 */
export type IPCListener<T = any> = (event: any, ...args: T[]) => void;

/**
 * IPC 事件发射器
 */
export interface IPCEventEmitter {
  on(channel: string, listener: IPCListener): void;
  once(channel: string, listener: IPCListener): void;
  off(channel: string, listener: IPCListener): void;
  emit(channel: string, ...args: any[]): void;
}

// ==================== 启动重试通道 ====================

/**
 * 需要重试逻辑的 IPC 通道（在启动时可能未就绪）
 */
export const STARTUP_RETRY_CHANNELS: string[] = [
  'project:getAll',
  'template:getAll',
  'notification:getAll',
  'friend:getPendingRequests',
  'friend:getFriends',
];
