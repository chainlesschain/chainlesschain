/**
 * 技能和工具系统IPC接口
 * 为前端提供技能和工具管理的IPC handlers
 */

/**
 * 注册所有技能和工具相关的IPC handlers
 * @param {Object} dependencies - 依赖对象
 * @param {Electron.IpcMain} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {SkillManager} dependencies.skillManager - 技能管理器
 * @param {ToolManager} dependencies.toolManager - 工具管理器
 */
function registerSkillToolIPC({ ipcMain: injectedIpcMain, skillManager, toolManager }) {
  // 支持依赖注入，用于测试
  let ipcMain;
  if (injectedIpcMain) {
    ipcMain = injectedIpcMain;
  } else {
    const electron = require('electron');
    ipcMain = electron.ipcMain;
  }
  // ===================================
  // 技能相关IPC
  // ===================================

  /**
   * 获取所有技能
   */
  ipcMain.handle('skill:get-all', async (event, options = {}) => {
    try {
      const skills = await skillManager.getAllSkills(options);
      return { success: true, data: skills };
    } catch (error) {
      console.error('[IPC] skill:get-all 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 根据ID获取技能
   */
  ipcMain.handle('skill:get-by-id', async (event, skillId) => {
    try {
      const skill = await skillManager.getSkill(skillId);
      return { success: true, data: skill };
    } catch (error) {
      console.error('[IPC] skill:get-by-id 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 根据分类获取技能
   */
  ipcMain.handle('skill:get-by-category', async (event, category) => {
    try {
      const skills = await skillManager.getSkillsByCategory(category);
      return { success: true, data: skills };
    } catch (error) {
      console.error('[IPC] skill:get-by-category 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 启用技能
   */
  ipcMain.handle('skill:enable', async (event, skillId) => {
    try {
      await skillManager.enableSkill(skillId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:enable 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 禁用技能
   */
  ipcMain.handle('skill:disable', async (event, skillId) => {
    try {
      await skillManager.disableSkill(skillId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:disable 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新技能配置
   */
  ipcMain.handle('skill:update-config', async (event, skillId, config) => {
    try {
      await skillManager.updateSkill(skillId, { config });
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:update-config 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新技能信息
   */
  ipcMain.handle('skill:update', async (event, skillId, updates) => {
    try {
      await skillManager.updateSkill(skillId, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:update 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取技能统计
   */
  ipcMain.handle('skill:get-stats', async (event, skillId, dateRange = null) => {
    try {
      const stats = await skillManager.getSkillStats(skillId, dateRange);
      return { success: true, data: stats };
    } catch (error) {
      console.error('[IPC] skill:get-stats 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取技能包含的工具
   */
  ipcMain.handle('skill:get-tools', async (event, skillId) => {
    try {
      const tools = await skillManager.getSkillTools(skillId);
      return { success: true, data: tools };
    } catch (error) {
      console.error('[IPC] skill:get-tools 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 添加工具到技能
   */
  ipcMain.handle('skill:add-tool', async (event, skillId, toolId, role = 'primary') => {
    try {
      await skillManager.addToolToSkill(skillId, toolId, role);
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:add-tool 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 从技能移除工具
   */
  ipcMain.handle('skill:remove-tool', async (event, skillId, toolId) => {
    try {
      await skillManager.removeToolFromSkill(skillId, toolId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] skill:remove-tool 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取技能文档
   */
  ipcMain.handle('skill:get-doc', async (event, skillId) => {
    try {
      const content = await skillManager.getSkillDoc(skillId);
      return { success: true, content };
    } catch (error) {
      console.error('[IPC] skill:get-doc 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ===================================
  // 工具相关IPC
  // ===================================

  /**
   * 获取所有工具
   */
  ipcMain.handle('tool:get-all', async (event, options = {}) => {
    try {
      const tools = await toolManager.getAllTools(options);
      return { success: true, data: tools };
    } catch (error) {
      console.error('[IPC] tool:get-all 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 根据ID获取工具
   */
  ipcMain.handle('tool:get-by-id', async (event, toolId) => {
    try {
      const tool = await toolManager.getTool(toolId);
      return { success: true, data: tool };
    } catch (error) {
      console.error('[IPC] tool:get-by-id 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 根据分类获取工具
   */
  ipcMain.handle('tool:get-by-category', async (event, category) => {
    try {
      const tools = await toolManager.getToolsByCategory(category);
      return { success: true, data: tools };
    } catch (error) {
      console.error('[IPC] tool:get-by-category 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 根据技能获取工具
   */
  ipcMain.handle('tool:get-by-skill', async (event, skillId) => {
    try {
      const tools = await toolManager.getToolsBySkill(skillId);
      return { success: true, data: tools };
    } catch (error) {
      console.error('[IPC] tool:get-by-skill 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 启用工具
   */
  ipcMain.handle('tool:enable', async (event, toolId) => {
    try {
      await toolManager.enableTool(toolId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] tool:enable 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 禁用工具
   */
  ipcMain.handle('tool:disable', async (event, toolId) => {
    try {
      await toolManager.disableTool(toolId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] tool:disable 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新工具配置
   */
  ipcMain.handle('tool:update-config', async (event, toolId, config) => {
    try {
      await toolManager.updateTool(toolId, { config });
      return { success: true };
    } catch (error) {
      console.error('[IPC] tool:update-config 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新工具Schema
   */
  ipcMain.handle('tool:update-schema', async (event, toolId, schema) => {
    try {
      await toolManager.updateTool(toolId, { parameters_schema: schema });
      return { success: true };
    } catch (error) {
      console.error('[IPC] tool:update-schema 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新工具
   */
  ipcMain.handle('tool:update', async (event, toolId, updates) => {
    try {
      await toolManager.updateTool(toolId, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] tool:update 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取工具统计
   */
  ipcMain.handle('tool:get-stats', async (event, toolId, dateRange = null) => {
    try {
      const stats = await toolManager.getToolStats(toolId, dateRange);
      return { success: true, data: stats };
    } catch (error) {
      console.error('[IPC] tool:get-stats 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取工具文档
   */
  ipcMain.handle('tool:get-doc', async (event, toolId) => {
    try {
      const content = await toolManager.getToolDoc(toolId);
      return { success: true, content };
    } catch (error) {
      console.error('[IPC] tool:get-doc 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 测试工具
   */
  ipcMain.handle('tool:test', async (event, toolId, params = {}) => {
    try {
      const tool = await toolManager.getTool(toolId);
      if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
      }

      // 获取FunctionCaller中的工具handler
      const functionCaller = toolManager.functionCaller;
      if (!functionCaller || !functionCaller.hasTool(tool.name)) {
        throw new Error(`工具未注册到FunctionCaller: ${tool.name}`);
      }

      // 调用工具
      const result = await functionCaller.call(tool.name, params);

      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] tool:test 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ===================================
  // 依赖关系和分析IPC
  // ===================================

  /**
   * 获取技能-工具依赖关系图
   */
  ipcMain.handle('skill-tool:get-dependency-graph', async (event) => {
    try {
      // 获取所有启用的技能
      const skills = await skillManager.getEnabledSkills();

      // 构建依赖关系图
      const graph = {
        nodes: [],
        edges: [],
      };

      // 添加技能节点
      for (const skill of skills) {
        graph.nodes.push({
          id: skill.id,
          label: skill.name,
          type: 'skill',
          category: skill.category,
          enabled: skill.enabled,
        });
      }

      // 添加工具节点和边
      for (const skill of skills) {
        const tools = await skillManager.getSkillTools(skill.id);

        for (const tool of tools) {
          // 检查工具节点是否已存在
          if (!graph.nodes.find(n => n.id === tool.id)) {
            graph.nodes.push({
              id: tool.id,
              label: tool.name,
              type: 'tool',
              category: tool.category,
              enabled: tool.enabled,
            });
          }

          // 添加边
          graph.edges.push({
            source: skill.id,
            target: tool.id,
            role: tool.role,
            priority: tool.priority,
          });
        }
      }

      return { success: true, data: graph };
    } catch (error) {
      console.error('[IPC] skill-tool:get-dependency-graph 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取使用分析
   */
  ipcMain.handle('skill-tool:get-usage-analytics', async (event, dateRange = null) => {
    try {
      // 获取技能和工具的统计数据
      const skills = await skillManager.getAllSkills({ enabled: 1 });
      const tools = await toolManager.getAllTools({ enabled: 1 });

      // 计算总体统计
      const analytics = {
        totalSkills: skills.length,
        totalTools: tools.length,
        skillUsage: skills.reduce((sum, s) => sum + s.usage_count, 0),
        toolUsage: tools.reduce((sum, t) => sum + t.usage_count, 0),
        topSkills: skills
          .sort((a, b) => b.usage_count - a.usage_count)
          .slice(0, 10)
          .map(s => ({
            id: s.id,
            name: s.name,
            usage_count: s.usage_count,
            success_rate: s.usage_count > 0
              ? (s.success_count / s.usage_count * 100).toFixed(2)
              : 0,
          })),
        topTools: tools
          .sort((a, b) => b.usage_count - a.usage_count)
          .slice(0, 10)
          .map(t => ({
            id: t.id,
            name: t.name,
            usage_count: t.usage_count,
            success_rate: t.usage_count > 0
              ? (t.success_count / t.usage_count * 100).toFixed(2)
              : 0,
            avg_execution_time: t.avg_execution_time.toFixed(2),
          })),
      };

      return { success: true, data: analytics };
    } catch (error) {
      console.error('[IPC] skill-tool:get-usage-analytics 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取分类统计
   */
  ipcMain.handle('skill-tool:get-category-stats', async (event) => {
    try {
      const skills = await skillManager.getAllSkills({ enabled: 1 });
      const tools = await toolManager.getAllTools({ enabled: 1 });

      // 按分类统计
      const skillCategories = {};
      const toolCategories = {};

      for (const skill of skills) {
        skillCategories[skill.category] = (skillCategories[skill.category] || 0) + 1;
      }

      for (const tool of tools) {
        toolCategories[tool.category] = (toolCategories[tool.category] || 0) + 1;
      }

      return {
        success: true,
        data: {
          skillCategories,
          toolCategories,
        },
      };
    } catch (error) {
      console.error('[IPC] skill-tool:get-category-stats 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ===================================
  // Additional Tools V3 统计仪表板IPC
  // ===================================

  /**
   * 获取Additional Tools V3统计仪表板数据（支持筛选）
   * @param {Object} filters - 筛选条件
   * @param {Array} filters.dateRange - 时间范围 [startDate, endDate]
   * @param {Array} filters.categories - 分类筛选
   * @param {String} filters.searchKeyword - 搜索关键词
   */
  ipcMain.handle('tool:get-additional-v3-dashboard', async (event, filters = {}) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const data = await dashboard.getDashboardDataWithFilters(filters);
      return { success: true, data };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-dashboard 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3概览数据
   */
  ipcMain.handle('tool:get-additional-v3-overview', async (event) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const overview = await dashboard.getOverview();
      return { success: true, data: overview };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-overview 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3工具排行榜
   */
  ipcMain.handle('tool:get-additional-v3-rankings', async (event, limit = 10) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const rankings = await dashboard.getToolRankings(limit);
      return { success: true, data: rankings };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-rankings 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3分类统计
   */
  ipcMain.handle('tool:get-additional-v3-category-stats', async (event) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const stats = await dashboard.getCategoryStats();
      return { success: true, data: stats };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-category-stats 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3最近使用
   */
  ipcMain.handle('tool:get-additional-v3-recent', async (event, limit = 20) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const recent = await dashboard.getRecentlyUsedTools(limit);
      return { success: true, data: recent };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-recent 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3每日统计
   */
  ipcMain.handle('tool:get-additional-v3-daily-stats', async (event, days = 7) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const stats = await dashboard.getDailyStats(days);
      return { success: true, data: stats };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-daily-stats 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取Additional Tools V3性能指标
   */
  ipcMain.handle('tool:get-additional-v3-performance', async (event) => {
    try {
      const ToolStatsDashboard = require('./tool-stats-dashboard');
      const dashboard = new ToolStatsDashboard(toolManager.db);

      const metrics = await dashboard.getPerformanceMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      console.error('[IPC] tool:get-additional-v3-performance 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ===================================
  // 智能推荐IPC (需要传入skillRecommender)
  // ===================================

  /**
   * 推荐技能
   */
  ipcMain.handle('skill:recommend', async (event, userInput, options = {}) => {
    try {
      if (!global.skillRecommender) {
        return { success: false, error: '推荐引擎未初始化' };
      }
      const recommendations = await global.skillRecommender.recommendSkills(userInput, options);
      return { success: true, data: recommendations };
    } catch (error) {
      console.error('[IPC] skill:recommend 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取热门技能
   */
  ipcMain.handle('skill:get-popular', async (event, limit = 10) => {
    try {
      if (!global.skillRecommender) {
        return { success: false, error: '推荐引擎未初始化' };
      }
      const popular = await global.skillRecommender.getPopularSkills(limit);
      return { success: true, data: popular };
    } catch (error) {
      console.error('[IPC] skill:get-popular 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取相关技能
   */
  ipcMain.handle('skill:get-related', async (event, skillId, limit = 5) => {
    try {
      if (!global.skillRecommender) {
        return { success: false, error: '推荐引擎未初始化' };
      }
      const related = await global.skillRecommender.getRelatedSkills(skillId, limit);
      return { success: true, data: related };
    } catch (error) {
      console.error('[IPC] skill:get-related 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 搜索技能
   */
  ipcMain.handle('skill:search', async (event, query, options = {}) => {
    try {
      if (!global.skillRecommender) {
        return { success: false, error: '推荐引擎未初始化' };
      }
      const results = await global.skillRecommender.searchSkills(query, options);
      return { success: true, data: results };
    } catch (error) {
      console.error('[IPC] skill:search 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ===================================
  // 配置导入导出IPC (需要传入configManager)
  // ===================================

  /**
   * 导出技能配置
   */
  ipcMain.handle('config:export-skills', async (event, skillIds, options = {}) => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      const data = await global.configManager.exportSkills(skillIds, options);
      return { success: true, data };
    } catch (error) {
      console.error('[IPC] config:export-skills 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导出工具配置
   */
  ipcMain.handle('config:export-tools', async (event, toolIds, options = {}) => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      const data = await global.configManager.exportTools(toolIds, options);
      return { success: true, data };
    } catch (error) {
      console.error('[IPC] config:export-tools 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导出到文件
   */
  ipcMain.handle('config:export-to-file', async (event, data, filePath, format = 'json') => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      return await global.configManager.exportToFile(data, filePath, format);
    } catch (error) {
      console.error('[IPC] config:export-to-file 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 从文件导入配置
   */
  ipcMain.handle('config:import-from-file', async (event, filePath, options = {}) => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      const result = await global.configManager.importFromFile(filePath, options);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] config:import-from-file 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导入配置
   */
  ipcMain.handle('config:import', async (event, data, options = {}) => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      const result = await global.configManager.importConfig(data, options);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] config:import 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建配置模板
   */
  ipcMain.handle('config:create-template', async (event, templateType = 'skill') => {
    try {
      if (!global.configManager) {
        return { success: false, error: '配置管理器未初始化' };
      }
      const template = global.configManager.createTemplate(templateType);
      return { success: true, data: template };
    } catch (error) {
      console.error('[IPC] config:create-template 失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Skill-Tool IPC] IPC handlers 注册完成');
}

module.exports = {
  registerSkillToolIPC,
};
