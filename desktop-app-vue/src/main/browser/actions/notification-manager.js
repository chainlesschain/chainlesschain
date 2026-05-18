/**
 * NotificationManager - 通知管理器
 *
 * 管理自动化事件通知：
 * - 系统通知
 * - 页面内通知
 * - 声音提示
 * - 通知历史
 *
 * @module browser/actions/notification-manager
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

// Lazy load electron Notification to allow dependency injection in tests
let ElectronNotification = null;
const getNotificationClass = () => {
  if (!ElectronNotification) {
    try {
      ElectronNotification = require("electron").Notification;
    } catch (e) {
      // Electron not available (test environment)
      ElectronNotification = null;
    }
  }
  return ElectronNotification;
};

/**
 * 通知级别
 */
const NotificationLevel = {
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
};

/**
 * 通知类型
 */
const NotificationType = {
  SYSTEM: "system", // 系统通知
  TOAST: "toast", // 页面 Toast
  BADGE: "badge", // 徽章
  SOUND: "sound", // 声音
  CUSTOM: "custom", // 自定义
};

/**
 * 预定义通知模板
 */
const NOTIFICATION_TEMPLATES = {
  "automation:started": {
    title: "自动化开始",
    level: NotificationLevel.INFO,
    icon: "play",
  },
  "automation:completed": {
    title: "自动化完成",
    level: NotificationLevel.SUCCESS,
    icon: "check",
  },
  "automation:failed": {
    title: "自动化失败",
    level: NotificationLevel.ERROR,
    icon: "error",
  },
  "automation:paused": {
    title: "自动化暂停",
    level: NotificationLevel.WARNING,
    icon: "pause",
  },
  "download:completed": {
    title: "下载完成",
    level: NotificationLevel.SUCCESS,
    icon: "download",
  },
  "download:failed": {
    title: "下载失败",
    level: NotificationLevel.ERROR,
    icon: "error",
  },
  "error:recovered": {
    title: "错误已恢复",
    level: NotificationLevel.INFO,
    icon: "refresh",
  },
  "policy:violation": {
    title: "策略违规",
    level: NotificationLevel.WARNING,
    icon: "shield",
  },
  "session:timeout": {
    title: "会话超时",
    level: NotificationLevel.WARNING,
    icon: "clock",
  },
};

