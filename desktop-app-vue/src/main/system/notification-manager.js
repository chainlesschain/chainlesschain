/**
 * 通知管理器
 * 负责管理Electron桌面通知和应用内通知
 */

const { logger, createLogger } = require('../utils/logger.js');
const { Notification, app } = require("electron");
const path = require("path");
const EventEmitter = require("events");

class NotificationManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.notificationQueue = [];
    this.isProcessing = false;
    this.config = {
      enableDesktopNotifications: true,
      enableSound: true,
      enableBadge: true,
      quietHours: {
        enabled: false,
        startTime: "22:00",
        endTime: "08:00",
      },
    };
  }

  /**
   * 初始化通知管理器
   */
  async initialize() {
    try {
      logger.info("[NotificationManager] 初始化通知管理器...");

      // 加载通知配置
      await this.loadConfig();

      // 请求通知权限（仅在某些平台需要）
      if (Notification.isSupported()) {
        logger.info("[NotificationManager] 系统支持桌面通知");
      } else {
        logger.warn("[NotificationManager] 系统不支持桌面通知");
      }

      logger.info("[NotificationManager] 通知管理器初始化完成");
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 加载通知配置
   */
  async loadConfig() {
    try {
      const db = this.database.getDatabase();
      const setting = db
        .prepare(
          "SELECT value FROM system_settings WHERE key = 'notification_config'",
        )
        .get();

      if (setting && setting.value) {
        this.config = { ...this.config, ...JSON.parse(setting.value) };
      }

      logger.info("[NotificationManager] 通知配置已加载:", this.config);
    } catch (error) {
      logger.error("[NotificationManager] 加载配置失败:", error);
    }
  }

  /**
   * 保存通知配置
   */
  async saveConfig() {
    try {
      const db = this.database.getDatabase();
      db.prepare(
        `
        INSERT OR REPLACE INTO system_settings (key, value, updated_at)
        VALUES ('notification_config', ?, ?)
      `,
      ).run(JSON.stringify(this.config), Date.now());

      this.database.saveToFile();
      logger.info("[NotificationManager] 通知配置已保存");
    } catch (error) {
      logger.error("[NotificationManager] 保存配置失败:", error);
    }
  }

  /**
   * 创建通知
   * @param {Object} options - 通知选项
   * @param {String} options.type - 通知类型
   * @param {String} options.title - 通知标题
   * @param {String} options.content - 通知内容
   * @param {String} options.userDid - 用户DID
   * @param {Object} options.data - 附加数据
   */
  async createNotification(options) {
    try {
      const { type, title, content, userDid, data } = options;

      // 保存到数据库
      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const db = this.database.getDatabase();

      db.prepare(
        `
        INSERT INTO notifications (
          id, user_did, type, title, content, data, is_read, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        notificationId,
        userDid || "system",
        type,
        title,
        content,
        data ? JSON.stringify(data) : null,
        0,
        Date.now(),
      );

      this.database.saveToFile();

      // 发送桌面通知
      if (this.shouldShowDesktopNotification()) {
        await this.showDesktopNotification(title, content, data);
      }

      // 发射通知事件
      this.emit("notification-created", {
        id: notificationId,
        type,
        title,
        content,
        data,
      });

      return notificationId;
    } catch (error) {
      logger.error("[NotificationManager] 创建通知失败:", error);
      throw error;
    }
  }

  /**
   * 显示桌面通知
   */
  async showDesktopNotification(title, body, data = {}) {
    try {
      if (!Notification.isSupported()) {
        logger.warn("[NotificationManager] 系统不支持桌面通知");
        return;
      }

      if (!this.config.enableDesktopNotifications) {
        logger.info("[NotificationManager] 桌面通知已禁用");
        return;
      }

      // 检查静默时段
      if (this.isInQuietHours()) {
        logger.info("[NotificationManager] 当前处于静默时段");
        return;
      }

      const iconPath = this.getIconPath();

      const notification = new Notification({
        title: title,
        body: body,
        icon: iconPath,
        silent: !this.config.enableSound,
        urgency: data.urgent ? "critical" : "normal",
      });

      // 点击通知时的处理
      notification.on("click", () => {
        logger.info("[NotificationManager] 通知被点击");
        this.emit("notification-clicked", data);
      });

      notification.show();

      logger.info("[NotificationManager] 桌面通知已显示:", title);
    } catch (error) {
      logger.error("[NotificationManager] 显示桌面通知失败:", error);
    }
  }

  /**
   * 批量创建通知
   */
  async createBulkNotifications(notificationsList) {
    try {
      const results = [];

      for (const notification of notificationsList) {
        const id = await this.createNotification(notification);
        results.push(id);
      }

      return results;
    } catch (error) {
      logger.error("[NotificationManager] 批量创建通知失败:", error);
      throw error;
    }
  }

  /**
   * 获取所有通知
   */
  async getAllNotifications(limit = 50) {
    try {
      const db = this.database.getDatabase();
      const notifications = db
        .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
        .all(limit);

      return notifications;
    } catch (error) {
      logger.error("[NotificationManager] 获取通知失败:", error);
      throw error;
    }
  }

  /**
   * 获取未读通知
   */
  async getUnreadNotifications() {
    try {
      const db = this.database.getDatabase();
      const notifications = db
        .prepare(
          "SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC",
        )
        .all();

      return notifications;
    } catch (error) {
      logger.error("[NotificationManager] 获取未读通知失败:", error);
      throw error;
    }
  }

  /**
   * 获取未读通知数量
   */
  async getUnreadCount() {
    try {
      const db = this.database.getDatabase();
      const result = db
        .prepare(
          "SELECT COUNT(*) as count FROM notifications WHERE is_read = 0",
        )
        .get();

      return result.count || 0;
    } catch (error) {
      logger.error("[NotificationManager] 获取未读数量失败:", error);
      throw error;
    }
  }

  /**
   * 标记通知为已读
   */
  async markAsRead(notificationId) {
    try {
      const db = this.database.getDatabase();
      db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(
        notificationId,
      );
      this.database.saveToFile();

      this.emit("notification-read", notificationId);
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 标记已读失败:", error);
      throw error;
    }
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead() {
    try {
      const db = this.database.getDatabase();
      db.prepare("UPDATE notifications SET is_read = 1").run();
      this.database.saveToFile();

      this.emit("all-notifications-read");
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 全部标记已读失败:", error);
      throw error;
    }
  }

  /**
   * 删除通知
   */
  async deleteNotification(notificationId) {
    try {
      const db = this.database.getDatabase();
      db.prepare("DELETE FROM notifications WHERE id = ?").run(notificationId);
      this.database.saveToFile();

      this.emit("notification-deleted", notificationId);
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 删除通知失败:", error);
      throw error;
    }
  }

  /**
   * 清空所有通知
   */
  async clearAllNotifications() {
    try {
      const db = this.database.getDatabase();
      db.prepare("DELETE FROM notifications").run();
      this.database.saveToFile();

      this.emit("all-notifications-cleared");
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 清空通知失败:", error);
      throw error;
    }
  }

  /**
   * 按类型获取通知
   */
  async getNotificationsByType(type) {
    try {
      const db = this.database.getDatabase();
      const notifications = db
        .prepare(
          "SELECT * FROM notifications WHERE type = ? ORDER BY created_at DESC",
        )
        .all(type);

      return notifications;
    } catch (error) {
      logger.error("[NotificationManager] 按类型获取通知失败:", error);
      throw error;
    }
  }

  /**
   * 更新通知配置
   */
  async updateConfig(newConfig) {
    try {
      this.config = { ...this.config, ...newConfig };
      await this.saveConfig();

      this.emit("config-updated", this.config);
      return true;
    } catch (error) {
      logger.error("[NotificationManager] 更新配置失败:", error);
      throw error;
    }
  }

  /**
   * 判断是否应该显示桌面通知
   */
  shouldShowDesktopNotification() {
    if (!this.config.enableDesktopNotifications) {
      return false;
    }

    if (this.isInQuietHours()) {
      return false;
    }

    return Notification.isSupported();
  }

  /**
   * 判断当前是否在静默时段
   */
  isInQuietHours() {
    if (!this.config.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const { startTime, endTime } = this.config.quietHours;

    // 处理跨天的情况（如 22:00 - 08:00）
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    } else {
      return currentTime >= startTime && currentTime <= endTime;
    }
  }

  /**
   * 获取通知图标路径
   */
  getIconPath() {
    try {
      // 尝试多个可能的图标路径
      const possiblePaths = [
        path.join(__dirname, "../../resources/icon.png"),
        path.join(__dirname, "../../build/icon.png"),
        path.join(app.getAppPath(), "resources/icon.png"),
      ];

      // 返回第一个存在的路径，或者默认路径
      return possiblePaths[0];
    } catch (error) {
      logger.error("[NotificationManager] 获取图标路径失败:", error);
      return null;
    }
  }

  /**
   * 设置应用徽标数字（macOS/Linux）
   */
  setBadgeCount(count) {
    try {
      if (this.config.enableBadge && app.setBadgeCount) {
        app.setBadgeCount(count);
      }
    } catch (error) {
      logger.error("[NotificationManager] 设置徽标失败:", error);
    }
  }

  /**
   * 清除应用徽标
   */
  clearBadge() {
    this.setBadgeCount(0);
  }

  /**
   * 销毁通知管理器
   */
  destroy() {
    this.removeAllListeners();
    this.notificationQueue = [];
    logger.info("[NotificationManager] 通知管理器已销毁");
  }
}

module.exports = NotificationManager;
