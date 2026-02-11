/**
 * SafeMode - Computer Use 安全模式
 *
 * 提供操作权限控制和限制：
 * - 操作白名单/黑名单
 * - 区域限制
 * - 速率限制
 * - 确认提示
 *
 * @module browser/actions/safe-mode
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 安全级别
 */
const SafetyLevel = {
  UNRESTRICTED: 'unrestricted',   // 无限制
  NORMAL: 'normal',               // 普通（默认）
  CAUTIOUS: 'cautious',           // 谨慎
  STRICT: 'strict',               // 严格
  READONLY: 'readonly'            // 只读（仅允许截图和分析）
};

/**
 * 操作类别
 */
const ActionCategory = {
  READONLY: 'readonly',           // 只读操作（截图、分析）
  NAVIGATION: 'navigation',       // 导航操作
  INPUT: 'input',                 // 输入操作
  CLICK: 'click',                 // 点击操作
  DESKTOP: 'desktop',             // 桌面操作
  NETWORK: 'network',             // 网络操作
  SYSTEM: 'system'                // 系统操作
};

/**
 * 操作到类别的映射
 */
const ACTION_CATEGORY_MAP = {
  // 只读
  'screenshot': ActionCategory.READONLY,
  'analyze': ActionCategory.READONLY,
  'snapshot': ActionCategory.READONLY,
  'getStatus': ActionCategory.READONLY,

  // 导航
  'navigate': ActionCategory.NAVIGATION,
  'back': ActionCategory.NAVIGATION,
  'forward': ActionCategory.NAVIGATION,
  'refresh': ActionCategory.NAVIGATION,

  // 输入
  'type': ActionCategory.INPUT,
  'key': ActionCategory.INPUT,
  'keyboard': ActionCategory.INPUT,

  // 点击
  'click': ActionCategory.CLICK,
  'doubleClick': ActionCategory.CLICK,
  'rightClick': ActionCategory.CLICK,
  'move': ActionCategory.CLICK,
  'drag': ActionCategory.CLICK,
  'scroll': ActionCategory.CLICK,
  'visualClick': ActionCategory.CLICK,

  // 桌面
  'desktopClick': ActionCategory.DESKTOP,
  'desktopType': ActionCategory.DESKTOP,
  'desktopKey': ActionCategory.DESKTOP,
  'desktopCapture': ActionCategory.DESKTOP,
  'desktopDrag': ActionCategory.DESKTOP,

  // 网络
  'intercept': ActionCategory.NETWORK,
  'mockAPI': ActionCategory.NETWORK,
  'blockResource': ActionCategory.NETWORK,

  // 系统
  'clipboard': ActionCategory.SYSTEM,
  'focusWindow': ActionCategory.SYSTEM,
  'setWindowBounds': ActionCategory.SYSTEM
};

/**
 * 安全级别对应的允许类别
 */
const LEVEL_ALLOWED_CATEGORIES = {
  [SafetyLevel.UNRESTRICTED]: Object.values(ActionCategory),
  [SafetyLevel.NORMAL]: [
    ActionCategory.READONLY,
    ActionCategory.NAVIGATION,
    ActionCategory.INPUT,
    ActionCategory.CLICK
  ],
  [SafetyLevel.CAUTIOUS]: [
    ActionCategory.READONLY,
    ActionCategory.NAVIGATION,
    ActionCategory.INPUT,
    ActionCategory.CLICK
  ],
  [SafetyLevel.STRICT]: [
    ActionCategory.READONLY,
    ActionCategory.NAVIGATION
  ],
  [SafetyLevel.READONLY]: [
    ActionCategory.READONLY
  ]
};

