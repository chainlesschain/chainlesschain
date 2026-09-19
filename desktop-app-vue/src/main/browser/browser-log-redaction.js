"use strict";

const { createHash } = require("node:crypto");
const { types } = require("node:util");

const SENSITIVE_KEY =
  /(?:url|uri|path|file|name|title|text|input|prompt|content|body|query|cookie|header|authorization|signature|did|selector|ref|reasoning|message|stack)/iu;
const URL_TOKEN = /\b(?:https?|file|app):\/\/[^\s"'<>]+/giu;
const WINDOWS_PATH_TOKEN = /\b[A-Za-z]:\\[^\s"'<>]+/gu;
const POSIX_PATH_TOKEN = /(?:^|\s)(\/(?:[^\s"'<>/]+\/)*[^\s"'<>]*)/gu;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function readOwnDataProperty(value, key, fallback = null) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : fallback;
}

function digestSnapshot(value, seen = new WeakSet(), depth = 0) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (value === undefined) return "[Undefined]";
  if (typeof value !== "object") return `[${typeof value}]`;
  if (types.isProxy(value)) return "[Proxy]";
  if (Buffer.isBuffer(value))
    return Object.freeze({
      bufferBytes: value.byteLength,
      bufferDigest: createHash("sha256").update(value).digest("hex"),
    });
  if (value instanceof Error)
    return Object.freeze({
      name: "Error",
      code:
        typeof readOwnDataProperty(value, "code") === "string"
          ? readOwnDataProperty(value, "code")
          : null,
      message: readOwnDataProperty(value, "message", ""),
    });
  if (seen.has(value)) return "[Circular]";
  if (depth >= 6) return "[DepthLimit]";
  seen.add(value);
  if (Array.isArray(value))
    return value
      .slice(0, 32)
      .map((entry) => digestSnapshot(entry, seen, depth + 1));
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return "[NonPlainObject]";
  const result = {};
  for (const key of Object.keys(value).sort().slice(0, 64)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    result[key] =
      descriptor && "value" in descriptor
        ? digestSnapshot(descriptor.value, seen, depth + 1)
        : "[Accessor]";
  }
  return result;
}

function digestBrowserLogValue(label, value) {
  const serialized = canonical(digestSnapshot(value));
  return `sha256:${createHash("sha256")
    .update(`chainlesschain.browser-log-${label}/v1\0`)
    .update(serialized)
    .digest("hex")}`;
}

function redacted(label, value) {
  let byteLength = null;
  try {
    byteLength = Buffer.byteLength(canonical(digestSnapshot(value)), "utf8");
  } catch {
    byteLength = null;
  }
  return Object.freeze({
    redacted: true,
    valueDigest: digestBrowserLogValue(label, value),
    byteLength,
  });
}

function sanitizeBrowserLogMessage(value) {
  if (typeof value !== "string") return "[browser-log-message-invalid]";
  const replace = (token) =>
    `[redacted:${digestBrowserLogValue("message-token", token).slice(7, 19)}]`;
  return value
    .replace(URL_TOKEN, replace)
    .replace(WINDOWS_PATH_TOKEN, replace)
    .replace(POSIX_PATH_TOKEN, (match, token) =>
      match.replace(token, replace(token)),
    )
    .slice(0, 2048);
}

function sanitizeBrowserLogData(value, seen = new WeakSet(), depth = 0) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redacted("string", value);
  if (typeof value !== "object") return redacted("unsupported", String(value));
  if (types.isProxy(value)) return redacted("proxy", "proxy");
  if (value instanceof Error)
    return Object.freeze({
      name: "Error",
      code:
        typeof readOwnDataProperty(value, "code") === "string"
          ? readOwnDataProperty(value, "code")
          : null,
      message: redacted(
        "error-message",
        readOwnDataProperty(value, "message", ""),
      ),
    });
  if (seen.has(value)) return "[Circular Reference]";
  if (depth >= 6) return redacted("depth-limit", "depth-limit");
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 32)
      .map((entry) => sanitizeBrowserLogData(entry, seen, depth + 1));
    return Object.freeze({
      itemCount: value.length,
      items: Object.freeze(items),
      truncated: value.length > items.length,
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return redacted("non-plain-object", "non-plain-object");
  const result = {};
  for (const key of Object.keys(value).slice(0, 64)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      result[key] = redacted("accessor", key);
      continue;
    }
    const entry = descriptor.value;
    result[key] = SENSITIVE_KEY.test(key)
      ? redacted(key.toLowerCase(), entry)
      : sanitizeBrowserLogData(entry, seen, depth + 1);
  }
  if (Object.keys(value).length > 64) result.truncated = true;
  return Object.freeze(result);
}

function createBrowserLogRedactor(logger) {
  if (!logger || typeof logger !== "object")
    throw new TypeError("Browser logger is invalid");
  const safe = {};
  for (const level of ["debug", "info", "warn", "error"]) {
    if (typeof logger[level] !== "function")
      throw new TypeError("Browser logger level is invalid");
    safe[level] = (message, data) =>
      logger[level](
        sanitizeBrowserLogMessage(message),
        sanitizeBrowserLogData(data),
      );
  }
  return Object.freeze(safe);
}

module.exports = {
  createBrowserLogRedactor,
  digestBrowserLogValue,
  sanitizeBrowserLogData,
  sanitizeBrowserLogMessage,
};
