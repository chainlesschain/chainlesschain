"use strict";

const crypto = require("crypto");

const HOST_DOM_COMMAND = "chainlesschain.internal.hostDomCommand";
const HOST_DOM_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const HOST_DOM_ACTIONS = new Set(["snapshot", "send", "click"]);
const HOST_DOM_CLICK_TARGETS = new Set([
  "planApprove",
  "stop",
  "latestApprovalApprove",
]);

function normalizeHostDomToken(value) {
  return typeof value === "string" && HOST_DOM_TOKEN_PATTERN.test(value)
    ? value
    : null;
}

function hostDomTokensEqual(expected, actual) {
  const left = normalizeHostDomToken(expected);
  const right = normalizeHostDomToken(actual);
  if (!left || !right) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function validateHostDomRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("host DOM request must be an object");
  }
  if (!HOST_DOM_ACTIONS.has(value.action)) {
    throw new TypeError(`unsupported host DOM action: ${String(value.action)}`);
  }
  if (value.action === "send") {
    if (typeof value.text !== "string" || value.text.length > 512) {
      throw new TypeError(
        "host DOM send text must be a string of at most 512 characters",
      );
    }
    return { action: "send", text: value.text };
  }
  if (value.action === "click") {
    if (!HOST_DOM_CLICK_TARGETS.has(value.target)) {
      throw new TypeError(
        `unsupported host DOM click target: ${String(value.target)}`,
      );
    }
    return { action: "click", target: value.target };
  }
  return { action: "snapshot" };
}

module.exports = {
  HOST_DOM_COMMAND,
  normalizeHostDomToken,
  hostDomTokensEqual,
  validateHostDomRequest,
};
