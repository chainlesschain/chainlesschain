/**
 * Authorized IPC boundary for the instinct learning system.
 *
 * Renderer identity is never accepted as input. Every operation is authorized
 * against the active main-frame identity before the manager is accessed.
 */

"use strict";

const { types } = require("node:util");
const {
  createLlmCoreIpcAuthorization,
} = require("./llm-core-ipc-authorization");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

const INSTINCT_CHANNELS = Object.freeze([
  "instinct:get-all",
  "instinct:get-relevant",
  "instinct:add",
  "instinct:update",
  "instinct:delete",
  "instinct:reinforce",
  "instinct:decay",
  "instinct:evolve",
  "instinct:export",
  "instinct:import",
  "instinct:get-stats",
]);

const CHANNEL_OPERATIONS = Object.freeze(
  Object.fromEntries(
    INSTINCT_CHANNELS.map((channel) => [
      channel,
      `instinct-${channel.slice("instinct:".length)}`,
    ]),
  ),
);

const CATEGORIES = new Set([
  "coding-pattern",
  "tool-preference",
  "workflow",
  "error-fix",
  "style",
  "architecture",
  "testing",
  "general",
]);
const SOURCES = new Set(["auto", "import", "manual"]);
const ORDER_BY_VALUES = new Set([
  "confidence ASC",
  "confidence DESC",
  "confidence DESC, use_count DESC",
  "created_at ASC",
  "created_at DESC",
  "updated_at ASC",
  "updated_at DESC",
  "use_count ASC",
  "use_count DESC",
]);
const FILTER_KEYS = new Set([
  "category",
  "minConfidence",
  "source",
  "orderBy",
  "limit",
]);
const INSTINCT_WRITE_KEYS = new Set([
  "pattern",
  "confidence",
  "category",
  "examples",
]);
const IMPORT_INSTINCT_KEYS = new Set([
  ...INSTINCT_WRITE_KEYS,
  "id",
  "source",
  "useCount",
]);
const IMPORT_KEYS = new Set([
  "version",
  "exportedAt",
  "count",
  "truncated",
  "instincts",
]);
const SUCCESS_RECEIPT = Object.freeze({ success: true });

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

function boundedNumber(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function boundedCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : 0;
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
    const length = Math.min(value.length, maximum);
    const values = [];
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

function normalizeExamples(value = []) {
  return Object.freeze(
    strictArrayValues(value, 20, "instinct examples").map((example) =>
      boundedText(example, 1_024, "instinct example"),
    ),
  );
}

function normalizeFilters(value = {}) {
  const descriptors = descriptorsFor(value, FILTER_KEYS, "instinct filters");
  const normalized = {};
  if (descriptors.category) {
    if (!CATEGORIES.has(descriptors.category.value)) {
      throw new TypeError("Invalid instinct category");
    }
    normalized.category = descriptors.category.value;
  }
  if (descriptors.minConfidence) {
    normalized.minConfidence = boundedNumber(
      descriptors.minConfidence.value,
      0,
      1,
      "minimum confidence",
    );
  }
  if (descriptors.source) {
    if (!SOURCES.has(descriptors.source.value)) {
      throw new TypeError("Invalid instinct source");
    }
    normalized.source = descriptors.source.value;
  }
  if (descriptors.orderBy) {
    if (!ORDER_BY_VALUES.has(descriptors.orderBy.value)) {
      throw new TypeError("Invalid instinct sort order");
    }
    normalized.orderBy = descriptors.orderBy.value;
  }
  const limit = descriptors.limit?.value ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Invalid instinct limit");
  }
  normalized.limit = limit;
  return Object.freeze(normalized);
}

function normalizeInstinctWrite(value, { partial = false } = {}) {
  const descriptors = descriptorsFor(
    value,
    INSTINCT_WRITE_KEYS,
    "instinct write",
  );
  const normalized = {};
  if (descriptors.pattern) {
    normalized.pattern = boundedText(
      descriptors.pattern.value,
      4_096,
      "instinct pattern",
    );
  } else if (!partial) {
    throw new TypeError("Instinct pattern is required");
  }
  if (descriptors.confidence) {
    normalized.confidence = boundedNumber(
      descriptors.confidence.value,
      0.1,
      0.95,
      "instinct confidence",
    );
  }
  if (descriptors.category) {
    if (!CATEGORIES.has(descriptors.category.value)) {
      throw new TypeError("Invalid instinct category");
    }
    normalized.category = descriptors.category.value;
  }
  if (descriptors.examples) {
    normalized.examples = normalizeExamples(descriptors.examples.value);
  }
  if (partial && Object.keys(normalized).length === 0) {
    throw new TypeError("Instinct update is empty");
  }
  return Object.freeze(normalized);
}

