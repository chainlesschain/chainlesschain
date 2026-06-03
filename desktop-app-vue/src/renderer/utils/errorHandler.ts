/**
 * 统一错误处理工具
 * 提供一致的错误处理、日志记录和用户反馈
 */

import { logger } from "@/utils/logger";
import { message, notification } from "ant-design-vue";

// ==================== 类型定义 ====================

/**
 * 错误类型枚举
 */
export const ErrorType = {
  NETWORK: "network",
  DATABASE: "database",
  VALIDATION: "validation",
  PERMISSION: "permission",
  NOT_FOUND: "not_found",
  TIMEOUT: "timeout",
  IPC: "ipc",
  SERIALIZATION: "serialization",
  UNKNOWN: "unknown",
} as const;

export type ErrorTypeValue = typeof ErrorType[keyof typeof ErrorType];

/**
 * 错误级别
 */
export const ErrorLevel = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
} as const;

export type ErrorLevelValue = typeof ErrorLevel[keyof typeof ErrorLevel];

/**
 * 错误处理选项
 */
export interface ErrorHandleOptions {
  showMessage?: boolean;
  showNotification?: boolean;
  logToConsole?: boolean;
  logToFile?: boolean;
  context?: Record<string, any> | null;
}

/**
 * 错误监听器
 */
export type ErrorListener = (error: AppError) => void;

/**
 * 重试选项
 */
export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: ((error: Error, attempt: number) => void) | null;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * 错误消息映射
 */
const ERROR_MESSAGES: Record<ErrorTypeValue, string> = {
  [ErrorType.NETWORK]: "网络连接失败，请检查网络设置",
  [ErrorType.DATABASE]: "数据库操作失败，请稍后重试",
  [ErrorType.VALIDATION]: "输入数据验证失败",
  [ErrorType.PERMISSION]: "权限不足，无法执行此操作",
  [ErrorType.NOT_FOUND]: "请求的资源不存在",
  [ErrorType.TIMEOUT]: "操作超时，请稍后重试",
  [ErrorType.IPC]: "应用内部通信失败，正在重试",
  [ErrorType.SERIALIZATION]: "数据序列化失败，请检查数据格式",
  [ErrorType.UNKNOWN]: "发生未知错误，请联系技术支持",
};

// ==================== 应用错误类 ====================

/**
 * 应用错误类
 */
export class AppError extends Error {
  public type: ErrorTypeValue;
  public level: ErrorLevelValue;
  public details: Record<string, any> | null;
  public timestamp: string;

