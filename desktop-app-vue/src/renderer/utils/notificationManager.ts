/**
 * 通知系统
 * 提供统一的通知管理，支持多种通知类型和持久化
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { notification } from 'ant-design-vue';

// ==================== 类型定义 ====================

/**
 * 通知类型值
 */
export type NotificationTypeValue = 'info' | 'success' | 'warning' | 'error';

/**
 * 通知优先级值
 */
export type NotificationPriorityValue = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 通知动作
 */
export interface NotificationAction {
  label: string;
  handler: () => void;
}

/**
 * 通知选项
 */
export interface NotificationOptions {
  id?: string;
  type?: NotificationTypeValue;
  title?: string;
  message?: string;
  description?: string;
  priority?: NotificationPriorityValue;
  duration?: number;
  timestamp?: number;
  read?: boolean;
  persistent?: boolean;
  actions?: NotificationAction[];
  data?: Record<string, any>;
  onClick?: ((notif: NotificationInstance) => void) | null;
  onClose?: ((notif: NotificationInstance) => void) | null;
}

/**
 * 通知实例
 */
export interface NotificationInstance {
  id: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  description: string;
  priority: NotificationPriorityValue;
  duration: number;
  timestamp: number;
  read: boolean;
  persistent: boolean;
  actions: NotificationAction[];
  data: Record<string, any>;
  onClick: ((notif: NotificationInstance) => void) | null;
  onClose: ((notif: NotificationInstance) => void) | null;
  toJSON: () => Record<string, any>;
}

/**
 * 通知过滤器
 */
export interface NotificationFilter {
  type?: NotificationTypeValue;
  read?: boolean;
  priority?: NotificationPriorityValue;
  sortBy?: 'priority' | 'timestamp';
}

/**
 * 通知监听器
 */
export type NotificationListener = (
  event: 'show' | 'read' | 'readAll' | 'remove' | 'clear' | 'clearRead',
  data?: NotificationInstance
) => void;

/**
 * 使用通知返回类型
 */
export interface UseNotificationsReturn {
  notifications: ComputedRef<NotificationInstance[]>;
  unreadCount: ComputedRef<number>;
  show: (options: NotificationOptions) => string;
  info: (title: string, message: string, options?: NotificationOptions) => string;
  success: (title: string, message: string, options?: NotificationOptions) => string;
  warning: (title: string, message: string, options?: NotificationOptions) => string;
  error: (title: string, message: string, options?: NotificationOptions) => string;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  clearRead: () => void;
  getNotifications: (filter?: NotificationFilter) => NotificationInstance[];
  addListener: (listener: NotificationListener) => void;
  removeListener: (listener: NotificationListener) => void;
}

// ==================== 常量 ====================

/**
 * 通知类型
 */
export const NotificationType: Record<string, NotificationTypeValue> = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
};

/**
 * 通知优先级
 */
export const NotificationPriority: Record<string, NotificationPriorityValue> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

// ==================== 类实现 ====================

/**
 * 通知类
 */
class Notification implements NotificationInstance {
  id: string;
  type: NotificationTypeValue;
  title: string;
  message: string;
  description: string;
  priority: NotificationPriorityValue;
  duration: number;
  timestamp: number;
  read: boolean;
  persistent: boolean;
  actions: NotificationAction[];
  data: Record<string, any>;
  onClick: ((notif: NotificationInstance) => void) | null;
  onClose: ((notif: NotificationInstance) => void) | null;

  constructor(options: NotificationOptions = {}) {
    this.id = options.id || `notification-${Date.now()}-${Math.random()}`;
    this.type = options.type || 'info';
    this.title = options.title || '';
    this.message = options.message || '';
    this.description = options.description || '';
    this.priority = options.priority || 'normal';
    this.duration = options.duration || 4.5;
    this.timestamp = options.timestamp || Date.now();
    this.read = options.read || false;
    this.persistent = options.persistent || false;
    this.actions = options.actions || [];
    this.data = options.data || {};
    this.onClick = options.onClick || null;
    this.onClose = options.onClose || null;
  }

  toJSON(): Record<string, any> {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      message: this.message,
      description: this.description,
      priority: this.priority,
      duration: this.duration,
      timestamp: this.timestamp,
      read: this.read,
      persistent: this.persistent,
      actions: this.actions,
      data: this.data,
    };
  }
}

/**
 * 通知管理器
 */
class NotificationManager {
  notifications: Ref<NotificationInstance[]>;
  private maxNotifications: number;
  private listeners: NotificationListener[];

  constructor() {
    this.notifications = ref([]);
    this.maxNotifications = 100;
    this.listeners = [];

    // 从本地存储加载持久化通知
    this.loadFromStorage();
  }

  /**
   * 显示通知
   */
  show(options: NotificationOptions): string {
    const notif = new Notification(options);

    // 添加到列表
    this.notifications.value.unshift(notif);

    // 限制数量
    if (this.notifications.value.length > this.maxNotifications) {
      this.notifications.value = this.notifications.value.slice(0, this.maxNotifications);
    }

    // 保存到本地存储
    if (notif.persistent) {
      this.saveToStorage();
    }

    // 显示系统通知
    this.showSystemNotification(notif);

    // 触发监听器
    this.notifyListeners('show', notif);

    return notif.id;
  }

