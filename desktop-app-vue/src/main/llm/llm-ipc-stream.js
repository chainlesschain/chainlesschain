/**
 * LLM IPC handlers — stream group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-stream
 */
const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const { HARD_STREAM_CONTROLLER_LIMITS } = require("./stream-controller");

const streamControllerOwners = new WeakMap();
const SUCCESS_RECEIPT = Object.freeze({ success: true });
const CREATE_OPTION_KEYS = new Set([
  "enableBuffering",
  "maxBufferedChunks",
  "maxBufferedBytes",
  "maxBufferedChunkBytes",
  "maxPauseWaiters",
]);

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
  if (
    source === null ||
    typeof source !== "object" ||
    types.isProxy(source) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(source))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function authorizedTenant(request) {
  const tenantId = ownData(request, "tenantId");
  if (
    typeof tenantId !== "string" ||
    tenantId.length < 1 ||
    tenantId.length > 512 ||
    /\p{Cc}/u.test(tenantId)
  ) {
    throw new TypeError("Invalid stream tenant");
  }
  return tenantId;
}

function normalizeLimit(descriptors, key, maximum) {
  const descriptor = descriptors[key];
  if (descriptor === undefined) {
    return undefined;
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError("Invalid stream option");
  }
  const value = descriptor.value;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError("Invalid stream limit");
  }
  return value;
}

function normalizeCreateOptions(value) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid stream options");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !CREATE_OPTION_KEYS.has(key)) {
      throw new TypeError("Invalid stream option");
    }
  }
  const buffering = descriptors.enableBuffering;
  if (
    buffering &&
    (!buffering.enumerable ||
      !Object.hasOwn(buffering, "value") ||
      typeof buffering.value !== "boolean")
  ) {
    throw new TypeError("Invalid stream buffering option");
  }
  const options = { enableBuffering: buffering?.value === true };
  for (const [key, maximum] of [
    ["maxBufferedChunks", HARD_STREAM_CONTROLLER_LIMITS.maxBufferedChunks],
    ["maxBufferedBytes", HARD_STREAM_CONTROLLER_LIMITS.maxBufferedBytes],
    [
      "maxBufferedChunkBytes",
      HARD_STREAM_CONTROLLER_LIMITS.maxBufferedChunkBytes,
    ],
    ["maxPauseWaiters", HARD_STREAM_CONTROLLER_LIMITS.maxPauseWaiters],
  ]) {
    const limit = normalizeLimit(descriptors, key, maximum);
    if (limit !== undefined) {
      options[key] = limit;
    }
  }
  return Object.freeze(options);
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
      event === "stream-error" ? "CC_LLM_STREAM_FAILED" : "CC_LLM_STREAM_EVENT",
    component: "stream-controller",
    event: STREAM_EVENT_NAMES.has(event) ? event : "unknown",
  });
}

function registerStreamHandlers(ctx) {
  const { ipcMain, mainWindow, app } = ctx;
  const privacy = ctx.streamPrivacy || createLlmIpcPrivacy("stream");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM stream IPC authorization is required");
  }
  const currentTenantMatches = (tenantId) => {
    try {
      const identity = ctx.getCurrentIdentity();
      const did = ownData(identity, "did");
      const currentTenantId = ownData(identity, "tenantId") || did;
      return currentTenantId === tenantId;
    } catch {
      return false;
    }
  };
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^llm:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        let tenantId;
        try {
          tenantId = authorizedTenant(
            await authorization.authorize(event, operation),
          );
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, tenantId, ...args);
      });
    },
  };
  const ownedController = (controllerId, tenantId) => {
    const controller = app?.streamControllers?.get(controllerId);
    if (!controller || streamControllerOwners.get(controller) !== tenantId) {
      throw new TypeError("Unknown stream controller");
    }
    return controller;
  };

  // ============================================================
  // 流式输出控制 (Stream Control) - 6 handlers
  // ============================================================

  /**
   * 创建流式输出控制器
   * Channel: 'llm:create-stream-controller'
   */
  authorizedIpcMain.handle(
    "llm:create-stream-controller",
    async (_event, tenantId, options = {}) => {
      try {
        const { createStreamController } = require("./stream-controller");
        const controller = createStreamController(
          normalizeCreateOptions(options),
        );

        // 生成唯一ID
        const controllerId = `stream:${randomUUID()}`;

        // 存储控制器（在app实例中）
        if (!app.streamControllers) {
          app.streamControllers = new Map();
        }
        app.streamControllers.set(controllerId, controller);
        streamControllerOwners.set(controller, tenantId);

        // 设置事件监听
        controller.on("chunk", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-chunk",
              streamEvent(controllerId, "chunk"),
            );
          }
        });

        controller.on("pause", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-pause",
              streamEvent(controllerId, "pause"),
            );
          }
        });

        controller.on("resume", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-resume",
              streamEvent(controllerId, "resume"),
            );
          }
        });

        controller.on("cancel", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-cancel",
              streamEvent(controllerId, "cancel"),
            );
          }
        });

        controller.on("complete", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-complete",
              streamEvent(controllerId, "complete"),
            );
          }
        });

        controller.on("stream-error", () => {
          if (mainWindow && currentTenantMatches(tenantId)) {
            mainWindow.webContents.send(
              "llm:stream-error",
              streamEvent(controllerId, "stream-error"),
            );
          }
        });

        return Object.freeze({ controllerId });
      } catch {
        throw privacy.failure("create-stream-controller");
      }
    },
  );

  /**
   * 暂停流式输出
   * Channel: 'llm:pause-stream'
   */
  authorizedIpcMain.handle(
    "llm:pause-stream",
    async (_event, tenantId, controllerId) => {
      try {
        const controller = ownedController(controllerId, tenantId);
        controller.pause();

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("pause-stream");
      }
    },
  );

  /**
   * 恢复流式输出
   * Channel: 'llm:resume-stream'
   */
  authorizedIpcMain.handle(
    "llm:resume-stream",
    async (_event, tenantId, controllerId) => {
      try {
        const controller = ownedController(controllerId, tenantId);
        controller.resume();

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("resume-stream");
      }
    },
  );

  /**
   * 取消流式输出
   * Channel: 'llm:cancel-stream'
   */
  authorizedIpcMain.handle(
    "llm:cancel-stream",
    async (_event, tenantId, controllerId) => {
      try {
        const controller = ownedController(controllerId, tenantId);
        controller.cancel();

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("cancel-stream");
      }
    },
  );

  /**
   * 获取流式输出统计信息
   * Channel: 'llm:get-stream-stats'
   */
  authorizedIpcMain.handle(
    "llm:get-stream-stats",
    async (_event, tenantId, controllerId) => {
      try {
        const controller = ownedController(controllerId, tenantId);
        const stats = controller.getStats();

        return projectStreamStats(stats);
      } catch {
        throw privacy.failure("get-stream-stats");
      }
    },
  );

  /**
   * 销毁流式输出控制器
   * Channel: 'llm:destroy-stream-controller'
   */
  authorizedIpcMain.handle(
    "llm:destroy-stream-controller",
    async (_event, tenantId, controllerId) => {
      try {
        const controller = app?.streamControllers?.get(controllerId);
        if (
          !controller ||
          streamControllerOwners.get(controller) !== tenantId
        ) {
          return SUCCESS_RECEIPT;
        }

        controller.destroy();
        app.streamControllers.delete(controllerId);

        return SUCCESS_RECEIPT;
      } catch {
        throw privacy.failure("destroy-stream-controller");
      }
    },
  );
}

module.exports = { registerStreamHandlers };