function normalizeId(value) {
  return boundedText(value, 128, "instinct ID");
}

function normalizeImport(value) {
  const descriptors = descriptorsFor(value, IMPORT_KEYS, "instinct import");
  const instincts = descriptors.instincts?.value;
  return Object.freeze({
    instincts: Object.freeze(
      strictArrayValues(instincts, 1_000, "instinct import entries").map(
        (entry) => {
          const descriptors = descriptorsFor(
            entry,
            IMPORT_INSTINCT_KEYS,
            "imported instinct",
          );
          const writable = {};
          for (const key of INSTINCT_WRITE_KEYS) {
            if (descriptors[key]) writable[key] = descriptors[key].value;
          }
          return normalizeInstinctWrite(writable);
        },
      ),
    ),
  });
}

function projectInstinct(value, { includeExamples = false } = {}) {
  const id = ownData(value, "id");
  const pattern = ownData(value, "pattern");
  const confidence = ownData(value, "confidence");
  const category = ownData(value, "category");
  const source = ownData(value, "source");
  if (
    typeof id !== "string" ||
    id.length < 1 ||
    id.length > 128 ||
    /\p{Cc}/u.test(id) ||
    typeof pattern !== "string" ||
    pattern.length < 1 ||
    pattern.length > 4_096 ||
    /\p{Cc}/u.test(pattern) ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !CATEGORIES.has(category) ||
    !SOURCES.has(source)
  ) {
    return null;
  }
  const projected = {
    id,
    pattern,
    confidence,
    category,
    source,
    useCount: boundedCount(ownData(value, "useCount")),
  };
  if (includeExamples) {
    projected.examples = Object.freeze(
      projectedArrayValues(ownData(value, "examples"), 20).filter(
        (entry) =>
          typeof entry === "string" &&
          entry.length > 0 &&
          entry.length <= 1_024 &&
          !/\p{Cc}/u.test(entry),
      ),
    );
  }
  return Object.freeze(projected);
}

function projectInstincts(values, options) {
  return Object.freeze(
    projectedArrayValues(values, 1_000)
      .map((value) => projectInstinct(value, options))
      .filter(Boolean),
  );
}

function projectStats(value) {
  const byCategory = ownData(value, "byCategory");
  const projectedCategories = {};
  for (const category of CATEGORIES) {
    const count = ownData(byCategory, category);
    if (count !== undefined)
      projectedCategories[category] = boundedCount(count);
  }
  const average = ownData(value, "avgConfidence");
  return Object.freeze({
    totalInstincts: boundedCount(ownData(value, "totalInstincts")),
    byCategory: Object.freeze(projectedCategories),
    avgConfidence:
      Number.isFinite(average) && average >= 0 && average <= 1 ? average : 0,
    highConfidenceCount: boundedCount(ownData(value, "highConfidenceCount")),
    totalObservations: boundedCount(ownData(value, "totalObservations")),
    unprocessedObservations: boundedCount(
      ownData(value, "unprocessedObservations"),
    ),
    bufferSize: boundedCount(ownData(value, "bufferSize")),
    totalUseCount: boundedCount(ownData(value, "totalUseCount")),
  });
}

function fixedFailure() {
  return Object.freeze({
    success: false,
    error: "Instinct operation failed",
    code: "CC_LLM_INSTINCT_OPERATION_FAILED",
  });
}

function fixedUnavailable() {
  return Object.freeze({
    success: false,
    error: "Instinct service unavailable",
    code: "CC_LLM_INSTINCT_UNAVAILABLE",
  });
}