class NotificationManager extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing
   * @param {Function} [dependencies.NotificationClass] - Notification class to use
   */
  constructor(config = {}, dependencies = {}) {
    super();

    // Dependency injection for testing
    this.NotificationClass =
      dependencies.NotificationClass || getNotificationClass();

    this.config = {
      enableSystemNotifications: config.enableSystemNotifications !== false,
      enableSound: config.enableSound || false,
      enableToast: config.enableToast !== false,
      defaultTimeout: config.defaultTimeout || 5000,
      maxNotifications: config.maxNotifications || 100,
      groupSimilar: config.groupSimilar !== false,
      groupTimeout: config.groupTimeout || 3000,
      quietHoursStart: config.quietHoursStart ?? null,
      quietHoursEnd: config.quietHoursEnd ?? null,
      templates: { ...NOTIFICATION_TEMPLATES, ...config.templates },
      ...config,
    };

    // 通知历史
    this.history = [];

    // 活动通知
    this.activeNotifications = new Map();

    // 通知分组
    this.groups = new Map();

    // 统计
    this.stats = {
      totalNotifications: 0,
      byLevel: {},
      byType: {},
      dismissed: 0,
      clicked: 0,
    };
  }

  /**
   * 发送通知
   * @param {Object} options - 通知选项
   * @returns {Object}
   */
  notify(options) {
    // 检查静默时间
    if (this._isQuietHours()) {
      return { success: false, reason: "Quiet hours active" };
    }

    const notification = this._createNotification(options);

    // 检查分组
    if (this.config.groupSimilar) {
      const grouped = this._tryGroup(notification);
      if (grouped) {
        return { success: true, id: grouped.id, grouped: true };
      }
    }

    // 添加到历史
    this._addToHistory(notification);

    // 发送不同类型的通知
    const results = [];

    if (
      options.type === NotificationType.SYSTEM ||
      (!options.type && this.config.enableSystemNotifications)
    ) {
      results.push(this._showSystemNotification(notification));
    }

    if (
      options.type === NotificationType.TOAST ||
      (!options.type && this.config.enableToast)
    ) {
      results.push(this._showToast(notification));
    }

    if (
      options.type === NotificationType.SOUND ||
      (!options.type && this.config.enableSound && notification.sound)
    ) {
      results.push(this._playSound(notification));
    }

    // 更新统计
    this._updateStats(notification);

    this.emit("notified", notification);

    return {
      success: true,
      id: notification.id,
      results,
    };
  }

  /**
   * 使用模板发送通知
   * @param {string} templateId - 模板 ID
   * @param {Object} data - 数据
   * @returns {Object}
   */
  notifyFromTemplate(templateId, data = {}) {
    const template = this.config.templates[templateId];
    if (!template) {
      return { success: false, error: `Template not found: ${templateId}` };
    }

    return this.notify({
      ...template,
      ...data,
      body: data.body || data.message,
      templateId,
    });
  }

  /**
   * 创建通知对象
   * @private
   */
  _createNotification(options) {
    return {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: options.title || "Notification",
      body: options.body || options.message || "",
      level: options.level || NotificationLevel.INFO,
      type: options.type || NotificationType.SYSTEM,
      icon: options.icon,
      sound: options.sound,
      timeout: options.timeout || this.config.defaultTimeout,
      actions: options.actions || [],
      data: options.data || {},
      templateId: options.templateId,
      timestamp: Date.now(),
      read: false,
      dismissed: false,
    };
  }

  /**
   * 显示系统通知
   * @private
   */
  _showSystemNotification(notification) {
    const NotificationClass = this.NotificationClass;

    if (!NotificationClass || !NotificationClass.isSupported()) {
      return { success: false, error: "System notifications not supported" };
    }

    try {
      const systemNotif = new NotificationClass({
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        silent: !notification.sound,
      });

      systemNotif.on("click", () => {
        notification.clicked = true;
        this.stats.clicked++;
        this.emit("clicked", notification);
      });

      systemNotif.on("close", () => {
        notification.dismissed = true;
        this.stats.dismissed++;
        this.activeNotifications.delete(notification.id);
      });

      systemNotif.show();

      this.activeNotifications.set(notification.id, {
        notification,
        systemNotif,
      });

      // 自动关闭
      if (notification.timeout > 0) {
        setTimeout(() => {
          if (!notification.dismissed) {
            systemNotif.close();
          }
        }, notification.timeout);
      }

      return { success: true, type: "system" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 显示 Toast 通知
   * @private
   */
  _showToast(notification) {
    // Toast 通知通过事件发送给渲染进程处理
    this.emit("toast", notification);

    return { success: true, type: "toast" };
  }

  /**
   * 播放声音
   * @private
   */
  _playSound(notification) {
    // 声音通过事件发送给渲染进程处理
    this.emit("sound", {
      sound: notification.sound,
      level: notification.level,
    });

    return { success: true, type: "sound" };
  }

  /**
   * 尝试分组通知
   * @private
   */
  _tryGroup(notification) {
    const groupKey = `${notification.title}_${notification.level}`;
    const existing = this.groups.get(groupKey);

    if (existing && Date.now() - existing.lastTime < this.config.groupTimeout) {
      existing.count++;
      existing.lastTime = Date.now();
      existing.notification.body = `${notification.body} (${existing.count} similar)`;

      this.emit("grouped", {
        id: existing.notification.id,
        count: existing.count,
      });

      return existing.notification;
    }

    // 创建新分组
    this.groups.set(groupKey, {
      notification,
      count: 1,
      lastTime: Date.now(),
    });

    // 清理过期分组
    setTimeout(() => {
      this.groups.delete(groupKey);
    }, this.config.groupTimeout * 2);

    return null;
  }

  /**
   * 检查静默时间
   * @private
   */
  _isQuietHours() {
    if (
      this.config.quietHoursStart === null ||
      this.config.quietHoursEnd === null
    ) {
      return false;
    }

    const now = new Date();
    const hour = now.getHours();
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    if (start <= end) {
      return hour >= start && hour < end;
    } else {
      return hour >= start || hour < end;
    }
  }

  /**
   * 添加到历史
   * @private
   */
  _addToHistory(notification) {
    this.history.push(notification);

    if (this.history.length > this.config.maxNotifications) {
      this.history = this.history.slice(-this.config.maxNotifications / 2);
    }
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(notification) {
    this.stats.totalNotifications++;

    if (!this.stats.byLevel[notification.level]) {
      this.stats.byLevel[notification.level] = 0;
    }
    this.stats.byLevel[notification.level]++;

    if (!this.stats.byType[notification.type]) {
      this.stats.byType[notification.type] = 0;
    }
    this.stats.byType[notification.type]++;
  }

  /**
   * 关闭通知
   * @param {string} notificationId - 通知 ID
   * @returns {Object}
   */
  dismiss(notificationId) {
    const active = this.activeNotifications.get(notificationId);
    if (!active) {
      return { success: false, error: "Notification not found" };
    }

    if (active.systemNotif) {
      active.systemNotif.close();
    }

    active.notification.dismissed = true;
    this.activeNotifications.delete(notificationId);
    this.stats.dismissed++;

    this.emit("dismissed", active.notification);

    return { success: true };
  }

  /**
   * 关闭所有通知
   * @returns {Object}
   */
  dismissAll() {
    let dismissed = 0;

    for (const [id, active] of this.activeNotifications) {
      if (active.systemNotif) {
        active.systemNotif.close();
      }
      active.notification.dismissed = true;
      dismissed++;
    }

    this.activeNotifications.clear();
    this.stats.dismissed += dismissed;

    this.emit("allDismissed", { count: dismissed });

    return { success: true, dismissed };
  }

  /**
   * 标记为已读
   * @param {string} notificationId - 通知 ID
   * @returns {Object}
   */
  markAsRead(notificationId) {
    const notification = this.history.find((n) => n.id === notificationId);
    if (!notification) {
      return { success: false, error: "Notification not found" };
    }

    notification.read = true;
    this.emit("read", notification);

    return { success: true };
  }

  /**
   * 标记所有为已读
   * @returns {Object}
   */
  markAllAsRead() {
    let marked = 0;

    for (const notification of this.history) {
      if (!notification.read) {
        notification.read = true;
        marked++;
      }
    }

    this.emit("allRead", { count: marked });

    return { success: true, marked };
  }

  /**
   * 获取通知历史
   * @param {Object} filter - 过滤条件
   * @returns {Array}
   */
  getHistory(filter = {}) {
    let notifications = [...this.history];

    if (filter.level) {
      notifications = notifications.filter((n) => n.level === filter.level);
    }

    if (filter.type) {
      notifications = notifications.filter((n) => n.type === filter.type);
    }

    if (filter.unreadOnly) {
      notifications = notifications.filter((n) => !n.read);
    }

    if (filter.since) {
      notifications = notifications.filter((n) => n.timestamp >= filter.since);
    }

    if (filter.limit) {
      notifications = notifications.slice(-filter.limit);
    }

    return notifications.reverse();
  }

  /**
   * 获取未读数量
   * @returns {number}
   */
  getUnreadCount() {
    return this.history.filter((n) => !n.read).length;
  }

  /**
   * 注册模板
   * @param {string} templateId - 模板 ID
   * @param {Object} template - 模板配置
   * @returns {Object}
   */
  registerTemplate(templateId, template) {
    this.config.templates[templateId] = template;

    this.emit("templateRegistered", { templateId, template });

    return { success: true };
  }

  /**
   * 注销模板
   * @param {string} templateId - 模板 ID
   * @returns {Object}
   */
  unregisterTemplate(templateId) {
    if (!this.config.templates[templateId]) {
      return { success: false, error: "Template not found" };
    }

    delete this.config.templates[templateId];

    return { success: true };
  }

  /**
   * 获取模板列表
   * @returns {Object}
   */
  getTemplates() {
    return { ...this.config.templates };
  }

  /**
   * 设置静默时间
   * @param {number} start - 开始小时 (0-23)
   * @param {number} end - 结束小时 (0-23)
   * @returns {Object}
   */
  setQuietHours(start, end) {
    this.config.quietHoursStart = start;
    this.config.quietHoursEnd = end;

    this.emit("quietHoursSet", { start, end });

    return { success: true };
  }

  /**
   * 清除静默时间
   * @returns {Object}
   */
  clearQuietHours() {
    this.config.quietHoursStart = null;
    this.config.quietHoursEnd = null;

    this.emit("quietHoursCleared");

    return { success: true };
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      unread: this.getUnreadCount(),
      active: this.activeNotifications.size,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalNotifications: 0,
      byLevel: {},
      byType: {},
      dismissed: 0,
      clicked: 0,
    };

    this.emit("statsReset");
  }

  /**
   * 清除历史
   */
  clearHistory() {
    this.history = [];
    this.emit("historyCleared");
  }

  /**
   * 导出配置
   * @returns {Object}
   */
  exportConfig() {
    return {
      enableSystemNotifications: this.config.enableSystemNotifications,
      enableSound: this.config.enableSound,
      enableToast: this.config.enableToast,
      defaultTimeout: this.config.defaultTimeout,
      groupSimilar: this.config.groupSimilar,
      groupTimeout: this.config.groupTimeout,
      quietHoursStart: this.config.quietHoursStart,
      quietHoursEnd: this.config.quietHoursEnd,
      templates: this.config.templates,
    };
  }

  /**
   * 导入配置
   * @param {Object} config - 配置
   * @returns {Object}
   */
  importConfig(config) {
    Object.assign(this.config, config);

    this.emit("configImported");

    return { success: true };
  }
}

// 单例
let notificationInstance = null;

function getNotificationManager(config) {
  if (!notificationInstance) {
    notificationInstance = new NotificationManager(config);
  }
  return notificationInstance;
}

module.exports = {
  NotificationManager,
  NotificationLevel,
  NotificationType,
  getNotificationManager,
};
