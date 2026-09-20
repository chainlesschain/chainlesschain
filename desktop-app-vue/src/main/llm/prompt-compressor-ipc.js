"use strict";

/**
 * Authorized, actor-scoped Prompt Compressor IPC boundary.
 * Renderer messages and compressor results cross this module as bounded
 * plain data. Configuration and history are isolated by authenticated DID.
 */

const { types } = require("node:util");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  resolveDesktopContextMemoryCutover,
} = require("../context-memory/authority.js");
const {
  createLlmCoreIpcAuthorization,
} = require("./llm-core-ipc-authorization");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const { PromptCompressor, estimateTokens } = require("./prompt-compressor");

const MAX_HISTORY_SIZE = 100;
const MAX_ACTORS = 128;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_TOTAL_MESSAGE_BYTES = 256 * 1024;
const MAX_TOTAL_TOKENS = 1_000_000;
const MAX_TOKEN_VALUE = 1_000_000_000;
const MAX_PROCESSING_TIME = 3_600_000;
const MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);
const STRATEGIES = new Set([
  "none",
  "deduplication",
  "truncation",
  "summarization",
]);
const PRIORITIES = new Set(["low", "medium", "high"]);
const RECOMMENDATION_ACTIONS = new Set([
  "none",
  "truncate",
  "deduplicate",
  "summarize",
  "consolidate_system",
]);
const CONFIG_KEYS = new Set([
  "enableDeduplication",
  "enableSummarization",
  "enableTruncation",
  "maxHistoryMessages",
  "maxTotalTokens",
  "similarityThreshold",
]);
const MESSAGE_KEYS = new Set(["role", "content"]);
const COMPRESS_KEYS = new Set([
  "messages",
  "preserveSystemMessage",
  "preserveLastUserMessage",
]);
const PREVIEW_KEYS = new Set(["messages"]);
const ESTIMATE_KEYS = new Set(["content"]);
const RECOMMENDATION_KEYS = new Set(["messages", "targetTokens"]);
const HISTORY_KEYS = new Set(["limit"]);

const COMPRESSOR_CHANNEL_OPERATIONS = Object.freeze({
  "compressor:get-config": "compressor-get-config",
  "compressor:set-config": "compressor-set-config",
  "compressor:reset-config": "compressor-reset-config",
  "compressor:compress": "compressor-compress",
  "compressor:preview": "compressor-preview",
  "compressor:estimate-tokens": "compressor-estimate-tokens",
  "compressor:get-recommendations": "compressor-get-recommendations",
  "compressor:get-stats": "compressor-get-stats",
  "compressor:get-history": "compressor-get-history",
  "compressor:clear-history": "compressor-clear-history",
});
const COMPRESSOR_CHANNELS = Object.freeze(
  Object.keys(COMPRESSOR_CHANNEL_OPERATIONS),
);

let compressorInstance = null;
const legacyCompressionHistory = [];

function ownData(source, key) {
  if (
    !source ||
    types.isProxy(source) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(source))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function authorizedActor(request) {
  const actorDid = ownData(request, "actorDid");
  if (
    typeof actorDid !== "string" ||
    actorDid.length < 1 ||
    actorDid.length > 512 ||
    /\p{Cc}/u.test(actorDid)
  ) {
    throw new TypeError("Invalid compressor actor");
  }
  return actorDid;
}

function descriptorsFor(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid compressor input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid compressor field");
    }
  }
  return descriptors;
}

function boundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError("Invalid compressor integer");
  }
  return value;
}

function boundedNumber(value, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError("Invalid compressor number");
  }
  return value;
}

function boundedBoolean(value, fallback) {
  const normalized = value ?? fallback;
  if (typeof normalized !== "boolean") {
    throw new TypeError("Invalid compressor flag");
  }
  return normalized;
}

function boundedText(value, maximumBytes) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\u0000")
  ) {
    throw new TypeError("Invalid compressor text");
  }
  return value;
}

