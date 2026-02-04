/**
 * 模板管理 IPC
 * 处理项目模板的 CRUD、渲染、统计等操作
 *
 * @module template-ipc
 * @description 项目模板管理模块，提供模板查询、创建、使用、评价等功能
 */

const { logger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册模板管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.templateManager - 模板管理器实例
 */
function registerTemplateIPC({
  templateManager
}) {
  logger.info('[Template IPC] Registering Template IPC handlers...');
  logger.info('[Template IPC] templateManager初始化状态:', {
    exists: !!templateManager,
    type: typeof templateManager,
    constructor: templateManager?.constructor?.name
  });

  // ============================================================
  // 模板查询操作 (6 handlers)
  // ============================================================

  /**
   * 获取所有模板
   */
  ipcMain.handle('template:getAll', async (_event, filters = {}) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const templates = await templateManager.getAllTemplates(filters);
      // 返回标准格式 {success, templates}，与前端期望一致
      return { success: true, templates: templates || [] };
    } catch (error) {
      logger.error('[Template] 获取模板列表失败:', error);
      return { success: false, error: error.message, templates: [] };
    }
  });

  /**
   * 根据ID获取模板
   */
  ipcMain.handle('template:getById', async (_event, templateId) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const template = await templateManager.getTemplateById(templateId);
      return { success: true, template };
    } catch (error) {
      logger.error('[Template] 获取模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 搜索模板
   */
  ipcMain.handle('template:search', async (_event, keyword, filters = {}) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const templates = await templateManager.searchTemplates(keyword, filters);
      return templates || [];
    } catch (error) {
      logger.error('[Template] 搜索模板失败:', error);
      return [];
    }
  });

  /**
   * 获取模板统计
   */
  ipcMain.handle('template:getStats', async (_event) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const stats = await templateManager.getTemplateStats();
      return stats;
    } catch (error) {
      logger.error('[Template] 获取模板统计失败:', error);
      throw error;
    }
  });

  /**
   * 获取用户最近使用的模板
   */
  ipcMain.handle('template:getRecent', async (_event, userId, limit = 10) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const templates = await templateManager.getRecentTemplates(userId, limit);
      return templates;
    } catch (error) {
      logger.error('[Template] 获取最近使用模板失败:', error);
      throw error;
    }
  });

  /**
   * 获取热门模板
   */
  ipcMain.handle('template:getPopular', async (_event, limit = 20) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const templates = await templateManager.getPopularTemplates(limit);
      return templates;
    } catch (error) {
      logger.error('[Template] 获取热门模板失败:', error);
      throw error;
    }
  });

  /**
   * 智能推荐模板
   * 基于用户输入、项目类型和历史使用情况推荐模板
   */
  ipcMain.handle('template:recommend', async (_event, userInput, projectType, userId, options = {}) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      logger.info('[Template] 推荐模板:', { userInput, projectType, userId });
      const templates = await templateManager.recommendTemplates(userInput, projectType, userId, options);
      return templates || [];
    } catch (error) {
      logger.error('[Template] 智能推荐模板失败:', error);
      return [];
    }
  });

  // ============================================================
  // 模板管理操作 (4 handlers)
  // ============================================================

  /**
   * 创建模板
   */
  ipcMain.handle('template:create', async (_event, templateData) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const template = await templateManager.createTemplate(templateData);
      return { success: true, template };
    } catch (error) {
      logger.error('[Template] 创建模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新模板
   */
  ipcMain.handle('template:update', async (_event, templateId, updates) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      const template = await templateManager.updateTemplate(templateId, updates);
      return { success: true, template };
    } catch (error) {
      logger.error('[Template] 更新模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除模板
   */
  ipcMain.handle('template:delete', async (_event, templateId) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      await templateManager.deleteTemplate(templateId);
      return { success: true };
    } catch (error) {
      logger.error('[Template] 删除模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 复制模板（用于基于现有模板创建新模板）
   */
  ipcMain.handle('template:duplicate', async (_event, templateId, newName) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      // 获取原模板
      const originalTemplate = await templateManager.getTemplateById(templateId);

      // 创建副本
      const duplicateData = {
        ...originalTemplate,
        name: newName || `${originalTemplate.name}_copy`,
        display_name: newName || `${originalTemplate.display_name} (副本)`,
        is_custom: true,
        created_at: undefined,
        updated_at: undefined,
        id: undefined
      };

      const template = await templateManager.createTemplate(duplicateData);
      return { success: true, template };
    } catch (error) {
      logger.error('[Template] 复制模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 模板渲染操作 (3 handlers)
  // ============================================================

  /**
   * 渲染模板提示词
   */
  ipcMain.handle('template:renderPrompt', async (_event, templateId, userVariables) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      let template = await templateManager.getTemplateById(templateId);

      // 如果模板的 prompt_template 为空，尝试重新加载
      if (!template.prompt_template || template.prompt_template.trim() === '') {
        logger.warn(`[Template] 模板 ${templateId} 的 prompt_template 为空，尝试重新初始化模板`);

        // 重新初始化模板（强制重新加载）
        templateManager.templatesLoaded = false;
        await templateManager.initialize();

        // 重新获取模板
        template = await templateManager.getTemplateById(templateId);

        if (!template.prompt_template || template.prompt_template.trim() === '') {
          throw new Error(`模板 ${templateId} (${template.display_name}) 的 prompt_template 字段为空，请检查模板文件是否正确`);
        }
      }

      const renderedPrompt = templateManager.renderPrompt(template, userVariables);
      return { success: true, renderedPrompt };
    } catch (error) {
      logger.error('[Template] 渲染模板提示词失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 渲染模板（通用）
   */
  ipcMain.handle('template:render', async (_event, params) => {
    try {
      const { templateContent, variables } = params;

      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      const rendered = templateManager.renderTemplateString(templateContent, variables);
      return { success: true, rendered };
    } catch (error) {
      logger.error('[Template] 渲染模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 验证模板
   */
  ipcMain.handle('template:validate', async (_event, params) => {
    try {
      const { templateContent, requiredVariables } = params;

      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      const validation = templateManager.validateTemplate(templateContent, requiredVariables);
      return { success: true, ...validation };
    } catch (error) {
      logger.error('[Template] 验证模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 模板使用与评价 (2 handlers)
  // ============================================================

  /**
   * 记录模板使用
   */
  ipcMain.handle('template:recordUsage', async (_event, templateId, userId, projectId, variablesUsed) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      await templateManager.recordTemplateUsage(templateId, userId, projectId, variablesUsed);
      return { success: true };
    } catch (error) {
      logger.error('[Template] 记录模板使用失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 提交模板评价
   */
  ipcMain.handle('template:rate', async (_event, templateId, userId, rating, review) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }
      await templateManager.rateTemplate(templateId, userId, rating, review);
      return { success: true };
    } catch (error) {
      logger.error('[Template] 提交模板评价失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 模板文件操作 (5 handlers)
  // ============================================================

  /**
   * 预览模板
   */
  ipcMain.handle('template:preview', async (_event, params) => {
    try {
      const { templateContent, sampleVariables } = params;

      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      const preview = templateManager.previewTemplate(templateContent, sampleVariables);
      return { success: true, preview };
    } catch (error) {
      logger.error('[Template] 预览模板失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 加载模板文件
   */
  ipcMain.handle('template:loadTemplate', async (_event, templatePath) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');

      logger.info('[Template] 加载模板文件:', templatePath);

      const content = await fs.readFile(templatePath, 'utf-8');
      const ext = path.extname(templatePath).toLowerCase();

      let template;
      if (ext === '.json') {
        template = JSON.parse(content);
      } else {
        template = { content };
      }

      return { success: true, template };
    } catch (error) {
      logger.error('[Template] 加载模板文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 保存模板文件
   */
  ipcMain.handle('template:saveTemplate', async (_event, params) => {
    try {
      const { templatePath, templateData } = params;
      const fs = require('fs').promises;
      const path = require('path');

      logger.info('[Template] 保存模板文件:', templatePath);

      const ext = path.extname(templatePath).toLowerCase();
      let content;

      if (ext === '.json') {
        content = JSON.stringify(templateData, null, 2);
      } else {
        content = templateData.content || JSON.stringify(templateData, null, 2);
      }

      await fs.writeFile(templatePath, content, 'utf-8');

      return { success: true };
    } catch (error) {
      logger.error('[Template] 保存模板文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 提取模板变量
   */
  ipcMain.handle('template:extractVariables', async (_event, templateString) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      const variables = templateManager.extractVariables(templateString);
      return { success: true, variables };
    } catch (error) {
      logger.error('[Template] 提取模板变量失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取默认变量值
   */
  ipcMain.handle('template:getDefaultVariables', async (_event, variableDefinitions) => {
    try {
      if (!templateManager) {
        throw new Error('模板管理器未初始化');
      }

      const defaults = templateManager.getDefaultVariables(variableDefinitions);
      return { success: true, defaults };
    } catch (error) {
      logger.error('[Template] 获取默认变量失败:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[Template IPC] ✓ 21 handlers registered');
  logger.info('[Template IPC] - 7 template query handlers (包含智能推荐)');
  logger.info('[Template IPC] - 4 template management handlers');
  logger.info('[Template IPC] - 3 template rendering handlers');
  logger.info('[Template IPC] - 2 usage & rating handlers');
  logger.info('[Template IPC] - 5 template file handlers');
}

module.exports = {
  registerTemplateIPC
};
