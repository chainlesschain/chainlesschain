/**
 * Decentralized Infrastructure — CLI port of Phase 74-75
 * (docs/design/modules/41_去中心化基础设��系统.md).
 *
 * Desktop uses real Filecoin storage, IPLD content distribution,
 * Tor hidden services, CDN domain fronting, and BLE/WiFi-Direct mesh.
 * CLI port ships:
 *
 *   - Filecoin deal CRUD (simulated storage deal lifecycle)
 *   - Content version tracking (IPLD-style versioning)
 *   - Anti-censorship route registry (Tor/domain-front/mesh simulation)
 *
 * What does NOT port: real Filecoin, IPFS/IPLD, Tor daemon,
 * CDN domain fronting, BLE/WiFi-Direct mesh networking.
 */

import crypto from "crypto";

/* ── Constants ────────────────��────────────────────────────── */

export const DEAL_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  EXPIRED: "expired",
  FAILED: "failed",
});

export const ROUTE_TYPE = Object.freeze({
  TOR: "tor",
  DOMAIN_FRONT: "domain_front",
  MESH_BLE: "mesh_ble",
  MESH_WIFI: "mesh_wifi",
  DIRECT: "direct",
});

export const ROUTE_STATUS = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  DEGRADED: "degraded",
});

/* ── State ─────────────��────────────────────────────��──── */

let _deals = new Map();
let _versions = new Map();
let _routes = new Map();

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

/* ── Schema ────────────────────────────────────────────── */

