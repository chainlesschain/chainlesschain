/** Authorized IPC boundary for the process-wide LLM response cache. */

"use strict";

const { types } = require("node:util");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  createLlmCoreIpcAuthorization,
} = require("./llm-core-ipc-authorization");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

const CACHE_CHANNELS = Object.freeze([
  "cache:get-stats",
  "cache:get-stats-by-provider",
  "cache:get-hit-rate-trend",
  "cache:get-config",
  "cache:set-config",
  "cache:clear-all",
  "cache:clear-expired",
  "cache:check",
  "cache:warmup-status",
  "cache:start-auto-cleanup",
  "cache:stop-auto-cleanup",
]);
const CHANNEL_OPERATIONS = Object.freeze(
  Object.fromEntries(
    CACHE_CHANNELS.map((channel) => [
      channel,
      `response-cache-${channel.slice("cache:".length)}`,
    ]),
  ),
);
const CONFIG_KEYS = new Set(["enableAutoCleanup", "ttlDays", "maxSize"]);
const CHECK_KEYS = new Set(["provider", "model", "messages"]);
const MESSAGE_KEYS = new Set(["role", "content"]);
const MESSAGE_ROLES = new Set(["assistant", "system", "tool", "user"]);

let responseCacheInstance = null;

function setResponseCacheInstance(cache) {
  responseCacheInstance = cache;
}

function getResponseCacheInstance() {
  return responseCacheInstance;
}

function descriptorsFor(value, allowedKeys, label) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError(`Invalid ${label} field`);
    }
  }
  return descriptors;
}

function ownData(value, key) {
  try {
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
  } catch {
    return undefined;
  }
}

function strictArrayValues(value, maximum, label) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > maximum) {
    throw new TypeError(`Invalid ${label}`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(`Invalid ${label} field`);
    }
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[index];
    if (
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new TypeError(`Invalid ${label} entry`);
    }
    return descriptor.value;
  });
}

function projectedArrayValues(value, maximum) {
  try {
    if (!Array.isArray(value) || types.isProxy(value)) return [];
    const values = [];
    const length = Math.min(value.length, maximum);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      ) {
        values.push(descriptor.value);
      }
    }
    return values;
  } catch {
    return [];
  }
}

function boundedText(value, maximum, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function boundedContent(value, maximum) {
  const hasUnsafeControl =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        (codePoint < 32 && ![9, 10, 13].includes(codePoint)) ||
        (codePoint >= 127 && codePoint <= 159)
      );
    });
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    hasUnsafeControl
  ) {
    throw new TypeError("Invalid message content");
  }
  return value;
}

function safeCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : 0;
}

function safeNumber(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : 0;
}

function safeDecimal(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value === "number") return safeNumber(value, maximum);
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value)) return 0;
  return safeNumber(Number(value), maximum);
}

function normalizeConfig(value) {
  const descriptors = descriptorsFor(value, CONFIG_KEYS, "cache config");
  const normalized = {};
  if (descriptors.enableAutoCleanup) {
    if (typeof descriptors.enableAutoCleanup.value !== "boolean") {
      throw new TypeError("Invalid cache cleanup setting");
    }
    normalized.enableAutoCleanup = descriptors.enableAutoCleanup.value;
  }
  if (descriptors.ttlDays) {
    const ttlDays = descriptors.ttlDays.value;
    if (!Number.isSafeInteger(ttlDays) || ttlDays < 1 || ttlDays > 3_650) {
      throw new TypeError("Invalid cache TTL");
    }
    normalized.ttlDays = ttlDays;
  }
  if (descriptors.maxSize) {
    const maxSize = descriptors.maxSize.value;
    if (!Number.isSafeInteger(maxSize) || maxSize < 1 || maxSize > 100_000) {
      throw new TypeError("Invalid cache size");
    }
    normalized.maxSize = maxSize;
  }
  if (Object.keys(normalized).length === 0) {
    throw new TypeError("Cache config is empty");
  }
  return Object.freeze(normalized);
}

function normalizeMessages(value) {
  const messages = strictArrayValues(value, 200, "cache messages");
  let totalCharacters = 0;
  return Object.freeze(
    messages.map((message) => {
      const descriptors = descriptorsFor(
        message,
        MESSAGE_KEYS,
        "cache message",
      );
      const role = descriptors.role?.value;
      if (!MESSAGE_ROLES.has(role)) throw new TypeError("Invalid message role");
      const content = boundedContent(descriptors.content?.value, 65_536);
      totalCharacters += content.length;
      if (totalCharacters > 262_144) {
        throw new TypeError("Cache messages are too large");
      }
      return Object.freeze({ role, content });
    }),
  );
}

function normalizeCheck(value) {
  const descriptors = descriptorsFor(value, CHECK_KEYS, "cache check");
  return Object.freeze({
    provider: boundedText(descriptors.provider?.value, 128, "cache provider"),
    model: boundedText(descriptors.model?.value, 256, "cache model"),
    messages: normalizeMessages(descriptors.messages?.value),
  });
}

