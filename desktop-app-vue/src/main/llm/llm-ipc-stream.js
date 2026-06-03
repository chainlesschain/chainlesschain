/**
 * LLM IPC handlers — stream group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-stream
 */
const { logger } = require("../utils/logger.js");

function registerStreamHandlers(ctx) {
  const { ipcMain, mainWindow, app } = ctx;

  // ============================================================
  // 流式输出控制 (Stream Control) - 6 handlers
  // ============================================================

  /**
   * 创建流式输出控制器
   * Channel: 'llm:create-stream-controller'
   */
  ipcMain.handle(
    "llm:create-stream-controller",
    async (_event, options = {}) => {
      try {
        const { createStreamController } = require("./stream-controller");
        const controller = createStreamController(options);

        // 生成唯一ID
        const controllerId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // 存储控制器（在app实例中）
        if (!app.streamControllers) {
          app.streamControllers = new Map();
        }
        app.streamControllers.set(controllerId, controller);

        // 设置事件监听
        controller.on("chunk", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-chunk", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("pause", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-pause", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("resume", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-resume", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("cancel", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-cancel", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("complete", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-complete", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("stream-error", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-error", {
              controllerId,
              ...data,
            });
          }
        });

        return { controllerId, status: controller.status };
      } catch (error) {
        logger.error("[LLM IPC] 创建流控制器失败:", error);
        throw error;
      }
    },
  );

  /**
   * 暂停流式输出
   * Channel: 'llm:pause-stream'
   */
  ipcMain.handle("llm:pause-stream", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.pause();

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 暂停流失败:", error);
      throw error;
    }
  });

  /**
   * 恢复流式输出
   * Channel: 'llm:resume-stream'
   */
  ipcMain.handle("llm:resume-stream", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.resume();

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 恢复流失败:", error);
      throw error;
    }
  });

  /**
   * 取消流式输出
   * Channel: 'llm:cancel-stream'
   */
  ipcMain.handle("llm:cancel-stream", async (_event, controllerId, reason) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.cancel(reason);

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 取消流失败:", error);
      throw error;
    }
  });

  /**
   * 获取流式输出统计信息
   * Channel: 'llm:get-stream-stats'
   */
  ipcMain.handle("llm:get-stream-stats", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      const stats = controller.getStats();

      return stats;
    } catch (error) {
      logger.error("[LLM IPC] 获取流统计失败:", error);
      throw error;
    }
  });

  /**
   * 销毁流式输出控制器
   * Channel: 'llm:destroy-stream-controller'
   */
  ipcMain.handle(
    "llm:destroy-stream-controller",
    async (_event, controllerId) => {
      try {
        if (
          !app.streamControllers ||
          !app.streamControllers.has(controllerId)
        ) {
          return { success: true, message: "控制器已不存在" };
        }

        const controller = app.streamControllers.get(controllerId);
        controller.destroy();
        app.streamControllers.delete(controllerId);

        return { success: true };
      } catch (error) {
        logger.error("[LLM IPC] 销毁流控制器失败:", error);
        throw error;
      }
    },
  );
}

module.exports = { registerStreamHandlers };
