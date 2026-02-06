/**
 * Template Store - 模板管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, toRaw, type Ref, type ComputedRef } from 'vue';
import { electronAPI } from '../utils/ipc';

// ==================== 类型定义 ====================

/**
 * 模板变量定义
 */
export interface TemplateVariable {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
  description?: string;
  [key: string]: any;
}

/**
 * 模板数据
 */
export interface Template {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  content: string;
  description?: string;
  variables?: TemplateVariable[];
  usage_count?: number;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 模板筛选条件
 */
export interface TemplateFilters {
  category?: string;
  subcategory?: string;
  keyword?: string;
  [key: string]: any;
}

/**
 * 模板创建数据
 */
export interface TemplateCreateData {
  name: string;
  category: string;
  subcategory?: string;
  content: string;
  description?: string;
  variables?: TemplateVariable[];
  [key: string]: any;
}

/**
 * 模板更新数据
 */
export interface TemplateUpdateData {
  name?: string;
  category?: string;
  subcategory?: string;
  content?: string;
  description?: string;
  variables?: TemplateVariable[];
  [key: string]: any;
}

/**
 * 模板统计信息
 */
export interface TemplateStats {
  total: number;
  byCategory: Record<string, number>;
  mostUsed: Template[];
  recentlyUsed: Template[];
  [key: string]: any;
}

/**
 * API 响应结果
 */
export interface TemplateApiResult {
  success: boolean;
  error?: string;
  templates?: Template[];
  template?: Template;
  renderedPrompt?: string;
  [key: string]: any;
}

/**
 * 记录使用结果
 */
export interface RecordUsageResult {
  success: boolean;
  error?: string;
  [key: string]: any;
}

// ==================== Store ====================

export const useTemplateStore = defineStore('template', () => {
  // ==================== State ====================

  const templates: Ref<Template[]> = ref([]);
  const loading: Ref<boolean> = ref(false);
  const currentCategory: Ref<string | null> = ref(null);
  const currentSubcategory: Ref<string | null> = ref(null);
  const isFeatureAvailable: Ref<boolean> = ref(true);
  const retryCount: Ref<number> = ref(0);
  const MAX_RETRIES = 3;

  // ==================== Getters ====================

  const filteredTemplates: ComputedRef<Template[]> = computed(() => {
    if (!currentCategory.value && !currentSubcategory.value) {
      return templates.value;
    }

    return templates.value.filter((template) => {
      const categoryMatch =
        !currentCategory.value || template.category === currentCategory.value;

      const subcategoryMatch =
        !currentSubcategory.value ||
        template.subcategory === currentSubcategory.value;

      return categoryMatch && subcategoryMatch;
    });
  });

  const templatesByCategory: ComputedRef<Record<string, Template[]>> = computed(() => {
    const grouped: Record<string, Template[]> = {};
    templates.value.forEach((template) => {
      const category = template.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(template);
    });
    return grouped;
  });

  // ==================== Actions ====================

  async function fetchTemplates(filters: TemplateFilters = {}): Promise<Template[]> {
    if (!isFeatureAvailable.value) {
      logger.warn('[TemplateStore] 模板功能不可用，跳过加载');
      return [];
    }

    loading.value = true;
    try {
      // 加载项目模板（包含职业专用模板）
      const result: TemplateApiResult = await electronAPI.template.getAll(filters);

      if (result.success) {
        templates.value = result.templates || [];
        retryCount.value = 0;
        logger.info(`[TemplateStore] 成功加载项目模板: ${templates.value.length}`);
      } else {
        logger.error(`[TemplateStore] 加载项目模板失败 - 错误详情: ${result.error}, 完整结果: ${JSON.stringify(result)}`);
        templates.value = [];

        retryCount.value++;
        if (retryCount.value >= MAX_RETRIES) {
          logger.warn(
            `[TemplateStore] 模板加载已失败 ${MAX_RETRIES} 次，标记功能不可用。可能原因：模板管理器未初始化。`
          );
          isFeatureAvailable.value = false;
        }
      }

      return templates.value;
    } catch (error) {
      logger.error(`[TemplateStore] 加载模板异常 - 错误类型: ${(error as Error)?.name}, 错误消息: ${(error as Error)?.message}`);
      templates.value = [];

      retryCount.value++;
      if (retryCount.value >= MAX_RETRIES) {
        logger.warn(
          `[TemplateStore] 模板加载已失败 ${MAX_RETRIES} 次，标记功能不可用。可能原因：模板管理器未初始化。`
        );
        isFeatureAvailable.value = false;
      }

      throw error;
    } finally {
      loading.value = false;
    }
  }

  async function loadTemplatesByCategory(
    category: string,
    subcategory: string | null = null
  ): Promise<Template[]> {
    currentCategory.value = category;
    currentSubcategory.value = subcategory;

    // 如果模板还没加载过，先加载所有模板
    if (templates.value.length === 0) {
      await fetchTemplates();
    }

    logger.info('[TemplateStore] 过滤模板:', {
      category,
      subcategory,
      count: filteredTemplates.value.length,
    });

    return filteredTemplates.value;
  }

  async function recordUsage(
    templateId: string,
    userId: string,
    projectId: string,
    variables: Record<string, any>
  ): Promise<RecordUsageResult> {
    try {
      // 将 Vue 响应式对象转换为普通对象，避免 IPC 传输时的克隆错误
      // 使用 JSON 序列化进行深拷贝，确保移除所有响应式引用
      const plainVariables = JSON.parse(JSON.stringify(toRaw(variables)));

      const result: RecordUsageResult = await electronAPI.template.recordUsage(
        templateId,
        userId,
        projectId,
        plainVariables
      );

      if (result.success) {
        // 更新本地模板的 usage_count
        const template = templates.value.find((t) => t.id === templateId);
        if (template) {
          template.usage_count = (template.usage_count || 0) + 1;
        }
        logger.info('[TemplateStore] 记录使用成功:', templateId);
      } else {
        logger.error('[TemplateStore] 记录使用失败:', result.error);
      }

      return result;
    } catch (error) {
      logger.error('[TemplateStore] 记录使用异常:', error);
      throw error;
    }
  }

  async function getTemplateById(templateId: string): Promise<Template> {
    try {
      // 先尝试从已加载的模板中查找
      const template = templates.value.find((t) => t.id === templateId);
      if (template) {
        return template;
      }

      // 从服务器获取
      const result: TemplateApiResult = await electronAPI.template.getById(templateId);
      if (result.success && result.template) {
        return result.template;
      } else {
        throw new Error(result.error || '获取模板失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 获取模板异常:', error);
      throw error;
    }
  }

  async function searchTemplates(
    keyword: string,
    filters: TemplateFilters = {}
  ): Promise<Template[]> {
    loading.value = true;
    try {
      const result: TemplateApiResult = await electronAPI.template.search(keyword, filters);

      if (result.success) {
        return result.templates || [];
      } else {
        throw new Error(result.error || '搜索失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 搜索模板异常:', error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  async function renderPrompt(
    templateId: string,
    variables: Record<string, any>
  ): Promise<string> {
    try {
      // 将 Vue 响应式对象转换为普通对象，避免 IPC 传输时的克隆错误
      // 使用 JSON 序列化进行深拷贝，确保移除所有响应式引用
      const plainVariables = JSON.parse(JSON.stringify(toRaw(variables)));

      // 使用项目模板API渲染
      const result: TemplateApiResult = await electronAPI.template.renderPrompt(
        templateId,
        plainVariables
      );

      if (result.success && result.renderedPrompt) {
        return result.renderedPrompt;
      } else {
        throw new Error(result.error || '渲染失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 渲染 prompt 异常:', error);
      throw error;
    }
  }

  async function createTemplate(templateData: TemplateCreateData): Promise<Template> {
    try {
      const plainData = JSON.parse(JSON.stringify(toRaw(templateData)));
      const result: TemplateApiResult = await electronAPI.template.create(plainData);

      if (result.success && result.template) {
        // 添加到本地列表
        templates.value.push(result.template);
        logger.info('[TemplateStore] 创建模板成功:', result.template.id);
        return result.template;
      } else {
        throw new Error(result.error || '创建模板失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 创建模板异常:', error);
      throw error;
    }
  }

  async function updateTemplate(
    templateId: string,
    updates: TemplateUpdateData
  ): Promise<Template> {
    try {
      const plainUpdates = JSON.parse(JSON.stringify(toRaw(updates)));
      const result: TemplateApiResult = await electronAPI.template.update(
        templateId,
        plainUpdates
      );

      if (result.success && result.template) {
        // 更新本地列表
        const index = templates.value.findIndex((t) => t.id === templateId);
        if (index !== -1) {
          templates.value[index] = result.template;
        }
        logger.info('[TemplateStore] 更新模板成功:', templateId);
        return result.template;
      } else {
        throw new Error(result.error || '更新模板失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 更新模板异常:', error);
      throw error;
    }
  }

  async function deleteTemplate(templateId: string): Promise<boolean> {
    try {
      const result: TemplateApiResult = await electronAPI.template.delete(templateId);

      if (result.success) {
        // 从本地列表移除
        const index = templates.value.findIndex((t) => t.id === templateId);
        if (index !== -1) {
          templates.value.splice(index, 1);
        }
        logger.info('[TemplateStore] 删除模板成功:', templateId);
        return true;
      } else {
        throw new Error(result.error || '删除模板失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 删除模板异常:', error);
      throw error;
    }
  }

  async function duplicateTemplate(
    templateId: string,
    newName: string
  ): Promise<Template> {
    try {
      const result: TemplateApiResult = await electronAPI.template.duplicate(templateId, newName);

      if (result.success && result.template) {
        // 添加到本地列表
        templates.value.push(result.template);
        logger.info('[TemplateStore] 复制模板成功:', result.template.id);
        return result.template;
      } else {
        throw new Error(result.error || '复制模板失败');
      }
    } catch (error) {
      logger.error('[TemplateStore] 复制模板异常:', error);
      throw error;
    }
  }

  async function getTemplateStats(): Promise<TemplateStats> {
    try {
      const stats: TemplateStats = await electronAPI.template.getStats();
      return stats;
    } catch (error) {
      logger.error('[TemplateStore] 获取模板统计异常:', error);
      throw error;
    }
  }

  return {
    // State
    templates,
    loading,
    currentCategory,
    currentSubcategory,

    // Getters
    filteredTemplates,
    templatesByCategory,

    // Actions
    fetchTemplates,
    loadTemplatesByCategory,
    recordUsage,
    getTemplateById,
    searchTemplates,
    renderPrompt,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplateStats,
  };
});
