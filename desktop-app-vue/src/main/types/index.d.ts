/**
 * ChainlessChain Main Process Type Definitions
 *
 * @module types
 * @description 主进程模块类型声明统一导出
 */

// ==================== 数据库模块 ====================

export * from './database';

// ==================== 会话管理模块 ====================

export * from './session-manager';

// ==================== RAG 系统模块 ====================

export * from './rag';

// ==================== 权限系统模块 ====================

export * from './permission';

// ==================== 浏览器自动化模块 ====================

export * from './browser';

// ==================== 上下文工程模块 ====================

export * from './context-engineering';

// ==================== 永久记忆系统模块 ====================

export * from './memory';

// ==================== AI 引擎模块 ====================

export * from './ai-engine';

// ==================== Hooks 系统模块 ====================

export * from '../hooks/types';

// ==================== 通用类型 ====================

/**
 * 回调函数类型
 */
export type Callback<T = any> = (error: Error | null, result?: T) => void;

/**
 * 异步回调函数类型
 */
export type AsyncCallback<T = any> = (error: Error | null, result?: T) => Promise<void>;

/**
 * 事件监听器类型
 */
export type EventListener<T = any> = (...args: T[]) => void;

/**
 * 中间件函数类型
 */
export type Middleware<T = any> = (
  context: T,
  next: () => Promise<void>
) => Promise<void>;

/**
 * 过滤器函数类型
 */
export type FilterFunction<T = any> = (item: T) => boolean;

/**
 * 映射函数类型
 */
export type MapFunction<T = any, U = any> = (item: T) => U;

/**
 * 归约函数类型
 */
export type ReduceFunction<T = any, U = any> = (accumulator: U, item: T) => U;

/**
 * 比较函数类型
 */
export type CompareFunction<T = any> = (a: T, b: T) => number;

/**
 * 验证器函数类型
 */
export type ValidatorFunction<T = any> = (value: T) => boolean | string;

// ==================== 通用接口 ====================

/**
 * 分页参数
 */
export interface PaginationParams {
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 跳过数量 */
  offset?: number;
  /** 限制数量 */
  limit?: number;
}

/**
 * 分页结果
 */
export interface PaginatedResult<T = any> {
  /** 数据列表 */
  items: T[];
  /** 总数量 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
  /** 是否有下一页 */
  hasNext: boolean;
  /** 是否有上一页 */
  hasPrev: boolean;
}

/**
 * 排序参数
 */
export interface SortParams {
  /** 排序字段 */
  field: string;
  /** 排序方向 */
  order: 'asc' | 'desc';
}

/**
 * 筛选参数
 */
export interface FilterParams {
  /** 筛选字段 */
  field: string;
  /** 操作符 */
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'regex';
  /** 筛选值 */
  value: any;
}

/**
 * 查询参数
 */
export interface QueryParams extends PaginationParams {
  /** 排序 */
  sort?: SortParams[];
  /** 筛选 */
  filter?: FilterParams[];
  /** 搜索关键词 */
  search?: string;
}

/**
 * 批量操作结果
 */
export interface BatchOperationResult<T = any> {
  /** 成功的项 */
  succeeded: T[];
  /** 失败的项 */
  failed: Array<{ item: T; error: string }>;
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failedCount: number;
  /** 总数量 */
  totalCount: number;
}

/**
 * 操作进度
 */
export interface OperationProgress {
  /** 当前进度 (0-100) */
  percent: number;
  /** 当前步骤 */
  current: number;
  /** 总步骤数 */
  total: number;
  /** 状态消息 */
  message?: string;
  /** 是否完成 */
  completed: boolean;
}

/**
 * 时间范围
 */
export interface TimeRange {
  /** 开始时间 */
  start: string | number | Date;
  /** 结束时间 */
  end: string | number | Date;
}

/**
 * 键值对
 */
export interface KeyValue<K = string, V = any> {
  /** 键 */
  key: K;
  /** 值 */
  value: V;
}

/**
 * 树形节点
 */
export interface TreeNode<T = any> {
  /** 节点 ID */
  id: string;
  /** 节点数据 */
  data: T;
  /** 父节点 ID */
  parentId?: string;
  /** 子节点 */
  children?: TreeNode<T>[];
}

// ==================== 配置类型 ====================

/**
 * 日志级别
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * 环境类型
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * 平台类型
 */
export type Platform = 'win32' | 'darwin' | 'linux';

// ==================== 错误类型 ====================

/**
 * 应用错误类
 */
export declare class AppError extends Error {
  /** 错误代码 */
  code: string;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 错误详情 */
  details?: any;
  /** 是否可操作 */
  isOperational: boolean;

  constructor(message: string, code: string, statusCode?: number, details?: any);
}

/**
 * 验证错误类
 */
export declare class ValidationError extends AppError {
  /** 验证错误列表 */
  errors: Array<{ field: string; message: string }>;

  constructor(errors: Array<{ field: string; message: string }>);
}

/**
 * 数据库错误类
 */
export declare class DatabaseError extends AppError {
  /** SQL 语句 */
  sql?: string;
  /** SQL 参数 */
  params?: any[];

  constructor(message: string, sql?: string, params?: any[]);
}

/**
 * 权限错误类
 */
export declare class PermissionError extends AppError {
  /** 资源类型 */
  resourceType?: string;
  /** 资源 ID */
  resourceId?: string;
  /** 所需权限 */
  requiredPermission?: string;

  constructor(message: string, details?: any);
}

// ==================== 全局声明 ====================

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: Environment;
      CHAINLESSCHAIN_DISABLE_NATIVE_DB?: string;
      CHAINLESSCHAIN_FORCE_SQLJS?: string;
      OLLAMA_HOST?: string;
      QDRANT_HOST?: string;
      DB_HOST?: string;
      DB_PORT?: string;
      DB_NAME?: string;
      REDIS_HOST?: string;
      REDIS_PORT?: string;
    }
  }
}
