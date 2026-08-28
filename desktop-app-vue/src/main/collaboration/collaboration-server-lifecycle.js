const DEFAULT_COLLABORATION_SERVER_LIMITS = Object.freeze({
  maxConnections: 128,
  maxMessageBytes: 256 * 1024,
  maxPendingMessagesPerConnection: 32,
  maxPendingBytesPerConnection: 2 * 1024 * 1024,
  maxBufferedOutputBytes: 4 * 1024 * 1024,
  maxDocuments: 256,
  maxDocumentListeners: 64,
  maxDocumentIdBytes: 1_024,
  maxQueryLimit: 1_000,
});

const HARD_COLLABORATION_SERVER_LIMITS = Object.freeze({
  maxConnections: 2_048,
  maxMessageBytes: 4 * 1024 * 1024,
  maxPendingMessagesPerConnection: 256,
  maxPendingBytesPerConnection: 32 * 1024 * 1024,
  maxBufferedOutputBytes: 64 * 1024 * 1024,
  maxDocuments: 4_096,
  maxDocumentListeners: 1_024,
  maxDocumentIdBytes: 16 * 1024,
  maxQueryLimit: 10_000,
});

function resolveCollaborationServerLimits(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("collaboration server limits must be an object");
  }
  const knownKeys = new Set(Object.keys(DEFAULT_COLLABORATION_SERVER_LIMITS));
  for (const key of Object.keys(options)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`unknown collaboration server limit: ${key}`);
    }
  }
  const limits = { ...DEFAULT_COLLABORATION_SERVER_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > HARD_COLLABORATION_SERVER_LIMITS[key]
    ) {
      throw new TypeError(
        `${key} must be an integer between 1 and ${HARD_COLLABORATION_SERVER_LIMITS[key]}`,
      );
    }
  }
  if (
    limits.maxMessageBytes > limits.maxPendingBytesPerConnection ||
    limits.maxMessageBytes > limits.maxBufferedOutputBytes
  ) {
    throw new RangeError(
      "maxMessageBytes cannot exceed pending or buffered byte limits",
    );
  }
  return Object.freeze(limits);
}

function websocketDataBytes(data) {
  if (typeof data === "string") {
    return Buffer.byteLength(data, "utf8");
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return data.byteLength;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + websocketDataBytes(chunk), 0);
  }
  return Buffer.byteLength(String(data), "utf8");
}

function assertCollaborationDocumentId(documentId, limits) {
  if (
    typeof documentId !== "string" ||
    documentId.length === 0 ||
    Buffer.byteLength(documentId, "utf8") > limits.maxDocumentIdBytes
  ) {
    throw new TypeError("documentId is missing or exceeds its byte limit");
  }
  return documentId;
}

async function closeCollaborationServer({
  server,
  connections,
  logger,
  closeTimeoutMs = 5000,
}) {
  if (!Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs <= 0) {
    throw new TypeError(
      "[CollaborationManager] closeTimeoutMs must be a positive safe integer",
    );
  }

  const deadline = Date.now() + closeTimeoutMs;
  const connectionSnapshot = [...connections.values()];
  connectionSnapshot.forEach((conn) => {
    try {
      conn.ws.close();
    } catch (error) {
      logger?.warn?.(
        "[CollaborationManager] 连接关闭失败:",
        error?.message || error,
      );
    }
  });

  let timeoutHandle;
  let timedOut = false;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      logger?.info?.("[CollaborationManager] 服务器已停止");
      resolve();
    };
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      connectionSnapshot.forEach((conn) => {
        try {
          conn.ws.terminate?.();
        } catch (_error) {
          // Continue terminating the remaining clients.
        }
      });
      logger?.warn?.(
        `[CollaborationManager] server close timed out after ${closeTimeoutMs}ms`,
      );
      finish();
    }, closeTimeoutMs);
    timeoutHandle.unref?.();
    try {
      server.close(finish);
    } catch (error) {
      logger?.warn?.(
        "[CollaborationManager] WebSocket server close failed:",
        error?.message || error,
      );
      finish();
    }
  });

  if (!timedOut) {
    const pendingTasks = connectionSnapshot
      .map((connection) => connection.messageChain)
      .filter((task) => task && typeof task.then === "function");
    if (pendingTasks.length > 0) {
      const remainingMs = Math.max(1, deadline - Date.now());
      let drainTimeout;
      const drained = await Promise.race([
        Promise.allSettled(pendingTasks).then(() => true),
        new Promise((resolve) => {
          drainTimeout = setTimeout(() => resolve(false), remainingMs);
          drainTimeout.unref?.();
        }),
      ]);
      clearTimeout(drainTimeout);
      if (!drained) {
        timedOut = true;
        connectionSnapshot.forEach((connection) => connection.ws.terminate?.());
        logger?.warn?.(
          `[CollaborationManager] message drain timed out after ${closeTimeoutMs}ms`,
        );
      }
    }
  }

  return { timedOut };
}

module.exports = {
  DEFAULT_COLLABORATION_SERVER_LIMITS,
  HARD_COLLABORATION_SERVER_LIMITS,
  assertCollaborationDocumentId,
  closeCollaborationServer,
  resolveCollaborationServerLimits,
  websocketDataBytes,
};
