"use strict";

const crypto = require("node:crypto");

class SourcePageError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SourcePageError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

function createSourcePageGuard(source = "source") {
  const seenByStream = new Map();

  return {
    observe(stream = "records", records = []) {
      if (!Array.isArray(records) || records.length === 0) return;

      const streamName = String(stream || "records");
      const seen = seenByStream.get(streamName) || new Set();
      const signature = crypto
        .createHash("sha256")
        .update(JSON.stringify(canonicalizePageValue(records)))
        .digest("hex");

      if (seen.has(signature)) {
        throw new SourcePageError(
          "SOURCE_PAGE_STALLED",
          `${source}: ${streamName} pagination repeated a source page`,
        );
      }

      seen.add(signature);
      seenByStream.set(streamName, seen);
    },
  };
}

function canonicalizePageValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizePageValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizePageValue(value[key])]),
  );
}

const DEFAULT_SUCCESS_CODES = Object.freeze(["0", "200", "ok", "success"]);
const DEFAULT_SUCCESS_STATUSES = Object.freeze([
  "0",
  "1",
  "200",
  "ok",
  "success",
]);
const DEFAULT_CODE_KEYS = Object.freeze([
  "code",
  "errno",
  "errNo",
  "errorCode",
  "error_code",
  "errcode",
  "ret",
  "retCode",
  "retcode",
  "resultCode",
]);

function normalizeCodeToken(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const namespaceSeparator = normalized.indexOf("::");
  return namespaceSeparator >= 0
    ? normalized.slice(0, namespaceSeparator)
    : normalized;
}

function allowedCode(value, allowlist) {
  if (value === true) return true;
  if (value === false) return false;
  if (Array.isArray(value)) {
    return (
      value.length > 0 && value.every((item) => allowedCode(item, allowlist))
    );
  }
  const token = normalizeCodeToken(value);
  if (token === null) return value == null || value === "";
  return allowlist.map(normalizeCodeToken).includes(token);
}

function isFalseLike(value) {
  if (value === false || value === 0) return true;
  if (typeof value !== "string") return false;
  return /^(?:0|false|no|off)$/iu.test(value.trim());
}

function isExplicitFailure(response, opts = {}, seen = new WeakSet()) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return false;
  }
  if (seen.has(response)) return false;
  seen.add(response);
  if (
    (response.success != null && isFalseLike(response.success)) ||
    (response.ok != null && isFalseLike(response.ok))
  ) {
    return true;
  }
  if (response.error != null) {
    const errorToken = normalizeCodeToken(response.error);
    if (
      response.error !== false &&
      response.error !== 0 &&
      response.error !== "" &&
      (errorToken === null ||
        (errorToken !== "0" && errorToken !== "ok" && errorToken !== "success"))
    ) {
      return true;
    }
  }

  if (response.statusCode != null) {
    const token = normalizeCodeToken(response.statusCode);
    const numeric =
      token !== null && /^-?\d+$/u.test(token) ? Number(token) : null;
    if (
      numeric === null
        ? token !== "ok" && token !== "success"
        : numeric < 200 || numeric >= 300
    ) {
      return true;
    }
  }

  if (response.status != null) {
    const successStatuses = Array.isArray(opts.successStatuses)
      ? opts.successStatuses
      : DEFAULT_SUCCESS_STATUSES;
    if (!allowedCode(response.status, successStatuses)) {
      return true;
    }
  }

  const codeKeys = Array.isArray(opts.codeKeys)
    ? opts.codeKeys
    : DEFAULT_CODE_KEYS;
  const successCodes = Array.isArray(opts.successCodes)
    ? opts.successCodes
    : DEFAULT_SUCCESS_CODES;
  for (const key of codeKeys) {
    if (
      typeof key === "string" &&
      response[key] != null &&
      !allowedCode(response[key], successCodes)
    ) {
      return true;
    }
  }

  const nested = response.data;
  if (
    nested &&
    nested !== response &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    isExplicitFailure(nested, opts, seen)
  ) {
    return true;
  }
  return false;
}

function valueAtPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function extractRecognizedArray(response, paths, opts = {}) {
  const source =
    typeof opts.source === "string" && opts.source.length > 0
      ? opts.source
      : "source";
  const stream =
    typeof opts.stream === "string" && opts.stream.length > 0
      ? ` ${opts.stream}`
      : "";
  if (isExplicitFailure(response, opts)) {
    throw new SourcePageError(
      "SOURCE_PAGE_ERROR",
      `${source}:${stream} source returned an explicit error response`,
    );
  }
  if (!response || typeof response !== "object") {
    throw new SourcePageError(
      "SOURCE_PAGE_UNRECOGNIZED",
      `${source}:${stream} source response is not a JSON object`,
    );
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError(
      "extractRecognizedArray: at least one path is required",
    );
  }
  for (const path of paths) {
    if (!Array.isArray(path)) continue;
    if (path.length === 0) {
      if (Array.isArray(response)) return response;
      continue;
    }
    const value = valueAtPath(response, path);
    if (Array.isArray(value)) return value;
  }
  throw new SourcePageError(
    "SOURCE_PAGE_UNRECOGNIZED",
    `${source}:${stream} source response did not contain a recognized list`,
  );
}

module.exports = {
  SourcePageError,
  createSourcePageGuard,
  extractRecognizedArray,
  isExplicitFailure,
  valueAtPath,
};
