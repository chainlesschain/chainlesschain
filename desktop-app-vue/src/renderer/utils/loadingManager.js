/**
 * 加载状态管理工具
 * 提供统一的加载状态管理和用户反馈
 */

import { message } from 'ant-design-vue';
import { ref, computed } from 'vue';

/**
 * 加载状态类
 */
class LoadingState {
  constructor(key, message = '加载中...') {
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
  start(message = null) {
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
  updateProgress(progress) {
    this.progress.value = Math.min(100, Math.max(0, progress));
  }

  /**
   * 完成加载
   */
  finish(data = null) {
    this.isLoading.value = false;
    this.progress.value = 100;
    this.data.value = data;
  }

  /**
   * 加载失败
   */
  fail(error) {
    this.isLoading.value = false;
    this.error.value = error;
  }

  /**
   * 重置状态
   */
  reset() {
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
  constructor() {
    this.states = new Map();
  }

  /**
   * 创建或获取加载状态
   */
  getState(key, message = '加载中...') {
    if (!this.states.has(key)) {
      this.states.set(key, new LoadingState(key, message));
    }
    return this.states.get(key);
  }

  /**
   * 开始加载
   */
  start(key, message = '加载中...') {
    const state = this.getState(key, message);
    state.start(message);
    return state;
  }

  /**
   * 完成加载
   */
  finish(key, data = null) {
    const state = this.getState(key);
    state.finish(data);
  }

  /**
   * 加载失败
   */
  fail(key, error) {
    const state = this.getState(key);
    state.fail(error);
  }

  /**
   * 更新进度
   */
  updateProgress(key, progress) {
    const state = this.getState(key);
    state.updateProgress(progress);
  }

  /**
   * 检查是否正在加载
   */
  isLoading(key) {
    const state = this.states.get(key);
    return state ? state.isLoading.value : false;
  }

  /**
   * 重置状态
   */
  reset(key) {
    const state = this.states.get(key);
    if (state) {
      state.reset();
    }
  }

  /**
   * 清除所有状态
   */
  clear() {
    this.states.clear();
  }
}

// 创建全局加载管理器实例
const loadingManager = new LoadingManager();

/**
 * 组合式函数：使用加载状态
 */
export function useLoading(key, message = '加载中...') {
  const state = loadingManager.getState(key, message);

  return {
    isLoading: computed(() => state.isLoading.value),
    progress: computed(() => state.progress.value),
    error: computed(() => state.error.value),
    data: computed(() => state.data.value),
    start: (msg) => state.start(msg),
    finish: (data) => state.finish(data),
    fail: (error) => state.fail(error),
    updateProgress: (progress) => state.updateProgress(progress),
    reset: () => state.reset(),
  };
}

/**
 * 异步操作包装器
 * 自动管理加载状态
 */
export async function withLoading(key, fn, options = {}) {
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
    const result = await fn((progress) => {
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
    state.fail(error);

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
export async function withBatchLoading(operations, options = ) {
  const {
    message: loadingMessage = '批量加载中...',
    successMessage = '批量操作完成',
    errorMessage = '部分操作失败',
    showSuccess = true,
    showError = true,
  } = options;

  const batchKey = `batch-${Date.now()}`;
  const state = loadingManager.start(batchKey, loadingMessage);

  const results = [];
  const errors = [];

  try {
    const total = operations.length;
    let completed = 0;

    for (const operation of operations) {
      try {
        const result = await operation();
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, error });
        errors.push(error);
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
    state.fail(error);
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
export function withDebounceLoading(key, fn, delay = 300) {
  let timeoutId = null;

  return async function(...args) {
    // 如果已经在加载，忽略
    if (loadingManager.isLoading(key)) {
      return;
    }

    // 清除之前的定时器
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // 设置新的定时器
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          const result = await withLoading(key, () => fn.apply(this, args));
          resolve(result);
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
export function withThrottleLoading(key, fn, interval = 1000) {
  let lastCallTime = 0;

  return async function(...args) {
    const now = Date.now();

    // 如果距离上次调用时间不足间隔，忽略
    if (now - lastCallTime < interval) {
      return;
    }

    // 如果已经在加载，忽略
    if (loadingManager.isLoading(key)) {
      return;
    }

    lastCallTime = now;

    return withLoading(key, () => fn.apply(this, args));
  };
}

/**
 * 组合式函数：使用异步数据
 * 结合加载状态和数据获取
 */
export function useAsyncData(key, fetchFn, options = {}) {
  const {
    immediate = true,
    message = '加载中...',
    onSuccess = null,
    onError = null,
  } = options;

  const loading = useLoading(key, message);

  const execute = async (...args) => {
    try {
      loading.start();
      const result = await fetchFn(...args);
      loading.finish(result);

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (error) {
      loading.fail(error);

      if (onError) {
        onError(error);
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
