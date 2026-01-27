/**
 * FileSandbox - 文件沙箱系统
 *
 * 基于 Claude Cowork 的文件夹权限模型，实现安全的文件访问控制。
 *
 * 核心功能：
 * 1. 文件夹权限管理
 * 2. 路径验证和安全检查
 * 3. 操作审计
 * 4. 敏感文件检测
 *
 * @module ai-engine/cowork/file-sandbox
 */

const { logger } = require('../../utils/logger.js');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * 权限类型
 */
const Permission = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
};

/**
 * 敏感文件模式（默认拒绝访问）
 */
const SENSITIVE_PATTERNS = [
  /\.env$/,                      // 环境变量文件
  /\.env\..+$/,                  // .env.local, .env.production等
  /credentials?\.json$/i,        // 凭证文件
  /secrets?\.json$/i,            // 密钥文件
  /\.ssh\//,                     // SSH密钥目录
  /\.git\/config$/,              // Git配置
  /id_rsa$/,                     // SSH私钥
  /\.pem$/,                      // 证书文件
  /\.key$/,                      // 密钥文件
  /\.p12$/,                      // PKCS12证书
  /\.keystore$/,                 // Java密钥库
  /password/i,                   // 包含password的文件
  /\.aws\/credentials$/,         // AWS凭证
  /\.azure\/config$/,            // Azure配置
  /\.kube\/config$/,             // Kubernetes配置
  /private.*key/i,               // 私钥文件
];

/**
 * 危险操作模式
 */
const DANGEROUS_OPERATIONS = [
  /rm\s+-rf/,                    // 递归删除
  /format/i,                     // 格式化
  /delete.*all/i,                // 删除所有
  /drop.*table/i,                // 删除表
];

/**
 * FileSandbox 类
 */
