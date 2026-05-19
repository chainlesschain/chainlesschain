/**
 * Entity ID generation — RFC 9562 UUID v7
 *
 * v7 chosen for time-ordered IDs — first 48 bits are unix timestamp ms,
 * so IDs sort chronologically. This gives:
 *   - cheap "events by time window" range queries on the id column
 *   - SQLite B-tree locality for sequential inserts (less page splits)
 *   - debuggability ("which one came first" without joining on occurredAt)
 *
 * Mirrors design doc §5.1: "id 用 UUID v7：含时间序，方便分页 / 按时间窗扫描".
 *
 * Hand-rolled (no `uuid` dep) because the repo currently ships uuid@9 which
 * lacks v7. Algorithm follows RFC 9562 §5.7. ~30 LOC. No external state.
 */

"use strict";

const { randomBytes } = require("node:crypto");

/**
 * Generate a UUID v7.
 *
 * Layout (16 bytes):
 *   bytes 0-5: 48-bit unix_ts_ms (big-endian)
 *   byte  6:   0111 xxxx       (version 7 + 4 rand_a bits)
 *   byte  7:   xxxx xxxx       (8 more rand_a bits)
 *   byte  8:   10xx xxxx       (variant + 6 rand_b bits)
 *   bytes 9-15: 7 rand_b bytes
 */
function newId() {
  const buf = Buffer.alloc(16);
  const ts = Date.now(); // up to ~52-bit safe integer, well within 48-bit ms range until year 10895

  // Split ts to avoid bit-shift precision loss above 32 bits.
  // Top 16 bits live in tsHi; bottom 32 bits in tsLo.
  const tsHi = Math.floor(ts / 0x100000000);
  const tsLo = ts >>> 0;

  buf[0] = (tsHi >>> 8) & 0xff;
  buf[1] = tsHi & 0xff;
  buf[2] = (tsLo >>> 24) & 0xff;
  buf[3] = (tsLo >>> 16) & 0xff;
  buf[4] = (tsLo >>> 8) & 0xff;
  buf[5] = tsLo & 0xff;

  const r = randomBytes(10);
  buf[6] = 0x70 | (r[0] & 0x0f); // version 7
  buf[7] = r[1];
  buf[8] = 0x80 | (r[2] & 0x3f); // variant 10xxxxxx
  buf[9] = r[3];
  buf[10] = r[4];
  buf[11] = r[5];
  buf[12] = r[6];
  buf[13] = r[7];
  buf[14] = r[8];
  buf[15] = r[9];

  const hex = buf.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

/**
 * Generate a deterministic ID for a given (adapter, originalId) pair.
 * Used when an adapter wants stable IDs across re-ingests of the same row.
 *
 * NOTE: v0 prototype uses a random v7. Adapters that need dedup use
 * (source.adapter, source.originalId) lookup, not id equality.
 * v1 may switch to v5 (name-based) if deterministic IDs become necessary.
 */
function newIdForSource(_adapter, _originalId) {
  return newId();
}

/**
 * Extract the millisecond timestamp embedded in a UUID v7.
 * Returns null for non-v7 UUIDs.
 */
function timestampFromId(id) {
  if (typeof id !== "string" || id.length !== 36) return null;
  if (id.charAt(14) !== "7") return null;
  // First 48 bits = chars 0..7 (32 bits) + chars 9..12 (16 bits)
  const hi = parseInt(id.slice(0, 8), 16);
  const lo = parseInt(id.slice(9, 13), 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  const ms = hi * 0x10000 + lo;
  return ms;
}

module.exports = {
  newId,
  newIdForSource,
  timestampFromId,
};
