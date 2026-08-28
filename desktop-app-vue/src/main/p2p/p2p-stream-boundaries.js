const DEFAULT_P2P_STREAM_LIMITS = Object.freeze({
  maxMessageBytes: 4 * 1024 * 1024,
  maxChunks: 4_096,
  operationTimeoutMs: 15_000,
  maxInboundStreams: 32,
  maxBroadcastPeers: 32,
  maxProviderResults: 128,
  closeTimeoutMs: 5_000,
});

const HARD_P2P_STREAM_LIMITS = Object.freeze({
  maxMessageBytes: 16 * 1024 * 1024,
  maxChunks: 16_384,
  operationTimeoutMs: 120_000,
  maxInboundStreams: 256,
  maxBroadcastPeers: 256,
  maxProviderResults: 1_024,
  closeTimeoutMs: 30_000,
});

class P2PStreamBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "P2PStreamBoundaryError";
    this.code = code;
  }
}

const abortedStreams = new WeakSet();

function resolveP2PStreamLimits(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("p2p stream limits must be an object");
  }
  const knownKeys = new Set(Object.keys(DEFAULT_P2P_STREAM_LIMITS));
  for (const key of Object.keys(options)) {
    if (!knownKeys.has(key)) {
      throw new TypeError(`unknown p2p stream limit: ${key}`);
    }
  }

  const limits = { ...DEFAULT_P2P_STREAM_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > HARD_P2P_STREAM_LIMITS[key]
    ) {
      throw new TypeError(
        `${key} must be an integer between 1 and ${HARD_P2P_STREAM_LIMITS[key]}`,
      );
    }
  }
  return Object.freeze(limits);
}

function abortStream(stream, error) {
  if (!stream || (typeof stream !== "object" && typeof stream !== "function")) {
    return;
  }
  if (abortedStreams.has(stream)) {
    return;
  }
  abortedStreams.add(stream);
  try {
    stream?.abort?.(error);
  } catch (_error) {
    // Boundary cleanup must preserve the original error.
  }
}

function timeoutAfter(timeoutMs, onTimeout) {
  let timeoutHandle;
  const promise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new P2PStreamBoundaryError(
        "P2P_STREAM_TIMEOUT",
        `p2p stream operation exceeded ${timeoutMs}ms`,
      );
      onTimeout?.(error);
      reject(error);
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
  return {
    promise,
    clear() {
      clearTimeout(timeoutHandle);
    },
  };
}

async function runStreamOperationBounded(stream, operation, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const timeout = timeoutAfter(timeoutMs, (error) =>
    abortStream(stream, error),
  );
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout.promise,
    ]);
  } finally {
    timeout.clear();
  }
}

async function waitForStreamDrainBounded(stream, timeoutMs) {
  let cleanup = () => {};
  try {
    await runStreamOperationBounded(
      stream,
      () =>
        new Promise((resolve, reject) => {
          const onDrain = () => resolve();
          const onError = (error) => reject(error);
          cleanup = () => {
            stream.removeEventListener?.("drain", onDrain);
            stream.off?.("drain", onDrain);
            stream.off?.("error", onError);
          };
          if (typeof stream.addEventListener === "function") {
            stream.addEventListener("drain", onDrain, { once: true });
          } else if (typeof stream.once === "function") {
            stream.once("drain", onDrain);
            stream.once("error", onError);
          } else {
            reject(
              new TypeError("backpressured stream has no drain event API"),
            );
          }
        }),
      timeoutMs,
    );
  } finally {
    cleanup();
  }
}

function asChunkBuffer(chunk) {
  const value = chunk?.subarray ? chunk.subarray() : chunk;
  if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) {
    throw new P2PStreamBoundaryError(
      "P2P_STREAM_INVALID_CHUNK",
      "p2p stream yielded a non-byte chunk",
    );
  }
  return Buffer.from(value);
}

async function readBoundedStream(stream, configuredLimits = {}) {
  const limits = resolveP2PStreamLimits(configuredLimits);
  const source = stream?.source || stream;
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw new TypeError("p2p stream must expose an async iterator");
  }

  const iterator = source[Symbol.asyncIterator]();
  const chunks = [];
  let totalBytes = 0;
  let chunkCount = 0;
  const deadline = Date.now() + limits.operationTimeoutMs;

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new P2PStreamBoundaryError(
          "P2P_STREAM_TIMEOUT",
          `p2p stream read exceeded ${limits.operationTimeoutMs}ms`,
        );
      }
      const next = await runStreamOperationBounded(
        stream,
        () => iterator.next(),
        remainingMs,
      );
      if (next.done) {
        return Buffer.concat(chunks, totalBytes);
      }

      chunkCount += 1;
      if (chunkCount > limits.maxChunks) {
        throw new P2PStreamBoundaryError(
          "P2P_STREAM_TOO_MANY_CHUNKS",
          `p2p stream exceeded ${limits.maxChunks} chunks`,
        );
      }
      const chunk = asChunkBuffer(next.value);
      totalBytes += chunk.byteLength;
      if (totalBytes > limits.maxMessageBytes) {
        throw new P2PStreamBoundaryError(
          "P2P_STREAM_TOO_LARGE",
          `p2p stream exceeded ${limits.maxMessageBytes} bytes`,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    abortStream(stream, error);
    try {
      Promise.resolve(iterator.return?.()).catch(() => {});
    } catch (_returnError) {
      // Iterator cleanup is best effort after the stream has been aborted.
    }
    throw error;
  }
}

