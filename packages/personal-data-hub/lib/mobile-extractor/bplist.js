/**
 * Minimal binary property list (bplist00) reader — enough to decode the
 * NSKeyedArchiver blob stored in Manifest.db's `Files.file` column of an
 * iOS backup, from which we pull each file's ProtectionClass +
 * EncryptionKey + Size.
 *
 * Supports the object types that appear in those archives: null/bool,
 * int, real, date, data, ASCII/UTF-16 string, UID, array, dict. This is
 * NOT a general-purpose plist library — it targets the iOS-backup subset.
 *
 * Format reference: Apple CoreFoundation CFBinaryPList.c.
 */

"use strict";

const BPLIST_MAGIC = "bplist00";

class UID {
  constructor(value) { this.UID = value; }
}

/**
 * Parse a bplist00 buffer into a JS value. UIDs become {UID:n} (UID class
 * instances); data stays a Buffer; dates become Date.
 *
 * @param {Buffer} buf
 * @returns {*}
 */
function parseBplist(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32 + 8) {
    throw new Error("parseBplist: buffer too small");
  }
  if (buf.toString("ascii", 0, 8) !== BPLIST_MAGIC) {
    throw new Error("parseBplist: bad magic (not bplist00)");
  }

  // Trailer: last 32 bytes.
  const trailer = buf.subarray(buf.length - 32);
  const offsetSize = trailer.readUInt8(6);
  const objectRefSize = trailer.readUInt8(7);
  const numObjects = readUIntBE(trailer, 8, 8);
  const topObject = readUIntBE(trailer, 16, 8);
  const offsetTableOffset = readUIntBE(trailer, 24, 8);

  // Offset table.
  const offsets = [];
  for (let i = 0; i < numObjects; i++) {
    offsets.push(readUIntBE(buf, offsetTableOffset + i * offsetSize, offsetSize));
  }

  const cache = new Array(numObjects);

  function readObject(index) {
    if (index < 0 || index >= numObjects) throw new Error(`parseBplist: object ref ${index} out of range`);
    if (cache[index] !== undefined) return cache[index];
    let pos = offsets[index];
    const marker = buf.readUInt8(pos);
    const hi = marker >> 4;
    const lo = marker & 0x0f;
    pos += 1;
    let result;

    switch (hi) {
      case 0x0: // singleton
        if (lo === 0x0) result = null;
        else if (lo === 0x8) result = false;
        else if (lo === 0x9) result = true;
        else result = null;
        break;
      case 0x1: { // int (2^lo bytes)
        const n = 1 << lo;
        result = readIntBE(buf, pos, n);
        break;
      }
      case 0x2: { // real
        const n = 1 << lo;
        result = n === 4 ? buf.readFloatBE(pos) : buf.readDoubleBE(pos);
        break;
      }
      case 0x3: { // date (8-byte double, seconds since 2001-01-01)
        const secs = buf.readDoubleBE(pos);
        result = new Date(Date.UTC(2001, 0, 1) + secs * 1000);
        break;
      }
      case 0x4: { // data
        const { count, dataPos } = readCount(buf, lo, pos);
        result = Buffer.from(buf.subarray(dataPos, dataPos + count));
        break;
      }
      case 0x5: { // ASCII string
        const { count, dataPos } = readCount(buf, lo, pos);
        result = buf.toString("ascii", dataPos, dataPos + count);
        break;
      }
      case 0x6: { // UTF-16BE string
        const { count, dataPos } = readCount(buf, lo, pos);
        result = buf.toString("utf16le", dataPos, dataPos + count * 2);
        // Stored big-endian; swap.
        result = swapUtf16(buf.subarray(dataPos, dataPos + count * 2));
        break;
      }
      case 0x8: { // UID
        const n = lo + 1;
        result = new UID(readUIntBE(buf, pos, n));
        break;
      }
      case 0xa: { // array
        const { count, dataPos } = readCount(buf, lo, pos);
        const arr = [];
        cache[index] = arr; // set before recursing (cycle-safe)
        for (let i = 0; i < count; i++) {
          const ref = readUIntBE(buf, dataPos + i * objectRefSize, objectRefSize);
          arr.push(readObject(ref));
        }
        return arr;
      }
      case 0xd: { // dict
        const { count, dataPos } = readCount(buf, lo, pos);
        const dict = {};
        cache[index] = dict;
        const keysBase = dataPos;
        const valsBase = dataPos + count * objectRefSize;
        for (let i = 0; i < count; i++) {
          const kRef = readUIntBE(buf, keysBase + i * objectRefSize, objectRefSize);
          const vRef = readUIntBE(buf, valsBase + i * objectRefSize, objectRefSize);
          const key = readObject(kRef);
          dict[String(key)] = readObject(vRef);
        }
        return dict;
      }
      default:
        throw new Error(`parseBplist: unknown object marker 0x${marker.toString(16)} at ${offsets[index]}`);
    }
    cache[index] = result;
    return result;
  }

  return readObject(topObject);
}

