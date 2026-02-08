/**
 * 任务追踪 IPC 处理器
 *
 * 提供前端访问 TaskTrackerFile (todo.md 机制) 的接口
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const { getTaskTrackerFile } = require("./task-tracker-file");

/**
 * 注册任务追踪 IPC 处理器
 */
function registerTaskTrackerIPC() {
  logger.info("[TaskTrackerIPC] 注册任务追踪 IPC 处理器...");

  // ==========================================
  // 任务生命周期 API
  // ==========================================

  /**
   * 创建任务
   */
  ipcMain.handle("task-tracker:create", async (event, plan) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.createTask(plan);
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 创建任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 开始任务
   */
  ipcMain.handle("task-tracker:start", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.startTask();
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 开始任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新任务进度
   */
  ipcMain.handle(
    "task-tracker:update-progress",
    async (event, { stepIndex, status, result }) => {
      try {
        const tracker = getTaskTrackerFile();
        const task = await tracker.updateProgress(stepIndex, status, result);
        return { success: true, task };
      } catch (error) {
        logger.error("[TaskTrackerIPC] 更新进度失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 完成当前步骤
   */
  ipcMain.handle("task-tracker:complete-step", async (event, result) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.completeCurrentStep(result);
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 完成步骤失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 完成任务
   */
  ipcMain.handle("task-tracker:complete", async (event, result) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.completeTask(result);
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 完成任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消任务
   */
  ipcMain.handle("task-tracker:cancel", async (event, reason) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.cancelTask(reason);
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 取消任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 记录步骤错误
   */
  ipcMain.handle(
    "task-tracker:record-error",
    async (event, { stepIndex, error }) => {
      try {
        const tracker = getTaskTrackerFile();
        await tracker.recordStepError(stepIndex, new Error(error));
        return { success: true };
      } catch (error) {
        logger.error("[TaskTrackerIPC] 记录错误失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ==========================================
  // 任务查询 API
  // ==========================================

  /**
   * 获取当前任务
   */
  ipcMain.handle("task-tracker:get-current", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = tracker.getCurrentTask();
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 获取任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 检查是否有活动任务
   */
  ipcMain.handle("task-tracker:has-active", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const hasActive = tracker.hasActiveTask();
      return { success: true, hasActive };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 检查活动任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取 todo.md 内容
   */
  ipcMain.handle("task-tracker:get-todo-context", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const todoContext = await tracker.getTodoContext();
      return { success: true, todoContext };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 获取 todo 上下文失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务上下文（用于 prompt）
   */
  ipcMain.handle("task-tracker:get-prompt-context", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const context = tracker.getTaskContextForPrompt();
      return { success: true, context };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 获取 prompt 上下文失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 中间结果 API
  // ==========================================

  /**
   * 保存中间结果
   */
  ipcMain.handle(
    "task-tracker:save-result",
    async (event, { stepIndex, result }) => {
      try {
        const tracker = getTaskTrackerFile();
        await tracker.saveIntermediateResult(stepIndex, result);
        return { success: true };
      } catch (error) {
        logger.error("[TaskTrackerIPC] 保存中间结果失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 加载中间结果
   */
  ipcMain.handle("task-tracker:load-result", async (event, { stepIndex }) => {
    try {
      const tracker = getTaskTrackerFile();
      const result = await tracker.loadIntermediateResult(stepIndex);
      return { success: true, result };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 加载中间结果失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 任务恢复 API
  // ==========================================

  /**
   * 加载未完成的任务
   */
  ipcMain.handle("task-tracker:load-unfinished", async (event) => {
    try {
      const tracker = getTaskTrackerFile();
      const task = await tracker.loadUnfinishedTask();
      return { success: true, task };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 加载未完成任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取任务历史
   */
  ipcMain.handle("task-tracker:get-history", async (event, { limit = 10 }) => {
    try {
      const tracker = getTaskTrackerFile();
      const history = await tracker.getTaskHistory(limit);
      return { success: true, history };
    } catch (error) {
      logger.error("[TaskTrackerIPC] 获取任务历史失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[TaskTrackerIPC] 任务追踪 IPC 处理器注册完成");
}

module.exports = { registerTaskTrackerIPC };
