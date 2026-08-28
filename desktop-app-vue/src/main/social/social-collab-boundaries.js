"use strict";

const SOCIAL_COLLAB_MESSAGE_TYPES = Object.freeze({
  UPDATE: "update",
  FULL_STATE_REQUEST: "full_state_request",
  FULL_STATE_RESPONSE: "full_state_response",
  SYNC_START: "sync_start",
  SYNC_STOP: "sync_stop",
});

const SOCIAL_COLLAB_MESSAGE_TYPE_SET = new Set(
  Object.values(SOCIAL_COLLAB_MESSAGE_TYPES),
);

const DEFAULT_SOCIAL_COLLAB_BOUNDARIES = Object.freeze({
  maxMessageBytes: 2 * 1024 * 1024,
  maxUpdateBytes: 512 * 1024,
  maxStreamChunks: 2048,
  streamDeadlineMs: 15_000,
  maxConcurrentInbound: 16,
  maxConcurrentOutbound: 16,
  maxActiveDocuments: 128,
  maxPeersPerDocument: 128,
  maxDocumentIdBytes: 1024,
  maxPeerIdBytes: 1024,
});

const HARD_SOCIAL_COLLAB_BOUNDARIES = Object.freeze({
  maxMessageBytes: 16 * 1024 * 1024,
  maxUpdateBytes: 8 * 1024 * 1024,
  maxStreamChunks: 16_384,
  streamDeadlineMs: 120_000,
  maxConcurrentInbound: 256,
  maxConcurrentOutbound: 256,
  maxActiveDocuments: 4096,
  maxPeersPerDocument: 4096,
  maxDocumentIdBytes: 16 * 1024,
  maxPeerIdBytes: 16 * 1024,
});

const BOUNDARY_KEYS = Object.freeze(
  Object.keys(DEFAULT_SOCIAL_COLLAB_BOUNDARIES),
);

const MESSAGE_KEYS = new Set(["type", "docId", "data", "timestamp"]);

class SocialCollabBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SocialCollabBoundaryError";
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
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_BOUNDARY_CONFIG",
      `${key} must be a positive integer no greater than ${hardLimit}`,
      { key, value, hardLimit },
    );
  }
  return parsed;
}

