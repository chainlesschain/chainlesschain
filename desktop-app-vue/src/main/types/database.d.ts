/**
 * Database Module Type Definitions
 *
 * @module database
 * @description SQLite/SQLCipher 数据库管理类型定义
 */

import { EventEmitter } from 'events';

// ==================== 数据库配置 ====================

/**
 * 数据库初始化选项
 */
export interface DatabaseOptions {
  /** 加密密码 */
  password?: string;
  /** 是否启用加密 (默认 true) */
  encryptionEnabled?: boolean;
  /** 自定义数据库路径 */
  customPath?: string;
}

/**
 * 数据库适配器类型
 */
export type DatabaseAdapterType = 'better-sqlite3' | 'sqlcipher' | 'sql.js';

// ==================== 知识库数据模型 ====================

/**
 * 知识库项目
 */
export interface KnowledgeItem {
  id?: number;
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
  embedding?: Float32Array | number[];
  metadata?: Record<string, any>;
}

/**
 * 知识库标签
 */
export interface KnowledgeTag {
  id?: number;
  name: string;
  color?: string;
  created_at?: string;
}

/**
 * 知识库统计信息
 */
export interface KnowledgeStats {
  totalItems: number;
  totalTags: number;
  totalProjects: number;
  totalConversations: number;
  totalSessions: number;
  totalDailyNotes: number;
}

// ==================== 会话数据模型 ====================

/**
 * 聊天会话
 */
export interface ChatSession {
  id?: number;
  title: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id?: number;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
  metadata?: Record<string, any>;
}

// ==================== 项目数据模型 ====================

/**
 * 项目信息
 */
export interface Project {
  id?: number;
  name: string;
  description?: string;
  path?: string;
  category?: string;
  status?: 'active' | 'archived' | 'completed';
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

/**
 * 项目模板
 */
export interface ProjectTemplate {
  id?: number;
  name: string;
  description?: string;
  category?: string;
  config?: Record<string, any>;
  created_at?: string;
}

// ==================== DID/P2P 数据模型 ====================

/**
 * DID 身份
 */
export interface DIDIdentity {
  id?: number;
  did: string;
  public_key: string;
  private_key?: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

/**
 * P2P 消息
 */
export interface P2PMessage {
  id?: number;
  from_did: string;
  to_did: string;
  content: string;
  encrypted: boolean;
  created_at?: string;
  delivered_at?: string;
}

/**
 * 好友关系
 */
export interface FriendRelation {
  id?: number;
  user_did: string;
  friend_did: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at?: string;
}

// ==================== 记忆系统数据模型 ====================

/**
 * 向量嵌入缓存
 */
export interface EmbeddingCache {
  id?: number;
  content_hash: string;
  embedding: Float32Array | number[];
  model: string;
  created_at?: string;
}

/**
 * 记忆文件哈希
 */
export interface MemoryFileHash {
  id?: number;
  file_path: string;
  hash: string;
  last_indexed?: string;
}

/**
 * 日志元数据
 */
export interface DailyNoteMetadata {
  id?: number;
  date: string;
  word_count?: number;
  activity_count?: number;
  summary?: string;
  tags?: string;
  created_at?: string;
}

/**
 * 记忆段落
 */
export interface MemorySection {
  id?: number;
  category: string;
  content: string;
  importance: number;
  created_at?: string;
  updated_at?: string;
}

// ==================== 权限系统数据模型 ====================

/**
 * 团队信息
 */
export interface Team {
  id?: number;
  org_id: number;
  name: string;
  description?: string;
  parent_team_id?: number;
  lead_did?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * 团队成员
 */
export interface TeamMember {
  id?: number;
  team_id: number;
  member_did: string;
  role?: 'lead' | 'member';
  joined_at?: string;
}

/**
 * 权限记录
 */
export interface Permission {
  id?: number;
  org_id: number;
  grantee_type: 'user' | 'team';
  grantee_id: string;
  resource_type: string;
  resource_id: string;
  permission: string;
  granted_at?: string;
  granted_by?: string;
  expires_at?: string;
}

// ==================== 查询相关类型 ====================

/**
 * SQL 查询参数
 */
export type QueryParams = any[] | Record<string, any>;

/**
 * SQL 查询结果
 */
export type QueryResult<T = any> = T | T[] | null;

/**
 * 数据库统计信息
 */
export interface DatabaseStats {
  size: number;
  tables: number;
  indexes: number;
  cacheHits?: number;
  cacheMisses?: number;
  preparedStatements?: number;
}

// ==================== Prepared Statement ====================

/**
 * Prepared Statement 接口
 */
export interface PreparedStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  finalize(): void;
}

// ==================== DatabaseManager 类 ====================

/**
 * 数据库管理类
 */
export declare class DatabaseManager extends EventEmitter {
  /** 数据库实例 */
  db: any;
  /** 数据库路径 */
  dbPath: string | null;
  /** SQL.js 实例 */
  SQL: any;
  /** 数据库适配器 */
  adapter: any;
  /** 是否在事务中 */
  inTransaction: boolean;
  /** 自定义路径 */
  customPath: string | null;
  /** 加密密码 */
  encryptionPassword: string | null;
  /** 是否启用加密 */
  encryptionEnabled: boolean;
  /** Prepared Statement 缓存 */
  preparedStatements: Map<string, PreparedStatement>;
  /** 查询缓存 */
  queryCache: any;

  /**
   * 构造函数
   */
  constructor(customPath?: string | null, options?: DatabaseOptions);

  // ==================== 初始化方法 ====================

  /**
   * 初始化查询缓存
   */
  initializeQueryCache(): void;

