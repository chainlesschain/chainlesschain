/**
 * 工具错误类定义
 * 提供统一的错误处理和分类
 */

/**
 * 基础工具错误类
 */
class ToolError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

/**
 * 参数验证错误
 */
class ValidationError extends ToolError {
  constructor(message, invalidParams = []) {
    super(message, 'VALIDATION_ERROR', { invalidParams });
    this.invalidParams = invalidParams;
  }
}

/**
 * 工具执行错误
 */
class ExecutionError extends ToolError {
  constructor(message, toolName, originalError = null) {
    super(message, 'EXECUTION_ERROR', {
      toolName,
      originalError: originalError ? {
        message: originalError.message,
        stack: originalError.stack
      } : null
    });
    this.toolName = toolName;
    this.originalError = originalError;
  }
}

/**
 * 工具未找到错误
 */
class ToolNotFoundError extends ToolError {
  constructor(toolName) {
    super(`工具不存在: ${toolName}`, 'TOOL_NOT_FOUND', { toolName });
    this.toolName = toolName;
  }
}

/**
 * 权限错误
 */
class PermissionError extends ToolError {
  constructor(message, requiredPermissions = []) {
    super(message, 'PERMISSION_ERROR', { requiredPermissions });
    this.requiredPermissions = requiredPermissions;
  }
}

/**
 * 超时错误
 */
class TimeoutError extends ToolError {
  constructor(toolName, timeout) {
    super(`工具执行超时: ${toolName} (${timeout}ms)`, 'TIMEOUT_ERROR', { toolName, timeout });
    this.toolName = toolName;
    this.timeout = timeout;
  }
}

/**
 * 配置错误
 */
class ConfigurationError extends ToolError {
  constructor(message, configKey) {
    super(message, 'CONFIGURATION_ERROR', { configKey });
    this.configKey = configKey;
  }
}

/**
 * 依赖错误（缺少必需的依赖）
 */
class DependencyError extends ToolError {
  constructor(message, missingDependency) {
    super(message, 'DEPENDENCY_ERROR', { missingDependency });
    this.missingDependency = missingDependency;
  }
}

/**
 * 资源限制错误
 */
class ResourceLimitError extends ToolError {
  constructor(message, limit, current) {
    super(message, 'RESOURCE_LIMIT_ERROR', { limit, current });
    this.limit = limit;
    this.current = current;
  }
}

/**
 * 错误处理器
 */
class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    this.errorStats = new Map(); // 错误统计
  }

  /**
   * 处理工具错误
   */
  async handleToolError(error, toolName, params) {
    // 记录错误统计
    this._recordErrorStats(error, toolName);

    // 记录日志
    if (this.logger) {
      await this.logger.error(`工具执行失败: ${toolName}`, error, {
        toolName,
        errorCode: error.code,
        params: this._sanitizeParams(params)
      });
    }

    // 返回标准化错误响应
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details || {},
        timestamp: error.timestamp || Date.now()
      }
    };
  }

  /**
   * 包装工具Handler，添加错误处理
   */
  wrapHandler(handler, toolName, logger) {
    return async (params) => {
      const startTime = Date.now();

      try {
        // 记录调用
        if (logger) {
          await logger.logToolCall(toolName, params, startTime);
        }

        // 验证参数
        this._validateParams(params, toolName);

        // 执行工具
        const result = await handler(params);

        // 记录成功
        const duration = Date.now() - startTime;
        if (logger) {
          await logger.logToolSuccess(toolName, result, duration);
        }

        return result;

      } catch (error) {
        // 记录失败
        const duration = Date.now() - startTime;
        if (logger) {
          await logger.logToolFailure(toolName, error, duration, params);
        }

        // 处理错误
        return await this.handleToolError(error, toolName, params);
      }
    };
  }

  /**
   * 验证参数
   */
  _validateParams(params, toolName) {
    if (params === null || params === undefined) {
      throw new ValidationError('参数不能为空', [{ param: 'params', message: '必需提供参数对象' }]);
    }

    if (typeof params !== 'object') {
      throw new ValidationError('参数必须是对象类型', [{ param: 'params', message: '期望对象类型' }]);
    }

    // 可以在这里添加更多的验证逻辑
    return true;
  }

  /**
   * 记录错误统计
   */
  _recordErrorStats(error, toolName) {
    const key = `${toolName}:${error.code || 'UNKNOWN'}`;
    const stats = this.errorStats.get(key) || { count: 0, lastOccurred: null };

    stats.count++;
    stats.lastOccurred = Date.now();

    this.errorStats.set(key, stats);
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const stats = {};

    for (const [key, value] of this.errorStats.entries()) {
      const [toolName, errorCode] = key.split(':');
      if (!stats[toolName]) {
        stats[toolName] = {};
      }
      stats[toolName][errorCode] = value;
    }

    return stats;
  }

  /**
   * 清除错误统计
   */
  clearErrorStats() {
    this.errorStats.clear();
  }

  /**
   * 清理敏感参数
   */
  _sanitizeParams(params) {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const sensitiveKeys = ['password', 'apiKey', 'apiSecret', 'token', 'accessToken', 'credentials'];
    const sanitized = { ...params };

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}

module.exports = {
  ToolError,
  ValidationError,
  ExecutionError,
  ToolNotFoundError,
  PermissionError,
  TimeoutError,
  ConfigurationError,
  DependencyError,
  ResourceLimitError,
  ErrorHandler
};
