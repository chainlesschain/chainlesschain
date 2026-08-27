const DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS = Object.freeze({
  maxActiveControllers: 64,
  maxStreamIdBytes: 256,
  retryAfterMs: 1000,
});

const HARD_STREAM_CONTROLLER_REGISTRY_LIMITS = Object.freeze({
  maxActiveControllers: 512,
  maxStreamIdBytes: 1024,
  retryAfterMs: 60_000,
});

const TERMINAL_STREAM_STATUSES = new Set(["completed", "cancelled", "error"]);

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createRegistryError(result) {
  const error = new Error(result.error);
  Object.assign(error, result);
  return error;
}

class StreamControllerRegistry {
  constructor(options = {}) {
    this.limits = Object.freeze({
      maxActiveControllers: normalizeLimit(
        options.maxActiveControllers,
        DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS.maxActiveControllers,
        HARD_STREAM_CONTROLLER_REGISTRY_LIMITS.maxActiveControllers,
      ),
      maxStreamIdBytes: normalizeLimit(
        options.maxStreamIdBytes,
        DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS.maxStreamIdBytes,
        HARD_STREAM_CONTROLLER_REGISTRY_LIMITS.maxStreamIdBytes,
      ),
      retryAfterMs: normalizeLimit(
        options.retryAfterMs,
        DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS.retryAfterMs,
        HARD_STREAM_CONTROLLER_REGISTRY_LIMITS.retryAfterMs,
      ),
    });
    this.controllers = new Map();
    this.cleanupTimers = new Map();
  }

  validateStreamId(streamId) {
    if (typeof streamId !== "string" || streamId.length === 0) {
      return {
        accepted: false,
        error: "streamId must be a non-empty string",
        code: "INVALID_ARGUMENT",
      };
    }
    if (Buffer.byteLength(streamId, "utf8") > this.limits.maxStreamIdBytes) {
      return {
        accepted: false,
        error: "streamId is too large",
        code: "OVERLOADED",
        scope: "stream_controller_id",
        retryAfterMs: this.limits.retryAfterMs,
        limit: { maxStreamIdBytes: this.limits.maxStreamIdBytes },
      };
    }
    return { accepted: true, streamId };
  }

  getOrCreate(streamId, factory) {
    const validation = this.validateStreamId(streamId);
    if (!validation.accepted) {
      throw createRegistryError(validation);
    }
    const existing = this.controllers.get(streamId);
    if (existing) {
      return { controller: existing, created: false };
    }
    if (typeof factory !== "function") {
      throw createRegistryError({
        accepted: false,
        error: "Stream controller factory is required",
        code: "INVALID_ARGUMENT",
      });
    }
    while (this.controllers.size >= this.limits.maxActiveControllers) {
      if (!this.evictOldestTerminal()) {
        throw createRegistryError({
          accepted: false,
          error: "Stream controller capacity exceeded",
          code: "OVERLOADED",
          scope: "stream_controllers",
          retryAfterMs: this.limits.retryAfterMs,
          limit: { maxActiveControllers: this.limits.maxActiveControllers },
        });
      }
    }
    const controller = factory();
    if (!controller || typeof controller !== "object") {
      throw createRegistryError({
        accepted: false,
        error: "Stream controller factory returned an invalid controller",
        code: "INVALID_ARGUMENT",
      });
    }
    this.controllers.set(streamId, controller);
    return { controller, created: true };
  }

  isTerminal(controller) {
    return TERMINAL_STREAM_STATUSES.has(controller?.status);
  }

  evictOldestTerminal() {
    for (const [streamId, controller] of this.controllers.entries()) {
      if (this.isTerminal(controller)) {
        controller.removeAllListeners?.();
        this.delete(streamId);
        return true;
      }
    }
    return false;
  }

  get(streamId) {
    return this.controllers.get(streamId);
  }

  has(streamId) {
    return this.controllers.has(streamId);
  }

  delete(streamId) {
    if (this.cleanupTimers.has(streamId)) {
      const cleanupTimer = this.cleanupTimers.get(streamId);
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(streamId);
    }
    return this.controllers.delete(streamId);
  }

  scheduleTerminalDelete(streamId, delayMs = 30_000) {
    const controller = this.controllers.get(streamId);
    if (!controller || !this.isTerminal(controller)) {
      return false;
    }

    if (this.cleanupTimers.has(streamId)) {
      const existingTimer = this.cleanupTimers.get(streamId);
      clearTimeout(existingTimer);
    }
    let requestedDelayMs;
    try {
      requestedDelayMs = Number(delayMs);
    } catch {
      requestedDelayMs = 30_000;
    }
    const boundedDelayMs = Number.isFinite(requestedDelayMs)
      ? Math.max(0, Math.min(requestedDelayMs, 60_000))
      : 30_000;
    const cleanupTimer = setTimeout(() => {
      this.cleanupTimers.delete(streamId);
      const retainedController = this.controllers.get(streamId);
      if (this.isTerminal(retainedController)) {
        retainedController.removeAllListeners?.();
        this.controllers.delete(streamId);
      }
    }, boundedDelayMs);
    cleanupTimer.unref?.();
    this.cleanupTimers.set(streamId, cleanupTimer);
    return true;
  }

  entries() {
    return this.controllers.entries();
  }

  get size() {
    return this.controllers.size;
  }

  destroyAll() {
    for (const cleanupTimer of this.cleanupTimers.values()) {
      clearTimeout(cleanupTimer);
    }
    this.cleanupTimers.clear();
    for (const controller of this.controllers.values()) {
      controller.removeAllListeners?.();
      try {
        controller.destroy?.();
      } catch {
        // Continue releasing the remaining bounded registry entries.
      }
    }
    this.controllers.clear();
  }

  getStats() {
    return {
      activeControllers: this.controllers.size,
      scheduledCleanups: this.cleanupTimers.size,
      limits: this.limits,
    };
  }
}

module.exports = {
  DEFAULT_STREAM_CONTROLLER_REGISTRY_LIMITS,
  HARD_STREAM_CONTROLLER_REGISTRY_LIMITS,
  StreamControllerRegistry,
};
