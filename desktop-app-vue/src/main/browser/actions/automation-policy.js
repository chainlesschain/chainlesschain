/**
 * AutomationPolicy - 自动化策略引擎
 *
 * 定义和执行自动化安全策略：
 * - URL 白名单/黑名单
 * - 操作类型限制
 * - 时间窗口限制
 * - 敏感区域保护
 *
 * @module browser/actions/automation-policy
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 策略类型
 */
const PolicyType = {
  URL_WHITELIST: 'url_whitelist',     // URL 白名单
  URL_BLACKLIST: 'url_blacklist',     // URL 黑名单
  DOMAIN_WHITELIST: 'domain_whitelist', // 域名白名单
  DOMAIN_BLACKLIST: 'domain_blacklist', // 域名黑名单
  ACTION_RESTRICTION: 'action_restriction', // 操作限制
  TIME_WINDOW: 'time_window',         // 时间窗口
  RATE_LIMIT: 'rate_limit',           // 频率限制
  REGION_PROTECTION: 'region_protection', // 区域保护
  CONTENT_FILTER: 'content_filter',   // 内容过滤
  CONFIRMATION_REQUIRED: 'confirmation_required' // 需要确认
};

/**
 * 策略动作
 */
const PolicyAction = {
  ALLOW: 'allow',           // 允许
  DENY: 'deny',             // 拒绝
  ASK: 'ask',               // 询问用户
  LOG: 'log',               // 仅记录
  DELAY: 'delay',           // 延迟执行
  MODIFY: 'modify'          // 修改操作
};

/**
 * 默认策略配置
 */
const DEFAULT_POLICIES = [
  {
    id: 'default-deny-payment',
    name: '支付页面保护',
    type: PolicyType.DOMAIN_BLACKLIST,
    enabled: true,
    priority: 100,
    config: {
      patterns: ['*payment*', '*checkout*', '*billing*', '*pay.*'],
      action: PolicyAction.ASK,
      message: '检测到支付页面，是否继续自动化操作？'
    }
  },
  {
    id: 'default-deny-login',
    name: '登录页面保护',
    type: PolicyType.CONTENT_FILTER,
    enabled: true,
    priority: 90,
    config: {
      patterns: ['password', 'login', 'signin', '密码', '登录'],
      action: PolicyAction.ASK,
      message: '检测到登录操作，是否继续？'
    }
  },
  {
    id: 'default-rate-limit',
    name: '默认频率限制',
    type: PolicyType.RATE_LIMIT,
    enabled: true,
    priority: 50,
    config: {
      maxActions: 60,
      windowMs: 60000, // 1 分钟
      action: PolicyAction.DELAY,
      delayMs: 1000
    }
  }
];

