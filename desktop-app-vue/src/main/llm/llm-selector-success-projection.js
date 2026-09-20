"use strict";

const { types } = require("node:util");

const MAX_SELECTOR_ENTRIES = 32;
const MAX_SELECTOR_STRINGS = 32;
const MAX_SELECTOR_STRING_LENGTH = 128;
const SELECTOR_PROVIDERS = new Set([
  "ollama",
  "openai",
  "deepseek",
  "volcengine",
  "anthropic",
  "claude",
  "gemini",
  "mistral",
  "custom",
  "dashscope",
  "zhipu",
]);
const SWITCHABLE_PROVIDERS = new Set([
  "ollama",
  "openai",
  "deepseek",
  "volcengine",
  "anthropic",
  "claude",
  "gemini",
  "mistral",
  "custom",
]);
const SUPPORTED_TASK_TYPES = new Set([
  "quick",
  "complex",
  "code",
  "translation",
  "summary",
  "analysis",
  "chat",
  "creative",
]);
const SUPPORTED_STRATEGIES = new Set([
  "balanced",
  "cost",
  "quality",
  "speed",
]);
const SELECTION_OPTION_KEYS = new Set(["taskType", "strategy", "excludes"]);

function recordDescriptors(value) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid selector data");
  }
  return Object.getOwnPropertyDescriptors(value);
}

function dataValue(descriptors, key, required = false) {
  const descriptor = descriptors[key];
  if (!descriptor) {
    if (required) {
      throw new TypeError("Missing selector field");
    }
    return undefined;
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError("Invalid selector field");
  }
  return descriptor.value;
}

function identifier(value, allowed) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    (allowed && !allowed.has(value))
  ) {
    throw new TypeError("Invalid selector identifier");
  }
  return value;
}

function text(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_SELECTOR_STRING_LENGTH ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Invalid selector text");
  }
  return value;
}

function number(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new TypeError("Invalid selector number");
  }
  return value;
}

function boolean(value) {
  if (typeof value !== "boolean") {
    throw new TypeError("Invalid selector boolean");
  }
  return value;
}

function stringArray(value, allowed) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length > MAX_SELECTOR_STRINGS
  ) {
    throw new TypeError("Invalid selector list");
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Invalid selector list item");
    }
    result.push(identifier(descriptor.value, allowed));
  }
  return Object.freeze(result);
}

function mappedEntries(value, projector, allowedKeys) {
  const descriptors = recordDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > MAX_SELECTOR_ENTRIES ||
    keys.some((key) => typeof key !== "string")
  ) {
    throw new TypeError("Invalid selector map");
  }
  const result = Object.create(null);
  for (const key of keys) {
    const safeKey = identifier(key, allowedKeys);
    result[safeKey] = projector(dataValue(descriptors, key, true));
  }
  return Object.freeze(result);
}

function projectCharacteristic(value) {
  const descriptors = recordDescriptors(value);
  return Object.freeze({
    name: text(dataValue(descriptors, "name", true)),
    cost: number(dataValue(descriptors, "cost", true), 100),
    speed: number(dataValue(descriptors, "speed", true), 100),
    quality: number(dataValue(descriptors, "quality", true), 100),
    contextLength: number(dataValue(descriptors, "contextLength", true)),
    capabilities: stringArray(
      dataValue(descriptors, "capabilities", true),
    ),
    suitable: stringArray(dataValue(descriptors, "suitable", true)),
    requiresInternet: boolean(
      dataValue(descriptors, "requiresInternet", true),
    ),
  });
}

function projectTaskType(value) {
  const descriptors = recordDescriptors(value);
  return Object.freeze({
    name: text(dataValue(descriptors, "name", true)),
    prioritize: stringArray(dataValue(descriptors, "prioritize", true)),
  });
}

function projectSelectorInfo(characteristics, taskTypes) {
  return Object.freeze({
    characteristics: mappedEntries(
      characteristics,
      projectCharacteristic,
      SELECTOR_PROVIDERS,
    ),
    taskTypes: mappedEntries(
      taskTypes,
      projectTaskType,
      SUPPORTED_TASK_TYPES,
    ),
  });
}

function projectSelectedProvider(value) {
  const provider =
    typeof value === "string"
      ? value
      : dataValue(recordDescriptors(value), "provider", true);
  return Object.freeze({ provider: identifier(provider, SELECTOR_PROVIDERS) });
}

function projectReportEntry(value) {
  const descriptors = recordDescriptors(value);
  const characteristics = recordDescriptors(
    dataValue(descriptors, "characteristics", true),
  );
  return Object.freeze({
    provider: identifier(
      dataValue(descriptors, "provider", true),
      SELECTOR_PROVIDERS,
    ),
    name: text(dataValue(descriptors, "name", true)),
    score: number(dataValue(descriptors, "score", true), 100),
    configured: boolean(dataValue(descriptors, "configured", true)),
    healthy: boolean(dataValue(descriptors, "healthy", true)),
    characteristics: Object.freeze({
      cost: number(dataValue(characteristics, "cost", true), 100),
      speed: number(dataValue(characteristics, "speed", true), 100),
      quality: number(dataValue(characteristics, "quality", true), 100),
      contextLength: number(
        dataValue(characteristics, "contextLength", true),
      ),
    }),
  });
}

function projectSelectionReport(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length > MAX_SELECTOR_ENTRIES
  ) {
    throw new TypeError("Invalid selector report");
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Invalid selector report entry");
    }
    result.push(projectReportEntry(descriptor.value));
  }
  return Object.freeze(result);
}

function normalizeSelectionOptions(value) {
  const descriptors = recordDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !SELECTION_OPTION_KEYS.has(key)) {
      throw new TypeError("Invalid selector option");
    }
  }
  const taskType = dataValue(descriptors, "taskType") ?? "chat";
  const strategy = dataValue(descriptors, "strategy");
  const excludes = dataValue(descriptors, "excludes") ?? [];
  return Object.freeze({
    taskType: identifier(taskType, SUPPORTED_TASK_TYPES),
    ...(strategy === undefined
      ? {}
      : { strategy: identifier(strategy, SUPPORTED_STRATEGIES) }),
    excludes: stringArray(excludes, SELECTOR_PROVIDERS),
  });
}

function normalizeTaskType(value) {
  return identifier(value, SUPPORTED_TASK_TYPES);
}

function normalizeProvider(value) {
  return identifier(value, SWITCHABLE_PROVIDERS);
}

module.exports = {
  normalizeProvider,
  normalizeSelectionOptions,
  normalizeTaskType,
  projectSelectedProvider,
  projectSelectionReport,
  projectSelectorInfo,
};
