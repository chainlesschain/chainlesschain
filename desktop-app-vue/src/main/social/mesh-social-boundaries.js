"use strict";

const DEFAULT_MESH_SOCIAL_BOUNDARIES = Object.freeze({
  discoveryIntervalMs: 5_000,
  peerTtlMs: 30_000,
  maxPeers: 256,
  maxSyncEntries: 1_000,
  maxSyncBytes: 16 * 1024 * 1024,
  maxDataBytes: 512 * 1024,
  maxPeerIdBytes: 1_024,
  maxAliasBytes: 512,
  maxMetadataBytes: 64 * 1024,
});

const HARD_MESH_SOCIAL_BOUNDARIES = Object.freeze({
  discoveryIntervalMs: 60 * 60 * 1_000,
  peerTtlMs: 24 * 60 * 60 * 1_000,
  maxPeers: 16_384,
  maxSyncEntries: 100_000,
  maxSyncBytes: 256 * 1024 * 1024,
  maxDataBytes: 16 * 1024 * 1024,
  maxPeerIdBytes: 16 * 1024,
  maxAliasBytes: 4 * 1024,
  maxMetadataBytes: 1024 * 1024,
});

const BOUNDARY_KEYS = Object.freeze(
  Object.keys(DEFAULT_MESH_SOCIAL_BOUNDARIES),
);
const PEER_INFO_KEYS = new Set(["alias", "connectionType", "metadata"]);

class MeshSocialBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MeshSocialBoundaryError";
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
    throw new MeshSocialBoundaryError(
      "ERR_MESH_BOUNDARY_CONFIG",
      `${key} must be a positive integer no greater than ${hardLimit}`,
      { key, value, hardLimit },
    );
  }
  return parsed;
}

function createMeshSocialBoundaries(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_BOUNDARY_CONFIG",
      "Mesh social boundary config must be a plain object",
    );
  }
  const unknownKeys = Object.keys(config).filter(
    (key) => !BOUNDARY_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_BOUNDARY_CONFIG",
      `Unknown mesh social boundary keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }

  const boundaries = {};
  for (const key of BOUNDARY_KEYS) {
    boundaries[key] = normalizePositiveInteger(
      config[key],
      DEFAULT_MESH_SOCIAL_BOUNDARIES[key],
      HARD_MESH_SOCIAL_BOUNDARIES[key],
      key,
    );
  }
  if (boundaries.maxDataBytes > boundaries.maxSyncBytes) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_BOUNDARY_CONFIG",
      "maxDataBytes must not exceed maxSyncBytes",
    );
  }
  return Object.freeze(boundaries);
}

function assertMeshString(value, maxBytes, name, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new MeshSocialBoundaryError(code, `${name} must be non-empty`);
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > maxBytes) {
    throw new MeshSocialBoundaryError(
      code,
      `${name} exceeds ${maxBytes} bytes`,
      {
        byteLength,
        limitBytes: maxBytes,
      },
    );
  }
  return value;
}

function assertMeshPeerId(value, boundaries) {
  return assertMeshString(
    value,
    boundaries.maxPeerIdBytes,
    "peerId",
    "ERR_MESH_PEER_ID",
  );
}

function cloneJsonWithin(value, maxBytes, name, options = {}) {
  const { requireObject = false } = options;
  if (
    value === undefined ||
    (requireObject &&
      (value === null || typeof value !== "object" || Array.isArray(value)))
  ) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_DATA_INVALID",
      `${name} must be ${requireObject ? "an object" : "JSON serializable"}`,
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_DATA_INVALID",
      `${name} must be JSON serializable`,
    );
  }
  if (serialized === undefined) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_DATA_INVALID",
      `${name} must be JSON serializable`,
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > maxBytes) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_DATA_TOO_LARGE",
      `${name} exceeds ${maxBytes} bytes`,
      { byteLength, limitBytes: maxBytes },
    );
  }
  return { value: JSON.parse(serialized), byteLength };
}

function normalizeMeshData(data, boundaries) {
  if (data === null) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_DATA_INVALID",
      "Mesh data is required",
    );
  }
  return cloneJsonWithin(data, boundaries.maxDataBytes, "Mesh data");
}

function normalizeMeshPeer(peerId, peerInfo, boundaries, now) {
  const normalizedPeerId = assertMeshPeerId(peerId, boundaries);
  if (
    peerInfo === null ||
    typeof peerInfo !== "object" ||
    Array.isArray(peerInfo)
  ) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_PEER_INVALID",
      "peerInfo must be a plain object",
    );
  }
  const unknownKeys = Object.keys(peerInfo).filter(
    (key) => !PEER_INFO_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new MeshSocialBoundaryError(
      "ERR_MESH_PEER_INVALID",
      `Unknown peer info keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }

  const alias = assertMeshString(
    peerInfo.alias === undefined
      ? `peer-${normalizedPeerId.substring(0, 8)}`
      : peerInfo.alias,
    boundaries.maxAliasBytes,
    "alias",
    "ERR_MESH_PEER_INVALID",
  );
  const metadata = cloneJsonWithin(
    peerInfo.metadata === undefined ? {} : peerInfo.metadata,
    boundaries.maxMetadataBytes,
    "Peer metadata",
    { requireObject: true },
  ).value;

  return {
    id: normalizedPeerId,
    alias,
    connectionType: peerInfo.connectionType,
    lastSeen: now,
    metadata,
  };
}

module.exports = {
  DEFAULT_MESH_SOCIAL_BOUNDARIES,
  HARD_MESH_SOCIAL_BOUNDARIES,
  MeshSocialBoundaryError,
  createMeshSocialBoundaries,
  assertMeshPeerId,
  normalizeMeshData,
  normalizeMeshPeer,
};
