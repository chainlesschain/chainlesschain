/**
 * LLM IPC handlers — stream group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-stream
 */
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

const STREAM_STATUSES = new Set([
  "idle",
  "running",
  "paused",
  "cancelled",
  "completed",
  "error",
]);
const STREAM_EVENT_NAMES = new Set([
  "chunk",
  "pause",
  "resume",
  "cancel",
  "complete",
  "stream-error",
]);

function ownData(source, key) {
  if (source === null || typeof source !== "object") {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function finiteNonNegative(source, key) {
  const value = ownData(source, key);
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function projectStreamStats(stats) {
  const status = ownData(stats, "status");
  return Object.freeze({
    status: STREAM_STATUSES.has(status) ? status : "idle",
    totalChunks: finiteNonNegative(stats, "totalChunks"),
    processedChunks: finiteNonNegative(stats, "processedChunks"),
    duration: finiteNonNegative(stats, "duration"),
    throughput: finiteNonNegative(stats, "throughput"),
    averageChunkTime: finiteNonNegative(stats, "averageChunkTime"),
    isPaused: ownData(stats, "isPaused") === true,
    bufferedChunks: finiteNonNegative(stats, "bufferedChunks"),
    bufferedBytes: finiteNonNegative(stats, "bufferedBytes"),
    droppedBufferedChunks: finiteNonNegative(stats, "droppedBufferedChunks"),
    pauseWaiters: finiteNonNegative(stats, "pauseWaiters"),
    droppedPausedChunks: finiteNonNegative(stats, "droppedPausedChunks"),
  });
}

function streamEvent(controllerId, event) {
  return Object.freeze({
    controllerId,
    code:
      event === "stream-error"
        ? "CC_LLM_STREAM_FAILED"
        : "CC_LLM_STREAM_EVENT",
    component: "stream-controller",
    event: STREAM_EVENT_NAMES.has(event) ? event : "unknown",
  });
}

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
        controller.on("chunk", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-chunk",
              streamEvent(controllerId, "chunk"),
            );
          }
        });

        controller.on("pause", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-pause",
              streamEvent(controllerId, "pause"),
            );
          }
        });

        controller.on("resume", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-resume",
              streamEvent(controllerId, "resume"),
            );
          }
        });

        controller.on("cancel", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-cancel",
              streamEvent(controllerId, "cancel"),
            );
          }
        });

        controller.on("complete", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-complete",
              streamEvent(controllerId, "complete"),
            );
          }
        });

        controller.on("stream-error", () => {
          if (mainWindow) {
            mainWindow.webContents.send(
              "llm:stream-error",
              streamEvent(controllerId, "stream-error"),
            );
          }
        });

        return { controllerId };
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

      return { success: true };
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

      return { success: true };
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

      return { success: true };
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

      return projectStreamStats(stats);
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
          return { success: true };
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
