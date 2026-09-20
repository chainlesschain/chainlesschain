"use strict";

const { types } = require("node:util");
const FollowupIntentClassifier = require("./followup-intent-classifier");
const { getLogger } = require("../logging/logger");
const {
  createLlmCoreIpcAuthorization,
} = require("../llm/llm-core-ipc-authorization");

const logger = getLogger("FollowupIntentIPC");
const INTENTS = new Set([
  "CONTINUE_EXECUTION",
  "MODIFY_REQUIREMENT",
  "CLARIFICATION",
  "CANCEL_TASK",
]);
const METHODS = new Set([
  "rule",
  "llm",
  "rule_fallback",
  "default",
  "error_fallback",
]);
const ROLES = new Set(["system", "user", "assistant"]);
const CLASSIFY_KEYS = new Set(["input", "context"]);
const BATCH_KEYS = new Set(["inputs", "context"]);
const CONTEXT_KEYS = new Set([
  "currentTask",
  "taskPlan",
  "conversationHistory",
]);
const HISTORY_KEYS = new Set(["role", "content"]);
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CHANNEL_OPERATIONS = Object.freeze({
  "followup-intent:classify": "followup-intent-classify",
  "followup-intent:classify-batch": "followup-intent-classify-batch",
  "followup-intent:get-stats": "followup-intent-get-stats",
});
const MAX_INPUT_BYTES = 8 * 1024;
const MAX_BATCH_SIZE = 32;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_NODES = 512;
const MAX_COLLECTION_SIZE = 100;
const MAX_CONTEXT_STRING_BYTES = 8 * 1024;

let classifierInstance = null;

function fixedFailure() {
  return Object.freeze({
    success: false,
    error: "Follow-up intent classification failed",
    code: "CC_FOLLOWUP_INTENT_OPERATION_FAILED",
  });
}

function fixedFallback() {
  return Object.freeze({
    ...fixedFailure(),
    data: Object.freeze({
      intent: "CLARIFICATION",
      confidence: 0.5,
      reason: "Classification unavailable",
      method: "error_fallback",
      latency: 0,
    }),
  });
}

function boundedText(value, maximumBytes, { optional = false } = {}) {
  if (optional && value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\u0000")
  ) {
    throw new TypeError("Invalid follow-up intent text");
  }
  return value;
}

function plainDescriptors(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid follow-up intent object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      (allowedKeys && !allowedKeys.has(key)) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid follow-up intent field");
    }
  }
  return descriptors;
}

function ownData(value, key) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function arrayDescriptors(value, maximumLength) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximumLength
  ) {
    throw new TypeError("Invalid follow-up intent array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(descriptors[index] || {}, "value")) {
      throw new TypeError("Invalid follow-up intent array slot");
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key))
    ) {
      throw new TypeError("Invalid follow-up intent array field");
    }
  }
  return descriptors;
}

function normalizeContext(value = {}) {
  const state = { bytes: 0, nodes: 0 };
  const visit = (current, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_CONTEXT_NODES || depth > MAX_CONTEXT_DEPTH) {
      throw new TypeError("Follow-up intent context exceeds structural limits");
    }
    if (current === null || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("Invalid follow-up intent context number");
      }
      return current;
    }
    if (typeof current === "string") {
      const text = boundedText(current, MAX_CONTEXT_STRING_BYTES);
      state.bytes += Buffer.byteLength(text, "utf8");
      if (state.bytes > MAX_CONTEXT_BYTES) {
        throw new TypeError("Follow-up intent context exceeds byte budget");
      }
      return text;
    }
    if (Array.isArray(current)) {
      const descriptors = arrayDescriptors(current, MAX_COLLECTION_SIZE);
      return Object.freeze(
        current.map((_item, index) =>
          visit(descriptors[index].value, depth + 1),
        ),
      );
    }
    const descriptors = plainDescriptors(current);
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_COLLECTION_SIZE) {
      throw new TypeError("Follow-up intent context has too many fields");
    }
    const result = Object.create(null);
    for (const key of keys) {
      boundedText(key, 128);
      if (BLOCKED_KEYS.has(key)) {
        throw new TypeError("Invalid follow-up intent context key");
      }
      state.bytes += Buffer.byteLength(key, "utf8");
      if (state.bytes > MAX_CONTEXT_BYTES) {
        throw new TypeError("Follow-up intent context exceeds byte budget");
      }
      result[key] = visit(descriptors[key].value, depth + 1);
    }
    return Object.freeze(result);
  };

  const descriptors = plainDescriptors(value, CONTEXT_KEYS);
  const context = {};
  if (descriptors.currentTask) {
    const task = visit(descriptors.currentTask.value, 1);
    if (!task || Array.isArray(task) || typeof task !== "object") {
      throw new TypeError("Invalid current task context");
    }
    context.currentTask = task;
  }
  if (descriptors.taskPlan) {
    const taskPlan = visit(descriptors.taskPlan.value, 1);
    if (!taskPlan || Array.isArray(taskPlan) || typeof taskPlan !== "object") {
      throw new TypeError("Invalid task plan context");
    }
    context.taskPlan = taskPlan;
  }
  if (descriptors.conversationHistory) {
    const history = descriptors.conversationHistory.value;
    const entries = arrayDescriptors(history, 5);
    context.conversationHistory = Object.freeze(
      history.map((_entry, index) => {
        const fields = plainDescriptors(entries[index].value, HISTORY_KEYS);
        const role = fields.role?.value;
        if (!ROLES.has(role)) {
          throw new TypeError("Invalid conversation role");
        }
        const content = boundedText(fields.content?.value, 4 * 1024);
        state.bytes += Buffer.byteLength(content, "utf8");
        if (state.bytes > MAX_CONTEXT_BYTES) {
          throw new TypeError("Follow-up intent context exceeds byte budget");
        }
        return Object.freeze({ role, content });
      }),
    );
  }
  return Object.freeze(context);
}

