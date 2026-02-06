/**
 * 活动管理器
 * 跟踪用户活动、最近文件、操作历史等
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== 类型定义 ====================

/**
 * 活动类型枚举
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
} as const;

export type ActivityTypeValue = typeof ActivityType[keyof typeof ActivityType];

/**
 * 活动选项
 */
export interface ActivityOptions {
  id?: string;
  type?: ActivityTypeValue;
  title?: string;
  description?: string;
  timestamp?: number;
  data?: Record<string, any>;
  icon?: string | null;
  path?: string | null;
  metadata?: Record<string, any>;
}

/**
 * 活动 JSON 格式
 */
export interface ActivityJSON {
  id: string;
  type: ActivityTypeValue;
  title: string;
  description: string;
  timestamp: number;
  data: Record<string, any>;
  icon: string | null;
  path: string | null;
  metadata: Record<string, any>;
}

/**
 * 最近文件
 */
export interface RecentFile {
  id: string;
  path: string;
  title: string;
  type: ActivityTypeValue;
  timestamp: number;
  metadata: Record<string, any>;
}

/**
 * 活动过滤器
 */
export interface ActivityFilter {
  type?: ActivityTypeValue;
  startTime?: number;
  endTime?: number;
  path?: string;
  limit?: number;
}

/**
 * 活动统计
 */
export interface ActivityStatistics {
  total: number;
  typeStats: Record<string, number>;
  hourStats: Record<number, number>;
  recentFilesCount: number;
}

/**
 * 活动监听器
 */
export type ActivityListener = (event: string, data?: any) => void;

/**
 * 导出数据
 */
export interface ActivityExportData {
  activities: ActivityJSON[];
  recentFiles: RecentFile[];
  exportTime: number;
}

/**
 * 存储数据
 */
interface ActivityStorageData {
  activities: ActivityJSON[];
  recentFiles: RecentFile[];
}

/**
 * useActivities 返回类型
 */
export interface UseActivitiesReturn {
  activities: ComputedRef<Activity[]>;
  recentFiles: ComputedRef<RecentFile[]>;
  record: (options: ActivityOptions) => string;
  getActivities: (filter?: ActivityFilter) => Activity[];
  getRecentFiles: (limit?: number) => RecentFile[];
  getTodayActivities: () => Activity[];
  getWeekActivities: () => Activity[];
  getStatistics: (timeRange?: 'today' | 'week' | 'all') => ActivityStatistics;
  clear: () => void;
  clearRecentFiles: () => void;
  removeFromRecentFiles: (path: string) => void;
  addListener: (listener: ActivityListener) => void;
  removeListener: (listener: ActivityListener) => void;
  exportData: () => ActivityExportData;
  importData: (data: ActivityExportData) => boolean;
}

// ==================== 类实现 ====================

/**
 * 活动类
 */
class Activity {
  id: string;
  type: ActivityTypeValue;
  title: string;
  description: string;
  timestamp: number;
  data: Record<string, any>;
  icon: string | null;
  path: string | null;
  metadata: Record<string, any>;

  constructor(options: ActivityOptions = {}) {
    this.id = options.id || `activity-${Date.now()}-${Math.random()}`;
    this.type = options.type || ActivityType.FILE_OPEN;
    this.title = options.title || '';
    this.description = options.description || '';
    this.timestamp = options.timestamp || Date.now();
    this.data = options.data || {};
    this.icon = options.icon || null;
    this.path = options.path || null;
    this.metadata = options.metadata || {};
  }

