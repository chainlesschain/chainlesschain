export class QueueOverloadedError extends Error {
  constructor(message, { retryAfterMs = 100, limit, queued } = {}) {
    super(message);
    this.name = "QueueOverloadedError";
    this.code = "CC_APP_SERVER_OVERLOADED";
    this.retryAfterMs = retryAfterMs;
    this.limit = limit;
    this.queued = queued;
  }
}

export class BoundedAsyncQueue {
  constructor({
    maxItems = 256,
    maxBytes = 4 * 1024 * 1024,
    sizeOf = null,
  } = {}) {
    this.maxItems = Math.max(1, Number(maxItems) || 256);
    this.maxBytes = Math.max(1, Number(maxBytes) || 4 * 1024 * 1024);
    this.sizeOf =
      sizeOf || ((value) => Buffer.byteLength(String(value), "utf8"));
    this.items = [];
    this.bytes = 0;
    this.closed = false;
    this.waiters = [];
  }

  push(value) {
    if (this.closed) throw new Error("bounded queue is closed");
    const bytes = Math.max(0, Number(this.sizeOf(value)) || 0);
    if (
      this.items.length >= this.maxItems ||
      this.bytes + bytes > this.maxBytes
    ) {
      throw new QueueOverloadedError("App Server queue capacity exceeded", {
        limit: this.maxItems,
        queued: this.items.length,
      });
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.items.push({ value, bytes });
    this.bytes += bytes;
  }

  shift() {
    const entry = this.items.shift();
    if (!entry) return undefined;
    this.bytes -= entry.bytes;
    return entry.value;
  }

  async next() {
    const value = this.shift();
    if (value !== undefined) return { value, done: false };
    if (this.closed) return { value: undefined, done: true };
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }

  close(error = null) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  snapshot() {
    return Object.freeze({
      queuedItems: this.items.length,
      queuedBytes: this.bytes,
      maxItems: this.maxItems,
      maxBytes: this.maxBytes,
      closed: this.closed,
    });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}
