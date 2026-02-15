/**
 * EnterpriseAuditLogger - 企业级统一审计日志
 *
 * 聚合所有子系统的审计事件（浏览器、权限、协作、文件、API等），
 * 提供统一的日志记录、查询、导出和统计能力。
 *
 * 设计参考: src/main/browser/actions/audit-logger.js
 *
 * @module audit/enterprise-audit-logger
 * @author ChainlessChain Team
 * @since v0.34.0
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

// ─── 常量定义 ───

/**
 * 审计事件类型
 */
const EventType = {
  BROWSER: 'browser',
  PERMISSION: 'permission',
  FILE: 'file',
  DB: 'db',
  API: 'api',
  COWORK: 'cowork',
  AUTH: 'auth',
  SYSTEM: 'system'
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
 * 风险级别权重 (用于排序和阈值判断)
 */
const RiskWeight = {
  [RiskLevel.LOW]: 1,
  [RiskLevel.MEDIUM]: 2,
  [RiskLevel.HIGH]: 3,
  [RiskLevel.CRITICAL]: 4
};

/**
 * 需要脱敏的敏感字段
 */
const SENSITIVE_FIELDS = [
  'password', 'passwd', 'pwd',
  'token', 'accessToken', 'refreshToken', 'access_token', 'refresh_token',
  'secret', 'clientSecret', 'client_secret',
  'apiKey', 'api_key', 'apikey',
  'credential', 'credentials',
  'privateKey', 'private_key',
  'authorization', 'cookie',
  'pin', 'cvv', 'ssn'
];

/**
 * 高风险操作映射
 */
const HIGH_RISK_OPERATIONS = {
  [EventType.PERMISSION]: ['grant_admin', 'revoke_all', 'delete_role', 'elevate_privilege'],
  [EventType.AUTH]: ['login_failed', 'password_reset', 'mfa_disabled', 'account_locked'],
  [EventType.DB]: ['drop_table', 'truncate', 'delete_all', 'schema_change'],
  [EventType.FILE]: ['delete_recursive', 'chmod_777', 'move_system_file'],
  [EventType.SYSTEM]: ['shutdown', 'config_change', 'plugin_install', 'update_apply'],
  [EventType.BROWSER]: ['desktop_click', 'desktop_type', 'execute_script'],
  [EventType.API]: ['bulk_delete', 'export_all', 'key_rotation'],
  [EventType.COWORK]: ['agent_spawn', 'sandbox_escape', 'tool_override']
};

/**
 * 关键风险操作 (CRITICAL级别)
 */
const CRITICAL_OPERATIONS = [
  'delete_database', 'factory_reset', 'bypass_security',
  'export_private_keys', 'disable_audit', 'root_access',
  'sandbox_escape', 'inject_code'
];

// ─── 主类 ───

class EnterpriseAuditLogger extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - 数据库实例 (db.run/db.get/db.all)
   * @param {Object} [options.hookSystem] - HookSystem 实例 (可选)
   * @param {boolean} [options.enabled=true] - 是否启用
   * @param {number} [options.maxMemoryEntries=2000] - 内存中最大条目数
   * @param {boolean} [options.alertOnHighRisk=true] - 高风险操作是否告警
   */
  constructor({ database, hookSystem, enabled, maxMemoryEntries, alertOnHighRisk } = {}) {
    super();

    this.db = database || null;
    this.hookSystem = hookSystem || null;
    this.enabled = enabled !== false;
    this.maxMemoryEntries = maxMemoryEntries || 2000;
    this.alertOnHighRisk = alertOnHighRisk !== false;

    // 内存缓冲 (用于无数据库场景或快速查询)
    this.memoryBuffer = [];

    // 表初始化状态
    this._tableInitialized = false;

    // 统计缓存
    this._statsCache = {
      totalLogs: 0,
      byEventType: {},
      byRiskLevel: {
        [RiskLevel.LOW]: 0,
        [RiskLevel.MEDIUM]: 0,
        [RiskLevel.HIGH]: 0,
        [RiskLevel.CRITICAL]: 0
      }
    };

    // 初始化数据库表
    if (this.db) {
      this._initTable().catch(err => {
        logger.error('[EnterpriseAuditLogger] Failed to initialize table:', err);
      });
    }

    // 集成 HookSystem
    if (this.hookSystem) {
      this._registerHookListeners();
    }

    logger.info('[EnterpriseAuditLogger] Initialized', {
      enabled: this.enabled,
      hasDatabase: !!this.db,
      hasHookSystem: !!this.hookSystem
    });
  }

  // ─── 数据库初始化 ───

  /**
   * 初始化审计日志表
   * @private
   */
  async _initTable() {
    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS enterprise_audit_log (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL,
          operation TEXT NOT NULL,
          actor TEXT DEFAULT 'system',
          risk_level TEXT NOT NULL DEFAULT 'low',
          success INTEGER NOT NULL DEFAULT 1,
          details TEXT,
          context TEXT,
          error_message TEXT,
          duration INTEGER,
          ip_address TEXT,
          session_id TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      // 创建索引加速查询
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON enterprise_audit_log(timestamp)
      `);
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_event_type ON enterprise_audit_log(event_type)
      `);
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_risk_level ON enterprise_audit_log(risk_level)
      `);
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON enterprise_audit_log(actor)
      `);
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_created_at ON enterprise_audit_log(created_at)
      `);

      this._tableInitialized = true;
      logger.info('[EnterpriseAuditLogger] Database table initialized');
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Table initialization failed:', error);
      this._tableInitialized = false;
    }
  }

  // ─── 核心日志方法 ───

  /**
   * 记录审计日志
   * @param {string} eventType - 事件类型 (EventType)
   * @param {string} operation - 操作名称
   * @param {Object} [details={}] - 操作详情
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async log(eventType, operation, details = {}) {
    if (!this.enabled) {
      return { success: false, error: 'Audit logger is disabled' };
    }

    // 验证事件类型
    if (!Object.values(EventType).includes(eventType)) {
      return { success: false, error: `Invalid event type: ${eventType}` };
    }

    try {
      const id = uuidv4();
      const timestamp = new Date().toISOString();
      const riskLevel = this.assessRisk(eventType, operation, details);
      const sanitizedDetails = this.sanitizeData(details);

      const entry = {
        id,
        timestamp,
        eventType,
        operation,
        actor: sanitizedDetails.actor || 'system',
        riskLevel,
        success: sanitizedDetails.success !== false,
        details: sanitizedDetails,
        context: sanitizedDetails.context || null,
        errorMessage: sanitizedDetails.error || null,
        duration: sanitizedDetails.duration || null,
        ipAddress: sanitizedDetails.ipAddress || null,
        sessionId: sanitizedDetails.sessionId || null,
        createdAt: Date.now()
      };

      // 写入数据库
      if (this.db && this._tableInitialized) {
        await this._writeToDatabase(entry);
      }

      // 写入内存缓冲
      this._writeToMemory(entry);

      // 更新统计
      this._updateStats(entry);

      // 高风险告警
      if (this.alertOnHighRisk &&
          (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL)) {
        this.emit('highRiskEvent', entry);
        logger.warn('[EnterpriseAuditLogger] High risk operation detected', {
          eventType,
          operation,
          riskLevel,
          actor: entry.actor
        });
      }

      this.emit('logged', entry);

      return { success: true, data: { id, riskLevel } };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Failed to log event:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 写入数据库
   * @private
   */
  async _writeToDatabase(entry) {
    const detailsJson = JSON.stringify(entry.details);
    const contextJson = entry.context ? JSON.stringify(entry.context) : null;

    await this.db.run(
      `INSERT INTO enterprise_audit_log
        (id, timestamp, event_type, operation, actor, risk_level, success,
         details, context, error_message, duration, ip_address, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id, entry.timestamp, entry.eventType, entry.operation,
        entry.actor, entry.riskLevel, entry.success ? 1 : 0,
        detailsJson, contextJson, entry.errorMessage,
        entry.duration, entry.ipAddress, entry.sessionId, entry.createdAt
      ]
    );
  }

  /**
   * 写入内存缓冲
   * @private
   */
  _writeToMemory(entry) {
    this.memoryBuffer.push(entry);
    if (this.memoryBuffer.length > this.maxMemoryEntries) {
      this.memoryBuffer.shift();
    }
  }

  /**
   * 更新统计缓存
   * @private
   */
  _updateStats(entry) {
    this._statsCache.totalLogs++;
    this._statsCache.byEventType[entry.eventType] =
      (this._statsCache.byEventType[entry.eventType] || 0) + 1;
    this._statsCache.byRiskLevel[entry.riskLevel] =
      (this._statsCache.byRiskLevel[entry.riskLevel] || 0) + 1;
  }

  // ─── 风险评估 ───

  /**
   * 评估操作风险级别
   * @param {string} eventType - 事件类型
   * @param {string} operation - 操作名称
   * @param {Object} [details={}] - 操作详情
   * @returns {string} 风险级别
   */
  assessRisk(eventType, operation, details = {}) {
    const opLower = (operation || '').toLowerCase();

    // CRITICAL: 匹配关键危险操作
    if (CRITICAL_OPERATIONS.some(op => opLower.includes(op))) {
      return RiskLevel.CRITICAL;
    }

    // HIGH: 匹配高风险操作映射
    const highRiskOps = HIGH_RISK_OPERATIONS[eventType] || [];
    if (highRiskOps.some(op => opLower.includes(op))) {
      return RiskLevel.HIGH;
    }

    // MEDIUM: 包含敏感关键词的操作
    const sensitivePatterns = [
      /password/i, /credential/i, /secret/i,
      /admin/i, /delete/i, /remove/i,
      /export/i, /import/i, /migrate/i,
      /permission/i, /role/i, /privilege/i,
      /encrypt/i, /decrypt/i
    ];

    const contextStr = JSON.stringify(details);
    for (const pattern of sensitivePatterns) {
      if (pattern.test(opLower) || pattern.test(contextStr)) {
        return RiskLevel.MEDIUM;
      }
    }

    // AUTH 和 PERMISSION 事件最低为 MEDIUM
    if (eventType === EventType.AUTH || eventType === EventType.PERMISSION) {
      return RiskLevel.MEDIUM;
    }

    return RiskLevel.LOW;
  }

  // ─── 数据脱敏 ───

  /**
   * 脱敏处理敏感数据
   * @param {*} data - 待脱敏数据
   * @param {number} [depth=0] - 当前递归深度
   * @returns {*} 脱敏后的数据
   */
  sanitizeData(data, depth = 0) {
    if (depth > 10) return '[MAX_DEPTH_EXCEEDED]';
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
      // 截断超长字符串
      if (data.length > 1000) {
        return data.substring(0, 1000) + '...[TRUNCATED]';
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item, depth + 1));
    }

    if (typeof data === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        const keyLower = key.toLowerCase();

        // 检查是否为敏感字段
        if (SENSITIVE_FIELDS.some(f => keyLower === f.toLowerCase())) {
          sanitized[key] = '***REDACTED***';
          continue;
        }

        // 检查是否包含 base64 图片数据
        if (typeof value === 'string' && value.length > 5000 &&
            (key.toLowerCase().includes('image') ||
             key.toLowerCase().includes('screenshot') ||
             key.toLowerCase().includes('base64'))) {
          sanitized[key] = `[BINARY_DATA: ${value.length} bytes]`;
          continue;
        }

        sanitized[key] = this.sanitizeData(value, depth + 1);
      }
      return sanitized;
    }

    return data;
  }

  // ─── 查询接口 ───

  /**
   * 查询审计日志
   * @param {Object} [filters={}] - 过滤条件
   * @param {string} [filters.eventType] - 按事件类型过滤
   * @param {string} [filters.operation] - 按操作名模糊匹配
   * @param {string} [filters.actor] - 按操作人过滤
   * @param {string} [filters.riskLevel] - 按风险级别过滤
   * @param {string} [filters.startTime] - 开始时间 (ISO string)
   * @param {string} [filters.endTime] - 结束时间 (ISO string)
   * @param {boolean} [filters.successOnly] - 仅成功操作
   * @param {string} [filters.sessionId] - 按会话ID过滤
   * @param {number} [filters.page=1] - 页码
   * @param {number} [filters.pageSize=50] - 每页条数
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async query(filters = {}) {
    try {
      const page = Math.max(1, filters.page || 1);
      const pageSize = Math.min(500, Math.max(1, filters.pageSize || 50));
      const offset = (page - 1) * pageSize;

      // 优先从数据库查询
      if (this.db && this._tableInitialized) {
        return await this._queryFromDatabase(filters, pageSize, offset, page);
      }

      // 降级到内存查询
      return this._queryFromMemory(filters, pageSize, offset, page);
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Query failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从数据库查询
   * @private
   */
  async _queryFromDatabase(filters, pageSize, offset, page) {
    const conditions = [];
    const params = [];

    if (filters.eventType) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }
    if (filters.operation) {
      conditions.push('operation LIKE ?');
      params.push(`%${filters.operation}%`);
    }
    if (filters.actor) {
      conditions.push('actor = ?');
      params.push(filters.actor);
    }
    if (filters.riskLevel) {
      conditions.push('risk_level = ?');
      params.push(filters.riskLevel);
    }
    if (filters.startTime) {
      conditions.push('timestamp >= ?');
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      conditions.push('timestamp <= ?');
      params.push(filters.endTime);
    }
    if (filters.successOnly) {
      conditions.push('success = 1');
    }
    if (filters.sessionId) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // 查询总数
    const countRow = await this.db.get(
      `SELECT COUNT(*) as total FROM enterprise_audit_log ${whereClause}`,
      params
    );
    const total = countRow ? countRow.total : 0;

    // 查询数据
    const rows = await this.db.all(
      `SELECT * FROM enterprise_audit_log ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const logs = (rows || []).map(row => this._rowToEntry(row));

    return {
      success: true,
      data: {
        logs,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      }
    };
  }

  /**
   * 从内存查询
   * @private
   */
  _queryFromMemory(filters, pageSize, offset, page) {
    let results = [...this.memoryBuffer];

    if (filters.eventType) {
      results = results.filter(e => e.eventType === filters.eventType);
    }
    if (filters.operation) {
      const opLower = filters.operation.toLowerCase();
      results = results.filter(e => e.operation.toLowerCase().includes(opLower));
    }
    if (filters.actor) {
      results = results.filter(e => e.actor === filters.actor);
    }
    if (filters.riskLevel) {
      results = results.filter(e => e.riskLevel === filters.riskLevel);
    }
    if (filters.startTime) {
      results = results.filter(e => e.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      results = results.filter(e => e.timestamp <= filters.endTime);
    }
    if (filters.successOnly) {
      results = results.filter(e => e.success === true);
    }
    if (filters.sessionId) {
      results = results.filter(e => e.sessionId === filters.sessionId);
    }

    // 按时间倒序
    results.sort((a, b) => b.createdAt - a.createdAt);

    const total = results.length;
    const paginated = results.slice(offset, offset + pageSize);

    return {
      success: true,
      data: {
        logs: paginated,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      }
    };
  }

  /**
   * 数据库行转换为日志条目
   * @private
   */
  _rowToEntry(row) {
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      operation: row.operation,
      actor: row.actor,
      riskLevel: row.risk_level,
      success: row.success === 1,
      details: row.details ? JSON.parse(row.details) : {},
      context: row.context ? JSON.parse(row.context) : null,
      errorMessage: row.error_message,
      duration: row.duration,
      ipAddress: row.ip_address,
      sessionId: row.session_id,
      createdAt: row.created_at
    };
  }

  // ─── 单条日志详情 ───

  /**
   * 获取单条日志详情
   * @param {string} id - 日志ID
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async getLogDetail(id) {
    if (!id) {
      return { success: false, error: 'Log ID is required' };
    }

    try {
      // 优先数据库查询
      if (this.db && this._tableInitialized) {
        const row = await this.db.get(
          'SELECT * FROM enterprise_audit_log WHERE id = ?',
          [id]
        );

        if (!row) {
          return { success: false, error: 'Log entry not found' };
        }

        return { success: true, data: this._rowToEntry(row) };
      }

      // 降级到内存查询
      const entry = this.memoryBuffer.find(e => e.id === id);
      if (!entry) {
        return { success: false, error: 'Log entry not found' };
      }

      return { success: true, data: entry };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] getLogDetail failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── 统计分析 ───

  /**
   * 获取聚合统计
   * @param {Object} [timeRange={}] - 时间范围
   * @param {string} [timeRange.startTime] - 开始时间 (ISO string)
   * @param {string} [timeRange.endTime] - 结束时间 (ISO string)
   * @param {string} [timeRange.period='day'] - 聚合周期 (hour/day/week/month)
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async getStatistics(timeRange = {}) {
    try {
      const startTime = timeRange.startTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endTime = timeRange.endTime || new Date().toISOString();

      // 数据库统计
      if (this.db && this._tableInitialized) {
        return await this._getDbStatistics(startTime, endTime, timeRange.period);
      }

      // 内存统计
      return this._getMemoryStatistics(startTime, endTime);
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] getStatistics failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从数据库获取统计
   * @private
   */
  async _getDbStatistics(startTime, endTime, period) {
    // 总量统计
    const totalRow = await this.db.get(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?`,
      [startTime, endTime]
    );

    // 按事件类型统计
    const byEventType = await this.db.all(
      `SELECT event_type, COUNT(*) as count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY event_type
       ORDER BY count DESC`,
      [startTime, endTime]
    );

    // 按风险级别统计
    const byRiskLevel = await this.db.all(
      `SELECT risk_level, COUNT(*) as count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY risk_level
       ORDER BY count DESC`,
      [startTime, endTime]
    );

    // 按操作人统计 (Top 10)
    const topActors = await this.db.all(
      `SELECT actor, COUNT(*) as count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY actor
       ORDER BY count DESC
       LIMIT 10`,
      [startTime, endTime]
    );

    // 高风险事件数
    const highRiskRow = await this.db.get(
      `SELECT COUNT(*) as count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?
         AND risk_level IN ('high', 'critical')`,
      [startTime, endTime]
    );

    // 时间维度趋势 (按日期分组)
    const dateFormat = this._getDateGroupExpression(period);
    const trend = await this.db.all(
      `SELECT ${dateFormat} as period, COUNT(*) as count
       FROM enterprise_audit_log
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY period
       ORDER BY period ASC`,
      [startTime, endTime]
    );

    return {
      success: true,
      data: {
        timeRange: { startTime, endTime },
        summary: {
          total: totalRow ? totalRow.total : 0,
          successCount: totalRow ? totalRow.success_count : 0,
          failureCount: totalRow ? totalRow.failure_count : 0,
          highRiskCount: highRiskRow ? highRiskRow.count : 0
        },
        byEventType: (byEventType || []).reduce((acc, row) => {
          acc[row.event_type] = row.count;
          return acc;
        }, {}),
        byRiskLevel: (byRiskLevel || []).reduce((acc, row) => {
          acc[row.risk_level] = row.count;
          return acc;
        }, {}),
        topActors: topActors || [],
        trend: trend || []
      }
    };
  }

  /**
   * 获取 SQLite 日期分组表达式
   * @private
   */
  _getDateGroupExpression(period) {
    switch (period) {
      case 'hour':
        return "strftime('%Y-%m-%d %H:00', timestamp)";
      case 'week':
        return "strftime('%Y-W%W', timestamp)";
      case 'month':
        return "strftime('%Y-%m', timestamp)";
      case 'day':
      default:
        return "strftime('%Y-%m-%d', timestamp)";
    }
  }

  /**
   * 从内存获取统计
   * @private
   */
  _getMemoryStatistics(startTime, endTime) {
    const filtered = this.memoryBuffer.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime
    );

    const byEventType = {};
    const byRiskLevel = {};
    let successCount = 0;
    let failureCount = 0;
    let highRiskCount = 0;

    for (const entry of filtered) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] || 0) + 1;
      byRiskLevel[entry.riskLevel] = (byRiskLevel[entry.riskLevel] || 0) + 1;

      if (entry.success) successCount++;
      else failureCount++;

      if (entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL) {
        highRiskCount++;
      }
    }

    return {
      success: true,
      data: {
        timeRange: { startTime, endTime },
        summary: {
          total: filtered.length,
          successCount,
          failureCount,
          highRiskCount
        },
        byEventType,
        byRiskLevel,
        topActors: [],
        trend: []
      }
    };
  }

  // ─── 导出功能 ───

  /**
   * 导出审计日志
   * @param {string} [format='json'] - 导出格式 (json/csv)
   * @param {Object} [filters={}] - 过滤条件 (同 query 方法)
   * @returns {Promise<{success: boolean, data?: string, error?: string}>}
   */
  async exportLogs(format = 'json', filters = {}) {
    try {
      // 导出不分页，取全量匹配数据
      const expandedFilters = { ...filters, page: 1, pageSize: 500 };
      const allLogs = [];

      // 分批获取所有数据
      let hasMore = true;
      while (hasMore) {
        const result = await this.query(expandedFilters);
        if (!result.success || !result.data.logs.length) {
          hasMore = false;
          break;
        }
        allLogs.push(...result.data.logs);
        if (allLogs.length >= result.data.pagination.total) {
          hasMore = false;
        } else {
          expandedFilters.page++;
        }
      }

      let output;
      if (format === 'csv') {
        output = this._formatAsCsv(allLogs);
      } else {
        output = JSON.stringify(allLogs, null, 2);
      }

      return {
        success: true,
        data: output,
        meta: {
          format,
          count: allLogs.length,
          exportedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] exportLogs failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 格式化为 CSV
   * @private
   */
  _formatAsCsv(logs) {
    const headers = [
      'id', 'timestamp', 'event_type', 'operation', 'actor',
      'risk_level', 'success', 'error_message', 'duration', 'session_id'
    ];

    const escapeField = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = logs.map(log => [
      log.id,
      log.timestamp,
      log.eventType,
      log.operation,
      log.actor,
      log.riskLevel,
      log.success,
      log.errorMessage,
      log.duration,
      log.sessionId
    ].map(escapeField));

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  // ─── 数据保留策略 ───

  /**
   * 应用数据保留策略，清理过期日志
   * @param {Object} [policy={}] - 保留策略
   * @param {number} [policy.retentionDays=90] - 保留天数
   * @param {number} [policy.maxRecords=100000] - 最大记录数
   * @param {boolean} [policy.keepHighRisk=true] - 是否保留高风险日志
   * @param {number} [policy.highRiskRetentionDays=365] - 高风险日志保留天数
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async applyRetentionPolicy(policy = {}) {
    const retentionDays = policy.retentionDays || 90;
    const maxRecords = policy.maxRecords || 100000;
    const keepHighRisk = policy.keepHighRisk !== false;
    const highRiskRetentionDays = policy.highRiskRetentionDays || 365;

    try {
      if (!this.db || !this._tableInitialized) {
        // 内存清理
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const before = this.memoryBuffer.length;
        this.memoryBuffer = this.memoryBuffer.filter(e => {
          if (keepHighRisk &&
              (e.riskLevel === RiskLevel.HIGH || e.riskLevel === RiskLevel.CRITICAL)) {
            return true;
          }
          return e.timestamp >= cutoff;
        });
        return {
          success: true,
          data: { deletedCount: before - this.memoryBuffer.length, source: 'memory' }
        };
      }

      let totalDeleted = 0;

      // 删除普通过期日志
      const normalCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

      if (keepHighRisk) {
        const result = await this.db.run(
          `DELETE FROM enterprise_audit_log
           WHERE timestamp < ? AND risk_level NOT IN ('high', 'critical')`,
          [normalCutoff]
        );
        totalDeleted += (result && result.changes) || 0;

        // 删除超过高风险保留期的高风险日志
        const highRiskCutoff = new Date(
          Date.now() - highRiskRetentionDays * 24 * 60 * 60 * 1000
        ).toISOString();
        const hrResult = await this.db.run(
          `DELETE FROM enterprise_audit_log
           WHERE timestamp < ? AND risk_level IN ('high', 'critical')`,
          [highRiskCutoff]
        );
        totalDeleted += (hrResult && hrResult.changes) || 0;
      } else {
        const result = await this.db.run(
          'DELETE FROM enterprise_audit_log WHERE timestamp < ?',
          [normalCutoff]
        );
        totalDeleted += (result && result.changes) || 0;
      }

      // 检查是否超过最大记录数限制
      const countRow = await this.db.get(
        'SELECT COUNT(*) as total FROM enterprise_audit_log'
      );
      const currentCount = countRow ? countRow.total : 0;

      if (currentCount > maxRecords) {
        const excess = currentCount - maxRecords;
        const excessResult = await this.db.run(
          `DELETE FROM enterprise_audit_log
           WHERE id IN (
             SELECT id FROM enterprise_audit_log
             ORDER BY created_at ASC
             LIMIT ?
           )`,
          [excess]
        );
        totalDeleted += (excessResult && excessResult.changes) || 0;
      }

      logger.info('[EnterpriseAuditLogger] Retention policy applied', {
        retentionDays,
        maxRecords,
        deletedCount: totalDeleted
      });

      return {
        success: true,
        data: {
          deletedCount: totalDeleted,
          remainingCount: currentCount - totalDeleted,
          source: 'database'
        }
      };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Retention policy failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── HookSystem 集成 ───

  /**
   * 注册 HookSystem 事件监听
   * @private
   */
  _registerHookListeners() {
    if (!this.hookSystem) return;

    // 映射 Hook 事件到审计事件类型
    const hookEventMapping = {
      PreIPCCall: EventType.API,
      PostIPCCall: EventType.API,
      IPCError: EventType.API,
      PreToolUse: EventType.SYSTEM,
      PostToolUse: EventType.SYSTEM,
      ToolError: EventType.SYSTEM,
      SessionStart: EventType.AUTH,
      SessionEnd: EventType.AUTH,
      PreCompact: EventType.SYSTEM,
      PostCompact: EventType.SYSTEM,
      PreFileAccess: EventType.FILE,
      PostFileAccess: EventType.FILE,
      FileModified: EventType.FILE,
      AgentStart: EventType.COWORK,
      AgentStop: EventType.COWORK,
      TaskAssigned: EventType.COWORK,
      TaskCompleted: EventType.COWORK,
      MemorySave: EventType.DB,
      MemoryLoad: EventType.DB
    };

    // 监听 hookSystem 的 executed 事件
    this.hookSystem.on('hookExecuted', (eventData) => {
      const eventType = hookEventMapping[eventData.event] || EventType.SYSTEM;
      this.log(eventType, `hook:${eventData.event}`, {
        hookName: eventData.hookName,
        duration: eventData.duration,
        success: eventData.success,
        error: eventData.error,
        actor: 'hook-system'
      }).catch(err => {
        logger.error('[EnterpriseAuditLogger] Failed to log hook event:', err);
      });
    });

    logger.info('[EnterpriseAuditLogger] HookSystem listeners registered');
  }

  // ─── 便捷方法 ───

  /**
   * 记录浏览器操作
   */
  async logBrowser(operation, details = {}) {
    return this.log(EventType.BROWSER, operation, details);
  }

  /**
   * 记录权限操作
   */
  async logPermission(operation, details = {}) {
    return this.log(EventType.PERMISSION, operation, details);
  }

  /**
   * 记录文件操作
   */
  async logFile(operation, details = {}) {
    return this.log(EventType.FILE, operation, details);
  }

  /**
   * 记录数据库操作
   */
  async logDb(operation, details = {}) {
    return this.log(EventType.DB, operation, details);
  }

  /**
   * 记录 API 操作
   */
  async logApi(operation, details = {}) {
    return this.log(EventType.API, operation, details);
  }

  /**
   * 记录协作操作
   */
  async logCowork(operation, details = {}) {
    return this.log(EventType.COWORK, operation, details);
  }

  /**
   * 记录认证操作
   */
  async logAuth(operation, details = {}) {
    return this.log(EventType.AUTH, operation, details);
  }

  /**
   * 记录系统操作
   */
  async logSystem(operation, details = {}) {
    return this.log(EventType.SYSTEM, operation, details);
  }

  /**
   * 创建操作包装器 (自动记录审计日志)
   * @param {string} eventType - 事件类型
   * @param {string} operation - 操作名称
   * @param {Function} fn - 被包装的函数
   * @returns {Function}
   */
  wrap(eventType, operation, fn) {
    return async (...args) => {
      const startTime = Date.now();
      let result;
      let success = true;
      let errorMsg = null;

      try {
        result = await fn(...args);
        success = result?.success !== false;
      } catch (err) {
        success = false;
        errorMsg = err.message;
        throw err;
      } finally {
        await this.log(eventType, operation, {
          success,
          error: errorMsg,
          duration: Date.now() - startTime,
          args: args.length > 0 ? args[0] : undefined
        });
      }

      return result;
    };
  }

  /**
   * 获取快速统计 (从内存缓存)
   * @returns {{success: boolean, data: Object}}
   */
  getQuickStats() {
    return {
      success: true,
      data: {
        ...this._statsCache,
        memoryBufferSize: this.memoryBuffer.length,
        tableInitialized: this._tableInitialized
      }
    };
  }

  /**
   * 清空内存缓冲
   */
  clearMemoryBuffer() {
    this.memoryBuffer = [];
    this._statsCache = {
      totalLogs: 0,
      byEventType: {},
      byRiskLevel: {
        [RiskLevel.LOW]: 0,
        [RiskLevel.MEDIUM]: 0,
        [RiskLevel.HIGH]: 0,
        [RiskLevel.CRITICAL]: 0
      }
    };
    this.emit('cleared');
  }

  /**
   * 销毁实例，清理资源
   */
  destroy() {
    this.removeAllListeners();
    this.memoryBuffer = [];
    this.db = null;
    this.hookSystem = null;
    logger.info('[EnterpriseAuditLogger] Destroyed');
  }
}

// ─── 单例管理 ───

let instance = null;

/**
 * 获取或创建 EnterpriseAuditLogger 单例
 * @param {Object} [options] - 构造选项 (仅首次调用生效)
 * @returns {EnterpriseAuditLogger}
 */
function getEnterpriseAuditLogger(options) {
  if (!instance) {
    instance = new EnterpriseAuditLogger(options);
  }
  return instance;
}

/**
 * 重置单例 (主要用于测试)
 */
function resetEnterpriseAuditLogger() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

module.exports = {
  EnterpriseAuditLogger,
  EventType,
  RiskLevel,
  RiskWeight,
  SENSITIVE_FIELDS,
  getEnterpriseAuditLogger,
  resetEnterpriseAuditLogger
};
