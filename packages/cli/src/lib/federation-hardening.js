/**
 * Federation Hardening — CLI port of Phase 58
 * (docs/design/modules/30_联邦强化系统.md).
 *
 * Desktop uses real Cowork federation with live WebRTC/libp2p nodes,
 * real-time heartbeat monitoring, and connection pool management.
 * CLI port ships:
 *
 *   - Circuit breaker state machine (closed → open → half_open)
 *   - Health check recording and node health status tracking
 *   - Connection pool simulation with stats
 *   - Node registration and lifecycle management
 *
 * What does NOT port: real WebRTC/libp2p connections, live heartbeat
 * monitoring, actual connection pooling, periodic health check timers.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const CIRCUIT_STATE = Object.freeze({
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
});

export const HEALTH_STATUS = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
  UNKNOWN: "unknown",
});

export const HEALTH_METRIC = Object.freeze({
  HEARTBEAT: "heartbeat",
  LATENCY: "latency",
  SUCCESS_RATE: "success_rate",
  CPU_USAGE: "cpu_usage",
  MEMORY_USAGE: "memory_usage",
});

export const POOL_DEFAULTS = Object.freeze({
  MIN_CONNECTIONS: 5,
  MAX_CONNECTIONS: 50,
  IDLE_TIMEOUT: 300000,
  ACQUIRE_TIMEOUT: 30000,
});

/* ── State ──────────────────────────────────────────────── */

let _breakers = new Map();
let _healthChecks = new Map();
let _pools = new Map(); // in-memory only, no DB table

function _id() {
  return crypto.randomUUID();
}
function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensureFederationHardeningTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS federation_circuit_breakers (
    node_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'closed',
    failure_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    last_failure_time INTEGER,
    last_success_time INTEGER,
    failure_threshold INTEGER DEFAULT 5,
    success_threshold INTEGER DEFAULT 2,
    open_timeout INTEGER DEFAULT 60000,
    state_changed_at INTEGER NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS federation_health_checks (
    check_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL,
    metrics TEXT,
    checked_at INTEGER NOT NULL
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _breakers.clear();
  _healthChecks.clear();
  _pools.clear();

  const tables = [
    ["federation_circuit_breakers", _breakers, "node_id"],
    ["federation_health_checks", _healthChecks, "check_id"],
  ];
  for (const [table, map, key] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r[key], r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Circuit Breaker ────────────────────────────────────── */

const VALID_CIRCUIT_STATES = new Set(Object.values(CIRCUIT_STATE));

export function registerNode(db, nodeId, opts = {}) {
  if (!nodeId) return { registered: false, reason: "missing_node_id" };
  if (_breakers.has(nodeId))
    return { registered: false, reason: "already_exists" };

  const now = _now();
  const entry = {
    node_id: nodeId,
    state: "closed",
    failure_count: 0,
    success_count: 0,
    last_failure_time: null,
    last_success_time: null,
    failure_threshold: opts.failureThreshold ?? 5,
    success_threshold: opts.successThreshold ?? 2,
    open_timeout: opts.openTimeout ?? 60000,
    state_changed_at: now,
    metadata: opts.metadata || null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO federation_circuit_breakers
     (node_id, state, failure_count, success_count, last_failure_time, last_success_time,
      failure_threshold, success_threshold, open_timeout, state_changed_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nodeId,
    entry.state,
    0,
    0,
    null,
    null,
    entry.failure_threshold,
    entry.success_threshold,
    entry.open_timeout,
    now,
    entry.metadata,
    now,
    now,
  );

  _breakers.set(nodeId, entry);
  return { registered: true, nodeId };
}

export function getCircuitBreaker(db, nodeId) {
  const b = _breakers.get(nodeId);
  return b ? { ...b } : null;
}

export function listCircuitBreakers(db, { state, limit = 50 } = {}) {
  let breakers = [..._breakers.values()];
  if (state) breakers = breakers.filter((b) => b.state === state);
  return breakers
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit)
    .map((b) => ({ ...b }));
}

export function recordFailure(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) return { updated: false, reason: "not_found" };

  const now = _now();
  b.failure_count += 1;
  b.last_failure_time = now;
  b.updated_at = now;

  // Check if we should trip the breaker
  const oldState = b.state;
  if (b.state === "closed" && b.failure_count >= b.failure_threshold) {
    b.state = "open";
    b.state_changed_at = now;
    b.success_count = 0;
  } else if (b.state === "half_open") {
    // Probe failed — go back to open
    b.state = "open";
    b.state_changed_at = now;
    b.success_count = 0;
  }

  db.prepare(
    `UPDATE federation_circuit_breakers
     SET state = ?, failure_count = ?, success_count = ?, last_failure_time = ?,
         state_changed_at = ?, updated_at = ?
     WHERE node_id = ?`,
  ).run(
    b.state,
    b.failure_count,
    b.success_count,
    b.last_failure_time,
    b.state_changed_at,
    now,
    nodeId,
  );

  return {
    updated: true,
    state: b.state,
    previousState: oldState,
    failureCount: b.failure_count,
  };
}

export function recordSuccess(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) return { updated: false, reason: "not_found" };

  const now = _now();
  b.success_count += 1;
  b.last_success_time = now;
  b.updated_at = now;

  const oldState = b.state;
  if (b.state === "half_open" && b.success_count >= b.success_threshold) {
    // Enough successful probes — close the breaker
    b.state = "closed";
    b.state_changed_at = now;
    b.failure_count = 0;
  }

  db.prepare(
    `UPDATE federation_circuit_breakers
     SET state = ?, failure_count = ?, success_count = ?, last_success_time = ?,
         state_changed_at = ?, updated_at = ?
     WHERE node_id = ?`,
  ).run(
    b.state,
    b.failure_count,
    b.success_count,
    b.last_success_time,
    b.state_changed_at,
    now,
    nodeId,
  );

  return {
    updated: true,
    state: b.state,
    previousState: oldState,
    successCount: b.success_count,
  };
}

export function tryHalfOpen(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) return { updated: false, reason: "not_found" };
  if (b.state !== "open")
    return { updated: false, reason: "not_open", state: b.state };

  const now = _now();
  const elapsed = now - b.state_changed_at;
  if (elapsed < b.open_timeout) {
    return {
      updated: false,
      reason: "timeout_not_elapsed",
      remainingMs: b.open_timeout - elapsed,
    };
  }

  b.state = "half_open";
  b.success_count = 0;
  b.state_changed_at = now;
  b.updated_at = now;

  db.prepare(
    `UPDATE federation_circuit_breakers
     SET state = ?, success_count = ?, state_changed_at = ?, updated_at = ?
     WHERE node_id = ?`,
  ).run("half_open", 0, now, now, nodeId);

  return { updated: true, state: "half_open" };
}