function projectConfig(cache) {
  const ttl = safeNumber(cache?.ttl, 3_650 * 24 * 60 * 60 * 1_000);
  const cleanupInterval = safeNumber(
    cache?.cleanupInterval,
    365 * 24 * 60 * 60 * 1_000,
  );
  return Object.freeze({
    ttl,
    ttlDays: ttl / (24 * 60 * 60 * 1_000),
    maxSize: safeCount(cache?.maxSize, 100_000),
    enableAutoCleanup: cache?.enableAutoCleanup === true,
    cleanupInterval,
    cleanupIntervalMinutes: cleanupInterval / (60 * 1_000),
  });
}

function projectStats(value) {
  const runtime = ownData(value, "runtime");
  const database = ownData(value, "database");
  const config = ownData(value, "config");
  return Object.freeze({
    runtime: Object.freeze({
      hits: safeCount(ownData(runtime, "hits")),
      misses: safeCount(ownData(runtime, "misses")),
      sets: safeCount(ownData(runtime, "sets")),
      evictions: safeCount(ownData(runtime, "evictions")),
      expirations: safeCount(ownData(runtime, "expirations")),
    }),
    database: Object.freeze({
      totalEntries: safeCount(ownData(database, "totalEntries")),
      expiredEntries: safeCount(ownData(database, "expiredEntries")),
      totalHits: safeCount(ownData(database, "totalHits")),
      totalTokensSaved: safeCount(ownData(database, "totalTokensSaved")),
      avgHitsPerEntry: safeDecimal(ownData(database, "avgHitsPerEntry")),
    }),
    config: Object.freeze({
      maxSize: safeCount(ownData(config, "maxSize"), 100_000),
      ttlDays: safeNumber(ownData(config, "ttlDays"), 3_650),
      autoCleanup: ownData(config, "autoCleanup") === true,
    }),
  });
}

function projectProviders(value) {
  return Object.freeze(
    projectedArrayValues(value, 100)
      .map((entry) => {
        const provider = ownData(entry, "provider");
        if (
          typeof provider !== "string" ||
          provider.length < 1 ||
          provider.length > 128 ||
          /\p{Cc}/u.test(provider)
        ) {
          return null;
        }
        return Object.freeze({
          provider,
          entries: safeCount(ownData(entry, "entries")),
          hits: safeCount(ownData(entry, "hits")),
          tokensSaved: safeCount(ownData(entry, "tokensSaved")),
        });
      })
      .filter(Boolean),
  );
}

function fixedFailure() {
  return Object.freeze({
    success: false,
    error: "Response cache operation failed",
    code: "CC_LLM_RESPONSE_CACHE_OPERATION_FAILED",
  });
}

function fixedUnavailable() {
  return Object.freeze({
    success: false,
    error: "Response cache unavailable",
    code: "CC_LLM_RESPONSE_CACHE_UNAVAILABLE",
  });
}

