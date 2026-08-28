const DEFAULT_COLLAB_BOUNDARIES = Object.freeze({
  maxStreamBytes: 2 * 1024 * 1024,
  maxStreamChunks: 2048,
  streamReadTimeoutMs: 15_000,
  maxIpcUpdateBytes: 2 * 1024 * 1024,
  maxAwarenessBytes: 64 * 1024,
  maxDocumentIdBytes: 1024,
  maxPeerIdBytes: 1024,
  maxActiveDocuments: 128,
  documentIdleTtlMs: 15 * 60 * 1000,
  maxPeersPerDocument: 128,
  maxAwarenessStatesPerDocument: 256,
  awarenessStateTtlMs: 2 * 60 * 1000,
  maxReplayUpdates: 4096,
  maxReplayBytes: 32 * 1024 * 1024,
  maxReceiveUpdates: 32,
  maxReceiveBytes: 8 * 1024 * 1024,
  maxVersionHistoryEntries: 100,
  maxSubscribersPerDocument: 64,
  maxOfflineDocuments: 128,
  maxOfflineEditsPerDocument: 2048,
  maxOfflineBytesPerDocument: 16 * 1024 * 1024,
  offlineEditTtlMs: 7 * 24 * 60 * 60 * 1000,
});

const HARD_COLLAB_BOUNDARIES = Object.freeze({
  maxStreamBytes: 16 * 1024 * 1024,
  maxStreamChunks: 16_384,
  streamReadTimeoutMs: 120_000,
  maxIpcUpdateBytes: 16 * 1024 * 1024,
  maxAwarenessBytes: 1024 * 1024,
  maxDocumentIdBytes: 16 * 1024,
  maxPeerIdBytes: 16 * 1024,
  maxActiveDocuments: 4096,
  documentIdleTtlMs: 24 * 60 * 60 * 1000,
  maxPeersPerDocument: 4096,
  maxAwarenessStatesPerDocument: 8192,
  awarenessStateTtlMs: 60 * 60 * 1000,
  maxReplayUpdates: 65_536,
  maxReplayBytes: 512 * 1024 * 1024,
  maxReceiveUpdates: 512,
  maxReceiveBytes: 64 * 1024 * 1024,
  maxVersionHistoryEntries: 1000,
  maxSubscribersPerDocument: 1024,
  maxOfflineDocuments: 4096,
  maxOfflineEditsPerDocument: 65_536,
  maxOfflineBytesPerDocument: 256 * 1024 * 1024,
  offlineEditTtlMs: 30 * 24 * 60 * 60 * 1000,
});

const BOUNDARY_KEYS = Object.freeze(Object.keys(DEFAULT_COLLAB_BOUNDARIES));

class CollabBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CollabBoundaryError";
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
    throw new CollabBoundaryError(
      "ERR_COLLAB_BOUNDARY_CONFIG",
      `${key} must be a positive integer no greater than ${hardLimit}`,
      { key, value, hardLimit },
    );
  }

  return parsed;
}

function createCollabBoundaries(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_BOUNDARY_CONFIG",
      "Collaboration boundary config must be a plain object",
    );
  }

  const unknownKeys = Object.keys(config).filter(
    (key) => !BOUNDARY_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_BOUNDARY_CONFIG",
      `Unknown collaboration boundary keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }

  const boundaries = {};
  for (const key of BOUNDARY_KEYS) {
    boundaries[key] = normalizePositiveInteger(
      config[key],
      DEFAULT_COLLAB_BOUNDARIES[key],
      HARD_COLLAB_BOUNDARIES[key],
      key,
    );
  }

  return Object.freeze(boundaries);
}

function assertDocumentId(documentId, boundaries) {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_DOCUMENT_ID",
      "documentId must be a non-empty string",
    );
  }

  const byteLength = Buffer.byteLength(documentId, "utf8");
  if (byteLength > boundaries.maxDocumentIdBytes) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_DOCUMENT_ID_TOO_LARGE",
      `documentId exceeds ${boundaries.maxDocumentIdBytes} bytes`,
      { byteLength, limitBytes: boundaries.maxDocumentIdBytes },
    );
  }

  return documentId;
}

function normalizeUpdate(update, boundaries) {
  let normalized;
  if (Buffer.isBuffer(update) || update instanceof Uint8Array) {
    normalized = new Uint8Array(update);
  } else if (Array.isArray(update)) {
    if (
      update.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    ) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_UPDATE_INVALID",
        "Yjs update arrays may only contain byte values",
      );
    }
    normalized = Uint8Array.from(update);
  } else {
    throw new CollabBoundaryError(
      "ERR_COLLAB_UPDATE_INVALID",
      "Yjs update must be a byte array",
    );
  }

  if (normalized.byteLength === 0) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_UPDATE_INVALID",
      "Yjs update must not be empty",
    );
  }
  if (normalized.byteLength > boundaries.maxIpcUpdateBytes) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_UPDATE_TOO_LARGE",
      `Yjs update exceeds ${boundaries.maxIpcUpdateBytes} bytes`,
      {
        byteLength: normalized.byteLength,
        limitBytes: boundaries.maxIpcUpdateBytes,
      },
    );
  }

  return normalized;
}

function assertAwarenessState(state, boundaries) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_AWARENESS_INVALID",
      "Awareness state must be an object",
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (_error) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_AWARENESS_INVALID",
      "Awareness state must be JSON serializable",
    );
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > boundaries.maxAwarenessBytes) {
    throw new CollabBoundaryError(
      "ERR_COLLAB_AWARENESS_TOO_LARGE",
      `Awareness state exceeds ${boundaries.maxAwarenessBytes} bytes`,
      { byteLength, limitBytes: boundaries.maxAwarenessBytes },
    );
  }

  return state;
}

module.exports = {
  DEFAULT_COLLAB_BOUNDARIES,
  HARD_COLLAB_BOUNDARIES,
  CollabBoundaryError,
  createCollabBoundaries,
  assertDocumentId,
  normalizeUpdate,
  assertAwarenessState,
};
