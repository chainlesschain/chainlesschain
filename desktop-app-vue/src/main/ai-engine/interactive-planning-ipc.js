const { logger } = require("../utils/logger.js");

/**
 * 交互式任务规划 IPC 接口
 * 供前端调用交互式任务规划器
 */

// 默认使用 electron 的 ipcMain 和 BrowserWindow，但允许注入 mock
let electronModule = null;

function getElectron() {
  if (!electronModule) {
    electronModule = require("electron");
  }
  return electronModule;
}

class InteractivePlanningIPC {
  /**
   * @param {Object} interactiveTaskPlanner - 交互式任务规划器实例
   * @param {Object} options - 可选配置，用于测试时注入依赖
   * @param {Object} options.ipcMain - IPC 主进程模块（用于测试注入）
   * @param {Object} options.BrowserWindow - BrowserWindow 模块（用于测试注入）
   */
  constructor(interactiveTaskPlanner, options = {}) {
    this.planner = interactiveTaskPlanner;
    this.ipcMain = options.ipcMain || getElectron().ipcMain;
    this.BrowserWindow = options.BrowserWindow || getElectron().BrowserWindow;
    this.setupIPC();
  }

  setupIPC() {
    /**
     * 开始Plan模式对话
     */
    this.ipcMain.handle(
      "interactive-planning:start-session",
      async (event, { userRequest, projectContext }) => {
        try {
          logger.info("[InteractivePlanningIPC] 开始Plan会话:", userRequest);
          const result = await this.planner.startPlanSession(
            userRequest,
            projectContext,
          );
          return { success: true, ...result };
        } catch (error) {
          logger.error("[InteractivePlanningIPC] 开始会话失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    /**
     * 用户确认或调整Plan
     */
    this.ipcMain.handle(
      "interactive-planning:respond",
      async (event, { sessionId, userResponse }) => {
        try {
          logger.info(
            "[InteractivePlanningIPC] 用户响应:",
            sessionId,
            userResponse.action,
          );
          const result = await this.planner.handleUserResponse(
            sessionId,
            userResponse,
          );
          return { success: true, ...result };
        } catch (error) {
          logger.error("[InteractivePlanningIPC] 处理响应失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    /**
     * 提交用户反馈
     */
    this.ipcMain.handle(
      "interactive-planning:submit-feedback",
      async (event, { sessionId, feedback }) => {
        try {
          logger.info("[InteractivePlanningIPC] 提交反馈:", sessionId);
          const result = await this.planner.submitUserFeedback(
            sessionId,
            feedback,
          );
          return { success: true, ...result };
        } catch (error) {
          logger.error("[InteractivePlanningIPC] 提交反馈失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    /**
     * 获取会话信息
     */
    this.ipcMain.handle(
      "interactive-planning:get-session",
      async (event, { sessionId }) => {
        try {
          const session = this.planner.getSession(sessionId);

          if (!session) {
            return {
              success: false,
              error: "会话不存在",
            };
          }

          return {
            success: true,
            session: {
              id: session.id,
              status: session.status,
              userRequest: session.userRequest,
              createdAt: session.createdAt,
              taskPlan: session.taskPlan,
              executionResult: session.executionResult,
              qualityScore: session.qualityScore,
              userFeedback: session.userFeedback,
            },
          };
        } catch (error) {
          logger.error("[InteractivePlanningIPC] 获取会话失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    /**
     * 清理过期会话
     */
    this.ipcMain.handle(
      "interactive-planning:cleanup",
      async (event, { maxAge }) => {
        try {
          const count = this.planner.cleanupExpiredSessions(maxAge);
          return {
            success: true,
            cleanedCount: count,
          };
        } catch (error) {
          logger.error("[InteractivePlanningIPC] 清理失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // 设置事件转发
    this.setupEventForwarding();
  }

  /**
   * 设置事件转发到渲染进程
   */
  setupEventForwarding() {
    // 将任务规划器的事件转发到所有窗口
    this.planner.on("plan-generated", (data) => {
      this.broadcastToAll("interactive-planning:plan-generated", data);
    });

    this.planner.on("execution-started", (data) => {
      this.broadcastToAll("interactive-planning:execution-started", data);
    });

    this.planner.on("execution-progress", (data) => {
      this.broadcastToAll("interactive-planning:execution-progress", data);
    });

    this.planner.on("execution-completed", (data) => {
      this.broadcastToAll("interactive-planning:execution-completed", data);
    });

    this.planner.on("execution-failed", (data) => {
      this.broadcastToAll("interactive-planning:execution-failed", data);
    });

    this.planner.on("feedback-submitted", (data) => {
      this.broadcastToAll("interactive-planning:feedback-submitted", data);
    });
  }

  /**
   * 广播事件到所有窗口
   */
  broadcastToAll(channel, data) {
    const windows = this.BrowserWindow.getAllWindows();

    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}

module.exports = InteractivePlanningIPC;