export function resetCircuitBreaker(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) return { reset: false, reason: "not_found" };

  const now = _now();
  b.state = "closed";
  b.failure_count = 0;
  b.success_count = 0;
  b.state_changed_at = now;
  b.updated_at = now;

  db.prepare(
    `UPDATE federation_circuit_breakers
     SET state = 'closed', failure_count = 0, success_count = 0,
         state_changed_at = ?, updated_at = ?
     WHERE node_id = ?`,
  ).run(now, now, nodeId);

  return { reset: true, state: "closed" };
}

export function removeNode(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) return { removed: false, reason: "not_found" };

  _breakers.delete(nodeId);
  db.prepare("DELETE FROM federation_circuit_breakers WHERE node_id = ?").run(
    nodeId,
  );

  // Also remove health checks for this node
  const checksToRemove = [..._healthChecks.values()].filter(
    (c) => c.node_id === nodeId,
  );
  for (const c of checksToRemove) {
    _healthChecks.delete(c.check_id);
  }
  db.prepare("DELETE FROM federation_health_checks WHERE node_id = ?").run(
    nodeId,
  );

  // Remove pool
  _pools.delete(nodeId);

  return { removed: true };
}

/* ── Health Check ───────────────────────────────────────── */

const VALID_CHECK_TYPES = new Set(Object.values(HEALTH_METRIC));
const VALID_HEALTH_STATUSES = new Set(Object.values(HEALTH_STATUS));

