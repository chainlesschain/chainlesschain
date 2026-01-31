/**
 * 工作流 IPC 通信
 *
 * 处理渲染进程与工作流管理器之间的通信
 *
 * IPC 通道:
 * - workflow:create - 创建工作流
 * - workflow:start - 启动工作流
 * - workflow:pause - 暂停工作流
 * - workflow:resume - 恢复工作流
 * - workflow:cancel - 取消工作流
 * - workflow:retry - 重试失败阶段
 * - workflow:get-status - 获取工作流状态
 * - workflow:get-stages - 获取阶段列表
 * - workflow:get-logs - 获取执行日志
 * - workflow:get-gates - 获取门禁状态
 * - workflow:override-gate - 手动通过门禁
 * - workflow:get-all - 获取所有工作流
 * - workflow:delete - 删除工作流
 *
 * v0.27.0: 新建文件
 */

const { ipcMain, BrowserWindow } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * 工作流 IPC 处理器类
 */
class WorkflowIPC {
  constructor(workflowManager, options = {}) {
    this.workflowManager = workflowManager;
    this.ipcMain = options.ipcMain || ipcMain;

    // 设置 IPC 处理器
    this._setupIPCHandlers();

    // 设置事件转发
    this._setupEventForwarding();

    logger.info('[WorkflowIPC] 工作流 IPC 已初始化');
  }

