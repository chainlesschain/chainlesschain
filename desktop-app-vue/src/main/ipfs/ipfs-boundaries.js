"use strict";

const MiB = 1024 * 1024;

const DEFAULT_IPFS_BOUNDARIES = Object.freeze({
  maxContentBytes: 64 * MiB,
  maxIpcContentBytes: 16 * MiB,
  maxMetadataBytes: 64 * 1024,
  maxFilenameBytes: 1024,
  maxIdentifierBytes: 512,
  maxPathBytes: 4096,
  maxConcurrentReads: 4,
  maxConcurrentWrites: 2,
  maxReadChunks: 8192,
  readTimeoutMs: 30_000,
  listLimit: 50,
  maxListLimit: 500,
  retryAfterMs: 1000,
});

const HARD_IPFS_BOUNDARIES = Object.freeze({
  maxContentBytes: 256 * MiB,
  maxIpcContentBytes: 64 * MiB,
  maxMetadataBytes: MiB,
  maxFilenameBytes: 4096,
  maxIdentifierBytes: 4096,
  maxPathBytes: 32_768,
  maxConcurrentReads: 32,
  maxConcurrentWrites: 16,
  maxReadChunks: 65_536,
  readTimeoutMs: 5 * 60_000,
  listLimit: 1000,
  maxListLimit: 1000,
  retryAfterMs: 60_000,
});

class IPFSBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IPFSBoundaryError";
    this.code = code;
    Object.assign(this, details);
  }
}

function normalizePositiveInteger(value, key, hardLimit) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      `${key} must be a positive safe integer`,
    );
  }
  if (value > hardLimit) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      `${key} exceeds hard limit ${hardLimit}`,
      { hardLimit },
    );
  }
  return value;
}

function resolveIPFSBoundaries(overrides = {}) {
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    Array.isArray(overrides)
  ) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      "IPFS boundary overrides must be an object",
    );
  }

  const unknownKeys = Object.keys(overrides).filter(
    (key) => !Object.hasOwn(DEFAULT_IPFS_BOUNDARIES, key),
  );
  if (unknownKeys.length > 0) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      `Unknown IPFS boundary override(s): ${unknownKeys.join(", ")}`,
      { unknownKeys },
    );
  }

  const resolved = {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_IPFS_BOUNDARIES)) {
    const value = overrides[key] ?? defaultValue;
    resolved[key] = normalizePositiveInteger(
      value,
      key,
      HARD_IPFS_BOUNDARIES[key],
    );
  }

  if (resolved.maxIpcContentBytes > resolved.maxContentBytes) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      "maxIpcContentBytes cannot exceed maxContentBytes",
    );
  }
  if (resolved.listLimit > resolved.maxListLimit) {
    throw new IPFSBoundaryError(
      "INVALID_CONFIG",
      "listLimit cannot exceed maxListLimit",
    );
  }

  return Object.freeze(resolved);
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function createOverloadedError(boundaries, reason = "read admission full") {
  return new IPFSBoundaryError(
    "OVERLOADED",
    `IPFS request overloaded: ${reason}`,
    {
      reason,
      retryAfterMs: boundaries.retryAfterMs,
    },
  );
}

function validateBoundedText(
  boundaries,
  value,
  label,
  { required = true, maxBytes = boundaries.maxIdentifierBytes } = {},
) {
  if (value === null || value === undefined || value === "") {
    if (!required) return null;
    throw new IPFSBoundaryError("INVALID_ARGUMENT", `${label} is required`);
  }
  if (typeof value !== "string") {
    throw new IPFSBoundaryError(
      "INVALID_ARGUMENT",
      `${label} must be a string`,
    );
  }
  if (utf8Bytes(value) > maxBytes) {
    throw new IPFSBoundaryError(
      "PAYLOAD_TOO_LARGE",
      `${label} exceeds ${maxBytes} UTF-8 bytes`,
      { limitBytes: maxBytes },
    );
  }
  return value;
}

function validateFilename(boundaries, filename) {
  return validateBoundedText(boundaries, filename, "filename", {
    required: false,
    maxBytes: boundaries.maxFilenameBytes,
  });
}

function serializeMetadata(boundaries, metadata) {
  let serialized;
  try {
    serialized = JSON.stringify(metadata ?? {});
  } catch (error) {
    throw new IPFSBoundaryError(
      "INVALID_ARGUMENT",
      `metadata must be JSON serializable: ${error.message}`,
    );
  }
  if (serialized === undefined) {
    throw new IPFSBoundaryError(
      "INVALID_ARGUMENT",
      "metadata must be JSON serializable",
    );
  }
  if (utf8Bytes(serialized) > boundaries.maxMetadataBytes) {
    throw new IPFSBoundaryError(
      "PAYLOAD_TOO_LARGE",
      `metadata exceeds ${boundaries.maxMetadataBytes} UTF-8 bytes`,
      { limitBytes: boundaries.maxMetadataBytes },
    );
  }
  return serialized;
}

function normalizeContent(boundaries, content) {
  let byteLength;
  let createBuffer;

  if (Buffer.isBuffer(content)) {
    byteLength = content.length;
    createBuffer = () => content;
  } else if (typeof content === "string") {
    byteLength = utf8Bytes(content);
    createBuffer = () => Buffer.from(content, "utf8");
  } else if (ArrayBuffer.isView(content)) {
    byteLength = content.byteLength;
    createBuffer = () =>
      Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  } else if (content instanceof ArrayBuffer) {
    byteLength = content.byteLength;
    createBuffer = () => Buffer.from(content);
  } else {
    throw new IPFSBoundaryError(
      "INVALID_ARGUMENT",
      "content must be a string, Buffer, ArrayBuffer, or typed array",
    );
  }

  if (byteLength > boundaries.maxContentBytes) {
    throw new IPFSBoundaryError(
      "PAYLOAD_TOO_LARGE",
      `content exceeds ${boundaries.maxContentBytes} bytes`,
      { limitBytes: boundaries.maxContentBytes },
    );
  }
  return createBuffer();
}

function resolveReadMaxBytes(boundaries, requestedMaxBytes) {
  if (requestedMaxBytes === undefined || requestedMaxBytes === null) {
    return boundaries.maxContentBytes;
  }
  if (
    !Number.isSafeInteger(requestedMaxBytes) ||
    requestedMaxBytes <= 0 ||
    requestedMaxBytes > boundaries.maxContentBytes
  ) {
    throw new IPFSBoundaryError(
      "INVALID_ARGUMENT",
      `maxBytes must be a positive integer no greater than ${boundaries.maxContentBytes}`,
      { limitBytes: boundaries.maxContentBytes },
    );
  }
  return requestedMaxBytes;
}

module.exports = {
  DEFAULT_IPFS_BOUNDARIES,
  HARD_IPFS_BOUNDARIES,
  IPFSBoundaryError,
  resolveIPFSBoundaries,
  utf8Bytes,
  createOverloadedError,
  validateBoundedText,
  validateFilename,
  serializeMetadata,
  normalizeContent,
  resolveReadMaxBytes,
};
