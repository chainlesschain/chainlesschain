const DEFAULT_CLOSE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_IN_FLIGHT = 64;

/**
 * Own listeners registered on a longer-lived EventEmitter-like source.
 *
 * Managers may remove their own listeners with removeAllListeners(), but that
 * does not detach callbacks registered on P2PManager. This helper keeps the
 * exact wrapper identities, rejects new delivery after close starts, and gives
 * already-admitted async handlers a bounded drain window.
 */
class OwnedSourceListeners {
  constructor(
    source,
    {
      logger,
      label = "OwnedSourceListeners",
      closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
      maxInFlight = DEFAULT_MAX_IN_FLIGHT,
    } = {},
  ) {
    if (!Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs <= 0) {
      throw new TypeError(
        `[${label}] closeTimeoutMs must be a positive integer`,
      );
    }
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight <= 0) {
      throw new TypeError(`[${label}] maxInFlight must be a positive integer`);
    }
    this.source = source || null;
    this.logger = logger || null;
    this.label = label;
    this.closeTimeoutMs = closeTimeoutMs;
    this.maxInFlight = maxInFlight;
    this.listeners = new Map();
    this.inFlight = new Set();
    this.closed = false;
    this.closePromise = null;
  }

  listen(eventName, handler) {
    if (this.closed) {
      throw new Error(`[${this.label}] listener owner is closed`);
    }
    if (!this.source) {
      return null;
    }
    const eventEmitterSource =
      typeof this.source.on === "function" &&
      (typeof this.source.off === "function" ||
        typeof this.source.removeListener === "function");
    const eventTargetSource =
      typeof this.source.addEventListener === "function" &&
      typeof this.source.removeEventListener === "function";
    if (!eventEmitterSource && !eventTargetSource) {
      throw new Error(
        `[${this.label}] source must support detachable listeners`,
      );
    }
    if (this.listeners.has(eventName)) {
      return this.listeners.get(eventName);
    }

    const listener = (...args) => {
      if (this.closed) {
        return;
      }
      if (this.inFlight.size >= this.maxInFlight) {
        this.logger?.warn?.(
          `[${this.label}] ${eventName} delivery dropped: in-flight limit ${this.maxInFlight} reached`,
        );
        return;
      }

      // Invoke immediately so EventEmitter delivery keeps its existing
      // synchronous-before-first-await semantics while still normalizing
      // throws and returned values into one tracked promise.
      const task = (async () => handler(...args))();
      this.inFlight.add(task);
      void task
        .catch((error) => {
          this.logger?.warn?.(
            `[${this.label}] ${eventName} handler failed:`,
            error?.message || error,
          );
        })
        .finally(() => {
          this.inFlight.delete(task);
        });
    };

    if (eventEmitterSource) {
      this.source.on(eventName, listener);
    } else {
      this.source.addEventListener(eventName, listener);
    }
    this.listeners.set(eventName, listener);
    return listener;
  }

  async close() {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;
    for (const [eventName, listener] of this.listeners) {
      try {
        if (typeof this.source?.off === "function") {
          this.source.off(eventName, listener);
        } else if (typeof this.source?.removeListener === "function") {
          this.source?.removeListener?.(eventName, listener);
        } else {
          this.source?.removeEventListener?.(eventName, listener);
        }
      } catch (error) {
        this.logger?.warn?.(
          `[${this.label}] failed to detach ${eventName}:`,
          error?.message || error,
        );
      }
    }
    this.listeners.clear();

    this.closePromise = this._drainInFlight();
    return this.closePromise;
  }

  async _drainInFlight() {
    const pending = [...this.inFlight];
    if (pending.length === 0) {
      return true;
    }

    let timeoutHandle;
    const drained = await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), this.closeTimeoutMs);
        timeoutHandle.unref?.();
      }),
    ]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (!drained) {
      this.logger?.warn?.(
        `[${this.label}] timed out waiting for ${pending.length} in-flight handler(s)`,
      );
    }
    return drained;
  }
}

module.exports = {
  DEFAULT_CLOSE_TIMEOUT_MS,
  DEFAULT_MAX_IN_FLIGHT,
  OwnedSourceListeners,
};
