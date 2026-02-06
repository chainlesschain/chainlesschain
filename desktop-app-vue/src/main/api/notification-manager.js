/**
 * API Notification Manager
 * RSS 和 Email 通知管理器
 *
 * v0.20.0: 新增 RSS 和邮件通知功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { Notification } = require('electron');
const path = require('path');

class APINotificationManager {
  constructor() {
    this.enabled = true;
    this.notificationQueue = [];
    this.isProcessing = false;
    this.mainWindow = null;
  }

  /**
   * 设置主窗口引用
   * @param {BrowserWindow} window - Electron 主窗口
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * 启用/禁用通知
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * RSS 新文章通知
   */
  notifyNewArticles(feedTitle, count, items = []) {
    if (!this.enabled || count === 0) {return;}

    const notification = new Notification({
      title: 'RSS 新文章',
      body: `${feedTitle} 有 ${count} 篇新文章`,
      icon: this.getIconPath('rss'),
      silent: false,
      urgency: 'normal',
    });

    notification.on('click', () => {
      logger.info('[Notification] 用户点击了 RSS 通知');
      this.openRSSReader(feedTitle, items);
    });

    notification.show();

    // 记录通知
    this.logNotification('rss', 'new_articles', {
      feedTitle,
      count,
      items: items.slice(0, 5).map(item => item.title),
    });
  }

  /**
   * 新邮件通知
   */
  notifyNewEmails(accountEmail, count, emails = []) {
    if (!this.enabled || count === 0) {return;}

    const notification = new Notification({
      title: '新邮件',
      body: `${accountEmail} 收到 ${count} 封新邮件`,
      icon: this.getIconPath('email'),
      silent: false,
      urgency: 'normal',
    });

    notification.on('click', () => {
      logger.info('[Notification] 用户点击了邮件通知');
      this.openEmailReader(accountEmail, emails);
    });

    notification.show();

    // 记录通知
    this.logNotification('email', 'new_emails', {
      accountEmail,
      count,
      subjects: emails.slice(0, 5).map(email => email.subject),
    });
  }

  /**
   * RSS 同步错误通知
   */
  notifyRSSError(feedTitle, error) {
    if (!this.enabled) {return;}

    const notification = new Notification({
      title: 'RSS 同步失败',
      body: `${feedTitle}: ${error}`,
      icon: this.getIconPath('error'),
      silent: false,
      urgency: 'critical',
    });

    notification.show();

    this.logNotification('rss', 'sync_error', {
      feedTitle,
      error,
    });
  }

  /**
   * 邮件同步错误通知
   */
  notifyEmailError(accountEmail, error) {
    if (!this.enabled) {return;}

    const notification = new Notification({
      title: '邮件同步失败',
      body: `${accountEmail}: ${error}`,
      icon: this.getIconPath('error'),
      silent: false,
      urgency: 'critical',
    });

    notification.show();

    this.logNotification('email', 'sync_error', {
      accountEmail,
      error,
    });
  }

  /**
   * 邮件发送成功通知
   */
  notifyEmailSent(to, subject) {
    if (!this.enabled) {return;}

    const notification = new Notification({
      title: '邮件已发送',
      body: `收件人: ${to}\n主题: ${subject}`,
      icon: this.getIconPath('email'),
      silent: true,
      urgency: 'low',
    });

    notification.show();

    this.logNotification('email', 'sent', {
      to,
      subject,
    });
  }

  /**
   * 批量通知（避免通知轰炸）
   */
  notifyBatch(notifications) {
    if (!this.enabled || notifications.length === 0) {return;}

    // 合并相同类型的通知
    const grouped = this.groupNotifications(notifications);

    for (const [type, items] of Object.entries(grouped)) {
      if (type === 'rss') {
        const totalCount = items.reduce((sum, item) => sum + item.count, 0);
        const feedCount = items.length;

        const notification = new Notification({
          title: 'RSS 更新',
          body: `${feedCount} 个订阅源有 ${totalCount} 篇新文章`,
          icon: this.getIconPath('rss'),
        });

        notification.show();
      } else if (type === 'email') {
        const totalCount = items.reduce((sum, item) => sum + item.count, 0);
        const accountCount = items.length;

        const notification = new Notification({
          title: '邮件更新',
          body: `${accountCount} 个账户收到 ${totalCount} 封新邮件`,
          icon: this.getIconPath('email'),
        });

        notification.show();
      }
    }
  }

  /**
   * 分组通知
   */
  groupNotifications(notifications) {
    const grouped = {};

    for (const notif of notifications) {
      if (!grouped[notif.type]) {
        grouped[notif.type] = [];
      }
      grouped[notif.type].push(notif);
    }

    return grouped;
  }

  /**
   * 获取图标路径
   */
  getIconPath(type) {
    const iconMap = {
      rss: 'rss-icon.png',
      email: 'email-icon.png',
      error: 'error-icon.png',
    };

    const iconFile = iconMap[type] || 'default-icon.png';

    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(__dirname, '../../assets', iconFile),
      path.join(__dirname, '../../../assets', iconFile),
      path.join(process.resourcesPath, 'assets', iconFile),
    ];

    // 返回第一个存在的路径，或者默认路径
    const fs = require('fs');
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
      logger.warn('[Notification] 主窗口不可用，无法打开 RSS 阅读器');
      return;
    }

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件到渲染进程
    this.mainWindow.webContents.send('notification:navigate', {
      route: '/rss',
      params: {
        feedTitle,
        highlightItems: items.slice(0, 10).map(item => item.id || item.link),
      },
    });

    logger.info(`[Notification] 打开 RSS 阅读器: ${feedTitle}`);
  }

  /**
   * 打开邮件阅读器
   * @param {string} accountEmail - 邮箱账户
   * @param {Array} emails - 新邮件列表
   */
  openEmailReader(accountEmail, emails = []) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn('[Notification] 主窗口不可用，无法打开邮件阅读器');
      return;
    }

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件到渲染进程
    this.mainWindow.webContents.send('notification:navigate', {
      route: '/email',
      params: {
        account: accountEmail,
        folder: 'inbox',
        highlightEmails: emails.slice(0, 10).map(email => email.id || email.messageId),
      },
    });

    logger.info(`[Notification] 打开邮件阅读器: ${accountEmail}`);
  }

  /**
   * 打开特定路由
   * @param {string} route - 路由路径
   * @param {Object} params - 路由参数
   */
  navigateTo(route, params = {}) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn('[Notification] 主窗口不可用，无法导航');
      return false;
    }

    // 激活窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送导航事件
    this.mainWindow.webContents.send('notification:navigate', {
      route,
      params,
    });

    return true;
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.notificationQueue = [];
    this.isProcessing = false;
    this.mainWindow = null;
  }
}

// 单例模式
let instance = null;

function getAPINotificationManager() {
  if (!instance) {
    instance = new APINotificationManager();
  }
  return instance;
}

module.exports = {
  APINotificationManager,
  getAPINotificationManager,
};
