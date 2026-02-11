/**
 * AuditLogger - Computer Use 操作审计日志
 *
 * 记录所有电脑操作，用于：
 * - 安全审计
 * - 操作回放
 * - 问题排查
 * - 合规性记录
 *
 * @module browser/actions/audit-logger
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * 操作类型
 */
const OperationType = {
  MOUSE_CLICK: 'mouse_click',
  MOUSE_MOVE: 'mouse_move',
  MOUSE_DRAG: 'mouse_drag',
  KEYBOARD_TYPE: 'keyboard_type',
  KEYBOARD_KEY: 'keyboard_key',
  SCROLL: 'scroll',
  SCREENSHOT: 'screenshot',
  NAVIGATION: 'navigation',
  VISION_ANALYSIS: 'vision_analysis',
  VISION_CLICK: 'vision_click',
  NETWORK_INTERCEPT: 'network_intercept',
  DESKTOP_CLICK: 'desktop_click',
  DESKTOP_TYPE: 'desktop_type',
  DESKTOP_SCREENSHOT: 'desktop_screenshot'
};

/**
 * 风险级别
 */
const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * 审计日志条目
 */
class AuditEntry {
  constructor(data) {
    this.id = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = new Date().toISOString();
    this.type = data.type;
    this.action = data.action;
    this.params = this._sanitizeParams(data.params);
    this.result = data.result;
    this.success = data.success;
    this.error = data.error;
    this.duration = data.duration;
    this.riskLevel = this._assessRisk(data);
    this.context = {
      targetId: data.targetId,
      url: data.url,
      title: data.title,
      userAgent: data.userAgent
    };
    this.metadata = data.metadata || {};
  }

  /**
   * 净化敏感参数
   * @private
   */
  _sanitizeParams(params) {
    if (!params) return {};

    const sanitized = { ...params };

    // 掩盖敏感字段
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'credential'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }

    // 截断过长的文本
    if (sanitized.text && sanitized.text.length > 500) {
      sanitized.text = sanitized.text.substring(0, 500) + '...[TRUNCATED]';
    }

    // 移除大型数据
    if (sanitized.screenshot) {
      sanitized.screenshot = `[BASE64_IMAGE: ${sanitized.screenshot.length} bytes]`;
    }

    return sanitized;
  }

  /**
   * 评估操作风险
   * @private
   */
  _assessRisk(data) {
    const { type, action, params } = data;

    // 高风险操作
    if (type === OperationType.DESKTOP_CLICK || type === OperationType.DESKTOP_TYPE) {
      return RiskLevel.HIGH;
    }

    // 包含敏感关键词
    const sensitivePatterns = [
      /password/i, /credential/i, /secret/i,
      /bank/i, /payment/i, /credit/i,
      /admin/i, /root/i, /sudo/i
    ];

    const paramsStr = JSON.stringify(params || {});
    for (const pattern of sensitivePatterns) {
      if (pattern.test(paramsStr)) {
        return RiskLevel.MEDIUM;
      }
    }

    // 网络拦截
    if (type === OperationType.NETWORK_INTERCEPT) {
      return RiskLevel.MEDIUM;
    }

    return RiskLevel.LOW;
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      type: this.type,
      action: this.action,
      params: this.params,
      result: this.result,
      success: this.success,
      error: this.error,
      duration: this.duration,
      riskLevel: this.riskLevel,
      context: this.context,
      metadata: this.metadata
    };
  }
}

