/**
 * 实用组合式函数集合
 * 提供常用的功能封装，简化组件开发
 */

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import { handleError } from './errorHandler';
import { useLoading, withLoading } from './loadingManager';

/**
 * 使用异步数据
 * 自动处理加载状态、错误和数据获取
 */
export function useAsyncData(key, fetchFn, options = {}) {
  const {
    immediate = true,
    initialData = null,
    onSuccess = null,
    onError = null,
    transform = null,
  } = options;

  const data = ref(initialData);
  const error = ref(null);
  const { isLoading, start, finish, fail } = useLoading(key);

  const execute = async (...args) => {
    try {
      start();
      error.value = null;

      const result = await fetchFn(...args);
      const transformedData = transform ? transform(result) : result;

      data.value = transformedData;
      finish(transformedData);

      if (onSuccess) {
        onSuccess(transformedData);
      }

      return transformedData;
    } catch (err) {
      error.value = err;
      fail(err);

      if (onError) {
        onError(err);
      } else {
        handleError(err, {
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
export function useDebounce(fn, delay = 300) {
  let timeoutId = null;

  const debouncedFn = (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };

  const cancel = () => {
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
export function useThrottle(fn, interval = 1000) {
  let lastCallTime = 0;
  let timeoutId = null;

  const throttledFn = (...args) => {
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

  const cancel = () => {
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
export function useClipboard() {
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制到剪贴板');
      return true;
    } catch (error) {
      handleError(error, {
        showMessage: true,
        context: { function: 'useClipboard.copy' },
      });
      return false;
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (error) {
      handleError(error, {
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
export function useLocalStorage(key, defaultValue = null) {
  const data = ref(defaultValue);

  // 从 localStorage 加载
  const load = () => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        data.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error('[useLocalStorage] Load error:', error);
      data.value = defaultValue;
    }
  };

  // 保存到 localStorage
  const save = (value) => {
    try {
      data.value = value;
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('[useLocalStorage] Save error:', error);
      handleError(error, {
        showMessage: false,
        logToFile: true,
        context: { function: 'useLocalStorage.save', key },
      });
    }
  };

  // 删除
  const remove = () => {
    try {
      data.value = defaultValue;
      localStorage.removeItem(key);
    } catch (error) {
      console.error('[useLocalStorage] Remove error:', error);
    }
  };

  // 初始化时加载
  load();

  // 监听变化自动保存
  watch(data, (newValue) => {
    try {
      localStorage.setItem(key, JSON.stringify(newValue));
    } catch (error) {
      console.error('[useLocalStorage] Auto-save error:', error);
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
export function useConfirm() {
  const { Modal } = require('ant-design-vue');

  const confirm = (options = {}) => {
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
            handleError(error);
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
export function usePolling(fn, interval = 5000, options = {}) {
  const {
    immediate = true,
    onError = null,
  } = options;

  const isPolling = ref(false);
  let intervalId = null;

  const start = () => {
    if (isPolling.value) {return;}

    isPolling.value = true;

    const poll = async () => {
      try {
        await fn();
      } catch (error) {
        if (onError) {
          onError(error);
        } else {
          console.error('[usePolling] Error:', error);
        }
      }
    };

    if (immediate) {
      poll();
    }

    intervalId = setInterval(poll, interval);
  };

  const stop = () => {
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
export function useOnline() {
  const isOnline = ref(navigator.onLine);

  const updateOnlineStatus = () => {
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
export function useWindowSize() {
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);

  const updateSize = () => {
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
export function useDownload() {
  const download = (data, filename, mimeType = 'text/plain') => {
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
      handleError(error, {
        showMessage: true,
        context: { function: 'useDownload', filename },
      });
      return false;
    }
  };

  const downloadUrl = (url, filename) => {
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
      handleError(error, {
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
export function useFormValidation(rules) {
  const errors = ref({});
  const isValid = computed(() => Object.keys(errors.value).length === 0);

  const validate = (data) => {
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
            errors.value[field] = result || rule.message || `${field} 验证失败`;
            break;
          }
        }
      }
    }

    return isValid.value;
  };

  const clearErrors = () => {
    errors.value = {};
  };

  const setError = (field, message) => {
    errors.value[field] = message;
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
