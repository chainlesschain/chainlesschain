/**
 * IPC 错误处理中间件
 * 统一的错误处理、分类和格式化
 *
 * 功能：
 * - 标准化错误响应格式
 * - 错误分类（Network, Validation, Permission等）
 * - 自动日志记录
 * - ErrorMonitor AI 诊断集成（可选）
 * - 错误上报和统计
 */

const { logger } = require("./logger");

/**
 * 错误类型枚举
 */
const ErrorType = {
  VALIDATION: "ValidationError",
  NETWORK: "NetworkError",
  PERMISSION: "PermissionError",
  NOT_FOUND: "NotFoundError",
  CONFLICT: "ConflictError",
  TIMEOUT: "TimeoutError",
  DATABASE: "DatabaseError",
  FILESYSTEM: "FilesystemError",
  INTERNAL: "InternalError",
  UNKNOWN: "UnknownError",
};

/**
 * 自定义错误基类
 */
class AppError extends Error {
  constructor(message, type = ErrorType.UNKNOWN, details = {}) {
    super(message);
    this.name = type;
    this.type = type;
    this.details = details;
    this.timestamp = Date.now();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: process.env.NODE_ENV === "development" ? this.stack : undefined,
    };
  }
}

/**
 * 验证错误
 */
class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.VALIDATION, details);
  }
}

/**
 * 网络错误
 */
class NetworkError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.NETWORK, details);
  }
}

/**
 * 权限错误
 */
class PermissionError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.PERMISSION, details);
  }
}

/**
 * 未找到错误
 */
class NotFoundError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.NOT_FOUND, details);
  }
}

/**
 * 冲突错误
 */
class ConflictError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.CONFLICT, details);
  }
}

/**
 * 超时错误
 */
class TimeoutError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.TIMEOUT, details);
  }
}

/**
 * 数据库错误
 */
class DatabaseError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.DATABASE, details);
  }
}

/**
 * 文件系统错误
 */
class FilesystemError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.FILESYSTEM, details);
  }
}

/**
 * 内部错误
 */
class InternalError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorType.INTERNAL, details);
  }
}

/**
 * 错误统计
 */
class ErrorStats {
  constructor() {
    this.errors = new Map(); // channel -> { count, lastError, lastTime }
    this.totalErrors = 0;
    this.errorsByType = new Map(); // ErrorType -> count
  }

  record(channel, error) {
    this.totalErrors++;

    // 按 channel 统计
    if (!this.errors.has(channel)) {
      this.errors.set(channel, { count: 0, lastError: null, lastTime: null });
    }
    const channelStats = this.errors.get(channel);
    channelStats.count++;
    channelStats.lastError = error.message;
    channelStats.lastTime = Date.now();

    // 按类型统计
    const errorType = error.type || ErrorType.UNKNOWN;
    this.errorsByType.set(
      errorType,
      (this.errorsByType.get(errorType) || 0) + 1,
    );
  }

  getStats() {
    return {
      total: this.totalErrors,
      byChannel: Object.fromEntries(this.errors),
      byType: Object.fromEntries(this.errorsByType),
    };
  }

  reset() {
    this.errors.clear();
    this.errorsByType.clear();
    this.totalErrors = 0;
  }
}

const errorStats = new ErrorStats();

/**
 * 错误分类器
 * 根据错误信息自动识别错误类型
 */
