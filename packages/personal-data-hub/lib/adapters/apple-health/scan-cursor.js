"use strict";

const CURSOR_PREFIX = "apple-health:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const SOURCE_PATTERN = /^[0-9a-f]{64}$/u;
const FILTER_PATTERN = /^(?:none|record|workout|record\+workout)$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`apple-health scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("APPLE_HEALTH_CURSOR_INVALID", message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function initCursor() {
  return {
    v: CURSOR_VERSION,
    source: null,
    filter: null,
    after: null,
    upper: null,
  };
}

function normalizeSource(value, label = "cursor.source") {
  if (typeof value !== "string" || !SOURCE_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeFilter(value, label = "cursor.filter") {
  if (typeof value !== "string" || !FILTER_PATTERN.test(value)) {
    invalid(`${label} must be none, record, workout, or record+workout`);
  }
  return value;
}

function normalizeIndex(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    invalid(
      `${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`,
    );
  }
  return value;
}

function canonicalizeCursor(value) {
  if (!hasExactKeys(value, ["v", "source", "filter", "after", "upper"])) {
    invalid("cursor must contain exactly v, source, filter, after, and upper");
  }
  if (value.v !== CURSOR_VERSION) {
    throw cursorError(
      "APPLE_HEALTH_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }
  if (value.upper === null) {
    if (
      value.source !== null ||
      value.filter !== null ||
      value.after !== null
    ) {
      invalid("a reset cursor must clear source, filter, after, and upper");
    }
    return initCursor();
  }

  const source = normalizeSource(value.source);
  const filter = normalizeFilter(value.filter);
  const after = normalizeIndex(value.after, "cursor.after", {
    allowZero: true,
  });
  const upper = normalizeIndex(value.upper, "cursor.upper");
  if (after >= upper) {
    invalid("cursor.after must remain below cursor.upper");
  }
  return {
    v: CURSOR_VERSION,
    source,
    filter,
    after,
    upper,
  };
}

function encodedCursor(cursor) {
  return `${CURSOR_PREFIX}${JSON.stringify(cursor)}`;
}

function assertCursorSize(serialized, source) {
  if (Buffer.byteLength(serialized, "utf8") > MAX_CURSOR_BYTES) {
    throw cursorError(
      "APPLE_HEALTH_CURSOR_TOO_LARGE",
      `${source} exceeds the ${MAX_CURSOR_BYTES}-byte limit`,
    );
  }
}

function checkedCursor(value) {
  const cursor = canonicalizeCursor(value);
  assertCursorSize(encodedCursor(cursor), "generated cursor");
  return cursor;
}

function beginScan(value, { source, filter, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper !== null) {
    invalid("cannot begin a scan while another scan is active");
  }
  if (upper === 0) return cursor;
  return checkedCursor({
    v: CURSOR_VERSION,
    source: normalizeSource(source, "source"),
    filter: normalizeFilter(filter, "filter"),
    after: 0,
    upper: normalizeIndex(upper, "upper"),
  });
}

function advanceCursor(value, position) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) invalid("cannot advance without an active scan");
  const next = normalizeIndex(position, "position");
  if (next <= cursor.after) invalid("position must advance strictly");
  if (next > cursor.upper) invalid("position exceeds the frozen scan upper");
  if (next === cursor.upper) return initCursor();
  return checkedCursor({ ...cursor, after: next });
}

function assertScanIdentity(value, { source, filter, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) return cursor;
  if (cursor.source !== source) {
    throw cursorError(
      "APPLE_HEALTH_CURSOR_SOURCE_CHANGED",
      "the selected export differs from the active scan source",
    );
  }
  if (cursor.filter !== filter) {
    throw cursorError(
      "APPLE_HEALTH_CURSOR_FILTER_CHANGED",
      "record/workout selection changed during an active scan",
    );
  }
  if (cursor.upper !== upper) {
    throw cursorError(
      "APPLE_HEALTH_CURSOR_SOURCE_CHANGED",
      "the selected export entry boundary changed during an active scan",
    );
  }
  return cursor;
}

function serializeCursor(value) {
  const cursor = canonicalizeCursor(value);
  const serialized = encodedCursor(cursor);
  assertCursorSize(serialized, "generated cursor");
  return serialized;
}

function parseCursor(value) {
  if (value == null || value === "") {
    return { kind: "reset", cursor: initCursor() };
  }
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    (typeof value === "string" && DECIMAL_PATTERN.test(value))
  ) {
    return { kind: "legacy-reset", cursor: initCursor() };
  }
  if (typeof value !== "string") {
    invalid("stored cursor must be a versioned string");
  }
  assertCursorSize(value, "stored cursor");
  if (!value.startsWith(CURSOR_PREFIX)) {
    const versionMatch = /^apple-health:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "APPLE_HEALTH_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the apple-health:v1 prefix");
  }
  let parsed;
  try {
    parsed = JSON.parse(value.slice(CURSOR_PREFIX.length));
  } catch {
    invalid("stored cursor payload is not valid JSON");
  }
  return {
    kind: "v1",
    cursor: canonicalizeCursor(parsed),
  };
}

module.exports = {
  CURSOR_PREFIX,
  CURSOR_VERSION,
  MAX_CURSOR_BYTES,
  advanceCursor,
  assertScanIdentity,
  beginScan,
  initCursor,
  parseCursor,
  serializeCursor,
};
