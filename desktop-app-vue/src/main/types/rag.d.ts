/**
 * RAG System Type Definitions
 *
 * @module rag
 * @description RAG 检索增强生成系统类型定义 - 向量搜索、BM25、混合搜索
 */

import { EventEmitter } from 'events';
import { DatabaseManager } from './database';

// ==================== 向量相关 ====================

/**
 * 向量嵌入
 */
export type Embedding = Float32Array | number[];

/**
 * 向量数据库配置
 */
export interface VectorDBConfig {
  /** 数据库类型 */
  type: 'qdrant' | 'chromadb' | 'memory';
  /** 连接 URL */
  url?: string;
  /** 集合名称 */
  collectionName?: string;
  /** 向量维度 */
  dimension?: number;
  /** API Key */
  apiKey?: string;
}

// ==================== 文档模型 ====================

/**
 * RAG 文档
 */
export interface RAGDocument {
  /** 文档 ID */
  id: string;
  /** 文档内容 */
  content: string;
  /** 文档标题 */
  title?: string;
  /** 文档来源 */
  source?: string;
  /** 文档类型 */
  type?: string;
  /** 向量嵌入 */
  embedding?: Embedding;
  /** 元数据 */
  metadata?: Record<string, any>;
  /** 创建时间 */
  created_at?: string;
  /** 更新时间 */
  updated_at?: string;
}

/**
 * 检索结果项
 */
export interface RetrievalResult {
  /** 文档 */
  document: RAGDocument;
  /** 相似度分数 (0-1) */
  score: number;
  /** 排序分数 */
  rank?: number;
  /** 搜索方法 */
  source?: 'vector' | 'keyword' | 'hybrid';
}

// ==================== RAG Manager 配置 ====================

/**
 * RAG Manager 配置选项
 */
export interface RAGManagerOptions {
  /** 数据库实例 */
  database?: DatabaseManager;
  /** 向量数据库配置 */
  vectorDB?: VectorDBConfig;
  /** 嵌入模型名称 */
  embeddingModel?: string;
  /** 嵌入 API URL */
  embeddingApiUrl?: string;
  /** 是否启用缓存（默认 true） */
  enableCache?: boolean;
  /** 缓存 TTL（毫秒，默认 1 小时） */
  cacheTTL?: number;
  /** 是否启用查询增强（默认 true） */
  enableQueryEnhancement?: boolean;
  /** 是否启用重排序（默认 true） */
  enableReranking?: boolean;
  /** 默认 Top-K（默认 5） */
  defaultTopK?: number;
}

/**
 * 检索选项
 */
export interface RetrieveOptions {
  /** Top-K 结果数量（默认 5） */
  topK?: number;
  /** 相似度阈值 (0-1，默认 0.7) */
  threshold?: number;
  /** 是否启用重排序（默认 true） */
  rerank?: boolean;
  /** 重排序模型 */
  rerankModel?: string;
  /** 筛选条件 */
  filter?: Record<string, any>;
  /** 是否包含向量（默认 false） */
  includeEmbedding?: boolean;
  /** 搜索方法 */
  method?: 'vector' | 'keyword' | 'hybrid';
}

/**
 * 查询增强选项
 */
export interface QueryEnhancementOptions {
  /** 是否启用查询扩展（默认 true） */
  expand?: boolean;
  /** 是否启用同义词替换（默认 true） */
  synonyms?: boolean;
  /** 最大扩展词数（默认 3） */
  maxExpansions?: number;
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 文档总数 */
  totalDocuments: number;
  /** 索引大小（字节） */
  indexSize: number;
  /** 向量维度 */
  dimension?: number;
  /** 最后更新时间 */
  lastUpdated?: string;
  /** 缓存命中率 */
  cacheHitRate?: number;
}

// ==================== 混合搜索相关 ====================

/**
 * 混合搜索配置
 */
export interface HybridSearchConfig {
  /** 向量搜索权重 (0-1，默认 0.6) */
  vectorWeight?: number;
  /** BM25 搜索权重 (0-1，默认 0.4) */
  bm25Weight?: number;
  /** RRF (Reciprocal Rank Fusion) k 值（默认 60） */
  rrfK?: number;
  /** 是否启用查询扩展（默认 true） */
  enableQueryExpansion?: boolean;
}