  constructor(
    message: string,
    type: ErrorTypeValue = ErrorType.UNKNOWN,
    level: ErrorLevelValue = ErrorLevel.ERROR,
    details: Record<string, any> | null = null,
  ) {
    super(message);
    this.name = "AppError";
    this.type = type;
    this.level = level;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON(): Record<string, any> {
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

// ==================== 错误处理器类 ====================

/**
 * 错误处理器类
 */
class ErrorHandler {
  private errorLog: AppError[];
  private maxLogSize: number;
  private listeners: ErrorListener[];

  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
    this.listeners = [];
  }

  /**
   * 处理错误
   */
  handle(error: Error | AppError, options: ErrorHandleOptions = {}): AppError {
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
  normalizeError(error: Error | AppError, context: Record<string, any> | null = null): AppError {
    if (error instanceof AppError) {
      return error;
    }

    // 根据错误消息推断错误类型
    let type: ErrorTypeValue = ErrorType.UNKNOWN;
    let level: ErrorLevelValue = ErrorLevel.ERROR;

    const errorMessage = error.message || String(error);

    // IPC 相关错误（应用启动时常见）
    if (
      errorMessage.includes("No handler registered") ||
      errorMessage.includes("IPC") ||
      errorMessage.includes("interrupted")
    ) {
      type = ErrorType.IPC;
      level = ErrorLevel.WARNING; // 降级为警告，因为通常会自动重试
    } else if (
      errorMessage.includes("could not be cloned") ||
      errorMessage.includes("serialize") ||
      errorMessage.includes("DataCloneError")
    ) {
      // 序列化错误（Electron IPC 传输非序列化对象时）
      type = ErrorType.SERIALIZATION;
    } else if (
      errorMessage.includes("network") ||
      errorMessage.includes("fetch")
    ) {
      type = ErrorType.NETWORK;
    } else if (
      errorMessage.includes("database") ||
      errorMessage.includes("SQL")
    ) {
      type = ErrorType.DATABASE;
    } else if (
      errorMessage.includes("validation") ||
      errorMessage.includes("invalid")
    ) {
      type = ErrorType.VALIDATION;
      level = ErrorLevel.WARNING;
    } else if (
      errorMessage.includes("permission") ||
      errorMessage.includes("unauthorized")
    ) {
      type = ErrorType.PERMISSION;
    } else if (
      errorMessage.includes("not found") ||
      errorMessage.includes("404")
    ) {
      type = ErrorType.NOT_FOUND;
      level = ErrorLevel.WARNING;
    } else if (errorMessage.includes("timeout")) {
      type = ErrorType.TIMEOUT;
    }

    return new AppError(errorMessage, type, level, {
      originalError: error,
      context,
    });
  }

  /**
   * 记录错误
   */
  logError(error: AppError, logToConsole: boolean = true, logToFile: boolean = false): void {
    // 添加到内存日志
    this.errorLog.push(error);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // 控制台日志
    if (logToConsole) {
      const logMethod =
        error.level === ErrorLevel.WARNING ? console.warn : console.error;
      logMethod("[ErrorHandler]", error.message, error);
    }

    // 文件日志（通过 IPC 发送到主进程）
    if (logToFile && (window as any).electronAPI) {
      (window as any).electronAPI.logError(error.toJSON()).catch((err: Error) => {
        // IPC 未就绪时静默处理
        if (!err.message?.includes("No handler registered")) {
          logger.error("[ErrorHandler] Failed to log to file:", err as any);
        }
      });
    }
  }

  /**
   * 显示错误消息（Toast）
   */
  showErrorMessage(error: AppError): void {
    const messageText =
      error.message ||
      ERROR_MESSAGES[error.type] ||
      ERROR_MESSAGES[ErrorType.UNKNOWN];

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
  showErrorNotification(error: AppError): void {
    const messageText =
      error.message ||
      ERROR_MESSAGES[error.type] ||
      ERROR_MESSAGES[ErrorType.UNKNOWN];

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
  getErrorTitle(error: AppError): string {
    const titles: Record<ErrorTypeValue, string> = {
      [ErrorType.NETWORK]: "网络错误",
      [ErrorType.DATABASE]: "数据库错误",
      [ErrorType.VALIDATION]: "验证错误",
      [ErrorType.PERMISSION]: "权限错误",
      [ErrorType.NOT_FOUND]: "资源未找到",
      [ErrorType.TIMEOUT]: "操作超时",
      [ErrorType.IPC]: "通信错误",
      [ErrorType.SERIALIZATION]: "序列化错误",
      [ErrorType.UNKNOWN]: "系统错误",
    };

    return titles[error.type] || "错误";
  }

  /**
   * 添加错误监听器
   */
  addListener(listener: ErrorListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除错误监听器
   */
  removeListener(listener: ErrorListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(error: AppError): void {
    this.listeners.forEach((listener) => {
      try {
        listener(error);
      } catch (err) {
        logger.error("[ErrorHandler] Listener error:", err as any);
      }
    });
  }

  /**
   * 获取错误日志
   */
  getErrorLog(): AppError[] {
    return [...this.errorLog];
  }

  /**
   * 清空错误日志
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * 导出错误日志
   */
  exportErrorLog(): string {
    return JSON.stringify(this.errorLog, null, 2);
  }
}

// 创建全局错误处理器实例
const errorHandler = new ErrorHandler();

// ==================== 便捷函数 ====================

/**
 * 便捷函数：处理错误
 */
export function handleError(error: Error | AppError, options: ErrorHandleOptions = {}): AppError {
  return errorHandler.handle(error, options);
}

/**
 * 便捷函数：创建应用错误
 */
export function createError(
  message: string,
  type: ErrorTypeValue = ErrorType.UNKNOWN,
  level: ErrorLevelValue = ErrorLevel.ERROR,
  details: Record<string, any> | null = null,
): AppError {
  return new AppError(message, type, level, details);
}

/**
 * 异步函数错误包装器
 * 自动捕获并处理异步函数中的错误
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: ErrorHandleOptions = {},
): T {
  return (async function (...args: any[]) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      handleError(error as Error, {
        context: {
          function: fn.name,
          arguments: args,
        },
        ...options,
      });
      throw error;
    }
  }) as T;
}

/**
 * Promise 错误处理
 */
export function handlePromise<T>(promise: Promise<T>, options: ErrorHandleOptions = {}): Promise<T> {
  return promise.catch((error) => {
    handleError(error, options);
    throw error;
  });
}

/**
 * 重试包装器
 * 自动重试失败的操作
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onRetry = null,
    shouldRetry = () => true,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries && shouldRetry(lastError, attempt)) {
        if (onRetry) {
          onRetry(lastError, attempt);
        }

        // 等待后重试
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * (attempt + 1)),
        );
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
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000,
  timeoutMessage: string = "操作超时",
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(createError(timeoutMessage, ErrorType.TIMEOUT));
      }, timeoutMs);
    }),
  ]);
}

/**
 * 检查是否为 IPC 未就绪错误
 * 这类错误通常在应用启动时发生，可以静默重试
 */
export function isIPCNotReadyError(error: Error | null | undefined): boolean {
  const message = error?.message || String(error);
  return (
    message.includes("No handler registered") ||
    message.includes("interrupted") ||
    message.includes("IPC channel")
  );
}

/**
 * 检查是否为序列化错误
 * 这类错误通常是因为尝试通过 IPC 传输不可序列化的对象
 */
export function isSerializationError(error: Error | null | undefined): boolean {
  const message = error?.message || String(error);
  return (
    message.includes("could not be cloned") ||
    message.includes("DataCloneError") ||
    message.includes("serialize")
  );
}

/**
 * IPC 调用包装器
 * 自动处理 IPC 未就绪的情况，支持重试
 */
export async function safeIPCCall<T>(
  ipcFn: () => Promise<T>,
  options: { maxRetries?: number; retryDelay?: number; silent?: boolean } = {},
): Promise<T | undefined> {
  const { maxRetries = 3, retryDelay = 500, silent = true } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await ipcFn();
    } catch (error) {
      if (isIPCNotReadyError(error as Error) && attempt < maxRetries - 1) {
        if (!silent) {
          logger.warn(`[safeIPCCall] IPC 未就绪，第 ${attempt + 1} 次重试...`);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * (attempt + 1)),
        );
        continue;
      }
      throw error;
    }
  }
}

// 导出错误处理器实例
export default errorHandler;
