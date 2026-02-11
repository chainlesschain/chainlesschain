/**
 * 权限验证器 - 基于 DID 的命令授权系统
 *
 * 功能：
 * - DID 签名验证
 * - 时间戳验证（防重放攻击）
 * - 命令权限级别检查（4 级权限体系）
 * - U-Key 二次验证（Level 4 命令）
 * - 设备权限管理
 * - 频率限制（Rate Limiting）
 *
 * 权限级别：
 * Level 1 (Public):  查询状态、读取数据
 * Level 2 (Normal):  AI 对话、文件操作
 * Level 3 (Admin):   系统控制、配置修改
 * Level 4 (Root):    核心功能、安全设置（需要 U-Key）
 *
 * @module remote/permission-gate
 */

const { logger } = require("../utils/logger");
const crypto = require("crypto");
const naclUtil = require("tweetnacl-util");
const nacl = require("tweetnacl");

/**
 * 权限级别常量
 */
const PERMISSION_LEVELS = {
  PUBLIC: 1,
  NORMAL: 2,
  ADMIN: 3,
  ROOT: 4,
};

/**
 * 默认命令权限映射
 */
const DEFAULT_COMMAND_PERMISSIONS = {
  // Level 1: Public - 查询类
  "ai.getConversations": PERMISSION_LEVELS.PUBLIC,
  "ai.getModels": PERMISSION_LEVELS.PUBLIC,
  "system.getStatus": PERMISSION_LEVELS.PUBLIC,
  "system.getInfo": PERMISSION_LEVELS.PUBLIC,
  "knowledge.search": PERMISSION_LEVELS.PUBLIC,
  "knowledge.getNotes": PERMISSION_LEVELS.PUBLIC,

  // Level 2: Normal - 操作类
  "ai.chat": PERMISSION_LEVELS.NORMAL,
  "ai.ragSearch": PERMISSION_LEVELS.NORMAL,
  "ai.controlAgent": PERMISSION_LEVELS.NORMAL,
  "system.screenshot": PERMISSION_LEVELS.NORMAL,
  "system.notify": PERMISSION_LEVELS.NORMAL,
  "file.read": PERMISSION_LEVELS.NORMAL,
  "knowledge.createNote": PERMISSION_LEVELS.NORMAL,
  "knowledge.updateNote": PERMISSION_LEVELS.NORMAL,
  "channel.*.send": PERMISSION_LEVELS.NORMAL,
  "browser.navigate": PERMISSION_LEVELS.NORMAL,
  "browser.extractData": PERMISSION_LEVELS.NORMAL,
  // 剪贴板操作
  "clipboard.get": PERMISSION_LEVELS.NORMAL,
  "clipboard.set": PERMISSION_LEVELS.NORMAL,
  "clipboard.watch": PERMISSION_LEVELS.NORMAL,
  "clipboard.unwatch": PERMISSION_LEVELS.NORMAL,
  "clipboard.getHistory": PERMISSION_LEVELS.NORMAL,
  "clipboard.clearHistory": PERMISSION_LEVELS.NORMAL,
  // 通知操作
  "notification.send": PERMISSION_LEVELS.NORMAL,
  "notification.sendToMobile": PERMISSION_LEVELS.NORMAL,
  "notification.getHistory": PERMISSION_LEVELS.NORMAL,
  "notification.markAsRead": PERMISSION_LEVELS.NORMAL,
  "notification.clearHistory": PERMISSION_LEVELS.NORMAL,
  "notification.getSettings": PERMISSION_LEVELS.NORMAL,
  "notification.updateSettings": PERMISSION_LEVELS.NORMAL,
  // 工作流操作
  "workflow.list": PERMISSION_LEVELS.NORMAL,
  "workflow.get": PERMISSION_LEVELS.NORMAL,
  "workflow.getStatus": PERMISSION_LEVELS.NORMAL,
  "workflow.getHistory": PERMISSION_LEVELS.NORMAL,
  "workflow.getRunning": PERMISSION_LEVELS.NORMAL,
  "workflow.create": PERMISSION_LEVELS.ADMIN,
  "workflow.update": PERMISSION_LEVELS.ADMIN,
  "workflow.delete": PERMISSION_LEVELS.ADMIN,
  "workflow.execute": PERMISSION_LEVELS.ADMIN,
  "workflow.cancel": PERMISSION_LEVELS.ADMIN,

  // Level 3: Admin - 高级操作
  "file.write": PERMISSION_LEVELS.ADMIN,
  "file.delete": PERMISSION_LEVELS.ADMIN,
  "knowledge.deleteNote": PERMISSION_LEVELS.ADMIN,
  "system.execCommand": PERMISSION_LEVELS.ADMIN, // 暂定为 Admin，可升级到 ROOT
  "browser.fillForm": PERMISSION_LEVELS.ADMIN,

  // Level 4: Root - 敏感操作（需要 U-Key）
  "system.shutdown": PERMISSION_LEVELS.ROOT,
  "system.restart": PERMISSION_LEVELS.ROOT,
  "config.update": PERMISSION_LEVELS.ROOT,
  "security.changePassword": PERMISSION_LEVELS.ROOT,
  "device.revoke": PERMISSION_LEVELS.ROOT,
  "ukey.verify": PERMISSION_LEVELS.ROOT,
};