  /**
   * 显示系统通知
   */
  private showSystemNotification(notif: NotificationInstance): void {
    const config = {
      message: notif.title || notif.message,
      description: notif.description,
      duration: notif.duration,
      placement: 'topRight' as const,
      onClick: () => {
        if (notif.onClick) {
          notif.onClick(notif);
        }
        this.markAsRead(notif.id);
      },
      onClose: () => {
        if (notif.onClose) {
          notif.onClose(notif);
        }
      },
    };

    // 根据类型显示不同的通知
    switch (notif.type) {
      case 'success':
        notification.success(config);
        break;
      case 'warning':
        notification.warning(config);
        break;
      case 'error':
        notification.error(config);
        break;
      default:
        notification.info(config);
    }
  }

  /**
   * 显示信息通知
   */
  info(title: string, message: string, options: NotificationOptions = {}): string {
    return this.show({
      type: 'info',
      title,
      message,
      ...options,
    });
  }

  /**
   * 显示成功通知
   */
  success(title: string, message: string, options: NotificationOptions = {}): string {
    return this.show({
      type: 'success',
      title,
      message,
      ...options,
    });
  }

  /**
   * 显示警告通知
   */
  warning(title: string, message: string, options: NotificationOptions = {}): string {
    return this.show({
      type: 'warning',
      title,
      message,
      ...options,
    });
  }

  /**
   * 显示错误通知
   */
  error(title: string, message: string, options: NotificationOptions = {}): string {
    return this.show({
      type: 'error',
      title,
      message,
      ...options,
    });
  }

  /**
   * 标记为已读
   */
  markAsRead(id: string): void {
    const notif = this.notifications.value.find((n) => n.id === id);
    if (notif) {
      notif.read = true;
      this.saveToStorage();
      this.notifyListeners('read', notif);
    }
  }

  /**
   * 标记所有为已读
   */
  markAllAsRead(): void {
    this.notifications.value.forEach((notif) => {
      notif.read = true;
    });
    this.saveToStorage();
    this.notifyListeners('readAll');
  }

  /**
   * 删除通知
   */
  remove(id: string): void {
    const index = this.notifications.value.findIndex((n) => n.id === id);
    if (index > -1) {
      const notif = this.notifications.value[index];
      this.notifications.value.splice(index, 1);
      this.saveToStorage();
      this.notifyListeners('remove', notif);
    }
  }

  /**
   * 清空所有通知
   */
  clear(): void {
    this.notifications.value = [];
    this.saveToStorage();
    this.notifyListeners('clear');
  }

  /**
   * 清空已读通知
   */
  clearRead(): void {
    this.notifications.value = this.notifications.value.filter((n) => !n.read);
    this.saveToStorage();
    this.notifyListeners('clearRead');
  }

  /**
   * 获取未读通知数量
   */
  getUnreadCount(): number {
    return this.notifications.value.filter((n) => !n.read).length;
  }

  /**
   * 获取通知列表
   */
  getNotifications(filter: NotificationFilter = {}): NotificationInstance[] {
    let result = [...this.notifications.value];

    // 按类型过滤
    if (filter.type) {
      result = result.filter((n) => n.type === filter.type);
    }

    // 按已读状态过滤
    if (filter.read !== undefined) {
      result = result.filter((n) => n.read === filter.read);
    }

    // 按优先级过滤
    if (filter.priority) {
      result = result.filter((n) => n.priority === filter.priority);
    }

    // 排序
    if (filter.sortBy === 'priority') {
      const priorityOrder: Record<NotificationPriorityValue, number> = {
        urgent: 0,
        high: 1,
        normal: 2,
        low: 3,
      };
      result.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    } else {
      // 默认按时间排序
      result.sort((a, b) => b.timestamp - a.timestamp);
    }

    return result;
  }

  /**
   * 添加监听器
   */
  addListener(listener: NotificationListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: NotificationListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(
    event: 'show' | 'read' | 'readAll' | 'remove' | 'clear' | 'clearRead',
    data?: NotificationInstance
  ): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event, data);
      } catch (error) {
        logger.error('[NotificationManager] Listener error:', error);
      }
    });
  }

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      const persistentNotifications = this.notifications.value
        .filter((n) => n.persistent)
        .map((n) => n.toJSON());

      localStorage.setItem('notifications', JSON.stringify(persistentNotifications));
    } catch (error) {
      logger.error('[NotificationManager] Save to storage error:', error);
    }
  }

  /**
   * 从本地存储加载
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('notifications');
      if (stored) {
        const data = JSON.parse(stored);
        this.notifications.value = data.map((n: NotificationOptions) => new Notification(n));
      }
    } catch (error) {
      logger.error('[NotificationManager] Load from storage error:', error);
    }
  }
}

// 创建全局实例
const notificationManager = new NotificationManager();

/**
 * 组合式函数：使用通知
 */
export function useNotifications(): UseNotificationsReturn {
  return {
    notifications: computed(() => notificationManager.notifications.value),
    unreadCount: computed(() => notificationManager.getUnreadCount()),
    show: (options) => notificationManager.show(options),
    info: (title, message, options) => notificationManager.info(title, message, options),
    success: (title, message, options) => notificationManager.success(title, message, options),
    warning: (title, message, options) => notificationManager.warning(title, message, options),
    error: (title, message, options) => notificationManager.error(title, message, options),
    markAsRead: (id) => notificationManager.markAsRead(id),
    markAllAsRead: () => notificationManager.markAllAsRead(),
    remove: (id) => notificationManager.remove(id),
    clear: () => notificationManager.clear(),
    clearRead: () => notificationManager.clearRead(),
    getNotifications: (filter) => notificationManager.getNotifications(filter),
    addListener: (listener) => notificationManager.addListener(listener),
    removeListener: (listener) => notificationManager.removeListener(listener),
  };
}

export default notificationManager;
