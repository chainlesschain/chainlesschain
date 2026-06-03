/**
 * History Store - 操作历史记录管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, Ref, ComputedRef } from 'vue';

// ==================== 类型定义 ====================

/**
 * 操作类型常量
 */
export const ACTION_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  ENABLE: 'enable',
  DISABLE: 'disable',
  BATCH_ENABLE: 'batch_enable',
  BATCH_DISABLE: 'batch_disable',
  BATCH_DELETE: 'batch_delete',
} as const;

/**
 * 操作类型
 */
export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

/**
 * 实体类型常量
 */
export const ENTITY_TYPES = {
  SKILL: 'skill',
  TOOL: 'tool',
} as const;

/**
 * 实体类型
 */
export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

/**
 * 历史记录项
 */
export interface HistoryRecord {
  id: number;
  timestamp: string;
  actionType: ActionType;
  entityType: EntityType;
  entityName?: string;
  entityId?: string;
  count?: number;
  details?: any;
  [key: string]: any;
}

/**
 * 创建记录数据
 */
export interface CreateRecordData {
  actionType: ActionType;
  entityType: EntityType;
  entityName?: string;
  entityId?: string;
  count?: number;
  details?: any;
  [key: string]: any;
}

/**
 * 统计信息
 */
export interface HistoryStatistics {
  total: number;
  skills: number;
  tools: number;
  creates: number;
  updates: number;
  deletes: number;
}

/**
 * 操作图标映射
 */
export type ActionIconMap = Record<ActionType, string>;

/**
 * 操作颜色映射
 */
export type ActionColorMap = Record<ActionType, string>;

// ==================== 常量 ====================

/**
 * 最大历史记录数
 */
const MAX_HISTORY = 100;

/**
 * 本地存储键名
 */
const STORAGE_KEY = 'skill-tool-history';

// ==================== Store ====================