/**
 * 混合搜索选项
 */
export interface HybridSearchOptions extends RetrieveOptions {
  /** 向量搜索权重 */
  vectorWeight?: number;
  /** BM25 搜索权重 */
  bm25Weight?: number;
  /** RRF k 值 */
  rrfK?: number;
}

// ==================== BM25 搜索相关 ====================

/**
 * BM25 参数
 */
export interface BM25Params {
  /** k1 参数（控制词频饱和度，默认 1.2） */
  k1?: number;
  /** b 参数（控制文档长度归一化，默认 0.75） */
  b?: number;
}

/**
 * BM25 搜索结果
 */
export interface BM25Result {
  /** 文档 ID */
  id: string;
  /** BM25 分数 */
  score: number;
  /** 匹配的词项 */
  matchedTerms?: string[];
}

/**
 * BM25 索引配置
 */
export interface BM25IndexConfig extends BM25Params {
  /** 分词器类型 */
  tokenizer?: 'standard' | 'chinese' | 'custom';
  /** 是否启用停用词过滤（默认 true） */
  removeStopwords?: boolean;
  /** 自定义停用词列表 */
  stopwords?: string[];
}

// ==================== 重排序相关 ====================

/**
 * 重排序选项
 */
export interface RerankOptions {
  /** 重排序模型 */
  model?: string;
  /** Top-N 重排序（默认全部） */
  topN?: number;
  /** 是否保留原始分数（默认 false） */
  keepOriginalScore?: boolean;
}

/**
 * 重排序结果
 */
export interface RerankResult {
  /** 文档 ID */
  id: string;
  /** 重排序分数 */
  score: number;
  /** 原始分数 */
  originalScore?: number;
  /** 文档内容 */
  content: string;
}

// ==================== RAGManager 类 ====================

/**
 * RAG 管理器类
 */
export declare class RAGManager extends EventEmitter {
  /** 数据库实例 */
  db: DatabaseManager;
  /** 向量数据库配置 */
  vectorDBConfig: VectorDBConfig;
  /** 嵌入模型 */
  embeddingModel: string;
  /** 嵌入 API URL */
  embeddingApiUrl: string;
  /** 是否启用缓存 */
  enableCache: boolean;
  /** 缓存 TTL */
  cacheTTL: number;
  /** 是否启用查询增强 */
  enableQueryEnhancement: boolean;
  /** 是否启用重排序 */
  enableReranking: boolean;
  /** 默认 Top-K */
  defaultTopK: number;
  /** 向量数据库客户端 */
  vectorClient: any;
  /** 嵌入缓存 */
  embeddingCache: Map<string, Embedding>;

  /**
   * 构造函数
   */
  constructor(options?: RAGManagerOptions);

  /**
   * 初始化 RAG 管理器
   */
  initialize(): Promise<void>;

  /**
   * 构建向量索引
   */
  buildVectorIndex(): Promise<void>;

  /**
   * 检索相关文档
   */
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult[]>;

  /**
   * 向量搜索
   */
  vectorSearch(query: string, topK?: number): Promise<RetrievalResult[]>;

  /**
   * 关键词搜索
   */
  keywordSearch(query: string, topK?: number): Promise<RetrievalResult[]>;

  /**
   * 查询增强
   */
  enhanceQuery(query: string, options?: QueryEnhancementOptions): Promise<string>;

  /**
   * 添加文档到索引
   */
  addToIndex(item: RAGDocument | Partial<RAGDocument>): Promise<string>;

  /**
   * 从索引中移除文档
   */
  removeFromIndex(itemId: string): Promise<void>;

  /**
   * 更新索引中的文档
   */
  updateIndex(item: RAGDocument): Promise<void>;

  /**
   * 重建索引
   */
  rebuildIndex(): Promise<void>;

  /**
   * 获取索引统计
   */
  getIndexStats(): Promise<IndexStats>;

  /**
   * 添加文档
   */
  addDocument(doc: RAGDocument | Partial<RAGDocument>): Promise<string>;

  /**
   * 获取文档
   */
  getDocument(id: string): Promise<RAGDocument | null>;