class AutomationPolicy extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enablePolicies: config.enablePolicies !== false,
      defaultAction: config.defaultAction || PolicyAction.ALLOW,
      logViolations: config.logViolations !== false,
      askHandler: config.askHandler || null,
      ...config
    };

    // 策略列表
    this.policies = new Map();

    // 加载默认策略
    if (config.loadDefaults !== false) {
      this._loadDefaultPolicies();
    }

    // 加载自定义策略
    if (config.policies) {
      for (const policy of config.policies) {
        this.addPolicy(policy);
      }
    }

    // 频率限制计数器
    this.rateLimitCounters = new Map();

    // 策略违规历史
    this.violations = [];
    this.maxViolations = 1000;

    // 统计
    this.stats = {
      totalChecks: 0,
      allowed: 0,
      denied: 0,
      asked: 0,
      byPolicy: {}
    };
  }

  /**
   * 加载默认策略
   * @private
   */
  _loadDefaultPolicies() {
    for (const policy of DEFAULT_POLICIES) {
      this.addPolicy(policy);
    }
  }

  /**
   * 添加策略
   * @param {Object} policy - 策略配置
   * @returns {Object}
   */
  addPolicy(policy) {
    if (!policy.id) {
      policy.id = `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    const normalizedPolicy = {
      id: policy.id,
      name: policy.name || policy.id,
      type: policy.type || PolicyType.URL_BLACKLIST,
      enabled: policy.enabled !== false,
      priority: policy.priority || 500,
      config: policy.config || {},
      createdAt: Date.now()
    };

    this.policies.set(policy.id, normalizedPolicy);

    this.emit('policyAdded', normalizedPolicy);

    return { success: true, policy: normalizedPolicy };
  }

  /**
   * 移除策略
   * @param {string} policyId - 策略 ID
   * @returns {Object}
   */
  removePolicy(policyId) {
    if (!this.policies.has(policyId)) {
      return { success: false, error: 'Policy not found' };
    }

    const policy = this.policies.get(policyId);
    this.policies.delete(policyId);

    this.emit('policyRemoved', policy);

    return { success: true };
  }

  /**
   * 更新策略
   * @param {string} policyId - 策略 ID
   * @param {Object} updates - 更新内容
   * @returns {Object}
   */
  updatePolicy(policyId, updates) {
    if (!this.policies.has(policyId)) {
      return { success: false, error: 'Policy not found' };
    }

    const policy = this.policies.get(policyId);
    const updatedPolicy = { ...policy, ...updates, id: policyId };
    this.policies.set(policyId, updatedPolicy);

    this.emit('policyUpdated', updatedPolicy);

    return { success: true, policy: updatedPolicy };
  }

  /**
   * 启用/禁用策略
   * @param {string} policyId - 策略 ID
   * @param {boolean} enabled - 是否启用
   * @returns {Object}
   */
  setEnabled(policyId, enabled) {
    return this.updatePolicy(policyId, { enabled });
  }

  /**
   * 检查操作是否允许
   * @param {Object} context - 操作上下文
   * @returns {Promise<Object>}
   */
  async check(context) {
    this.stats.totalChecks++;

    if (!this.config.enablePolicies) {
      this.stats.allowed++;
      return { allowed: true, action: PolicyAction.ALLOW };
    }

    const { url, action, target, content } = context;

    // 获取按优先级排序的策略
    const sortedPolicies = Array.from(this.policies.values())
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const policy of sortedPolicies) {
      const result = await this._checkPolicy(policy, context);

      if (result.matched) {
        this._updatePolicyStats(policy.id);

        if (result.action === PolicyAction.DENY) {
          this.stats.denied++;
          this._recordViolation(policy, context, result);
          return {
            allowed: false,
            action: PolicyAction.DENY,
            policy: policy.id,
            reason: result.reason || policy.config.message
          };
        }

        if (result.action === PolicyAction.ASK) {
          this.stats.asked++;
          const userResponse = await this._askUser(policy, context);
          if (!userResponse.allowed) {
            return {
              allowed: false,
              action: PolicyAction.DENY,
              policy: policy.id,
              reason: 'User denied'
            };
          }
        }

        if (result.action === PolicyAction.DELAY) {
          await this._delay(result.delayMs || 1000);
        }

        if (result.action === PolicyAction.LOG) {
          this.emit('policyLog', { policy, context, result });
        }
      }
    }

    this.stats.allowed++;
    return { allowed: true, action: PolicyAction.ALLOW };
  }

  /**
   * 检查单个策略
   * @private
   */
  async _checkPolicy(policy, context) {
    switch (policy.type) {
      case PolicyType.URL_WHITELIST:
        return this._checkUrlWhitelist(policy, context);

      case PolicyType.URL_BLACKLIST:
        return this._checkUrlBlacklist(policy, context);

      case PolicyType.DOMAIN_WHITELIST:
        return this._checkDomainWhitelist(policy, context);

      case PolicyType.DOMAIN_BLACKLIST:
        return this._checkDomainBlacklist(policy, context);

      case PolicyType.ACTION_RESTRICTION:
        return this._checkActionRestriction(policy, context);

      case PolicyType.TIME_WINDOW:
        return this._checkTimeWindow(policy, context);

      case PolicyType.RATE_LIMIT:
        return this._checkRateLimit(policy, context);

      case PolicyType.REGION_PROTECTION:
        return this._checkRegionProtection(policy, context);

      case PolicyType.CONTENT_FILTER:
        return this._checkContentFilter(policy, context);

      case PolicyType.CONFIRMATION_REQUIRED:
        return this._checkConfirmationRequired(policy, context);

      default:
        return { matched: false };
    }
  }

  /**
   * URL 白名单检查
   * @private
   */
  _checkUrlWhitelist(policy, context) {
    const { patterns } = policy.config;
    const url = context.url || '';

    const inWhitelist = patterns.some(pattern => this._matchPattern(url, pattern));

    if (!inWhitelist) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: 'URL not in whitelist'
      };
    }

    return { matched: false };
  }

  /**
   * URL 黑名单检查
   * @private
   */
  _checkUrlBlacklist(policy, context) {
    const { patterns } = policy.config;
    const url = context.url || '';

    const inBlacklist = patterns.some(pattern => this._matchPattern(url, pattern));

    if (inBlacklist) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: 'URL in blacklist'
      };
    }

    return { matched: false };
  }

  /**
   * 域名白名单检查
   * @private
   */
  _checkDomainWhitelist(policy, context) {
    const { patterns } = policy.config;
    const domain = this._extractDomain(context.url || '');

    const inWhitelist = patterns.some(pattern => this._matchPattern(domain, pattern));

    if (!inWhitelist && domain) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: 'Domain not in whitelist'
      };
    }

    return { matched: false };
  }

  /**
   * 域名黑名单检查
   * @private
   */
  _checkDomainBlacklist(policy, context) {
    const { patterns } = policy.config;
    const domain = this._extractDomain(context.url || '');

    const inBlacklist = patterns.some(pattern => this._matchPattern(domain, pattern));

    if (inBlacklist) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.ASK,
        reason: policy.config.message || 'Domain in blacklist'
      };
    }

    return { matched: false };
  }

  /**
   * 操作限制检查
   * @private
   */
  _checkActionRestriction(policy, context) {
    const { restrictedActions, allowedActions } = policy.config;
    const action = context.action || '';

    if (restrictedActions && restrictedActions.includes(action)) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: `Action '${action}' is restricted`
      };
    }

    if (allowedActions && !allowedActions.includes(action)) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: `Action '${action}' is not allowed`
      };
    }

    return { matched: false };
  }

  /**
   * 时间窗口检查
   * @private
   */
  _checkTimeWindow(policy, context) {
    const { startHour, endHour, daysOfWeek } = policy.config;
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // 检查星期
    if (daysOfWeek && !daysOfWeek.includes(day)) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DENY,
        reason: 'Automation not allowed on this day'
      };
    }

    // 检查小时
    if (startHour !== undefined && endHour !== undefined) {
      const inWindow = startHour <= endHour
        ? (hour >= startHour && hour < endHour)
        : (hour >= startHour || hour < endHour);

      if (!inWindow) {
        return {
          matched: true,
          action: policy.config.action || PolicyAction.DENY,
          reason: `Automation only allowed between ${startHour}:00 and ${endHour}:00`
        };
      }
    }

    return { matched: false };
  }

  /**
   * 频率限制检查
   * @private
   */
  _checkRateLimit(policy, context) {
    const { maxActions, windowMs } = policy.config;
    const key = policy.id;
    const now = Date.now();

    if (!this.rateLimitCounters.has(key)) {
      this.rateLimitCounters.set(key, { count: 0, windowStart: now });
    }

    const counter = this.rateLimitCounters.get(key);

    // 检查是否需要重置窗口
    if (now - counter.windowStart >= windowMs) {
      counter.count = 0;
      counter.windowStart = now;
    }

    counter.count++;

    if (counter.count > maxActions) {
      return {
        matched: true,
        action: policy.config.action || PolicyAction.DELAY,
        delayMs: policy.config.delayMs || 1000,
        reason: `Rate limit exceeded: ${counter.count}/${maxActions} in ${windowMs}ms`
      };
    }

    return { matched: false };
  }

  /**
   * 区域保护检查
   * @private
   */
  _checkRegionProtection(policy, context) {
    const { protectedRegions } = policy.config;
    const { x, y } = context.target || {};

    if (x === undefined || y === undefined) {
      return { matched: false };
    }

    for (const region of protectedRegions || []) {
      if (
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height
      ) {
        return {
          matched: true,
          action: policy.config.action || PolicyAction.DENY,
          reason: `Click in protected region: ${region.name || 'unnamed'}`
        };
      }
    }

    return { matched: false };
  }

  /**
   * 内容过滤检查
   * @private
   */
  _checkContentFilter(policy, context) {
    const { patterns } = policy.config;
    const content = (context.content || context.value || '').toLowerCase();
    const url = (context.url || '').toLowerCase();

    for (const pattern of patterns || []) {
      const lowerPattern = pattern.toLowerCase();
      if (content.includes(lowerPattern) || url.includes(lowerPattern)) {
        return {
          matched: true,
          action: policy.config.action || PolicyAction.ASK,
          reason: policy.config.message || `Content matched filter: ${pattern}`
        };
      }
    }

    return { matched: false };
  }

  /**
   * 确认检查
   * @private
   */
  _checkConfirmationRequired(policy, context) {
    const { actions, urlPatterns } = policy.config;

    // 检查操作类型
    if (actions && actions.includes(context.action)) {
      return {
        matched: true,
        action: PolicyAction.ASK,
        reason: policy.config.message || `Confirmation required for ${context.action}`
      };
    }

    // 检查 URL
    if (urlPatterns) {
      for (const pattern of urlPatterns) {
        if (this._matchPattern(context.url || '', pattern)) {
          return {
            matched: true,
            action: PolicyAction.ASK,
            reason: policy.config.message || 'Confirmation required'
          };
        }
      }
    }

    return { matched: false };
  }

  /**
   * 模式匹配
   * @private
   */
  _matchPattern(text, pattern) {
    // 支持通配符 *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(regexPattern, 'i');
    return regex.test(text);
  }

  /**
   * 提取域名
   * @private
   */
  _extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  /**
   * 询问用户
   * @private
   */
  async _askUser(policy, context) {
    if (this.config.askHandler) {
      return this.config.askHandler(policy, context);
    }

    // 默认允许
    this.emit('askUser', { policy, context });
    return { allowed: true };
  }

  /**
   * 延迟
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新策略统计
   * @private
   */
  _updatePolicyStats(policyId) {
    if (!this.stats.byPolicy[policyId]) {
      this.stats.byPolicy[policyId] = 0;
    }
    this.stats.byPolicy[policyId]++;
  }

  /**
   * 记录违规
   * @private
   */
  _recordViolation(policy, context, result) {
    const violation = {
      policyId: policy.id,
      policyName: policy.name,
      context: {
        url: context.url,
        action: context.action,
        target: context.target
      },
      reason: result.reason,
      timestamp: Date.now()
    };

    this.violations.push(violation);

    if (this.violations.length > this.maxViolations) {
      this.violations = this.violations.slice(-this.maxViolations / 2);
    }

    if (this.config.logViolations) {
      this.emit('violation', violation);
    }
  }

  /**
   * 获取所有策略
   * @returns {Array}
   */
  list() {
    return Array.from(this.policies.values())
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取策略
   * @param {string} policyId - 策略 ID
   * @returns {Object|null}
   */
  get(policyId) {
    return this.policies.get(policyId) || null;
  }

  /**
   * 获取违规历史
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getViolations(limit = 50) {
    return this.violations.slice(-limit).reverse();
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalChecks: 0,
      allowed: 0,
      denied: 0,
      asked: 0,
      byPolicy: {}
    };
    this.violations = [];
    this.rateLimitCounters.clear();

    this.emit('reset');
  }

  /**
   * 导出策略
   * @returns {Object}
   */
  export() {
    return {
      policies: Array.from(this.policies.values()),
      exportedAt: Date.now()
    };
  }

  /**
   * 导入策略
   * @param {Object} data - 导入数据
   * @param {boolean} merge - 是否合并
   * @returns {Object}
   */
  import(data, merge = false) {
    if (!merge) {
      this.policies.clear();
    }

    let imported = 0;
    for (const policy of data.policies || []) {
      this.addPolicy(policy);
      imported++;
    }

    return { success: true, imported };
  }
}

// 单例
let policyInstance = null;

function getAutomationPolicy(config) {
  if (!policyInstance) {
    policyInstance = new AutomationPolicy(config);
  }
  return policyInstance;
}

module.exports = {
  AutomationPolicy,
  PolicyType,
  PolicyAction,
  getAutomationPolicy
};
