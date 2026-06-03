/**
 * 加载状态管理工具
 * 提供统一的加载状态管理和用户反馈
 */

import { message } from 'ant-design-vue';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== 类型定义 ====================

/**
 * 加载状态选项
 */
export interface LoadingOptions {
  message?: string;
  successMessage?: string | null;
  errorMessage?: string;
  showSuccess?: boolean;
  showError?: boolean;
  onProgress?: ((progress: number) => void) | null;
}

/**
 * 异步数据选项
 */
export interface AsyncDataOptions<T> {
  immediate?: boolean;
  message?: string;
  onSuccess?: ((result: T) => void) | null;
  onError?: ((error: Error) => void) | null;
}

/**
 * 批量操作结果
 */
export interface BatchResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
}

/**
 * 加载状态返回类型
 */
export interface LoadingReturn {
  isLoading: ComputedRef<boolean>;
  progress: ComputedRef<number>;
  error: ComputedRef<Error | null>;
  data: ComputedRef<any>;
  start: (msg?: string) => void;
  finish: (data?: any) => void;
  fail: (error: Error) => void;
  updateProgress: (progress: number) => void;
  reset: () => void;
}

/**
 * 异步数据返回类型
 */
export interface AsyncDataReturn<T> extends LoadingReturn {
  execute: (...args: any[]) => Promise<T>;
  refresh: (...args: any[]) => Promise<T>;
}

// ==================== 类实现 ====================

/**
 * 加载状态类
 */
class LoadingState {
  key: string;
  message: string;
  isLoading: Ref<boolean>;
  progress: Ref<number>;
  error: Ref<Error | null>;
  data: Ref<any>;

  constructor(key: string, message: string = '加载中...') {
    this.key = key;
    this.message = message;
    this.isLoading = ref(false);
    this.progress = ref(0);
    this.error = ref(null);
    this.data = ref(null);
  }

  /**
   * 开始加载
   */
  start(message: string | null = null): void {
    this.isLoading.value = true;
    this.progress.value = 0;
    this.error.value = null;
    if (message) {
      this.message = message;
    }
  }

  /**
   * 更新进度
   */
  updateProgress(progress: number): void {
    this.progress.value = Math.min(100, Math.max(0, progress));
  }

  /**
   * 完成加载
   */
  finish(data: any = null): void {
    this.isLoading.value = false;
    this.progress.value = 100;
    this.data.value = data;
  }

  /**
   * 加载失败
   */
  fail(error: Error): void {
    this.isLoading.value = false;
    this.error.value = error;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.isLoading.value = false;
    this.progress.value = 0;
    this.error.value = null;
    this.data.value = null;
  }
}

/**
 * 加载状态管理器
 */
class LoadingManager {
  private states: Map<string, LoadingState>;

  constructor() {
    this.states = new Map();
  }

  /**
   * 创建或获取加载状态
   */
  getState(key: string, loadingMessage: string = '加载中...'): LoadingState {
    if (!this.states.has(key)) {
      this.states.set(key, new LoadingState(key, loadingMessage));
    }
    return this.states.get(key)!;
  }

  /**
   * 开始加载
   */
  start(key: string, loadingMessage: string = '加载中...'): LoadingState {
    const state = this.getState(key, loadingMessage);
    state.start(loadingMessage);
    return state;
  }

  /**
   * 完成加载
   */
  finish(key: string, data: any = null): void {
    const state = this.getState(key);
    state.finish(data);
  }

  /**
   * 加载失败
   */
  fail(key: string, error: Error): void {
    const state = this.getState(key);
    state.fail(error);
  }

  /**
   * 更新进度
   */
  updateProgress(key: string, progress: number): void {
    const state = this.getState(key);
    state.updateProgress(progress);
  }

  /**
   * 检查是否正在加载
   */
  isLoading(key: string): boolean {
    const state = this.states.get(key);
    return state ? state.isLoading.value : false;
  }

  /**
   * 重置状态
   */
  reset(key: string): void {
    const state = this.states.get(key);
    if (state) {
      state.reset();
    }
  }

  /**
   * 清除所有状态
   */
  clear(): void {
    this.states.clear();
  }
}

// 创建全局加载管理器实例
const loadingManager = new LoadingManager();

// ==================== 组合式函数 ====================

/**
 * 组合式函数：使用加载状态
 */
export function useLoading(key: string, loadingMessage: string = '加载中...'): LoadingReturn {
  const state = loadingManager.getState(key, loadingMessage);

  return {
    isLoading: computed(() => state.isLoading.value),
    progress: computed(() => state.progress.value),
    error: computed(() => state.error.value),
    data: computed(() => state.data.value),
    start: (msg?: string) => state.start(msg || null),
    finish: (data?: any) => state.finish(data),
    fail: (error: Error) => state.fail(error),
    updateProgress: (progress: number) => state.updateProgress(progress),
    reset: () => state.reset(),
  };
}