export function recordHealthCheck(
  db,
  { nodeId, checkType, status, metrics } = {},
) {
  if (!nodeId) return { recorded: false, reason: "missing_node_id" };
  if (!checkType || !VALID_CHECK_TYPES.has(checkType))
    return { recorded: false, reason: "invalid_check_type" };
  if (!status || !VALID_HEALTH_STATUSES.has(status))
    return { recorded: false, reason: "invalid_status" };

  const checkId = _id();
  const now = _now();
  const metricsJson = metrics
    ? typeof metrics === "string"
      ? metrics
      : JSON.stringify(metrics)
    : null;

  const entry = {
    check_id: checkId,
    node_id: nodeId,
    check_type: checkType,
    status,
    metrics: metricsJson,
    checked_at: now,
  };

  db.prepare(
    `INSERT INTO federation_health_checks (check_id, node_id, check_type, status, metrics, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(checkId, nodeId, checkType, status, metricsJson, now);

  _healthChecks.set(checkId, entry);
  return { recorded: true, checkId };
}

export function getHealthCheck(db, checkId) {
  const c = _healthChecks.get(checkId);
  return c ? { ...c } : null;
}

export function listHealthChecks(
  db,
  { nodeId, checkType, status, limit = 50 } = {},
) {
  let checks = [..._healthChecks.values()];
  if (nodeId) checks = checks.filter((c) => c.node_id === nodeId);
  if (checkType) checks = checks.filter((c) => c.check_type === checkType);
  if (status) checks = checks.filter((c) => c.status === status);
  return checks
    .sort((a, b) => b.checked_at - a.checked_at)
    .slice(0, limit)
    .map((c) => ({ ...c }));
}

export function getNodeHealth(db, nodeId) {
  const checks = [..._healthChecks.values()]
    .filter((c) => c.node_id === nodeId)
    .sort((a, b) => b.checked_at - a.checked_at);

  if (checks.length === 0) return { nodeId, status: "unknown", checks: 0 };

  // Aggregate: use the most recent check's status per check_type
  const latestByType = new Map();
  for (const c of checks) {
    if (!latestByType.has(c.check_type)) {
      latestByType.set(c.check_type, c);
    }
  }

  const statuses = [...latestByType.values()].map((c) => c.status);

  // Overall status: worst-case
  let overall = "healthy";
  if (statuses.includes("unhealthy")) overall = "unhealthy";
  else if (statuses.includes("degraded")) overall = "degraded";
  else if (statuses.includes("unknown")) overall = "unknown";

  return {
    nodeId,
    status: overall,
    checks: checks.length,
    latestChecks: [...latestByType.values()].map((c) => ({
      checkType: c.check_type,
      status: c.status,
      checkedAt: c.checked_at,
    })),
  };
}

/* ── Connection Pool (in-memory simulation) ─────────────── */

export function initPool(nodeId, opts = {}) {
  if (!nodeId) return { initialized: false, reason: "missing_node_id" };
  if (_pools.has(nodeId))
    return { initialized: false, reason: "already_exists" };

  const pool = {
    nodeId,
    minConnections: opts.minConnections || POOL_DEFAULTS.MIN_CONNECTIONS,
    maxConnections: opts.maxConnections || POOL_DEFAULTS.MAX_CONNECTIONS,
    idleTimeout: opts.idleTimeout || POOL_DEFAULTS.IDLE_TIMEOUT,
    activeConnections: 0,
    idleConnections: opts.minConnections || POOL_DEFAULTS.MIN_CONNECTIONS,
    totalCreated: opts.minConnections || POOL_DEFAULTS.MIN_CONNECTIONS,
    totalDestroyed: 0,
    waitingRequests: 0,
    createdAt: _now(),
  };

  _pools.set(nodeId, pool);
  return { initialized: true, nodeId };
}

export function acquireConnection(nodeId) {
  const pool = _pools.get(nodeId);
  if (!pool) return { acquired: false, reason: "pool_not_found" };

  if (pool.idleConnections > 0) {
    pool.idleConnections -= 1;
    pool.activeConnections += 1;
    return {
      acquired: true,
      active: pool.activeConnections,
      idle: pool.idleConnections,
    };
  }

  if (pool.activeConnections < pool.maxConnections) {
    pool.activeConnections += 1;
    pool.totalCreated += 1;
    return {
      acquired: true,
      active: pool.activeConnections,
      idle: pool.idleConnections,
    };
  }

  pool.waitingRequests += 1;
  return {
    acquired: false,
    reason: "pool_exhausted",
    waiting: pool.waitingRequests,
  };
}

export function releaseConnection(nodeId) {
  const pool = _pools.get(nodeId);
  if (!pool) return { released: false, reason: "pool_not_found" };
  if (pool.activeConnections <= 0)
    return { released: false, reason: "no_active_connections" };

  pool.activeConnections -= 1;
  pool.idleConnections += 1;

  // Serve waiting request if any
  if (pool.waitingRequests > 0) {
    pool.waitingRequests -= 1;
    pool.idleConnections -= 1;
    pool.activeConnections += 1;
  }

  return {
    released: true,
    active: pool.activeConnections,
    idle: pool.idleConnections,
  };
}

export function getPoolStats(nodeId) {
  const pool = _pools.get(nodeId);
  if (!pool) return null;
  return { ...pool };
}

export function listPools() {
  return [..._pools.values()].map((p) => ({ ...p }));
}

export function destroyPool(nodeId) {
  const pool = _pools.get(nodeId);
  if (!pool) return { destroyed: false, reason: "pool_not_found" };

  pool.totalDestroyed += pool.activeConnections + pool.idleConnections;
  _pools.delete(nodeId);
  return { destroyed: true };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getFederationHardeningStats(db) {
  const breakers = [..._breakers.values()];
  const checks = [..._healthChecks.values()];
  const pools = [..._pools.values()];

  const byState = {};
  for (const s of Object.values(CIRCUIT_STATE)) byState[s] = 0;
  for (const b of breakers) byState[b.state] = (byState[b.state] || 0) + 1;

  const byHealthStatus = {};
  for (const s of Object.values(HEALTH_STATUS)) byHealthStatus[s] = 0;
  for (const c of checks)
    byHealthStatus[c.status] = (byHealthStatus[c.status] || 0) + 1;

  const totalActive = pools.reduce((s, p) => s + p.activeConnections, 0);
  const totalIdle = pools.reduce((s, p) => s + p.idleConnections, 0);

  return {
    circuitBreakers: {
      total: breakers.length,
      byState,
    },
    healthChecks: {
      total: checks.length,
      byStatus: byHealthStatus,
    },
    connectionPools: {
      total: pools.length,
      totalActive,
      totalIdle,
      totalConnections: totalActive + totalIdle,
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _breakers.clear();
  _healthChecks.clear();
  _pools.clear();
  _nodeStatuses.clear();
  _failureThreshold = FED_DEFAULT_FAILURE_THRESHOLD;
  _halfOpenCooldownMs = FED_DEFAULT_HALF_OPEN_COOLDOWN_MS;
  _unhealthyThreshold = FED_DEFAULT_UNHEALTHY_THRESHOLD;
  _maxActiveNodes = FED_DEFAULT_MAX_ACTIVE_NODES;
}

/* ──────────────────────────────────────────────────────────
 *  V2 — Phase 58 surface (strictly additive)
 * ────────────────────────────────────────────────────────── */

export const CIRCUIT_STATE_V2 = CIRCUIT_STATE;
export const HEALTH_STATUS_V2 = HEALTH_STATUS;
export const HEALTH_METRIC_V2 = HEALTH_METRIC;

export const NODE_STATUS_V2 = Object.freeze({
  REGISTERED: "registered",
  ACTIVE: "active",
  ISOLATED: "isolated",
  DECOMMISSIONED: "decommissioned",
});

export const FED_DEFAULT_FAILURE_THRESHOLD = 5;
export const FED_DEFAULT_HALF_OPEN_COOLDOWN_MS = 60_000;
export const FED_DEFAULT_UNHEALTHY_THRESHOLD = 3;
export const FED_DEFAULT_MAX_ACTIVE_NODES = 50;

let _nodeStatuses = new Map();
let _failureThreshold = FED_DEFAULT_FAILURE_THRESHOLD;
let _halfOpenCooldownMs = FED_DEFAULT_HALF_OPEN_COOLDOWN_MS;
let _unhealthyThreshold = FED_DEFAULT_UNHEALTHY_THRESHOLD;
let _maxActiveNodes = FED_DEFAULT_MAX_ACTIVE_NODES;

const NODE_TRANSITIONS_V2 = new Map([
  ["registered", new Set(["active", "decommissioned"])],
  ["active", new Set(["isolated", "decommissioned"])],
  ["isolated", new Set(["active", "decommissioned"])],
]);
const NODE_TERMINALS_V2 = new Set(["decommissioned"]);

/* ── Config ────────────────────────────────────────────── */

function _positiveInt(n, label) {
  if (typeof n !== "number" || Number.isNaN(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(n);
}

export function setFailureThreshold(n) {
  _failureThreshold = _positiveInt(n, "failureThreshold");
}
export function getFailureThreshold() {
  return _failureThreshold;
}

export function setHalfOpenCooldownMs(ms) {
  _halfOpenCooldownMs = _positiveInt(ms, "halfOpenCooldownMs");
}
export function getHalfOpenCooldownMs() {
  return _halfOpenCooldownMs;
}

export function setUnhealthyThreshold(n) {
  _unhealthyThreshold = _positiveInt(n, "unhealthyThreshold");
}
export function getUnhealthyThreshold() {
  return _unhealthyThreshold;
}

export function setMaxActiveNodes(n) {
  _maxActiveNodes = _positiveInt(n, "maxActiveNodes");
}
export function getMaxActiveNodes() {
  return _maxActiveNodes;
}

export function getActiveNodeCount() {
  let count = 0;
  for (const s of _nodeStatuses.values()) {
    if (s.status === NODE_STATUS_V2.ACTIVE) count += 1;
  }
  return count;
}

/* ── Node Lifecycle V2 ─────────────────────────────────── */

export function registerNodeV2(db, { nodeId, metadata } = {}) {
  if (!nodeId) throw new Error("nodeId is required");
  if (_nodeStatuses.has(nodeId)) {
    throw new Error(`Node already registered: ${nodeId}`);
  }
  const now = _now();
  const entry = {
    node_id: nodeId,
    status: NODE_STATUS_V2.REGISTERED,
    metadata: metadata || null,
    registered_at: now,
    updated_at: now,
  };
  _nodeStatuses.set(nodeId, entry);

  if (!_breakers.has(nodeId)) {
    registerNode(db, nodeId, {
      failureThreshold: _failureThreshold,
      openTimeout: _halfOpenCooldownMs,
      metadata: metadata || null,
    });
  }
  return { ...entry };
}

export function getNodeStatusV2(nodeId) {
  const s = _nodeStatuses.get(nodeId);
  return s ? { ...s } : null;
}

export function setNodeStatusV2(db, nodeId, newStatus, patch = {}) {
  const entry = _nodeStatuses.get(nodeId);
  if (!entry) throw new Error(`Node not found: ${nodeId}`);
  if (!Object.values(NODE_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown node status: ${newStatus}`);
  }
  if (NODE_TERMINALS_V2.has(entry.status)) {
    throw new Error(
      `Invalid transition: ${entry.status} → ${newStatus} (terminal)`,
    );
  }
  const allowed = NODE_TRANSITIONS_V2.get(entry.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  if (newStatus === NODE_STATUS_V2.ACTIVE) {
    const active = getActiveNodeCount();
    if (entry.status !== NODE_STATUS_V2.ACTIVE && active >= _maxActiveNodes) {
      throw new Error(
        `Max active nodes reached (${active}/${_maxActiveNodes})`,
      );
    }
  }
  entry.status = newStatus;
  entry.updated_at = _now();
  if (patch.metadata !== undefined) entry.metadata = patch.metadata;
  if (patch.reason !== undefined) entry.reason = patch.reason;
  return { ...entry };
}

