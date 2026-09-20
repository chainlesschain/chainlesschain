"use strict";

const { randomUUID } = require("node:crypto");
const { types } = require("node:util");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  createLlmCoreIpcAuthorization,
} = require("./llm-core-ipc-authorization");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const {
  HARD_STREAM_CONTROLLER_LIMITS,
  StreamStatus,
  createStreamController,
} = require("./stream-controller.js");
const {
  StreamControllerRegistry,
} = require("./stream-controller-registry.js");

const streamControllerRegistry = new StreamControllerRegistry();
const streamControllerOwners = new WeakMap();
const STREAM_CONTROLLER_REGISTRY_LIMITS = streamControllerRegistry.limits;
const CREATE_OPTION_KEYS = new Set([
  "enableBuffering",
  "maxBufferedChunks",
  "maxBufferedBytes",
  "maxBufferedChunkBytes",
  "maxPauseWaiters",
]);
const STREAM_STATUSES = new Set(Object.values(StreamStatus));
const CHANNEL_OPERATIONS = Object.freeze({
  "stream:create": "stream-create",
  "stream:start": "stream-start",
  "stream:complete": "stream-complete",
  "stream:destroy": "stream-destroy",
  "stream:pause": "stream-pause",
  "stream:resume": "stream-resume",
  "stream:cancel": "stream-cancel",
  "stream:get-status": "stream-get-status",
  "stream:get-stats": "stream-get-stats",
  "stream:list-active": "stream-list-active",
  "stream:get-buffer": "stream-get-buffer",
  "stream:clear-buffer": "stream-clear-buffer",
});

function fixedSuccess(details = {}) {
  return Object.freeze({ success: true, ...details });
}