  /**
   * 获取或创建 Prepared Statement
   */
  getPreparedStatement(sql: string): PreparedStatement;

  /**
   * 清除所有 Prepared Statements
   */
  clearPreparedStatements(): void;

  /**
   * 初始化数据库
   */
  initialize(): Promise<void>;

  /**
   * 使用 Better-SQLite3 初始化
   */
  initializeWithBetterSQLite(): Promise<void>;

  /**
   * 使用加密适配器初始化
   */
  initializeWithAdapter(): Promise<void>;

  /**
   * 使用 sql.js 初始化
   */
  initializeWithSqlJs(): Promise<void>;

  /**
   * 应用语句兼容层
   */
  applyStatementCompat(): void;

  /**
   * 保存数据库到文件
   */
  saveToFile(): void;

  /**
   * 创建所有数据表
   */
  createTables(): Promise<void>;

  /**
   * 确保任务看板所有者架构
   */
  ensureTaskBoardOwnerSchema(): Promise<void>;

  /**
   * 数据库迁移
   */
  migrateDatabase(): Promise<void>;

  /**
   * 运行优化的迁移
   */
  runMigrationsOptimized(): Promise<void>;

  /**
   * 运行迁移
   */
  runMigrations(): Promise<void>;

  /**
   * 检查表是否需要重建
   */
  checkIfTableNeedsRebuild(tableName: string, testCategoryValue?: string): Promise<boolean>;

  /**
   * 重建项目表
   */
  rebuildProjectsTable(): Promise<void>;

  /**
   * 重建项目模板表
   */
  rebuildProjectTemplatesTable(): Promise<void>;

  /**
   * 检查列是否存在
   */
  checkColumnExists(tableName: string, columnName: string): Promise<boolean>;

  // ==================== 知识库操作 ====================

  /**
   * 获取知识库项目列表
   */
  getKnowledgeItems(limit?: number, offset?: number): Promise<KnowledgeItem[]>;

  /**
   * 根据 ID 获取知识库项目
   */
  getKnowledgeItemById(id: number): Promise<KnowledgeItem | null>;

  /**
   * 根据 ID 获取知识库项目（别名）
   */
  getKnowledgeItem(id: number): Promise<KnowledgeItem | null>;

  /**
   * 根据标题获取知识库项目
   */
  getKnowledgeItemByTitle(title: string): Promise<KnowledgeItem | null>;

  /**
   * 获取所有知识库项目
   */
  getAllKnowledgeItems(): Promise<KnowledgeItem[]>;

  /**
   * 添加知识库项目
   */
  addKnowledgeItem(item: Partial<KnowledgeItem>): Promise<number>;

  /**
   * 更新知识库项目
   */
  updateKnowledgeItem(id: number, updates: Partial<KnowledgeItem>): Promise<void>;

  /**
   * 删除知识库项目
   */
  deleteKnowledgeItem(id: number): Promise<void>;

  /**
   * 搜索知识库
   */
  searchKnowledge(query: string): Promise<KnowledgeItem[]>;

  /**
   * 更新搜索索引
   */
  updateSearchIndex(id: number, title: string, content: string): Promise<void>;

  // ==================== 标签操作 ====================

  /**
   * 获取所有标签
   */
  getAllTags(): Promise<KnowledgeTag[]>;

  /**
   * 创建标签
   */
  createTag(name: string, color?: string): Promise<number>;

  /**
   * 为知识库项目添加标签
   */
  addTagToKnowledge(knowledgeId: number, tagId: number): Promise<void>;

  /**
   * 获取知识库项目的标签
   */
  getKnowledgeTags(knowledgeId: number): Promise<KnowledgeTag[]>;

  // ==================== 统计信息 ====================

  /**
   * 获取统计信息
   */
  getStatistics(): Promise<KnowledgeStats>;

  /**
   * 获取数据库统计
   */
  getDatabaseStats(): Promise<DatabaseStats>;

  // ==================== 通用 SQL 操作 ====================

  /**
   * 执行 SQL 查询（返回所有结果）
   */
  all<T = any>(sql: string, params?: QueryParams): Promise<T[]>;

  /**
   * 执行 SQL 查询（返回单条结果）
   */
  get<T = any>(sql: string, params?: QueryParams): Promise<T | null>;

  /**
   * 执行 SQL 语句（INSERT/UPDATE/DELETE）
   */
  run(sql: string, params?: QueryParams): Promise<{ changes: number; lastInsertRowid: number }>;

  /**
   * 执行 SQL 语句（无返回值）
   */
  exec(sql: string): Promise<void>;

  // ==================== 事务操作 ====================

  /**
   * 开始事务
   */
  beginTransaction(): Promise<void>;

  /**
   * 提交事务
   */
  commit(): Promise<void>;

  /**
   * 回滚事务
   */
  rollback(): Promise<void>;

  /**
   * 执行事务
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

  // ==================== 关闭数据库 ====================

  /**
   * 关闭数据库连接
   */
  close(): Promise<void>;
}

// ==================== 导出函数 ====================

/**
 * 获取数据库实例（单例模式）
 */
export function getDatabase(): DatabaseManager;

/**
 * 创建新的数据库实例
 */
export function createDatabase(customPath?: string, options?: DatabaseOptions): DatabaseManager;

/**
 * SQL 安全检查工具
 */
export namespace SqlSecurity {
  /**
   * 验证 SQL 语句安全性
   */
  function validateSql(sql: string): boolean;

  /**
   * 清理 SQL 参数
   */
  function sanitizeParams(params: QueryParams): QueryParams;

  /**
   * 检测 SQL 注入
   */
  function detectInjection(sql: string): boolean;
}
