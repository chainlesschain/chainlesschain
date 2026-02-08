/**
 * Context Engineering Type Definitions
 *
 * @module context-engineering
 * @description KV-Cache 优化、Token 估算、上下文压缩类型定义
 */

import { EventEmitter } from 'events';

// ==================== Token 相关 ====================

/**
 * Token 估算结果
 */
export interface TokenEstimate {
  /** Token 数量 */
  tokens: number;
  /** 字符数 */
  characters: number;
  /** 语言类型 */
  language?: 'chinese' | 'english' | 'mixed';
}

/**
 * Token 统计
 */
export interface TokenStats {
  /** 总 Token 数 */
  total: number;
  /** 系统提示 Token 数 */
  systemPrompt?: number;
  /** 用户消息 Token 数 */
  userMessages?: number;
  /** 助手消息 Token 数 */
  assistantMessages?: number;
  /** 工具定义 Token 数 */
  toolDefinitions?: number;
}

// ==================== 上下文优化相关 ====================

/**
 * 上下文优化选项
 */
export interface ContextOptimizationOptions {
  /** 最大 Token 数 */
  maxTokens?: number;
  /** 是否保留静态内容（默认 true） */
  preserveStatic?: boolean;
  /** 是否启用压缩（默认 true） */
  enableCompression?: boolean;
  /** 压缩比率 (0-1，默认 0.5) */
  compressionRatio?: number;
}

/**
 * 上下文优化结果
 */
export interface ContextOptimizationResult {
  /** 优化后的内容 */
  optimized: string;
  /** 原始 Token 数 */
  originalTokens: number;
  /** 优化后 Token 数 */
  optimizedTokens: number;
  /** 节省的 Token 数 */
  tokensSaved: number;
  /** 压缩比率 */
  compressionRatio: number;
  /** 是否发生截断 */
  truncated: boolean;
}

// ==================== KV-Cache 优化 ====================

/**
 * KV-Cache 配置
 */
export interface KVCacheConfig {
  /** 是否启用 KV-Cache 优化（默认 true） */
  enabled?: boolean;
  /** 静态内容前置（默认 true） */
  staticFirst?: boolean;
  /** 工具定义确定性排序（默认 true） */
  deterministicToolOrder?: boolean;
  /** 目标重述间隔（消息数，默认 10） */
  goalRestatementInterval?: number;
}

/**
 * KV-Cache 命中统计
 */
export interface KVCacheHitStats {
  /** 总请求数 */
  totalRequests: number;
  /** 缓存命中数 */
  cacheHits: number;
  /** 缓存未命中数 */
  cacheMisses: number;
  /** 命中率 (0-1) */
  hitRate: number;
  /** 平均 Token 重用数 */
  avgTokensReused: number;
}

// ==================== 消息结构化 ====================

/**
 * 结构化消息
 */
export interface StructuredMessage {
  /** 角色 */
  role: 'system' | 'user' | 'assistant';
  /** 内容 */
  content: string;
  /** Token 数 */
  tokens?: number;
  /** 是否为静态内容 */
  static?: boolean;
  /** 优先级（数字越大优先级越高） */
  priority?: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 上下文块
 */
export interface ContextBlock {
  /** 块类型 */
  type: 'static' | 'dynamic' | 'tool' | 'history';
  /** 内容 */
  content: string;
  /** Token 数 */
  tokens: number;
  /** 是否可压缩 */
  compressible: boolean;
  /** 优先级 */
  priority: number;
}

// ==================== 压缩策略 ====================

/**
 * 压缩策略
 */
export type CompressionStrategy =
  | 'sliding_window'  // 滑动窗口
  | 'summarization'   // 摘要生成
  | 'importance_sampling'  // 重要性采样
  | 'hybrid';  // 混合策略

/**
 * 压缩配置
 */
export interface CompressionConfig {
  /** 压缩策略 */
  strategy?: CompressionStrategy;
  /** 保留消息数（滑动窗口） */
  keepMessages?: number;
  /** 是否启用摘要（默认 true） */
  enableSummary?: boolean;
  /** 摘要最大 Token 数 */
  summaryMaxTokens?: number;
  /** 重要性阈值 (0-1) */
  importanceThreshold?: number;
}

// ==================== 错误历史跟踪 ====================

/**
 * 错误记录
 */
export interface ErrorRecord {
  /** 错误类型 */
  type: string;
  /** 错误消息 */
  message: string;
  /** 发生时间 */
  timestamp: number;
  /** 上下文信息 */
  context?: Record<string, any>;
  /** 解决方案（如果已解决） */
  solution?: string;
}

/**
 * 错误历史配置
 */
export interface ErrorHistoryConfig {
  /** 最大记录数（默认 10） */
  maxRecords?: number;
  /** 是否在上下文中包含错误历史（默认 true） */
  includeInContext?: boolean;
  /** 错误历史摘要最大 Token 数 */
  summaryMaxTokens?: number;
}

// ==================== ContextEngineering 类 ====================

/**
 * 上下文工程配置选项
 */
export interface ContextEngineeringOptions {
  /** KV-Cache 配置 */
  kvCache?: KVCacheConfig;
  /** 压缩配置 */
  compression?: CompressionConfig;
  /** 错误历史配置 */
  errorHistory?: ErrorHistoryConfig;
  /** 最大总 Token 数（默认 8000） */
  maxTotalTokens?: number;
  /** LLM 管理器（用于生成摘要） */
  llmManager?: any;
}

/**
 * 上下文工程类
 */
export declare class ContextEngineering extends EventEmitter {
  /** KV-Cache 配置 */
  kvCacheConfig: KVCacheConfig;
  /** 压缩配置 */
  compressionConfig: CompressionConfig;
  /** 错误历史配置 */
  errorHistoryConfig: ErrorHistoryConfig;
  /** 最大总 Token 数 */
  maxTotalTokens: number;
  /** LLM 管理器 */
  llmManager: any;
  /** 错误历史记录 */
  errorHistory: ErrorRecord[];
  /** KV-Cache 统计 */
  kvCacheStats: KVCacheHitStats;