function createSocialCollabBoundaries(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_BOUNDARY_CONFIG",
      "Social collaboration boundary config must be a plain object",
    );
  }
  const unknownKeys = Object.keys(config).filter(
    (key) => !BOUNDARY_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_BOUNDARY_CONFIG",
      `Unknown social collaboration boundary keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }
  const boundaries = {};
  for (const key of BOUNDARY_KEYS) {
    boundaries[key] = normalizePositiveInteger(
      config[key],
      DEFAULT_SOCIAL_COLLAB_BOUNDARIES[key],
      HARD_SOCIAL_COLLAB_BOUNDARIES[key],
      key,
    );
  }
  if (boundaries.maxUpdateBytes > boundaries.maxMessageBytes) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_BOUNDARY_CONFIG",
      "maxUpdateBytes must not exceed maxMessageBytes",
      {
        maxUpdateBytes: boundaries.maxUpdateBytes,
        maxMessageBytes: boundaries.maxMessageBytes,
      },
    );
  }
  return Object.freeze(boundaries);
}

function assertBoundedId(value, maxBytes, name, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new SocialCollabBoundaryError(code, `${name} must be non-empty`);
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > maxBytes) {
    throw new SocialCollabBoundaryError(
      code,
      `${name} exceeds ${maxBytes} bytes`,
      { byteLength, limitBytes: maxBytes },
    );
  }
  return value;
}

function assertSocialDocumentId(docId, boundaries) {
  return assertBoundedId(
    docId,
    boundaries.maxDocumentIdBytes,
    "docId",
    "ERR_SOCIAL_COLLAB_DOCUMENT_ID",
  );
}

function assertSocialPeerId(peerId, boundaries) {
  return assertBoundedId(
    peerId,
    boundaries.maxPeerIdBytes,
    "peerId",
    "ERR_SOCIAL_COLLAB_PEER_ID",
  );
}

function normalizeSocialCollabUpdate(update, boundaries) {
  let normalized;
  if (Buffer.isBuffer(update) || update instanceof Uint8Array) {
    normalized = new Uint8Array(update);
  } else if (Array.isArray(update)) {
    if (
      update.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    ) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_UPDATE_INVALID",
        "Social collaboration updates may only contain byte values",
      );
    }
    normalized = Uint8Array.from(update);
  } else {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_UPDATE_INVALID",
      "Social collaboration update must be a byte array",
    );
  }
  if (
    normalized.byteLength === 0 ||
    normalized.byteLength > boundaries.maxUpdateBytes
  ) {
    throw new SocialCollabBoundaryError(
      normalized.byteLength === 0
        ? "ERR_SOCIAL_COLLAB_UPDATE_INVALID"
        : "ERR_SOCIAL_COLLAB_UPDATE_TOO_LARGE",
      `Social collaboration update must contain 1-${boundaries.maxUpdateBytes} bytes`,
      {
        byteLength: normalized.byteLength,
        limitBytes: boundaries.maxUpdateBytes,
      },
    );
  }
  return normalized;
}

function normalizeSocialCollabMessage(message, boundaries) {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      "Social collaboration message must be an object",
    );
  }
  const unknownKeys = Object.keys(message).filter(
    (key) => !MESSAGE_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      `Unknown social collaboration message keys: ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }
  if (!SOCIAL_COLLAB_MESSAGE_TYPE_SET.has(message.type)) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      "Unknown social collaboration message type",
      { type: message.type },
    );
  }
  const docId = assertSocialDocumentId(message.docId, boundaries);
  if (
    message.timestamp !== undefined &&
    (!Number.isFinite(message.timestamp) || message.timestamp < 0)
  ) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      "Social collaboration timestamp must be a non-negative finite number",
    );
  }
  const needsUpdate =
    message.type === SOCIAL_COLLAB_MESSAGE_TYPES.UPDATE ||
    message.type === SOCIAL_COLLAB_MESSAGE_TYPES.FULL_STATE_RESPONSE;
  if (!needsUpdate && message.data !== undefined) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      `${message.type} must not contain update data`,
    );
  }
  return {
    ...message,
    docId,
    ...(needsUpdate
      ? {
          data: Array.from(
            normalizeSocialCollabUpdate(message.data, boundaries),
          ),
        }
      : {}),
  };
}

function serializeSocialCollabMessage(message, boundaries) {
  const normalized = normalizeSocialCollabMessage(message, boundaries);
  const payload = Buffer.from(JSON.stringify(normalized), "utf8");
  if (payload.byteLength > boundaries.maxMessageBytes) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_TOO_LARGE",
      `Social collaboration message exceeds ${boundaries.maxMessageBytes} bytes`,
      {
        byteLength: payload.byteLength,
        limitBytes: boundaries.maxMessageBytes,
      },
    );
  }
  return payload;
}

function parseSocialCollabMessage(payload, boundaries) {
  if (!Buffer.isBuffer(payload) || payload.byteLength === 0) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      "Social collaboration payload must not be empty",
    );
  }
  if (payload.byteLength > boundaries.maxMessageBytes) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_TOO_LARGE",
      `Social collaboration message exceeds ${boundaries.maxMessageBytes} bytes`,
      {
        byteLength: payload.byteLength,
        limitBytes: boundaries.maxMessageBytes,
      },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch (_error) {
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_MESSAGE_INVALID",
      "Social collaboration payload is not valid JSON",
    );
  }
  return normalizeSocialCollabMessage(parsed, boundaries);
}

module.exports = {
  SOCIAL_COLLAB_MESSAGE_TYPES,
  DEFAULT_SOCIAL_COLLAB_BOUNDARIES,
  HARD_SOCIAL_COLLAB_BOUNDARIES,
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  assertSocialDocumentId,
  assertSocialPeerId,
  normalizeSocialCollabUpdate,
  normalizeSocialCollabMessage,
  serializeSocialCollabMessage,
  parseSocialCollabMessage,
};
