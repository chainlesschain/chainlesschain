"use strict";

const CURSOR_PREFIX = "netease-music:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MODE_PATTERN = /^(?:live|snapshot)$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`netease-music scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("NETEASE_MUSIC_CURSOR_INVALID", message);
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
    mode: null,
    source: null,
    config: null,
    after: null,
    upper: null,
  };
}

function normalizeMode(value, label = "cursor.mode") {
  if (typeof value !== "string" || !MODE_PATTERN.test(value)) {
    invalid(`${label} must be live or snapshot`);
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest`);
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
  if (
    !hasExactKeys(value, ["v", "mode", "source", "config", "after", "upper"])
  ) {
    invalid(
      "cursor must contain exactly v, mode, source, config, after, and upper",
    );
  }
  if (value.v !== CURSOR_VERSION) {
    throw cursorError(
      "NETEASE_MUSIC_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }
  if (value.upper === null) {
    if (
      value.mode !== null ||
      value.source !== null ||
      value.config !== null ||
      value.after !== null
    ) {
      invalid(
        "a reset cursor must clear mode, source, config, after, and upper",
      );
    }
    return initCursor();
  }
  const after = normalizeIndex(value.after, "cursor.after", {
    allowZero: true,
  });
  const upper = normalizeIndex(value.upper, "cursor.upper");
  if (after >= upper) {
    invalid("cursor.after must remain below cursor.upper");
  }
  return {
    v: CURSOR_VERSION,
    mode: normalizeMode(value.mode),
    source: normalizeDigest(value.source, "cursor.source"),
    config: normalizeDigest(value.config, "cursor.config"),
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
      "NETEASE_MUSIC_CURSOR_TOO_LARGE",
      `${source} exceeds the ${MAX_CURSOR_BYTES}-byte limit`,
    );
  }
}

function checkedCursor(value) {
  const cursor = canonicalizeCursor(value);
  assertCursorSize(encodedCursor(cursor), "generated cursor");
  return cursor;
}

function beginScan(value, { mode, source, config, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper !== null) {
    invalid("cannot begin a scan while another scan is active");
  }
  if (upper === 0) return cursor;
  return checkedCursor({
    v: CURSOR_VERSION,
    mode: normalizeMode(mode, "mode"),
    source: normalizeDigest(source, "source"),
    config: normalizeDigest(config, "config"),
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

function assertScanIdentity(value, { mode, source, config, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) return cursor;
  if (cursor.mode !== mode) {
    throw cursorError(
      "NETEASE_MUSIC_CURSOR_MODE_CHANGED",
      "the collection mode differs from the active scan",
    );
  }
  if (cursor.config !== config) {
    throw cursorError(
      "NETEASE_MUSIC_CURSOR_CONFIG_CHANGED",
      "the selected data or live fetch options differ from the active scan",
    );
  }
  if (cursor.source !== source || cursor.upper !== upper) {
    throw cursorError(
      "NETEASE_MUSIC_CURSOR_SOURCE_CHANGED",
      "the selected snapshot or live collection differs from the active scan",
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
    const versionMatch = /^netease-music:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "NETEASE_MUSIC_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the netease-music:v1 prefix");
  }
  let parsed;
  try {
    parsed = JSON.parse(value.slice(CURSOR_PREFIX.length));
  } catch {
    invalid("stored cursor payload is not valid JSON");
  }
  return { kind: "v1", cursor: canonicalizeCursor(parsed) };
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
