/**
 * 通知同步处理器
 *
 * 处理 PC 通知推送到 Android：
 * - notification.send: 发送通知到 Android
 * - notification.getHistory: 获取通知历史
 * - notification.clearHistory: 清除通知历史
 * - notification.getSettings: 获取通知设置
 * - notification.updateSettings: 更新通知设置
 *
 * 通知类型：
 * - system: 系统通知
 * - app: 应用通知
 * - message: 消息通知
 * - reminder: 提醒通知
 * - alert: 警报通知
 *
 * @module remote/handlers/notification-handler
 */

const { logger } = require("../../utils/logger");
const { Notification } = require("electron");
const crypto = require("crypto");

/**
 * 通知处理器类
 */
class NotificationHandler {
  constructor(database, options = {}) {
    this.database = database;
    this.options = {
      maxHistorySize: options.maxHistorySize || 500,
      defaultExpiry: options.defaultExpiry || 7 * 24 * 60 * 60 * 1000, // 7天
      enableGrouping: options.enableGrouping !== false,
      ...options,
    };

    // 通知设置
    this.settings = {
      enabled: true,
      soundEnabled: true,
      vibrationEnabled: true,
      filters: {
        system: true,
        app: true,
        message: true,
        reminder: true,
        alert: true,
      },
      quietHours: {
        enabled: false,
        start: "22:00",
        end: "08:00",
      },
    };

    // 事件发射器（由外部设置）
    this.eventEmitter = null;

    // 初始化数据库表
    this.ensureTables();

    logger.info("[NotificationHandler] 通知处理器已初始化");
  }

