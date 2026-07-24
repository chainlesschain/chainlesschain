/**
 * Versioned aggregate checkpoints for adapters that collect more than one
 * independent source stream (for example play history + favourites).
 *
 * A single timestamp cannot safely represent such streams: a recent record in
 * one stream may otherwise hide an older, not-yet-collected record in another.
 * The vault still stores one string per adapter/scope, so this module encodes a
 * deterministic map of stream key -> epoch-millisecond watermark.
 */

"use strict";

const PARTITIONED_WATERMARK_PREFIX = "pdh-partitioned-v1:";
const MAX_PARTITIONED_WATERMARK_BYTES = 64 * 1024;
const MAX_PARTITIONED_WATERMARK_STREAMS = 64;
const PARTITIONED_WATERMARK_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function assertPartitionedWatermarkKey(value, label = "watermark stream key") {
  if (
    typeof value !== "string" ||
    !PARTITIONED_WATERMARK_KEY_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must match ${PARTITIONED_WATERMARK_KEY_PATTERN}`,
    );
  }
  return value;
}

function scalarToString(value, label) {
  let numeric;
  if (typeof value === "string") {
    if (!/^(0|[1-9]\d*)$/u.test(value)) {
      throw new TypeError(`${label} must be an epoch-millisecond integer`);
    }
    numeric = Number(value);
  } else if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`${label} must be a safe epoch-millisecond integer`);
    }
    numeric = Number(value);
  } else {
    throw new TypeError(
      `${label} must be a string, number, or bigint epoch-millisecond integer`,
    );
  }
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new TypeError(`${label} must be a safe epoch-millisecond integer`);
  }
  return String(numeric);
}

function normalizePartitionedWatermarks(
  value,
  { allowedKeys, rejectUnknown = false } = {},
) {
  const isObject =
    value != null && typeof value === "object" && !Array.isArray(value);
  const prototype = isObject ? Object.getPrototypeOf(value) : undefined;
  if (!isObject || (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError("partitioned watermarks must be a plain object");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_PARTITIONED_WATERMARK_STREAMS) {
    throw new RangeError(
      `partitioned watermarks exceed ${MAX_PARTITIONED_WATERMARK_STREAMS} streams`,
    );
  }
  const allowed =
    allowedKeys == null
      ? null
      : new Set(
          Array.from(allowedKeys, (key) =>
            assertPartitionedWatermarkKey(key, "allowed watermark stream key"),
          ),
        );
  const normalized = {};
  for (const [key, watermark] of entries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    assertPartitionedWatermarkKey(key);
    if (allowed && !allowed.has(key)) {
      if (rejectUnknown) {
        throw new TypeError(`unknown watermark stream key "${key}"`);
      }
      continue;
    }
    normalized[key] = scalarToString(
      watermark,
      `watermark for stream "${key}"`,
    );
  }
  return normalized;
}

function serializePartitionedWatermark(value) {
  const normalized = normalizePartitionedWatermarks(value);
  const encoded = Buffer.from(JSON.stringify(normalized), "utf8").toString(
    "base64url",
  );
  const serialized = `${PARTITIONED_WATERMARK_PREFIX}${encoded}`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_PARTITIONED_WATERMARK_BYTES) {
    throw new RangeError(
      `partitioned watermark exceeds ${MAX_PARTITIONED_WATERMARK_BYTES} bytes`,
    );
  }
  return serialized;
}

/**
 * Parse a stored aggregate without making a damaged checkpoint destructive.
 *
 * Any legacy scalar, unsupported version, oversized payload, malformed JSON,
 * or invalid entry returns an empty map. The next sync therefore replays the
 * selected streams instead of trusting a cursor that could suppress records.
 */
function parsePartitionedWatermark(value, options = {}) {
  if (
    typeof value !== "string" ||
    !value.startsWith(PARTITIONED_WATERMARK_PREFIX) ||
    Buffer.byteLength(value, "utf8") > MAX_PARTITIONED_WATERMARK_BYTES
  ) {
    return {};
  }
  const encoded = value.slice(PARTITIONED_WATERMARK_PREFIX.length);
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) return {};
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return {};
    const parsed = JSON.parse(decoded.toString("utf8"));
    return normalizePartitionedWatermarks(parsed, options);
  } catch {
    return {};
  }
}

module.exports = {
  PARTITIONED_WATERMARK_PREFIX,
  MAX_PARTITIONED_WATERMARK_BYTES,
  MAX_PARTITIONED_WATERMARK_STREAMS,
  PARTITIONED_WATERMARK_KEY_PATTERN,
  assertPartitionedWatermarkKey,
  normalizePartitionedWatermarks,
  parsePartitionedWatermark,
  serializePartitionedWatermark,
};
