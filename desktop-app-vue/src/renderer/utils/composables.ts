/**
 * 实用组合式函数集合
 * 提供常用的功能封装，简化组件开发
 */

import { logger } from '@/utils/logger';
import { ref, computed, onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { handleError } from './errorHandler';
import { useLoading, withLoading } from './loadingManager';

// ==================== 类型定义 ====================

/**
 * 异步数据选项
 */
export interface UseAsyncDataOptions<T, R = T> {
  immediate?: boolean;
  initialData?: T | null;
  onSuccess?: ((result: R) => void) | null;
  onError?: ((error: Error) => void) | null;
  transform?: ((result: T) => R) | null;
}

/**
 * 异步数据返回类型
 */
export interface UseAsyncDataReturn<T> {
  data: Ref<T | null>;
  error: Ref<Error | null>;
  isLoading: ComputedRef<boolean>;
  execute: (...args: any[]) => Promise<T>;
  refresh: (...args: any[]) => Promise<T>;
}

/**
 * 防抖返回类型
 */
export interface UseDebounceReturn<T extends (...args: any[]) => any> {
  debouncedFn: (...args: Parameters<T>) => void;
  cancel: () => void;
}

/**
 * 节流返回类型
 */
export interface UseThrottleReturn<T extends (...args: any[]) => any> {
  throttledFn: (...args: Parameters<T>) => void;
  cancel: () => void;
}

/**
 * 剪贴板返回类型
 */
export interface UseClipboardReturn {
  copy: (text: string) => Promise<boolean>;
  paste: () => Promise<string | null>;
}

/**
 * 本地存储返回类型
 */
export interface UseLocalStorageReturn<T> {
  data: Ref<T>;
  save: (value: T) => void;
  remove: () => void;
  reload: () => void;
}

/**
 * 确认对话框选项
 */
export interface ConfirmOptions {
  title?: string;
  content?: string;
  okText?: string;
  cancelText?: string;
  onOk?: (() => void | Promise<void>) | null;
  onCancel?: (() => void) | null;
}

/**
 * 确认对话框返回类型
 */
export interface UseConfirmReturn {
  confirm: (options?: ConfirmOptions) => Promise<boolean>;
}

/**
 * 轮询选项
 */
export interface UsePollingOptions {
  immediate?: boolean;
  onError?: ((error: Error) => void) | null;
}

/**
 * 轮询返回类型
 */
export interface UsePollingReturn {
  isPolling: ComputedRef<boolean>;
  start: () => void;
  stop: () => void;
}

/**
 * 在线状态返回类型
 */
export interface UseOnlineReturn {
  isOnline: ComputedRef<boolean>;
}

/**
 * 窗口尺寸返回类型
 */
export interface UseWindowSizeReturn {
  width: ComputedRef<number>;
  height: ComputedRef<number>;
  isMobile: ComputedRef<boolean>;
  isTablet: ComputedRef<boolean>;
  isDesktop: ComputedRef<boolean>;
}

/**
 * 下载返回类型
 */
export interface UseDownloadReturn {
  download: (data: BlobPart, filename: string, mimeType?: string) => boolean;
  downloadUrl: (url: string, filename?: string) => boolean;
}

/**
 * 表单验证规则
 */
export interface ValidationRule {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
  validator?: (value: any, data: Record<string, any>) => boolean | string;
}

/**
 * 表单验证规则集
 */
export interface ValidationRules {
  [field: string]: ValidationRule[];
}

/**
 * 表单验证返回类型
 */
export interface UseFormValidationReturn {
  errors: ComputedRef<Record<string, string>>;
  isValid: ComputedRef<boolean>;
  validate: (data: Record<string, any>) => boolean;
  clearErrors: () => void;
  setError: (field: string, message: string) => void;
}

// ==================== 组合式函数 ====================

/**
 * 使用异步数据
 * 自动处理加载状态、错误和数据获取
 */
export function useAsyncData<T, R = T>(
  key: string,
  fetchFn: (...args: any[]) => Promise<T>,
  options: UseAsyncDataOptions<T, R> = {}
): UseAsyncDataReturn<R> {
  const {
    immediate = true,
    initialData = null,
    onSuccess = null,
    onError = null,
    transform = null,
  } = options;

  const data = ref<R | null>(initialData as unknown as R | null) as Ref<R | null>;
  const error = ref<Error | null>(null);
  const { isLoading, start, finish, fail } = useLoading(key);

  const execute = async (...args: any[]): Promise<R> => {
    try {
      start();
      error.value = null;

      const result = await fetchFn(...args);
      const transformedData = (transform ? transform(result) : result) as R;

      data.value = transformedData;
      finish(transformedData);

      if (onSuccess) {
        onSuccess(transformedData);
      }

      return transformedData;
    } catch (err) {
      const errorObj = err as Error;
      error.value = errorObj;
      fail(errorObj);

      if (onError) {
        onError(errorObj);
      } else {
        handleError(errorObj, {
          showMessage: true,
          logToFile: true,
          context: { function: 'useAsyncData', key },
        });
      }

      throw err;
    }
  };

  if (immediate) {
    onMounted(() => execute());
  }

  return {
    data,
    error,
    isLoading: computed(() => isLoading.value),
    execute,
    refresh: execute,
  };
}

/**
 * 使用防抖
 * 延迟执行函数，避免频繁触发
 */
export function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): UseDebounceReturn<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debouncedFn = (...args: Parameters<T>): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };

  const cancel = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  onUnmounted(() => {
    cancel();
  });

  return {
    debouncedFn,
    cancel,
  };
}

