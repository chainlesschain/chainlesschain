/**
 * @module core/service-container
 * Phase 79: Unified dependency injection container
 * Manages module lifecycle: register → resolve → initialize → dispose
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class ServiceContainer extends EventEmitter {
  constructor() {
    super();
    this._services = new Map();
    this._instances = new Map();
    this._initializing = new Set();
    this._initialized = false;
  }

  register(name, factory, options = {}) {
    if (this._services.has(name)) {
      logger.warn(
        `[ServiceContainer] Service '${name}' already registered, overwriting`,
      );
    }
    this._services.set(name, {
      factory,
      singleton: options.singleton !== false,
      lazy: options.lazy !== false,
      dependencies: options.dependencies || [],
      tags: options.tags || [],
      registered: Date.now(),
    });
    this.emit("service:registered", { name });
  }

  async resolve(name) {
    if (this._instances.has(name)) {
      return this._instances.get(name);
    }

    const definition = this._services.get(name);
    if (!definition) {
      throw new Error(`Service '${name}' not registered`);
    }

    if (this._initializing.has(name)) {
      throw new Error(`Circular dependency detected for '${name}'`);
    }

    this._initializing.add(name);

    try {
      // Resolve dependencies first
      const deps = {};
      for (const dep of definition.dependencies) {
        deps[dep] = await this.resolve(dep);
      }

      // Create instance
      const instance =
        typeof definition.factory === "function"
          ? await definition.factory(deps)
          : definition.factory;

      if (definition.singleton) {
        this._instances.set(name, instance);
      }

      this._initializing.delete(name);
      this.emit("service:resolved", { name });
      return instance;
    } catch (error) {
      this._initializing.delete(name);
      logger.error(
        `[ServiceContainer] Failed to resolve '${name}':`,
        error.message,
      );
      throw error;
    }
  }

  has(name) {
    return this._services.has(name);
  }

  isResolved(name) {
    return this._instances.has(name);
  }

  getByTag(tag) {
    const results = [];
    for (const [name, def] of this._services) {
      if (def.tags.includes(tag)) {
        results.push(name);
      }
    }
    return results;
  }

  async disposeAll() {
    for (const [name, instance] of this._instances) {
      try {
        if (instance && typeof instance.dispose === "function") {
          await instance.dispose();
        } else if (instance && typeof instance.destroy === "function") {
          await instance.destroy();
        }
      } catch (error) {
        logger.error(
          `[ServiceContainer] Error disposing '${name}':`,
          error.message,
        );
      }
    }
    this._instances.clear();
    this._initializing.clear();
    this.emit("container:disposed");
  }

  getHealth() {
    const health = {};
    for (const [name, def] of this._services) {
      health[name] = {
        registered: true,
        resolved: this._instances.has(name),
        singleton: def.singleton,
        lazy: def.lazy,
        dependencies: def.dependencies,
        tags: def.tags,
      };
    }
    return health;
  }

  getStats() {
    return {
      totalServices: this._services.size,
      resolvedServices: this._instances.size,
      initializingServices: this._initializing.size,
    };
  }
}

let instance = null;
function getServiceContainer() {
  if (!instance) {
    instance = new ServiceContainer();
  }
  return instance;
}

module.exports = { ServiceContainer, getServiceContainer };