  /**
   * 确保数据库表存在
   */
  ensureTables() {
    if (!this.database) {
      logger.warn("[NotificationHandler] 数据库未提供，通知历史将不被保存");
      return;
    }

    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS notification_history (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          icon TEXT,
          app_name TEXT,
          app_id TEXT,
          urgency TEXT DEFAULT 'normal',
          group_key TEXT,
          actions TEXT,
          data TEXT,
          source TEXT DEFAULT 'local',
          read INTEGER DEFAULT 0,
          sent_to_mobile INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          expires_at INTEGER
        )
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_notification_history_created_at
        ON notification_history(created_at DESC)
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_notification_history_type
        ON notification_history(type)
      `);

      this.database.exec(`
        CREATE TABLE IF NOT EXISTS notification_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // 加载设置
      this.loadSettings();

      logger.info("[NotificationHandler] 通知历史表已就绪");
    } catch (error) {
      logger.error("[NotificationHandler] 创建通知历史表失败:", error);
    }
  }

  /**
   * 加载通知设置
   */
  loadSettings() {
    if (!this.database) {
      return;
    }

    try {
      const row = this.database
        .prepare("SELECT value FROM notification_settings WHERE key = ?")
        .get("settings");

      if (row) {
        this.settings = { ...this.settings, ...JSON.parse(row.value) };
      }
    } catch (error) {
      logger.error("[NotificationHandler] 加载设置失败:", error);
    }
  }

  /**
   * 保存通知设置
   */
  saveSettings() {
    if (!this.database) {
      return;
    }

    try {
      this.database
        .prepare(
          `
          INSERT OR REPLACE INTO notification_settings (key, value, updated_at)
          VALUES (?, ?, ?)
        `,
        )
        .run("settings", JSON.stringify(this.settings), Date.now());
    } catch (error) {
      logger.error("[NotificationHandler] 保存设置失败:", error);
    }
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[NotificationHandler] 处理命令: ${action}`);

    switch (action) {
      case "send":
        return await this.sendNotification(params, context);

      case "sendToMobile":
        return await this.sendToMobile(params, context);

      case "getHistory":
        return await this.getHistory(params, context);

      case "markAsRead":
        return await this.markAsRead(params, context);

      case "clearHistory":
        return await this.clearHistory(params, context);

      case "getSettings":
        return await this.getSettings(params, context);

      case "updateSettings":
        return await this.updateSettings(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 发送通知（本地显示）
   */
  async sendNotification(params, context) {
    const {
      title,
      body,
      icon,
      type = "app",
      urgency = "normal",
      actions,
      data,
      silent = false,
    } = params;

    logger.info(`[NotificationHandler] 发送通知: ${title}`);

    try {
      // 检查是否在静默时段
      if (this.isQuietHours()) {
        logger.info("[NotificationHandler] 当前在静默时段，跳过通知");
        return { success: false, reason: "quiet_hours" };
      }

      // 检查通知类型是否启用
      if (!this.settings.filters[type]) {
        logger.info(`[NotificationHandler] 通知类型 ${type} 已禁用`);
        return { success: false, reason: "type_disabled" };
      }

      const id = this.generateNotificationId();
      const now = Date.now();

      // 显示本地通知
      if (Notification.isSupported() && !silent) {
        const notification = new Notification({
          title,
          body,
          icon,
          urgency,
          silent: !this.settings.soundEnabled,
        });

        notification.show();

        // 监听点击事件
        notification.on("click", () => {
          this.handleNotificationClick(id, data);
        });

        // 监听操作按钮
        if (actions && actions.length > 0) {
          notification.on("action", (event, index) => {
            this.handleNotificationAction(id, actions[index], data);
          });
        }
      }

      // 保存到历史
      await this.saveNotification({
        id,
        type,
        title,
        body,
        icon,
        urgency,
        actions,
        data,
        source: "local",
        createdAt: now,
      });

      return {
        success: true,
        id,
        timestamp: now,
      };
    } catch (error) {
      logger.error("[NotificationHandler] 发送通知失败:", error);
      throw new Error(`Send notification failed: ${error.message}`);
    }
  }

  /**
   * 发送通知到移动端
   */
  async sendToMobile(params, context) {
    const {
      title,
      body,
      icon,
      type = "app",
      urgency = "normal",
      actions,
      data,
      targetDevices,
    } = params;

    logger.info(`[NotificationHandler] 发送通知到移动端: ${title}`);

    try {
      const id = this.generateNotificationId();
      const now = Date.now();

      const notification = {
        id,
        type,
        title,
        body,
        icon,
        urgency,
        actions,
        data,
        source: "pc",
        timestamp: now,
      };

      // 保存到历史
      await this.saveNotification({
        ...notification,
        createdAt: now,
        sentToMobile: true,
      });

      // 触发发送事件（由外部处理实际发送）
      if (this.eventEmitter) {
        this.eventEmitter.emit("notification:send", {
          notification,
          targetDevices,
        });
      }

      return {
        success: true,
        id,
        timestamp: now,
      };
    } catch (error) {
      logger.error("[NotificationHandler] 发送通知到移动端失败:", error);
      throw new Error(`Send to mobile failed: ${error.message}`);
    }
  }

  /**
   * 获取通知历史
   */
  async getHistory(params, context) {
    const {
      limit = 50,
      offset = 0,
      type,
      unreadOnly = false,
      startDate,
      endDate,
    } = params;

    logger.info(`[NotificationHandler] 获取通知历史 (limit: ${limit})`);

    try {
      if (!this.database) {
        return { items: [], total: 0 };
      }

      let query = "SELECT * FROM notification_history WHERE 1=1";
      const queryParams = [];

      if (type) {
        query += " AND type = ?";
        queryParams.push(type);
      }

      if (unreadOnly) {
        query += " AND read = 0";
      }

      if (startDate) {
        query += " AND created_at >= ?";
        queryParams.push(startDate);
      }

      if (endDate) {
        query += " AND created_at <= ?";
        queryParams.push(endDate);
      }

      // 排除过期通知
      query += " AND (expires_at IS NULL OR expires_at > ?)";
      queryParams.push(Date.now());

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      queryParams.push(limit, offset);

      const items = this.database.prepare(query).all(...queryParams);

      // 获取总数
      let countQuery =
        "SELECT COUNT(*) as count FROM notification_history WHERE 1=1";
      const countParams = [];

      if (type) {
        countQuery += " AND type = ?";
        countParams.push(type);
      }

      if (unreadOnly) {
        countQuery += " AND read = 0";
      }

      countQuery += " AND (expires_at IS NULL OR expires_at > ?)";
      countParams.push(Date.now());

      const total = this.database.prepare(countQuery).get(...countParams).count;

      return {
        items: items.map((item) => ({
          ...item,
          actions: item.actions ? JSON.parse(item.actions) : null,
          data: item.data ? JSON.parse(item.data) : null,
        })),
        total,
      };
    } catch (error) {
      logger.error("[NotificationHandler] 获取通知历史失败:", error);
      throw new Error(`Get history failed: ${error.message}`);
    }
  }

  /**
   * 标记通知为已读
   */
  async markAsRead(params, context) {
    const { id, ids } = params;

    logger.info("[NotificationHandler] 标记通知为已读");

    try {
      if (!this.database) {
        return { success: false, error: "Database not available" };
      }

      const targetIds = ids || (id ? [id] : []);

      if (targetIds.length === 0) {
        // 标记所有为已读
        this.database
          .prepare("UPDATE notification_history SET read = 1 WHERE read = 0")
          .run();
      } else {
        const placeholders = targetIds.map(() => "?").join(",");
        this.database
          .prepare(
            `UPDATE notification_history SET read = 1 WHERE id IN (${placeholders})`,
          )
          .run(...targetIds);
      }

      return {
        success: true,
        markedCount: targetIds.length || "all",
      };
    } catch (error) {
      logger.error("[NotificationHandler] 标记已读失败:", error);
      throw new Error(`Mark as read failed: ${error.message}`);
    }
  }

  /**
   * 清除通知历史
   */
  async clearHistory(params, context) {
    const { before, type } = params;

    logger.info("[NotificationHandler] 清除通知历史");

    try {
      if (!this.database) {
        return { success: false, error: "Database not available" };
      }

      let query = "DELETE FROM notification_history WHERE 1=1";
      const queryParams = [];

      if (before) {
        query += " AND created_at < ?";
        queryParams.push(before);
      }

      if (type) {
        query += " AND type = ?";
        queryParams.push(type);
      }

      const result = this.database.prepare(query).run(...queryParams);

      return {
        success: true,
        deletedCount: result.changes,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[NotificationHandler] 清除通知历史失败:", error);
      throw new Error(`Clear history failed: ${error.message}`);
    }
  }

  /**
   * 获取通知设置
   */
  async getSettings(params, context) {
    return {
      ...this.settings,
      timestamp: Date.now(),
    };
  }

  /**
   * 更新通知设置
   */
  async updateSettings(params, context) {
    logger.info("[NotificationHandler] 更新通知设置");

    try {
      // 合并设置
      if (params.enabled !== undefined) {
        this.settings.enabled = params.enabled;
      }
      if (params.soundEnabled !== undefined) {
        this.settings.soundEnabled = params.soundEnabled;
      }
      if (params.vibrationEnabled !== undefined) {
        this.settings.vibrationEnabled = params.vibrationEnabled;
      }
      if (params.filters) {
        this.settings.filters = { ...this.settings.filters, ...params.filters };
      }
      if (params.quietHours) {
        this.settings.quietHours = {
          ...this.settings.quietHours,
          ...params.quietHours,
        };
      }

      // 保存设置
      this.saveSettings();

      return {
        success: true,
        settings: this.settings,
      };
    } catch (error) {
      logger.error("[NotificationHandler] 更新设置失败:", error);
      throw new Error(`Update settings failed: ${error.message}`);
    }
  }

  /**
   * 保存通知到历史
   */
  async saveNotification(notification) {
    if (!this.database) {
      return;
    }

    try {
      const expiresAt = Date.now() + this.options.defaultExpiry;

      this.database
        .prepare(
          `
          INSERT OR REPLACE INTO notification_history
          (id, type, title, body, icon, app_name, app_id, urgency, group_key,
           actions, data, source, sent_to_mobile, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          notification.id,
          notification.type,
          notification.title,
          notification.body || null,
          notification.icon || null,
          notification.appName || null,
          notification.appId || null,
          notification.urgency || "normal",
          notification.groupKey || null,
          notification.actions ? JSON.stringify(notification.actions) : null,
          notification.data ? JSON.stringify(notification.data) : null,
          notification.source || "local",
          notification.sentToMobile ? 1 : 0,
          notification.createdAt,
          expiresAt,
        );

      // 清理超出限制的历史
      this.database
        .prepare(
          `
          DELETE FROM notification_history
          WHERE id NOT IN (
            SELECT id FROM notification_history
            ORDER BY created_at DESC
            LIMIT ?
          )
        `,
        )
        .run(this.options.maxHistorySize);
    } catch (error) {
      logger.error("[NotificationHandler] 保存通知失败:", error);
    }
  }

  /**
   * 生成通知 ID
   */
  generateNotificationId() {
    return `notif-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  /**
   * 检查是否在静默时段
   */
  isQuietHours() {
    if (!this.settings.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = this.settings.quietHours.start
      .split(":")
      .map(Number);
    const [endHour, endMin] = this.settings.quietHours.end
      .split(":")
      .map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime < endTime) {
      // 同一天内
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // 跨天
      return currentTime >= startTime || currentTime < endTime;
    }
  }

  /**
   * 处理通知点击
   */
  handleNotificationClick(id, data) {
    logger.info(`[NotificationHandler] 通知点击: ${id}`);

    if (this.eventEmitter) {
      this.eventEmitter.emit("notification:click", { id, data });
    }
  }

  /**
   * 处理通知操作
   */
  handleNotificationAction(id, action, data) {
    logger.info(`[NotificationHandler] 通知操作: ${id} - ${action.id}`);

    if (this.eventEmitter) {
      this.eventEmitter.emit("notification:action", { id, action, data });
    }
  }

  /**
   * 设置事件发射器
   */
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.eventEmitter = null;
    logger.info("[NotificationHandler] 通知处理器已清理");
  }
}

module.exports = { NotificationHandler };
