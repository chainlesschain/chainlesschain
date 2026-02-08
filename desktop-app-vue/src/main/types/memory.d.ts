/**
 * Permanent Memory System Type Definitions
 *
 * @module memory
 * @description 永久记忆系统类型定义 - Daily Notes、MEMORY.md、混合搜索
 */

import { EventEmitter } from 'events';
import { DatabaseManager } from './database';

// ==================== 记忆类型 ====================

/**
 * 记忆类型
 */
export type MemoryType = 'daily' | 'permanent' | 'section' | 'insight';

/**
 * 记忆重要性级别
 */
export type ImportanceLevel = 'low' | 'medium' | 'high' | 'critical';

// ==================== Daily Notes 相关 ====================

/**
 * Daily Note 条目
 */
export interface DailyNoteEntry {
  /** 时间戳 */
  timestamp: string;
  /** 内容 */
  content: string;
  /** 类型 */
  type: 'activity' | 'insight' | 'decision' | 'learning' | 'error';
  /** 重要性 */
  importance?: ImportanceLevel;
  /** 标签 */
  tags?: string[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * Daily Note 元数据
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
 * Daily Note 统计
 */
export interface DailyNoteStats {
  totalDays: number;
  totalEntries: number;
  totalWords: number;
  avgEntriesPerDay: number;
  topTags: Array<{ tag: string; count: number }>;
}

// ==================== MEMORY.md 相关 ====================

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

/**
 * MEMORY.md 结构
 */
export interface MemoryStructure {
  /** 版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 段落分类 */
  sections: Record<string, MemorySection[]>;
  /** 总结 */
  summary?: string;
}

/**
 * 知识提取选项
 */
export interface ExtractInsightsOptions {
  /** 最小重要性级别 */
  minImportance?: ImportanceLevel;
  /** 最大提取数量 */
  maxInsights?: number;
  /** 时间范围（天数） */
  days?: number;
  /** 是否使用 AI 提取（默认 true） */
  useAI?: boolean;
}

// ==================== 记忆搜索相关 ====================

/**
 * 记忆搜索选项
 */
export interface MemorySearchOptions {
  /** 搜索方法 */
  method?: 'vector' | 'keyword' | 'hybrid';
  /** Top-K 结果数 */
  topK?: number;
  /** 时间范围 */
  dateRange?: { start: string; end: string };
  /** 标签筛选 */
  tags?: string[];
  /** 记忆类型筛选 */
  memoryType?: MemoryType[];
  /** 最小重要性 */
  minImportance?: ImportanceLevel;
}

/**
 * 记忆搜索结果
 */
export interface MemorySearchResult {
  /** 内容 */
  content: string;
  /** 来源 */
  source: string;
  /** 日期 */
  date?: string;
  /** 相似度分数 */
  score: number;
  /** 记忆类型 */
  type: MemoryType;
  /** 重要性 */
  importance?: ImportanceLevel;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ==================== 索引相关 ====================

/**
 * 索引选项
 */
export interface IndexOptions {
  /** 是否强制重建（默认 false） */
  force?: boolean;
  /** 是否增量索引（默认 true） */
  incremental?: boolean;
  /** 批处理大小 */
  batchSize?: number;
}

/**
 * 索引统计
 */
export interface IndexStats {
  totalDocuments: number;
  totalVectors: number;
  lastIndexed: string;
  indexSize: number;
  cacheHits: number;
  cacheMisses: number;
}

// ==================== 记忆刷新相关 ====================

/**
 * 记忆刷新选项
 */
export interface MemoryFlushOptions {
  /** 是否生成摘要（默认 true） */
  generateSummary?: boolean;
  /** 是否提取洞察（默认 true） */
  extractInsights?: boolean;
  /** 是否更新 MEMORY.md（默认 true） */
  updateMemory?: boolean;
}

/**
 * 记忆刷新结果
 */
export interface MemoryFlushResult {
  success: boolean;
  entriesSaved: number;
  summary?: string;
  insights?: string[];
  error?: string;
}

// ==================== PermanentMemoryManager 类 ====================

/**
 * 永久记忆管理器配置
 */
export interface PermanentMemoryOptions {
  /** 数据库实例 */
  database: DatabaseManager;
  /** RAG 管理器 */
  ragManager?: any;
  /** LLM 管理器 */
  llmManager?: any;
  /** 记忆目录 */
  memoryDir?: string;
  /** 是否启用自动索引（默认 true） */
  autoIndex?: boolean;
  /** 索引去抖延迟（毫秒，默认 1500） */
  indexDebounce?: number;
  /** 是否启用文件监视（默认 true） */
  enableFileWatch?: boolean;
  /** 嵌入缓存配置 */
  embeddingCache?: {
    enabled?: boolean;
    ttl?: number;
  };
}

/**
 * 永久记忆管理器类
 */
export declare class PermanentMemoryManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** RAG 管理器 */
  ragManager: any;
  /** LLM 管理器 */
  llmManager: any;
  /** 记忆目录 */
  memoryDir: string;
  /** Daily Notes 目录 */
  dailyNotesDir: string;
  /** MEMORY.md 路径 */
  memoryFilePath: string;
  /** 是否启用自动索引 */
  autoIndex: boolean;
  /** 索引去抖延迟 */
  indexDebounce: number;
  /** 是否启用文件监视 */
  enableFileWatch: boolean;
  /** 文件监视器 */
  fileWatcher: any;

  /**
   * 构造函数
   */
  constructor(options: PermanentMemoryOptions);

  /**
   * 初始化记忆管理器
   */
  initialize(): Promise<void>;

  // ==================== Daily Notes 操作 ====================

  /**
   * 记录日志条目
   */
  logActivity(entry: DailyNoteEntry): Promise<void>;

  /**
   * 获取今日日志
   */
  getTodayNotes(): Promise<DailyNoteEntry[]>;

  /**
   * 获取指定日期的日志
   */
  getDailyNotes(date: string): Promise<DailyNoteEntry[]>;

  /**
   * 获取日志统计
   */
  getDailyNoteStats(): Promise<DailyNoteStats>;

  /**
   * 生成每日摘要
   */
  generateDailySummary(date: string): Promise<string>;

  // ==================== MEMORY.md 操作 ====================

  /**
   * 读取 MEMORY.md
   */
  readMemory(): Promise<MemoryStructure>;

  /**
   * 写入 MEMORY.md
   */
  writeMemory(structure: MemoryStructure): Promise<void>;

  /**
   * 添加记忆段落
   */
  addMemorySection(category: string, content: string, importance: number): Promise<void>;

  /**
   * 更新记忆段落
   */
  updateMemorySection(id: number, updates: Partial<MemorySection>): Promise<void>;

  /**
   * 删除记忆段落
   */
  deleteMemorySection(id: number): Promise<void>;

  /**
   * 提取洞察
   */
  extractInsights(options?: ExtractInsightsOptions): Promise<string[]>;

  // ==================== 搜索操作 ====================

  /**
   * 搜索记忆
   */
  searchMemory(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;

  /**
   * 混合搜索（向量 + BM25）
   */
  hybridSearch(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;

  // ==================== 索引操作 ====================

  /**
   * 重建索引
   */
  rebuildIndex(options?: IndexOptions): Promise<void>;

  /**
   * 索引单个文件
   */
  indexFile(filePath: string): Promise<void>;

  /**
   * 索引 Daily Notes
   */
  indexDailyNotes(): Promise<void>;

  /**
   * 索引 MEMORY.md
   */
  indexMemory(): Promise<void>;

  /**
   * 获取索引统计
   */
  getIndexStats(): Promise<IndexStats>;

  // ==================== 记忆刷新 ====================

  /**
   * 刷新记忆（在上下文压缩前）
   */
  flushMemory(sessionId: string, options?: MemoryFlushOptions): Promise<MemoryFlushResult>;

  /**
   * 自动保存当前活动
   */
  autoSave(activity: string): Promise<void>;

  // ==================== 文件监视 ====================

  /**
   * 启动文件监视
   */
  startFileWatch(): void;

  /**
   * 停止文件监视
   */
  stopFileWatch(): void;

  // ==================== 嵌入缓存 ====================

  /**
   * 获取嵌入（带缓存）
   */
  getEmbeddingCached(content: string): Promise<Float32Array | number[]>;

  /**
   * 清除嵌入缓存
   */
  clearEmbeddingCache(): Promise<void>;

  /**
   * 获取缓存统计
   */
  getCacheStats(): Promise<{ hits: number; misses: number; hitRate: number }>;

  // ==================== 清理和维护 ====================

  /**
   * 清理旧记忆
   */
  cleanupOldMemories(daysToKeep?: number): Promise<number>;

  /**
   * 优化存储
   */
  optimizeStorage(): Promise<void>;

  /**
   * 导出记忆
   */
  exportMemory(format?: 'json' | 'markdown'): Promise<string>;

  /**
   * 导入记忆
   */
  importMemory(data: string, format?: 'json' | 'markdown'): Promise<void>;

  /**
   * 关闭管理器
   */
  close(): Promise<void>;

  // ==================== 事件 ====================

  on(event: 'activity-logged', listener: (entry: DailyNoteEntry) => void): this;
  on(event: 'memory-updated', listener: (section: MemorySection) => void): this;
  on(event: 'index-rebuilt', listener: (stats: IndexStats) => void): this;
  on(event: 'file-changed', listener: (filePath: string) => void): this;
  on(event: 'memory-flushed', listener: (result: MemoryFlushResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== 导出函数 ====================

/**
 * 获取永久记忆管理器实例（单例模式）
 */
export function getPermanentMemoryManager(options?: PermanentMemoryOptions): PermanentMemoryManager;

/**
 * 创建新的永久记忆管理器实例
 */
export function createPermanentMemoryManager(options: PermanentMemoryOptions): PermanentMemoryManager;
