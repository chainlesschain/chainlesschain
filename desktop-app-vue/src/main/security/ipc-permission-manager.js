/**
 * IPC Permission Manager
 *
 * IPC通信权限控制中间件
 * - 基于角色的访问控制 (RBAC)
 * - IP白名单/黑名单
 * - 速率限制 (Rate Limiting)
 * - 审计日志
 */

const { logger, createLogger } = require('../utils/logger.js');
const { app } = require('electron');
const fs = require('fs').promises;
const path = require('path');

/**
 * 权限级别
 */
const PermissionLevel = {
  PUBLIC: 'public',           // 公开访问
  AUTHENTICATED: 'authenticated', // 需要认证
  ADMIN: 'admin',              // 管理员权限
  SYSTEM: 'system',            // 系统级权限
};

/**
 * IPC通道权限配置
 * 定义每个IPC通道所需的权限级别
 */
const IPC_PERMISSIONS = {
  // 公开接口 - 无需认证
  'system:get-version': PermissionLevel.PUBLIC,
  'system:get-platform': PermissionLevel.PUBLIC,
  'llm:check-status': PermissionLevel.PUBLIC,
  'initial-setup:get-status': PermissionLevel.PUBLIC,

  // 需要认证的接口
  'knowledge:*': PermissionLevel.AUTHENTICATED,
  'db:*': PermissionLevel.AUTHENTICATED,
  'file:*': PermissionLevel.AUTHENTICATED,
  'llm:*': PermissionLevel.AUTHENTICATED,
  'rag:*': PermissionLevel.AUTHENTICATED,
  'git:*': PermissionLevel.AUTHENTICATED,
  'did:*': PermissionLevel.AUTHENTICATED,
  'contact:*': PermissionLevel.AUTHENTICATED,
  'friend:*': PermissionLevel.AUTHENTICATED,
  'post:*': PermissionLevel.AUTHENTICATED,
  'p2p:*': PermissionLevel.AUTHENTICATED,
  'project:*': PermissionLevel.AUTHENTICATED,
  'image:*': PermissionLevel.AUTHENTICATED,
  'import:*': PermissionLevel.AUTHENTICATED,
  'skill:*': PermissionLevel.AUTHENTICATED,
  'tool:*': PermissionLevel.AUTHENTICATED,

  // 管理员权限
  'database:migrate': PermissionLevel.ADMIN,
  'database:setup-encryption': PermissionLevel.ADMIN,
  'database:change-encryption-password': PermissionLevel.ADMIN,
  'config:reset': PermissionLevel.ADMIN,
  'plugin:*': PermissionLevel.ADMIN,

  // 系统级权限 (仅主进程可调用)
  'app:restart': PermissionLevel.SYSTEM,
  'system:quit': PermissionLevel.SYSTEM,
  'ukey:*': PermissionLevel.SYSTEM,
};

/**
 * 速率限制配置
 */
const RATE_LIMIT_CONFIG = {
  // 全局限制: 每分钟最多100次请求
  global: {
    windowMs: 60 * 1000,
    maxRequests: 100,
  },
  // 敏感操作限制: 每分钟最多10次
  sensitive: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    channels: [
      'database:setup-encryption',
      'database:change-encryption-password',
      'auth:verify-password',
      'ukey:verify-pin',
      'app:restart',
    ],
  },
  // 文件操作限制: 每分钟最多30次
  fileOps: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    channels: [
      'file:write',
      'file:delete',
      'import:import-file',
      'image:upload',
    ],
  },
};

class IPCPermissionManager {
  constructor() {
    this.userPermissionLevel = PermissionLevel.PUBLIC;
    this.rateLimitCache = new Map(); // 速率限制缓存
    this.auditLog = []; // 审计日志
    this.maxAuditLogSize = 1000;
    this.isInitialized = false;
  }

