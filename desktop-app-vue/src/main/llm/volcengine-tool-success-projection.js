"use strict";

const { types } = require("node:util");
const {
  boundedString,
  ownData,
  projectUsage,
} = require("./llm-ipc-success-projection");

const MAX_TEXT_LENGTH = 8 * 1024 * 1024;

function arrayData(array, index) {
  const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
  return descriptor?.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function firstChoice(value) {
  const choices = ownData(value, "choices");
  if (!Array.isArray(choices) || types.isProxy(choices)) {
    return undefined;
  }
  return arrayData(choices, 0);
}

function responseText(value) {
  const directText = ownData(value, "text");
  if (directText !== undefined) {
    const projected = boundedString(directText, MAX_TEXT_LENGTH);
    if (projected === undefined) {
      throw new TypeError("Invalid Volcengine tool response text");
    }
    return projected;
  }

  const message = ownData(firstChoice(value), "message");
  const content = ownData(message, "content");
  if (content === undefined || content === null) {
    return "";
  }
  const projected = boundedString(content, MAX_TEXT_LENGTH);
  if (projected === undefined) {
    throw new TypeError("Invalid Volcengine tool response content");
  }
  return projected;
}

function projectVolcengineToolSuccess(value) {
  const text = responseText(value);
  const model = boundedString(ownData(value, "model"));
  return Object.freeze({
    text,
    usage: projectUsage(ownData(value, "usage")),
    ...(model === undefined ? {} : { model }),
  });
}

function projectVolcengineKnowledgeSetupSuccess() {
  return Object.freeze({ configured: true });
}

module.exports = {
  projectVolcengineKnowledgeSetupSuccess,
  projectVolcengineToolSuccess,
};