  /**
   * 构造函数
   */
  constructor(options?: ContextEngineeringOptions);

  /**
   * 估算 Token 数
   */
  estimateTokens(text: string): TokenEstimate;

  /**
   * 批量估算 Token 数
   */
  estimateTokensBatch(texts: string[]): TokenEstimate[];

  /**
   * 优化上下文
   */
  optimizeContext(
    messages: StructuredMessage[],
    options?: ContextOptimizationOptions
  ): Promise<ContextOptimizationResult>;

  /**
   * 应用 KV-Cache 优化
   */
  applyKVCacheOptimization(messages: StructuredMessage[]): StructuredMessage[];

  /**
   * 压缩消息历史
   */
  compressHistory(
    messages: StructuredMessage[],
    targetTokens: number
  ): Promise<StructuredMessage[]>;

  /**
   * 生成上下文摘要
   */
  generateSummary(messages: StructuredMessage[], maxTokens?: number): Promise<string>;

  /**
   * 重述目标
   */
  restateGoal(goal: string, context: StructuredMessage[]): string;

  /**
   * 记录错误
   */
  recordError(error: ErrorRecord): void;

  /**
   * 获取错误历史摘要
   */
  getErrorHistorySummary(): string;

  /**
   * 清除错误历史
   */
  clearErrorHistory(): void;

  /**
   * 分离静态和动态内容
   */
  separateStaticDynamic(messages: StructuredMessage[]): {
    static: StructuredMessage[];
    dynamic: StructuredMessage[];
  };

  /**
   * 序列化工具定义（确定性排序）
   */
  serializeToolDefinitions(tools: any[]): string;

  /**
   * 获取上下文统计
   */
  getContextStats(messages: StructuredMessage[]): TokenStats;

  /**
   * 获取 KV-Cache 统计
   */
  getKVCacheStats(): KVCacheHitStats;

  /**
   * 重置 KV-Cache 统计
   */
  resetKVCacheStats(): void;

  // ==================== 事件 ====================

  on(event: 'context-optimized', listener: (result: ContextOptimizationResult) => void): this;
  on(event: 'summary-generated', listener: (summary: string) => void): this;
  on(event: 'error-recorded', listener: (error: ErrorRecord) => void): this;
  on(event: 'kv-cache-hit', listener: (stats: KVCacheHitStats) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== 导出函数 ====================

/**
 * 获取上下文工程实例（单例模式）
 */
export function getContextEngineering(options?: ContextEngineeringOptions): ContextEngineering;

/**
 * 创建新的上下文工程实例
 */
export function createContextEngineering(options?: ContextEngineeringOptions): ContextEngineering;

/**
 * 估算文本 Token 数（快速方法）
 */
export function estimateTokens(text: string): number;

/**
 * 检测文本语言
 */
export function detectLanguage(text: string): 'chinese' | 'english' | 'mixed';