/**
 * 使用节流
 * 限制函数执行频率
 */
export function useThrottle<T extends (...args: any[]) => any>(
  fn: T,
  interval: number = 1000
): UseThrottleReturn<T> {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttledFn = (...args: Parameters<T>): void => {
    const now = Date.now();

    if (now - lastCallTime >= interval) {
      lastCallTime = now;
      fn(...args);
    } else {
      // 确保最后一次调用会被执行
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        fn(...args);
      }, interval - (now - lastCallTime));
    }
  };

  const cancel = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  onUnmounted(() => {
    cancel();
  });

  return {
    throttledFn,
    cancel,
  };
}

/**
 * 使用剪贴板
 * 简化复制粘贴操作
 */
export function useClipboard(): UseClipboardReturn {
  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制到剪贴板');
      return true;
    } catch (error) {
      handleError(error as Error, {
        showMessage: true,
        context: { function: 'useClipboard.copy' },
      });
      return false;
    }
  };

  const paste = async (): Promise<string | null> => {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (error) {
      handleError(error as Error, {
        showMessage: true,
        context: { function: 'useClipboard.paste' },
      });
      return null;
    }
  };

  return {
    copy,
    paste,
  };
}

/**
 * 使用本地存储
 * 简化 localStorage 操作，支持 JSON
 */
export function useLocalStorage<T>(key: string, defaultValue: T): UseLocalStorageReturn<T> {
  const data = ref<T>(defaultValue) as Ref<T>;

  // 从 localStorage 加载
  const load = (): void => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        data.value = JSON.parse(stored);
      }
    } catch (error) {
      logger.error('[useLocalStorage] Load error:', error as any);
      data.value = defaultValue;
    }
  };

  // 保存到 localStorage
  const save = (value: T): void => {
    try {
      data.value = value;
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      logger.error('[useLocalStorage] Save error:', error as any);
      handleError(error as Error, {
        showMessage: false,
        logToFile: true,
        context: { function: 'useLocalStorage.save', key },
      });
    }
  };

  // 删除
  const remove = (): void => {
    try {
      data.value = defaultValue;
      localStorage.removeItem(key);
    } catch (error) {
      logger.error('[useLocalStorage] Remove error:', error as any);
    }
  };

  // 初始化时加载
  load();

  // 监听变化自动保存
  watch(data, (newValue) => {
    try {
      localStorage.setItem(key, JSON.stringify(newValue));
    } catch (error) {
      logger.error('[useLocalStorage] Auto-save error:', error as any);
    }
  }, { deep: true });

  return {
    data,
    save,
    remove,
    reload: load,
  };
}

/**
 * 使用确认对话框
 * 简化确认操作
 */
export function useConfirm(): UseConfirmReturn {
  const confirm = (options: ConfirmOptions = {}): Promise<boolean> => {
    const {
      title = '确认操作',
      content = '确定要执行此操作吗？',
      okText = '确定',
      cancelText = '取消',
      onOk = null,
      onCancel = null,
    } = options;

    return new Promise((resolve, reject) => {
      Modal.confirm({
        title,
        content,
        okText,
        cancelText,
        onOk: async () => {
          try {
            if (onOk) {
              await onOk();
            }
            resolve(true);
          } catch (error) {
            handleError(error as Error);
            reject(error);
          }
        },
        onCancel: () => {
          if (onCancel) {
            onCancel();
          }
          resolve(false);
        },
      });
    });
  };

  return {
    confirm,
  };
}