class SafeMode extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      level: config.level || SafetyLevel.NORMAL,
      requireConfirmation: config.requireConfirmation || [],
      blockedActions: config.blockedActions || [],
      allowedActions: config.allowedActions || null, // null = 使用默认
      blockedUrls: config.blockedUrls || [],
      allowedUrls: config.allowedUrls || null,
      restrictedRegions: config.restrictedRegions || [],
      rateLimit: {
        enabled: config.rateLimit?.enabled || false,
        maxOperationsPerMinute: config.rateLimit?.maxOperationsPerMinute || 60,
        maxOperationsPerHour: config.rateLimit?.maxOperationsPerHour || 1000
      },
      desktopAllowed: config.desktopAllowed || false,
      networkInterceptionAllowed: config.networkInterceptionAllowed || false,
      confirmationTimeout: config.confirmationTimeout || 30000,
      ...config
    };

    // 操作计数器（用于速率限制）
    this.operationCounts = {
      minute: { count: 0, resetAt: Date.now() + 60000 },
      hour: { count: 0, resetAt: Date.now() + 3600000 }
    };

    // 确认请求队列
    this.pendingConfirmations = new Map();

    // 激活状态
    this.enabled = true;
  }

  /**
   * 设置安全级别
   * @param {string} level - 安全级别
   */
  setLevel(level) {
    if (!Object.values(SafetyLevel).includes(level)) {
      throw new Error(`Invalid safety level: ${level}`);
    }
    this.config.level = level;
    this.emit('levelChanged', { level });
  }

  /**
   * 启用/禁用安全模式
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.emit('enabledChanged', { enabled });
  }

  /**
   * 检查操作是否允许
   * @param {string} actionType - 操作类型
   * @param {Object} params - 操作参数
   * @param {Object} context - 上下文信息
   * @returns {Object} { allowed, reason, requiresConfirmation }
   */
  async checkPermission(actionType, params = {}, context = {}) {
    if (!this.enabled) {
      return { allowed: true, reason: 'Safe mode disabled' };
    }

    // 1. 检查操作是否在黑名单中
    if (this.config.blockedActions.includes(actionType)) {
      return {
        allowed: false,
        reason: `Action "${actionType}" is blocked`
      };
    }

    // 2. 检查操作类别是否允许
    const category = ACTION_CATEGORY_MAP[actionType] || ActionCategory.CLICK;
    const allowedCategories = LEVEL_ALLOWED_CATEGORIES[this.config.level];

    if (!allowedCategories.includes(category)) {
      return {
        allowed: false,
        reason: `Action category "${category}" not allowed at safety level "${this.config.level}"`
      };
    }

    // 3. 检查桌面操作
    if (category === ActionCategory.DESKTOP && !this.config.desktopAllowed) {
      return {
        allowed: false,
        reason: 'Desktop operations are not allowed'
      };
    }

    // 4. 检查网络拦截
    if (category === ActionCategory.NETWORK && !this.config.networkInterceptionAllowed) {
      return {
        allowed: false,
        reason: 'Network interception is not allowed'
      };
    }

    // 5. 检查 URL 限制
    if (context.url) {
      const urlCheck = this._checkUrl(context.url);
      if (!urlCheck.allowed) {
        return urlCheck;
      }
    }

    // 6. 检查区域限制
    if (params.x !== undefined && params.y !== undefined) {
      const regionCheck = this._checkRegion(params.x, params.y, context);
      if (!regionCheck.allowed) {
        return regionCheck;
      }
    }

    // 7. 检查速率限制
    if (this.config.rateLimit.enabled) {
      const rateCheck = this._checkRateLimit();
      if (!rateCheck.allowed) {
        return rateCheck;
      }
    }

    // 8. 检查是否需要确认
    const requiresConfirmation = this._requiresConfirmation(actionType, params, context);

    return {
      allowed: true,
      requiresConfirmation,
      category
    };
  }

  /**
   * 检查 URL 限制
   * @private
   */
  _checkUrl(url) {
    // 检查黑名单
    for (const pattern of this.config.blockedUrls) {
      if (this._matchUrlPattern(url, pattern)) {
        return {
          allowed: false,
          reason: `URL "${url}" is blocked`
        };
      }
    }

    // 检查白名单（如果设置）
    if (this.config.allowedUrls && this.config.allowedUrls.length > 0) {
      const isAllowed = this.config.allowedUrls.some(pattern =>
        this._matchUrlPattern(url, pattern)
      );
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `URL "${url}" is not in allowed list`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 匹配 URL 模式
   * @private
   */
  _matchUrlPattern(url, pattern) {
    if (pattern instanceof RegExp) {
      return pattern.test(url);
    }

    // 简单通配符匹配
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i'
    );
    return regex.test(url);
  }

  /**
   * 检查区域限制
   * @private
   */
  _checkRegion(x, y, context) {
    for (const region of this.config.restrictedRegions) {
      if (x >= region.x && x <= region.x + region.width &&
          y >= region.y && y <= region.y + region.height) {
        return {
          allowed: false,
          reason: `Position (${x}, ${y}) is in restricted region "${region.name || 'unnamed'}"`
        };
      }
    }
    return { allowed: true };
  }

  /**
   * 检查速率限制
   * @private
   */
  _checkRateLimit() {
    const now = Date.now();

    // 重置计数器
    if (now >= this.operationCounts.minute.resetAt) {
      this.operationCounts.minute = { count: 0, resetAt: now + 60000 };
    }
    if (now >= this.operationCounts.hour.resetAt) {
      this.operationCounts.hour = { count: 0, resetAt: now + 3600000 };
    }

    // 检查限制
    if (this.operationCounts.minute.count >= this.config.rateLimit.maxOperationsPerMinute) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded (per minute)',
        retryAfter: this.operationCounts.minute.resetAt - now
      };
    }

    if (this.operationCounts.hour.count >= this.config.rateLimit.maxOperationsPerHour) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded (per hour)',
        retryAfter: this.operationCounts.hour.resetAt - now
      };
    }

    return { allowed: true };
  }

  /**
   * 记录操作（用于速率限制）
   */
  recordOperation() {
    this.operationCounts.minute.count++;
    this.operationCounts.hour.count++;
  }

  /**
   * 检查是否需要确认
   * @private
   */
  _requiresConfirmation(actionType, params, context) {
    // 明确要求确认的操作
    if (this.config.requireConfirmation.includes(actionType)) {
      return true;
    }

    // 谨慎模式下，所有输入操作需要确认
    if (this.config.level === SafetyLevel.CAUTIOUS) {
      const category = ACTION_CATEGORY_MAP[actionType];
      if (category === ActionCategory.INPUT || category === ActionCategory.CLICK) {
        return true;
      }
    }

    // 包含敏感关键词的输入需要确认
    if (actionType === 'type' && params.text) {
      const sensitivePatterns = [/password/i, /credential/i, /secret/i, /token/i];
      for (const pattern of sensitivePatterns) {
        if (pattern.test(params.text)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 请求用户确认
   * @param {string} actionType - 操作类型
   * @param {Object} params - 操作参数
   * @param {Object} context - 上下文
   * @returns {Promise<boolean>}
   */
  async requestConfirmation(actionType, params, context) {
    const confirmationId = `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const request = {
      id: confirmationId,
      actionType,
      params: this._sanitizeParams(params),
      context,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    this.pendingConfirmations.set(confirmationId, request);

    this.emit('confirmationRequired', request);

    // 等待确认或超时
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingConfirmations.delete(confirmationId);
        resolve(false);
      }, this.config.confirmationTimeout);

      const handler = (response) => {
        if (response.id === confirmationId) {
          clearTimeout(timeout);
          this.removeListener('confirmationResponse', handler);
          this.pendingConfirmations.delete(confirmationId);
          resolve(response.approved);
        }
      };

      this.on('confirmationResponse', handler);
    });
  }

  /**
   * 响应确认请求
   * @param {string} confirmationId - 确认请求 ID
   * @param {boolean} approved - 是否批准
   */
  respondToConfirmation(confirmationId, approved) {
    const request = this.pendingConfirmations.get(confirmationId);

    if (!request) {
      throw new Error('Confirmation request not found or expired');
    }

    request.status = approved ? 'approved' : 'rejected';
    request.respondedAt = new Date().toISOString();

    this.emit('confirmationResponse', {
      id: confirmationId,
      approved
    });

    this.emit('confirmationCompleted', request);

    return { success: true, approved };
  }

  /**
   * 获取待处理的确认请求
   * @returns {Array}
   */
  getPendingConfirmations() {
    return Array.from(this.pendingConfirmations.values());
  }

  /**
   * 净化参数（用于确认显示）
   * @private
   */
  _sanitizeParams(params) {
    if (!params) return {};

    const sanitized = { ...params };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'credential'];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***';
      }
    }

    return sanitized;
  }

  /**
   * 添加受限区域
   * @param {Object} region - { x, y, width, height, name }
   */
  addRestrictedRegion(region) {
    this.config.restrictedRegions.push(region);
  }

  /**
   * 移除受限区域
   * @param {string} name - 区域名称
   */
  removeRestrictedRegion(name) {
    this.config.restrictedRegions = this.config.restrictedRegions.filter(
      r => r.name !== name
    );
  }

  /**
   * 添加阻止的操作
   * @param {string} actionType
   */
  blockAction(actionType) {
    if (!this.config.blockedActions.includes(actionType)) {
      this.config.blockedActions.push(actionType);
    }
  }

  /**
   * 移除阻止的操作
   * @param {string} actionType
   */
  unblockAction(actionType) {
    this.config.blockedActions = this.config.blockedActions.filter(
      a => a !== actionType
    );
  }

  /**
   * 添加阻止的 URL
   * @param {string|RegExp} pattern
   */
  blockUrl(pattern) {
    this.config.blockedUrls.push(pattern);
  }

  /**
   * 移除阻止的 URL
   * @param {string|RegExp} pattern
   */
  unblockUrl(pattern) {
    this.config.blockedUrls = this.config.blockedUrls.filter(
      p => p.toString() !== pattern.toString()
    );
  }

  /**
   * 获取当前配置
   * @returns {Object}
   */
  getConfig() {
    return {
      enabled: this.enabled,
      level: this.config.level,
      desktopAllowed: this.config.desktopAllowed,
      networkInterceptionAllowed: this.config.networkInterceptionAllowed,
      blockedActions: this.config.blockedActions,
      blockedUrls: this.config.blockedUrls.map(u => u.toString()),
      restrictedRegions: this.config.restrictedRegions,
      rateLimit: this.config.rateLimit,
      requireConfirmation: this.config.requireConfirmation
    };
  }

  /**
   * 更新配置
   * @param {Object} updates
   */
  updateConfig(updates) {
    Object.assign(this.config, updates);
    this.emit('configUpdated', this.getConfig());
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.enabled,
      level: this.config.level,
      operationsThisMinute: this.operationCounts.minute.count,
      operationsThisHour: this.operationCounts.hour.count,
      pendingConfirmations: this.pendingConfirmations.size
    };
  }

  /**
   * 创建安全执行包装器
   * @param {Function} operation
   * @param {string} actionType
   * @returns {Function}
   */
  wrap(operation, actionType) {
    return async (params = {}, context = {}) => {
      const permission = await this.checkPermission(actionType, params, context);

      if (!permission.allowed) {
        const error = new Error(permission.reason);
        error.code = 'PERMISSION_DENIED';
        this.emit('blocked', { actionType, params, reason: permission.reason });
        throw error;
      }

      if (permission.requiresConfirmation) {
        const confirmed = await this.requestConfirmation(actionType, params, context);
        if (!confirmed) {
          const error = new Error('User declined operation');
          error.code = 'USER_DECLINED';
          this.emit('declined', { actionType, params });
          throw error;
        }
      }

      this.recordOperation();

      try {
        const result = await operation(params, context);
        this.emit('executed', { actionType, params, success: true });
        return result;
      } catch (error) {
        this.emit('executed', { actionType, params, success: false, error: error.message });
        throw error;
      }
    };
  }
}

// 单例
let safeModeInstance = null;

function getSafeMode(config) {
  if (!safeModeInstance) {
    safeModeInstance = new SafeMode(config);
  }
  return safeModeInstance;
}

module.exports = {
  SafeMode,
  SafetyLevel,
  ActionCategory,
  getSafeMode
};
