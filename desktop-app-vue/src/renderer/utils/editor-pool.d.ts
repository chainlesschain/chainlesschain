/**
 * Editor Pool 类型定义
 */

/**
 * 编辑器选项
 */
export interface EditorOptions {
  type?: 'monaco' | 'milkdown' | string;
  value?: string;
  language?: string;
  theme?: string;
  minimap?: boolean;
  fontSize?: number;
  lineNumbers?: boolean | 'on' | 'off';
  readOnly?: boolean;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  editorOptions?: Record<string, any>;
}

/**
 * 编辑器池选项
 */
export interface EditorPoolOptions {
  maxPoolSize?: number;
  editorType?: string;
  editorFactory?: EditorFactory;
}

/**
 * 编辑器工厂函数
 */
export type EditorFactory = (
  containerId: string,
  options: EditorOptions
) => Promise<any>;

/**
 * 编辑器池统计
 */
export interface EditorPoolStats {
  created: number;
  reused: number;
  destroyed: number;
  hits: number;
  misses: number;
  poolSize: number;
  activeCount: number;
  hitRate: number;
}

/**
 * 编辑器池管理器
 */
export interface EditorPoolManager {
  /**
   * 获取或创建指定类型的编辑器池
   */
  getPool(type: string): EditorPool;

  /**
   * 从适当的池中获取编辑器
   */
  acquire(containerId: string, options: EditorOptions): Promise<any>;

  /**
   * 将编辑器释放回池
   */
  release(containerId: string, type: string): boolean;

  /**
   * 清除所有池
   */
  clearAll(): void;

  /**
   * 修剪所有池
   */
  pruneAll(maxAge?: number): void;

  /**
   * 获取所有池的统计信息
   */
  getAllStats(): Record<string, EditorPoolStats>;

  /**
   * 调整所有活动编辑器的大小
   */
  resizeAll(): void;

  /**
   * 设置所有活动编辑器的主题
   */
  setTheme(theme: string): void;
}

/**
 * Monaco 命名空间
 */
export interface MonacoNamespace {
  editor: {
    create: (container: HTMLElement, options: any) => any;
  };
}

/**
 * 编辑器池类
 */
declare class EditorPool {
  constructor(options?: EditorPoolOptions);

  /**
   * 获取编辑器实例
   */
  acquire(containerId: string, options?: EditorOptions): Promise<any>;

  /**
   * 释放编辑器实例到池
   */
  release(containerId: string): boolean;

  /**
   * 从池中获取编辑器
   */
  getFromPool(options: EditorOptions): any | null;

  /**
   * 检查编辑器选项是否兼容
   */
  isCompatible(poolOptions: EditorOptions, requestOptions: EditorOptions): boolean;

  /**
   * 创建新编辑器实例
   */
  createEditor(containerId: string, options: EditorOptions): Promise<any>;

  /**
   * 清理编辑器状态
   */
  cleanEditor(editor: any, options: EditorOptions): void;

  /**
   * 销毁编辑器实例
   */
  destroyEditor(editor: any, options: EditorOptions): void;

  /**
   * 清空池并销毁所有编辑器
   */
  clear(): void;

  /**
   * 修剪池中的旧编辑器
   */
  prune(maxAge?: number): void;

  /**
   * 获取池统计
   */
  getStats(): EditorPoolStats;

  /**
   * 获取活动编辑器
   */
  getActive(containerId: string): any | null;

  /**
   * 检查编辑器是否活动
   */
  isActive(containerId: string): boolean;

  /**
   * 调整所有活动编辑器的大小
   */
  resizeAll(): void;

  /**
   * 设置所有活动编辑器的主题
   */
  setTheme(theme: string): void;
}

/**
 * 创建 Monaco 编辑器工厂
 */
export function createMonacoEditorFactory(monaco: MonacoNamespace): EditorFactory;

/**
 * 创建 Milkdown 编辑器工厂
 */
export function createMilkdownEditorFactory(): EditorFactory;

/**
 * 创建编辑器池管理器
 */
export function createEditorPoolManager(options?: EditorPoolOptions): EditorPoolManager;

export { EditorPool };
export default EditorPool;