/**
 * 使用轮询
 * 定期执行函数
 */
export function usePolling(
  fn: () => Promise<void> | void,
  interval: number = 5000,
  options: UsePollingOptions = {}
): UsePollingReturn {
  const {
    immediate = true,
    onError = null,
  } = options;

  const isPolling = ref(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const start = (): void => {
    if (isPolling.value) { return; }

    isPolling.value = true;

    const poll = async (): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        if (onError) {
          onError(error as Error);
        } else {
          logger.error('[usePolling] Error:', error as any);
        }
      }
    };

    if (immediate) {
      poll();
    }

    intervalId = setInterval(poll, interval);
  };

  const stop = (): void => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isPolling.value = false;
  };

  onUnmounted(() => {
    stop();
  });

  return {
    isPolling: computed(() => isPolling.value),
    start,
    stop,
  };
}

/**
 * 使用在线状态
 * 监听网络连接状态
 */
export function useOnline(): UseOnlineReturn {
  const isOnline = ref(navigator.onLine);

  const updateOnlineStatus = (): void => {
    isOnline.value = navigator.onLine;
  };

  onMounted(() => {
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  });

  onUnmounted(() => {
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
  });

  return {
    isOnline: computed(() => isOnline.value),
  };
}

/**
 * 使用窗口大小
 * 响应式窗口尺寸
 */
export function useWindowSize(): UseWindowSizeReturn {
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);

  const updateSize = (): void => {
    width.value = window.innerWidth;
    height.value = window.innerHeight;
  };

  onMounted(() => {
    window.addEventListener('resize', updateSize);
  });

  onUnmounted(() => {
    window.removeEventListener('resize', updateSize);
  });

  return {
    width: computed(() => width.value),
    height: computed(() => height.value),
    isMobile: computed(() => width.value < 768),
    isTablet: computed(() => width.value >= 768 && width.value < 1024),
    isDesktop: computed(() => width.value >= 1024),
  };
}

/**
 * 使用文件下载
 * 简化文件下载操作
 */
export function useDownload(): UseDownloadReturn {
  const download = (data: BlobPart, filename: string, mimeType: string = 'text/plain'): boolean => {
    try {
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      message.success('下载成功');
      return true;
    } catch (error) {
      handleError(error as Error, {
        showMessage: true,
        context: { function: 'useDownload', filename },
      });
      return false;
    }
  };

  const downloadUrl = (url: string, filename?: string): boolean => {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      message.success('下载已开始');
      return true;
    } catch (error) {
      handleError(error as Error, {
        showMessage: true,
        context: { function: 'useDownload.downloadUrl', url },
      });
      return false;
    }
  };

  return {
    download,
    downloadUrl,
  };
}

/**
 * 使用表单验证
 * 简化表单验证逻辑
 */
export function useFormValidation(rules: ValidationRules): UseFormValidationReturn {
  const errors = ref<Record<string, string>>({});
  const isValid = computed(() => Object.keys(errors.value).length === 0);

  const validate = (data: Record<string, any>): boolean => {
    errors.value = {};

    for (const [field, fieldRules] of Object.entries(rules)) {
      const value = data[field];

      for (const rule of fieldRules) {
        if (rule.required && !value) {
          errors.value[field] = rule.message || `${field} 是必填项`;
          break;
        }

        if (rule.min && value && value.length < rule.min) {
          errors.value[field] = rule.message || `${field} 最少 ${rule.min} 个字符`;
          break;
        }

        if (rule.max && value && value.length > rule.max) {
          errors.value[field] = rule.message || `${field} 最多 ${rule.max} 个字符`;
          break;
        }

        if (rule.pattern && value && !rule.pattern.test(value)) {
          errors.value[field] = rule.message || `${field} 格式不正确`;
          break;
        }

        if (rule.validator && value) {
          const result = rule.validator(value, data);
          if (result !== true) {
            errors.value[field] = (typeof result === 'string' ? result : null) || rule.message || `${field} 验证失败`;
            break;
          }
        }
      }
    }

    return isValid.value;
  };

  const clearErrors = (): void => {
    errors.value = {};
  };

  const setError = (field: string, errorMessage: string): void => {
    errors.value[field] = errorMessage;
  };

  return {
    errors: computed(() => errors.value),
    isValid,
    validate,
    clearErrors,
    setError,
  };
}

export default {
  useAsyncData,
  useDebounce,
  useThrottle,
  useClipboard,
  useLocalStorage,
  useConfirm,
  usePolling,
  useOnline,
  useWindowSize,
  useDownload,
  useFormValidation,
};
