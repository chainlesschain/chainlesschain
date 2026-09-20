"use strict";

const { types } = require("node:util");

const MAX_TEXT_LENGTH = 8 * 1024 * 1024;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_MODELS = 1000;
const MAX_RETRIEVED_DOCS = 100;
const MAX_EMBEDDING_DIMENSIONS = 65536;
const USAGE_KEYS = Object.freeze([
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "cached_tokens",
  "input_tokens",
  "output_tokens",
]);

function ownData(owner, key) {
  if (
    !owner ||
    typeof owner !== "object" ||
    types.isProxy(owner) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(owner))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  return descriptor?.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function boundedString(value, maxLength = MAX_IDENTIFIER_LENGTH) {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : undefined;
}

function boundedNumber(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

function arrayData(array, index) {
  const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
  return descriptor?.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function projectUsage(value, fallbackTokens = 0) {
  const usage = {};
  for (const key of USAGE_KEYS) {
    const projected = boundedNumber(ownData(value, key));
    if (projected !== undefined) {
      usage[key] = projected;
    }
  }
  if (usage.total_tokens === undefined) {
    usage.total_tokens = boundedNumber(fallbackTokens) ?? 0;
  }
  return Object.freeze(usage);
}

function responseContent(value) {
  const directText = boundedString(ownData(value, "text"), MAX_TEXT_LENGTH);
  if (directText !== undefined) {
    return directText;
  }
  const directContent = boundedString(
    ownData(value, "content"),
    MAX_TEXT_LENGTH,
  );
  if (directContent !== undefined) {
    return directContent;
  }
  const message = ownData(value, "message");
  return boundedString(ownData(message, "content"), MAX_TEXT_LENGTH) ?? "";
}

function projectModelResponse(value) {
  if (typeof value === "string") {
    const text = boundedString(value, MAX_TEXT_LENGTH);
    if (text === undefined) {
      throw new TypeError("LLM success response is too large");
    }
    return Object.freeze({
      content: text,
      message: Object.freeze({ role: "assistant", content: text }),
      text,
      tokens: 0,
      usage: Object.freeze({ total_tokens: 0 }),
    });
  }
  const text = responseContent(value);
  const rawTokens = boundedNumber(ownData(value, "tokens"));
  const usage = projectUsage(ownData(value, "usage"), rawTokens);
  const tokens = rawTokens ?? usage.total_tokens;
  const model = boundedString(ownData(value, "model"));
  return Object.freeze({
    content: text,
    message: Object.freeze({ role: "assistant", content: text }),
    text,
    tokens,
    usage,
    ...(model === undefined ? {} : { model }),
  });
}

function projectModel(value) {
  if (typeof value === "string") {
    return boundedString(value);
  }
  const id = boundedString(ownData(value, "id"));
  const name = boundedString(ownData(value, "name"));
  if (id === undefined && name === undefined) {
    return undefined;
  }
  const size = boundedNumber(ownData(value, "size"));
  const modifiedAt = boundedString(ownData(value, "modified_at"));
  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(size === undefined ? {} : { size }),
    ...(modifiedAt === undefined ? {} : { modified_at: modifiedAt }),
  });
}

function projectModels(value) {
  if (!Array.isArray(value) || types.isProxy(value)) {
    return [];
  }
  const models = [];
  const length = Math.min(value.length, MAX_MODELS);
  for (let index = 0; index < length; index += 1) {
    const candidate = arrayData(value, index);
    const model = projectModel(candidate);
    if (model !== undefined) {
      models.push(model);
    }
  }
  return models;
}

function projectStatus(value) {
  const available = ownData(value, "available") === true;
  const provider = boundedString(ownData(value, "provider")) ?? "unknown";
  const model = boundedString(ownData(value, "model"));
  return Object.freeze({
    available,
    provider,
    models: projectModels(ownData(value, "models")),
    error: available ? null : "LLM service unavailable",
    ...(model === undefined ? {} : { model }),
  });
}

function projectEmbeddingVector(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length > MAX_EMBEDDING_DIMENSIONS
  ) {
    throw new TypeError("LLM embedding response is invalid");
  }
  const vector = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = arrayData(value, index);
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new TypeError("LLM embedding response is invalid");
    }
    vector.push(item);
  }
  return Object.freeze(vector);
}

function projectEmbedding(value) {
  if (Array.isArray(value) && !types.isProxy(value)) {
    return projectEmbeddingVector(value);
  }
  const vector = projectEmbeddingVector(ownData(value, "embedding"));
  const model = boundedString(ownData(value, "model"));
  return Object.freeze({
    embedding: vector,
    usage: projectUsage(ownData(value, "usage")),
    ...(model === undefined ? {} : { model }),
  });
}

function projectStreamChunk(chunk, fullText) {
  return Object.freeze({
    chunk: boundedString(chunk, MAX_TEXT_LENGTH) ?? "",
    fullText: boundedString(fullText, MAX_TEXT_LENGTH) ?? "",
  });
}

function projectRetrievedDocs(value) {
  if (!Array.isArray(value) || types.isProxy(value)) {
    return [];
  }
  const docs = [];
  const length = Math.min(value.length, MAX_RETRIEVED_DOCS);
  for (let index = 0; index < length; index += 1) {
    const candidate = arrayData(value, index);
    const id = boundedString(ownData(candidate, "id"));
    if (id === undefined) {
      continue;
    }
    const title = boundedString(ownData(candidate, "title"));
    const content = boundedString(
      ownData(candidate, "content"),
      MAX_TEXT_LENGTH,
    );
    const score = boundedNumber(ownData(candidate, "score"));
    docs.push(
      Object.freeze({
        id,
        ...(title === undefined ? {} : { title }),
        ...(content === undefined ? {} : { content: content.slice(0, 200) }),
        ...(score === undefined ? {} : { score }),
      }),
    );
  }
  return docs;
}

module.exports = {
  boundedNumber,
  boundedString,
  ownData,
  projectEmbedding,
  projectModelResponse,
  projectModels,
  projectRetrievedDocs,
  projectStatus,
  projectStreamChunk,
  projectUsage,
};
