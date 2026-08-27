"use strict";

const DEFAULT_LIMITS = Object.freeze({
  maxConnections: 1024,
  maxMessageBytes: 256 * 1024,
  maxBufferedAmount: 1024 * 1024,
  maxPeerIdBytes: 256,
  maxDeviceInfoBytes: 4 * 1024,
  maxQueueSize: 100,
  maxQueuePeers: 2048,
  maxTotalMessages: 10000,
  maxQueueBytes: 2 * 1024 * 1024,
  maxTotalQueueBytes: 64 * 1024 * 1024,
  messageTTL: 24 * 60 * 60 * 1000,
  heartbeatIntervalMs: 30 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
  maxMessagesPerWindow: 120,
  maxBytesPerWindow: 4 * 1024 * 1024,
  rateWindowMs: 10000,
  peerListPageSize: 100,
  peerListMaxPageSize: 500,
  retryAfterMs: 1000,
});

const HARD_LIMITS = Object.freeze({
  maxConnections: 10000,
  maxMessageBytes: 1024 * 1024,
  maxBufferedAmount: 16 * 1024 * 1024,
  maxPeerIdBytes: 1024,
  maxDeviceInfoBytes: 64 * 1024,
  maxQueueSize: 1000,
  maxQueuePeers: 10000,
  maxTotalMessages: 50000,
  maxQueueBytes: 16 * 1024 * 1024,
  maxTotalQueueBytes: 256 * 1024 * 1024,
  messageTTL: 7 * 24 * 60 * 60 * 1000,
  heartbeatIntervalMs: 5 * 60 * 1000,
  cleanupIntervalMs: 24 * 60 * 60 * 1000,
  maxMessagesPerWindow: 10000,
  maxBytesPerWindow: 64 * 1024 * 1024,
  rateWindowMs: 60 * 1000,
  peerListPageSize: 500,
  peerListMaxPageSize: 500,
  retryAfterMs: 60 * 1000,
});

function resolveLimits(options = {}, current = {}) {
  const resolved = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const candidate = Number(options[name] ?? current[name] ?? fallback);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
    if (candidate > HARD_LIMITS[name]) {
      throw new RangeError(`${name} exceeds hard maximum ${HARD_LIMITS[name]}`);
    }
    resolved[name] = candidate;
  }
  if (resolved.maxQueueSize > resolved.maxTotalMessages) {
    throw new RangeError("maxQueueSize cannot exceed maxTotalMessages");
  }
  if (resolved.maxQueueBytes > resolved.maxTotalQueueBytes) {
    throw new RangeError("maxQueueBytes cannot exceed maxTotalQueueBytes");
  }
  if (resolved.peerListPageSize > resolved.peerListMaxPageSize) {
    throw new RangeError("peerListPageSize cannot exceed peerListMaxPageSize");
  }
  if (resolved.maxDeviceInfoBytes > resolved.maxMessageBytes) {
    throw new RangeError("maxDeviceInfoBytes cannot exceed maxMessageBytes");
  }
  return Object.freeze(resolved);
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function frameBytes(data) {
  if (Buffer.isBuffer(data)) return data.length;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return Buffer.byteLength(String(data), "utf8");
}

module.exports = {
  DEFAULT_LIMITS,
  HARD_LIMITS,
  frameBytes,
  resolveLimits,
  serializedBytes,
};