function normalizeMessages(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_MESSAGES
  ) {
    throw new TypeError("Invalid compressor messages");
  }
  const arrayDescriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = arrayDescriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Invalid compressor message slot");
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key))
    ) {
      throw new TypeError("Invalid compressor message array");
    }
  }

  let totalBytes = 0;
  const messages = value.map((_item, index) => {
    const descriptors = descriptorsFor(
      arrayDescriptors[index].value,
      MESSAGE_KEYS,
    );
    const role = descriptors.role?.value;
    if (!MESSAGE_ROLES.has(role)) {
      throw new TypeError("Invalid compressor role");
    }
    const content = boundedText(descriptors.content?.value, MAX_MESSAGE_BYTES);
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_TOTAL_MESSAGE_BYTES) {
      throw new TypeError("Compressor messages exceed byte budget");
    }
    return Object.freeze({ role, content });
  });
  return Object.freeze(messages);
}

function projectMessages(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_MESSAGES
  ) {
    throw new TypeError("Invalid compressor result messages");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let totalBytes = 0;
  const messages = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = descriptors[index]?.value;
    const role = ownData(item, "role");
    if (!MESSAGE_ROLES.has(role)) {
      throw new TypeError("Invalid compressor result role");
    }
    const content = boundedText(ownData(item, "content"), MAX_MESSAGE_BYTES);
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_TOTAL_MESSAGE_BYTES) {
      throw new TypeError("Compressor result exceeds byte budget");
    }
    messages.push(Object.freeze({ role, content }));
  }
  return Object.freeze(messages);
}

function normalizeConfig(value, { requireField = true } = {}) {
  const descriptors = descriptorsFor(value, CONFIG_KEYS);
  if (requireField && Object.keys(descriptors).length === 0) {
    throw new TypeError("Empty compressor config");
  }
  const config = {};
  for (const key of [
    "enableDeduplication",
    "enableSummarization",
    "enableTruncation",
  ]) {
    if (descriptors[key]) {
      config[key] = boundedBoolean(descriptors[key].value);
      if (key === "enableSummarization" && config[key]) {
        throw new TypeError("Standalone summarization is unavailable");
      }
    }
  }
  if (descriptors.maxHistoryMessages) {
    config.maxHistoryMessages = boundedInteger(
      descriptors.maxHistoryMessages.value,
      1,
      MAX_MESSAGES,
    );
  }
  if (descriptors.maxTotalTokens) {
    config.maxTotalTokens = boundedInteger(
      descriptors.maxTotalTokens.value,
      1,
      MAX_TOTAL_TOKENS,
    );
  }
  if (descriptors.similarityThreshold) {
    config.similarityThreshold = boundedNumber(
      descriptors.similarityThreshold.value,
      0,
      1,
    );
  }
  return Object.freeze(config);
}

function projectConfig(stats) {
  const strategies = ownData(stats, "strategies");
  const config = ownData(stats, "config");
  return Object.freeze({
    enabled: boundedBoolean(ownData(stats, "enabled"), true),
    strategies: Object.freeze({
      deduplication: boundedBoolean(ownData(strategies, "deduplication")),
      summarization: boundedBoolean(ownData(strategies, "summarization")),
      truncation: boundedBoolean(ownData(strategies, "truncation")),
    }),
    config: Object.freeze({
      maxHistoryMessages: boundedInteger(
        ownData(config, "maxHistoryMessages"),
        1,
        MAX_MESSAGES,
      ),
      maxTotalTokens: boundedInteger(
        ownData(config, "maxTotalTokens"),
        1,
        MAX_TOTAL_TOKENS,
      ),
      similarityThreshold: boundedNumber(
        ownData(config, "similarityThreshold"),
        0,
        1,
      ),
    }),
  });
}

function projectStrategy(value) {
  if (value === "none") {
    return "none";
  }
  if (typeof value !== "string" || value.length > 64) {
    throw new TypeError("Invalid compression strategy");
  }
  const parts = value.split("+");
  if (
    parts.length < 1 ||
    parts.length > 3 ||
    parts.some((part) => part === "none" || !STRATEGIES.has(part)) ||
    new Set(parts).size !== parts.length
  ) {
    throw new TypeError("Invalid compression strategy");
  }
  return parts.join("+");
}

