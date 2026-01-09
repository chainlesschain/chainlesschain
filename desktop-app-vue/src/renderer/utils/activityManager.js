/**
 * 活动管理器
 * 跟踪用户活动、最近文件、操作历史等
 */

import { ref, computed } from 'vue';

/**
 * 活动类型
 */
export const ActivityType = {
  FILE_OPEN: 'file_open',
  FILE_CREATE: 'file_create',
  FILE_EDIT: 'file_edit',
  FILE_DELETE: 'file_delete',
  NOTE_CREATE: 'note_create',
  NOTE_EDIT: 'note_edit',
  NOTE_DELETE: 'note_delete',
  CHAT_START: 'chat_start',
  CHAT_MESSAGE: 'chat_message',
  PROJECT_CREATE: 'project_create',
  PROJECT_OPEN: 'project_open',
  SEARCH: 'search',
  IMPORT: 'import',
  EXPORT: 'export',
  SYNC: 'sync',
  BACKUP: 'backup',
};

/**
 * 活动类
 */
class Activity {
  constructor(options = {}) {
    this.id = options.id || `activity-${Date.now()}-${Math.random()}`;
    this.type = options.type || ActivityType.FILE_OPEN;
    this.title = options.title || '';
    this.description = options.description || '';
    this.timestamp = options.timestamp || Date.now();
    this.data = options.data || {};
    this.icon = options.icon || null;
    this.path = options.path || null; // 文件路径
    this.metadata = options.metadata || {};
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      description: this.description,
      timestamp: this.timestamp,
      data: this.data,
      icon: this.icon,
      path: this.path,
      metadata: this.metadata,
    };
  }
}

/**
 * 活动管理器
 */
class ActivityManager {
  constructor() {
    this.activities = ref([]);
    this.recentFiles = ref([]);
    this.maxActivities = 500;
    this.maxRecentFiles = 20;
    this.listeners = [];

    // 从本地存储加载
    this.loadFromStorage();
  }

  /**
   * 记录活动
   */
  record(options) {
    const activity = new Activity(options);

    // 添加到列表
    this.activities.value.unshift(activity);

    // 限制数量
    if (this.activities.value.length > this.maxActivities) {
      this.activities.value = this.activities.value.slice(0, this.maxActivities);
    }

    // 如果是文件相关活动，更新最近文件列表
    if (this.isFileActivity(activity.type) && activity.path) {
      this.updateRecentFiles(activity);
    }

    // 保存到本地存储
    this.saveToStorage();

    // 触发监听器
    this.notifyListeners('record', activity);

    return activity.id;
  }

  /**
   * 判断是否为文件相关活动
   */
  isFileActivity(type) {
    return [
      ActivityType.FILE_OPEN,
      ActivityType.FILE_CREATE,
      ActivityType.FILE_EDIT,
      ActivityType.NOTE_CREATE,
      ActivityType.NOTE_EDIT,
      ActivityType.PROJECT_OPEN,
    ].includes(type);
  }

  /**
   * 更新最近文件列表
   */
  updateRecentFiles(activity) {
    // 移除已存在的相同路径
    this.recentFiles.value = this.recentFiles.value.filter(
      f => f.path !== activity.path
    );

    // 添加到开头
    this.recentFiles.value.unshift({
      id: activity.id,
      path: activity.path,
      title: activity.title,
      type: activity.type,
      timestamp: activity.timestamp,
      metadata: activity.metadata,
    });

    // 限制数量
    if (this.recentFiles.value.length > this.maxRecentFiles) {
      this.recentFiles.value = this.recentFiles.value.slice(0, this.maxRecentFiles);
    }
  }

  /**
   * 获取活动列表
   */
  getActivities(filter = {}) {
    let result = [...this.activities.value];

    // 按类型过滤
    if (filter.type) {
      result = result.filter(a => a.type === filter.type);
    }

    // 按时间范围过滤
    if (filter.startTime) {
      result = result.filter(a => a.timestamp >= filter.startTime);
    }
    if (filter.endTime) {
      result = result.filter(a => a.timestamp <= filter.endTime);
    }

    // 按路径过滤
    if (filter.path) {
      result = result.filter(a => a.path === filter.path);
    }

    // 限制数量
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 获取最近文件
   */
  getRecentFiles(limit = 10) {
    return this.recentFiles.value.slice(0, limit);
  }

  /**
   * 获取今日活动
   */
  getTodayActivities() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startTime = today.getTime();

    return this.getActivities({ startTime });
  }

