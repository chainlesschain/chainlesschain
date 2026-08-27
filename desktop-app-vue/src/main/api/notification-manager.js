/**
 * API Notification Manager
 * RSS 和 Email 通知管理器
 *
 * v0.20.0: 新增 RSS 和邮件通知功能
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const {
  NotificationBoundaryError,
  boundedCount,
  cloneBoundedNavigation,
  createNotificationLimits,
  projectNavigationItems,
  truncateUtf8,
} = require("./notification-manager-boundaries.js");

class APINotificationManager {
  constructor(options = {}) {
    this.limits = createNotificationLimits(options.limits || options);
    this.NotificationClass =
      options.NotificationClass || require("electron").Notification;
    this.enabled = true;
    this.mainWindow = null;
    this.activeNotifications = new Map();
    this.destroyed = false;
  }

  /**
   * 设置主窗口引用
   * @param {BrowserWindow} window - Electron 主窗口
   */
  setMainWindow(window) {
    if (this.destroyed) {
      return false;
    }
    this.mainWindow = window;
    return true;
  }

  /**
   * 启用/禁用通知
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  _boundedText(value) {
    return truncateUtf8(value, this.limits.maxTextBytes);
  }

  _rejection(code, scope, extra = {}) {
    return {
      accepted: false,
      code,
      scope,
      ...extra,
    };
  }

  _showNotification(options, onClick = null) {
    if (this.destroyed) {
      return this._rejection("CANCELED", "api_notifications");
    }
    if (!this.enabled) {
      return this._rejection("DISABLED", "api_notifications");
    }
    if (this.activeNotifications.size >= this.limits.maxActiveNotifications) {
      return this._rejection("OVERLOADED", "api_notifications", {
        retryAfterMs: 1000,
        limit: {
          maxActiveNotifications: this.limits.maxActiveNotifications,
        },
      });
    }

    let notification;
    try {
      notification = new this.NotificationClass(options);
    } catch (error) {
      logger.error("[Notification] 创建系统通知失败", error);
      return this._rejection("DELIVERY_FAILED", "api_notifications");
    }

    let released = false;
    let timer = null;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      if (timer) {
        clearTimeout(timer);
      }
      this.activeNotifications.delete(notification);
    };
    notification.once?.("close", release);
    notification.once?.("failed", release);
    if (typeof onClick === "function") {
      notification.on?.("click", () => {
        release();
        try {
          onClick();
        } catch (error) {
          logger.error("[Notification] 点击处理失败", error);
        } finally {
          notification.close?.();
        }
      });
    }

    timer = setTimeout(() => {
      release();
      notification.close?.();
    }, this.limits.notificationTtlMs);
    timer.unref?.();
    this.activeNotifications.set(notification, timer);

    try {
      notification.show();
      return { accepted: true };
    } catch (error) {
      release();
      logger.error("[Notification] 显示系统通知失败", error);
      return this._rejection("DELIVERY_FAILED", "api_notifications");
    }
  }

  getStats() {
    return {
      enabled: this.enabled,
      destroyed: this.destroyed,
      activeNotifications: this.activeNotifications.size,
      maxActiveNotifications: this.limits.maxActiveNotifications,
    };
  }

  /**
   * RSS 新文章通知
   */
  notifyNewArticles(feedTitle, count, items = []) {
    const normalizedCount = boundedCount(count);
    if (normalizedCount === 0) {
      return this._rejection("INVALID_ARGUMENT", "rss_notification_count");
    }
    const boundedFeedTitle = this._boundedText(feedTitle);
    const boundedItems = projectNavigationItems(
      items,
      this.limits.maxClickItems,
      this.limits.maxTextBytes,
      ["id", "link", "title"],
    );

    const result = this._showNotification(
      {
        title: "RSS 新文章",
        body: this._boundedText(
          `${boundedFeedTitle} 有 ${normalizedCount} 篇新文章`,
        ),
        icon: this.getIconPath("rss"),
        silent: false,
        urgency: "normal",
      },
      () => {
        logger.info("[Notification] 用户点击了 RSS 通知");
        this.openRSSReader(boundedFeedTitle, boundedItems);
      },
    );

    if (result.accepted) {
      this.logNotification("rss", "new_articles", {
        feedTitle: boundedFeedTitle,
        count: normalizedCount,
        items: boundedItems.slice(0, 5).map((item) => item.title),
      });
    }
    return result;
  }

  /**
   * 新邮件通知
   */
  notifyNewEmails(accountEmail, count, emails = []) {
    const normalizedCount = boundedCount(count);
    if (normalizedCount === 0) {
      return this._rejection("INVALID_ARGUMENT", "email_notification_count");
    }
    const boundedAccountEmail = this._boundedText(accountEmail);
    const boundedEmails = projectNavigationItems(
      emails,
      this.limits.maxClickItems,
      this.limits.maxTextBytes,
      ["id", "messageId", "subject"],
    );

    const result = this._showNotification(
      {
        title: "新邮件",
        body: this._boundedText(
          `${boundedAccountEmail} 收到 ${normalizedCount} 封新邮件`,
        ),
        icon: this.getIconPath("email"),
        silent: false,
        urgency: "normal",
      },
      () => {
        logger.info("[Notification] 用户点击了邮件通知");
        this.openEmailReader(boundedAccountEmail, boundedEmails);
      },
    );

    if (result.accepted) {
      this.logNotification("email", "new_emails", {
        accountEmail: boundedAccountEmail,
        count: normalizedCount,
        subjects: boundedEmails.slice(0, 5).map((email) => email.subject),
      });
    }
    return result;
  }

  /**
   * RSS 同步错误通知
   */
  notifyRSSError(feedTitle, error) {
    const boundedFeedTitle = this._boundedText(feedTitle);
    const boundedError = this._boundedText(error);

    const result = this._showNotification({
      title: "RSS 同步失败",
      body: this._boundedText(`${boundedFeedTitle}: ${boundedError}`),
      icon: this.getIconPath("error"),
      silent: false,
      urgency: "critical",
    });

    if (result.accepted) {
      this.logNotification("rss", "sync_error", {
        feedTitle: boundedFeedTitle,
        error: boundedError,
      });
    }
    return result;
  }

  /**
   * 邮件同步错误通知
   */
  notifyEmailError(accountEmail, error) {
    const boundedAccountEmail = this._boundedText(accountEmail);
    const boundedError = this._boundedText(error);

    const result = this._showNotification({
      title: "邮件同步失败",
      body: this._boundedText(`${boundedAccountEmail}: ${boundedError}`),
      icon: this.getIconPath("error"),
      silent: false,
      urgency: "critical",
    });

    if (result.accepted) {
      this.logNotification("email", "sync_error", {
        accountEmail: boundedAccountEmail,
        error: boundedError,
      });
    }
    return result;
  }

  /**
   * 邮件发送成功通知
   */
  notifyEmailSent(to, subject) {
    const boundedTo = this._boundedText(to);
    const boundedSubject = this._boundedText(subject);

    const result = this._showNotification({
      title: "邮件已发送",
      body: this._boundedText(`收件人: ${boundedTo}\n主题: ${boundedSubject}`),
      icon: this.getIconPath("email"),
      silent: true,
      urgency: "low",
    });

    if (result.accepted) {
      this.logNotification("email", "sent", {
        to: boundedTo,
        subject: boundedSubject,
      });
    }
    return result;
  }

  /**
   * 批量通知（避免通知轰炸）
   */
  notifyBatch(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return this._rejection("INVALID_ARGUMENT", "notification_batch");
    }

    const admittedNotifications = notifications.slice(
      0,
      this.limits.maxBatchNotifications,
    );
    const grouped = this.groupNotifications(admittedNotifications);
    const deliveryResults = [];

    for (const [type, items] of grouped) {
      if (type === "rss") {
        const totalCount = items.reduce(
          (sum, item) => Math.min(sum + item.count, Number.MAX_SAFE_INTEGER),
          0,
        );
        const feedCount = items.length;

        deliveryResults.push(
          this._showNotification({
            title: "RSS 更新",
            body: `${feedCount} 个订阅源有 ${totalCount} 篇新文章`,
            icon: this.getIconPath("rss"),
          }),
        );
      } else if (type === "email") {
        const totalCount = items.reduce(
          (sum, item) => Math.min(sum + item.count, Number.MAX_SAFE_INTEGER),
          0,
        );
        const accountCount = items.length;

        deliveryResults.push(
          this._showNotification({
            title: "邮件更新",
            body: `${accountCount} 个账户收到 ${totalCount} 封新邮件`,
            icon: this.getIconPath("email"),
          }),
        );
      }
    }

    return {
      accepted: deliveryResults.some((result) => result.accepted),
      deliveryResults,
      admitted: admittedNotifications.length,
      dropped: notifications.length - admittedNotifications.length,
    };
  }

  /**
   * 分组通知
   */
  groupNotifications(notifications) {
    const grouped = new Map();

    for (const notif of notifications) {
      let type;
      let count;
      try {
        type = notif?.type;
        count = boundedCount(notif?.count);
      } catch {
        continue;
      }
      if ((type !== "rss" && type !== "email") || count === 0) {
        continue;
      }
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type).push({ type, count });
    }

    return grouped;
  }

  /**
   * 获取图标路径
   */
  getIconPath(type) {
    const iconMap = {
      rss: "rss-icon.png",
      email: "email-icon.png",
      error: "error-icon.png",
    };

    const iconFile = iconMap[type] || "default-icon.png";

    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(__dirname, "../../assets", iconFile),
      path.join(__dirname, "../../../assets", iconFile),
      path.join(process.resourcesPath || __dirname, "assets", iconFile),
    ];

    // 返回第一个存在的路径，或者默认路径
    const fs = require("fs");
    for (const iconPath of possiblePaths) {
      if (fs.existsSync(iconPath)) {
        return iconPath;
      }
    }

    // 如果都不存在，返回第一个路径（系统会使用默认图标）
    return possiblePaths[0];
  }

  /**
   * 记录通知日志
   */
  logNotification(type, action, data) {
    logger.info(`[Notification] ${type}:${action}`, {
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * 打开 RSS 阅读器
   * @param {string} feedTitle - Feed 标题
   * @param {Array} items - 新文章列表
   */
  openRSSReader(feedTitle, items = []) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn("[Notification] 主窗口不可用，无法打开 RSS 阅读器");
      return;
    }

    const boundedFeedTitle = this._boundedText(feedTitle);
    const boundedItems = projectNavigationItems(
      items,
      this.limits.maxClickItems,
      this.limits.maxTextBytes,
      ["id", "link"],
    );

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件到渲染进程
    this.mainWindow.webContents.send("notification:navigate", {
      route: "/rss",
      params: {
        feedTitle: boundedFeedTitle,
        highlightItems: boundedItems.map((item) => item.id || item.link),
      },
    });

    logger.info(`[Notification] 打开 RSS 阅读器: ${boundedFeedTitle}`);
  }

  /**
   * 打开邮件阅读器
   * @param {string} accountEmail - 邮箱账户
   * @param {Array} emails - 新邮件列表
   */
  openEmailReader(accountEmail, emails = []) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn("[Notification] 主窗口不可用，无法打开邮件阅读器");
      return;
    }

    const boundedAccountEmail = this._boundedText(accountEmail);
    const boundedEmails = projectNavigationItems(
      emails,
      this.limits.maxClickItems,
      this.limits.maxTextBytes,
      ["id", "messageId"],
    );

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件到渲染进程
    this.mainWindow.webContents.send("notification:navigate", {
      route: "/email",
      params: {
        account: boundedAccountEmail,
        folder: "inbox",
        highlightEmails: boundedEmails.map(
          (email) => email.id || email.messageId,
        ),
      },
    });

    logger.info(`[Notification] 打开邮件阅读器: ${boundedAccountEmail}`);
  }

  /**
   * 打开特定路由
   * @param {string} route - 路由路径
   * @param {Object} params - 路由参数
   */
  navigateTo(route, params = {}) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn("[Notification] 主窗口不可用，无法导航");
      return false;
    }

    let boundedParams;
    try {
      boundedParams = cloneBoundedNavigation(
        params,
        this.limits.maxNavigationBytes,
      );
    } catch (error) {
      if (error instanceof NotificationBoundaryError) {
        logger.warn("[Notification] 导航参数超过边界", {
          code: error.code,
          scope: error.scope,
        });
        return false;
      }
      throw error;
    }
    const boundedRoute = this._boundedText(route);

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件
    this.mainWindow.webContents.send("notification:navigate", {
      route: boundedRoute,
      params: boundedParams,
    });

    return true;
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const [notification, timer] of [
      ...this.activeNotifications.entries(),
    ]) {
      clearTimeout(timer);
      try {
        notification.close?.();
      } catch (error) {
        logger.warn("[Notification] 关闭系统通知失败", error);
      }
    }
    this.activeNotifications.clear();
    this.mainWindow = null;
    if (instance === this) {
      instance = null;
    }
  }
}

// 单例模式
let instance = null;

function getAPINotificationManager(options) {
  if (!instance) {
    instance = new APINotificationManager(options);
  }
  return instance;
}

module.exports = {
  APINotificationManager,
  getAPINotificationManager,
};
