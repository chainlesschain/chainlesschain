const DEFAULT_LIMITS = Object.freeze({
  maxActiveStreams: 8,
  maxRetainedStreams: 32,
  maxChunksPerStream: 2048,
  maxBytesPerStream: 1024 * 1024,
  maxTotalBufferedBytes: 16 * 1024 * 1024,
  retentionMs: 5 * 60 * 1000,
});

const HARD_LIMITS = Object.freeze({
  maxActiveStreams: 256,
  maxRetainedStreams: 1024,
  maxChunksPerStream: 65536,
  maxBytesPerStream: 32 * 1024 * 1024,
  maxTotalBufferedBytes: 128 * 1024 * 1024,
  retentionMs: 30 * 60 * 1000,
});

function boundedPositiveInteger(value, fallback, hardLimit) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), hardLimit);
}

function normalizeLimits(configured = {}) {
  if (!configured || typeof configured !== "object") {
    configured = {};
  }

  const maxActiveStreams = boundedPositiveInteger(
    configured.maxActiveStreams,
    DEFAULT_LIMITS.maxActiveStreams,
    HARD_LIMITS.maxActiveStreams,
  );
  const maxBytesPerStream = boundedPositiveInteger(
    configured.maxBytesPerStream,
    DEFAULT_LIMITS.maxBytesPerStream,
    HARD_LIMITS.maxBytesPerStream,
  );

  return Object.freeze({
    maxActiveStreams,
    maxRetainedStreams: Math.max(
      maxActiveStreams,
      boundedPositiveInteger(
        configured.maxRetainedStreams,
        DEFAULT_LIMITS.maxRetainedStreams,
        HARD_LIMITS.maxRetainedStreams,
      ),
    ),
    maxChunksPerStream: boundedPositiveInteger(
      configured.maxChunksPerStream,
      DEFAULT_LIMITS.maxChunksPerStream,
      HARD_LIMITS.maxChunksPerStream,
    ),
    maxBytesPerStream,
    maxTotalBufferedBytes: Math.max(
      maxBytesPerStream,
      boundedPositiveInteger(
        configured.maxTotalBufferedBytes,
        DEFAULT_LIMITS.maxTotalBufferedBytes,
        HARD_LIMITS.maxTotalBufferedBytes,
      ),
    ),
    retentionMs: boundedPositiveInteger(
      configured.retentionMs,
      DEFAULT_LIMITS.retentionMs,
      HARD_LIMITS.retentionMs,
    ),
  });
}

function createOverloadError(scope, limits) {
  const error = new Error(`Polling stream admission overloaded (${scope})`);
  error.code = "OVERLOADED";
  error.scope = scope;
  error.retryAfterMs = 1000;
  error.limits = { ...limits };
  return error;
}

function createStreamIdError(streamId) {
  const printableStreamId =
    typeof streamId === "string" ? JSON.stringify(streamId) : typeof streamId;
  const error = new Error(
    `Polling stream id is invalid or active: ${printableStreamId}`,
  );
  error.code = "STREAM_ID_CONFLICT";
  error.streamId = streamId;
  return error;
}

class BoundedPollStreamRegistry {
  constructor(options = {}) {
    this.limits = normalizeLimits(options);
    this.states = new Map();
    this.activeCount = 0;
    this.totalBufferedBytes = 0;
    this.stats = {
      admitted: 0,
      completed: 0,
      overloaded: 0,
      evicted: 0,
      rejectedChunks: 0,
      rejectedBytes: 0,
    };
  }

  create(streamId, metadata = {}) {
    if (
      typeof streamId !== "string" ||
      streamId.length === 0 ||
      this.states.has(streamId)
    ) {
      throw createStreamIdError(streamId);
    }

    this._evictSettledForSlots(1);

    if (this.activeCount >= this.limits.maxActiveStreams) {
      this.stats.overloaded += 1;
      throw createOverloadError("active_streams", this.limits);
    }
    if (this.states.size >= this.limits.maxRetainedStreams) {
      this.stats.overloaded += 1;
      throw createOverloadError("retained_streams", this.limits);
    }

    const state = {
      ...metadata,
      streamId,
      chunks: [],
      bufferedBytes: 0,
      done: false,
      cancelled: false,
      error: null,
      errorCode: null,
      acceptingChunks: true,
      providerSettled: false,
      admissionReleased: false,
      cleanupTimer: null,
      startedAt: Date.now(),
      completedAt: null,
    };
    this.states.set(streamId, state);
    this.activeCount += 1;
    this.stats.admitted += 1;
    return state;
  }