export function ensureDecentralInfraTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS filecoin_deals (
    id TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    miner_id TEXT,
    size_bytes INTEGER,
    price_fil REAL,
    duration_epochs INTEGER,
    status TEXT DEFAULT 'pending',
    verified INTEGER DEFAULT 0,
    renewal_count INTEGER DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS content_versions (
    id TEXT PRIMARY KEY,
    content_cid TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    parent_cid TEXT,
    dag_structure TEXT,
    cached INTEGER DEFAULT 0,
    peer_count INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS anti_censorship_routes (
    id TEXT PRIMARY KEY,
    route_type TEXT NOT NULL,
    endpoint TEXT,
    status TEXT DEFAULT 'active',
    latency_ms INTEGER,
    reliability REAL DEFAULT 1.0,
    last_used INTEGER,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _deals.clear();
  _versions.clear();
  _routes.clear();

  const tables = [
    ["filecoin_deals", _deals],
    ["content_versions", _versions],
    ["anti_censorship_routes", _routes],
  ];
  for (const [table, map] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r.id, r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Phase 74: Filecoin Storage ──────────────────────────── */

export function createDeal(
  db,
  { cid, minerId, sizeBytes, priceFil, durationEpochs } = {},
) {
  if (!cid) return { dealId: null, reason: "missing_cid" };
  if (!sizeBytes || sizeBytes <= 0)
    return { dealId: null, reason: "invalid_size" };

  const id = _id();
  const now = _now();
  const price = priceFil || 0;
  const duration = durationEpochs || 518400; // ~180 days
  const expiresAt = now + duration * 30000; // simulated epoch → ms

  const deal = {
    id,
    cid,
    miner_id: minerId || null,
    size_bytes: sizeBytes,
    price_fil: price,
    duration_epochs: duration,
    status: "pending",
    verified: 0,
    renewal_count: 0,
    expires_at: expiresAt,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO filecoin_deals (id, cid, miner_id, size_bytes, price_fil, duration_epochs, status, verified, renewal_count, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    cid,
    deal.miner_id,
    sizeBytes,
    price,
    duration,
    "pending",
    0,
    0,
    expiresAt,
    now,
  );

  _deals.set(id, deal);
  return { dealId: id };
}

export function updateDealStatus(db, id, status) {
  const validTransitions = {
    pending: ["active", "failed"],
    active: ["expired", "failed"],
    failed: ["pending"], // retry
  };

  const d = _deals.get(id);
  if (!d) return { updated: false, reason: "not_found" };

  const allowed = validTransitions[d.status];
  if (!allowed || !allowed.includes(status))
    return { updated: false, reason: "invalid_transition" };

  d.status = status;
  if (status === "active") d.verified = 1;

  db.prepare(
    "UPDATE filecoin_deals SET status = ?, verified = ? WHERE id = ?",
  ).run(d.status, d.verified, id);

  return { updated: true };
}

export function renewDeal(db, id) {
  const d = _deals.get(id);
  if (!d) return { renewed: false, reason: "not_found" };
  if (d.status !== "active" && d.status !== "expired")
    return { renewed: false, reason: "deal_not_renewable" };

  d.renewal_count += 1;
  d.status = "active";
  d.expires_at = _now() + d.duration_epochs * 30000;

  db.prepare(
    "UPDATE filecoin_deals SET renewal_count = ?, status = ?, expires_at = ? WHERE id = ?",
  ).run(d.renewal_count, d.status, d.expires_at, id);

  return { renewed: true, renewalCount: d.renewal_count };
}

export function getDeal(db, id) {
  const d = _deals.get(id);
  return d ? { ...d } : null;
}

export function listDeals(db, { status, limit = 50 } = {}) {
  let deals = [..._deals.values()];
  if (status) deals = deals.filter((d) => d.status === status);
  return deals
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((d) => ({ ...d }));
}

/* ── Content Versions ────────────────────────────────────── */

export function addContentVersion(
  db,
  { contentCid, parentCid, dagStructure, peerCount } = {},
) {
  if (!contentCid) return { versionId: null, reason: "missing_content_cid" };

  // Determine version number
  const existing = [..._versions.values()].filter(
    (v) => v.content_cid === contentCid || v.content_cid === parentCid,
  );
  const version =
    existing.length > 0 ? Math.max(...existing.map((v) => v.version)) + 1 : 1;

  const id = _id();
  const now = _now();
  const entry = {
    id,
    content_cid: contentCid,
    version,
    parent_cid: parentCid || null,
    dag_structure: dagStructure || null,
    cached: 0,
    peer_count: peerCount || 0,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO content_versions (id, content_cid, version, parent_cid, dag_structure, cached, peer_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    contentCid,
    version,
    entry.parent_cid,
    entry.dag_structure,
    0,
    entry.peer_count,
    now,
  );

  _versions.set(id, entry);
  return { versionId: id, version };
}

export function getContentVersion(db, id) {
  const v = _versions.get(id);
  return v ? { ...v } : null;
}

export function listContentVersions(db, { contentCid, limit = 50 } = {}) {
  let vers = [..._versions.values()];
  if (contentCid) vers = vers.filter((v) => v.content_cid === contentCid);
  return vers
    .sort((a, b) => b.version - a.version)
    .slice(0, limit)
    .map((v) => ({ ...v }));
}

export function cacheVersion(db, id) {
  const v = _versions.get(id);
  if (!v) return { cached: false, reason: "not_found" };
  v.cached = 1;
  db.prepare("UPDATE content_versions SET cached = 1 WHERE id = ?").run(id);
  return { cached: true };
}

/* ── Phase 75: Anti-Censorship Routes ────────────────────── */

const VALID_ROUTE_TYPES = new Set(Object.values(ROUTE_TYPE));

export function addRoute(
  db,
  { routeType, endpoint, latencyMs, reliability } = {},
) {
  if (!routeType || !VALID_ROUTE_TYPES.has(routeType))
    return { routeId: null, reason: "invalid_route_type" };

  const id = _id();
  const now = _now();
  const rel = reliability != null ? Math.max(0, Math.min(1, reliability)) : 1.0;

  const route = {
    id,
    route_type: routeType,
    endpoint: endpoint || null,
    status: "active",
    latency_ms: latencyMs || null,
    reliability: rel,
    last_used: null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO anti_censorship_routes (id, route_type, endpoint, status, latency_ms, reliability, last_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    routeType,
    route.endpoint,
    "active",
    route.latency_ms,
    rel,
    null,
    now,
  );

  _routes.set(id, route);
  return { routeId: id };
}

export function updateRouteStatus(db, id, status) {
  const validStatuses = new Set(Object.values(ROUTE_STATUS));
  if (!validStatuses.has(status))
    return { updated: false, reason: "invalid_status" };

  const r = _routes.get(id);
  if (!r) return { updated: false, reason: "not_found" };

  r.status = status;
  r.last_used = _now();
  db.prepare(
    "UPDATE anti_censorship_routes SET status = ?, last_used = ? WHERE id = ?",
  ).run(status, r.last_used, id);

  return { updated: true };
}

export function removeRoute(db, id) {
  const r = _routes.get(id);
  if (!r) return { removed: false, reason: "not_found" };
  db.prepare("DELETE FROM anti_censorship_routes WHERE id = ?").run(id);
  _routes.delete(id);
  return { removed: true };
}

export function getRoute(db, id) {
  const r = _routes.get(id);
  return r ? { ...r } : null;
}

export function listRoutes(db, { routeType, status, limit = 50 } = {}) {
  let routes = [..._routes.values()];
  if (routeType) routes = routes.filter((r) => r.route_type === routeType);
  if (status) routes = routes.filter((r) => r.status === status);
  return routes
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

export function getConnectivityReport(db) {
  const routes = [..._routes.values()];
  const active = routes.filter((r) => r.status === "active");
  const latencies = active
    .filter((r) => r.latency_ms != null)
    .map((r) => r.latency_ms);
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length)
      : 0;
  const avgReliability =
    active.length > 0
      ? Math.round(
          (active.reduce((s, r) => s + r.reliability, 0) / active.length) * 100,
        ) / 100
      : 0;

  return {
    totalRoutes: routes.length,
    activeRoutes: active.length,
    byType: routes.reduce((acc, r) => {
      acc[r.route_type] = (acc[r.route_type] || 0) + 1;
      return acc;
    }, {}),
    avgLatencyMs: avgLatency,
    avgReliability,
  };
}

/* ── Stats ─────────���────────────────���──────────────────── */

export function getInfraStats(db) {
  const deals = [..._deals.values()];
  const versions = [..._versions.values()];

  return {
    storage: {
      totalDeals: deals.length,
      active: deals.filter((d) => d.status === "active").length,
      totalSizeBytes: deals.reduce((s, d) => s + (d.size_bytes || 0), 0),
      totalPriceFil:
        Math.round(deals.reduce((s, d) => s + (d.price_fil || 0), 0) * 1000) /
        1000,
    },
    content: {
      totalVersions: versions.length,
      cached: versions.filter((v) => v.cached).length,
      uniqueCids: new Set(versions.map((v) => v.content_cid)).size,
    },
    connectivity: getConnectivityReport(db),
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _deals.clear();
  _versions.clear();
  _routes.clear();
}

/* ═════════════════════════════════════════════════════════ *
 *  Phase 74-75 V2 — Provider Maturity + Deal Lifecycle
 * ═════════════════════════════════════════════════════════ */

export const PROVIDER_MATURITY_V2 = Object.freeze({
  ONBOARDING: "onboarding",
  ACTIVE: "active",
  DEGRADED: "degraded",
  OFFLINE: "offline",
  RETIRED: "retired",
});

export const DEAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
});

const PROVIDER_TRANSITIONS_V2 = new Map([
  ["onboarding", new Set(["active", "retired"])],
  ["active", new Set(["degraded", "offline", "retired"])],
  ["degraded", new Set(["active", "offline", "retired"])],
  ["offline", new Set(["active", "retired"])],
]);
const PROVIDER_TERMINALS_V2 = new Set(["retired"]);

const DEAL_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["active", "canceled", "failed"])],
  ["active", new Set(["completed", "failed", "canceled"])],
]);
const DEAL_TERMINALS_V2 = new Set(["completed", "failed", "canceled"]);

export const DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR = 20;
export const DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER = 10;
export const DI_DEFAULT_PROVIDER_IDLE_MS = 7 * 86400000; // 7 days
export const DI_DEFAULT_DEAL_STUCK_MS = 24 * 3600000; // 24 hours

let _maxActiveProvidersPerOperatorV2 =
  DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR;
let _maxActiveDealsPerProviderV2 = DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER;
let _providerIdleMsV2 = DI_DEFAULT_PROVIDER_IDLE_MS;
let _dealStuckMsV2 = DI_DEFAULT_DEAL_STUCK_MS;

function _positiveIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getDefaultMaxActiveProvidersPerOperatorV2() {
  return DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR;
}
export function getMaxActiveProvidersPerOperatorV2() {
  return _maxActiveProvidersPerOperatorV2;
}
export function setMaxActiveProvidersPerOperatorV2(n) {
  return (_maxActiveProvidersPerOperatorV2 = _positiveIntV2(
    n,
    "maxActiveProvidersPerOperator",
  ));
}
export function getDefaultMaxActiveDealsPerProviderV2() {
  return DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER;
}
export function getMaxActiveDealsPerProviderV2() {
  return _maxActiveDealsPerProviderV2;
}
export function setMaxActiveDealsPerProviderV2(n) {
  return (_maxActiveDealsPerProviderV2 = _positiveIntV2(
    n,
    "maxActiveDealsPerProvider",
  ));
}
export function getDefaultProviderIdleMsV2() {
  return DI_DEFAULT_PROVIDER_IDLE_MS;
}
export function getProviderIdleMsV2() {
  return _providerIdleMsV2;
}
export function setProviderIdleMsV2(ms) {
  return (_providerIdleMsV2 = _positiveIntV2(ms, "providerIdleMs"));
}
export function getDefaultDealStuckMsV2() {
  return DI_DEFAULT_DEAL_STUCK_MS;
}
export function getDealStuckMsV2() {
  return _dealStuckMsV2;
}
export function setDealStuckMsV2(ms) {
  return (_dealStuckMsV2 = _positiveIntV2(ms, "dealStuckMs"));
}

const _providersV2 = new Map();
const _dealsV2 = new Map();

export function registerProviderV2(
  _db,
  { providerId, operatorId, kind, initialStatus, metadata } = {},
) {
  if (!providerId) throw new Error("providerId is required");
  if (!operatorId) throw new Error("operatorId is required");
  if (!kind) throw new Error("kind is required");
  if (_providersV2.has(providerId))
    throw new Error(`Provider ${providerId} already exists`);
  const status = initialStatus || PROVIDER_MATURITY_V2.ONBOARDING;
  if (!Object.values(PROVIDER_MATURITY_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (PROVIDER_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === PROVIDER_MATURITY_V2.ACTIVE) {
    if (getActiveProviderCount(operatorId) >= _maxActiveProvidersPerOperatorV2)
      throw new Error(
        `Operator ${operatorId} reached active-provider cap (${_maxActiveProvidersPerOperatorV2})`,
      );
  }
  const now = Date.now();
  const record = {
    providerId,
    operatorId,
    kind,
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
  };
  _providersV2.set(providerId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getProviderV2(providerId) {
  const r = _providersV2.get(providerId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setProviderMaturityV2(_db, providerId, newStatus, patch = {}) {
  const record = _providersV2.get(providerId);
  if (!record) throw new Error(`Unknown provider: ${providerId}`);
  if (!Object.values(PROVIDER_MATURITY_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = PROVIDER_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === PROVIDER_MATURITY_V2.ACTIVE) {
    if (
      getActiveProviderCount(record.operatorId) >=
      _maxActiveProvidersPerOperatorV2
    )
      throw new Error(
        `Operator ${record.operatorId} reached active-provider cap (${_maxActiveProvidersPerOperatorV2})`,
      );
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function activateProvider(db, id, reason) {
  return setProviderMaturityV2(db, id, PROVIDER_MATURITY_V2.ACTIVE, { reason });
}
export function degradeProvider(db, id, reason) {
  return setProviderMaturityV2(db, id, PROVIDER_MATURITY_V2.DEGRADED, {
    reason,
  });
}
export function offlineProvider(db, id, reason) {
  return setProviderMaturityV2(db, id, PROVIDER_MATURITY_V2.OFFLINE, {
    reason,
  });
}
export function retireProvider(db, id, reason) {
  return setProviderMaturityV2(db, id, PROVIDER_MATURITY_V2.RETIRED, {
    reason,
  });
}

export function touchProviderHeartbeat(providerId) {
  const record = _providersV2.get(providerId);
  if (!record) throw new Error(`Unknown provider: ${providerId}`);
  record.lastHeartbeatAt = Date.now();
  record.updatedAt = record.lastHeartbeatAt;
  return { ...record, metadata: { ...record.metadata } };
}

export function enqueueDealV2(
  _db,
  { dealId, providerId, ownerId, metadata } = {},
) {
  if (!dealId) throw new Error("dealId is required");
  if (!providerId) throw new Error("providerId is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!_providersV2.has(providerId))
    throw new Error(`Unknown provider: ${providerId}`);
  if (_dealsV2.has(dealId)) throw new Error(`Deal ${dealId} already exists`);
  const now = Date.now();
  const record = {
    dealId,
    providerId,
    ownerId,
    status: DEAL_LIFECYCLE_V2.QUEUED,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  _dealsV2.set(dealId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getDealV2(dealId) {
  const r = _dealsV2.get(dealId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setDealStatusV2(_db, dealId, newStatus, patch = {}) {
  const record = _dealsV2.get(dealId);
  if (!record) throw new Error(`Unknown deal: ${dealId}`);
  if (!Object.values(DEAL_LIFECYCLE_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = DEAL_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === DEAL_LIFECYCLE_V2.ACTIVE) {
    if (getActiveDealCount(record.providerId) >= _maxActiveDealsPerProviderV2)
      throw new Error(
        `Provider ${record.providerId} reached active-deal cap (${_maxActiveDealsPerProviderV2})`,
      );
    if (!record.activatedAt) record.activatedAt = Date.now();
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function activateDeal(db, id, reason) {
  return setDealStatusV2(db, id, DEAL_LIFECYCLE_V2.ACTIVE, { reason });
}
export function completeDeal(db, id, reason) {
  return setDealStatusV2(db, id, DEAL_LIFECYCLE_V2.COMPLETED, { reason });
}
export function failDeal(db, id, reason) {
  return setDealStatusV2(db, id, DEAL_LIFECYCLE_V2.FAILED, { reason });
}
export function cancelDeal(db, id, reason) {
  return setDealStatusV2(db, id, DEAL_LIFECYCLE_V2.CANCELED, { reason });
}

export function getActiveProviderCount(operatorId) {
  let n = 0;
  for (const r of _providersV2.values()) {
    if (r.status !== PROVIDER_MATURITY_V2.ACTIVE) continue;
    if (operatorId && r.operatorId !== operatorId) continue;
    n++;
  }
  return n;
}

export function getActiveDealCount(providerId) {
  let n = 0;
  for (const r of _dealsV2.values()) {
    if (r.status !== DEAL_LIFECYCLE_V2.ACTIVE) continue;
    if (providerId && r.providerId !== providerId) continue;
    n++;
  }
  return n;
}

export function autoOfflineStaleProviders(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _providersV2.values()) {
    if (
      r.status === PROVIDER_MATURITY_V2.ACTIVE ||
      r.status === PROVIDER_MATURITY_V2.DEGRADED
    ) {
      if (now - r.lastHeartbeatAt > _providerIdleMsV2) {
        r.status = PROVIDER_MATURITY_V2.OFFLINE;
        r.updatedAt = now;
        r.lastReason = "heartbeat_timeout";
        flipped.push(r.providerId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckActiveDeals(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _dealsV2.values()) {
    if (r.status === DEAL_LIFECYCLE_V2.ACTIVE) {
      const anchor = r.activatedAt || r.createdAt;
      if (now - anchor > _dealStuckMsV2) {
        r.status = DEAL_LIFECYCLE_V2.FAILED;
        r.updatedAt = now;
        r.lastReason = "deal_timeout";
        flipped.push(r.dealId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function getDecentralInfraStatsV2() {
  const providersByStatus = {};
  for (const s of Object.values(PROVIDER_MATURITY_V2)) providersByStatus[s] = 0;
  const dealsByStatus = {};
  for (const s of Object.values(DEAL_LIFECYCLE_V2)) dealsByStatus[s] = 0;
  for (const r of _providersV2.values()) providersByStatus[r.status]++;
  for (const r of _dealsV2.values()) dealsByStatus[r.status]++;
  return {
    totalProvidersV2: _providersV2.size,
    totalDealsV2: _dealsV2.size,
    maxActiveProvidersPerOperator: _maxActiveProvidersPerOperatorV2,
    maxActiveDealsPerProvider: _maxActiveDealsPerProviderV2,
    providerIdleMs: _providerIdleMsV2,
    dealStuckMs: _dealStuckMsV2,
    providersByStatus,
    dealsByStatus,
  };
}

export function _resetStateV2() {
  _maxActiveProvidersPerOperatorV2 =
    DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR;
  _maxActiveDealsPerProviderV2 = DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER;
  _providerIdleMsV2 = DI_DEFAULT_PROVIDER_IDLE_MS;
  _dealStuckMsV2 = DI_DEFAULT_DEAL_STUCK_MS;
  _providersV2.clear();
  _dealsV2.clear();
}

// =====================================================================
// decentral-infra V2 governance overlay (iter23)
// =====================================================================
export const DIGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const DIGOV_DEAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  NEGOTIATING: "negotiating",
  SETTLED: "settled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _digovPTrans = new Map([
  [
    DIGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      DIGOV_PROFILE_MATURITY_V2.ACTIVE,
      DIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DIGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      DIGOV_PROFILE_MATURITY_V2.STALE,
      DIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DIGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      DIGOV_PROFILE_MATURITY_V2.ACTIVE,
      DIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [DIGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _digovPTerminal = new Set([DIGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _digovJTrans = new Map([
  [
    DIGOV_DEAL_LIFECYCLE_V2.QUEUED,
    new Set([
      DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING,
      DIGOV_DEAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING,
    new Set([
      DIGOV_DEAL_LIFECYCLE_V2.SETTLED,
      DIGOV_DEAL_LIFECYCLE_V2.FAILED,
      DIGOV_DEAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DIGOV_DEAL_LIFECYCLE_V2.SETTLED, new Set()],
  [DIGOV_DEAL_LIFECYCLE_V2.FAILED, new Set()],
  [DIGOV_DEAL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _digovPsV2 = new Map();
const _digovJsV2 = new Map();
let _digovMaxActive = 6,
  _digovMaxPending = 15,
  _digovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _digovStuckMs = 60 * 1000;
function _digovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _digovCheckP(from, to) {
  const a = _digovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid digov profile transition ${from} → ${to}`);
}
function _digovCheckJ(from, to) {
  const a = _digovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid digov deal transition ${from} → ${to}`);
}
function _digovCountActive(owner) {
  let c = 0;
  for (const p of _digovPsV2.values())
    if (p.owner === owner && p.status === DIGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _digovCountPending(profileId) {
  let c = 0;
  for (const j of _digovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === DIGOV_DEAL_LIFECYCLE_V2.QUEUED ||
        j.status === DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING)
    )
      c++;
  return c;
}
export function setMaxActiveDigovProfilesPerOwnerV2(n) {
  _digovMaxActive = _digovPos(n, "maxActiveDigovProfilesPerOwner");
}
export function getMaxActiveDigovProfilesPerOwnerV2() {
  return _digovMaxActive;
}
export function setMaxPendingDigovDealsPerProfileV2(n) {
  _digovMaxPending = _digovPos(n, "maxPendingDigovDealsPerProfile");
}
export function getMaxPendingDigovDealsPerProfileV2() {
  return _digovMaxPending;
}
export function setDigovProfileIdleMsV2(n) {
  _digovIdleMs = _digovPos(n, "digovProfileIdleMs");
}
export function getDigovProfileIdleMsV2() {
  return _digovIdleMs;
}
export function setDigovDealStuckMsV2(n) {
  _digovStuckMs = _digovPos(n, "digovDealStuckMs");
}
export function getDigovDealStuckMsV2() {
  return _digovStuckMs;
}
export function _resetStateDecentralInfraGovV2() {
  _digovPsV2.clear();
  _digovJsV2.clear();
  _digovMaxActive = 6;
  _digovMaxPending = 15;
  _digovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _digovStuckMs = 60 * 1000;
}
export function registerDigovProfileV2({ id, owner, region, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_digovPsV2.has(id)) throw new Error(`digov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    region: region || "us-east",
    status: DIGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _digovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateDigovProfileV2(id) {
  const p = _digovPsV2.get(id);
  if (!p) throw new Error(`digov profile ${id} not found`);
  const isInitial = p.status === DIGOV_PROFILE_MATURITY_V2.PENDING;
  _digovCheckP(p.status, DIGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _digovCountActive(p.owner) >= _digovMaxActive)
    throw new Error(`max active digov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = DIGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleDigovProfileV2(id) {
  const p = _digovPsV2.get(id);
  if (!p) throw new Error(`digov profile ${id} not found`);
  _digovCheckP(p.status, DIGOV_PROFILE_MATURITY_V2.STALE);
  p.status = DIGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveDigovProfileV2(id) {
  const p = _digovPsV2.get(id);
  if (!p) throw new Error(`digov profile ${id} not found`);
  _digovCheckP(p.status, DIGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = DIGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDigovProfileV2(id) {
  const p = _digovPsV2.get(id);
  if (!p) throw new Error(`digov profile ${id} not found`);
  if (_digovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal digov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDigovProfileV2(id) {
  const p = _digovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDigovProfilesV2() {
  return [..._digovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createDigovDealV2({ id, profileId, provider, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_digovJsV2.has(id)) throw new Error(`digov deal ${id} already exists`);
  if (!_digovPsV2.has(profileId))
    throw new Error(`digov profile ${profileId} not found`);
  if (_digovCountPending(profileId) >= _digovMaxPending)
    throw new Error(`max pending digov deals for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    provider: provider || "",
    status: DIGOV_DEAL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _digovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function negotiatingDigovDealV2(id) {
  const j = _digovJsV2.get(id);
  if (!j) throw new Error(`digov deal ${id} not found`);
  _digovCheckJ(j.status, DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING);
  const now = Date.now();
  j.status = DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeDealDigovV2(id) {
  const j = _digovJsV2.get(id);
  if (!j) throw new Error(`digov deal ${id} not found`);
  _digovCheckJ(j.status, DIGOV_DEAL_LIFECYCLE_V2.SETTLED);
  const now = Date.now();
  j.status = DIGOV_DEAL_LIFECYCLE_V2.SETTLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failDigovDealV2(id, reason) {
  const j = _digovJsV2.get(id);
  if (!j) throw new Error(`digov deal ${id} not found`);
  _digovCheckJ(j.status, DIGOV_DEAL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = DIGOV_DEAL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelDigovDealV2(id, reason) {
  const j = _digovJsV2.get(id);
  if (!j) throw new Error(`digov deal ${id} not found`);
  _digovCheckJ(j.status, DIGOV_DEAL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = DIGOV_DEAL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getDigovDealV2(id) {
  const j = _digovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listDigovDealsV2() {
  return [..._digovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleDigovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _digovPsV2.values())
    if (
      p.status === DIGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _digovIdleMs
    ) {
      p.status = DIGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDigovDealsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _digovJsV2.values())
    if (
      j.status === DIGOV_DEAL_LIFECYCLE_V2.NEGOTIATING &&
      j.startedAt != null &&
      t - j.startedAt >= _digovStuckMs
    ) {
      j.status = DIGOV_DEAL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getDecentralInfraGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(DIGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _digovPsV2.values()) profilesByStatus[p.status]++;
  const dealsByStatus = {};
  for (const v of Object.values(DIGOV_DEAL_LIFECYCLE_V2)) dealsByStatus[v] = 0;
  for (const j of _digovJsV2.values()) dealsByStatus[j.status]++;
  return {
    totalDigovProfilesV2: _digovPsV2.size,
    totalDigovDealsV2: _digovJsV2.size,
    maxActiveDigovProfilesPerOwner: _digovMaxActive,
    maxPendingDigovDealsPerProfile: _digovMaxPending,
    digovProfileIdleMs: _digovIdleMs,
    digovDealStuckMs: _digovStuckMs,
    profilesByStatus,
    dealsByStatus,
  };
}