function normalizeClassifyRequest(value) {
  const descriptors = plainDescriptors(value, CLASSIFY_KEYS);
  return Object.freeze({
    input: boundedText(descriptors.input?.value, MAX_INPUT_BYTES),
    context: normalizeContext(descriptors.context?.value ?? {}),
  });
}

function normalizeBatchRequest(value) {
  const descriptors = plainDescriptors(value, BATCH_KEYS);
  const inputs = descriptors.inputs?.value;
  const entries = arrayDescriptors(inputs, MAX_BATCH_SIZE);
  let totalBytes = 0;
  const normalizedInputs = inputs.map((_input, index) => {
    const input = boundedText(entries[index].value, MAX_INPUT_BYTES);
    totalBytes += Buffer.byteLength(input, "utf8");
    if (totalBytes > MAX_BATCH_BYTES) {
      throw new TypeError("Follow-up intent batch exceeds byte budget");
    }
    return input;
  });
  return Object.freeze({
    inputs: Object.freeze(normalizedInputs),
    context: normalizeContext(descriptors.context?.value ?? {}),
  });
}

function boundedNumber(value, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError("Invalid follow-up intent result number");
  }
  return value;
}

function projectResult(value) {
  const intent = ownData(value, "intent");
  const method = ownData(value, "method");
  if (!INTENTS.has(intent) || !METHODS.has(method)) {
    throw new TypeError("Invalid follow-up intent result");
  }
  const result = {
    intent,
    confidence: boundedNumber(ownData(value, "confidence"), 0, 1),
    reason: boundedText(ownData(value, "reason"), 2 * 1024),
    method,
    latency: boundedNumber(ownData(value, "latency") ?? 0, 0, 3_600_000),
  };
  const extractedValue = ownData(value, "extractedInfo");
  if (extractedValue !== undefined && extractedValue !== null) {
    result.extractedInfo = boundedText(extractedValue, 4 * 1024);
  }
  return Object.freeze(result);
}

function projectStats(value) {
  const count = (candidate) => {
    if (
      !Number.isSafeInteger(candidate) ||
      candidate < 0 ||
      candidate > 10_000
    ) {
      throw new TypeError("Invalid follow-up intent statistics");
    }
    return candidate;
  };
  return Object.freeze({
    rulesCount: count(ownData(value, "rulesCount")),
    keywordsCount: count(ownData(value, "keywordsCount")),
    patternsCount: count(ownData(value, "patternsCount")),
  });
}

function initializeClassifier(llmService) {
  if (!classifierInstance) {
    classifierInstance = new FollowupIntentClassifier(llmService);
    logger.info("[FollowupIntentIPC] classifier initialized");
  }
  return classifierInstance;
}

function registerIPCHandlers({
  ipcMain: injectedIpcMain,
  llmService,
  classifier: injectedClassifier,
  mainWindow,
  didManager,
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
  coreAuthorization: injectedAuthorization,
} = {}) {
  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  const classifier = injectedClassifier || initializeClassifier(llmService);
  const authorization =
    injectedAuthorization ||
    createLlmCoreIpcAuthorization({
      getMainWindow: getMainWindow || (() => mainWindow || null),
      getCurrentIdentity:
        getCurrentIdentity ||
        (() => didManager?.getCurrentIdentity?.() || null),
      authorizePurpose,
    });

  const handle = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      await authorization.authorize(event, CHANNEL_OPERATIONS[channel]);
      try {
        return await operation(...args);
      } catch {
        logger.error("[FollowupIntentIPC] operation failed");
        return channel === "followup-intent:classify"
          ? fixedFallback()
          : fixedFailure();
      }
    });
  };

  handle("followup-intent:classify", async (...args) => {
    if (args.length !== 1) {
      throw new TypeError("Invalid classify input count");
    }
    const request = normalizeClassifyRequest(args[0]);
    return Object.freeze({
      success: true,
      data: projectResult(
        await classifier.classify(request.input, request.context),
      ),
    });
  });

  handle("followup-intent:classify-batch", async (...args) => {
    if (args.length !== 1) {
      throw new TypeError("Invalid batch input count");
    }
    const request = normalizeBatchRequest(args[0]);
    const results = await classifier.classifyBatch(
      request.inputs,
      request.context,
    );
    if (!Array.isArray(results) || results.length !== request.inputs.length) {
      throw new TypeError("Invalid follow-up intent batch result");
    }
    return Object.freeze({
      success: true,
      data: Object.freeze(
        results.map((entry) => projectResult(ownData(entry, "result"))),
      ),
    });
  });

  handle("followup-intent:get-stats", async (...args) => {
    if (args.length !== 0) {
      throw new TypeError("Invalid stats input count");
    }
    return Object.freeze({
      success: true,
      data: projectStats(classifier.getStats()),
    });
  });

  logger.info("[FollowupIntentIPC] handlers registered");
}

function getClassifierInstance() {
  return classifierInstance;
}

module.exports = {
  getClassifierInstance,
  initializeClassifier,
  normalizeBatchRequest,
  normalizeClassifyRequest,
  projectResult,
  registerIPCHandlers,
};