function assertBoundedPayload(payload, configuredLimits = {}) {
  const limits = resolveP2PStreamLimits(configuredLimits);
  const byteLength = Buffer.isBuffer(payload)
    ? payload.byteLength
    : payload instanceof Uint8Array
      ? payload.byteLength
      : Buffer.byteLength(String(payload), "utf8");
  if (byteLength > limits.maxMessageBytes) {
    throw new P2PStreamBoundaryError(
      "P2P_STREAM_TOO_LARGE",
      `p2p payload exceeded ${limits.maxMessageBytes} bytes`,
    );
  }
  return payload;
}

class P2PProtocolRegistry {
  constructor(node, configuredLimits = {}) {
    if (
      !node ||
      typeof node.handle !== "function" ||
      typeof node.unhandle !== "function"
    ) {
      throw new TypeError("p2p node must expose handle and unhandle");
    }
    this.node = node;
    this.limits = resolveP2PStreamLimits(configuredLimits);
    this.protocols = new Map();
    this.registrations = new Set();
    this.inFlight = new Set();
    this.activeStreams = new Set();
    this.closed = false;
    this.closePromise = null;
  }

  register(protocol, handler) {
    if (this.closed) {
      throw new P2PStreamBoundaryError(
        "P2P_REGISTRY_CLOSED",
        "p2p protocol registry is closed",
      );
    }
    if (typeof protocol !== "string" || protocol.length === 0) {
      throw new TypeError("protocol must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("protocol handler must be a function");
    }
    if (this.protocols.has(protocol)) {
      return false;
    }

    const wrapped = async (...args) => {
      const stream = args[0]?.stream || args[0];
      if (this.closed || this.inFlight.size >= this.limits.maxInboundStreams) {
        const error = new P2PStreamBoundaryError(
          this.closed ? "P2P_REGISTRY_CLOSED" : "P2P_STREAM_OVERLOADED",
          this.closed
            ? "p2p protocol registry is closed"
            : `p2p inbound concurrency exceeded ${this.limits.maxInboundStreams}`,
        );
        abortStream(stream, error);
        throw error;
      }

      this.activeStreams.add(stream);
      const task = Promise.resolve().then(() => handler(...args));
      this.inFlight.add(task);
      try {
        return await task;
      } finally {
        this.inFlight.delete(task);
        this.activeStreams.delete(stream);
      }
    };

    this.protocols.set(protocol, wrapped);
    let registration;
    try {
      registration = Promise.resolve(this.node.handle(protocol, wrapped));
    } catch (error) {
      this.protocols.delete(protocol);
      throw error;
    }
    this.registrations.add(registration);
    registration.then(
      () => this.registrations.delete(registration),
      () => {
        this.registrations.delete(registration);
        if (this.protocols.get(protocol) === wrapped) {
          this.protocols.delete(protocol);
        }
      },
    );
    return true;
  }

  async close() {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = this._close();
    return this.closePromise;
  }

  async _close() {
    const closeError = new P2PStreamBoundaryError(
      "P2P_REGISTRY_CLOSED",
      "p2p protocol registry closed during stream handling",
    );
    for (const stream of this.activeStreams) {
      abortStream(stream, closeError);
    }

    await Promise.allSettled([...this.registrations]);
    const protocols = [...this.protocols.keys()];
    this.protocols.clear();
    await Promise.allSettled(
      protocols.map((protocol) =>
        Promise.resolve().then(() => this.node.unhandle(protocol)),
      ),
    );

    const timeout = timeoutAfter(this.limits.closeTimeoutMs);
    try {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        timeout.promise.catch(() => undefined),
      ]);
    } finally {
      timeout.clear();
      this.inFlight.clear();
      this.activeStreams.clear();
    }
  }
}

module.exports = {
  DEFAULT_P2P_STREAM_LIMITS,
  HARD_P2P_STREAM_LIMITS,
  P2PProtocolRegistry,
  P2PStreamBoundaryError,
  assertBoundedPayload,
  readBoundedStream,
  resolveP2PStreamLimits,
  runStreamOperationBounded,
  waitForStreamDrainBounded,
};
