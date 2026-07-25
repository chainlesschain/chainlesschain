"use strict";

const CURSOR_PREFIX = "game-genshin:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const SOURCE_PATTERN = /^[0-9a-f]{64}$/u;
const MODE_PATTERN = /^(?:live|snapshot)$/u;
const SNAPSHOT_FILTER_PATTERN = /^(?:none|play|profile|profile\+play)$/u;
const LIVE_FILTER_PATTERN = /^(?:none|profile):(?:no-stats|stats)$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`game-genshin scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("GAME_GENSHIN_CURSOR_INVALID", message);
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
    filter: null,
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

function normalizeSource(value, label = "cursor.source") {
  if (typeof value !== "string" || !SOURCE_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeFilter(value, mode, label = "cursor.filter") {
  const pattern =
    mode === "snapshot" ? SNAPSHOT_FILTER_PATTERN : LIVE_FILTER_PATTERN;
  if (typeof value !== "string" || !pattern.test(value)) {
    invalid(`${label} is not valid for ${mode} mode`);
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
    !hasExactKeys(value, ["v", "mode", "source", "filter", "after", "upper"])
  ) {
    invalid(
      "cursor must contain exactly v, mode, source, filter, after, and upper",
    );
  }
  if (value.v !== CURSOR_VERSION) {
    throw cursorError(
      "GAME_GENSHIN_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }
  if (value.upper === null) {
    if (
      value.mode !== null ||
      value.source !== null ||
      value.filter !== null ||
      value.after !== null
    ) {
      invalid(
        "a reset cursor must clear mode, source, filter, after, and upper",
      );
    }
    return initCursor();
  }
  const mode = normalizeMode(value.mode);
  const source = normalizeSource(value.source);
  const filter = normalizeFilter(value.filter, mode);
  const after = normalizeIndex(value.after, "cursor.after", {
    allowZero: true,
  });
  const upper = normalizeIndex(value.upper, "cursor.upper");
  if (after >= upper) {
    invalid("cursor.after must remain below cursor.upper");
  }
  return {
    v: CURSOR_VERSION,
    mode,
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
      "GAME_GENSHIN_CURSOR_TOO_LARGE",
      `${source} exceeds the ${MAX_CURSOR_BYTES}-byte limit`,
    );
  }
}

function checkedCursor(value) {
  const cursor = canonicalizeCursor(value);
  assertCursorSize(encodedCursor(cursor), "generated cursor");
  return cursor;
}

function beginScan(value, { mode, source, filter, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper !== null) {
    invalid("cannot begin a scan while another scan is active");
  }
  if (upper === 0) return cursor;
  const normalizedMode = normalizeMode(mode, "mode");
  return checkedCursor({
    v: CURSOR_VERSION,
    mode: normalizedMode,
    source: normalizeSource(source, "source"),
    filter: normalizeFilter(filter, normalizedMode, "filter"),
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

function assertScanIdentity(value, { mode, source, filter, upper }) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) return cursor;
  if (cursor.mode !== mode) {
    throw cursorError(
      "GAME_GENSHIN_CURSOR_MODE_CHANGED",
      "the collection mode differs from the active scan",
    );
  }
  if (cursor.filter !== filter) {
    throw cursorError(
      "GAME_GENSHIN_CURSOR_FILTER_CHANGED",
      "the selected data or live fetch options differ from the active scan",
    );
  }
  if (cursor.source !== source || cursor.upper !== upper) {
    throw cursorError(
      "GAME_GENSHIN_CURSOR_SOURCE_CHANGED",
      "the selected snapshot or live role set differs from the active scan",
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
    const versionMatch = /^game-genshin:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "GAME_GENSHIN_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the game-genshin:v1 prefix");
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
