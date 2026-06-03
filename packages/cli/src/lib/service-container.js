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

// ===== V2 Surface: Service Container governance overlay (CLI v0.141.0) =====
export const SVC_CONTAINER_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  DECOMMISSIONED: "decommissioned",
});
export const SVC_RESOLUTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RESOLVING: "resolving",
  RESOLVED: "resolved",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _svcCTrans = new Map([
  [
    SVC_CONTAINER_MATURITY_V2.PENDING,
    new Set([
      SVC_CONTAINER_MATURITY_V2.ACTIVE,
      SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [
    SVC_CONTAINER_MATURITY_V2.ACTIVE,
    new Set([
      SVC_CONTAINER_MATURITY_V2.DEGRADED,
      SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [
    SVC_CONTAINER_MATURITY_V2.DEGRADED,
    new Set([
      SVC_CONTAINER_MATURITY_V2.ACTIVE,
      SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED, new Set()],
]);
const _svcCTerminal = new Set([SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED]);
const _svcRTrans = new Map([
  [
    SVC_RESOLUTION_LIFECYCLE_V2.QUEUED,
    new Set([
      SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING,
      SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING,
    new Set([
      SVC_RESOLUTION_LIFECYCLE_V2.RESOLVED,
      SVC_RESOLUTION_LIFECYCLE_V2.FAILED,
      SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SVC_RESOLUTION_LIFECYCLE_V2.RESOLVED, new Set()],
  [SVC_RESOLUTION_LIFECYCLE_V2.FAILED, new Set()],
  [SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _svcCsV2 = new Map();
const _svcRsV2 = new Map();
let _svcMaxActivePerOwner = 8,
  _svcMaxPendingResPerContainer = 25,
  _svcIdleMs = 60 * 60 * 1000,
  _svcStuckMs = 30 * 1000;
function _svcPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _svcCheckC(from, to) {
  const a = _svcCTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid svc container transition ${from} → ${to}`);
}
function _svcCheckR(from, to) {
  const a = _svcRTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid svc resolution transition ${from} → ${to}`);
}
export function setMaxActiveSvcContainersPerOwnerV2(n) {
  _svcMaxActivePerOwner = _svcPos(n, "maxActiveSvcContainersPerOwner");
}
export function getMaxActiveSvcContainersPerOwnerV2() {
  return _svcMaxActivePerOwner;
}
export function setMaxPendingSvcResolutionsPerContainerV2(n) {
  _svcMaxPendingResPerContainer = _svcPos(
    n,
    "maxPendingSvcResolutionsPerContainer",
  );
}
export function getMaxPendingSvcResolutionsPerContainerV2() {
  return _svcMaxPendingResPerContainer;
}
export function setSvcContainerIdleMsV2(n) {
  _svcIdleMs = _svcPos(n, "svcContainerIdleMs");
}
export function getSvcContainerIdleMsV2() {
  return _svcIdleMs;
}
export function setSvcResolutionStuckMsV2(n) {
  _svcStuckMs = _svcPos(n, "svcResolutionStuckMs");
}
export function getSvcResolutionStuckMsV2() {
  return _svcStuckMs;
}
export function _resetStateServiceContainerV2() {
  _svcCsV2.clear();
  _svcRsV2.clear();
  _svcMaxActivePerOwner = 8;
  _svcMaxPendingResPerContainer = 25;
  _svcIdleMs = 60 * 60 * 1000;
  _svcStuckMs = 30 * 1000;
}
export function registerSvcContainerV2({ id, owner, scope, metadata } = {}) {
  if (!id) throw new Error("svc container id required");
  if (!owner) throw new Error("svc container owner required");
  if (_svcCsV2.has(id))
    throw new Error(`svc container ${id} already registered`);
  const now = Date.now();
  const c = {
    id,
    owner,
    scope: scope || "default",
    status: SVC_CONTAINER_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    decommissionedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _svcCsV2.set(id, c);
  return { ...c, metadata: { ...c.metadata } };
}
function _svcCountActive(owner) {
  let n = 0;
  for (const c of _svcCsV2.values())
    if (c.owner === owner && c.status === SVC_CONTAINER_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateSvcContainerV2(id) {
  const c = _svcCsV2.get(id);
  if (!c) throw new Error(`svc container ${id} not found`);
  _svcCheckC(c.status, SVC_CONTAINER_MATURITY_V2.ACTIVE);
  const recovery = c.status === SVC_CONTAINER_MATURITY_V2.DEGRADED;
  if (!recovery && _svcCountActive(c.owner) >= _svcMaxActivePerOwner)
    throw new Error(`max active svc containers for owner ${c.owner} reached`);
  const now = Date.now();
  c.status = SVC_CONTAINER_MATURITY_V2.ACTIVE;
  c.updatedAt = now;
  c.lastTouchedAt = now;
  if (!c.activatedAt) c.activatedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function degradeSvcContainerV2(id) {
  const c = _svcCsV2.get(id);
  if (!c) throw new Error(`svc container ${id} not found`);
  _svcCheckC(c.status, SVC_CONTAINER_MATURITY_V2.DEGRADED);
  c.status = SVC_CONTAINER_MATURITY_V2.DEGRADED;
  c.updatedAt = Date.now();
  return { ...c, metadata: { ...c.metadata } };
}
export function decommissionSvcContainerV2(id) {
  const c = _svcCsV2.get(id);
  if (!c) throw new Error(`svc container ${id} not found`);
  _svcCheckC(c.status, SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED);
  const now = Date.now();
  c.status = SVC_CONTAINER_MATURITY_V2.DECOMMISSIONED;
  c.updatedAt = now;
  if (!c.decommissionedAt) c.decommissionedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function touchSvcContainerV2(id) {
  const c = _svcCsV2.get(id);
  if (!c) throw new Error(`svc container ${id} not found`);
  if (_svcCTerminal.has(c.status))
    throw new Error(`cannot touch terminal svc container ${id}`);
  const now = Date.now();
  c.lastTouchedAt = now;
  c.updatedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function getSvcContainerV2(id) {
  const c = _svcCsV2.get(id);
  if (!c) return null;
  return { ...c, metadata: { ...c.metadata } };
}
export function listSvcContainersV2() {
  return [..._svcCsV2.values()].map((c) => ({
    ...c,
    metadata: { ...c.metadata },
  }));
}
function _svcCountPending(containerId) {
  let n = 0;
  for (const r of _svcRsV2.values())
    if (
      r.containerId === containerId &&
      (r.status === SVC_RESOLUTION_LIFECYCLE_V2.QUEUED ||
        r.status === SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING)
    )
      n++;
  return n;
}
export function createSvcResolutionV2({
  id,
  containerId,
  token,
  metadata,
} = {}) {
  if (!id) throw new Error("svc resolution id required");
  if (!containerId) throw new Error("svc resolution containerId required");
  if (_svcRsV2.has(id)) throw new Error(`svc resolution ${id} already exists`);
  if (!_svcCsV2.has(containerId))
    throw new Error(`svc container ${containerId} not found`);
  if (_svcCountPending(containerId) >= _svcMaxPendingResPerContainer)
    throw new Error(
      `max pending svc resolutions for container ${containerId} reached`,
    );
  const now = Date.now();
  const r = {
    id,
    containerId,
    token: token || "",
    status: SVC_RESOLUTION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _svcRsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
export function resolvingSvcResolutionV2(id) {
  const r = _svcRsV2.get(id);
  if (!r) throw new Error(`svc resolution ${id} not found`);
  _svcCheckR(r.status, SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING);
  const now = Date.now();
  r.status = SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function resolveSvcResolutionV2(id) {
  const r = _svcRsV2.get(id);
  if (!r) throw new Error(`svc resolution ${id} not found`);
  _svcCheckR(r.status, SVC_RESOLUTION_LIFECYCLE_V2.RESOLVED);
  const now = Date.now();
  r.status = SVC_RESOLUTION_LIFECYCLE_V2.RESOLVED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failSvcResolutionV2(id, reason) {
  const r = _svcRsV2.get(id);
  if (!r) throw new Error(`svc resolution ${id} not found`);
  _svcCheckR(r.status, SVC_RESOLUTION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = SVC_RESOLUTION_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelSvcResolutionV2(id, reason) {
  const r = _svcRsV2.get(id);
  if (!r) throw new Error(`svc resolution ${id} not found`);
  _svcCheckR(r.status, SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = SVC_RESOLUTION_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getSvcResolutionV2(id) {
  const r = _svcRsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listSvcResolutionsV2() {
  return [..._svcRsV2.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}
export function autoDegradeIdleSvcContainersV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const c of _svcCsV2.values())
    if (
      c.status === SVC_CONTAINER_MATURITY_V2.ACTIVE &&
      t - c.lastTouchedAt >= _svcIdleMs
    ) {
      c.status = SVC_CONTAINER_MATURITY_V2.DEGRADED;
      c.updatedAt = t;
      flipped.push(c.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSvcResolutionsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _svcRsV2.values())
    if (
      r.status === SVC_RESOLUTION_LIFECYCLE_V2.RESOLVING &&
      r.startedAt != null &&
      t - r.startedAt >= _svcStuckMs
    ) {
      r.status = SVC_RESOLUTION_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function getServiceContainerGovStatsV2() {
  const containersByStatus = {};
  for (const v of Object.values(SVC_CONTAINER_MATURITY_V2))
    containersByStatus[v] = 0;
  for (const c of _svcCsV2.values()) containersByStatus[c.status]++;
  const resolutionsByStatus = {};
  for (const v of Object.values(SVC_RESOLUTION_LIFECYCLE_V2))
    resolutionsByStatus[v] = 0;
  for (const r of _svcRsV2.values()) resolutionsByStatus[r.status]++;
  return {
    totalSvcContainersV2: _svcCsV2.size,
    totalSvcResolutionsV2: _svcRsV2.size,
    maxActiveSvcContainersPerOwner: _svcMaxActivePerOwner,
    maxPendingSvcResolutionsPerContainer: _svcMaxPendingResPerContainer,
    svcContainerIdleMs: _svcIdleMs,
    svcResolutionStuckMs: _svcStuckMs,
    containersByStatus,
    resolutionsByStatus,
  };
}