  toJSON(): ActivityJSON {
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
  activities: Ref<Activity[]>;
  recentFiles: Ref<RecentFile[]>;
  private maxActivities: number;
  private maxRecentFiles: number;
  private listeners: ActivityListener[];

  constructor() {
    this.activities = ref([]);
    this.recentFiles = ref([]);
    this.maxActivities = 500;
    this.maxRecentFiles = 20;
    this.listeners = [];

    this.loadFromStorage();
  }

  /**
   * 记录活动
   */
  record(options: ActivityOptions): string {
    const activity = new Activity(options);

    this.activities.value.unshift(activity);

    if (this.activities.value.length > this.maxActivities) {
      this.activities.value = this.activities.value.slice(0, this.maxActivities);
    }

    if (this.isFileActivity(activity.type) && activity.path) {
      this.updateRecentFiles(activity);
    }

    this.saveToStorage();
    this.notifyListeners('record', activity);

    return activity.id;
  }

  /**
   * 判断是否为文件相关活动
   */
  private isFileActivity(type: ActivityTypeValue): boolean {
    const fileTypes: readonly ActivityTypeValue[] = [
      ActivityType.FILE_OPEN,
      ActivityType.FILE_CREATE,
      ActivityType.FILE_EDIT,
      ActivityType.NOTE_CREATE,
      ActivityType.NOTE_EDIT,
      ActivityType.PROJECT_OPEN,
    ];
    return fileTypes.includes(type);
  }

  /**
   * 更新最近文件列表
   */
  private updateRecentFiles(activity: Activity): void {
    this.recentFiles.value = this.recentFiles.value.filter(
      f => f.path !== activity.path
    );

    this.recentFiles.value.unshift({
      id: activity.id,
      path: activity.path!,
      title: activity.title,
      type: activity.type,
      timestamp: activity.timestamp,
      metadata: activity.metadata,
    });

    if (this.recentFiles.value.length > this.maxRecentFiles) {
      this.recentFiles.value = this.recentFiles.value.slice(0, this.maxRecentFiles);
    }
  }

  /**
   * 获取活动列表
   */
  getActivities(filter: ActivityFilter = {}): Activity[] {
    let result = [...this.activities.value];

    if (filter.type) {
      result = result.filter(a => a.type === filter.type);
    }

    if (filter.startTime) {
      result = result.filter(a => a.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      result = result.filter(a => a.timestamp <= filter.endTime!);
    }

    if (filter.path) {
      result = result.filter(a => a.path === filter.path);
    }

    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 获取最近文件
   */
  getRecentFiles(limit: number = 10): RecentFile[] {
    return this.recentFiles.value.slice(0, limit);
  }

  /**
   * 获取今日活动
   */
  getTodayActivities(): Activity[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startTime = today.getTime();

    return this.getActivities({ startTime });
  }

  /**
   * 获取本周活动
   */
  getWeekActivities(): Activity[] {
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
  getStatistics(timeRange: 'today' | 'week' | 'all' = 'today'): ActivityStatistics {
    let activities: Activity[] = [];

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

    const typeStats: Record<string, number> = {};
    activities.forEach(activity => {
      typeStats[activity.type] = (typeStats[activity.type] || 0) + 1;
    });

    const hourStats: Record<number, number> = {};
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
  clear(): void {
    this.activities.value = [];
    this.saveToStorage();
    this.notifyListeners('clear');
  }

  /**
   * 清空最近文件
   */
  clearRecentFiles(): void {
    this.recentFiles.value = [];
    this.saveToStorage();
    this.notifyListeners('clearRecentFiles');
  }

  /**
   * 从最近文件中移除
   */
  removeFromRecentFiles(path: string): void {
    this.recentFiles.value = this.recentFiles.value.filter(f => f.path !== path);
    this.saveToStorage();
    this.notifyListeners('removeRecentFile', { path });
  }

  /**
   * 添加监听器
   */
  addListener(listener: ActivityListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: ActivityListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: string, data?: any): void {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        logger.error('[ActivityManager] Listener error:', error);
      }
    });
  }

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      const data: ActivityStorageData = {
        activities: this.activities.value.slice(0, 100).map(a => a.toJSON()),
        recentFiles: this.recentFiles.value,
      };
      localStorage.setItem('activities', JSON.stringify(data));
    } catch (error) {
      logger.error('[ActivityManager] Save to storage error:', error);
    }
  }

  /**
   * 从本地存储加载
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('activities');
      if (stored) {
        const data: ActivityStorageData = JSON.parse(stored);

        if (data.activities) {
          this.activities.value = data.activities.map(a => new Activity(a));
        }

        if (data.recentFiles) {
          this.recentFiles.value = data.recentFiles;
        }
      }
    } catch (error) {
      logger.error('[ActivityManager] Load from storage error:', error);
    }
  }

  /**
   * 导出活动数据
   */
  exportData(): ActivityExportData {
    return {
      activities: this.activities.value.map(a => a.toJSON()),
      recentFiles: this.recentFiles.value,
      exportTime: Date.now(),
    };
  }

  /**
   * 导入活动数据
   */
  importData(data: ActivityExportData): boolean {
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
      logger.error('[ActivityManager] Import data error:', error);
      return false;
    }
  }
}

// 创建全局实例
const activityManager = new ActivityManager();

/**
 * 组合式函数：使用活动管理器
 */
export function useActivities(): UseActivitiesReturn {
  return {
    activities: computed(() => activityManager.activities.value),
    recentFiles: computed(() => activityManager.recentFiles.value),
    record: (options: ActivityOptions) => activityManager.record(options),
    getActivities: (filter?: ActivityFilter) => activityManager.getActivities(filter),
    getRecentFiles: (limit?: number) => activityManager.getRecentFiles(limit),
    getTodayActivities: () => activityManager.getTodayActivities(),
    getWeekActivities: () => activityManager.getWeekActivities(),
    getStatistics: (timeRange?: 'today' | 'week' | 'all') => activityManager.getStatistics(timeRange),
    clear: () => activityManager.clear(),
    clearRecentFiles: () => activityManager.clearRecentFiles(),
    removeFromRecentFiles: (path: string) => activityManager.removeFromRecentFiles(path),
    addListener: (listener: ActivityListener) => activityManager.addListener(listener),
    removeListener: (listener: ActivityListener) => activityManager.removeListener(listener),
    exportData: () => activityManager.exportData(),
    importData: (data: ActivityExportData) => activityManager.importData(data),
  };
}

export default activityManager;
