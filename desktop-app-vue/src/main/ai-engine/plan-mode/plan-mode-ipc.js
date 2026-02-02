/**
 * Plan Mode IPC Handlers
 *
 * 提供 Plan Mode 的 IPC 通道
 *
 * @module plan-mode-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../../utils/logger');
const { getPlanModeManager } = require('./index');

/**
 * 注册 Plan Mode IPC 处理器
 * @param {Object} options - 配置选项
 */
function registerPlanModeIPC(options = {}) {
  const { hookSystem, functionCaller } = options;
  const planModeManager = getPlanModeManager();

  // 设置 Hooks 系统
  if (hookSystem) {
    planModeManager.setHookSystem(hookSystem);
  }

  logger.info('[PlanModeIPC] Registering IPC handlers...');

  // ==================== 模式控制 ====================

  /**
   * 进入计划模式
   */
  ipcMain.handle('plan-mode:enter', async (event, options = {}) => {
    try {
      const plan = planModeManager.enterPlanMode(options);
      return {
        success: true,
        plan: plan.toJSON(),
        state: planModeManager.getState(),
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Enter plan mode error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 退出计划模式
   */
  ipcMain.handle('plan-mode:exit', async (event, options = {}) => {
    try {
      const result = planModeManager.exitPlanMode(options);
      return {
        ...result,
        state: planModeManager.getState(),
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Exit plan mode error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取当前状态
   */
  ipcMain.handle('plan-mode:get-state', async () => {
    try {
      return {
        success: true,
        state: planModeManager.getState(),
        isActive: planModeManager.isActive(),
        currentPlan: planModeManager.getCurrentPlan()?.toJSON() || null,
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get state error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 计划管理 ====================

  /**
   * 获取当前计划
   */
  ipcMain.handle('plan-mode:get-current-plan', async () => {
    try {
      const plan = planModeManager.getCurrentPlan();
      return {
        success: true,
        plan: plan?.toJSON() || null,
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get current plan error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 添加计划项
   */
  ipcMain.handle('plan-mode:add-item', async (event, item) => {
    try {
      const planItem = planModeManager.addPlanItem(item);
      if (!planItem) {
        return {
          success: false,
          error: 'No active plan',
        };
      }
      return {
        success: true,
        item: planItem.toJSON(),
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Add item error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 移除计划项
   */
  ipcMain.handle('plan-mode:remove-item', async (event, itemId) => {
    try {
      const removed = planModeManager.removePlanItem(itemId);
      return {
        success: removed,
        error: removed ? null : 'Item not found or no active plan',
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Remove item error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 标记计划就绪
   */
  ipcMain.handle('plan-mode:mark-ready', async (event, options = {}) => {
    try {
      const result = planModeManager.markPlanReady(options);
      return result;
    } catch (error) {
      logger.error('[PlanModeIPC] Mark ready error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 审批流程 ====================

  /**
   * 审批计划
   */
  ipcMain.handle('plan-mode:approve', async (event, options = {}) => {
    try {
      const result = planModeManager.approvePlan(options);
      return result;
    } catch (error) {
      logger.error('[PlanModeIPC] Approve error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 拒绝计划
   */
  ipcMain.handle('plan-mode:reject', async (event, options = {}) => {
    try {
      const result = planModeManager.rejectPlan(options);
      return result;
    } catch (error) {
      logger.error('[PlanModeIPC] Reject error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 执行已审批的计划
   */
  ipcMain.handle('plan-mode:execute', async (event, options = {}) => {
    try {
      const executor = functionCaller || options.executor;
      const result = await planModeManager.executePlan(executor, options);
      return result;
    } catch (error) {
      logger.error('[PlanModeIPC] Execute error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 历史和统计 ====================

  /**
   * 获取计划历史
   */
  ipcMain.handle('plan-mode:get-history', async (event, options = {}) => {
    try {
      const history = planModeManager.getPlansHistory(options);
      return {
        success: true,
        plans: history,
        total: history.length,
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get history error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取指定计划
   */
  ipcMain.handle('plan-mode:get-plan', async (event, planId) => {
    try {
      const plan = planModeManager.getPlan(planId);
      return {
        success: !!plan,
        plan,
        error: plan ? null : 'Plan not found',
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get plan error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('plan-mode:get-stats', async () => {
    try {
      const stats = planModeManager.getStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get stats error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 工具权限 ====================

  /**
   * 检查工具是否在计划模式中允许
   */
  ipcMain.handle('plan-mode:is-tool-allowed', async (event, toolName) => {
    try {
      const allowed = planModeManager.isToolAllowedInPlanMode(toolName);
      const category = planModeManager.getToolCategory(toolName);
      return {
        success: true,
        toolName,
        allowed,
        category,
        isActive: planModeManager.isActive(),
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Is tool allowed error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取计划摘要
   */
  ipcMain.handle('plan-mode:get-summary', async () => {
    try {
      const summary = planModeManager.generatePlanSummary();
      return {
        success: true,
        summary,
      };
    } catch (error) {
      logger.error('[PlanModeIPC] Get summary error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info('[PlanModeIPC] Registered 14 IPC handlers');

  return planModeManager;
}

/**
 * 注销 Plan Mode IPC 处理器
 */
function unregisterPlanModeIPC() {
  const channels = [
    'plan-mode:enter',
    'plan-mode:exit',
    'plan-mode:get-state',
    'plan-mode:get-current-plan',
    'plan-mode:add-item',
    'plan-mode:remove-item',
    'plan-mode:mark-ready',
    'plan-mode:approve',
    'plan-mode:reject',
    'plan-mode:execute',
    'plan-mode:get-history',
    'plan-mode:get-plan',
    'plan-mode:get-stats',
    'plan-mode:is-tool-allowed',
    'plan-mode:get-summary',
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  logger.info('[PlanModeIPC] Unregistered all IPC handlers');
}

module.exports = {
  registerPlanModeIPC,
  unregisterPlanModeIPC,
};
