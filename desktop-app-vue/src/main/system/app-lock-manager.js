/**
 * 应用锁定管理器
 * 提供应用锁定和解锁功能，保护隐私
 */

const { logger } = require("../utils/logger.js");
const { app, BrowserWindow } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class AppLockManager {
  constructor(options = {}) {
    this.lockFilePath =
      options.lockFilePath ||
      path.join(app.getPath("userData"), "app-lock.json");
    this.isLocked = false;
    this.passwordHash = null;
    this.lockTimeout = options.lockTimeout || 300000; // 5分钟
    this.autoLock = options.autoLock !== false;
    this.lastActivityTime = Date.now();
    this.activityTimer = null;

    // 加载锁定配置
    this.loadConfig();

    // 监听用户活动
    if (this.autoLock) {
      this.startActivityMonitor();
    }
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        const content = fs.readFileSync(this.lockFilePath, "utf8");
        const config = JSON.parse(content);

        this.passwordHash = config.passwordHash;
        this.lockTimeout = config.lockTimeout || this.lockTimeout;
        this.autoLock = config.autoLock !== false;

        logger.info("[AppLockManager] Config loaded");
      }
    } catch (error) {
      logger.error("[AppLockManager] Load config error:", error);
    }
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      const config = {
        passwordHash: this.passwordHash,
        lockTimeout: this.lockTimeout,
        autoLock: this.autoLock,
      };

      fs.writeFileSync(this.lockFilePath, JSON.stringify(config, null, 2));
      logger.info("[AppLockManager] Config saved");
    } catch (error) {
      logger.error("[AppLockManager] Save config error:", error);
    }
  }

  /**
   * 设置密码
   */
  setPassword(password) {
    if (!password || password.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }

    this.passwordHash = this.hashPassword(password);
    this.saveConfig();

    logger.info("[AppLockManager] Password set");
    return true;
  }

  /**
   * 验证密码
   */
  verifyPassword(password) {
    if (!this.passwordHash) {
      return false;
    }

    const hash = this.hashPassword(password);
    return hash === this.passwordHash;
  }

  /**
   * 哈希密码
   */
  hashPassword(password) {
    return crypto.createHash("sha256").update(password).digest("hex");
  }

  /**
   * 锁定应用
   */
  lock() {
    if (!this.passwordHash) {
      logger.warn("[AppLockManager] No password set, cannot lock");
      return false;
    }

    this.isLocked = true;

    // 隐藏所有窗口
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.hide();
    }

    logger.info("[AppLockManager] App locked");
    return true;
  }

  /**
   * 解锁应用
   */
  unlock(password) {
    if (!this.verifyPassword(password)) {
      logger.warn("[AppLockManager] Invalid password");
      return false;
    }

    this.isLocked = false;
    this.lastActivityTime = Date.now();

    // 显示所有窗口
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.show();
    }

    logger.info("[AppLockManager] App unlocked");
    return true;
  }

  /**
   * 检查是否已锁定
   */
  isAppLocked() {
    return this.isLocked;
  }

  /**
   * 检查是否设置了密码
   */
  hasPassword() {
    return !!this.passwordHash;
  }

  /**
   * 更改密码
   */
  changePassword(oldPassword, newPassword) {
    if (!this.verifyPassword(oldPassword)) {
      throw new Error("Invalid old password");
    }

    this.setPassword(newPassword);
    logger.info("[AppLockManager] Password changed");
    return true;
  }

  /**
   * 移除密码
   */
  removePassword(password) {
    if (!this.verifyPassword(password)) {
      throw new Error("Invalid password");
    }

    this.passwordHash = null;
    this.saveConfig();

    logger.info("[AppLockManager] Password removed");
    return true;
  }

  /**
   * 设置自动锁定超时
   */
  setLockTimeout(timeout) {
    this.lockTimeout = timeout;
    this.saveConfig();
    logger.info("[AppLockManager] Lock timeout set:", timeout);
  }

  /**
   * 启用/禁用自动锁定
   */
  setAutoLock(enabled) {
    this.autoLock = enabled;
    this.saveConfig();

    if (enabled) {
      this.startActivityMonitor();
    } else {
      this.stopActivityMonitor();
    }

    logger.info(
      "[AppLockManager] Auto lock:",
      enabled ? "enabled" : "disabled",
    );
  }

  /**
   * 启动活动监控
   */
  startActivityMonitor() {
    if (this.activityTimer) {
      return;
    }

    this.activityTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityTime;

      if (
        timeSinceActivity >= this.lockTimeout &&
        !this.isLocked &&
        this.passwordHash
      ) {
        logger.info("[AppLockManager] Auto-locking due to inactivity");
        this.lock();
      }
    }, 10000); // 每10秒检查一次

    logger.info("[AppLockManager] Activity monitor started");
  }

  /**
   * 停止活动监控
   */
  stopActivityMonitor() {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = null;
      logger.info("[AppLockManager] Activity monitor stopped");
    }
  }

  /**
   * 记录用户活动
   */
  recordActivity() {
    this.lastActivityTime = Date.now();
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      isLocked: this.isLocked,
      hasPassword: this.hasPassword(),
      autoLock: this.autoLock,
      lockTimeout: this.lockTimeout,
      timeSinceActivity: Date.now() - this.lastActivityTime,
    };
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.stopActivityMonitor();
  }
}

// 创建全局实例
let appLockManager = null;

function getAppLockManager(options) {
  if (!appLockManager) {
    appLockManager = new AppLockManager(options);
  }
  return appLockManager;
}

module.exports = { AppLockManager, getAppLockManager };