function classifyError(error) {
  if (error instanceof AppError) {
    return error;
  }

  const message = error.message.toLowerCase();

  // 超时错误（需要在网络错误之前检查，因为"network timeout"应该是超时）
  if (message.includes("timeout") || message.includes("timed out")) {
    return new TimeoutError(error.message, { originalError: error.name });
  }

  // 数据库错误（需要在未找到错误之前检查，因为"table not found"应该是数据库错误）
  if (
    message.includes("database") ||
    message.includes("sqlite") ||
    message.includes("sql")
  ) {
    return new DatabaseError(error.message, { originalError: error.name });
  }

  // 网络错误
  if (
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed")
  ) {
    return new NetworkError(error.message, { originalError: error.name });
  }

  // 权限错误
  if (
    message.includes("permission") ||
    message.includes("access denied") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("eacces")
  ) {
    return new PermissionError(error.message, { originalError: error.name });
  }

  // 未找到错误
  if (
    message.includes("not found") ||
    message.includes("enoent") ||
    message.includes("does not exist")
  ) {
    return new NotFoundError(error.message, { originalError: error.name });
  }

  // 冲突错误
  if (message.includes("conflict") || message.includes("already exists")) {
    return new ConflictError(error.message, { originalError: error.name });
  }

  // 文件系统错误
  if (
    message.includes("file") ||
    message.includes("directory") ||
    message.includes("enoent") ||
    message.includes("eisdir")
  ) {
    return new FilesystemError(error.message, { originalError: error.name });
  }

  // 验证错误
  if (
    message.includes("invalid") ||
    message.includes("required") ||
    message.includes("validation")
  ) {
    return new ValidationError(error.message, { originalError: error.name });
  }

  // 默认为内部错误
  return new InternalError(error.message, { originalError: error.name });
}

/**
 * IPC 错误处理中间件包装器
 * @param {string} channel - IPC 通道名称
 * @param {Function} handler - 原始处理器函数
 * @param {Object} options - 配置选项
 * @returns {Function} 包装后的处理器
 */