class FileSandbox extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 是否启用严格模式（拒绝所有未明确允许的路径）
      strictMode: options.strictMode !== false,
      // 是否自动审计所有操作
      auditEnabled: options.auditEnabled !== false,
      // 最大允许的路径数
      maxAllowedPaths: options.maxAllowedPaths || 100,
      // 自定义敏感模式
      customSensitivePatterns: options.customSensitivePatterns || [],
      // 是否允许符号链接
      allowSymlinks: options.allowSymlinks || false,
      // 最大文件大小（字节）
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
      ...options,
    };

    // 允许的路径集合: path -> Permission[]
    this.allowedPaths = new Map();

    // 团队权限映射: teamId -> Set<path>
    this.teamPermissions = new Map();

    // 操作审计日志
    this.auditLog = [];

    // 数据库实例（延迟注入）
    this.db = null;

    // 合并敏感模式
    this.sensitivePatterns = [
      ...SENSITIVE_PATTERNS,
      ...this.options.customSensitivePatterns,
    ];

    this._log('FileSandbox 已初始化');
  }

  /**
   * 设置数据库实例
   * @param {Object} db - 数据库实例
   */
  setDatabase(db) {
    this.db = db;
  }

  // ==========================================
  // 权限管理
  // ==========================================

  /**
   * 请求访问权限（弹出授权对话框）
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表 ['read', 'write']
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否授权
   */
  async requestAccess(teamId, folderPath, permissions = [Permission.READ], options = {}) {
    const normalizedPath = path.normalize(folderPath);

    // 检查路径是否已经被授权
    if (this.hasPermission(teamId, normalizedPath, Permission.READ)) {
      this._log(`路径已授权: ${normalizedPath}`, 'info');
      return true;
    }

    // 检查是否为敏感路径
    if (this.isSensitivePath(normalizedPath)) {
      this._log(`拒绝访问敏感路径: ${normalizedPath}`, 'warn');
      this.emit('access-denied', { teamId, path: normalizedPath, reason: 'sensitive_path' });
      return false;
    }

    // 检查路径是否存在
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isDirectory()) {
        throw new Error('路径必须是目录');
      }
    } catch (error) {
      this._log(`路径不存在或无效: ${normalizedPath}`, 'error');
      this.emit('access-denied', { teamId, path: normalizedPath, reason: 'invalid_path' });
      return false;
    }

    // 在实际应用中，这里应该弹出对话框让用户确认
    // 由于这是后端代码，我们通过 IPC 发送请求到前端
    // 这里简化为自动批准（实际实现需要用户确认）

    if (options.autoApprove) {
      await this.grantAccess(teamId, normalizedPath, permissions);
      return true;
    }

    // 发送授权请求事件
    this.emit('access-requested', {
      teamId,
      path: normalizedPath,
      permissions,
      callback: async (approved) => {
        if (approved) {
          await this.grantAccess(teamId, normalizedPath, permissions);
        }
      },
    });

    return false; // 等待用户确认
  }

  /**
   * 授予访问权限
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @param {Object} options - 选项
   */
  async grantAccess(teamId, folderPath, permissions = [Permission.READ], options = {}) {
    const normalizedPath = path.normalize(folderPath);

    // 检查路径数量限制
    if (!this.teamPermissions.has(teamId)) {
      this.teamPermissions.set(teamId, new Set());
    }

    const teamPaths = this.teamPermissions.get(teamId);
    if (teamPaths.size >= this.options.maxAllowedPaths) {
      throw new Error(`已达到最大允许路径数限制: ${this.options.maxAllowedPaths}`);
    }

    // 存储权限
    const pathKey = `${teamId}:${normalizedPath}`;
    this.allowedPaths.set(pathKey, permissions);
    teamPaths.add(normalizedPath);

    // 持久化到数据库
    if (this.db) {
      for (const permission of permissions) {
        try {
          await this.db.run(
            `INSERT INTO cowork_sandbox_permissions
             (id, team_id, path, permission, granted_at, granted_by, expires_at, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `perm_${Date.now()}_${uuidv4().slice(0, 8)}`,
              teamId,
              normalizedPath,
              permission,
              Date.now(),
              options.grantedBy || 'system',
              options.expiresAt || null,
              1,
            ]
          );
        } catch (error) {
          // 忽略重复键错误
          if (!error.message.includes('UNIQUE constraint')) {
            this._log(`保存权限到数据库失败: ${error.message}`, 'error');
          }
        }
      }
    }

    this._log(`权限已授予: 团队 ${teamId}, 路径 ${normalizedPath}, 权限 ${permissions.join(', ')}`);
    this.emit('access-granted', { teamId, path: normalizedPath, permissions });
  }

  /**
   * 撤销访问权限
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径
   */
  async revokeAccess(teamId, folderPath) {
    const normalizedPath = path.normalize(folderPath);
    const pathKey = `${teamId}:${normalizedPath}`;

    this.allowedPaths.delete(pathKey);

    const teamPaths = this.teamPermissions.get(teamId);
    if (teamPaths) {
      teamPaths.delete(normalizedPath);
    }

    // 更新数据库
    if (this.db) {
      try {
        await this.db.run(
          `UPDATE cowork_sandbox_permissions
           SET is_active = 0
           WHERE team_id = ? AND path = ?`,
          [teamId, normalizedPath]
        );
      } catch (error) {
        this._log(`撤销权限失败: ${error.message}`, 'error');
      }
    }

    this._log(`权限已撤销: 团队 ${teamId}, 路径 ${normalizedPath}`);
    this.emit('access-revoked', { teamId, path: normalizedPath });
  }

  /**
   * 检查是否有权限
   * @param {string} teamId - 团队 ID
   * @param {string} filePath - 文件路径
   * @param {string} permission - 权限类型
   * @returns {boolean}
   */
  hasPermission(teamId, filePath, permission = Permission.READ) {
    const normalizedPath = path.normalize(filePath);

    // 查找匹配的允许路径
    for (const [key, permissions] of this.allowedPaths.entries()) {
      if (key.startsWith(`${teamId}:`)) {
        const allowedPath = key.substring(`${teamId}:`.length);

        // 检查文件路径是否在允许的路径下
        if (normalizedPath === allowedPath || normalizedPath.startsWith(allowedPath + path.sep)) {
          if (permissions.includes(permission)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 获取团队的所有允许路径
   * @param {string} teamId - 团队 ID
   * @returns {Array<Object>}
   */
  getAllowedPaths(teamId) {
    const teamPaths = this.teamPermissions.get(teamId);
    if (!teamPaths) {
      return [];
    }

    return Array.from(teamPaths).map(p => ({
      path: p,
      permissions: this.allowedPaths.get(`${teamId}:${p}`) || [],
    }));
  }

  // ==========================================
  // 安全检查
  // ==========================================

  /**
   * 检查路径是否安全
   * @param {string} filePath - 文件路径
   * @returns {Object} { safe: boolean, reason?: string }
   */
  checkPathSafety(filePath) {
    const normalizedPath = path.normalize(filePath);

    // 检查路径遍历攻击
    if (normalizedPath.includes('..')) {
      return { safe: false, reason: 'path_traversal' };
    }

    // 检查是否为敏感文件
    if (this.isSensitivePath(normalizedPath)) {
      return { safe: false, reason: 'sensitive_file' };
    }

    return { safe: true };
  }

  /**
   * 检查是否为敏感路径
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  isSensitivePath(filePath) {
    const normalizedPath = path.normalize(filePath);
    return this.sensitivePatterns.some(pattern => pattern.test(normalizedPath));
  }

  /**
   * 检查操作是否危险
   * @param {string} operation - 操作描述
   * @returns {boolean}
   */
  isDangerousOperation(operation) {
    return DANGEROUS_OPERATIONS.some(pattern => pattern.test(operation));
  }

  /**
   * 验证文件访问
   * @param {string} teamId - 团队 ID
   * @param {string} filePath - 文件路径
   * @param {string} permission - 权限类型
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }
   */
  async validateAccess(teamId, filePath, permission = Permission.READ) {
    const normalizedPath = path.normalize(filePath);

    // 1. 检查路径安全性
    const safety = this.checkPathSafety(normalizedPath);
    if (!safety.safe) {
      this._log(`不安全的路径: ${normalizedPath}, 原因: ${safety.reason}`, 'warn');
      await this._auditOperation(teamId, null, 'access_denied', normalizedPath, false, safety.reason);
      return { allowed: false, reason: safety.reason };
    }

    // 2. 检查权限
    if (!this.hasPermission(teamId, normalizedPath, permission)) {
      this._log(`权限不足: 团队 ${teamId}, 路径 ${normalizedPath}, 权限 ${permission}`, 'warn');
      await this._auditOperation(teamId, null, 'access_denied', normalizedPath, false, 'insufficient_permission');
      return { allowed: false, reason: 'insufficient_permission' };
    }

    // 3. 严格模式下，检查路径是否存在于允许列表
    if (this.options.strictMode) {
      const teamPaths = this.teamPermissions.get(teamId);
      if (!teamPaths) {
        return { allowed: false, reason: 'no_team_permissions' };
      }

      let pathAllowed = false;
      for (const allowedPath of teamPaths) {
        if (normalizedPath === allowedPath || normalizedPath.startsWith(allowedPath + path.sep)) {
          pathAllowed = true;
          break;
        }
      }

      if (!pathAllowed) {
        return { allowed: false, reason: 'path_not_allowed' };
      }
    }

    // 4. 检查符号链接
    if (!this.options.allowSymlinks) {
      try {
        const stats = await fs.lstat(normalizedPath);
        if (stats.isSymbolicLink()) {
          this._log(`拒绝符号链接: ${normalizedPath}`, 'warn');
          return { allowed: false, reason: 'symlink_not_allowed' };
        }
      } catch (error) {
        // 文件不存在，允许（可能是写操作）
      }
    }

    // 5. 检查文件大小（仅读操作）
    if (permission === Permission.READ) {
      try {
        const stats = await fs.stat(normalizedPath);
        if (stats.size > this.options.maxFileSize) {
          this._log(`文件过大: ${normalizedPath}, 大小: ${stats.size}`, 'warn');
          return { allowed: false, reason: 'file_too_large' };
        }
      } catch (error) {
        // 文件不存在，忽略
      }
    }

    return { allowed: true };
  }

  // ==========================================
  // 文件操作包装器
  // ==========================================

  /**
   * 安全读取文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径
   * @param {Object} options - 选项
   * @returns {Promise<string>} 文件内容
   */
  async readFile(teamId, agentId, filePath, options = {}) {
    const validation = await this.validateAccess(teamId, filePath, Permission.READ);

    if (!validation.allowed) {
      throw new Error(`文件访问被拒绝: ${validation.reason}`);
    }

    try {
      const content = await fs.readFile(filePath, options.encoding || 'utf-8');
      await this._auditOperation(teamId, agentId, 'read', filePath, true);
      this.emit('file-read', { teamId, agentId, filePath, size: content.length });
      return content;
    } catch (error) {
      await this._auditOperation(teamId, agentId, 'read', filePath, false, error.message);
      throw error;
    }
  }

  /**
   * 安全写入文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @param {Object} options - 选项
   */
  async writeFile(teamId, agentId, filePath, content, options = {}) {
    const validation = await this.validateAccess(teamId, filePath, Permission.WRITE);

    if (!validation.allowed) {
      throw new Error(`文件写入被拒绝: ${validation.reason}`);
    }

    try {
      await fs.writeFile(filePath, content, options.encoding || 'utf-8');
      await this._auditOperation(teamId, agentId, 'write', filePath, true);
      this.emit('file-written', { teamId, agentId, filePath, size: content.length });
    } catch (error) {
      await this._auditOperation(teamId, agentId, 'write', filePath, false, error.message);
      throw error;
    }
  }

  /**
   * 安全删除文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径
   */
  async deleteFile(teamId, agentId, filePath) {
    const validation = await this.validateAccess(teamId, filePath, Permission.WRITE);

    if (!validation.allowed) {
      throw new Error(`文件删除被拒绝: ${validation.reason}`);
    }

    // 再次确认不是敏感文件
    if (this.isSensitivePath(filePath)) {
      throw new Error('禁止删除敏感文件');
    }

    try {
      await fs.unlink(filePath);
      await this._auditOperation(teamId, agentId, 'delete', filePath, true);
      this.emit('file-deleted', { teamId, agentId, filePath });
    } catch (error) {
      await this._auditOperation(teamId, agentId, 'delete', filePath, false, error.message);
      throw error;
    }
  }

  /**
   * 列出目录
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} dirPath - 目录路径
   * @returns {Promise<Array>} 文件列表
   */
  async listDirectory(teamId, agentId, dirPath) {
    const validation = await this.validateAccess(teamId, dirPath, Permission.READ);

    if (!validation.allowed) {
      throw new Error(`目录访问被拒绝: ${validation.reason}`);
    }

    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });

      // 过滤敏感文件
      const filtered = files.filter(file => {
        const filePath = path.join(dirPath, file.name);
        return !this.isSensitivePath(filePath);
      });

      await this._auditOperation(teamId, agentId, 'list', dirPath, true);
      this.emit('directory-listed', { teamId, agentId, dirPath, count: filtered.length });

      return filtered.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        isFile: file.isFile(),
      }));
    } catch (error) {
      await this._auditOperation(teamId, agentId, 'list', dirPath, false, error.message);
      throw error;
    }
  }

  // ==========================================
  // 审计日志
  // ==========================================

  /**
   * 记录操作审计
   * @private
   */
  async _auditOperation(teamId, agentId, operation, resourcePath, success, errorMessage = null) {
    if (!this.options.auditEnabled) {
      return;
    }

    const auditRecord = {
      teamId,
      agentId,
      operation,
      resourceType: 'file',
      resourcePath,
      timestamp: Date.now(),
      success: success ? 1 : 0,
      errorMessage,
    };

    this.auditLog.push(auditRecord);

    // 限制内存中的日志数量
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }

    // 保存到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_audit_log
           (team_id, agent_id, operation, resource_type, resource_path, timestamp, success, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [teamId, agentId, operation, 'file', resourcePath, auditRecord.timestamp, auditRecord.success, errorMessage]
        );
      } catch (error) {
        this._log(`保存审计日志失败: ${error.message}`, 'error');
      }
    }

    this.emit('audit', auditRecord);
  }

  /**
   * 获取审计日志
   * @param {Object} filters - 过滤条件
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getAuditLog(filters = {}, limit = 100) {
    let logs = this.auditLog;

    if (filters.teamId) {
      logs = logs.filter(l => l.teamId === filters.teamId);
    }

    if (filters.agentId) {
      logs = logs.filter(l => l.agentId === filters.agentId);
    }

    if (filters.operation) {
      logs = logs.filter(l => l.operation === filters.operation);
    }

    if (filters.success !== undefined) {
      logs = logs.filter(l => l.success === (filters.success ? 1 : 0));
    }

    return logs.slice(-limit);
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 日志输出
   * @private
   */
  _log(message, level = 'info') {
    if (level === 'error') {
      logger.error(`[FileSandbox] ${message}`);
    } else if (level === 'warn') {
      logger.warn(`[FileSandbox] ${message}`);
    } else {
      logger.info(`[FileSandbox] ${message}`);
    }
  }

  /**
   * 清理过期权限
   */
  async cleanupExpiredPermissions() {
    if (!this.db) {
      return;
    }

    const now = Date.now();

    try {
      await this.db.run(
        `UPDATE cowork_sandbox_permissions
         SET is_active = 0
         WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [now]
      );

      this._log('过期权限已清理');
    } catch (error) {
      this._log(`清理过期权限失败: ${error.message}`, 'error');
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalAllowedPaths: this.allowedPaths.size,
      totalTeams: this.teamPermissions.size,
      totalAuditLogs: this.auditLog.length,
      successfulOperations: this.auditLog.filter(l => l.success === 1).length,
      failedOperations: this.auditLog.filter(l => l.success === 0).length,
    };
  }

  /**
   * 重置沙箱
   */
  reset() {
    this.allowedPaths.clear();
    this.teamPermissions.clear();
    this.auditLog = [];
    this._log('FileSandbox 已重置');
  }

  // ==========================================
  // API 兼容层（用于测试）
  // ==========================================

  /**
   * 授予权限（别名：grantAccess）
   * @param {string} teamId - 团队ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @param {object} options - 选项
   * @returns {Promise<object>} 结果
   */
  async grantPermission(teamId, folderPath, permissions = ['read'], options = {}) {
    // 转换权限字符串为 Permission 常量
    const permissionObjects = permissions.map(p => {
      const perm = p.toUpperCase().replace('-', '_');
      return Permission[perm] || p;
    });

    return await this.grantAccess(teamId, folderPath, permissionObjects, options);
  }

  /**
   * 撤销权限（别名：revokeAccess）
   * @param {string} teamId - 团队ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @returns {Promise<void>}
   */
  async revokePermission(teamId, folderPath, permissions = []) {
    // 简化版本：完全撤销访问
    return await this.revokeAccess(teamId, folderPath);
  }

  /**
   * 记录审计日志（别名：_auditOperation）
   * @param {object} logData - 日志数据
   * @returns {Promise<void>}
   */
  async recordAuditLog(logData) {
    const {
      teamId,
      agentId = null,
      operation,
      path: resourcePath,
      success,
      error_message = null,
      metadata = {}
    } = logData;

    return await this._auditOperation(
      teamId,
      agentId,
      operation,
      resourcePath,
      success,
      error_message
    );
  }
}

module.exports = { FileSandbox, Permission };