// For collection/data/string markers, lo==0xf means the count follows as
// a separate int object.
function readCount(buf, lo, pos) {
  if (lo !== 0x0f) return { count: lo, dataPos: pos };
  const sizeMarker = buf.readUInt8(pos);
  const n = 1 << (sizeMarker & 0x0f);
  const count = readUIntBE(buf, pos + 1, n);
  return { count, dataPos: pos + 1 + n };
}

function readUIntBE(buf, off, len) {
  let n = 0;
  for (let i = 0; i < len; i++) n = n * 256 + buf.readUInt8(off + i);
  return n;
}

function readIntBE(buf, off, len) {
  // bplist ints are unsigned for 1/2/4 bytes; 8-byte ints can be signed.
  if (len <= 4) return readUIntBE(buf, off, len);
  return Number(buf.readBigInt64BE(off));
}

function swapUtf16(beBuf) {
  const swapped = Buffer.from(beBuf);
  swapped.swap16();
  return swapped.toString("utf16le");
}

/**
 * Resolve an NSKeyedArchiver-shaped parsed plist into a plain object by
 * following $top.root through the $objects table and replacing UID refs.
 *
 * @param {object} parsed — output of parseBplist on an NSKeyedArchiver blob
 * @returns {*}
 */
function unwrapNSKeyedArchiver(parsed) {
  if (!parsed || !Array.isArray(parsed.$objects) || !parsed.$top) {
    throw new Error("unwrapNSKeyedArchiver: not an NSKeyedArchiver plist");
  }
  const objects = parsed.$objects;
  const seen = new Map();

  function resolve(node) {
    if (node instanceof UID) {
      if (seen.has(node.UID)) return seen.get(node.UID);
      const target = objects[node.UID];
      const out = resolveValue(target, node.UID);
      return out;
    }
    return resolveValue(node, null);
  }

  function resolveValue(node, selfUid) {
    if (node === "$null") return null;
    if (node instanceof UID) return resolve(node);
    if (Buffer.isBuffer(node) || node instanceof Date) return node;
    if (Array.isArray(node)) {
      const arr = [];
      if (selfUid != null) seen.set(selfUid, arr);
      for (const el of node) arr.push(resolve(el));
      return arr;
    }
    if (node && typeof node === "object") {
      // NSDictionary/NSArray encoded form has NS.keys / NS.objects.
      if (Array.isArray(node["NS.keys"]) && Array.isArray(node["NS.objects"])) {
        const d = {};
        if (selfUid != null) seen.set(selfUid, d);
        node["NS.keys"].forEach((k, i) => {
          d[String(resolve(k))] = resolve(node["NS.objects"][i]);
        });
        return d;
      }
      if (Array.isArray(node["NS.objects"])) {
        const arr = [];
        if (selfUid != null) seen.set(selfUid, arr);
        node["NS.objects"].forEach((v) => arr.push(resolve(v)));
        return arr;
      }
      const out = {};
      if (selfUid != null) seen.set(selfUid, out);
      for (const [k, v] of Object.entries(node)) {
        if (k === "$class") continue;
        out[k] = resolve(v);
      }
      return out;
    }
    return node;
  }

  return resolve(parsed.$top.root != null ? parsed.$top.root : parsed.$top);
}

module.exports = { parseBplist, unwrapNSKeyedArchiver, UID, BPLIST_MAGIC };