function withErrorHandling(channel, handler, options = {}) {
  const {
    enableLogging = true,
    enableStats = true,
    enableAIDiagnostics = false,
    context = {},
  } = options;

  return async (event, ...args) => {
    const startTime = Date.now();

    try {
      // 执行原始处理器
      const result = await handler(event, ...args);

      // 成功日志（可选）
      if (enableLogging) {
        const duration = Date.now() - startTime;
        logger.debug(`[IPC] ✅ ${channel} completed in ${duration}ms`);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 1. 错误分类
      const classifiedError = classifyError(error);

      // 2. 记录统计
      if (enableStats) {
        errorStats.record(channel, classifiedError);
      }

      // 3. 日志记录
      if (enableLogging) {
        logger.error(
          `[IPC] ❌ ${channel} failed in ${duration}ms:`,
          classifiedError.type,
          classifiedError.message,
        );

        // 开发环境下记录完整堆栈
        if (process.env.NODE_ENV === "development") {
          logger.error("[IPC] Stack trace:", classifiedError.stack);
        }
      }

      // 4. AI 诊断（可选）
      if (enableAIDiagnostics) {
        try {
          const diagnosis = await diagnoseError(classifiedError, {
            channel,
            args,
            context,
            duration,
          });
          classifiedError.details.diagnosis = diagnosis;
        } catch (diagError) {
          logger.warn("[IPC] AI 诊断失败:", diagError);
        }
      }

      // 5. 抛出错误（让 Electron 的 IPC 处理）
      throw classifiedError;
    }
  };
}

/**
 * AI 错误诊断（集成 ErrorMonitor）
 * @param {AppError} error - 分类后的错误
 * @param {Object} context - 上下文信息
 * @param {Object} context.errorMonitor - ErrorMonitor 实例（可选）
 * @returns {Promise<Object>} 诊断结果
 */
async function diagnoseError(error, context = {}) {
  const { errorMonitor } = context;

  // 如果有 ErrorMonitor 实例，使用 AI 诊断
  if (errorMonitor && typeof errorMonitor.analyzeError === "function") {
    try {
      const aiAnalysis = await errorMonitor.analyzeError(error);

      if (aiAnalysis && !aiAnalysis.error) {
        return {
          severity: aiAnalysis.severity || getSeverity(error.type),
          suggestions: aiAnalysis.suggestions || [],
          aiDiagnosis: aiAnalysis.aiDiagnosis || null,
          autoFixResult: aiAnalysis.autoFixResult || null,
          relatedIssues: aiAnalysis.relatedIssues || [],
          documentation: getDocumentationLink(error.type),
          canRetry: isRetryable(error.type),
          analyzedByAI: true,
        };
      }
    } catch (aiError) {
      logger.warn(
        "[IPC Error] AI 诊断失败，回退到基本诊断:",
        aiError.message
      );
    }
  }

  // 回退到基本的诊断信息
  const suggestions = [];

  // 根据错误类型提供建议
  switch (error.type) {
    case ErrorType.NETWORK:
      suggestions.push("检查网络连接");
      suggestions.push("检查后端服务是否运行");
      suggestions.push("查看防火墙设置");
      break;

    case ErrorType.PERMISSION:
      suggestions.push("检查文件/目录权限");
      suggestions.push("以管理员身份运行");
      suggestions.push("检查用户权限配置");
      break;

    case ErrorType.NOT_FOUND:
      suggestions.push("确认文件/资源路径正确");
      suggestions.push("检查资源是否已删除");
      break;

    case ErrorType.DATABASE:
      suggestions.push("检查数据库连接");
      suggestions.push("检查 SQL 语法");
      suggestions.push("查看数据库日志");
      break;

    case ErrorType.VALIDATION:
      suggestions.push("检查输入参数格式");
      suggestions.push("查看参数验证规则");
      break;

    default:
      suggestions.push("查看错误日志获取更多信息");
      suggestions.push("尝试重新执行操作");
  }

  return {
    severity: getSeverity(error.type),
    suggestions,
    documentation: getDocumentationLink(error.type),
    canRetry: isRetryable(error.type),
    analyzedByAI: false,
  };
}

/**
 * 获取错误严重性
 */
function getSeverity(errorType) {
  const severityMap = {
    [ErrorType.VALIDATION]: "low",
    [ErrorType.NOT_FOUND]: "low",
    [ErrorType.CONFLICT]: "medium",
    [ErrorType.TIMEOUT]: "medium",
    [ErrorType.NETWORK]: "medium",
    [ErrorType.PERMISSION]: "high",
    [ErrorType.DATABASE]: "high",
    [ErrorType.FILESYSTEM]: "high",
    [ErrorType.INTERNAL]: "critical",
    [ErrorType.UNKNOWN]: "critical",
  };

  return severityMap[errorType] || "medium";
}

/**
 * 获取文档链接
 */
function getDocumentationLink(errorType) {
  const baseUrl = "https://docs.chainlesschain.com/errors";
  return `${baseUrl}/${errorType.toLowerCase()}`;
}

/**
 * 判断是否可重试
 */
function isRetryable(errorType) {
  const retryableTypes = [
    ErrorType.NETWORK,
    ErrorType.TIMEOUT,
    ErrorType.DATABASE,
  ];

  return retryableTypes.includes(errorType);
}

/**
 * 批量包装 IPC 处理器
 * @param {Object} handlers - IPC 处理器映射 { channel: handler }
 * @param {Object} options - 全局配置
 * @returns {Object} 包装后的处理器映射
 */
function wrapHandlers(handlers, options = {}) {
  const wrapped = {};

  for (const [channel, handler] of Object.entries(handlers)) {
    wrapped[channel] = withErrorHandling(channel, handler, options);
  }

  return wrapped;
}

/**
 * 获取错误统计
 */
function getErrorStats() {
  return errorStats.getStats();
}

/**
 * 重置错误统计
 */
function resetErrorStats() {
  errorStats.reset();
}

module.exports = {
  // 错误类型
  ErrorType,

  // 错误类
  AppError,
  ValidationError,
  NetworkError,
  PermissionError,
  NotFoundError,
  ConflictError,
  TimeoutError,
  DatabaseError,
  FilesystemError,
  InternalError,

  // 中间件
  withErrorHandling,
  wrapHandlers,

  // 工具函数
  classifyError,
  diagnoseError,

  // 统计
  getErrorStats,
  resetErrorStats,
};
