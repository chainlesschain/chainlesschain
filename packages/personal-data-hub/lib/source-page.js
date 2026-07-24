"use strict";

class SourcePageError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SourcePageError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
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
  return normalized.length > 0 ? normalized : null;
}

function allowedCode(value, allowlist) {
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
    if (!Array.isArray(path) || path.length === 0) continue;
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
  extractRecognizedArray,
  isExplicitFailure,
  valueAtPath,
};