  /**
   * 获取本周活动
   */
  getWeekActivities() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    const startTime = startOfWeek.getTime();

    return this.getActivities({ startTime });
  }

  /**
   * 获取活动统计
   */
  getStatistics(timeRange = 'today') {
    let activities = [];

    switch (timeRange) {
      case 'today':
        activities = this.getTodayActivities();
        break;
      case 'week':
        activities = this.getWeekActivities();
        break;
      case 'all':
        activities = this.activities.value;
        break;
    }

    // 按类型统计
    const typeStats = {};
    activities.forEach(activity => {
      typeStats[activity.type] = (typeStats[activity.type] || 0) + 1;
    });

    // 按小时统计（今日）
    const hourStats = {};
    if (timeRange === 'today') {
      activities.forEach(activity => {
        const hour = new Date(activity.timestamp).getHours();
        hourStats[hour] = (hourStats[hour] || 0) + 1;
      });
    }

    return {
      total: activities.length,
      typeStats,
      hourStats,
      recentFilesCount: this.recentFiles.value.length,
    };
  }

  /**
   * 清空活动历史
   */
  clear() {
    this.activities.value = [];
    this.saveToStorage();
    this.notifyListeners('clear');
  }

  /**
   * 清空最近文件
   */
  clearRecentFiles() {
    this.recentFiles.value = [];
    this.saveToStorage();
    this.notifyListeners('clearRecentFiles');
  }

  /**
   * 从最近文件中移除
   */
  removeFromRecentFiles(path) {
    this.recentFiles.value = this.recentFiles.value.filter(f => f.path !== path);
    this.saveToStorage();
    this.notifyListeners('removeRecentFile', { path });
  }

  /**
   * 添加监听器
   */
  addListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  notifyListeners(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('[ActivityManager] Listener error:', error);
      }
    });
  }

  /**
   * 保存到本地存储
   */
  saveToStorage() {
    try {
      const data = {
        activities: this.activities.value.slice(0, 100).map(a => a.toJSON()),
        recentFiles: this.recentFiles.value,
      };
      localStorage.setItem('activities', JSON.stringify(data));
    } catch (error) {
      console.error('[ActivityManager] Save to storage error:', error);
    }
  }

  /**
   * 从本地存储加载
   */
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('activities');
      if (stored) {
        const data = JSON.parse(stored);

        if (data.activities) {
          this.activities.value = data.activities.map(a => new Activity(a));
        }

        if (data.recentFiles) {
          this.recentFiles.value = data.recentFiles;
        }
      }
    } catch (error) {
      console.error('[ActivityManager] Load from storage error:', error);
    }
  }

  /**
   * 导出活动数据
   */
  exportData() {
    return {
      activities: this.activities.value.map(a => a.toJSON()),
      recentFiles: this.recentFiles.value,
      exportTime: Date.now(),
    };
  }

  /**
   * 导入活动数据
   */
  importData(data) {
    try {
      if (data.activities) {
        this.activities.value = data.activities.map(a => new Activity(a));
      }

      if (data.recentFiles) {
        this.recentFiles.value = data.recentFiles;
      }

      this.saveToStorage();
      return true;
    } catch (error) {
      console.error('[ActivityManager] Import data error:', error);
      return false;
    }
  }
}

// 创建全局实例
const activityManager = new ActivityManager();

/**
 * 组合式函数：使用活动管理器
 */
export function useActivities() {
  return {
    activities: computed(() => activityManager.activities.value),
    recentFiles: computed(() => activityManager.recentFiles.value),
    record: (options) => activityManager.record(options),
    getActivities: (filter) => activityManager.getActivities(filter),
    getRecentFiles: (limit) => activityManager.getRecentFiles(limit),
    getTodayActivities: () => activityManager.getTodayActivities(),
    getWeekActivities: () => activityManager.getWeekActivities(),
    getStatistics: (timeRange) => activityManager.getStatistics(timeRange),
    clear: () => activityManager.clear(),
    clearRecentFiles: () => activityManager.clearRecentFiles(),
    removeFromRecentFiles: (path) => activityManager.removeFromRecentFiles(path),
    addListener: (listener) => activityManager.addListener(listener),
    removeListener: (listener) => activityManager.removeListener(listener),
    exportData: () => activityManager.exportData(),
    importData: (data) => activityManager.importData(data),
  };
}

export default activityManager;