class AuditLogger extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      logToFile: config.logToFile !== false,
      logDir: config.logDir || path.join(process.cwd(), '.chainlesschain', 'audit-logs'),
      maxEntriesInMemory: config.maxEntriesInMemory || 1000,
      maxLogFileSize: config.maxLogFileSize || 10 * 1024 * 1024, // 10MB
      rotateDaily: config.rotateDaily !== false,
      includeScreenshots: config.includeScreenshots || false,
      alertOnHighRisk: config.alertOnHighRisk !== false,
      ...config
    };

    // 内存中的日志条目
    this.entries = [];

    // 当前日志文件
    this.currentLogFile = null;
    this.currentLogDate = null;

    // 统计
    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      byType: {},
      byRiskLevel: {
        [RiskLevel.LOW]: 0,
        [RiskLevel.MEDIUM]: 0,
        [RiskLevel.HIGH]: 0,
        [RiskLevel.CRITICAL]: 0
      }
    };

    // 初始化日志目录
    if (this.config.logToFile) {
      this._initLogDir();
    }
  }

  /**
   * 初始化日志目录
   * @private
   */
  async _initLogDir() {
    try {
      await fs.mkdir(this.config.logDir, { recursive: true });
    } catch (error) {
      console.error('[AuditLogger] Failed to create log directory:', error);
    }
  }

  /**
   * 获取当前日志文件路径
   * @private
   */
  _getLogFilePath() {
    const today = new Date().toISOString().split('T')[0];

    if (this.config.rotateDaily && this.currentLogDate !== today) {
      this.currentLogDate = today;
      this.currentLogFile = path.join(
        this.config.logDir,
        `computer-use-audit-${today}.jsonl`
      );
    }

    if (!this.currentLogFile) {
      this.currentLogFile = path.join(
        this.config.logDir,
        `computer-use-audit-${today}.jsonl`
      );
      this.currentLogDate = today;
    }

    return this.currentLogFile;
  }

  /**
   * 记录操作
   * @param {Object} data - 操作数据
   * @returns {AuditEntry}
   */
  async log(data) {
    if (!this.config.enabled) {
      return null;
    }

    const entry = new AuditEntry(data);

    // 更新统计
    this.stats.totalOperations++;
    if (entry.success) {
      this.stats.successfulOperations++;
    } else {
      this.stats.failedOperations++;
    }
    this.stats.byType[entry.type] = (this.stats.byType[entry.type] || 0) + 1;
    this.stats.byRiskLevel[entry.riskLevel]++;

    // 添加到内存
    this.entries.push(entry);
    if (this.entries.length > this.config.maxEntriesInMemory) {
      this.entries.shift();
    }

    // 写入文件
    if (this.config.logToFile) {
      await this._writeToFile(entry);
    }

    // 高风险操作告警
    if (this.config.alertOnHighRisk &&
        (entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL)) {
      this.emit('highRiskOperation', entry);
    }

    this.emit('logged', entry);

    return entry;
  }

  /**
   * 写入文件
   * @private
   */
  async _writeToFile(entry) {
    try {
      const logFile = this._getLogFilePath();
      const line = JSON.stringify(entry.toJSON()) + '\n';
      await fs.appendFile(logFile, line, 'utf-8');
    } catch (error) {
      console.error('[AuditLogger] Failed to write log:', error);
    }
  }

  /**
   * 查询日志
   * @param {Object} filter - 过滤条件
   * @returns {Array<AuditEntry>}
   */
  query(filter = {}) {
    let results = [...this.entries];

    if (filter.type) {
      results = results.filter(e => e.type === filter.type);
    }
    if (filter.riskLevel) {
      results = results.filter(e => e.riskLevel === filter.riskLevel);
    }
    if (filter.success !== undefined) {
      results = results.filter(e => e.success === filter.success);
    }
    if (filter.since) {
      const sinceDate = new Date(filter.since);
      results = results.filter(e => new Date(e.timestamp) >= sinceDate);
    }
    if (filter.until) {
      const untilDate = new Date(filter.until);
      results = results.filter(e => new Date(e.timestamp) <= untilDate);
    }
    if (filter.targetId) {
      results = results.filter(e => e.context.targetId === filter.targetId);
    }
    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      entriesInMemory: this.entries.length,
      currentLogFile: this.currentLogFile
    };
  }

  /**
   * 获取高风险操作
   * @param {number} limit - 限制数量
   * @returns {Array<AuditEntry>}
   */
  getHighRiskOperations(limit = 50) {
    return this.query({
      riskLevel: RiskLevel.HIGH,
      limit
    }).concat(this.query({
      riskLevel: RiskLevel.CRITICAL,
      limit
    }));
  }

  /**
   * 获取失败操作
   * @param {number} limit - 限制数量
   * @returns {Array<AuditEntry>}
   */
  getFailedOperations(limit = 50) {
    return this.query({
      success: false,
      limit
    });
  }

  /**
   * 导出日志
   * @param {string} format - 导出格式 (json/csv)
   * @param {Object} filter - 过滤条件
   * @returns {string}
   */
  export(format = 'json', filter = {}) {
    const entries = this.query(filter);

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'type', 'action', 'success', 'riskLevel', 'duration'];
      const rows = entries.map(e => [
        e.id,
        e.timestamp,
        e.type,
        e.action,
        e.success,
        e.riskLevel,
        e.duration
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    return JSON.stringify(entries.map(e => e.toJSON()), null, 2);
  }

  /**
   * 清除内存中的日志
   */
  clear() {
    this.entries = [];
    this.emit('cleared');
  }

  /**
   * 创建操作包装器
   * 自动记录操作
   * @param {string} type - 操作类型
   * @param {Function} operation - 操作函数
   * @returns {Function}
   */
  wrap(type, operation) {
    return async (...args) => {
      const startTime = Date.now();
      let result;
      let success = false;
      let error = null;

      try {
        result = await operation(...args);
        success = result?.success !== false;
      } catch (e) {
        error = e.message;
        throw e;
      } finally {
        await this.log({
          type,
          action: operation.name || 'anonymous',
          params: args[0],
          result: success ? result : null,
          success,
          error,
          duration: Date.now() - startTime
        });
      }

      return result;
    };
  }
}

// 单例
let auditLoggerInstance = null;

function getAuditLogger(config) {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(config);
  }
  return auditLoggerInstance;
}

module.exports = {
  AuditLogger,
  AuditEntry,
  OperationType,
  RiskLevel,
  getAuditLogger
};
