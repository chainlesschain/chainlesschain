"use strict";

const crypto = require("node:crypto");
const { LEAF_PREFIX, NODE_PREFIX, HASH_PREFIX } = require("./constants.js");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function leafHash(leafBytes) {
  if (!Buffer.isBuffer(leafBytes)) {
    throw new TypeError("leafHash: input must be Buffer");
  }
  return sha256(Buffer.concat([LEAF_PREFIX, leafBytes]));
}

function nodeHash(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) {
    throw new TypeError("nodeHash: inputs must be Buffer");
  }
  if (left.length !== 32 || right.length !== 32) {
    throw new RangeError("nodeHash: inputs must be 32 bytes");
  }
  return sha256(Buffer.concat([NODE_PREFIX, left, right]));
}

function encodeHashStr(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) {
    throw new RangeError("encodeHashStr: expected 32-byte Buffer");
  }
  return HASH_PREFIX + buf.toString("base64url");
}

function decodeHashStr(s) {
  if (typeof s !== "string" || !s.startsWith(HASH_PREFIX)) {
    throw new TypeError(`decodeHashStr: expected "${HASH_PREFIX}…" string`);
  }
  const buf = Buffer.from(s.slice(HASH_PREFIX.length), "base64url");
  if (buf.length !== 32) {
    throw new RangeError("decodeHashStr: payload must decode to 32 bytes");
  }
  return buf;
}

module.exports = {
  sha256,
  leafHash,
  nodeHash,
  encodeHashStr,
  decodeHashStr,
};