/**
 * 权限验证器类
 */
class PermissionGate {
  constructor(didManager, ukeyManager, database, options = {}) {
    this.didManager = didManager;
    this.ukeyManager = ukeyManager;
    this.database = database;

    // 配置选项
    this.options = {
      timestampWindow: options.timestampWindow || 300000, // 时间戳有效期：5 分钟
      enableRateLimit: options.enableRateLimit !== false,
      defaultRateLimit: options.defaultRateLimit || 100, // 默认 100 req/min
      highRiskRateLimit: options.highRiskRateLimit || 10, // 高危命令 10 req/min
      enableNonceCheck: options.enableNonceCheck !== false,
      nonceExpiry: options.nonceExpiry || 600000, // Nonce 有效期：10 分钟
      requireUKeyForLevel4: options.requireUKeyForLevel4 !== false,
      ...options,
    };

    // 命令权限映射（可动态扩展）
    this.commandPermissions = { ...DEFAULT_COMMAND_PERMISSIONS };

    // 设备权限缓存（DID -> Level）
    this.devicePermissions = new Map();

    // Nonce 缓存（防重放攻击）
    this.nonceCache = new Map();

    // 频率限制缓存（DID -> RequestCount）
    this.rateLimitCache = new Map();

    // 定期清理定时器
    this.cleanupTimer = null;
  }

