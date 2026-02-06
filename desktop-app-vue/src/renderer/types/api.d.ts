/**
 * API 响应类型定义
 *
 * @description 定义后端 API 响应的数据类型
 */

// ==================== 通用响应类型 ====================

/**
 * API 响应基类
 */
export interface APIResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  timestamp?: number;
}

/**
 * 成功响应
 */
export interface SuccessResponse<T = any> extends APIResponse<T> {
  code: 0;
  data: T;
}

/**
 * 错误响应
 */
export interface ErrorResponse extends APIResponse<null> {
  code: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * 分页响应
 */
export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * 列表响应
 */
export interface ListResponse<T> {
  items: T[];
  total: number;
}

// ==================== 知识库 API ====================

/**
 * 知识项
 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  type: 'note' | 'document' | 'link' | 'image' | 'file';
  tags?: string[];
  category?: string;
  projectId?: string;
  metadata?: Record<string, any>;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 知识搜索结果
 */
export interface KnowledgeSearchResult {
  item: KnowledgeItem;
  score: number;
  highlights?: string[];
}

/**
 * 知识搜索请求
 */
export interface KnowledgeSearchRequest {
  query: string;
  filters?: {
    type?: string[];
    tags?: string[];
    category?: string;
    projectId?: string;
    dateRange?: { start: string; end: string };
  };
  limit?: number;
  offset?: number;
  hybridSearch?: boolean;
}

// ==================== LLM API ====================

/**
 * 聊天请求
 */
export interface ChatRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: any[];
  ragEnabled?: boolean;
  ragOptions?: {
    topK?: number;
    threshold?: number;
    hybridSearch?: boolean;
  };
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  id: string;
  message: {
    role: 'assistant';
    content: string;
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls';
  toolCalls?: any[];
}

/**
 * 流式聊天块
 */
export interface ChatStreamChunk {
  id: string;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finishReason?: 'stop' | 'length' | 'tool_calls';
}

/**
 * LLM 模型信息
 */
export interface LLMModel {
  id: string;
  name: string;
  provider: 'ollama' | 'openai' | 'anthropic' | 'azure' | 'google';
  contextLength: number;
  capabilities: ('chat' | 'completion' | 'embedding' | 'vision')[];
  pricing?: {
    inputPerToken: number;
    outputPerToken: number;
    currency: string;
  };
}

// ==================== RAG API ====================

/**
 * 文档
 */
export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
  chunkIndex?: number;
  sourceId?: string;
}

/**
 * RAG 搜索请求
 */
export interface RAGSearchRequest {
  query: string;
  topK?: number;
  threshold?: number;
  filters?: Record<string, any>;
  hybridSearch?: boolean;
  rerank?: boolean;
}

/**
 * RAG 搜索结果
 */
export interface RAGSearchResult {
  document: Document;
  score: number;
  rerankScore?: number;
}

// ==================== P2P API ====================

/**
 * 节点信息
 */
export interface PeerInfo {
  peerId: string;
  multiaddrs: string[];
  protocols: string[];
  isConnected: boolean;
  latency?: number;
  lastSeen?: string;
}

/**
 * P2P 消息
 */
export interface P2PMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  encrypted: boolean;
  timestamp: number;
  signature?: string;
}

// ==================== DID API ====================

/**
 * DID 文档
 */
export interface DIDDocument {
  '@context': string[];
  id: string;
  controller?: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
    publicKeyJwk?: Record<string, any>;
  }>;
  authentication?: string[];
  assertionMethod?: string[];
  keyAgreement?: string[];
  capabilityInvocation?: string[];
  capabilityDelegation?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  created?: string;
  updated?: string;
}

/**
 * DID 解析结果
 */
export interface DIDResolutionResult {
  didDocument: DIDDocument;
  didDocumentMetadata: Record<string, any>;
  didResolutionMetadata: Record<string, any>;
}

// ==================== MCP API ====================

/**
 * MCP 服务器信息
 */
export interface MCPServer {
  id: string;
  name: string;
  version: string;
  description?: string;
  status: 'connected' | 'disconnected' | 'error';
  capabilities: {
    tools?: boolean;
    prompts?: boolean;
    resources?: boolean;
  };
  tools?: MCPTool[];
}

/**
 * MCP 工具
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

/**
 * MCP 工具调用请求
 */
export interface MCPToolCallRequest {
  serverId: string;
  toolName: string;
  params: Record<string, any>;
}

/**
 * MCP 工具调用响应
 */
export interface MCPToolCallResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ==================== 多媒体 API ====================

/**
 * 图片上传响应
 */
export interface ImageUploadResponse {
  id: string;
  path: string;
  thumbnailPath?: string;
  width: number;
  height: number;
  size: number;
  format: string;
  ocrResult?: {
    text: string;
    confidence: number;
    blocks?: any[];
  };
}

/**
 * 音频转录响应
 */
export interface AudioTranscribeResponse {
  text: string;
  language: string;
  duration: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

/**
 * 视频信息响应
 */
export interface VideoInfoResponse {
  format: string;
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  codec: string;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
}

// ==================== 会话 API ====================

/**
 * 会话元数据
 */
export interface SessionMetadata {
  title?: string;
  tags?: string[];
  summary?: string;
  tokenCount?: number;
  compressed?: boolean;
  lastModel?: string;
}

/**
 * 会话压缩结果
 */
export interface SessionCompressResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  summary: string;
}

// ==================== 记忆 API ====================

/**
 * 每日笔记
 */
export interface DailyNote {
  date: string;
  content: string;
  highlights?: string[];
  decisions?: string[];
  questions?: string[];
  metadata?: Record<string, any>;
}

/**
 * 记忆搜索结果
 */
export interface MemorySearchResult {
  type: 'daily' | 'insight' | 'memory';
  content: string;
  date: string;
  score: number;
  highlights?: string[];
}

// ==================== 错误类型 ====================

/**
 * API 错误
 */
export interface APIError extends Error {
  code: string;
  status?: number;
  details?: Record<string, any>;
}

/**
 * 验证错误
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * 验证错误响应
 */
export interface ValidationErrorResponse extends ErrorResponse {
  errors: ValidationError[];
}