export const useHistoryStore = defineStore('history', () => {
  // ========== State ==========

  /**
   * 历史记录列表
   */
  const records: Ref<HistoryRecord[]> = ref([]);

  // ========== Actions ==========

  /**
   * 添加历史记录
   */
  function addRecord(record: CreateRecordData): void {
    const newRecord: HistoryRecord = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      ...record,
    };

    records.value.unshift(newRecord);

    // 限制历史记录数量
    if (records.value.length > MAX_HISTORY) {
      records.value = records.value.slice(0, MAX_HISTORY);
    }

    // 保存到本地存储
    saveToLocalStorage();
  }

  /**
   * 清空历史记录
   */
  function clearHistory(): void {
    records.value = [];
    saveToLocalStorage();
  }

  /**
   * 删除单条记录
   */
  function deleteRecord(id: number): void {
    const index = records.value.findIndex((r) => r.id === id);
    if (index !== -1) {
      records.value.splice(index, 1);
      saveToLocalStorage();
    }
  }

  /**
   * 获取最近的记录
   */
  function getRecentRecords(count: number = 10): HistoryRecord[] {
    return records.value.slice(0, count);
  }

  /**
   * 按实体类型筛选
   */
  function getRecordsByEntityType(entityType: EntityType): HistoryRecord[] {
    return records.value.filter((r) => r.entityType === entityType);
  }

  /**
   * 按操作类型筛选
   */
  function getRecordsByActionType(actionType: ActionType): HistoryRecord[] {
    return records.value.filter((r) => r.actionType === actionType);
  }

  // ========== Getters ==========

  /**
   * 统计信息
   */
  const statistics: ComputedRef<HistoryStatistics> = computed(() => {
    const stats: HistoryStatistics = {
      total: records.value.length,
      skills: records.value.filter((r) => r.entityType === ENTITY_TYPES.SKILL).length,
      tools: records.value.filter((r) => r.entityType === ENTITY_TYPES.TOOL).length,
      creates: records.value.filter((r) => r.actionType === ACTION_TYPES.CREATE).length,
      updates: records.value.filter((r) => r.actionType === ACTION_TYPES.UPDATE).length,
      deletes: records.value.filter((r) => r.actionType === ACTION_TYPES.DELETE).length,
    };

    return stats;
  });

  // ========== 工具函数 ==========

  /**
   * 保存到本地存储
   */
  function saveToLocalStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records.value));
    } catch (error) {
      logger.error('Failed to save history:', error as any);
    }
  }

  /**
   * 从本地存储加载
   */
  function loadFromLocalStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        records.value = JSON.parse(saved);
      }
    } catch (error) {
      logger.error('Failed to load history:', error as any);
    }
  }

  /**
   * 格式化记录显示
   */
  function formatRecord(record: HistoryRecord): string {
    const actionLabels: Record<ActionType, string> = {
      [ACTION_TYPES.CREATE]: '创建',
      [ACTION_TYPES.UPDATE]: '更新',
      [ACTION_TYPES.DELETE]: '删除',
      [ACTION_TYPES.ENABLE]: '启用',
      [ACTION_TYPES.DISABLE]: '禁用',
      [ACTION_TYPES.BATCH_ENABLE]: '批量启用',
      [ACTION_TYPES.BATCH_DISABLE]: '批量禁用',
      [ACTION_TYPES.BATCH_DELETE]: '批量删除',
    };

    const entityLabels: Record<EntityType, string> = {
      [ENTITY_TYPES.SKILL]: '技能',
      [ENTITY_TYPES.TOOL]: '工具',
    };

    const action = actionLabels[record.actionType] || record.actionType;
    const entity = entityLabels[record.entityType] || record.entityType;

    let description = `${action} ${entity}`;

    if (record.entityName) {
      description += `: ${record.entityName}`;
    }

    if (record.count) {
      description += ` (${record.count}项)`;
    }

    return description;
  }

  /**
   * 获取操作图标
   */
  function getActionIcon(actionType: ActionType): string {
    const icons: ActionIconMap = {
      [ACTION_TYPES.CREATE]: 'PlusCircleOutlined',
      [ACTION_TYPES.UPDATE]: 'EditOutlined',
      [ACTION_TYPES.DELETE]: 'DeleteOutlined',
      [ACTION_TYPES.ENABLE]: 'CheckCircleOutlined',
      [ACTION_TYPES.DISABLE]: 'CloseCircleOutlined',
      [ACTION_TYPES.BATCH_ENABLE]: 'CheckSquareOutlined',
      [ACTION_TYPES.BATCH_DISABLE]: 'CloseSquareOutlined',
      [ACTION_TYPES.BATCH_DELETE]: 'DeleteOutlined',
    };

    return icons[actionType] || 'InfoCircleOutlined';
  }

  /**
   * 获取操作颜色
   */
  function getActionColor(actionType: ActionType): string {
    const colors: ActionColorMap = {
      [ACTION_TYPES.CREATE]: '#52c41a',
      [ACTION_TYPES.UPDATE]: '#1890ff',
      [ACTION_TYPES.DELETE]: '#ff4d4f',
      [ACTION_TYPES.ENABLE]: '#52c41a',
      [ACTION_TYPES.DISABLE]: '#faad14',
      [ACTION_TYPES.BATCH_ENABLE]: '#52c41a',
      [ACTION_TYPES.BATCH_DISABLE]: '#faad14',
      [ACTION_TYPES.BATCH_DELETE]: '#ff4d4f',
    };

    return colors[actionType] || '#8c8c8c';
  }

  // 初始化时从本地存储加载
  loadFromLocalStorage();

  return {
    // State
    records,

    // Getters
    statistics,

    // Actions
    addRecord,
    clearHistory,
    deleteRecord,
    getRecentRecords,
    getRecordsByEntityType,
    getRecordsByActionType,
    formatRecord,
    getActionIcon,
    getActionColor,
  };
});

export default useHistoryStore;