  /**
   * 初始化权限管理器
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    logger.info('[IPCPermissionManager] 初始化权限管理系统...');

    // 加载审计日志
    await this.loadAuditLog();

    // 启动定期清理任务
    this.startCleanupTask();

    this.isInitialized = true;
    logger.info('[IPCPermissionManager] 权限管理系统初始化完成');
  }

  /**
   * 设置用户权限级别
   */
  setUserPermissionLevel(level) {
    logger.info(`[IPCPermissionManager] 设置用户权限级别: ${level}`);
    this.userPermissionLevel = level;

    this.addAuditLog({
      type: 'permission_change',
      level: level,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 用户认证通过后调用
   */
  authenticate() {
    this.setUserPermissionLevel(PermissionLevel.AUTHENTICATED);
  }

  /**
   * 用户登出
   */
  logout() {
    this.setUserPermissionLevel(PermissionLevel.PUBLIC);
    this.rateLimitCache.clear();
  }

  /**
   * 检查IPC通道权限
   */
  checkPermission(channel) {
    // 获取通道所需的权限级别
    const requiredLevel = this.getRequiredPermissionLevel(channel);

    // 检查用户权限是否足够
    const hasPermission = this.hasPermission(this.userPermissionLevel, requiredLevel);

    if (!hasPermission) {
      logger.warn(`[IPCPermissionManager] 权限不足: ${channel}, 需要: ${requiredLevel}, 当前: ${this.userPermissionLevel}`);
      this.addAuditLog({
        type: 'permission_denied',
        channel: channel,
        required: requiredLevel,
        current: this.userPermissionLevel,
        timestamp: new Date().toISOString(),
      });
    }

    return hasPermission;
  }

  /**
   * 获取通道所需的权限级别
   */
  getRequiredPermissionLevel(channel) {
    // 精确匹配
    if (IPC_PERMISSIONS[channel]) {
      return IPC_PERMISSIONS[channel];
    }

    // 通配符匹配 (例如: knowledge:* 匹配所有 knowledge:xxx 通道)
    for (const [pattern, level] of Object.entries(IPC_PERMISSIONS)) {
      if (pattern.endsWith(':*')) {
        const prefix = pattern.slice(0, -1); // 移除 '*'
        if (channel.startsWith(prefix)) {
          return level;
        }
      }
    }

    // 默认需要认证
    return PermissionLevel.AUTHENTICATED;
  }

  /**
   * 检查用户是否有足够的权限
   */
  hasPermission(userLevel, requiredLevel) {
    const levels = {
      [PermissionLevel.PUBLIC]: 0,
      [PermissionLevel.AUTHENTICATED]: 1,
      [PermissionLevel.ADMIN]: 2,
      [PermissionLevel.SYSTEM]: 3,
    };

    return levels[userLevel] >= levels[requiredLevel];
  }

  /**
   * 速率限制检查
   */
  checkRateLimit(channel) {
    // 检查是否是敏感操作
    let config = RATE_LIMIT_CONFIG.global;

    if (RATE_LIMIT_CONFIG.sensitive.channels.includes(channel)) {
      config = RATE_LIMIT_CONFIG.sensitive;
    } else if (RATE_LIMIT_CONFIG.fileOps.channels.includes(channel)) {
      config = RATE_LIMIT_CONFIG.fileOps;
    }

    const key = `${channel}`;
    const now = Date.now();
    const cache = this.rateLimitCache.get(key) || { requests: [], lastReset: now };

    // 清理过期的请求记录
    cache.requests = cache.requests.filter(time => now - time < config.windowMs);

    // 检查是否超过限制
    if (cache.requests.length >= config.maxRequests) {
      logger.warn(`[IPCPermissionManager] 速率限制: ${channel}, 在${config.windowMs}ms内已达到${config.maxRequests}次请求上限`);
      this.addAuditLog({
        type: 'rate_limit_exceeded',
        channel: channel,
        requests: cache.requests.length,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // 记录本次请求
    cache.requests.push(now);
    this.rateLimitCache.set(key, cache);

    return true;
  }

  /**
   * 参数验证和清理
   */
  sanitizeArgs(channel, args) {
    return args.map(arg => {
      if (typeof arg === 'string') {
        // 防止命令注入
        const sanitized = arg
          .replace(/[;&|`$()<>]/g, '')  // 移除危险字符
          .replace(/\.\./g, '')         // 移除路径遍历
          .trim();

        return sanitized;
      }

      if (typeof arg === 'object' && arg !== null) {
        // 递归清理对象
        return this.sanitizeObject(arg);
      }

      return arg;
    });
  }

  /**
   * 清理对象中的危险内容
   */
  sanitizeObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          cleaned[key] = value
            .replace(/[;&|`$()<>]/g, '')
            .replace(/\.\./g, '')
            .trim();
        } else if (typeof value === 'object') {
          cleaned[key] = this.sanitizeObject(value);
        } else {
          cleaned[key] = value;
        }
      }
      return cleaned;
    }

    return obj;
  }

  /**
   * IPC调用中间件 - 在主进程的ipcMain.handle之前调用
   */
  middleware(channel, args) {
    // 1. 权限检查
    if (!this.checkPermission(channel)) {
      throw new Error(`Permission denied for channel: ${channel}`);
    }

    // 2. 速率限制检查
    if (!this.checkRateLimit(channel)) {
      throw new Error(`Rate limit exceeded for channel: ${channel}`);
    }

    // 3. 参数清理
    const sanitizedArgs = this.sanitizeArgs(channel, args);

    // 4. 记录审计日志
    this.addAuditLog({
      type: 'ipc_call',
      channel: channel,
      argsLength: args.length,
      timestamp: new Date().toISOString(),
    });

    return sanitizedArgs;
  }

  /**
   * 添加审计日志
   */
  addAuditLog(entry) {
    this.auditLog.push(entry);

    // 限制日志大小
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLogSize);
    }
  }

  /**
   * 获取审计日志
   */
  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  /**
   * 保存审计日志到文件
   */
  async saveAuditLog() {
    try {
      const userDataPath = app.getPath('userData');
      const logPath = path.join(userDataPath, 'audit.log');

      await fs.writeFile(
        logPath,
        this.auditLog.map(entry => JSON.stringify(entry)).join('\n'),
        'utf8'
      );

      logger.info(`[IPCPermissionManager] 审计日志已保存到: ${logPath}`);
    } catch (error) {
      logger.error('[IPCPermissionManager] 保存审计日志失败:', error);
    }
  }

  /**
   * 加载审计日志
   */
  async loadAuditLog() {
    try {
      const userDataPath = app.getPath('userData');
      const logPath = path.join(userDataPath, 'audit.log');

      const exists = await fs.access(logPath).then(() => true).catch(() => false);
      if (!exists) {
        return;
      }

      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      this.auditLog = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null);

      logger.info(`[IPCPermissionManager] 已加载 ${this.auditLog.length} 条审计日志`);
    } catch (error) {
      logger.error('[IPCPermissionManager] 加载审计日志失败:', error);
    }
  }

  /**
   * 启动定期清理任务
   */
  startCleanupTask() {
    // 每5分钟清理一次速率限制缓存
    setInterval(() => {
      const now = Date.now();
      for (const [key, cache] of this.rateLimitCache.entries()) {
        cache.requests = cache.requests.filter(time => now - time < 60000);
        if (cache.requests.length === 0) {
          this.rateLimitCache.delete(key);
        }
      }
    }, 5 * 60 * 1000);

    // 每小时保存一次审计日志
    setInterval(() => {
      this.saveAuditLog();
    }, 60 * 60 * 1000);
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      currentPermissionLevel: this.userPermissionLevel,
      rateLimitCacheSize: this.rateLimitCache.size,
      auditLogSize: this.auditLog.length,
      recentDenials: this.auditLog
        .filter(entry => entry.type === 'permission_denied')
        .slice(-10),
      recentRateLimits: this.auditLog
        .filter(entry => entry.type === 'rate_limit_exceeded')
        .slice(-10),
    };
  }
}

// 创建单例实例
let instance = null;

/**
 * 获取权限管理器实例
 */
function getIPCPermissionManager() {
  if (!instance) {
    instance = new IPCPermissionManager();
  }
  return instance;
}

module.exports = {
  IPCPermissionManager,
  getIPCPermissionManager,
  PermissionLevel,
};
