/**
 * @module ipc/lazy-phase-loader
 * Lazy loading system for IPC phase modules. Phases are registered with
 * a loader function and only loaded on demand, with deduplication and
 * domain-level preloading support.
 *
 * Phase 78 - IPC Registry Domain Split + Lazy Loading + Middleware
 */
const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

class LazyPhaseLoader extends EventEmitter {
  constructor() {
    super();
    this._phases = new Map();
    this._loaded = new Set();
    this._loading = new Map();
    this._deps = {};
  }

  /**
   * Set shared dependencies that will be passed to phase loaders
   * @param {Object} deps - Dependencies object (database, app, etc.)
   */
  setDependencies(deps) {
    this._deps = deps;
  }

  /**
   * Register a phase with its loader function (does not load immediately)
   * @param {string} phaseId - Unique phase identifier (e.g., "ai.cowork", "core.config")
   * @param {Function} loader - Async function(deps) that registers the phase's IPC handlers
   */
  registerPhase(phaseId, loader) {
    this._phases.set(phaseId, { loader, registered: Date.now() });
  }

  /**
   * Load a phase by ID. Returns true if loaded successfully, false otherwise.
   * Deduplicates concurrent loads of the same phase.
   * @param {string} phaseId
   * @returns {Promise<boolean>}
   */
  async loadPhase(phaseId) {
    if (this._loaded.has(phaseId)) {
      return true;
    }

    if (this._loading.has(phaseId)) {
      return this._loading.get(phaseId);
    }

    const phase = this._phases.get(phaseId);
    if (!phase) {
      logger.warn(`[LazyPhaseLoader] Unknown phase: ${phaseId}`);
      return false;
    }

    const loadPromise = (async () => {
      try {
        const startTime = Date.now();
        await phase.loader(this._deps);
        this._loaded.add(phaseId);
        this._loading.delete(phaseId);
        const duration = Date.now() - startTime;
        logger.info(
          `[LazyPhaseLoader] Phase ${phaseId} loaded in ${duration}ms`,
        );
        this.emit("phase:loaded", { phaseId, duration });
        return true;
      } catch (error) {
        this._loading.delete(phaseId);
        logger.error(
          `[LazyPhaseLoader] Phase ${phaseId} failed:`,
          error.message,
        );
        this.emit("phase:error", { phaseId, error: error.message });
        return false;
      }
    })();

    this._loading.set(phaseId, loadPromise);
    return loadPromise;
  }

  /**
   * Check if a phase has been loaded
   * @param {string} phaseId
   * @returns {boolean}
   */
  isLoaded(phaseId) {
    return this._loaded.has(phaseId);
  }

  /**
   * Get loader statistics
   * @returns {Object}
   */
  getStats() {
    return {
      totalPhases: this._phases.size,
      loadedPhases: this._loaded.size,
      loadingPhases: this._loading.size,
      phases: Array.from(this._phases.keys()).map((id) => ({
        id,
        loaded: this._loaded.has(id),
        loading: this._loading.has(id),
      })),
    };
  }

  /**
   * Preload all phases whose IDs start with the given domain prefix
   * @param {string} domain - Domain prefix (e.g., "ai", "core")
   * @returns {Promise<Array<{phaseId: string, success: boolean}>>}
   */
  async preloadDomain(domain) {
    const phases = Array.from(this._phases.entries()).filter(([id]) =>
      id.startsWith(domain),
    );
    const results = await Promise.allSettled(
      phases.map(([id]) => this.loadPhase(id)),
    );
    return results.map((r, i) => ({
      phaseId: phases[i][0],
      success: r.status === "fulfilled" && r.value === true,
    }));
  }
}

let instance = null;
function getLazyPhaseLoader() {
  if (!instance) {
    instance = new LazyPhaseLoader();
  }
  return instance;
}

module.exports = { LazyPhaseLoader, getLazyPhaseLoader };