function registerResponseCacheIPC(dependencies = {}) {
  const ipcGuard = dependencies.ipcGuard || defaultIpcGuard;
  const privacy =
    dependencies.privacy ||
    createLlmIpcPrivacy("response-cache", dependencies.logger);
  if (ipcGuard.isModuleRegistered("response-cache-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const electron = dependencies.ipcMain ? null : require("electron");
  const ipcMain = dependencies.ipcMain || electron.ipcMain;
  if (Object.hasOwn(dependencies, "responseCache")) {
    setResponseCacheInstance(dependencies.responseCache || null);
  }
  const authorization =
    dependencies.coreAuthorization ||
    createLlmCoreIpcAuthorization({
      getMainWindow: dependencies.getMainWindow,
      getCurrentIdentity: dependencies.getCurrentIdentity,
      authorizePurpose: dependencies.authorizePurpose,
    });

  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = CHANNEL_OPERATIONS[channel];
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          await authorization.authorize(event, operation);
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        const cache = getResponseCacheInstance();
        if (!cache) return fixedUnavailable();
        try {
          return await handler(cache, ...args);
        } catch {
          privacy.failure(operation);
          return fixedFailure();
        }
      });
    },
  };

  authorizedIpcMain.handle("cache:get-stats", async (cache, ...args) => {
    if (args.length !== 0) throw new TypeError("Invalid cache input count");
    return Object.freeze({
      success: true,
      stats: projectStats(await cache.getStats()),
    });
  });

  authorizedIpcMain.handle(
    "cache:get-stats-by-provider",
    async (cache, ...args) => {
      if (args.length !== 0) throw new TypeError("Invalid cache input count");
      return Object.freeze({
        success: true,
        providers: projectProviders(await cache.getStatsByProvider()),
      });
    },
  );

  authorizedIpcMain.handle(
    "cache:get-hit-rate-trend",
    async (cache, ...args) => {
      if (args.length !== 0) throw new TypeError("Invalid cache input count");
      const stats = projectStats(await cache.getStats());
      const totalRequests = stats.runtime.hits + stats.runtime.misses;
      return Object.freeze({
        success: true,
        hitRate: Object.freeze({
          current:
            totalRequests > 0 ? (stats.runtime.hits / totalRequests) * 100 : 0,
          hits: stats.runtime.hits,
          misses: stats.runtime.misses,
          totalRequests,
        }),
        savings: Object.freeze({
          totalTokensSaved: stats.database.totalTokensSaved,
          totalEntries: stats.database.totalEntries,
        }),
      });
    },
  );

  authorizedIpcMain.handle("cache:get-config", async (cache, ...args) => {
    if (args.length !== 0) throw new TypeError("Invalid cache input count");
    return Object.freeze({ success: true, config: projectConfig(cache) });
  });

  authorizedIpcMain.handle("cache:set-config", async (cache, ...args) => {
    if (args.length !== 1) throw new TypeError("Invalid cache input count");
    const config = normalizeConfig(args[0]);
    if (Object.hasOwn(config, "enableAutoCleanup")) {
      if (config.enableAutoCleanup && !cache.enableAutoCleanup) {
        cache.enableAutoCleanup = true;
        cache._startAutoCleanup();
      } else if (!config.enableAutoCleanup && cache.enableAutoCleanup) {
        cache.stopAutoCleanup();
        cache.enableAutoCleanup = false;
      }
    }
    if (config.ttlDays !== undefined) {
      cache.ttl = config.ttlDays * 24 * 60 * 60 * 1_000;
    }
    if (config.maxSize !== undefined) cache.maxSize = config.maxSize;
    return Object.freeze({ success: true, config: projectConfig(cache) });
  });

  for (const [channel, method] of [
    ["cache:clear-all", "clear"],
    ["cache:clear-expired", "clearExpired"],
  ]) {
    authorizedIpcMain.handle(channel, async (cache, ...args) => {
      if (args.length !== 0) throw new TypeError("Invalid cache input count");
      return Object.freeze({
        success: true,
        deletedCount: safeCount(await cache[method]()),
      });
    });
  }

  authorizedIpcMain.handle("cache:check", async (cache, ...args) => {
    if (args.length !== 1) throw new TypeError("Invalid cache input count");
    const input = normalizeCheck(args[0]);
    const result = await cache.get(input.provider, input.model, input.messages);
    return Object.freeze({
      success: true,
      cached: ownData(result, "hit") === true,
      cacheAge: safeCount(ownData(result, "cacheAge")),
      tokensSaved: safeCount(ownData(result, "tokensSaved")),
    });
  });

  authorizedIpcMain.handle("cache:warmup-status", async (cache, ...args) => {
    if (args.length !== 0) throw new TypeError("Invalid cache input count");
    const stats = projectStats(await cache.getStats());
    const totalEntries = stats.database.totalEntries;
    const expiredEntries = Math.min(
      totalEntries,
      stats.database.expiredEntries,
    );
    const healthyEntries = totalEntries - expiredEntries;
    const healthPercent =
      totalEntries > 0 ? (healthyEntries / totalEntries) * 100 : 100;
    return Object.freeze({
      success: true,
      status: Object.freeze({
        totalEntries,
        healthyEntries,
        expiredEntries,
        healthPercent,
        recommendation:
          healthPercent < 50
            ? "clear-expired"
            : healthPercent < 80
              ? "monitor"
              : "healthy",
      }),
    });
  });

  authorizedIpcMain.handle(
    "cache:start-auto-cleanup",
    async (cache, ...args) => {
      if (args.length !== 0) throw new TypeError("Invalid cache input count");
      if (!cache.enableAutoCleanup) {
        cache.enableAutoCleanup = true;
        cache._startAutoCleanup();
      }
      return Object.freeze({ success: true, active: true });
    },
  );

  authorizedIpcMain.handle(
    "cache:stop-auto-cleanup",
    async (cache, ...args) => {
      if (args.length !== 0) throw new TypeError("Invalid cache input count");
      if (cache.enableAutoCleanup) {
        cache.stopAutoCleanup();
        cache.enableAutoCleanup = false;
      }
      return Object.freeze({ success: true, active: false });
    },
  );

  ipcGuard.markModuleRegistered("response-cache-ipc");
  privacy.event("handlers-registered");
}

function unregisterResponseCacheIPC(dependencies = {}) {
  const ipcGuard = dependencies.ipcGuard || defaultIpcGuard;
  if (!ipcGuard.isModuleRegistered("response-cache-ipc")) return;
  const electron = dependencies.ipcMain ? null : require("electron");
  const ipcMain = dependencies.ipcMain || electron.ipcMain;
  for (const channel of CACHE_CHANNELS) ipcMain.removeHandler(channel);
  ipcGuard.unmarkModuleRegistered("response-cache-ipc");
  const privacy =
    dependencies.privacy ||
    createLlmIpcPrivacy("response-cache", dependencies.logger);
  privacy.event("handlers-unregistered");
}

module.exports = {
  registerResponseCacheIPC,
  unregisterResponseCacheIPC,
  setResponseCacheInstance,
  getResponseCacheInstance,
  CACHE_CHANNELS,
};
