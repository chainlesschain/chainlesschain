/**
 * @module core-infra/service-container
 * Unified dependency injection container
 * Manages module lifecycle: register → resolve → initialize → dispose
 *
 * Extracted from desktop-app-vue/src/main/core/service-container.js
 */
const EventEmitter = require("events");
const { getLogger } = require("./logger-adapter.js");

class ServiceContainer extends EventEmitter {
  constructor() {
    super();
    this._services = new Map();
    this._instances = new Map();
    this._pending = new Map(); // name → in-flight resolution promise (singletons)
    this._initialized = false;
  }

  register(name, factory, options = {}) {
    const logger = getLogger();
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

  async resolve(name, _path = []) {
    const logger = getLogger();

    if (this._instances.has(name)) {
      return this._instances.get(name);
    }

    const definition = this._services.get(name);
    if (!definition) {
      throw new Error(`Service '${name}' not registered`);
    }

    // Cycle detection uses the current resolution PATH (the chain of names being
    // resolved in this branch), not a global "being initialized" flag. The old
    // global-set approach false-positived on concurrent resolves: two in-flight
    // resolve() calls for services sharing a dependency (e.g. Promise.all over
    // services that both need 'db') made the second throw a spurious
    // "Circular dependency". A real cycle is `name` reappearing in its own path.
    if (_path.includes(name)) {
      throw new Error(`Circular dependency detected for '${name}'`);
    }

    // Concurrent dedup for singletons: if a resolution is already in flight,
    // await the same promise so we don't build the singleton twice (and don't
    // false-trigger the cycle check). Non-singletons are intentionally built
    // fresh on every call.
    if (definition.singleton && this._pending.has(name)) {
      return this._pending.get(name);
    }

    const build = (async () => {
      const deps = {};
      for (const dep of definition.dependencies) {
        deps[dep] = await this.resolve(dep, [..._path, name]);
      }
      const instance =
        typeof definition.factory === "function"
          ? await definition.factory(deps)
          : definition.factory;
      if (definition.singleton) {
        this._instances.set(name, instance);
      }
      return instance;
    })();

    if (definition.singleton) this._pending.set(name, build);

    try {
      const instance = await build;
      this.emit("service:resolved", { name });
      return instance;
    } catch (error) {
      logger.error(
        `[ServiceContainer] Failed to resolve '${name}':`,
        error.message,
      );
      throw error;
    } finally {
      if (definition.singleton) this._pending.delete(name);
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
    const logger = getLogger();
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
    this._pending.clear();
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
      initializingServices: this._pending.size,
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
