"use strict";

/**
 * Authorized renderer diagnostic sink.
 *
 * Only the renderer log-write capability is exposed. Log administration and
 * raw file access stay in the main process.
 */

const { types } = require("node:util");
const { validateSender } = require("./ipc-sender-guard");
const { logger: defaultLogger } = require("../utils/logger");

const LOG_LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
const LOG_ENTRY_KEYS = new Set([
  "level",
  "module",
  "message",
  "data",
  "timestamp",
  "stack",
]);
const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|api.?key|private.?key|pin)/iu;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_MODULE_BYTES = 128;
const MAX_MESSAGE_BYTES = 4 * 1024;
const MAX_STACK_BYTES = 8 * 1024;
const MAX_VALUE_BYTES = 4 * 1024;
const MAX_DATA_BYTES = 32 * 1024;
const MAX_COLLECTION_SIZE = 100;
const MAX_DEPTH = 5;
const MAX_NODES = 256;

function authorizationError() {
  return Object.assign(new Error("Logger IPC request is not authorized"), {
    code: "CC_LOGGER_IPC_UNAUTHORIZED",
  });
}

function boundedText(value, maximumBytes, { nullable = false } = {}) {
  if (nullable && value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\u0000")
  ) {
    throw new TypeError("Invalid logger text");
  }
  return value;
}

function plainDescriptors(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid logger object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      (allowedKeys && !allowedKeys.has(key)) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid logger field");
    }
  }
  return descriptors;
}

function normalizeData(value) {
  const state = { bytes: 0, nodes: 0 };
  const visit = (current, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new TypeError("Logger data exceeds structural limits");
    }
    if (current === null || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("Invalid logger number");
      }
      return current;
    }
    if (typeof current === "string") {
      const text = boundedText(current, MAX_VALUE_BYTES);
      state.bytes += Buffer.byteLength(text, "utf8");
      if (state.bytes > MAX_DATA_BYTES) {
        throw new TypeError("Logger data exceeds byte budget");
      }
      return text;
    }
    if (Array.isArray(current)) {
      if (
        types.isProxy(current) ||
        Object.getPrototypeOf(current) !== Array.prototype ||
        current.length > MAX_COLLECTION_SIZE
      ) {
        throw new TypeError("Invalid logger array");
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const result = [];
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(descriptors[index] || {}, "value")) {
          throw new TypeError("Invalid logger array slot");
        }
        result.push(visit(descriptors[index].value, depth + 1));
      }
      for (const key of Reflect.ownKeys(current)) {
        if (
          key !== "length" &&
          (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key))
        ) {
          throw new TypeError("Invalid logger array field");
        }
      }
      return Object.freeze(result);
    }
    const descriptors = plainDescriptors(current);
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_COLLECTION_SIZE) {
      throw new TypeError("Logger data has too many fields");
    }
    const result = Object.create(null);
    for (const key of keys) {
      boundedText(key, MAX_MODULE_BYTES);
      if (BLOCKED_KEYS.has(key)) {
        throw new TypeError("Invalid logger data key");
      }
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "***REDACTED***"
        : visit(descriptors[key].value, depth + 1);
    }
    return Object.freeze(result);
  };
  return visit(value ?? null, 0);
}

function normalizeLogEntry(value) {
  const descriptors = plainDescriptors(value, LOG_ENTRY_KEYS);
  const level = descriptors.level?.value;
  if (!LOG_LEVELS.has(level)) {
    throw new TypeError("Invalid logger level");
  }
  const module = boundedText(
    descriptors.module?.value ?? "renderer",
    MAX_MODULE_BYTES,
  );
  const message = boundedText(descriptors.message?.value, MAX_MESSAGE_BYTES);
  const stack = boundedText(descriptors.stack?.value ?? null, MAX_STACK_BYTES, {
    nullable: true,
  });
  if (descriptors.timestamp) {
    boundedText(descriptors.timestamp.value, 64);
  }
  return Object.freeze({
    data: normalizeData(descriptors.data?.value),
    level,
    message,
    module,
    stack,
  });
}

function boundedIdentity(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    /\p{Cc}/u.test(value)
  ) {
    throw authorizationError();
  }
  return value;
}

function createAuthorization({
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
}) {
  if (
    typeof getMainWindow !== "function" ||
    typeof getCurrentIdentity !== "function" ||
    (authorizePurpose !== undefined && typeof authorizePurpose !== "function")
  ) {
    throw new TypeError("Logger IPC authorization is not configured");
  }
  return async (event) => {
    let mainWindow;
    let identity;
    try {
      mainWindow = getMainWindow();
      identity = getCurrentIdentity();
    } catch {
      throw authorizationError();
    }
    let contents;
    try {
      contents = mainWindow?.webContents;
    } catch {
      contents = null;
    }
    if (
      !contents ||
      event?.sender !== contents ||
      event?.senderFrame !== contents.mainFrame ||
      validateSender(event).trusted !== true ||
      !identity ||
      types.isProxy(identity) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(identity))
    ) {
      throw authorizationError();
    }
    const actorDid = boundedIdentity(identity.did);
    const tenantId = boundedIdentity(identity.tenantId || actorDid);
    const request = Object.freeze({
      actorDid,
      fields: Object.freeze(["diagnostic-event"]),
      operation: "logger-write",
      purpose: "renderer-diagnostic-write",
      senderId: Number.isSafeInteger(event.sender?.id) ? event.sender.id : null,
      tenantId,
    });
    if (authorizePurpose) {
      let decision;
      try {
        decision = await authorizePurpose(request);
      } catch {
        throw authorizationError();
      }
      if (decision !== true && decision?.authorized !== true) {
        throw authorizationError();
      }
    }
    return request;
  };
}

function registerLoggerIPC({
  ipcMain: injectedIpcMain,
  logger = defaultLogger,
  mainWindow,
  didManager,
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
  authorization: injectedAuthorization,
} = {}) {
  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  const authorize =
    injectedAuthorization ||
    createAuthorization({
      getMainWindow: getMainWindow || (() => mainWindow || null),
      getCurrentIdentity:
        getCurrentIdentity ||
        (() => didManager?.getCurrentIdentity?.() || null),
      authorizePurpose,
    });

  ipcMain.handle("logger:write", async (event, ...args) => {
    await authorize(event);
    try {
      if (args.length !== 1) {
        throw new TypeError("Invalid logger input count");
      }
      const entry = normalizeLogEntry(args[0]);
      const childLogger = logger.child(entry.module || "renderer");
      if (entry.level === "DEBUG") {
        childLogger.debug(entry.message, entry.data);
      } else if (entry.level === "INFO") {
        childLogger.info(entry.message, entry.data);
      } else if (entry.level === "WARN") {
        childLogger.warn(entry.message, entry.data);
      } else {
        childLogger.error(entry.message, {
          ...entry.data,
          ...(entry.stack ? { stack: entry.stack } : {}),
        });
      }
      return Object.freeze({ success: true });
    } catch {
      logger.warn("[Logger IPC] renderer diagnostic rejected");
      return Object.freeze({
        success: false,
        error: "Renderer diagnostic rejected",
        code: "CC_LOGGER_IPC_WRITE_REJECTED",
      });
    }
  });

  logger.info("[Logger IPC] renderer diagnostic sink registered");
}

module.exports = {
  createAuthorization,
  normalizeLogEntry,
  registerLoggerIPC,
};