  /**
   * 设置 IPC 处理器
   * @private
   */
  _setupIPCHandlers() {
    // 创建工作流
    this.ipcMain.handle('workflow:create', async (event, payload) => {
      try {
        logger.info('[WorkflowIPC] 创建工作流:', payload);
        const workflow = this.workflowManager.createWorkflow(payload);
        return {
          success: true,
          data: {
            workflowId: workflow.id,
            title: workflow.title,
            status: workflow.getStatus(),
          },
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 创建工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 启动工作流
    this.ipcMain.handle('workflow:start', async (event, payload) => {
      try {
        const { workflowId, input, context } = payload;
        logger.info('[WorkflowIPC] 启动工作流:', workflowId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        // 异步执行，不阻塞
        workflow.execute(input, context).catch(err => {
          logger.error('[WorkflowIPC] 工作流执行失败:', err);
        });

        return {
          success: true,
          data: {
            workflowId,
            status: 'started',
          },
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 启动工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 暂停工作流
    this.ipcMain.handle('workflow:pause', async (event, payload) => {
      try {
        const { workflowId } = payload;
        logger.info('[WorkflowIPC] 暂停工作流:', workflowId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        const result = workflow.pause();
        return {
          success: result,
          error: result ? null : '无法暂停，当前状态不允许',
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 暂停工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 恢复工作流
    this.ipcMain.handle('workflow:resume', async (event, payload) => {
      try {
        const { workflowId } = payload;
        logger.info('[WorkflowIPC] 恢复工作流:', workflowId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        const result = workflow.resume();
        return {
          success: result,
          error: result ? null : '无法恢复，当前状态不允许',
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 恢复工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 取消工作流
    this.ipcMain.handle('workflow:cancel', async (event, payload) => {
      try {
        const { workflowId, reason } = payload;
        logger.info('[WorkflowIPC] 取消工作流:', workflowId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        const result = workflow.cancel(reason);
        return {
          success: result,
          error: result ? null : '无法取消，当前状态不允许',
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 取消工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 重试工作流
    this.ipcMain.handle('workflow:retry', async (event, payload) => {
      try {
        const { workflowId } = payload;
        logger.info('[WorkflowIPC] 重试工作流:', workflowId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        // 异步执行重试
        workflow.retry().catch(err => {
          logger.error('[WorkflowIPC] 工作流重试失败:', err);
        });

        return {
          success: true,
          data: {
            workflowId,
            status: 'retrying',
          },
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 重试工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取工作流状态
    this.ipcMain.handle('workflow:get-status', async (event, payload) => {
      try {
        const { workflowId } = payload;

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        return {
          success: true,
          data: workflow.getStatus(),
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 获取状态失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取阶段列表
    this.ipcMain.handle('workflow:get-stages', async (event, payload) => {
      try {
        const { workflowId } = payload;

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        return {
          success: true,
          data: workflow.getStages(),
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 获取阶段失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取执行日志
    this.ipcMain.handle('workflow:get-logs', async (event, payload) => {
      try {
        const { workflowId, limit = 100 } = payload;

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        return {
          success: true,
          data: workflow.getLogs(limit),
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 获取日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取质量门禁状态
    this.ipcMain.handle('workflow:get-gates', async (event, payload) => {
      try {
        const { workflowId } = payload;

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        return {
          success: true,
          data: workflow.getQualityGates(),
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 获取门禁状态失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 手动覆盖质量门禁
    this.ipcMain.handle('workflow:override-gate', async (event, payload) => {
      try {
        const { workflowId, gateId, reason } = payload;
        logger.info('[WorkflowIPC] 覆盖质量门禁:', gateId);

        const workflow = this.workflowManager.getWorkflow(workflowId);
        if (!workflow) {
          return { success: false, error: '工作流不存在' };
        }

        const result = workflow.overrideQualityGate(gateId, reason);
        return {
          success: result,
          error: result ? null : '无法覆盖门禁',
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 覆盖门禁失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取所有工作流
    this.ipcMain.handle('workflow:get-all', async (event) => {
      try {
        return {
          success: true,
          data: this.workflowManager.getAllWorkflows(),
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 获取所有工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除工作流
    this.ipcMain.handle('workflow:delete', async (event, payload) => {
      try {
        const { workflowId } = payload;
        logger.info('[WorkflowIPC] 删除工作流:', workflowId);

        const result = this.workflowManager.deleteWorkflow(workflowId);
        return {
          success: result,
          error: result ? null : '工作流不存在',
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 删除工作流失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 创建并立即启动工作流（便捷方法）
    this.ipcMain.handle('workflow:create-and-start', async (event, payload) => {
      try {
        const { title, description, input, context } = payload;
        logger.info('[WorkflowIPC] 创建并启动工作流:', title);

        const workflow = this.workflowManager.createWorkflow({
          title,
          description,
        });

        // 异步执行
        workflow.execute(input, context).catch(err => {
          logger.error('[WorkflowIPC] 工作流执行失败:', err);
        });

        return {
          success: true,
          data: {
            workflowId: workflow.id,
            title: workflow.title,
            status: 'started',
          },
        };
      } catch (error) {
        logger.error('[WorkflowIPC] 创建并启动工作流失败:', error);
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 设置事件转发
   * @private
   */
  _setupEventForwarding() {
    // 工作流管理器事件会自动转发到渲染进程
    // 通过 WorkflowManager._forwardWorkflowEvents 实现
  }

  /**
   * 广播到所有窗口
   * @param {string} channel - 通道名
   * @param {any} data - 数据
   */
  broadcast(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.webContents) {
        win.webContents.send(channel, data);
      }
    });
  }

  /**
   * 注销所有处理器
   */
  dispose() {
    const channels = [
      'workflow:create',
      'workflow:start',
      'workflow:pause',
      'workflow:resume',
      'workflow:cancel',
      'workflow:retry',
      'workflow:get-status',
      'workflow:get-stages',
      'workflow:get-logs',
      'workflow:get-gates',
      'workflow:override-gate',
      'workflow:get-all',
      'workflow:delete',
      'workflow:create-and-start',
    ];

    channels.forEach(channel => {
      this.ipcMain.removeHandler(channel);
    });

    logger.info('[WorkflowIPC] 工作流 IPC 已注销');
  }
}

/**
 * 注册工作流 IPC
 * @param {Object} dependencies - 依赖项
 * @returns {WorkflowIPC} IPC 实例
 */
function registerWorkflowIPC(dependencies) {
  const { workflowManager, ipcMain: customIpcMain } = dependencies;

  if (!workflowManager) {
    logger.warn('[WorkflowIPC] 未提供 workflowManager，跳过注册');
    return null;
  }

  return new WorkflowIPC(workflowManager, {
    ipcMain: customIpcMain,
  });
}

module.exports = {
  WorkflowIPC,
  registerWorkflowIPC,
};
