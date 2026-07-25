"use strict";

const CURSOR_PREFIX = "whatsapp-sqlite:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const POSITION_KINDS = Object.freeze([
  "contact",
  "chat",
  "modern-message",
  "legacy-message",
  "call",
]);
const KIND_RANK = Object.freeze(
  Object.fromEntries(POSITION_KINDS.map((kind, index) => [kind, index])),
);
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`messaging-whatsapp scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("WHATSAPP_CURSOR_INVALID", message);
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
  if (
    !hasExactKeys(value, ["kind", "id"]) ||
    !POSITION_KINDS.includes(value.kind)
  ) {
    invalid(
      `${label} must contain exactly kind and id for a supported source phase`,
    );
  }
  return {
    kind: value.kind,
    id: normalizeText(value.id, `${label}.id`),
  };
}

function normalizeUpper(value, label = "cursor.upper") {
  if (!hasExactKeys(value, POSITION_KINDS)) {
    invalid(`${label} must contain exactly the five source phase bounds`);
  }
  const upper = {};
  let hasBoundary = false;
  for (const kind of POSITION_KINDS) {
    const boundary = value[kind];
    if (boundary === null) {
      upper[kind] = null;
      continue;
    }
    upper[kind] = normalizeText(boundary, `${label}.${kind}`);
    hasBoundary = true;
  }
  if (!hasBoundary) invalid(`${label} must contain at least one source bound`);
  return upper;
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
  return rankDifference || compareTextIds(left.id, right.id);
}

function lastUpperPosition(upper) {
  for (let index = POSITION_KINDS.length - 1; index >= 0; index -= 1) {
    const kind = POSITION_KINDS[index];
    if (upper[kind] !== null) return { kind, id: upper[kind] };
  }
  return null;
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
      "WHATSAPP_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }
  if (value.upper === null) {
    if (value.after !== null) {
      invalid("cursor.after must be null when no scan is active");
    }
    return initCursor();
  }

  const upper = normalizeUpper(value.upper);
  const after =
    value.after === null
      ? null
      : normalizePosition(value.after, "cursor.after");
  if (after !== null) {
    const phaseUpper = upper[after.kind];
    if (phaseUpper === null) {
      invalid("cursor.after points to a source phase without a bound");
    }
    if (compareTextIds(after.id, phaseUpper) > 0) {
      invalid("cursor.after exceeds its frozen source bound");
    }
    if (comparePositions(after, lastUpperPosition(upper)) >= 0) {
      invalid("a completed scan must use the reset cursor");
    }
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
      "WHATSAPP_CURSOR_TOO_LARGE",
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
  const hasBoundary =
    isPlainObject(upperValue) &&
    POSITION_KINDS.some((kind) => upperValue[kind] !== null);
  if (!hasBoundary) return cursor;
  return checkedCursor({
    v: CURSOR_VERSION,
    after: null,
    upper: normalizeUpper(upperValue, "upper"),
  });
}

function advanceCursor(value, positionValue) {
  const cursor = checkedCursor(value);
  if (cursor.upper === null) invalid("cannot advance without an active scan");
  const position = normalizePosition(positionValue);
  const phaseUpper = cursor.upper[position.kind];
  if (phaseUpper === null) {
    invalid("position points to a source phase without a bound");
  }
  if (cursor.after !== null && comparePositions(position, cursor.after) <= 0) {
    invalid("position must advance strictly");
  }
  if (compareTextIds(position.id, phaseUpper) > 0) {
    invalid("position exceeds its frozen source bound");
  }
  if (comparePositions(position, lastUpperPosition(cursor.upper)) === 0) {
    return initCursor();
  }
  return checkedCursor({
    v: CURSOR_VERSION,
    after: position,
    upper: cursor.upper,
  });
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
    const versionMatch = /^whatsapp-sqlite:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "WHATSAPP_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the whatsapp-sqlite:v1 prefix");
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
  POSITION_KINDS,
  advanceCursor,
  beginScan,
  comparePositions,
  compareTextIds,
  initCursor,
  parseCursor,
  serializeCursor,
};
