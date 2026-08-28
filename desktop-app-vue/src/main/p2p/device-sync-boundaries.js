const DEFAULT_DEVICE_SYNC_LIMITS = Object.freeze({
  maxQueueSize: 1_000,
  maxDevices: 128,
  maxTotalMessages: 4_096,
  maxMessageBytes: 256 * 1024,
  maxQueueBytes: 8 * 1024 * 1024,
  maxTotalQueueBytes: 32 * 1024 * 1024,
  maxStatusEntries: 4_096,
  maxStatusBytes: 16 * 1024,
  maxDeviceIdBytes: 512,
  maxPersistedBytes: 64 * 1024 * 1024,
  closeTimeoutMs: 5_000,
});

const HARD_DEVICE_SYNC_LIMITS = Object.freeze({
  maxQueueSize: 10_000,
  maxDevices: 1_024,
  maxTotalMessages: 50_000,
  maxMessageBytes: 4 * 1024 * 1024,
  maxQueueBytes: 64 * 1024 * 1024,
  maxTotalQueueBytes: 256 * 1024 * 1024,
  maxStatusEntries: 100_000,
  maxStatusBytes: 256 * 1024,
  maxDeviceIdBytes: 4_096,
  maxPersistedBytes: 512 * 1024 * 1024,
  closeTimeoutMs: 30_000,
});

class DeviceSyncBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeviceSyncBoundaryError";
    this.code = code;
  }
}

function resolveDeviceSyncLimits(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("device sync limits must be an object");
  }
  const knownKeys = new Set(Object.keys(DEFAULT_DEVICE_SYNC_LIMITS));
  for (const key of Object.keys(options)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`unknown device sync limit: ${key}`);
    }
  }
  const limits = { ...DEFAULT_DEVICE_SYNC_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > HARD_DEVICE_SYNC_LIMITS[key]
    ) {
      throw new TypeError(
        `${key} must be an integer between 1 and ${HARD_DEVICE_SYNC_LIMITS[key]}`,
      );
    }
  }
  if (limits.maxQueueSize > limits.maxTotalMessages) {
    throw new RangeError("maxQueueSize cannot exceed maxTotalMessages");
  }
  if (limits.maxQueueBytes > limits.maxTotalQueueBytes) {
    throw new RangeError("maxQueueBytes cannot exceed maxTotalQueueBytes");
  }
  if (limits.maxMessageBytes > limits.maxQueueBytes) {
    throw new RangeError("maxMessageBytes cannot exceed maxQueueBytes");
  }
  if (limits.maxStatusEntries < limits.maxTotalMessages) {
    throw new RangeError("maxStatusEntries cannot be below maxTotalMessages");
  }
  return Object.freeze(limits);
}

function assertDeviceId(deviceId, limits) {
  if (
    typeof deviceId !== "string" ||
    deviceId.length === 0 ||
    Buffer.byteLength(deviceId, "utf8") > limits.maxDeviceIdBytes
  ) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_INVALID_DEVICE_ID",
      "device id is missing or exceeds its byte limit",
    );
  }
  return deviceId;
}

function cloneBoundedMessage(message, limits) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_INVALID_MESSAGE",
      "queued message must be an object",
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(message);
  } catch (_error) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_INVALID_MESSAGE",
      "queued message must be JSON serializable",
    );
  }
  if (serialized === undefined) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_INVALID_MESSAGE",
      "queued message must be JSON serializable",
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > limits.maxMessageBytes) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_MESSAGE_TOO_LARGE",
      `queued message exceeded ${limits.maxMessageBytes} bytes`,
    );
  }
  return { value: JSON.parse(serialized), byteLength };
}

async function readBoundedJsonFile(fsp, filePath, limits) {
  if (typeof fsp.stat === "function") {
    const stats = await fsp.stat(filePath);
    if (stats.size > limits.maxPersistedBytes) {
      throw new DeviceSyncBoundaryError(
        "DEVICE_SYNC_FILE_TOO_LARGE",
        `persisted device sync file exceeded ${limits.maxPersistedBytes} bytes`,
      );
    }
  }
  const content = await fsp.readFile(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > limits.maxPersistedBytes) {
    throw new DeviceSyncBoundaryError(
      "DEVICE_SYNC_FILE_TOO_LARGE",
      `persisted device sync file exceeded ${limits.maxPersistedBytes} bytes`,
    );
  }
  return JSON.parse(content);
}

module.exports = {
  DEFAULT_DEVICE_SYNC_LIMITS,
  HARD_DEVICE_SYNC_LIMITS,
  DeviceSyncBoundaryError,
  assertDeviceId,
  cloneBoundedMessage,
  readBoundedJsonFile,
  resolveDeviceSyncLimits,
};
