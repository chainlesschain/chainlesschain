/**
 * @module core/resource-pool
 * Phase 79: Unified resource pool for DB connections, timers, and system resources
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class ResourcePool extends EventEmitter {
  constructor() {
    super();
    this._timers = new Map();
    this._connections = new Map();
    this._resources = new Map();
    this._quotas = new Map();
  }

  // Timer management
  registerTimer(name, callback, interval, options = {}) {
    this.clearTimer(name);
    const timer = options.once
      ? setTimeout(callback, interval)
      : setInterval(callback, interval);
    if (timer.unref && options.unref !== false) {
      timer.unref();
    }
    this._timers.set(name, {
      timer,
      interval,
      type: options.once ? "timeout" : "interval",
      module: options.module || "unknown",
      created: Date.now(),
    });
    return name;
  }

  clearTimer(name) {
    const entry = this._timers.get(name);
    if (!entry) {
      return false;
    }
    if (entry.type === "interval") {
      clearInterval(entry.timer);
    } else {
      clearTimeout(entry.timer);
    }
    this._timers.delete(name);
    return true;
  }

  // Connection management
  registerConnection(name, connection, options = {}) {
    this._connections.set(name, {
      connection,
      module: options.module || "unknown",
      created: Date.now(),
      lastUsed: Date.now(),
    });
  }

  getConnection(name) {
    const entry = this._connections.get(name);
    if (!entry) {
      return null;
    }
    entry.lastUsed = Date.now();
    return entry.connection;
  }

  releaseConnection(name) {
    const entry = this._connections.get(name);
    if (!entry) {
      return false;
    }
    try {
      if (entry.connection && typeof entry.connection.close === "function") {
        entry.connection.close();
      }
    } catch (error) {
      logger.error(
        `[ResourcePool] Error closing connection '${name}':`,
        error.message,
      );
    }
    this._connections.delete(name);
    return true;
  }

  // Generic resource tracking
  acquireResource(type, name, resource) {
    const key = `${type}:${name}`;
    const quota = this._quotas.get(type);
    if (quota) {
      const count = Array.from(this._resources.keys()).filter((k) =>
        k.startsWith(`${type}:`),
      ).length;
      if (count >= quota) {
        throw new Error(
          `Resource quota exceeded for type '${type}' (max: ${quota})`,
        );
      }
    }
    this._resources.set(key, { resource, acquired: Date.now() });
    return key;
  }

  releaseResource(key) {
    return this._resources.delete(key);
  }

  setQuota(type, max) {
    this._quotas.set(type, max);
  }

  getUsage() {
    return {
      timers: {
        count: this._timers.size,
        items: Array.from(this._timers.entries()).map(([name, t]) => ({
          name,
          type: t.type,
          module: t.module,
          interval: t.interval,
          age: Date.now() - t.created,
        })),
      },
      connections: {
        count: this._connections.size,
        items: Array.from(this._connections.entries()).map(([name, c]) => ({
          name,
          module: c.module,
          age: Date.now() - c.created,
          idleTime: Date.now() - c.lastUsed,
        })),
      },
      resources: {
        count: this._resources.size,
        quotas: Object.fromEntries(this._quotas),
      },
    };
  }

  async disposeAll() {
    // Clear all timers
    for (const [name] of this._timers) {
      this.clearTimer(name);
    }
    // Close all connections
    for (const [name] of this._connections) {
      this.releaseConnection(name);
    }
    // Release all resources
    this._resources.clear();
    this.emit("pool:disposed");
  }
}

let instance = null;
function getResourcePool() {
  if (!instance) {
    instance = new ResourcePool();
  }
  return instance;
}

module.exports = { ResourcePool, getResourcePool };
