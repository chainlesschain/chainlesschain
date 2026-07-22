/** Canonical producer boundary for durable Event Runtime events. */

import { EventEmitter } from "node:events";
import { eventId } from "./event-runtime-store.js";

const ALLOWED_ORIGINS = new Set([
  "agenda",
  "monitor",
  "webhook",
  "telegram",
  "mcp",
  "hook",
  "agent-ipc",
  "system",
]);

function normalizeOrigin(origin) {
  const value = String(origin || "system").trim().toLowerCase();
  if (!ALLOWED_ORIGINS.has(value)) throw new Error(`unsupported event origin: ${value}`);
  return value;
}

/**
 * Publish an event with an immutable producer envelope. The store remains the
 * source of truth; the optional emitter is only a low-latency notification.
 */
export class EventRuntimeProducer extends EventEmitter {
  constructor({ store, emitter = null, now = () => Date.now() } = {}) {
    super();
    if (!store || typeof store.enqueue !== "function") {
      throw new Error("EventRuntimeProducer requires a durable EventRuntimeStore");
    }
    this.store = store;
    this.emitter = emitter;
    this._now = now;
  }

  publish(event, { origin = "system", queue = "inbox", id = null, metadata = null } = {}) {
    if (queue !== "inbox" && queue !== "outbox") throw new Error(`unsupported event queue: ${queue}`);
    const producer = normalizeOrigin(origin);
    const base = {
      ...(event && typeof event === "object" ? event : { value: event }),
      origin: producer,
    };
    const payload = { ...base, producedAt: this._now(), authority: "system" };
    const record = this.store.enqueue(queue, payload, {
      id: id || eventId(base),
      metadata: { ...(metadata || {}), producer: producer },
    });
    if (!record.duplicate) {
      this.emit("published", record);
      this.emitter?.emit?.("event-runtime:published", record);
    }
    return record;
  }
}

export { ALLOWED_ORIGINS };