  append(state, text) {
    if (
      !state ||
      this.states.get(state.streamId) !== state ||
      state.cancelled ||
      state.providerSettled ||
      !state.acceptingChunks ||
      typeof text !== "string" ||
      text.length === 0
    ) {
      return false;
    }

    const chunkBytes = Buffer.byteLength(text, "utf8");
    const nextChunkCount = state.chunks.length + 1;
    const nextBufferedBytes = state.bufferedBytes + chunkBytes;
    this._evictSettledForBytes(chunkBytes, state);
    const nextTotalBufferedBytes = this.totalBufferedBytes + chunkBytes;
    if (
      nextChunkCount > this.limits.maxChunksPerStream ||
      nextBufferedBytes > this.limits.maxBytesPerStream ||
      nextTotalBufferedBytes > this.limits.maxTotalBufferedBytes
    ) {
      state.acceptingChunks = false;
      state.done = true;
      state.errorCode = "STREAM_BUFFER_LIMIT_EXCEEDED";
      state.error = "Polling stream buffer limit exceeded";
      state.limit = {
        maxChunks: this.limits.maxChunksPerStream,
        maxBytes: this.limits.maxBytesPerStream,
        maxTotalBytes: this.limits.maxTotalBufferedBytes,
      };
      state.received = {
        chunks: nextChunkCount,
        bytes: nextBufferedBytes,
        totalBytes: nextTotalBufferedBytes,
      };
      this.stats.rejectedChunks += 1;
      this.stats.rejectedBytes += chunkBytes;
      return false;
    }

    state.chunks.push(text);
    state.bufferedBytes = nextBufferedBytes;
    this.totalBufferedBytes = nextTotalBufferedBytes;
    return true;
  }

  cancel(state) {
    if (!state || this.states.get(state.streamId) !== state) {
      return false;
    }

    state.cancelled = true;
    state.done = true;
    state.acceptingChunks = false;
    return true;
  }

  settle(streamId, state, error = null) {
    if (
      !state ||
      this.states.get(streamId) !== state ||
      state.providerSettled
    ) {
      return false;
    }

    state.providerSettled = true;
    state.acceptingChunks = false;
    state.done = true;
    state.completedAt = Date.now();
    if (error && !state.cancelled && !state.error) {
      state.error = error.message || String(error);
      state.errorCode = error.code || "STREAM_PROVIDER_ERROR";
    }
    if (!state.admissionReleased) {
      state.admissionReleased = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.stats.completed += 1;
    }

    state.cleanupTimer = setTimeout(() => {
      this._deleteRecord(streamId, state);
    }, this.limits.retentionMs);
    state.cleanupTimer.unref?.();
    return true;
  }

  _evictSettledForSlots(requiredSlots) {
    const targetSize = Math.max(
      0,
      this.limits.maxRetainedStreams - requiredSlots,
    );

    for (const [streamId, state] of this.states) {
      if (this.states.size <= targetSize) {
        break;
      }
      if (state.providerSettled) {
        this._deleteRecord(streamId, state, true);
      }
    }
  }

  _evictSettledForBytes(requiredBytes, currentState) {
    for (const [streamId, state] of this.states) {
      if (
        this.totalBufferedBytes + requiredBytes <=
        this.limits.maxTotalBufferedBytes
      ) {
        break;
      }
      if (state !== currentState && state.providerSettled) {
        this._deleteRecord(streamId, state, true);
      }
    }
  }

  _deleteRecord(streamId, state, evicted = false) {
    if (!state || this.states.get(streamId) !== state) {
      return false;
    }

    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
      state.cleanupTimer = null;
    }
    this.states.delete(streamId);
    this.totalBufferedBytes = Math.max(
      0,
      this.totalBufferedBytes - state.bufferedBytes,
    );
    state.chunks.length = 0;
    state.bufferedBytes = 0;
    if (evicted) {
      this.stats.evicted += 1;
    }
    return true;
  }
}

module.exports = {
  BoundedPollStreamRegistry,
  DEFAULT_LIMITS,
  HARD_LIMITS,
  normalizeLimits,
};
/**
 * Bounded state store for request/poll streaming protocols.
 *
 * Provider admission is released only by physical settlement. Logical cancel
 * and buffer overflow stop accepting chunks but keep the provider slot fenced
 * until the producer promise actually settles.
 */
