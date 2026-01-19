const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册项目自动化规则相关的IPC处理器
 *
 * 功能：
 * - 自动化规则CRUD操作
 * - 规则触发与执行
 * - 项目规则加载与管理
 * - 规则状态控制
 * - 统计信息查询
 */
function registerAutomationIPC() {
  logger.info('[IPC] 注册项目自动化规则IPC处理器');

  // 创建自动化规则
  ipcMain.handle('automation:createRule', async (_event, ruleData) => {
    try {
      logger.info('[Main] 创建自动化规则:', ruleData.name);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const rule = await automationManager.createRule(ruleData);

      logger.info('[Main] 自动化规则创建成功:', rule.id);
      return rule;
    } catch (error) {
      logger.error('[Main] 创建自动化规则失败:', error);
      throw error;
    }
  });

  // 获取项目的自动化规则列表
  ipcMain.handle('automation:getRules', async (_event, projectId) => {
    try {
      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const rules = automationManager.getRules(projectId);

      return rules;
    } catch (error) {
      logger.error('[Main] 获取自动化规则列表失败:', error);
      throw error;
    }
  });

  // 获取规则详情
  ipcMain.handle('automation:getRule', async (_event, ruleId) => {
    try {
      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const rule = automationManager.getRule(ruleId);

      return rule;
    } catch (error) {
      logger.error('[Main] 获取规则详情失败:', error);
      throw error;
    }
  });

  // 更新自动化规则
  ipcMain.handle('automation:updateRule', async (_event, ruleId, updates) => {
    try {
      logger.info('[Main] 更新自动化规则:', ruleId);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const rule = await automationManager.updateRule(ruleId, updates);

      logger.info('[Main] 自动化规则更新成功');
      return rule;
    } catch (error) {
      logger.error('[Main] 更新自动化规则失败:', error);
      throw error;
    }
  });

  // 删除自动化规则
  ipcMain.handle('automation:deleteRule', async (_event, ruleId) => {
    try {
      logger.info('[Main] 删除自动化规则:', ruleId);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      await automationManager.deleteRule(ruleId);

      logger.info('[Main] 自动化规则删除成功');
      return { success: true };
    } catch (error) {
      logger.error('[Main] 删除自动化规则失败:', error);
      throw error;
    }
  });

  // 手动触发规则
  ipcMain.handle('automation:manualTrigger', async (_event, ruleId) => {
    try {
      logger.info('[Main] 手动触发规则:', ruleId);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const result = await automationManager.manualTrigger(ruleId);

      logger.info('[Main] 规则触发完成');
      return result;
    } catch (error) {
      logger.error('[Main] 触发规则失败:', error);
      throw error;
    }
  });

  // 加载项目规则
  ipcMain.handle('automation:loadProjectRules', async (_event, projectId) => {
    try {
      logger.info('[Main] 加载项目规则:', projectId);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const rules = await automationManager.loadProjectRules(projectId);

      logger.info('[Main] 项目规则加载完成');
      return rules;
    } catch (error) {
      logger.error('[Main] 加载项目规则失败:', error);
      throw error;
    }
  });

  // 停止规则
  ipcMain.handle('automation:stopRule', async (_event, ruleId) => {
    try {
      logger.info('[Main] 停止规则:', ruleId);

      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      automationManager.stopRule(ruleId);

      logger.info('[Main] 规则已停止');
      return { success: true };
    } catch (error) {
      logger.error('[Main] 停止规则失败:', error);
      throw error;
    }
  });

  // 获取统计信息
  ipcMain.handle('automation:getStatistics', async () => {
    try {
      const { getAutomationManager } = require('../project/automation-manager');
      const automationManager = getAutomationManager();

      await automationManager.initialize();

      const stats = automationManager.getStatistics();

      return stats;
    } catch (error) {
      logger.error('[Main] 获取统计信息失败:', error);
      throw error;
    }
  });

  logger.info('[IPC] 项目自动化规则IPC处理器注册完成（9个handlers）');
}

module.exports = {
  registerAutomationIPC
};
