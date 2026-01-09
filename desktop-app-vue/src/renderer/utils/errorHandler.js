/**
 * 统一错误处理工具
 * 提供一致的错误处理、日志记录和用户反馈
 */

import { message, notification } from 'ant-design-vue';

/**
 * 错误类型枚举
 */
export const ErrorType = {
  NETWORK: 'network',
  DATABASE: 'database',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  NOT_FOUND: 'not_found',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
};

/**
 * 错误级别
 */
export const ErrorLevel = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

/**
 * 错误消息映射
 */
const ERROR_MESSAGES = {
  [ErrorType.NETWORK]: '网络连接失败，请检查网络设置',
  [ErrorType.DATABASE]: '数据库操作失败，请稍后重试',
  [ErrorType.VALIDATION]: '输入数据验证失败',
  [ErrorType.PERMISSION]: '权限不足，无法执行此操作',
  [ErrorType.NOT_FOUND]: '请求的资源不存在',
  [ErrorType.TIMEOUT]: '操作超时，请稍后重试',
  [ErrorType.UNKNOWN]: '发生未知错误，请联系技术支持',
};

/**
 * 应用错误类
 */
export class AppError extends Error {
  constructor(message, type = ErrorType.UNKNOWN, level = ErrorLevel.ERROR, details = null) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.level = level;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      level: this.level,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * 错误处理器类
 */
class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
    this.listeners = [];
  }

  /**
   * 处理错误
   * @param {Error|AppError} error - 错误对象
   * @param {Object} options - 处理选项
   */
  handle(error, options = {}) {
    const {
      showMessage = true,
      showNotification = false,
      logToConsole = true,
      logToFile = false,
      context = null,
    } = options;

    // 标准化错误对象
    const appError = this.normalizeError(error, context);

    // 记录错误
    this.logError(appError, logToConsole, logToFile);

    // 显示用户反馈
    if (showMessage) {
      this.showErrorMessage(appError);
    }

    if (showNotification) {
      this.showErrorNotification(appError);
    }

    // 触发监听器
    this.notifyListeners(appError);

    return appError;
  }

  /**
   * 标准化错误对象
   */
  normalizeError(error, context = null) {
    if (error instanceof AppError) {
      return error;
    }

    // 根据错误消息推断错误类型
    let type = ErrorType.UNKNOWN;
    let level = ErrorLevel.ERROR;

    const errorMessage = error.message || String(error);

    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      type = ErrorType.NETWORK;
    } else if (errorMessage.includes('database') || errorMessage.includes('SQL')) {
      type = ErrorType.DATABASE;
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      type = ErrorType.VALIDATION;
      level = ErrorLevel.WARNING;
    } else if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      type = ErrorType.PERMISSION;
    } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      type = ErrorType.NOT_FOUND;
      level = ErrorLevel.WARNING;
    } else if (errorMessage.includes('timeout')) {
      type = ErrorType.TIMEOUT;
    }

    return new AppError(
      errorMessage,
      type,
      level,
      {
        originalError: error,
        context,
      }
    );
  }

  /**
   * 记录错误
   */
  logError(error, logToConsole = true, logToFile = false) {
    // 添加到内存日志
    this.errorLog.push(error);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // 控制台日志
    if (logToConsole) {
      const logMethod = error.level === ErrorLevel.WARNING ? console.warn : console.error;
      logMethod('[ErrorHandler]', error.message, error);
    }

    // 文件日志（通过 IPC 发送到主进程）
    if (logToFile && window.electronAPI) {
      window.electronAPI.logError(error.toJSON()).catch(err => {
        console.error('[ErrorHandler] Failed to log to file:', err);
      });
    }
  }

  /**
   * 显示错误消息（Toast）
   */
  showErrorMessage(error) {
    const messageText = error.message || ERROR_MESSAGES[error.type] || ERROR_MESSAGES[ErrorType.UNKNOWN];

    switch (error.level) {
      case ErrorLevel.INFO:
        message.info(messageText);
        break;
      case ErrorLevel.WARNING:
        message.warning(messageText);
        break;
      case ErrorLevel.ERROR:
      case ErrorLevel.CRITICAL:
        message.error(messageText);
        break;
      default:
        message.error(messageText);
    }
  }

  /**
   * 显示错误通知（Notification）
   */
  showErrorNotification(error) {
    const messageText = error.message || ERROR_MESSAGES[error.type] || ERROR_MESSAGES[ErrorType.UNKNOWN];

    const config = {
      message: this.getErrorTitle(error),
      description: messageText,
      duration: error.level === ErrorLevel.CRITICAL ? 0 : 4.5,
    };

    switch (error.level) {
      case ErrorLevel.INFO:
        notification.info(config);
        break;
      case ErrorLevel.WARNING:
        notification.warning(config);
        break;
      case ErrorLevel.ERROR:
      case ErrorLevel.CRITICAL:
        notification.error(config);
        break;
      default:
        notification.error(config);
    }
  }

  /**
   * 获取错误标题
   */
  getErrorTitle(error) {
    const titles = {
      [ErrorType.NETWORK]: '网络错误',
      [ErrorType.DATABASE]: '数据库错误',
      [ErrorType.VALIDATION]: '验证错误',
      [ErrorType.PERMISSION]: '权限错误',
      [ErrorType.NOT_FOUND]: '资源未找到',
      [ErrorType.TIMEOUT]: '操作超时',
      [ErrorType.UNKNOWN]: '系统错误',
    };

    return titles[error.type] || '错误';
  }

  /**
   * 添加错误监听器
   */
  addListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * 移除错误监听器
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(error) {
    this.listeners.forEach(listener => {
      try {
        listener(error);
      } catch (err) {
        console.error('[ErrorHandler] Listener error:', err);
      }
    });
  }

  /**
   * 获取错误日志
   */
  getErrorLog() {
    return [...this.errorLog];
  }

  /**
   * 清空错误日志
   */
  clearErrorLog() {
    this.errorLog = [];
  }

  /**
   * 导出错误日志
   */
  exportErrorLog() {
    return JSON.stringify(this.errorLog, null, 2);
  }
}

// 创建全局错误处理器实例
const errorHandler = new ErrorHandler();

/**
 * 便捷函数：处理错误
 */
export function handleError(error, options = {}) {
  return errorHandler.handle(error, options);
}

/**
 * 便捷函数：创建应用错误
 */
export function createError(message, type = ErrorType.UNKNOWN, level = ErrorLevel.ERROR, details = null) {
  return new AppError(message, type, level, details);
}

/**
 * 异步函数错误包装器
 * 自动捕获并处理异步函数中的错误
 */
export function withErrorHandling(fn, options = {}) {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      handleError(error, {
        context: {
          function: fn.name,
          arguments: args,
        },
        ...options,
      });
      throw error;
    }
  };
}

/**
 * Promise 错误处理
 */
export function handlePromise(promise, options = {}) {
  return promise.catch(error => {
    handleError(error, options);
    throw error;
  });
}

/**
 * 重试包装器
 * 自动重试失败的操作
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onRetry = null,
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && shouldRetry(error, attempt)) {
        if (onRetry) {
          onRetry(error, attempt);
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      } else {
        break;
      }
    }
  }

  // 所有重试都失败
  throw lastError;
}

/**
 * 超时包装器
 */
export function withTimeout(promise, timeoutMs = 30000, timeoutMessage = '操作超时') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(createError(timeoutMessage, ErrorType.TIMEOUT));
      }, timeoutMs);
    }),
  ]);
}

// 导出错误处理器实例
export default errorHandler;
