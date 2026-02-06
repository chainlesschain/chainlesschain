/**
 * 渲染进程 TypeScript 类型定义入口
 *
 * @description 导出所有公共类型定义
 */

// 重新导出所有类型
export * from './electron.d';
export * from './ipc.d';
export * from './stores.d';
export * from './components.d';
export * from './api.d';

// 重新导出多媒体类型
export * from './multimedia';

// ==================== 通用工具类型 ====================

/**
 * 深度只读类型
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * 深度部分类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 提取 Promise 返回类型
 */
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

/**
 * 函数参数类型
 */
export type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never;

/**
 * 函数返回类型
 */
export type FunctionReturn<T> = T extends (...args: any[]) => infer R ? R : never;

/**
 * 可空类型
 */
export type Nullable<T> = T | null;

/**
 * 可选类型
 */
export type Optional<T> = T | undefined;

/**
 * 可空可选类型
 */
export type Maybe<T> = T | null | undefined;

/**
 * 异步函数类型
 */
export type AsyncFunction<T = any> = (...args: any[]) => Promise<T>;

/**
 * 回调函数类型
 */
export type Callback<T = void> = (error: Error | null, result?: T) => void;

/**
 * 事件处理器类型
 */
export type EventHandler<T = Event> = (event: T) => void;

/**
 * 键值对类型
 */
export type KeyValuePair<K extends string | number | symbol = string, V = any> = {
  [key in K]: V;
};

/**
 * 记录类型别名
 */
export type Dict<T = any> = Record<string, T>;

/**
 * 排除空值
 */
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

/**
 * 选择部分字段
 */
export type PickPartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * 选择必填字段
 */
export type PickRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
