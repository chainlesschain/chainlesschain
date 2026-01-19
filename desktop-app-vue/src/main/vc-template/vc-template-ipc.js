const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册可验证凭证模板管理相关的IPC处理器
 *
 * 功能：
 * - 模板CRUD操作（创建、读取、更新、删除）
 * - 模板填充与值管理
 * - 使用统计与计数
 * - 模板导入/导出
 * - 批量操作支持
 */
function registerVCTemplateIPC(vcTemplateManager) {
  logger.info('[IPC] 注册VC模板管理IPC处理器');

  // 获取所有模板
  ipcMain.handle('vc-template:get-all', async (_event, filters) => {
    try {
      if (!vcTemplateManager) {
        return [];
      }

      return vcTemplateManager.getAllTemplates(filters);
    } catch (error) {
      logger.error('[Main] 获取模板列表失败:', error);
      return [];
    }
  });

  // 获取单个模板
  ipcMain.handle('vc-template:get', async (_event, id) => {
    try {
      if (!vcTemplateManager) {
        return null;
      }

      return vcTemplateManager.getTemplateById(id);
    } catch (error) {
      logger.error('[Main] 获取模板失败:', error);
      return null;
    }
  });

  // 创建模板
  ipcMain.handle('vc-template:create', async (_event, templateData) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return await vcTemplateManager.createTemplate(templateData);
    } catch (error) {
      logger.error('[Main] 创建模板失败:', error);
      throw error;
    }
  });

  // 更新模板
  ipcMain.handle('vc-template:update', async (_event, id, updates) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return await vcTemplateManager.updateTemplate(id, updates);
    } catch (error) {
      logger.error('[Main] 更新模板失败:', error);
      throw error;
    }
  });

  // 删除模板
  ipcMain.handle('vc-template:delete', async (_event, id) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return await vcTemplateManager.deleteTemplate(id);
    } catch (error) {
      logger.error('[Main] 删除模板失败:', error);
      throw error;
    }
  });

  // 填充模板值
  ipcMain.handle('vc-template:fill-values', async (_event, templateId, values) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return vcTemplateManager.fillTemplateValues(templateId, values);
    } catch (error) {
      logger.error('[Main] 填充模板值失败:', error);
      throw error;
    }
  });

  // 增加使用次数
  ipcMain.handle('vc-template:increment-usage', async (_event, id) => {
    try {
      if (!vcTemplateManager) {
        return;
      }

      await vcTemplateManager.incrementUsageCount(id);
    } catch (error) {
      logger.error('[Main] 更新模板使用次数失败:', error);
    }
  });

  // 获取统计信息
  ipcMain.handle('vc-template:get-statistics', async () => {
    try {
      if (!vcTemplateManager) {
        return { builtIn: 0, custom: 0, public: 0, total: 0 };
      }

      return vcTemplateManager.getStatistics();
    } catch (error) {
      logger.error('[Main] 获取模板统计失败:', error);
      return { builtIn: 0, custom: 0, public: 0, total: 0 };
    }
  });

  // 导出单个模板
  ipcMain.handle('vc-template:export', async (_event, id) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return vcTemplateManager.exportTemplate(id);
    } catch (error) {
      logger.error('[Main] 导出模板失败:', error);
      throw error;
    }
  });

  // 批量导出模板
  ipcMain.handle('vc-template:export-multiple', async (_event, ids) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return vcTemplateManager.exportTemplates(ids);
    } catch (error) {
      logger.error('[Main] 批量导出模板失败:', error);
      throw error;
    }
  });

  // 导入模板
  ipcMain.handle('vc-template:import', async (_event, importData, createdBy, options) => {
    try {
      if (!vcTemplateManager) {
        throw new Error('凭证模板管理器未初始化');
      }

      return await vcTemplateManager.importTemplate(importData, createdBy, options);
    } catch (error) {
      logger.error('[Main] 导入模板失败:', error);
      throw error;
    }
  });

  logger.info('[IPC] VC模板管理IPC处理器注册完成（11个handlers）');
}

module.exports = {
  registerVCTemplateIPC
};