function projectCompressionResult(result) {
  const originalTokens = boundedInteger(
    ownData(result, "originalTokens"),
    0,
    MAX_TOKEN_VALUE,
  );
  const compressedTokens = boundedInteger(
    ownData(result, "compressedTokens"),
    0,
    MAX_TOKEN_VALUE,
  );
  return Object.freeze({
    messages: projectMessages(ownData(result, "messages")),
    originalTokens,
    compressedTokens,
    compressionRatio: boundedNumber(ownData(result, "compressionRatio"), 0, 10),
    strategy: projectStrategy(ownData(result, "strategy")),
    tokensSaved: boundedInteger(
      ownData(result, "tokensSaved") ?? originalTokens - compressedTokens,
      -MAX_TOKEN_VALUE,
      MAX_TOKEN_VALUE,
    ),
    processingTime: boundedInteger(
      ownData(result, "processingTime"),
      0,
      MAX_PROCESSING_TIME,
    ),
  });
}

function historyRecord(result, timestamp = Date.now()) {
  return Object.freeze({
    timestamp: boundedInteger(timestamp, 0, 8_640_000_000_000_000),
    originalTokens: result.originalTokens,
    compressedTokens: result.compressedTokens,
    compressionRatio: result.compressionRatio,
    strategy: result.strategy,
    tokensSaved: result.tokensSaved,
    processingTime: result.processingTime,
  });
}

function calculateCompressionStats(history = legacyCompressionHistory) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) {
    return Object.freeze({
      totalCompressions: 0,
      totalTokensSaved: 0,
      averageCompressionRatio: 1,
      averageProcessingTime: 0,
      strategyDistribution: Object.freeze({}),
      recentCompressions: Object.freeze([]),
    });
  }
  const totalTokensSaved = safeHistory.reduce(
    (sum, item) => sum + item.tokensSaved,
    0,
  );
  const totalOriginalTokens = safeHistory.reduce(
    (sum, item) => sum + item.originalTokens,
    0,
  );
  const totalCompressedTokens = safeHistory.reduce(
    (sum, item) => sum + item.compressedTokens,
    0,
  );
  const totalProcessingTime = safeHistory.reduce(
    (sum, item) => sum + item.processingTime,
    0,
  );
  const strategyDistribution = {};
  for (const item of safeHistory) {
    for (const strategy of item.strategy.split("+")) {
      strategyDistribution[strategy] =
        (strategyDistribution[strategy] || 0) + 1;
    }
  }
  return Object.freeze({
    totalCompressions: safeHistory.length,
    totalTokensSaved,
    averageCompressionRatio:
      totalOriginalTokens > 0 ? totalCompressedTokens / totalOriginalTokens : 1,
    averageProcessingTime: Math.round(totalProcessingTime / safeHistory.length),
    strategyDistribution: Object.freeze({ ...strategyDistribution }),
    recentCompressions: Object.freeze(safeHistory.slice(-10).reverse()),
  });
}

function getOrCreateCompressor(options = {}) {
  if (!compressorInstance) {
    compressorInstance = new PromptCompressor(options);
  }
  return compressorInstance;
}

function fixedFailure(privacy, operation) {
  privacy.failure(operation);
  return Object.freeze({
    success: false,
    error: "LLM IPC operation failed",
    code: "CC_LLM_IPC_OPERATION_FAILED",
  });
}

function legacyFence(replacement) {
  return Object.freeze({
    success: false,
    error: "Legacy Desktop Context/Memory writer is fenced",
    code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
    replacement,
  });
}

function registerPromptCompressorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  llmManager,
  compressor: injectedCompressor,
  compressorFactory,
  mainWindow,
  didManager,
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
  coreAuthorization: injectedAuthorization,
  compressorPrivacy,
} = {}) {
  const privacy = compressorPrivacy || createLlmIpcPrivacy("compressor");
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  if (ipcGuard.isModuleRegistered("prompt-compressor-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  const authorization =
    injectedAuthorization ||
    createLlmCoreIpcAuthorization({
      getMainWindow: getMainWindow || (() => mainWindow || null),
      getCurrentIdentity:
        getCurrentIdentity ||
        (() => didManager?.getCurrentIdentity?.() || null),
      authorizePurpose,
    });
  const compressors = new Map();
  const histories = new Map();
  const actors = new Set();
  let injectedOwner = null;

  const registerActor = (actorDid) => {
    if (!actors.has(actorDid)) {
      if (actors.size >= MAX_ACTORS) {
        throw new TypeError("Compressor actor limit reached");
      }
      actors.add(actorDid);
    }
  };

  const compressorFor = (actorDid) => {
    registerActor(actorDid);
    if (compressors.has(actorDid)) {
      return compressors.get(actorDid);
    }
    let compressor;
    if (typeof compressorFactory === "function") {
      compressor = compressorFactory({ actorDid, llmManager });
    } else if (injectedCompressor) {
      if (injectedOwner && injectedOwner !== actorDid) {
        throw new TypeError("Injected compressor already has an owner");
      }
      injectedOwner = actorDid;
      compressor = injectedCompressor;
    } else {
      compressor = new PromptCompressor();
    }
    if (!compressor || typeof compressor !== "object") {
      throw new TypeError("Prompt compressor unavailable");
    }
    compressors.set(actorDid, compressor);
    return compressor;
  };
  const historyFor = (actorDid) => {
    registerActor(actorDid);
    if (!histories.has(actorDid)) {
      histories.set(actorDid, []);
    }
    return histories.get(actorDid);
  };
  const legacyWritable = (actorDid) =>
    resolveDesktopContextMemoryCutover({
      scopeKey: `desktop:prompt-compressor-ipc:${actorDid}`,
    }).legacyWritable;
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = COMPRESSOR_CHANNEL_OPERATIONS[channel];
      ipcMain.handle(channel, async (event, ...args) => {
        let actorDid;
        try {
          actorDid = authorizedActor(
            await authorization.authorize(event, operation),
          );
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, actorDid, operation, ...args);
      });
    },
  };

  privacy.event("handlers-registering");

  authorizedIpcMain.handle(
    "compressor:get-config",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected arguments");
        }
        return Object.freeze({
          success: true,
          config: projectConfig(compressorFor(actorDid).getStats()),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:set-config",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid argument count");
        }
        if (!legacyWritable(actorDid)) {
          return legacyFence("coding-agent:app-server-context-plan");
        }
        const config = normalizeConfig(args[0]);
        const compressor = compressorFor(actorDid);
        compressor.updateConfig(config);
        return Object.freeze({
          success: true,
          config: projectConfig(compressor.getStats()),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:reset-config",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected arguments");
        }
        if (!legacyWritable(actorDid)) {
          return legacyFence("coding-agent:app-server-context-plan");
        }
        const compressor = compressorFor(actorDid);
        compressor.updateConfig({
          enableDeduplication: true,
          enableSummarization: false,
          enableTruncation: true,
          maxHistoryMessages: 10,
          maxTotalTokens: 4000,
          similarityThreshold: 0.9,
        });
        return Object.freeze({
          success: true,
          config: projectConfig(compressor.getStats()),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:compress",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid argument count");
        }
        if (!legacyWritable(actorDid)) {
          return legacyFence("coding-agent:app-server-context-compact");
        }
        const descriptors = descriptorsFor(args[0], COMPRESS_KEYS);
        const messages = normalizeMessages(descriptors.messages?.value);
        const compressor = compressorFor(actorDid);
        if (projectConfig(compressor.getStats()).strategies.summarization) {
          throw new TypeError("Standalone summarization is unavailable");
        }
        const result = projectCompressionResult(
          await compressor.compress(messages, {
            preserveSystemMessage: boundedBoolean(
              descriptors.preserveSystemMessage?.value,
              true,
            ),
            preserveLastUserMessage: boundedBoolean(
              descriptors.preserveLastUserMessage?.value,
              true,
            ),
          }),
        );
        const history = historyFor(actorDid);
        history.push(historyRecord(result));
        if (history.length > MAX_HISTORY_SIZE) {
          history.splice(0, history.length - MAX_HISTORY_SIZE);
        }
        return Object.freeze({ success: true, ...result });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:preview",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid argument count");
        }
        const descriptors = descriptorsFor(args[0], PREVIEW_KEYS);
        const messages = normalizeMessages(descriptors.messages?.value);
        const originalTokens = messages.reduce(
          (sum, message) => sum + estimateTokens(message.content),
          0,
        );
        const stats = projectConfig(compressorFor(actorDid).getStats());
        let estimatedTokens = originalTokens;
        const applicableStrategies = [];
        if (stats.strategies.deduplication && messages.length > 2) {
          estimatedTokens *= 0.85;
          applicableStrategies.push("deduplication");
        }
        if (
          stats.strategies.truncation &&
          messages.length > stats.config.maxHistoryMessages
        ) {
          estimatedTokens *= stats.config.maxHistoryMessages / messages.length;
          applicableStrategies.push("truncation");
        }
        if (
          stats.strategies.summarization &&
          estimatedTokens > stats.config.maxTotalTokens
        ) {
          estimatedTokens = stats.config.maxTotalTokens * 0.7;
          applicableStrategies.push("summarization");
        }
        const estimatedCompressedTokens = Math.round(estimatedTokens);
        const estimatedCompressionRatio =
          originalTokens > 0 ? estimatedTokens / originalTokens : 1;
        return Object.freeze({
          success: true,
          preview: Object.freeze({
            originalTokens,
            estimatedCompressedTokens,
            estimatedCompressionRatio,
            estimatedTokensSaved: Math.round(originalTokens - estimatedTokens),
            applicableStrategies: Object.freeze(applicableStrategies),
            recommendation:
              estimatedCompressionRatio < 0.8
                ? "recommended"
                : estimatedCompressionRatio < 0.95
                  ? "moderate"
                  : "not-needed",
          }),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:estimate-tokens",
    async (_event, _actorDid, operation, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid argument count");
        }
        const descriptors = descriptorsFor(args[0], ESTIMATE_KEYS);
        const content = descriptors.content?.value;
        if (Array.isArray(content)) {
          const messages = normalizeMessages(content);
          const breakdown = messages.map((message, index) =>
            Object.freeze({
              index,
              role: message.role,
              tokens: estimateTokens(message.content),
              charCount: message.content.length,
            }),
          );
          return Object.freeze({
            success: true,
            tokens: breakdown.reduce((sum, item) => sum + item.tokens, 0),
            breakdown: Object.freeze(breakdown),
          });
        }
        const text = boundedText(content, MAX_TOTAL_MESSAGE_BYTES);
        return Object.freeze({
          success: true,
          tokens: estimateTokens(text),
          charCount: text.length,
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:get-recommendations",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid argument count");
        }
        const descriptors = descriptorsFor(args[0], RECOMMENDATION_KEYS);
        const messages = normalizeMessages(descriptors.messages?.value);
        const currentTokens = messages.reduce(
          (sum, message) => sum + estimateTokens(message.content),
          0,
        );
        const targetTokens = descriptors.targetTokens
          ? boundedInteger(descriptors.targetTokens.value, 1, MAX_TOTAL_TOKENS)
          : projectConfig(compressorFor(actorDid).getStats()).config
              .maxTotalTokens;
        const recommendations = [];
        if (currentTokens <= targetTokens) {
          recommendations.push({ action: "none", priority: "low" });
        } else {
          const tokensToReduce = currentTokens - targetTokens;
          const reductionRatio = tokensToReduce / currentTokens;
          if (messages.length > 5) {
            const average = currentTokens / messages.length;
            const remove = Math.ceil(tokensToReduce / average);
            recommendations.push({
              action: "truncate",
              priority: reductionRatio > 0.5 ? "high" : "medium",
              estimatedSavings: Math.round(remove * average),
            });
          }
          const unique = new Set();
          let duplicateCount = 0;
          for (const message of messages) {
            if (unique.has(message.content)) {
              duplicateCount += 1;
            } else {
              unique.add(message.content);
            }
          }
          if (duplicateCount > 0) {
            recommendations.push({
              action: "deduplicate",
              priority: "high",
              estimatedSavings: Math.round(
                (duplicateCount / messages.length) * currentTokens,
              ),
            });
          }
          if (currentTokens > targetTokens * 2) {
            recommendations.push({
              action: "summarize",
              priority: "medium",
              estimatedSavings: Math.round(currentTokens * 0.6),
              requiresLLM: true,
            });
          }
          const systemMessages = messages.filter(
            (message) => message.role === "system",
          );
          if (systemMessages.length > 1) {
            const extraTokens = systemMessages
              .slice(1)
              .reduce(
                (sum, message) => sum + estimateTokens(message.content),
                0,
              );
            recommendations.push({
              action: "consolidate_system",
              priority: "low",
              estimatedSavings: Math.round(extraTokens * 0.5),
            });
          }
          const priority = { high: 0, medium: 1, low: 2 };
          recommendations.sort(
            (left, right) => priority[left.priority] - priority[right.priority],
          );
        }
        const projected = recommendations.slice(0, 4).map((item) => {
          if (
            !RECOMMENDATION_ACTIONS.has(item.action) ||
            !PRIORITIES.has(item.priority)
          ) {
            throw new TypeError("Invalid recommendation");
          }
          const result = { action: item.action, priority: item.priority };
          if (item.estimatedSavings !== undefined) {
            result.estimatedSavings = boundedInteger(
              item.estimatedSavings,
              0,
              MAX_TOKEN_VALUE,
            );
          }
          if (item.requiresLLM === true) {
            result.requiresLLM = true;
          }
          return Object.freeze(result);
        });
        return Object.freeze({
          success: true,
          currentTokens,
          targetTokens,
          tokensToReduce: Math.max(0, currentTokens - targetTokens),
          recommendations: Object.freeze(projected),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:get-stats",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected arguments");
        }
        return Object.freeze({
          success: true,
          stats: calculateCompressionStats(historyFor(actorDid)),
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:get-history",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid argument count");
        }
        const descriptors = descriptorsFor(args[0] ?? {}, HISTORY_KEYS);
        const limit = descriptors.limit
          ? boundedInteger(descriptors.limit.value, 1, MAX_HISTORY_SIZE)
          : 20;
        const history = historyFor(actorDid);
        return Object.freeze({
          success: true,
          history: Object.freeze(history.slice(-limit).reverse()),
          totalCount: history.length,
        });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  authorizedIpcMain.handle(
    "compressor:clear-history",
    async (_event, actorDid, operation, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected arguments");
        }
        const history = historyFor(actorDid);
        const clearedCount = history.length;
        history.length = 0;
        return Object.freeze({ success: true, clearedCount });
      } catch {
        return fixedFailure(privacy, operation);
      }
    },
  );

  ipcGuard.markModuleRegistered("prompt-compressor-ipc");
  privacy.event("handlers-registered");
}

function unregisterPromptCompressorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  if (!ipcGuard.isModuleRegistered("prompt-compressor-ipc")) {
    return;
  }
  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  for (const channel of COMPRESSOR_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  ipcGuard.unmarkModuleRegistered("prompt-compressor-ipc");
  createLlmIpcPrivacy("compressor").event("handlers-unregistered");
}

module.exports = {
  COMPRESSOR_CHANNELS,
  calculateCompressionStats,
  getOrCreateCompressor,
  registerPromptCompressorIPC,
  unregisterPromptCompressorIPC,
};
