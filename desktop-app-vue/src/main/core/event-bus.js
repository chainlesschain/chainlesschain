/**
 * @module core/event-bus
 * Phase 79: Cross-module event bus (replaces ipcMain abuse for inter-module comms)
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this._channels = new Map();
    this._stats = { published: 0, delivered: 0, errors: 0 };
    this._history = [];
    this._historyLimit = 100;
  }

  subscribe(channel, handler, options = {}) {
    if (!this._channels.has(channel)) {
      this._channels.set(channel, []);
    }
    const subscription = {
      handler,
      module: options.module || "unknown",
      once: options.once || false,
      filter: options.filter || null,
      id: `${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    this._channels.get(channel).push(subscription);
    return subscription.id;
  }

  unsubscribe(subscriptionId) {
    for (const [channel, subs] of this._channels) {
      const idx = subs.findIndex((s) => s.id === subscriptionId);
      if (idx > -1) {
        subs.splice(idx, 1);
        if (subs.length === 0) {
          this._channels.delete(channel);
        }
        return true;
      }
    }
    return false;
  }

  async publish(channel, data, options = {}) {
    this._stats.published++;
    const event = {
      channel,
      data,
      source: options.source || "unknown",
      timestamp: Date.now(),
    };

    // Keep history
    this._history.push(event);
    if (this._history.length > this._historyLimit) {
      this._history.shift();
    }

    const subs = this._channels.get(channel);
    if (!subs || subs.length === 0) {
      return 0;
    }

    let delivered = 0;
    const toRemove = [];

    for (const sub of subs) {
      try {
        if (sub.filter && !sub.filter(data)) {
          continue;
        }
        await sub.handler(data, event);
        delivered++;
        this._stats.delivered++;
        if (sub.once) {
          toRemove.push(sub.id);
        }
      } catch (error) {
        this._stats.errors++;
        logger.error(
          `[EventBus] Handler error on '${channel}':`,
          error.message,
        );
      }
    }

    for (const id of toRemove) {
      const idx = subs.findIndex((s) => s.id === id);
      if (idx > -1) {
        subs.splice(idx, 1);
      }
    }

    return delivered;
  }

  getChannels() {
    const channels = {};
    for (const [name, subs] of this._channels) {
      channels[name] = {
        subscribers: subs.length,
        modules: [...new Set(subs.map((s) => s.module))],
      };
    }
    return channels;
  }

  getStats() {
    return {
      ...this._stats,
      channels: this._channels.size,
      totalSubscribers: Array.from(this._channels.values()).reduce(
        (s, c) => s + c.length,
        0,
      ),
      recentEvents: this._history.slice(-10).map((e) => ({
        channel: e.channel,
        source: e.source,
        timestamp: e.timestamp,
      })),
    };
  }

  clear() {
    this._channels.clear();
    this._history = [];
    this._stats = { published: 0, delivered: 0, errors: 0 };
  }
}

let instance = null;
function getEventBus() {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

module.exports = { EventBus, getEventBus };