function registerInstinctIPC(instinctManager, dependencies = {}) {
  const electron = dependencies.ipcMain ? null : require("electron");
  const ipcMain = dependencies.ipcMain || electron.ipcMain;
  const privacy =
    dependencies.privacy ||
    createLlmIpcPrivacy("instinct", dependencies.logger);
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
        if (!instinctManager) return fixedUnavailable();
        try {
          return await handler(...args);
        } catch {
          privacy.failure(operation);
          return fixedFailure();
        }
      });
    },
  };

  authorizedIpcMain.handle("instinct:get-all", async (...args) => {
    if (args.length > 1) throw new TypeError("Invalid instinct input count");
    return Object.freeze({
      success: true,
      data: projectInstincts(
        await instinctManager.getAll(normalizeFilters(args[0] ?? {})),
      ),
    });
  });

  authorizedIpcMain.handle("instinct:get-relevant", async (...args) => {
    if (args.length < 1 || args.length > 2) {
      throw new TypeError("Invalid instinct input count");
    }
    const context = boundedText(args[0], 16_384, "instinct context");
    const limit = args[1] ?? 5;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new TypeError("Invalid instinct limit");
    }
    return Object.freeze({
      success: true,
      data: projectInstincts(
        await instinctManager.getRelevantInstincts(context, limit),
      ),
    });
  });

  authorizedIpcMain.handle("instinct:add", async (...args) => {
    if (args.length !== 1) throw new TypeError("Invalid instinct input count");
    const input = normalizeInstinctWrite(args[0]);
    const instinct = await instinctManager.addInstinct(
      input.pattern,
      input.confidence,
      input.category,
      { source: "manual", examples: input.examples },
    );
    const data = projectInstinct(instinct);
    return data ? Object.freeze({ success: true, data }) : fixedFailure();
  });

  authorizedIpcMain.handle("instinct:update", async (...args) => {
    if (args.length !== 2) throw new TypeError("Invalid instinct input count");
    const instinct = await instinctManager.updateInstinct(
      normalizeId(args[0]),
      normalizeInstinctWrite(args[1], { partial: true }),
    );
    const data = projectInstinct(instinct);
    return data ? Object.freeze({ success: true, data }) : fixedFailure();
  });

  for (const [channel, method] of [
    ["instinct:reinforce", "reinforceInstinct"],
    ["instinct:decay", "decayInstinct"],
  ]) {
    authorizedIpcMain.handle(channel, async (...args) => {
      if (args.length !== 1)
        throw new TypeError("Invalid instinct input count");
      const data = projectInstinct(
        await instinctManager[method](normalizeId(args[0])),
      );
      return data ? Object.freeze({ success: true, data }) : fixedFailure();
    });
  }

  authorizedIpcMain.handle("instinct:delete", async (...args) => {
    if (args.length !== 1) throw new TypeError("Invalid instinct input count");
    const deleted = await instinctManager.deleteInstinct(normalizeId(args[0]));
    return deleted ? SUCCESS_RECEIPT : fixedFailure();
  });

  authorizedIpcMain.handle("instinct:evolve", async (...args) => {
    if (args.length !== 0) throw new TypeError("Invalid instinct input count");
    const result = await instinctManager.evolveInstincts();
    if (ownData(result, "success") !== true) return fixedFailure();
    return Object.freeze({
      success: true,
      observationsProcessed: boundedCount(
        ownData(result, "observationsProcessed"),
        200,
      ),
      extracted: boundedCount(ownData(result, "extracted"), 200),
    });
  });

  authorizedIpcMain.handle("instinct:export", async (...args) => {
    if (args.length !== 0) throw new TypeError("Invalid instinct input count");
    const exported = await instinctManager.exportInstincts();
    const data = projectInstincts(ownData(exported, "instincts"), {
      includeExamples: true,
    });
    return Object.freeze({
      success: true,
      data: Object.freeze({
        version: "1.0.0",
        count: data.length,
        truncated: boundedCount(ownData(exported, "count")) > data.length,
        instincts: data,
      }),
    });
  });

  authorizedIpcMain.handle("instinct:import", async (...args) => {
    if (args.length !== 1) throw new TypeError("Invalid instinct input count");
    const result = await instinctManager.importInstincts(
      normalizeImport(args[0]),
    );
    if (ownData(result, "success") !== true) return fixedFailure();
    return Object.freeze({
      success: true,
      imported: boundedCount(ownData(result, "imported"), 1_000),
      skipped: boundedCount(ownData(result, "skipped"), 1_000),
    });
  });

  authorizedIpcMain.handle("instinct:get-stats", async (...args) => {
    if (args.length !== 0) throw new TypeError("Invalid instinct input count");
    return Object.freeze({
      success: true,
      data: projectStats(await instinctManager.getStats()),
    });
  });

  privacy.event("handlers-registered");
}

function unregisterInstinctIPC(dependencies = {}) {
  const electron = dependencies.ipcMain ? null : require("electron");
  const ipcMain = dependencies.ipcMain || electron.ipcMain;
  for (const channel of INSTINCT_CHANNELS) ipcMain.removeHandler(channel);
  const privacy =
    dependencies.privacy ||
    createLlmIpcPrivacy("instinct", dependencies.logger);
  privacy.event("handlers-unregistered");
}

module.exports = {
  registerInstinctIPC,
  unregisterInstinctIPC,
  INSTINCT_CHANNELS,
};
