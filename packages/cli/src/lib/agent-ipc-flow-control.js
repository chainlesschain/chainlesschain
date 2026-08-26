export const AGENT_IPC_DEFAULT_LIMITS = Object.freeze({
  maxAgents: 64,
  maxPendingInteractions: 128,
  maxPendingInteractionsPerAgent: 16,
  maxPendingAgentRequests: 256,
  maxPendingAgentRequestsPerAgent: 32,
  maxStdoutLineBytes: 1024 * 1024,
  maxStderrChunkBytes: 64 * 1024,
  maxStdinFrameBytes: 1024 * 1024,
  maxStdinQueueMessages: 128,
  maxStdinQueueBytes: 4 * 1024 * 1024,
  interactionTimeoutMs: 5 * 60 * 1000,
  maxInteractionTimeoutMs: 10 * 60 * 1000,
  agentRequestTimeoutMs: 30 * 1000,
  maxAgentRequestTimeoutMs: 2 * 60 * 1000,
  agentInitTimeoutMs: 10 * 1000,
  maxAgentInitTimeoutMs: 2 * 60 * 1000,
  agentHeartbeatMs: 30 * 1000,
  maxAgentHeartbeatMs: 2 * 60 * 1000,
  overloadRetryAfterMs: 1000,
});

export function positiveInteger(value, fallback, name) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return candidate;
}

export function boundedTimeout(value, fallback, maximum) {
  const normalized = positiveInteger(value, fallback, "timeoutMs");
  return Math.min(normalized, maximum);
}

export function overloadError(resource, limit, retryAfterMs) {
  const error = new Error(
    `Agent IPC overloaded: ${resource} reached its limit of ${limit}`,
  );
  error.code = "OVERLOADED";
  error.retryAfterMs = retryAfterMs;
  error.data = {
    resource,
    limit,
    retry_after_ms: retryAfterMs,
  };
  return error;
}

export function normalizeAgentIPCLimits(limits = {}) {
  const normalized = {};
  for (const [name, fallback] of Object.entries(AGENT_IPC_DEFAULT_LIMITS)) {
    normalized[name] = positiveInteger(limits[name], fallback, name);
  }
  return Object.freeze(normalized);
}

/**
 * A bounded JSONL writer for one child stdin stream. The first write that
 * returns false marks the transport blocked; later frames enter an explicit
 * message/byte-capped queue until Node emits drain.
 */
export function createBoundedStdinWriter({
  child,
  agentId,
  limits,
  onOverload,
}) {
  const queue = [];
  let queuedBytes = 0;
  let blocked = false;
  let closed = false;

  const cleanupListeners = () => {
    child.stdin.off?.("drain", flush);
    child.stdin.off?.("error", handleError);
    child.stdin.off?.("close", handleClose);
  };

  const fail = (error) => {
    if (closed) return;
    closed = true;
    blocked = false;
    queue.length = 0;
    queuedBytes = 0;
    cleanupListeners();
    queueMicrotask(() => onOverload(error));
  };

  const writePayload = (payload) => {
    if (closed) {
      throw new Error(`Agent ${agentId} stdin transport is closed`);
    }
    if (child.stdin.destroyed || child.stdin.writableEnded) {
      const error = new Error(`Agent ${agentId} stdin is not writable`);
      fail(error);
      throw error;
    }
    const bytes = Buffer.byteLength(payload);
    if (bytes > limits.maxStdinFrameBytes) {
      const error = overloadError(
        "stdin_frame_bytes",
        limits.maxStdinFrameBytes,
        limits.overloadRetryAfterMs,
      );
      fail(error);
      throw error;
    }

    if (blocked || queue.length > 0) {
      if (
        queue.length >= limits.maxStdinQueueMessages ||
        queuedBytes + bytes > limits.maxStdinQueueBytes
      ) {
        const resource =
          queue.length >= limits.maxStdinQueueMessages
            ? "stdin_queue_messages"
            : "stdin_queue_bytes";
        const limit =
          resource === "stdin_queue_messages"
            ? limits.maxStdinQueueMessages
            : limits.maxStdinQueueBytes;
        const error = overloadError(
          resource,
          limit,
          limits.overloadRetryAfterMs,
        );
        fail(error);
        throw error;
      }
      queue.push({ payload, bytes });
      queuedBytes += bytes;
      return true;
    }

    try {
      blocked = child.stdin.write(payload) === false;
    } catch (error) {
      fail(error);
      throw error;
    }
    return true;
  };

  const flush = () => {
    if (closed) return;
    blocked = false;
    while (queue.length > 0 && !blocked) {
      const entry = queue.shift();
      queuedBytes -= entry.bytes;
      try {
        blocked = child.stdin.write(entry.payload) === false;
      } catch (error) {
        fail(error);
        return;
      }
    }
  };

  const handleError = (error) => {
    if (!closed) fail(error);
  };

  const handleClose = () => {
    if (
      !closed &&
      child.exitCode === null &&
      (child.signalCode === null || child.signalCode === undefined)
    ) {
      fail(new Error(`Agent ${agentId} stdin closed before process exit`));
    }
  };

  child.stdin.on?.("drain", flush);
  child.stdin.on?.("error", handleError);
  child.stdin.on?.("close", handleClose);

  return {
    write(message) {
      const payload = `${JSON.stringify(message)}\n`;
      return writePayload(payload);
    },
    close() {
      if (closed) return;
      closed = true;
      blocked = false;
      queue.length = 0;
      queuedBytes = 0;
      cleanupListeners();
    },
    status() {
      return {
        blocked,
        closed,
        queuedMessages: queue.length,
        queuedBytes,
      };
    },
  };
}
