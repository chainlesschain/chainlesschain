/**
 * 命令路由器 - 将命令分发到对应的处理器
 *
 * 功能：
 * - 命令路由分发
 * - 处理器注册管理
 * - 错误处理和响应封装
 * - 命令执行统计
 *
 * @module remote/command-router
 */

const { logger } = require('../utils/logger');

/**
 * 错误码
 */
const ERROR_CODES = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HANDLER_NOT_FOUND: -32001,
  HANDLER_ERROR: -32002
};

/**
 * 命令路由器类
 */
class CommandRouter {
  constructor(options = {}) {
    // 配置选项
    this.options = {
      enableLogging: options.enableLogging !== false,
      enableStats: options.enableStats !== false,
      ...options
    };

    // 命令处理器映射（namespace -> handler）
    this.handlers = new Map();

    // 统计信息
    this.stats = {
      totalCommands: 0,
      successCommands: 0,
      failedCommands: 0,
      byNamespace: {},
      startTime: Date.now()
    };
  }

  /**
   * 注册命令处理器
   * @param {string} namespace - 命名空间（如 'ai', 'system', 'file'）
   * @param {Object} handler - 处理器实例（必须实现 handle 方法）
   */
  registerHandler(namespace, handler) {
    if (!handler || typeof handler.handle !== 'function') {
      throw new Error(`Handler for namespace '${namespace}' must implement handle() method`);
    }

    this.handlers.set(namespace, handler);

    // 初始化统计
    if (this.options.enableStats) {
      this.stats.byNamespace[namespace] = {
        total: 0,
        success: 0,
        failed: 0
      };
    }

    logger.info(`[CommandRouter] 注册处理器: ${namespace}`);
  }

  /**
   * 取消注册处理器
   */
  unregisterHandler(namespace) {
    if (this.handlers.has(namespace)) {
      this.handlers.delete(namespace);
      logger.info(`[CommandRouter] 取消注册处理器: ${namespace}`);
    }
  }

  /**
   * 路由命令到对应的处理器
   * @param {Object} request - JSON-RPC 请求对象
   * @param {Object} context - 上下文信息（peerId, did, channel 等）
   * @returns {Promise<Object>} JSON-RPC 响应对象
   */
  async route(request, context = {}) {
    const startTime = Date.now();
    const { id, method, params } = request;

    // 更新统计
    this.stats.totalCommands++;

    // 日志记录
    if (this.options.enableLogging) {
      logger.info(`[CommandRouter] 路由命令: ${method} (id: ${id})`);
    }

    try {
      // 1. 验证请求格式
      if (!method || typeof method !== 'string') {
        return this.createErrorResponse(id, ERROR_CODES.INVALID_REQUEST, 'Method is required');
      }

      // 2. 解析命名空间和动作
      const [namespace, action] = this.parseMethod(method);
      if (!namespace || !action) {
        return this.createErrorResponse(
          id,
          ERROR_CODES.METHOD_NOT_FOUND,
          `Invalid method format: ${method}. Expected format: namespace.action`
        );
      }

      // 3. 查找处理器
      const handler = this.handlers.get(namespace);
      if (!handler) {
        logger.warn(`[CommandRouter] 处理器不存在: ${namespace}`);
        return this.createErrorResponse(
          id,
          ERROR_CODES.HANDLER_NOT_FOUND,
          `Handler not found for namespace: ${namespace}`
        );
      }

      // 4. 执行命令
      let result;
      try {
        result = await handler.handle(action, params || {}, context);
      } catch (error) {
        logger.error(`[CommandRouter] 执行命令失败: ${method}`, error);

        // 更新统计
        this.stats.failedCommands++;
        if (this.stats.byNamespace[namespace]) {
          this.stats.byNamespace[namespace].failed++;
        }

        // 返回错误响应
        return this.createErrorResponse(
          id,
          error.code || ERROR_CODES.HANDLER_ERROR,
          error.message || 'Handler execution failed',
          error.data
        );
      }

      // 5. 更新统计
      this.stats.successCommands++;
      if (this.stats.byNamespace[namespace]) {
        this.stats.byNamespace[namespace].total++;
        this.stats.byNamespace[namespace].success++;
      }

      // 6. 记录执行时间
      const duration = Date.now() - startTime;
      if (this.options.enableLogging) {
        logger.info(`[CommandRouter] 命令执行成功: ${method} (${duration}ms)`);
      }

      // 7. 返回成功响应
      return this.createSuccessResponse(id, result);
    } catch (error) {
      logger.error('[CommandRouter] 路由命令异常:', error);

      // 更新统计
      this.stats.failedCommands++;

      // 返回内部错误
      return this.createErrorResponse(
        id,
        ERROR_CODES.INTERNAL_ERROR,
        'Internal router error',
        error.message
      );
    }
  }

  /**
   * 解析方法名（namespace.action）
   */
  parseMethod(method) {
    const parts = method.split('.');
    if (parts.length < 2) {
      return [null, null];
    }

    const namespace = parts[0];
    const action = parts.slice(1).join('.');  // 支持多级，如 channel.telegram.send

    return [namespace, action];
  }

  /**
   * 创建成功响应
   */
  createSuccessResponse(id, result) {
    return {
      jsonrpc: '2.0',
      id,
      result: result !== undefined ? result : null
    };
  }

  /**
   * 创建错误响应
   */
  createErrorResponse(id, code, message, data = null) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };

    if (data !== null && data !== undefined) {
      response.error.data = data;
    }

    return response;
  }

  /**
   * 获取已注册的处理器列表
   */
  getRegisteredHandlers() {
    return Array.from(this.handlers.keys());
  }

  /**
   * 检查处理器是否已注册
   */
  hasHandler(namespace) {
    return this.handlers.has(namespace);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      registeredHandlers: this.handlers.size,
      uptime: Date.now() - this.stats.startTime,
      successRate: this.stats.totalCommands > 0
        ? (this.stats.successCommands / this.stats.totalCommands * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalCommands: 0,
      successCommands: 0,
      failedCommands: 0,
      byNamespace: {},
      startTime: Date.now()
    };

    // 重新初始化命名空间统计
    for (const namespace of this.handlers.keys()) {
      this.stats.byNamespace[namespace] = {
        total: 0,
        success: 0,
        failed: 0
      };
    }

    logger.info('[CommandRouter] 统计信息已重置');
  }
}

module.exports = {
  CommandRouter,
  ERROR_CODES
};
