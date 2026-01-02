/**
 * 提示词模板 IPC
 * 处理提示词模板的 CRUD、搜索、分类、导入导出等操作
 *
 * @module prompt-template-ipc
 * @description 提示词模板管理模块，提供模板的创建、查询、填充、导入导出等功能
 */

const { ipcMain } = require('electron');

/**
 * 注册提示词模板相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.promptTemplateManager - 提示词模板管理器实例
 */
function registerPromptTemplateIPC({
  promptTemplateManager
}) {
  console.log('[Prompt Template IPC] Registering Prompt Template IPC handlers...');

  // ============================================================
  // 模板查询操作 (3 handlers)
  // ============================================================

  /**
   * 获取所有模板
   */
  ipcMain.handle('prompt-template:get-all', async (_event, filters) => {
    try {
      if (!promptTemplateManager) {
        return [];
      }

      return await promptTemplateManager.getTemplates(filters);
    } catch (error) {
      console.error('[PromptTemplate] 获取模板列表失败:', error);
      return [];
    }
  });

  /**
   * 根据ID获取模板
   */
  ipcMain.handle('prompt-template:get', async (_event, id) => {
    try {
      if (!promptTemplateManager) {
        return null;
      }

      return await promptTemplateManager.getTemplateById(id);
    } catch (error) {
      console.error('[PromptTemplate] 获取模板失败:', error);
      return null;
    }
  });

  /**
   * 搜索模板
   */
  ipcMain.handle('prompt-template:search', async (_event, query) => {
    try {
      if (!promptTemplateManager) {
        return [];
      }

      return await promptTemplateManager.searchTemplates(query);
    } catch (error) {
      console.error('[PromptTemplate] 搜索模板失败:', error);
      return [];
    }
  });

  // ============================================================
  // 模板管理操作 (3 handlers)
  // ============================================================

  /**
   * 创建模板
   */
  ipcMain.handle('prompt-template:create', async (_event, templateData) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.createTemplate(templateData);
    } catch (error) {
      console.error('[PromptTemplate] 创建模板失败:', error);
      throw error;
    }
  });

  /**
   * 更新模板
   */
  ipcMain.handle('prompt-template:update', async (_event, id, updates) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.updateTemplate(id, updates);
    } catch (error) {
      console.error('[PromptTemplate] 更新模板失败:', error);
      throw error;
    }
  });

  /**
   * 删除模板
   */
  ipcMain.handle('prompt-template:delete', async (_event, id) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.deleteTemplate(id);
    } catch (error) {
      console.error('[PromptTemplate] 删除模板失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 模板使用操作 (1 handler)
  // ============================================================

  /**
   * 填充模板
   */
  ipcMain.handle('prompt-template:fill', async (_event, id, values) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.fillTemplate(id, values);
    } catch (error) {
      console.error('[PromptTemplate] 填充模板失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 分类与统计操作 (2 handlers)
  // ============================================================

  /**
   * 获取分类列表
   */
  ipcMain.handle('prompt-template:get-categories', async () => {
    try {
      if (!promptTemplateManager) {
        return [];
      }

      return await promptTemplateManager.getCategories();
    } catch (error) {
      console.error('[PromptTemplate] 获取分类失败:', error);
      return [];
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('prompt-template:get-statistics', async () => {
    try {
      if (!promptTemplateManager) {
        return { total: 0, system: 0, custom: 0, byCategory: {}, mostUsed: [] };
      }

      return await promptTemplateManager.getStatistics();
    } catch (error) {
      console.error('[PromptTemplate] 获取统计信息失败:', error);
      return { total: 0, system: 0, custom: 0, byCategory: {}, mostUsed: [] };
    }
  });

  // ============================================================
  // 导入导出操作 (2 handlers)
  // ============================================================

  /**
   * 导出模板
   */
  ipcMain.handle('prompt-template:export', async (_event, id) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.exportTemplate(id);
    } catch (error) {
      console.error('[PromptTemplate] 导出模板失败:', error);
      throw error;
    }
  });

  /**
   * 导入模板
   */
  ipcMain.handle('prompt-template:import', async (_event, importData) => {
    try {
      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      return await promptTemplateManager.importTemplate(importData);
    } catch (error) {
      console.error('[PromptTemplate] 导入模板失败:', error);
      throw error;
    }
  });

  console.log('[Prompt Template IPC] ✓ 11 handlers registered');
  console.log('[Prompt Template IPC] - 3 template query handlers');
  console.log('[Prompt Template IPC] - 3 template management handlers');
  console.log('[Prompt Template IPC] - 1 template usage handler');
  console.log('[Prompt Template IPC] - 2 category & statistics handlers');
  console.log('[Prompt Template IPC] - 2 import/export handlers');
}

module.exports = {
  registerPromptTemplateIPC
};