/**
 * 异步操作包装器
 * 自动管理加载状态
 */
export async function withLoading<T>(
  key: string,
  fn: (updateProgress: (progress: number) => void) => Promise<T>,
  options: LoadingOptions = {}
): Promise<T> {
  const {
    message: loadingMessage = '加载中...',
    successMessage = null,
    errorMessage = '操作失败',
    showSuccess = false,
    showError = true,
    onProgress = null,
  } = options;

  const state = loadingManager.start(key, loadingMessage);

  try {
    // 如果提供了进度回调，传递给函数
    const result = await fn((progress: number) => {
      state.updateProgress(progress);
      if (onProgress) {
        onProgress(progress);
      }
    });

    state.finish(result);

    if (showSuccess && successMessage) {
      message.success(successMessage);
    }

    return result;
  } catch (error) {
    state.fail(error as Error);

    if (showError) {
      message.error(errorMessage);
    }

    throw error;
  }
}

/**
 * 批量加载包装器
 * 管理多个并发加载操作
 */
export async function withBatchLoading<T>(
  operations: Array<() => Promise<T>>,
  options: LoadingOptions = {}
): Promise<BatchResult<T>[]> {
  const {
    message: loadingMessage = '批量加载中...',
    successMessage = '批量操作完成',
    errorMessage = '部分操作失败',
    showSuccess = true,
    showError = true,
  } = options;

  const batchKey = `batch-${Date.now()}`;
  const state = loadingManager.start(batchKey, loadingMessage);

  const results: BatchResult<T>[] = [];
  const errors: Error[] = [];

  try {
    const total = operations.length;
    let completed = 0;

    for (const operation of operations) {
      try {
        const result = await operation();
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, error: error as Error });
        errors.push(error as Error);
      }

      completed++;
      state.updateProgress((completed / total) * 100);
    }

    state.finish(results);

    if (errors.length === 0) {
      if (showSuccess) {
        message.success(successMessage);
      }
    } else if (errors.length < total) {
      if (showError) {
        message.warning(`${errorMessage}: ${errors.length}/${total} 失败`);
      }
    } else {
      if (showError) {
        message.error('所有操作都失败了');
      }
    }

    return results;
  } catch (error) {
    state.fail(error as Error);
    if (showError) {
      message.error(errorMessage);
    }
    throw error;
  }
}

/**
 * 防抖加载包装器
 * 防止重复触发加载
 */
export function withDebounceLoading<T, Args extends any[]>(
  key: string,
  fn: (...args: Args) => Promise<T>,
  delay: number = 300
): (...args: Args) => Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return async function (this: any, ...args: Args): Promise<T | undefined> {
    // 如果已经在加载，忽略
    if (loadingManager.isLoading(key)) {
      return undefined;
    }

    // 清除之前的定时器
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // 设置新的定时器
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          const result = await withLoading<T>(key, () => fn.apply(this, args));
          resolve(result as T);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  };
}

/**
 * 节流加载包装器
 * 限制加载频率
 */
export function withThrottleLoading<T, Args extends any[]>(
  key: string,
  fn: (...args: Args) => Promise<T>,
  interval: number = 1000
): (...args: Args) => Promise<T | undefined> {
  let lastCallTime = 0;

  return async function (this: any, ...args: Args): Promise<T | undefined> {
    const now = Date.now();

    // 如果距离上次调用时间不足间隔，忽略
    if (now - lastCallTime < interval) {
      return undefined;
    }

    // 如果已经在加载，忽略
    if (loadingManager.isLoading(key)) {
      return undefined;
    }

    lastCallTime = now;

    return withLoading(key, () => fn.apply(this, args));
  };
}

/**
 * 组合式函数：使用异步数据
 * 结合加载状态和数据获取
 */
export function useAsyncData<T>(
  key: string,
  fetchFn: (...args: any[]) => Promise<T>,
  options: AsyncDataOptions<T> = {}
): AsyncDataReturn<T> {
  const {
    immediate = true,
    message: loadingMessage = '加载中...',
    onSuccess = null,
    onError = null,
  } = options;

  const loading = useLoading(key, loadingMessage);

  const execute = async (...args: any[]): Promise<T> => {
    try {
      loading.start();
      const result = await fetchFn(...args);
      loading.finish(result);

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (error) {
      loading.fail(error as Error);

      if (onError) {
        onError(error as Error);
      }

      throw error;
    }
  };

  // 立即执行
  if (immediate) {
    execute();
  }

  return {
    ...loading,
    execute,
    refresh: execute,
  };
}

// 导出加载管理器实例
export default loadingManager;
