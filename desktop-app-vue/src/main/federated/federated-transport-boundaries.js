"use strict";

const DEFAULT_FEDERATED_TRANSPORT_BOUNDARIES = Object.freeze({
  maxMessageBytes: 8 * 1024 * 1024,
  maxStreamChunks: 8192,
  streamDeadlineMs: 30_000,
  maxConcurrentInbound: 8,
  maxConcurrentOutbound: 8,
  maxMessageHandlers: 32,
  maxBroadcastPeers: 256,
  maxPeerIdBytes: 1024,
  maxMessageTypeBytes: 128,
});

const HARD_FEDERATED_TRANSPORT_BOUNDARIES = Object.freeze({
  maxMessageBytes: 256 * 1024 * 1024,
  maxStreamChunks: 65_536,
  streamDeadlineMs: 120_000,
  maxConcurrentInbound: 256,
  maxConcurrentOutbound: 256,
  maxMessageHandlers: 1024,
  maxBroadcastPeers: 4096,
  maxPeerIdBytes: 16 * 1024,
  maxMessageTypeBytes: 1024,
});

const BOUNDARY_KEYS = Object.freeze(
  Object.keys(DEFAULT_FEDERATED_TRANSPORT_BOUNDARIES),
);

class FederatedTransportBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FederatedTransportBoundaryError";
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
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_BOUNDARY_CONFIG",
      `${key} must be a positive integer no greater than ${hardLimit}`,
      { key, value, hardLimit },
    );
  }
  return parsed;
}

function createFederatedTransportBoundaries(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_BOUNDARY_CONFIG",
      "Federated transport boundary config must be a plain object",
    );
  }
  const unknownKeys = Object.keys(config).filter(
    (key) => !BOUNDARY_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_BOUNDARY_CONFIG",
      `Unknown federated transport boundary keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }

  return Object.freeze(
    Object.fromEntries(
      BOUNDARY_KEYS.map((key) => [
        key,
        normalizePositiveInteger(
          config[key],
          DEFAULT_FEDERATED_TRANSPORT_BOUNDARIES[key],
          HARD_FEDERATED_TRANSPORT_BOUNDARIES[key],
          key,
        ),
      ]),
    ),
  );
}

function assertPeerId(peerId, boundaries) {
  if (typeof peerId !== "string" || peerId.length === 0) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_PEER_INVALID",
      "peerId must be a non-empty string",
    );
  }
  const byteLength = Buffer.byteLength(peerId, "utf8");
  if (byteLength > boundaries.maxPeerIdBytes) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_PEER_INVALID",
      `peerId exceeds ${boundaries.maxPeerIdBytes} bytes`,
      { byteLength, limitBytes: boundaries.maxPeerIdBytes },
    );
  }
  return peerId;
}

function serializeFederatedMessage(message, boundaries) {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_MESSAGE_INVALID",
      "Federated message must be an object",
    );
  }
  if (
    typeof message.type !== "string" ||
    message.type.length === 0 ||
    Buffer.byteLength(message.type, "utf8") > boundaries.maxMessageTypeBytes
  ) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_MESSAGE_INVALID",
      "Federated message type must be a bounded non-empty string",
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(message);
  } catch (_error) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_MESSAGE_INVALID",
      "Federated message must be JSON serializable",
    );
  }
  if (typeof serialized !== "string") {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_MESSAGE_INVALID",
      "Federated message must serialize to a JSON object",
    );
  }
  const data = Buffer.from(serialized, "utf8");
  if (data.byteLength > boundaries.maxMessageBytes) {
    throw new FederatedTransportBoundaryError(
      "ERR_FEDERATED_MESSAGE_TOO_LARGE",
      `Federated message exceeds ${boundaries.maxMessageBytes} bytes`,
      { byteLength: data.byteLength, limitBytes: boundaries.maxMessageBytes },
    );
  }
  return data;
}

module.exports = {
  DEFAULT_FEDERATED_TRANSPORT_BOUNDARIES,
  HARD_FEDERATED_TRANSPORT_BOUNDARIES,
  FederatedTransportBoundaryError,
  createFederatedTransportBoundaries,
  assertPeerId,
  serializeFederatedMessage,
};