  /**
   * 初始化权限验证器
   */
  async initialize() {
    logger.info("[PermissionGate] 初始化权限验证器...");

    try {
      // 1. 确保数据库表存在
      await this.ensureTables();

      // 2. 加载设备权限
      await this.loadDevicePermissions();

      // 3. 启动定期清理
      this.startCleanup();

      logger.info("[PermissionGate] ✅ 初始化完成");
    } catch (error) {
      logger.error("[PermissionGate] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS device_permissions (
        did TEXT PRIMARY KEY,
        permission_level INTEGER NOT NULL DEFAULT 2,
        device_name TEXT,
        granted_at INTEGER NOT NULL,
        granted_by TEXT,
        expires_at INTEGER,
        notes TEXT
      )
    `);

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT NOT NULL,
        method TEXT NOT NULL,
        permission_level INTEGER NOT NULL,
        granted BOOLEAN NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    logger.info("[PermissionGate] 数据库表已就绪");
  }

  /**
   * 验证命令权限（核心方法）
   */
  async verify(auth, method) {
    const startTime = Date.now();

    try {
      // 1. 基础验证
      if (
        !auth ||
        !auth.did ||
        !auth.signature ||
        !auth.timestamp ||
        !auth.nonce
      ) {
        logger.warn("[PermissionGate] 验证失败: 认证信息不完整");
        await this.logAudit(
          auth?.did,
          method,
          0,
          false,
          "Incomplete auth info",
        );
        return false;
      }

      // 2. 验证时间戳（防重放攻击）
      const now = Date.now();
      const timeDiff = Math.abs(now - auth.timestamp);
      if (timeDiff > this.options.timestampWindow) {
        logger.warn(
          `[PermissionGate] 验证失败: 时间戳过期 (差值: ${timeDiff}ms)`,
        );
        await this.logAudit(auth.did, method, 0, false, "Timestamp expired");
        return false;
      }

      // 3. 验证 Nonce（防重放攻击）- 使用 DID:Nonce 组合防止跨设备攻击
      if (this.options.enableNonceCheck) {
        const nonceKey = `${auth.did}:${auth.nonce}`;
        if (this.nonceCache.has(nonceKey)) {
          logger.warn(
            `[PermissionGate] 验证失败: Nonce 已使用 (DID: ${auth.did.substring(0, 20)}...)`,
          );
          await this.logAudit(auth.did, method, 0, false, "Nonce reused");
          return false;
        }
        // 记录 DID:Nonce 组合
        this.nonceCache.set(nonceKey, now);
      }

      // 4. 验证 DID 签名
      const isValidSignature = await this.verifySignature(auth, method);
      if (!isValidSignature) {
        logger.warn("[PermissionGate] 验证失败: DID 签名无效");
        await this.logAudit(auth.did, method, 0, false, "Invalid signature");
        return false;
      }

      // 5. 获取命令所需权限级别
      const requiredLevel = this.getCommandPermissionLevel(method);

      // 6. 获取设备权限级别
      const deviceLevel = await this.getDevicePermissionLevel(auth.did);

      // 7. 检查权限级别
      if (deviceLevel < requiredLevel) {
        logger.warn(
          `[PermissionGate] 验证失败: 权限不足 (需要: ${requiredLevel}, 当前: ${deviceLevel})`,
        );
        await this.logAudit(
          auth.did,
          method,
          requiredLevel,
          false,
          `Permission denied (${deviceLevel} < ${requiredLevel})`,
        );
        return false;
      }

      // 8. 频率限制检查
      if (this.options.enableRateLimit) {
        const rateCheck = await this.checkRateLimit(
          auth.did,
          method,
          requiredLevel,
        );
        if (!rateCheck.allowed) {
          logger.warn(
            `[PermissionGate] 验证失败: 频率限制 (${rateCheck.current}/${rateCheck.limit})`,
          );
          await this.logAudit(
            auth.did,
            method,
            requiredLevel,
            false,
            "Rate limit exceeded",
          );
          return false;
        }
      }

      // 9. Level 4 命令需要 U-Key 验证
      if (
        requiredLevel === PERMISSION_LEVELS.ROOT &&
        this.options.requireUKeyForLevel4 &&
        this.ukeyManager
      ) {
        const isUKeyValid = await this.verifyUKey();
        if (!isUKeyValid) {
          logger.warn("[PermissionGate] 验证失败: U-Key 验证失败");
          await this.logAudit(
            auth.did,
            method,
            requiredLevel,
            false,
            "U-Key verification failed",
          );
          return false;
        }
      }

      // 10. 验证成功
      const duration = Date.now() - startTime;
      logger.info(
        `[PermissionGate] ✅ 验证成功: ${method} by ${auth.did} (${duration}ms)`,
      );
      await this.logAudit(auth.did, method, requiredLevel, true, "Success");

      return true;
    } catch (error) {
      logger.error("[PermissionGate] 验证异常:", error);
      await this.logAudit(
        auth?.did,
        method,
        0,
        false,
        `Error: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * 验证 DID 签名
   */
  async verifySignature(auth, method) {
    try {
      // 构造签名数据（与 Android 端保持一致）
      const signData = JSON.stringify({
        method,
        timestamp: auth.timestamp,
        nonce: auth.nonce,
      });

      // 从 DID 获取公钥
      const identity = await this.didManager.cache.get(auth.did);
      if (!identity) {
        logger.warn(`[PermissionGate] DID 不存在: ${auth.did}`);
        return false;
      }

      // 解码公钥和签名
      const publicKey = naclUtil.decodeBase64(identity.public_key_sign);
      const signature = naclUtil.decodeBase64(auth.signature);
      const message = naclUtil.decodeUTF8(signData);

      // 验证签名
      const isValid = nacl.sign.detached.verify(message, signature, publicKey);

      if (!isValid) {
        logger.warn("[PermissionGate] 签名验证失败");
      }

      return isValid;
    } catch (error) {
      logger.error("[PermissionGate] 签名验证异常:", error);
      return false;
    }
  }

  /**
   * 验证 U-Key（Level 4 命令）
   */
  async verifyUKey() {
    try {
      if (!this.ukeyManager) {
        logger.warn("[PermissionGate] U-Key 管理器未初始化");
        return false;
      }

      // 调用 U-Key 验证
      const result = await this.ukeyManager.verifyPIN();
      return result.success;
    } catch (error) {
      logger.error("[PermissionGate] U-Key 验证异常:", error);
      return false;
    }
  }

  /**
   * 获取命令权限级别
   */
  getCommandPermissionLevel(method) {
    // 1. 精确匹配
    if (this.commandPermissions[method] !== undefined) {
      return this.commandPermissions[method];
    }

    // 2. 通配符匹配
    for (const [pattern, level] of Object.entries(this.commandPermissions)) {
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        if (regex.test(method)) {
          return level;
        }
      }
    }

    // 3. 命名空间匹配（如 ai.*）
    const namespace = method.split(".")[0];
    const namespacePattern = `${namespace}.*`;
    if (this.commandPermissions[namespacePattern] !== undefined) {
      return this.commandPermissions[namespacePattern];
    }

    // 4. 默认权限级别
    logger.debug(
      `[PermissionGate] 命令 ${method} 未配置权限，使用默认级别: ${PERMISSION_LEVELS.NORMAL}`,
    );
    return PERMISSION_LEVELS.NORMAL;
  }

  /**
   * 获取设备权限级别
   */
  async getDevicePermissionLevel(did) {
    // 1. 从缓存获取
    if (this.devicePermissions.has(did)) {
      return this.devicePermissions.get(did);
    }

    // 2. 从数据库查询
    try {
      const row = this.database
        .prepare(
          "SELECT permission_level, expires_at FROM device_permissions WHERE did = ?",
        )
        .get(did);

      if (row) {
        // 检查是否过期
        if (row.expires_at && row.expires_at < Date.now()) {
          logger.warn(`[PermissionGate] 设备权限已过期: ${did}`);
          return PERMISSION_LEVELS.PUBLIC;
        }

        // 缓存权限
        this.devicePermissions.set(did, row.permission_level);
        return row.permission_level;
      }
    } catch (error) {
      logger.error("[PermissionGate] 查询设备权限失败:", error);
    }

    // 3. 默认权限级别（新设备）
    logger.info(
      `[PermissionGate] 新设备使用默认权限: ${did} -> Level ${PERMISSION_LEVELS.PUBLIC}`,
    );
    return PERMISSION_LEVELS.PUBLIC;
  }

  /**
   * 设置设备权限级别
   */
  async setDevicePermissionLevel(did, level, options = {}) {
    try {
      const now = Date.now();
      const expiresAt = options.expiresIn ? now + options.expiresIn : null;

      this.database
        .prepare(
          `
          INSERT OR REPLACE INTO device_permissions
          (did, permission_level, device_name, granted_at, granted_by, expires_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          did,
          level,
          options.deviceName || null,
          now,
          options.grantedBy || "system",
          expiresAt,
          options.notes || null,
        );

      // 更新缓存
      this.devicePermissions.set(did, level);

      logger.info(`[PermissionGate] 设置设备权限: ${did} -> Level ${level}`);

      // 记录审计日志
      await this.logAudit(
        did,
        "device.setPermission",
        level,
        true,
        `Level changed to ${level}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[PermissionGate] 设置设备权限失败:", error);
      throw error;
    }
  }

  /**
   * 检查频率限制
   */
  async checkRateLimit(did, method, permissionLevel) {
    const now = Date.now();
    const windowMs = 60000; // 1 分钟窗口

    // 获取限制值
    const limit =
      permissionLevel >= PERMISSION_LEVELS.ADMIN
        ? this.options.highRiskRateLimit
        : this.options.defaultRateLimit;

    // 获取或创建计数器
    if (!this.rateLimitCache.has(did)) {
      this.rateLimitCache.set(did, {
        requests: [],
        lastCleanup: now,
      });
    }

    const rateInfo = this.rateLimitCache.get(did);

    // 清理过期请求
    rateInfo.requests = rateInfo.requests.filter(
      (timestamp) => now - timestamp < windowMs,
    );

    // 检查是否超限
    const current = rateInfo.requests.length;
    if (current >= limit) {
      return { allowed: false, current, limit };
    }

    // 记录请求
    rateInfo.requests.push(now);
    rateInfo.lastCleanup = now;

    return { allowed: true, current: current + 1, limit };
  }

  /**
   * 加载设备权限
   */
  async loadDevicePermissions() {
    try {
      const rows = this.database
        .prepare(
          "SELECT did, permission_level FROM device_permissions WHERE expires_at IS NULL OR expires_at > ?",
        )
        .all(Date.now());

      for (const row of rows) {
        this.devicePermissions.set(row.did, row.permission_level);
      }

      logger.info(`[PermissionGate] 加载了 ${rows.length} 个设备权限`);
    } catch (error) {
      logger.error("[PermissionGate] 加载设备权限失败:", error);
    }
  }

  /**
   * 记录审计日志
   */
  async logAudit(did, method, permissionLevel, granted, reason) {
    try {
      this.database
        .prepare(
          `
          INSERT INTO permission_audit_log
          (did, method, permission_level, granted, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          did || "unknown",
          method,
          permissionLevel,
          granted ? 1 : 0,
          reason,
          Date.now(),
        );
    } catch (error) {
      logger.error("[PermissionGate] 记录审计日志失败:", error);
    }
  }

  /**
   * 获取审计日志
   */
  getAuditLogs(options = {}) {
    try {
      const { did, method, limit = 100, offset = 0 } = options;

      let query = "SELECT * FROM permission_audit_log WHERE 1=1";
      const params = [];

      if (did) {
        query += " AND did = ?";
        params.push(did);
      }

      if (method) {
        query += " AND method = ?";
        params.push(method);
      }

      query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return this.database.prepare(query).all(...params);
    } catch (error) {
      logger.error("[PermissionGate] 获取审计日志失败:", error);
      return [];
    }
  }

  /**
   * 注册自定义命令权限
   */
  registerCommandPermission(method, level) {
    this.commandPermissions[method] = level;
    logger.info(`[PermissionGate] 注册命令权限: ${method} -> Level ${level}`);
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // 每分钟清理一次

    logger.info("[PermissionGate] 定期清理已启动");
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    const now = Date.now();

    // 清理过期 Nonce
    let expiredNonces = 0;
    for (const [nonce, timestamp] of this.nonceCache.entries()) {
      if (now - timestamp > this.options.nonceExpiry) {
        this.nonceCache.delete(nonce);
        expiredNonces++;
      }
    }

    // 清理频率限制缓存
    let cleanedRateLimits = 0;
    for (const [did, rateInfo] of this.rateLimitCache.entries()) {
      if (now - rateInfo.lastCleanup > 300000) {
        // 5 分钟无请求
        this.rateLimitCache.delete(did);
        cleanedRateLimits++;
      }
    }

    if (expiredNonces > 0 || cleanedRateLimits > 0) {
      logger.debug(
        `[PermissionGate] 清理: ${expiredNonces} nonces, ${cleanedRateLimits} rate limits`,
      );
    }
  }

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info("[PermissionGate] 定期清理已停止");
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      devicePermissions: this.devicePermissions.size,
      nonceCache: this.nonceCache.size,
      rateLimitCache: this.rateLimitCache.size,
      registeredCommands: Object.keys(this.commandPermissions).length,
    };
  }
}

module.exports = {
  PermissionGate,
  PERMISSION_LEVELS,
};
