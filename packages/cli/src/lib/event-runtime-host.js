/**
 * Process-level lifecycle owner for the durable Event Runtime.
 *
 * Producers only append records. This host owns the single non-overlapping
 * drain loop, dispatches records to registered handlers, and exposes a
 * stoppable lifecycle shared by short CLI commands and resident daemons.
 */

import { EventEmitter } from "node:events";
import { EventRuntimeStore } from "./event-runtime-store.js";
import { EventRuntimeWorker } from "./event-runtime-worker.js";

function routeType(event) {
  return String(
    event?.runtime_type ||
      event?.runtimeType ||
      event?.event ||
      event?.type ||
      "*",
  );
}

function routeOrigin(event) {
  return String(event?.origin || "*");
}

function routeKey(queue, type = "*", origin = "*") {
  return `${queue}:${String(type || "*")}:${String(origin || "*")}`;
}

export class EventRuntimeHost extends EventEmitter {
  constructor({
    store = new EventRuntimeStore(),
    intervalMs = 1000,
    worker = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    super();
    this.store = store;
    this.intervalMs = Math.max(1, Number(intervalMs) || 1000);
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.handlers = new Map();
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.lastStats = null;
    this.lastError = null;
    this.worker =
      worker ||
      new EventRuntimeWorker({
        store,
        onInbox: (event, record) =>
          this._dispatch("inbox", event, record),
        onOutbox: (event, record) =>
          this._dispatch("outbox", event, record),
      });
  }

  registerHandler(
    handler,
    { queue = "inbox", type = "*", origin = "*" } = {},
  ) {
    if (typeof handler !== "function") {
      throw new TypeError("Event Runtime handler must be a function");
    }
    if (queue !== "inbox" && queue !== "outbox") {
      throw new Error(`unsupported event queue: ${queue}`);
    }
    const key = routeKey(queue, type, origin);
    const handlers = this.handlers.get(key) || new Set();
    handlers.add(handler);
    this.handlers.set(key, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(key);
    };
  }

  async _dispatch(queue, event, record) {
    const type = routeType(event);
    const origin = routeOrigin(event);
    const candidates = [
      routeKey(queue, type, origin),
      routeKey(queue, type, "*"),
      routeKey(queue, "*", origin),
      routeKey(queue, "*", "*"),
    ];
    const handlers = [];
    const seen = new Set();
    for (const key of candidates) {
      for (const handler of this.handlers.get(key) || []) {
        if (seen.has(handler)) continue;
        seen.add(handler);
        handlers.push(handler);
      }
    }
    if (handlers.length === 0 && event?.requiresHandler === true) {
      const error = new Error(
        `No Event Runtime handler for ${queue}:${type}:${origin}`,
      );
      error.code = "CC_EVENT_RUNTIME_HANDLER_UNAVAILABLE";
      throw error;
    }
    const results = await Promise.all(
      handlers.map((handler) => handler(event, record)),
    );
    const delivery = {
      queue,
      type,
      origin,
      handlerCount: handlers.length,
      results,
    };
    this.emit("delivered", delivery, event, record);
    this.emit(`${queue}:${type}`, event, record, delivery);
    return delivery;
  }

  async runOnce() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = Promise.resolve()
      .then(() => this.worker.runOnce())
      .then((stats) => {
        this.lastStats = stats;
        this.lastError = null;
        this.emit("tick", stats);
        return stats;
      })
      .catch((error) => {
        this.lastError = error;
        this.emit("runtime-error", error);
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  _schedule() {
    if (!this.running || this.timer != null) return;
    this.timer = this.setTimeoutFn(async () => {
      this.timer = null;
      try {
        await this.runOnce();
      } catch {
        // The durable records remain pending/retriable. The host keeps running
        // so a transient lock or filesystem failure does not kill the daemon.
      } finally {
        this._schedule();
      }
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  start({ immediate = true } = {}) {
    if (this.running) return false;
    this.running = true;
    if (immediate) {
      void this.runOnce()
        .catch(() => {})
        .finally(() => this._schedule());
    } else {
      this._schedule();
    }
    this.emit("started");
    return true;
  }

  async stop({ drain = true } = {}) {
    const wasRunning = this.running;
    this.running = false;
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (drain && this.inFlight) {
      try {
        await this.inFlight;
      } catch {
        // Error already exposed through runtime-error/lastError.
      }
    }
    if (wasRunning) this.emit("stopped");
    return wasRunning;
  }

  status() {
    return {
      running: this.running,
      inFlight: this.inFlight != null,
      handlerRoutes: this.handlers.size,
      lastStats: this.lastStats,
      lastError: this.lastError?.message || null,
      health: this.store.getHealthSnapshot(),
    };
  }
}

let defaultHost = null;

export function getDefaultEventRuntimeHost(options = {}) {
  if (!defaultHost) defaultHost = new EventRuntimeHost(options);
  return defaultHost;
}

export function startDefaultEventRuntimeHost(options = {}) {
  if (process.env.CC_EVENT_RUNTIME_DURABLE !== "1" && options.force !== true) {
    return null;
  }
  const host = getDefaultEventRuntimeHost(options);
  host.start({ immediate: options.immediate !== false });
  return host;
}

export async function stopDefaultEventRuntimeHost(options) {
  return defaultHost ? defaultHost.stop(options) : false;
}

export function _resetDefaultEventRuntimeHostForTests() {
  defaultHost = null;
}

