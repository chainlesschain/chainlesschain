"use strict";

const CURSOR_PREFIX = "qqnt:v1:";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 4096;
const STREAMS = Object.freeze(["c2c", "group"]);
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function cursorError(code, message) {
  const error = new Error(`qq-nt scan cursor: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function invalid(message) {
  throw cursorError("QQNT_CURSOR_INVALID", message);
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
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function assertStream(stream, label = "stream") {
  if (!STREAMS.includes(stream)) {
    invalid(`${label} must be "c2c" or "group"`);
  }
  return stream;
}

function normalizeDecimal(value, label, { allowNumericInput = false } = {}) {
  if (typeof value === "string") {
    if (!DECIMAL_PATTERN.test(value)) {
      invalid(`${label} must be a canonical unsigned decimal string`);
    }
    return value;
  }
  if (allowNumericInput && typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      invalid(`${label} number must be a non-negative safe integer`);
    }
    return String(value);
  }
  if (allowNumericInput && typeof value === "bigint") {
    if (value < 0n) {
      invalid(`${label} bigint must be non-negative`);
    }
    return String(value);
  }
  invalid(`${label} must be a canonical unsigned decimal string`);
}

function normalizeNullableDecimal(value, label, options) {
  return value === null ? null : normalizeDecimal(value, label, options);
}

function compareDecimal(left, right) {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeIdMap(value, label, options) {
  if (!hasExactKeys(value, STREAMS)) {
    invalid(`${label} must contain exactly c2c and group`);
  }
  return {
    c2c: normalizeNullableDecimal(value.c2c, `${label}.c2c`, options),
    group: normalizeNullableDecimal(value.group, `${label}.group`, options),
  };
}

function normalizeDoneMap(value) {
  if (!hasExactKeys(value, STREAMS)) {
    invalid("scan.done must contain exactly c2c and group");
  }
  if (typeof value.c2c !== "boolean" || typeof value.group !== "boolean") {
    invalid("scan.done values must be booleans");
  }
  return { c2c: value.c2c, group: value.group };
}

function canonicalizeCursor(value) {
  if (!hasExactKeys(value, ["v", "next", "after", "scan"])) {
    invalid("cursor must contain exactly v, next, after, and scan");
  }
  if (value.v !== CURSOR_VERSION) {
    throw cursorError(
      "QQNT_CURSOR_UNSUPPORTED",
      `cursor version ${String(value.v)} is unsupported`,
    );
  }

  const next = assertStream(value.next, "cursor.next");
  const after = normalizeIdMap(value.after, "cursor.after");
  if (value.scan === null) {
    return { v: CURSOR_VERSION, next, after, scan: null };
  }
  if (!hasExactKeys(value.scan, ["upper", "done"])) {
    invalid("cursor.scan must contain exactly upper and done");
  }

  const upper = normalizeIdMap(value.scan.upper, "cursor.scan.upper");
  const done = normalizeDoneMap(value.scan.done);
  const unfinished = [];

  for (const stream of STREAMS) {
    const afterValue = after[stream];
    const upperValue = upper[stream];
    if (done[stream]) {
      if (afterValue !== upperValue) {
        invalid(
          `cursor.scan.done.${stream} requires after.${stream} to equal upper.${stream}`,
        );
      }
      continue;
    }
    if (upperValue === null) {
      invalid(`cursor.scan.done.${stream} must be true for an empty stream`);
    }
    if (afterValue !== null && compareDecimal(afterValue, upperValue) >= 0) {
      invalid(
        `cursor.after.${stream} must remain below cursor.scan.upper.${stream} while unfinished`,
      );
    }
    unfinished.push(stream);
  }

  if (unfinished.length === 0) {
    invalid("cursor.scan cannot remain active after both streams are done");
  }
  if (!unfinished.includes(next)) {
    invalid("cursor.next must identify an unfinished stream");
  }

  return {
    v: CURSOR_VERSION,
    next,
    after,
    scan: { upper, done },
  };
}

function encodedCursor(cursor) {
  return `${CURSOR_PREFIX}${JSON.stringify({
    v: CURSOR_VERSION,
    next: cursor.next,
    after: {
      c2c: cursor.after.c2c,
      group: cursor.after.group,
    },
    scan:
      cursor.scan === null
        ? null
        : {
            upper: {
              c2c: cursor.scan.upper.c2c,
              group: cursor.scan.upper.group,
            },
            done: {
              c2c: cursor.scan.done.c2c,
              group: cursor.scan.done.group,
            },
          },
  })}`;
}

function assertCursorSize(serialized, source) {
  if (Buffer.byteLength(serialized, "utf8") > MAX_CURSOR_BYTES) {
    throw cursorError(
      "QQNT_CURSOR_TOO_LARGE",
      `${source} exceeds the ${MAX_CURSOR_BYTES}-byte limit`,
    );
  }
}

function checkedCursor(value) {
  const cursor = canonicalizeCursor(value);
  assertCursorSize(encodedCursor(cursor), "generated cursor");
  return cursor;
}

function initCursor() {
  return {
    v: CURSOR_VERSION,
    next: "c2c",
    after: { c2c: null, group: null },
    scan: null,
  };
}

function beginScan(value, upperValue) {
  const cursor = checkedCursor(value);
  if (cursor.scan !== null) {
    invalid("cannot begin a scan while another scan is active");
  }
  const upper = normalizeIdMap(upperValue, "upper", {
    allowNumericInput: true,
  });
  const done = { c2c: false, group: false };
  const unfinished = [];

  for (const stream of STREAMS) {
    const afterValue = cursor.after[stream];
    const upperStreamValue = upper[stream];
    if (upperStreamValue === null) {
      if (afterValue !== null) {
        invalid(`upper.${stream} cannot be null after that stream advanced`);
      }
      done[stream] = true;
      continue;
    }
    if (
      afterValue !== null &&
      compareDecimal(afterValue, upperStreamValue) > 0
    ) {
      invalid(`cursor.after.${stream} exceeds upper.${stream}`);
    }
    done[stream] = afterValue === upperStreamValue;
    if (!done[stream]) unfinished.push(stream);
  }

  if (unfinished.length === 0) {
    return checkedCursor(cursor);
  }
  const next = unfinished.includes(cursor.next) ? cursor.next : unfinished[0];
  return checkedCursor({
    v: CURSOR_VERSION,
    next,
    after: cursor.after,
    scan: { upper, done },
  });
}

function advanceCursor(value, streamValue, idValue) {
  const cursor = checkedCursor(value);
  const stream = assertStream(streamValue);
  if (cursor.scan === null) invalid("cannot advance without an active scan");
  if (cursor.scan.done[stream]) invalid(`stream ${stream} is already done`);
  if (cursor.next !== stream) {
    invalid(
      `stream ${stream} cannot advance while cursor.next is ${cursor.next}`,
    );
  }

  const id = normalizeDecimal(idValue, `after.${stream}`, {
    allowNumericInput: true,
  });
  const previous = cursor.after[stream];
  if (previous !== null && compareDecimal(id, previous) <= 0) {
    invalid(`after.${stream} must advance strictly`);
  }
  if (compareDecimal(id, cursor.scan.upper[stream]) > 0) {
    invalid(`after.${stream} exceeds scan upper`);
  }

  const after = { ...cursor.after, [stream]: id };
  const reachedUpper = id === cursor.scan.upper[stream];
  const done = {
    ...cursor.scan.done,
    ...(reachedUpper ? { [stream]: true } : {}),
  };
  const unfinished = STREAMS.filter((candidate) => !done[candidate]);
  const other = stream === "c2c" ? "group" : "c2c";
  if (unfinished.length === 0) {
    return checkedCursor({
      v: CURSOR_VERSION,
      next: other,
      after,
      scan: null,
    });
  }
  const next = done[other] ? stream : other;
  return checkedCursor({
    v: CURSOR_VERSION,
    next,
    after,
    scan: { upper: cursor.scan.upper, done },
  });
}

/**
 * Mark a stream exhausted through its frozen upper bound.
 *
 * Callers must use this only after a strict keyset query against the active
 * scan returned no remaining rows. It advances `after` to `upper`, so it must
 * never be used merely because a page, turn, or local scan budget ended.
 */
function completeStream(value, streamValue) {
  const cursor = checkedCursor(value);
  const stream = assertStream(streamValue);
  if (cursor.scan === null) invalid("cannot complete without an active scan");
  if (cursor.scan.done[stream]) invalid(`stream ${stream} is already done`);
  if (cursor.next !== stream) {
    invalid(
      `stream ${stream} cannot complete while cursor.next is ${cursor.next}`,
    );
  }

  const after = {
    ...cursor.after,
    [stream]: cursor.scan.upper[stream],
  };
  const done = { ...cursor.scan.done, [stream]: true };
  const unfinished = STREAMS.filter((candidate) => !done[candidate]);
  if (unfinished.length === 0) {
    return checkedCursor({
      v: CURSOR_VERSION,
      next: stream === "c2c" ? "group" : "c2c",
      after,
      scan: null,
    });
  }
  return checkedCursor({
    v: CURSOR_VERSION,
    next: unfinished[0],
    after,
    scan: { upper: cursor.scan.upper, done },
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
  if (typeof value === "number" || typeof value === "bigint") {
    const decimal = normalizeDecimal(value, "legacy count", {
      allowNumericInput: true,
    });
    assertCursorSize(decimal, "stored cursor");
    return { kind: "legacy-reset", cursor: initCursor() };
  }
  if (typeof value !== "string") {
    invalid("stored cursor must be a versioned string");
  }
  assertCursorSize(value, "stored cursor");
  if (DECIMAL_PATTERN.test(value)) {
    return { kind: "legacy-reset", cursor: initCursor() };
  }
  if (!value.startsWith(CURSOR_PREFIX)) {
    const versionMatch = /^qqnt:v([^:]*):/u.exec(value);
    if (versionMatch) {
      throw cursorError(
        "QQNT_CURSOR_UNSUPPORTED",
        `cursor version ${versionMatch[1] || "(empty)"} is unsupported`,
      );
    }
    invalid("stored cursor must use the qqnt:v1 prefix");
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
  initCursor,
  beginScan,
  advanceCursor,
  completeStream,
  serializeCursor,
  parseCursor,
};