  /**
   * 删除文档
   */
  deleteDocument(id: string): Promise<void>;

  /**
   * 搜索
   */
  search(query: string, options?: RetrieveOptions): Promise<RetrievalResult[]>;

  /**
   * 重排序
   */
  rerank(query: string, documents: RAGDocument[], options?: RerankOptions): Promise<RerankResult[]>;

  /**
   * 获取嵌入向量
   */
  getEmbedding(text: string): Promise<Embedding>;

  /**
   * 批量获取嵌入向量
   */
  getEmbeddings(texts: string[]): Promise<Embedding[]>;

  /**
   * 清除缓存
   */
  clearCache(): void;

  /**
   * 关闭连接
   */
  close(): Promise<void>;

  // ==================== 事件 ====================

  on(event: 'document-added', listener: (id: string) => void): this;
  on(event: 'document-updated', listener: (id: string) => void): this;
  on(event: 'document-deleted', listener: (id: string) => void): this;
  on(event: 'index-rebuilt', listener: (stats: IndexStats) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== HybridSearchEngine 类 ====================

/**
 * 混合搜索引擎类
 */
export declare class HybridSearchEngine extends EventEmitter {
  /** RAG 管理器 */
  ragManager: RAGManager;
  /** BM25 搜索引擎 */
  bm25Engine: BM25Search;
  /** 配置 */
  config: HybridSearchConfig;

  /**
   * 构造函数
   */
  constructor(ragManager: RAGManager, config?: HybridSearchConfig);

  /**
   * 索引文档
   */
  indexDocuments(documents: RAGDocument[]): Promise<void>;

  /**
   * 混合搜索
   */
  search(query: string, options?: HybridSearchOptions): Promise<RetrievalResult[]>;

  /**
   * 向量搜索
   */
  vectorSearch(query: string, limit: number): Promise<RetrievalResult[]>;

  /**
   * BM25 搜索
   */
  bm25Search(query: string, limit: number): Promise<BM25Result[]>;

  /**
   * RRF 融合
   */
  rrfFusion(
    vectorResults: RetrievalResult[],
    bm25Results: BM25Result[],
    k?: number
  ): RetrievalResult[];

  /**
   * 清除索引
   */
  clearIndex(): void;
}

// ==================== BM25Search 类 ====================

/**
 * BM25 搜索引擎类
 */
export declare class BM25Search {
  /** 配置参数 */
  config: BM25IndexConfig;
  /** 文档索引 */
  documents: Map<string, RAGDocument>;
  /** 倒排索引 */
  invertedIndex: Map<string, Map<string, number>>;
  /** 文档长度 */
  docLengths: Map<string, number>;
  /** 平均文档长度 */
  avgDocLength: number;

  /**
   * 构造函数
   */
  constructor(config?: BM25IndexConfig);

  /**
   * 添加文档
   */
  addDocument(doc: RAGDocument): void;

  /**
   * 批量添加文档
   */
  addDocuments(docs: RAGDocument[]): void;

  /**
   * 移除文档
   */
  removeDocument(id: string): void;

  /**
   * 搜索
   */
  search(query: string, topK?: number): BM25Result[];

  /**
   * 计算 BM25 分数
   */
  calculateScore(query: string, docId: string): number;

  /**
   * 分词
   */
  tokenize(text: string): string[];

  /**
   * 清除索引
   */
  clear(): void;

  /**
   * 获取统计信息
   */
  getStats(): {
    totalDocuments: number;
    totalTerms: number;
    avgDocLength: number;
  };
}

// ==================== 导出函数 ====================

/**
 * 获取 RAG 管理器实例（单例模式）
 */
export function getRAGManager(options?: RAGManagerOptions): RAGManager;

/**
 * 创建新的 RAG 管理器实例
 */
export function createRAGManager(options?: RAGManagerOptions): RAGManager;

/**
 * 创建混合搜索引擎
 */
export function createHybridSearchEngine(
  ragManager: RAGManager,
  config?: HybridSearchConfig
): HybridSearchEngine;

/**
 * 创建 BM25 搜索引擎
 */
export function createBM25Search(config?: BM25IndexConfig): BM25Search;
