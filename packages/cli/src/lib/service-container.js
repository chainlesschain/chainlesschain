/**
 * Service Container — Dependency Injection container for CLI services.
 *
 * Supports singleton/transient lifetimes, lazy resolution, dependency
 * injection with circular dependency detection, tag-based lookup, and
 * disposal of resolved instances.
 */

/**
 * DI Container class.
 */
export class ServiceContainer {
  constructor() {
    /** @type {Map<string, { factory: Function, options: object }>} */
    this._services = new Map();

    /** @type {Map<string, any>} */
    this._instances = new Map();

    /** @type {Set<string>} */
    this._initializing = new Set();
  }

  /**
   * Register a service factory.
   *
   * @param {string} name - Service name
   * @param {Function} factory - Factory function `(container) => instance`
   * @param {object} [options]
   * @param {boolean} [options.singleton=true] - Cache the instance
   * @param {boolean} [options.lazy=true] - Resolve on first use
   * @param {string[]} [options.dependencies=[]] - Dependency names (for documentation / health)
   * @param {string[]} [options.tags=[]] - Tags for grouping
   */
  register(name, factory, options = {}) {
    if (!name || typeof factory !== "function") {
      throw new Error("register() requires a name and factory function");
    }

    const opts = {
      singleton: options.singleton !== undefined ? options.singleton : true,
      lazy: options.lazy !== undefined ? options.lazy : true,
      dependencies: options.dependencies || [],
      tags: options.tags || [],
    };

    this._services.set(name, { factory, options: opts });
  }

  /**
   * Resolve a service by name.
   *
   * @param {string} name
   * @returns {Promise<any>}
   */
  async resolve(name) {
    if (!this._services.has(name)) {
      throw new Error(`Service "${name}" is not registered`);
    }

    const entry = this._services.get(name);

    // Return cached singleton
    if (entry.options.singleton && this._instances.has(name)) {
      return this._instances.get(name);
    }

    // Circular dependency detection
    if (this._initializing.has(name)) {
      throw new Error(`Circular dependency detected: "${name}"`);
    }

    this._initializing.add(name);

    try {
      const instance = await entry.factory(this);

      if (entry.options.singleton) {
        this._instances.set(name, instance);
      }

      return instance;
    } finally {
      this._initializing.delete(name);
    }
  }

  /**
   * Check whether a service is registered.
   *
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._services.has(name);
  }

  /**
   * Check whether a service has been resolved (instantiated).
   *
   * @param {string} name
   * @returns {boolean}
   */
  isResolved(name) {
    return this._instances.has(name);
  }

  /**
   * Find all services that have a given tag.
   *
   * @param {string} tag
   * @returns {string[]} - Service names
   */
  getByTag(tag) {
    const result = [];
    for (const [name, entry] of this._services) {
      if (entry.options.tags.includes(tag)) {
        result.push(name);
      }
    }
    return result;
  }

  /**
   * Dispose all resolved instances. Calls `dispose()` or `destroy()` on each.
   */
  async disposeAll() {
    for (const [name, instance] of this._instances) {
      try {
        if (typeof instance.dispose === "function") {
          await instance.dispose();
        } else if (typeof instance.destroy === "function") {
          await instance.destroy();
        }
      } catch (_err) {
        // Intentionally ignore disposal errors — best-effort cleanup
      }
    }
    this._instances.clear();
  }

  /**
   * Return health / metadata for every registered service.
   *
   * @returns {Record<string, object>}
   */
  getHealth() {
    const health = {};
    for (const [name, entry] of this._services) {
      health[name] = {
        registered: true,
        resolved: this._instances.has(name),
        singleton: entry.options.singleton,
        lazy: entry.options.lazy,
        dependencies: entry.options.dependencies,
        tags: entry.options.tags,
      };
    }
    return health;
  }

  /**
   * Return aggregate stats.
   *
   * @returns {{ totalServices: number, resolvedServices: number, initializingServices: number }}
   */
  getStats() {
    return {
      totalServices: this._services.size,
      resolvedServices: this._instances.size,
      initializingServices: this._initializing.size,
    };
  }
}

/**
 * Factory function to create a new ServiceContainer.
 *
 * @returns {ServiceContainer}
 */
export function createServiceContainer() {
  return new ServiceContainer();
}
