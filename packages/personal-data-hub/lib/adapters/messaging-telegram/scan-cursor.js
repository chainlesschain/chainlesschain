"use strict";

const CURSOR_PREFIX = "telegram-sqlite:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const POSITION_KINDS = Object.freeze(["contact", "chat", "message"]);
const KIND_RANK = Object.freeze({
  contact: 0,
  chat: 1,
  message: 2,
});
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`messaging-telegram scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("TELEGRAM_CURSOR_INVALID", message);
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

function normalizeText(value, label, maxLength = 2048) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    invalid(
      `${label} must be a non-empty string of at most ${maxLength} chars`,
    );
  }
  return value;
}

function normalizePosition(value, label = "position") {
  if (!isPlainObject(value) || !POSITION_KINDS.includes(value.kind)) {
    invalid(`${label}.kind must be contact, chat, or message`);
  }
  if (value.kind === "message") {
    if (!hasExactKeys(value, ["kind", "table", "id"])) {
      invalid(`${label} message must contain exactly kind, table, and id`);
    }
    return {
      kind: value.kind,
      table: normalizeText(value.table, `${label}.table`, 128),
      id: normalizeText(value.id, `${label}.id`),
    };
  }
  if (!hasExactKeys(value, ["kind", "id"])) {
    invalid(`${label} ${value.kind} must contain exactly kind and id`);
  }
  return {
    kind: value.kind,
    id: normalizeText(value.id, `${label}.id`),
  };
}

function compareTextIds(left, right) {
  if (DECIMAL_PATTERN.test(left) && DECIMAL_PATTERN.test(right)) {
    if (left.length !== right.length) {
      return left.length < right.length ? -1 : 1;
    }
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePositions(leftValue, rightValue) {
  const left = normalizePosition(leftValue, "left");
  const right = normalizePosition(rightValue, "right");
  const rankDifference = KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (rankDifference !== 0) return rankDifference;
  if (left.kind === "message") {
    const tableDifference =
      left.table === right.table ? 0 : left.table < right.table ? -1 : 1;
    if (tableDifference !== 0) return tableDifference;
  }
  return compareTextIds(left.id, right.id);
}

function initCursor() {
  return {
    v: CURSOR_VERSION,
    after: null,
    upper: null,
  };
}

function canonicalizeCursor(value) {
  if (!hasExactKeys(value, ["v", "after", "upper"])) {
    invalid("cursor must contain exactly v, after, and upper");
  }
  if (value.v !== CURSOR_VERSION) {
    throw cursorError(
      "TELEGRAM_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }
  if (value.upper === null) {
    if (value.after !== null) {
      invalid("cursor.after must be null when no scan is active");
    }
    return initCursor();
  }
  const upper = normalizePosition(value.upper, "cursor.upper");
  const after =
    value.after === null
      ? null
      : normalizePosition(value.after, "cursor.after");
  if (after !== null && comparePositions(after, upper) >= 0) {
    invalid("cursor.after must remain below cursor.upper");
  }
  return {
    v: CURSOR_VERSION,
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
      "TELEGRAM_CURSOR_TOO_LARGE",
      `${source} exceeds the ${MAX_CURSOR_BYTES}-byte limit`,
    );
  }
}

function checkedCursor(value) {
  const cursor = canonicalizeCursor(value);
  assertCursorSize(encodedCursor(cursor), "generated cursor");
  return cursor;
}

function beginScan(value, upperValue) {
  const cursor = checkedCursor(value);
  if (cursor.upper !== null) {
    invalid("cannot begin a scan while another scan is active");
  }
  if (upperValue === null) return cursor;
  return checkedCursor({
    v: CURSOR_VERSION,
    after: null,
    upper: normalizePosition(upperValue, "upper"),
  });
}

function advanceCursor(value, positionValue) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) invalid("cannot advance without an active scan");
  const position = normalizePosition(positionValue);
  if (cursor.after !== null && comparePositions(position, cursor.after) <= 0) {
    invalid("position must advance strictly");
  }
  const upperComparison = comparePositions(position, cursor.upper);
  if (upperComparison > 0) invalid("position exceeds the frozen scan upper");
  if (upperComparison === 0) return initCursor();
  return checkedCursor({
    v: CURSOR_VERSION,
    after: position,
    upper: cursor.upper,
  });
}

function completeScan(value) {
  const cursor = checkedCursor(value);
  return cursor.upper === null ? cursor : initCursor();
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
    const versionMatch = /^telegram-sqlite:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "TELEGRAM_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the telegram-sqlite:v1 prefix");
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
  beginScan,
  comparePositions,
  compareTextIds,
  completeScan,
  initCursor,
  parseCursor,
  serializeCursor,
};