/* ── Health Check V2 ───────────────────────────────────── */

const VALID_METRIC_V2 = new Set(Object.values(HEALTH_METRIC_V2));
const VALID_HEALTH_STATUS_V2 = new Set(Object.values(HEALTH_STATUS_V2));

export function recordHealthCheckV2(
  db,
  { nodeId, checkType, status, metrics } = {},
) {
  if (!nodeId) throw new Error("nodeId is required");
  if (!checkType || !VALID_METRIC_V2.has(checkType)) {
    throw new Error(`Invalid check type: ${checkType}`);
  }
  if (!status || !VALID_HEALTH_STATUS_V2.has(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  if (metrics && typeof metrics === "object") {
    for (const [k, v] of Object.entries(metrics)) {
      if (typeof v === "number" && Number.isNaN(v)) {
        throw new Error(`Metric ${k} is NaN`);
      }
    }
  }
  const result = recordHealthCheck(db, { nodeId, checkType, status, metrics });
  if (!result.recorded) throw new Error(`Failed to record: ${result.reason}`);
  return { ...result };
}

/* ── Circuit V2 Shortcuts ──────────────────────────────── */

export function tripCircuit(db, nodeId) {
  const b = _breakers.get(nodeId);
  if (!b) throw new Error(`Node not found: ${nodeId}`);
  if (b.state === "open") {
    throw new Error(`Circuit already open: ${nodeId}`);
  }
  const now = _now();
  b.state = "open";
  b.state_changed_at = now;
  b.success_count = 0;
  b.updated_at = now;
  db.prepare(
    `UPDATE federation_circuit_breakers
     SET state = 'open', success_count = 0, state_changed_at = ?, updated_at = ?
     WHERE node_id = ?`,
  ).run(now, now, nodeId);
  return { state: "open", nodeId };
}

/* ── Auto-Isolate ──────────────────────────────────────── */

export function autoIsolateUnhealthyNodes(db) {
  const isolated = [];
  for (const [nodeId, nodeEntry] of _nodeStatuses.entries()) {
    if (nodeEntry.status !== NODE_STATUS_V2.ACTIVE) continue;
    const checks = [..._healthChecks.values()]
      .filter((c) => c.node_id === nodeId)
      .sort((a, b) => b.checked_at - a.checked_at)
      .slice(0, _unhealthyThreshold);
    if (checks.length < _unhealthyThreshold) continue;
    const allUnhealthy = checks.every(
      (c) => c.status === HEALTH_STATUS_V2.UNHEALTHY,
    );
    if (allUnhealthy) {
      nodeEntry.status = NODE_STATUS_V2.ISOLATED;
      nodeEntry.updated_at = _now();
      nodeEntry.reason = `auto-isolated: ${_unhealthyThreshold} consecutive unhealthy checks`;
      isolated.push({ ...nodeEntry });
    }
  }
  return isolated;
}

/* ── V2 Stats ──────────────────────────────────────────── */

export function getFederationHardeningStatsV2(db) {
  const circuitsByState = {};
  for (const s of Object.values(CIRCUIT_STATE_V2)) circuitsByState[s] = 0;
  for (const b of _breakers.values()) {
    circuitsByState[b.state] = (circuitsByState[b.state] || 0) + 1;
  }

  const nodesByStatus = {};
  for (const s of Object.values(NODE_STATUS_V2)) nodesByStatus[s] = 0;
  for (const n of _nodeStatuses.values()) {
    nodesByStatus[n.status] = (nodesByStatus[n.status] || 0) + 1;
  }

  const healthByStatus = {};
  for (const s of Object.values(HEALTH_STATUS_V2)) healthByStatus[s] = 0;
  const healthByMetric = {};
  for (const m of Object.values(HEALTH_METRIC_V2)) healthByMetric[m] = 0;
  for (const c of _healthChecks.values()) {
    healthByStatus[c.status] = (healthByStatus[c.status] || 0) + 1;
    healthByMetric[c.check_type] = (healthByMetric[c.check_type] || 0) + 1;
  }

  return {
    totalNodes: _nodeStatuses.size,
    activeNodes: nodesByStatus[NODE_STATUS_V2.ACTIVE],
    isolatedNodes: nodesByStatus[NODE_STATUS_V2.ISOLATED],
    totalCircuits: _breakers.size,
    totalHealthChecks: _healthChecks.size,
    maxActiveNodes: _maxActiveNodes,
    failureThreshold: _failureThreshold,
    halfOpenCooldownMs: _halfOpenCooldownMs,
    unhealthyThreshold: _unhealthyThreshold,
    circuitsByState,
    nodesByStatus,
    healthByStatus,
    healthByMetric,
  };
}