function ownData(source, key) {
  if (
    !source ||
    typeof source !== "object" ||
    types.isProxy(source) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(source))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function boundedCount(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : 0;
}

function projectStats(stats) {
  const status = ownData(stats, "status");
  return Object.freeze({
    status: STREAM_STATUSES.has(status) ? status : StreamStatus.IDLE,
    totalChunks: boundedCount(ownData(stats, "totalChunks")),
    processedChunks: boundedCount(ownData(stats, "processedChunks")),
    duration: boundedCount(ownData(stats, "duration")),
    throughput: boundedCount(ownData(stats, "throughput")),
    averageChunkTime: boundedCount(ownData(stats, "averageChunkTime")),
    isPaused: ownData(stats, "isPaused") === true,
    bufferedChunks: boundedCount(ownData(stats, "bufferedChunks")),
    bufferedBytes: boundedCount(ownData(stats, "bufferedBytes")),
    droppedBufferedChunks: boundedCount(
      ownData(stats, "droppedBufferedChunks"),
    ),
    pauseWaiters: boundedCount(ownData(stats, "pauseWaiters")),
    droppedPausedChunks: boundedCount(ownData(stats, "droppedPausedChunks")),
  });
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
  const bufferingDescriptor = descriptors.enableBuffering;
  if (
    bufferingDescriptor &&
    (!bufferingDescriptor.enumerable ||
      !Object.hasOwn(bufferingDescriptor, "value") ||
      typeof bufferingDescriptor.value !== "boolean")
  ) {
    throw new TypeError("Invalid stream buffering option");
  }
  const options = {
    enableBuffering: bufferingDescriptor?.value === true,
  };
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

function validateStreamId(streamId) {
  const validation = streamControllerRegistry.validateStreamId(streamId);
  if (!validation.accepted) {
    throw new TypeError("Invalid stream reference");
  }
  return validation.streamId;
}

function ownedController(streamId, tenantId) {
  const controller = streamControllerRegistry.get(validateStreamId(streamId));
  if (!controller || streamControllerOwners.get(controller) !== tenantId) {
    throw new TypeError("Unknown stream reference");
  }
  return controller;
}

function getOrCreateController(streamId, options = {}) {
  const { controller, created } = streamControllerRegistry.getOrCreate(
    streamId,
    () => createStreamController(options),
  );
  if (created) {
    const cleanup = () => {
      streamControllerRegistry.scheduleTerminalDelete(streamId, 30000);
    };
    controller.on("complete", cleanup);
    controller.on("cancel", cleanup);
    controller.on("stream-error", cleanup);
  }
  return controller;
}

function registerStreamControllerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  mainWindow,
  didManager,
  authorizePurpose,
  coreAuthorization: injectedAuthorization,
  streamPrivacy: injectedPrivacy,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  const privacy = injectedPrivacy || createLlmIpcPrivacy("stream");
  if (ipcGuard.isModuleRegistered("stream-controller-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const authorization =
    injectedAuthorization ||
    createLlmCoreIpcAuthorization({
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => didManager?.getCurrentIdentity?.() || null,
      authorizePurpose,
    });

  function handle(channel, handler) {
    const operation = CHANNEL_OPERATIONS[channel];
    ipcMain.handle(channel, async (event, ...args) => {
      let tenantId;
      try {
        tenantId = authorizedTenant(
          await authorization.authorize(event, operation),
        );
      } catch {
        throw privacy.authorizationFailure(operation);
      }
      try {
        return await handler(tenantId, ...args);
      } catch {
        throw privacy.failure(operation);
      }
    });
  }

  handle("stream:create", async (tenantId, options = {}) => {
    const streamId = `stream:${randomUUID()}`;
    validateStreamId(streamId);
    const controller = getOrCreateController(
      streamId,
      normalizeCreateOptions(options),
    );
    streamControllerOwners.set(controller, tenantId);
    privacy.success("stream-create");
    return fixedSuccess({ streamId });
  });

  handle("stream:start", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).start();
    privacy.success("stream-start");
    return fixedSuccess();
  });

  handle("stream:complete", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).complete();
    privacy.success("stream-complete");
    return fixedSuccess();
  });

  handle("stream:destroy", async (tenantId, streamId) => {
    const safeStreamId = validateStreamId(streamId);
    const controller = streamControllerRegistry.get(safeStreamId);
    if (controller && streamControllerOwners.get(controller) === tenantId) {
      controller.destroy();
      streamControllerRegistry.delete(safeStreamId);
    }
    privacy.success("stream-destroy");
    return fixedSuccess();
  });

  handle("stream:pause", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).pause();
    privacy.success("stream-pause");
    return fixedSuccess();
  });

  handle("stream:resume", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).resume();
    privacy.success("stream-resume");
    return fixedSuccess();
  });

  handle("stream:cancel", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).cancel();
    privacy.success("stream-cancel");
    return fixedSuccess();
  });

  handle("stream:get-status", async (tenantId, streamId) => {
    const controller = ownedController(streamId, tenantId);
    return fixedSuccess({
      status: STREAM_STATUSES.has(controller.status)
        ? controller.status
        : StreamStatus.IDLE,
      isPaused: controller.isPaused === true,
      processedChunks: boundedCount(controller.processedChunks),
      totalChunks: boundedCount(controller.totalChunks),
    });
  });

  handle("stream:get-stats", async (tenantId, streamId) => {
    const controller = ownedController(streamId, tenantId);
    return fixedSuccess({ stats: projectStats(controller.getStats()) });
  });

  handle("stream:list-active", async (tenantId) => {
    const streams = [];
    for (const [streamId, controller] of streamControllerRegistry.entries()) {
      if (streamControllerOwners.get(controller) !== tenantId) {
        continue;
      }
      streams.push(
        Object.freeze({
          streamId,
          status: STREAM_STATUSES.has(controller.status)
            ? controller.status
            : StreamStatus.IDLE,
          isPaused: controller.isPaused === true,
          processedChunks: boundedCount(controller.processedChunks),
        }),
      );
    }
    return fixedSuccess({ count: streams.length, streams });
  });

  handle("stream:get-buffer", async (tenantId, streamId) => {
    const stats = projectStats(ownedController(streamId, tenantId).getStats());
    return fixedSuccess({
      bufferedChunks: stats.bufferedChunks,
      bufferedBytes: stats.bufferedBytes,
    });
  });

  handle("stream:clear-buffer", async (tenantId, streamId) => {
    ownedController(streamId, tenantId).clearBuffer();
    privacy.success("stream-clear-buffer");
    return fixedSuccess();
  });

  ipcGuard.markModuleRegistered("stream-controller-ipc");
  privacy.event("handlers-registered");
}

function unregisterStreamControllerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  if (!ipcGuard.isModuleRegistered("stream-controller-ipc")) {
    return;
  }
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  for (const channel of Object.keys(CHANNEL_OPERATIONS)) {
    ipcMain.removeHandler(channel);
  }
  destroyAllStreamControllers();
  ipcGuard.unmarkModuleRegistered("stream-controller-ipc");
  createLlmIpcPrivacy("stream").event("handlers-unregistered");
}

function getActiveController(streamId) {
  return streamControllerRegistry.get(streamId);
}

function getActiveControllerCount() {
  return streamControllerRegistry.size;
}

function destroyAllStreamControllers() {
  streamControllerRegistry.destroyAll();
}

function getStreamControllerRegistryStats() {
  return streamControllerRegistry.getStats();
}

module.exports = {
  STREAM_CONTROLLER_REGISTRY_LIMITS,
  registerStreamControllerIPC,
  unregisterStreamControllerIPC,
  getOrCreateController,
  getActiveController,
  getActiveControllerCount,
  destroyAllStreamControllers,
  getStreamControllerRegistryStats,
  StreamStatus,
};
