/**
 * LLM IPC handlers — stream group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-stream
 */
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

function registerStreamHandlers(ctx) {
  const { ipcMain, mainWindow, app } = ctx;
  const privacy = ctx.streamPrivacy || createLlmIpcPrivacy("stream");

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

        controller.on("stream-error", () => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-error", {
              controllerId,
              error: "LLM stream failed",
              code: "CC_LLM_STREAM_FAILED",
            });
          }
        });

        return { controllerId, status: controller.status };
      } catch {
        throw privacy.failure("create-stream-controller");
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
    } catch {
      throw privacy.failure("pause-stream");
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
    } catch {
      throw privacy.failure("resume-stream");
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
    } catch {
      throw privacy.failure("cancel-stream");
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
    } catch {
      throw privacy.failure("get-stream-stats");
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
      } catch {
        throw privacy.failure("destroy-stream-controller");
      }
    },
  );
}

module.exports = { registerStreamHandlers };
