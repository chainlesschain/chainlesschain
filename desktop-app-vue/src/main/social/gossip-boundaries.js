"use strict";

const DEFAULT_GOSSIP_BOUNDARIES = Object.freeze({
  fanout: 3,
  cacheCapacity: 10_000,
  messageTtlMs: 60 * 60 * 1000,
  sendDeadlineMs: 10_000,
  maxMessageBytes: 512 * 1024,
  maxProtocolIdBytes: 256,
  maxCommunityIdBytes: 1024,
  maxPeerIdBytes: 1024,
  maxMessageIdBytes: 1024,
  maxSubscriptions: 512,
  maxPeerCommunities: 1024,
  maxPeersPerCommunity: 256,
  maxConnectedPeers: 2048,
  maxAnnouncementPeers: 256,
  maxConcurrentInbound: 16,
  maxConcurrentBroadcasts: 16,
  maxConcurrentSends: 16,
  maxHops: 32,
  maxFutureSkewMs: 5 * 60 * 1000,
});

const HARD_GOSSIP_BOUNDARIES = Object.freeze({
  fanout: 128,
  cacheCapacity: 100_000,
  messageTtlMs: 24 * 60 * 60 * 1000,
  sendDeadlineMs: 120_000,
  maxMessageBytes: 16 * 1024 * 1024,
  maxProtocolIdBytes: 4096,
  maxCommunityIdBytes: 16 * 1024,
  maxPeerIdBytes: 16 * 1024,
  maxMessageIdBytes: 16 * 1024,
  maxSubscriptions: 8192,
  maxPeerCommunities: 8192,
  maxPeersPerCommunity: 4096,
  maxConnectedPeers: 16_384,
  maxAnnouncementPeers: 4096,
  maxConcurrentInbound: 256,
  maxConcurrentBroadcasts: 256,
  maxConcurrentSends: 256,
  maxHops: 256,
  maxFutureSkewMs: 60 * 60 * 1000,
});

const BOUNDARY_KEYS = Object.freeze(Object.keys(DEFAULT_GOSSIP_BOUNDARIES));
const ENVELOPE_KEYS = new Set([
  "id",
  "communityId",
  "payload",
  "sender",
  "timestamp",
  "ttl",
  "hops",
  "fromPeerId",
]);

class GossipBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GossipBoundaryError";
    this.code = code;
    this.details = details;
  }
}

function normalizePositiveInteger(value, fallback, hardLimit, key) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > hardLimit) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      `${key} must be a positive integer no greater than ${hardLimit}`,
      { key, value, hardLimit },
    );
  }
  return parsed;
}

function createGossipBoundaries(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      "Gossip boundary config must be a plain object",
    );
  }
  const unknownKeys = Object.keys(config).filter(
    (key) => !BOUNDARY_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      `Unknown gossip boundary keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }
  const boundaries = {};
  for (const key of BOUNDARY_KEYS) {
    boundaries[key] = normalizePositiveInteger(
      config[key],
      DEFAULT_GOSSIP_BOUNDARIES[key],
      HARD_GOSSIP_BOUNDARIES[key],
      key,
    );
  }
  if (boundaries.fanout > boundaries.maxPeersPerCommunity) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      "fanout must not exceed maxPeersPerCommunity",
    );
  }
  if (boundaries.fanout > boundaries.maxConcurrentSends) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      "fanout must not exceed maxConcurrentSends",
    );
  }
  if (boundaries.maxAnnouncementPeers > boundaries.maxConnectedPeers) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_BOUNDARY_CONFIG",
      "maxAnnouncementPeers must not exceed maxConnectedPeers",
    );
  }
  return Object.freeze(boundaries);
}

function assertGossipId(value, maxBytes, name, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new GossipBoundaryError(code, `${name} must be non-empty`);
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > maxBytes) {
    throw new GossipBoundaryError(code, `${name} exceeds ${maxBytes} bytes`, {
      byteLength,
      limitBytes: maxBytes,
    });
  }
  return value;
}

function assertCommunityId(value, boundaries) {
  return assertGossipId(
    value,
    boundaries.maxCommunityIdBytes,
    "communityId",
    "ERR_GOSSIP_COMMUNITY_ID",
  );
}

function assertPeerId(value, boundaries) {
  return assertGossipId(
    value,
    boundaries.maxPeerIdBytes,
    "peerId",
    "ERR_GOSSIP_PEER_ID",
  );
}

function assertMessageId(value, boundaries) {
  return assertGossipId(
    value,
    boundaries.maxMessageIdBytes,
    "messageId",
    "ERR_GOSSIP_MESSAGE_ID",
  );
}

function normalizePayload(payload, boundaries) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      "Gossip payload must be an object",
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (_error) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      "Gossip payload must be JSON serializable",
    );
  }
  if (serialized === undefined) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      "Gossip payload must be JSON serializable",
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > boundaries.maxMessageBytes) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_TOO_LARGE",
      `Gossip payload exceeds ${boundaries.maxMessageBytes} bytes`,
      { byteLength, limitBytes: boundaries.maxMessageBytes },
    );
  }
  return JSON.parse(serialized);
}

function normalizeGossipMessage(message, boundaries, now = Date.now()) {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      "Gossip message must be an object",
    );
  }
  const unknownKeys = Object.keys(message).filter(
    (key) => !ENVELOPE_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      `Unknown gossip message keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }
  const normalized = {
    id: assertMessageId(message.id, boundaries),
    communityId: assertCommunityId(message.communityId, boundaries),
    payload: normalizePayload(message.payload, boundaries),
    sender: assertPeerId(message.sender, boundaries),
    timestamp: message.timestamp,
    ttl: message.ttl,
    hops: message.hops ?? 0,
  };
  if (
    !Number.isSafeInteger(normalized.timestamp) ||
    normalized.timestamp < 0 ||
    normalized.timestamp > now + boundaries.maxFutureSkewMs
  ) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      "Gossip timestamp is outside the accepted range",
    );
  }
  if (
    !Number.isSafeInteger(normalized.ttl) ||
    normalized.ttl <= 0 ||
    normalized.ttl > boundaries.messageTtlMs
  ) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      `Gossip ttl must be between 1 and ${boundaries.messageTtlMs}`,
    );
  }
  if (
    !Number.isSafeInteger(normalized.hops) ||
    normalized.hops < 0 ||
    normalized.hops > boundaries.maxHops
  ) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_INVALID",
      `Gossip hops must be between 0 and ${boundaries.maxHops}`,
    );
  }
  const byteLength = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  if (byteLength > boundaries.maxMessageBytes) {
    throw new GossipBoundaryError(
      "ERR_GOSSIP_MESSAGE_TOO_LARGE",
      `Gossip message exceeds ${boundaries.maxMessageBytes} bytes`,
      { byteLength, limitBytes: boundaries.maxMessageBytes },
    );
  }
  return normalized;
}

module.exports = {
  DEFAULT_GOSSIP_BOUNDARIES,
  HARD_GOSSIP_BOUNDARIES,
  GossipBoundaryError,
  createGossipBoundaries,
  assertGossipId,
  assertCommunityId,
  assertPeerId,
  assertMessageId,
  normalizePayload,
  normalizeGossipMessage,
};
