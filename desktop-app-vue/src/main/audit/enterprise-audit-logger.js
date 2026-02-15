/**
 * EnterpriseAuditLogger - 企业级统一审计日志
 *
 * 聚合所有子系统的审计事件，提供统一的日志记录、查询、导出和统计。
 * 设计参考: src/main/browser/actions/audit-logger.js
 *
 * @module audit/enterprise-audit-logger
 * @since v0.34.0
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

// ─── 常量定义 ───

const EventType = {
  BROWSER: 'browser', PERMISSION: 'permission', FILE: 'file', DB: 'db',
  API: 'api', COWORK: 'cowork', AUTH: 'auth', SYSTEM: 'system'
};

const RiskLevel = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };

const RiskWeight = { low: 1, medium: 2, high: 3, critical: 4 };

const SENSITIVE_FIELDS = [
  'password', 'passwd', 'pwd', 'token', 'accessToken', 'refreshToken',
  'access_token', 'refresh_token', 'secret', 'clientSecret', 'client_secret',
  'apiKey', 'api_key', 'apikey', 'credential', 'credentials',
  'privateKey', 'private_key', 'authorization', 'cookie', 'pin', 'cvv', 'ssn'
];

const HIGH_RISK_OPERATIONS = {
  permission: ['grant_admin', 'revoke_all', 'delete_role', 'elevate_privilege'],
  auth: ['login_failed', 'password_reset', 'mfa_disabled', 'account_locked'],
  db: ['drop_table', 'truncate', 'delete_all', 'schema_change'],
  file: ['delete_recursive', 'chmod_777', 'move_system_file'],
  system: ['shutdown', 'config_change', 'plugin_install', 'update_apply'],
  browser: ['desktop_click', 'desktop_type', 'execute_script'],
  api: ['bulk_delete', 'export_all', 'key_rotation'],
  cowork: ['agent_spawn', 'sandbox_escape', 'tool_override']
};

const CRITICAL_OPERATIONS = [
  'delete_database', 'factory_reset', 'bypass_security',
  'export_private_keys', 'disable_audit', 'root_access',
  'sandbox_escape', 'inject_code'
];

// ─── 主类 ───

class EnterpriseAuditLogger extends EventEmitter {
  constructor({ database, hookSystem, enabled, maxMemoryEntries, alertOnHighRisk } = {}) {
    super();
    this.db = database || null;
    this.hookSystem = hookSystem || null;
    this.enabled = enabled !== false;
    this.maxMemoryEntries = maxMemoryEntries || 2000;
    this.alertOnHighRisk = alertOnHighRisk !== false;
    this.memoryBuffer = [];
    this._tableInitialized = false;
    this._statsCache = this._emptyStats();

    if (this.db) {
      this._initTable().catch(err => {
        logger.error('[EnterpriseAuditLogger] Failed to initialize table:', err);
      });
    }
    if (this.hookSystem) this._registerHookListeners();
    logger.info('[EnterpriseAuditLogger] Initialized');
  }

  _emptyStats() {
    return {
      totalLogs: 0, byEventType: {},
      byRiskLevel: { low: 0, medium: 0, high: 0, critical: 0 }
    };
  }

  // ─── 数据库初始化 ───

  async _initTable() {
    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS enterprise_audit_log (
          id TEXT PRIMARY KEY, timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL, operation TEXT NOT NULL,
          actor TEXT DEFAULT 'system', risk_level TEXT NOT NULL DEFAULT 'low',
          success INTEGER NOT NULL DEFAULT 1, details TEXT, context TEXT,
          error_message TEXT, duration INTEGER, ip_address TEXT,
          session_id TEXT, created_at INTEGER NOT NULL
        )`);
      const indexes = ['timestamp', 'event_type', 'risk_level', 'actor', 'created_at'];
      for (const col of indexes) {
        await this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_audit_${col} ON enterprise_audit_log(${col})`
        );
      }
      this._tableInitialized = true;
      logger.info('[EnterpriseAuditLogger] Database table initialized');
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Table init failed:', error);
    }
  }

  // ─── 核心日志方法 ───

  async log(eventType, operation, details = {}) {
    if (!this.enabled) return { success: false, error: 'Audit logger is disabled' };
    if (!Object.values(EventType).includes(eventType)) {
      return { success: false, error: `Invalid event type: ${eventType}` };
    }
    try {
      const sanitized = this.sanitizeData(details);
      const entry = {
        id: uuidv4(), timestamp: new Date().toISOString(),
        eventType, operation,
        actor: sanitized.actor || 'system',
        riskLevel: this.assessRisk(eventType, operation, details),
        success: sanitized.success !== false,
        details: sanitized,
        context: sanitized.context || null,
        errorMessage: sanitized.error || null,
        duration: sanitized.duration || null,
        ipAddress: sanitized.ipAddress || null,
        sessionId: sanitized.sessionId || null,
        createdAt: Date.now()
      };

      if (this.db && this._tableInitialized) await this._writeToDB(entry);
      this.memoryBuffer.push(entry);
      if (this.memoryBuffer.length > this.maxMemoryEntries) this.memoryBuffer.shift();
      this._statsCache.totalLogs++;
      this._statsCache.byEventType[entry.eventType] = (this._statsCache.byEventType[entry.eventType] || 0) + 1;
      this._statsCache.byRiskLevel[entry.riskLevel] = (this._statsCache.byRiskLevel[entry.riskLevel] || 0) + 1;

      if (this.alertOnHighRisk && RiskWeight[entry.riskLevel] >= 3) {
        this.emit('highRiskEvent', entry);
        logger.warn('[EnterpriseAuditLogger] High risk operation', { eventType, operation, riskLevel: entry.riskLevel });
      }
      this.emit('logged', entry);
      return { success: true, data: { id: entry.id, riskLevel: entry.riskLevel } };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Failed to log:', error);
      return { success: false, error: error.message };
    }
  }

  async _writeToDB(entry) {
    await this.db.run(
      `INSERT INTO enterprise_audit_log
       (id,timestamp,event_type,operation,actor,risk_level,success,details,context,error_message,duration,ip_address,session_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [entry.id, entry.timestamp, entry.eventType, entry.operation,
       entry.actor, entry.riskLevel, entry.success ? 1 : 0,
       JSON.stringify(entry.details), entry.context ? JSON.stringify(entry.context) : null,
       entry.errorMessage, entry.duration, entry.ipAddress, entry.sessionId, entry.createdAt]
    );
  }

  // ─── 风险评估 ───

  assessRisk(eventType, operation, details = {}) {
    const op = (operation || '').toLowerCase();
    if (CRITICAL_OPERATIONS.some(c => op.includes(c))) return RiskLevel.CRITICAL;
    if ((HIGH_RISK_OPERATIONS[eventType] || []).some(h => op.includes(h))) return RiskLevel.HIGH;

    const patterns = [/password/i, /credential/i, /secret/i, /admin/i, /delete/i,
      /remove/i, /export/i, /import/i, /permission/i, /role/i, /encrypt/i, /decrypt/i];
    const ctx = JSON.stringify(details);
    for (const p of patterns) {
      if (p.test(op) || p.test(ctx)) return RiskLevel.MEDIUM;
    }
    if (eventType === EventType.AUTH || eventType === EventType.PERMISSION) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  // ─── 数据脱敏 ───

  sanitizeData(data, depth = 0) {
    if (depth > 10) return '[MAX_DEPTH_EXCEEDED]';
    if (data == null) return data;
    if (typeof data === 'string') {
      return data.length > 1000 ? data.substring(0, 1000) + '...[TRUNCATED]' : data;
    }
    if (Array.isArray(data)) return data.map(i => this.sanitizeData(i, depth + 1));
    if (typeof data !== 'object') return data;

    const out = {};
    for (const [key, value] of Object.entries(data)) {
      const kl = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(f => kl === f.toLowerCase())) { out[key] = '***REDACTED***'; continue; }
      if (typeof value === 'string' && value.length > 5000 &&
          (kl.includes('image') || kl.includes('screenshot') || kl.includes('base64'))) {
        out[key] = `[BINARY_DATA: ${value.length} bytes]`; continue;
      }
      out[key] = this.sanitizeData(value, depth + 1);
    }
    return out;
  }

  // ─── 查询接口 ───

  async query(filters = {}) {
    try {
      const page = Math.max(1, filters.page || 1);
      const pageSize = Math.min(500, Math.max(1, filters.pageSize || 50));
      const offset = (page - 1) * pageSize;

      if (this.db && this._tableInitialized) {
        const { conditions, params } = this._buildWhere(filters);
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const countRow = await this.db.get(`SELECT COUNT(*) as total FROM enterprise_audit_log ${where}`, params);
        const total = countRow ? countRow.total : 0;
        const rows = await this.db.all(
          `SELECT * FROM enterprise_audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
        return { success: true, data: { logs: (rows || []).map(r => this._row(r)), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
      }

      // 内存查询
      let results = [...this.memoryBuffer];
      if (filters.eventType) results = results.filter(e => e.eventType === filters.eventType);
      if (filters.operation) { const ol = filters.operation.toLowerCase(); results = results.filter(e => e.operation.toLowerCase().includes(ol)); }
      if (filters.actor) results = results.filter(e => e.actor === filters.actor);
      if (filters.riskLevel) results = results.filter(e => e.riskLevel === filters.riskLevel);
      if (filters.startTime) results = results.filter(e => e.timestamp >= filters.startTime);
      if (filters.endTime) results = results.filter(e => e.timestamp <= filters.endTime);
      if (filters.successOnly) results = results.filter(e => e.success === true);
      if (filters.sessionId) results = results.filter(e => e.sessionId === filters.sessionId);
      results.sort((a, b) => b.createdAt - a.createdAt);
      const total = results.length;
      return { success: true, data: { logs: results.slice(offset, offset + pageSize), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Query failed:', error);
      return { success: false, error: error.message };
    }
  }

  _buildWhere(filters) {
    const conditions = [], params = [];
    if (filters.eventType) { conditions.push('event_type = ?'); params.push(filters.eventType); }
    if (filters.operation) { conditions.push('operation LIKE ?'); params.push(`%${filters.operation}%`); }
    if (filters.actor) { conditions.push('actor = ?'); params.push(filters.actor); }
    if (filters.riskLevel) { conditions.push('risk_level = ?'); params.push(filters.riskLevel); }
    if (filters.startTime) { conditions.push('timestamp >= ?'); params.push(filters.startTime); }
    if (filters.endTime) { conditions.push('timestamp <= ?'); params.push(filters.endTime); }
    if (filters.successOnly) conditions.push('success = 1');
    if (filters.sessionId) { conditions.push('session_id = ?'); params.push(filters.sessionId); }
    return { conditions, params };
  }

  _row(r) {
    return {
      id: r.id, timestamp: r.timestamp, eventType: r.event_type,
      operation: r.operation, actor: r.actor, riskLevel: r.risk_level,
      success: r.success === 1, details: r.details ? JSON.parse(r.details) : {},
      context: r.context ? JSON.parse(r.context) : null,
      errorMessage: r.error_message, duration: r.duration,
      ipAddress: r.ip_address, sessionId: r.session_id, createdAt: r.created_at
    };
  }

  // ─── 单条日志详情 ───

  async getLogDetail(id) {
    if (!id) return { success: false, error: 'Log ID is required' };
    try {
      if (this.db && this._tableInitialized) {
        const row = await this.db.get('SELECT * FROM enterprise_audit_log WHERE id = ?', [id]);
        return row ? { success: true, data: this._row(row) } : { success: false, error: 'Log entry not found' };
      }
      const entry = this.memoryBuffer.find(e => e.id === id);
      return entry ? { success: true, data: entry } : { success: false, error: 'Log entry not found' };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] getLogDetail failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── 统计分析 ───

  async getStatistics(timeRange = {}) {
    try {
      const startTime = timeRange.startTime || new Date(Date.now() - 7 * 86400000).toISOString();
      const endTime = timeRange.endTime || new Date().toISOString();
      const tp = [startTime, endTime];

      if (this.db && this._tableInitialized) {
        const totalRow = await this.db.get(
          `SELECT COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as sc,
           SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as fc FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=?`, tp);
        const byET = await this.db.all('SELECT event_type,COUNT(*) as count FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=? GROUP BY event_type ORDER BY count DESC', tp);
        const byRL = await this.db.all('SELECT risk_level,COUNT(*) as count FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=? GROUP BY risk_level ORDER BY count DESC', tp);
        const actors = await this.db.all('SELECT actor,COUNT(*) as count FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=? GROUP BY actor ORDER BY count DESC LIMIT 10', tp);
        const hrRow = await this.db.get("SELECT COUNT(*) as count FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=? AND risk_level IN ('high','critical')", tp);
        const period = timeRange.period || 'day';
        const fmt = { hour: "%Y-%m-%d %H:00", week: "%Y-W%W", month: "%Y-%m", day: "%Y-%m-%d" }[period] || "%Y-%m-%d";
        const trend = await this.db.all(`SELECT strftime('${fmt}',timestamp) as period,COUNT(*) as count FROM enterprise_audit_log WHERE timestamp>=? AND timestamp<=? GROUP BY period ORDER BY period ASC`, tp);

        return { success: true, data: {
          timeRange: { startTime, endTime },
          summary: { total: totalRow?.total || 0, successCount: totalRow?.sc || 0, failureCount: totalRow?.fc || 0, highRiskCount: hrRow?.count || 0 },
          byEventType: (byET || []).reduce((a, r) => { a[r.event_type] = r.count; return a; }, {}),
          byRiskLevel: (byRL || []).reduce((a, r) => { a[r.risk_level] = r.count; return a; }, {}),
          topActors: actors || [], trend: trend || []
        }};
      }

      // 内存统计
      const filtered = this.memoryBuffer.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
      const byET = {}, byRL = {};
      let sc = 0, fc = 0, hrc = 0;
      for (const e of filtered) {
        byET[e.eventType] = (byET[e.eventType] || 0) + 1;
        byRL[e.riskLevel] = (byRL[e.riskLevel] || 0) + 1;
        e.success ? sc++ : fc++;
        if (RiskWeight[e.riskLevel] >= 3) hrc++;
      }
      return { success: true, data: {
        timeRange: { startTime, endTime },
        summary: { total: filtered.length, successCount: sc, failureCount: fc, highRiskCount: hrc },
        byEventType: byET, byRiskLevel: byRL, topActors: [], trend: []
      }};
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] getStatistics failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── 导出功能 ───

  async exportLogs(format = 'json', filters = {}) {
    try {
      const batchFilters = { ...filters, page: 1, pageSize: 500 };
      const allLogs = [];
      let hasMore = true;
      while (hasMore) {
        const result = await this.query(batchFilters);
        if (!result.success || !result.data.logs.length) break;
        allLogs.push(...result.data.logs);
        hasMore = allLogs.length < result.data.pagination.total;
        batchFilters.page++;
      }

      let output;
      if (format === 'csv') {
        const headers = ['id','timestamp','event_type','operation','actor','risk_level','success','error_message','duration','session_id'];
        const esc = v => { if (v == null) return ''; const s = String(v); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const rows = allLogs.map(l => [l.id, l.timestamp, l.eventType, l.operation, l.actor, l.riskLevel, l.success, l.errorMessage, l.duration, l.sessionId].map(esc));
        output = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      } else {
        output = JSON.stringify(allLogs, null, 2);
      }
      return { success: true, data: output, meta: { format, count: allLogs.length, exportedAt: new Date().toISOString() } };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] exportLogs failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── 数据保留策略 ───

  async applyRetentionPolicy(policy = {}) {
    const retDays = policy.retentionDays || 90;
    const maxRec = policy.maxRecords || 100000;
    const keepHR = policy.keepHighRisk !== false;
    const hrDays = policy.highRiskRetentionDays || 365;

    try {
      if (!this.db || !this._tableInitialized) {
        const cutoff = new Date(Date.now() - retDays * 86400000).toISOString();
        const before = this.memoryBuffer.length;
        this.memoryBuffer = this.memoryBuffer.filter(e => {
          if (keepHR && RiskWeight[e.riskLevel] >= 3) return true;
          return e.timestamp >= cutoff;
        });
        return { success: true, data: { deletedCount: before - this.memoryBuffer.length, source: 'memory' } };
      }

      let deleted = 0;
      const cutoff = new Date(Date.now() - retDays * 86400000).toISOString();
      if (keepHR) {
        const r1 = await this.db.run("DELETE FROM enterprise_audit_log WHERE timestamp < ? AND risk_level NOT IN ('high','critical')", [cutoff]);
        deleted += (r1 && r1.changes) || 0;
        const hrCutoff = new Date(Date.now() - hrDays * 86400000).toISOString();
        const r2 = await this.db.run("DELETE FROM enterprise_audit_log WHERE timestamp < ? AND risk_level IN ('high','critical')", [hrCutoff]);
        deleted += (r2 && r2.changes) || 0;
      } else {
        const r = await this.db.run('DELETE FROM enterprise_audit_log WHERE timestamp < ?', [cutoff]);
        deleted += (r && r.changes) || 0;
      }

      const countRow = await this.db.get('SELECT COUNT(*) as total FROM enterprise_audit_log');
      const cur = countRow ? countRow.total : 0;
      if (cur > maxRec) {
        const r = await this.db.run(`DELETE FROM enterprise_audit_log WHERE id IN (SELECT id FROM enterprise_audit_log ORDER BY created_at ASC LIMIT ?)`, [cur - maxRec]);
        deleted += (r && r.changes) || 0;
      }

      logger.info('[EnterpriseAuditLogger] Retention applied', { retDays, deleted });
      return { success: true, data: { deletedCount: deleted, remainingCount: Math.max(0, cur - deleted), source: 'database' } };
    } catch (error) {
      logger.error('[EnterpriseAuditLogger] Retention failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ─── HookSystem 集成 ───

  _registerHookListeners() {
    if (!this.hookSystem) return;
    const map = {
      PreIPCCall: 'api', PostIPCCall: 'api', IPCError: 'api',
      PreToolUse: 'system', PostToolUse: 'system', ToolError: 'system',
      SessionStart: 'auth', SessionEnd: 'auth',
      PreCompact: 'system', PostCompact: 'system',
      PreFileAccess: 'file', PostFileAccess: 'file', FileModified: 'file',
      AgentStart: 'cowork', AgentStop: 'cowork', TaskAssigned: 'cowork', TaskCompleted: 'cowork',
      MemorySave: 'db', MemoryLoad: 'db'
    };
    this.hookSystem.on('hookExecuted', (d) => {
      this.log(map[d.event] || 'system', `hook:${d.event}`, {
        hookName: d.hookName, duration: d.duration, success: d.success, error: d.error, actor: 'hook-system'
      }).catch(err => logger.error('[EnterpriseAuditLogger] Hook log failed:', err));
    });
    logger.info('[EnterpriseAuditLogger] HookSystem listeners registered');
  }

  // ─── 便捷方法 ───

  async logBrowser(op, d = {}) { return this.log(EventType.BROWSER, op, d); }
  async logPermission(op, d = {}) { return this.log(EventType.PERMISSION, op, d); }
  async logFile(op, d = {}) { return this.log(EventType.FILE, op, d); }
  async logDb(op, d = {}) { return this.log(EventType.DB, op, d); }
  async logApi(op, d = {}) { return this.log(EventType.API, op, d); }
  async logCowork(op, d = {}) { return this.log(EventType.COWORK, op, d); }
  async logAuth(op, d = {}) { return this.log(EventType.AUTH, op, d); }
  async logSystem(op, d = {}) { return this.log(EventType.SYSTEM, op, d); }

  /** Wrap a function to auto-log its execution */
  wrap(eventType, operation, fn) {
    return async (...args) => {
      const t0 = Date.now();
      let result, success = true, errMsg = null;
      try {
        result = await fn(...args);
        success = result?.success !== false;
      } catch (err) { success = false; errMsg = err.message; throw err; }
      finally {
        await this.log(eventType, operation, { success, error: errMsg, duration: Date.now() - t0, args: args[0] });
      }
      return result;
    };
  }

  getQuickStats() {
    return { success: true, data: { ...this._statsCache, memoryBufferSize: this.memoryBuffer.length, tableInitialized: this._tableInitialized } };
  }

  clearMemoryBuffer() {
    this.memoryBuffer = [];
    this._statsCache = this._emptyStats();
    this.emit('cleared');
  }

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

function getEnterpriseAuditLogger(options) {
  if (!instance) instance = new EnterpriseAuditLogger(options);
  return instance;
}

function resetEnterpriseAuditLogger() {
  if (instance) { instance.destroy(); instance = null; }
}

module.exports = {
  EnterpriseAuditLogger, EventType, RiskLevel, RiskWeight,
  SENSITIVE_FIELDS, getEnterpriseAuditLogger, resetEnterpriseAuditLogger
};
