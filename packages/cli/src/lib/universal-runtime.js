/**
 * Universal Runtime — CLI port of Phase 63
 * (docs/design/modules/63_统一应用运行时.md).
 *
 * Desktop has UniversalRuntime with 8 IPC handlers:
 *   load-plugin / hot-update / profile / sync-state /
 *   get-platform-info / configure / health-check / get-metrics.
 *
 * CLI port ships:
 *
 *   - Plugin lifecycle (load/unload/list/show) with status tracking
 *   - Hot update lifecycle with rollback + update-type catalog
 *   - Simulated profile sampling (cpu/memory/flamegraph) with persistence
 *   - CRDT-less state sync (last-write-wins key/value) with timestamps
 *   - Platform info + health check + runtime metrics
 *   - Configure (key/value) + stats aggregation
 *
 * What does NOT port: real plugin sandbox, actual Yjs CRDT merge,
 * real Flame Graph sampling, diff-based hot-patch payloads,
 * automatic self-heal timers (CLI is one-shot).
 */

import crypto from "crypto";
import os from "os";

/* ── Constants ──────────────────────────────────────────── */

export const PLUGIN_STATUS = Object.freeze({
  LOADING: "loading",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ERROR: "error",
  UNLOADED: "unloaded",
});

export const UPDATE_TYPE = Object.freeze({
  PATCH: "patch",
  MINOR: "minor",
  MAJOR: "major",
  ROLLBACK: "rollback",
});

export const HEALTH_STATUS = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  CRITICAL: "critical",
});

export const PROFILE_TYPES = Object.freeze(["cpu", "memory", "flamegraph"]);

const DEFAULT_CONFIG = Object.freeze({
  pluginDir: "plugins/",
  sandboxEnabled: true,
  hotUpdateEnabled: true,
  profileSampleRate: 1000,
  crdtSyncIntervalMs: 5000,
  healthCheckIntervalMs: 30000,
  maxPlugins: 100,
  memoryLimitMb: 512,
});

/* ── State ──────────────────────────────────────────────── */

let _plugins = new Map();
let _updates = new Map();
let _profiles = new Map();
let _state = new Map();
let _config = { ...DEFAULT_CONFIG };
let _metrics = {
  pluginsLoaded: 0,
  pluginsUnloaded: 0,
  hotUpdates: 0,
  rollbacks: 0,
  profilesTaken: 0,
  stateWrites: 0,
  errors: 0,
  startedAt: Date.now(),
};

function _id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
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

export function ensureRuntimeTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS runtime_plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL,
    config TEXT,
    apis TEXT,
    permissions TEXT,
    loaded_at INTEGER,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS runtime_updates (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    from_version TEXT,
    to_version TEXT,
    update_type TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS runtime_profiles (
    id TEXT PRIMARY KEY,
    profile_type TEXT NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    data TEXT,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS runtime_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS runtime_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT,
    updated_at INTEGER NOT NULL
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _plugins.clear();
  _updates.clear();
  _profiles.clear();
  _state.clear();

  try {
    for (const row of db.prepare("SELECT * FROM runtime_plugins").all()) {
      const r = _strip(row);
      _plugins.set(r.id, r);
    }
  } catch (_e) {
    /* table may not exist */
  }

  try {
    for (const row of db.prepare("SELECT * FROM runtime_updates").all()) {
      const r = _strip(row);
      _updates.set(r.id, r);
    }
  } catch (_e) {
    /* empty */
  }

  try {
    for (const row of db.prepare("SELECT * FROM runtime_profiles").all()) {
      const r = _strip(row);
      _profiles.set(r.id, r);
    }
  } catch (_e) {
    /* empty */
  }

  try {
    for (const row of db.prepare("SELECT * FROM runtime_state").all()) {
      const r = _strip(row);
      _state.set(r.state_key, r);
    }
  } catch (_e) {
    /* empty */
  }

  try {
    for (const row of db.prepare("SELECT * FROM runtime_config").all()) {
      const r = _strip(row);
      if (r.config_key && r.config_value != null) {
        try {
          _config[r.config_key] = JSON.parse(r.config_value);
        } catch (_e2) {
          _config[r.config_key] = r.config_value;
        }
      }
    }
  } catch (_e) {
    /* empty */
  }
}

/* ── Plugin management ──────────────────────────────────── */

const VALID_PLUGIN_STATUS = new Set(Object.values(PLUGIN_STATUS));

export function loadPlugin(
  db,
  { name, version, config, apis, permissions } = {},
) {
  if (!name) return { loaded: false, reason: "missing_name" };

  if (_plugins.size >= (_config.maxPlugins || 100)) {
    return { loaded: false, reason: "plugin_limit_reached" };
  }

  // Reject duplicate name
  for (const p of _plugins.values()) {
    if (p.name === name && p.status !== PLUGIN_STATUS.UNLOADED) {
      return { loaded: false, reason: "already_loaded", pluginId: p.id };
    }
  }

  const id = _id("plugin");
  const now = _now();
  const configJson = config
    ? typeof config === "string"
      ? config
      : JSON.stringify(config)
    : null;
  const apisJson = apis
    ? typeof apis === "string"
      ? apis
      : JSON.stringify(apis)
    : null;
  const permsJson = permissions
    ? typeof permissions === "string"
      ? permissions
      : JSON.stringify(permissions)
    : null;

  const entry = {
    id,
    name,
    version: version || "1.0.0",
    status: PLUGIN_STATUS.ACTIVE,
    config: configJson,
    apis: apisJson,
    permissions: permsJson,
    loaded_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO runtime_plugins (id, name, version, status, config, apis, permissions, loaded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    entry.version,
    entry.status,
    configJson,
    apisJson,
    permsJson,
    now,
    now,
  );

  _plugins.set(id, entry);
  _metrics.pluginsLoaded++;
  return { loaded: true, pluginId: id };
}

export function unloadPlugin(db, pluginId) {
  const p = _plugins.get(pluginId);
  if (!p) return { unloaded: false, reason: "not_found" };
  if (p.status === PLUGIN_STATUS.UNLOADED)
    return { unloaded: false, reason: "already_unloaded" };

  const now = _now();
  p.status = PLUGIN_STATUS.UNLOADED;
  p.updated_at = now;

  db.prepare(
    "UPDATE runtime_plugins SET status = ?, updated_at = ? WHERE id = ?",
  ).run(PLUGIN_STATUS.UNLOADED, now, pluginId);

  _metrics.pluginsUnloaded++;
  return { unloaded: true };
}

export function setPluginStatus(db, pluginId, status) {
  if (!VALID_PLUGIN_STATUS.has(status))
    return { updated: false, reason: "invalid_status" };
  const p = _plugins.get(pluginId);
  if (!p) return { updated: false, reason: "not_found" };

  const now = _now();
  p.status = status;
  p.updated_at = now;

  db.prepare(
    "UPDATE runtime_plugins SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, now, pluginId);

  if (status === PLUGIN_STATUS.ERROR) _metrics.errors++;
  return { updated: true };
}

export function getPlugin(db, pluginId) {
  const p = _plugins.get(pluginId);
  return p ? { ...p } : null;
}

export function listPlugins(db, { status, limit = 50 } = {}) {
  let results = [..._plugins.values()];
  if (status) results = results.filter((p) => p.status === status);
  return results
    .sort((a, b) => (b.loaded_at || 0) - (a.loaded_at || 0))
    .slice(0, limit)
    .map((p) => ({ ...p }));
}

/* ── Hot update ─────────────────────────────────────────── */

const VALID_UPDATE_TYPE = new Set(Object.values(UPDATE_TYPE));

function _inferUpdateType(from, to) {
  if (!from || !to) return UPDATE_TYPE.PATCH;
  const fp = String(from)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const tp = String(to)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  while (fp.length < 3) fp.push(0);
  while (tp.length < 3) tp.push(0);
  if (tp[0] !== fp[0]) return UPDATE_TYPE.MAJOR;
  if (tp[1] !== fp[1]) return UPDATE_TYPE.MINOR;
  return UPDATE_TYPE.PATCH;
}

export function hotUpdate(db, pluginId, newVersion, { updateType } = {}) {
  const p = _plugins.get(pluginId);
  if (!p) return { updated: false, reason: "not_found" };
  if (!newVersion) return { updated: false, reason: "missing_version" };
  if (!_config.hotUpdateEnabled)
    return { updated: false, reason: "hot_update_disabled" };

  const resolvedType =
    updateType && VALID_UPDATE_TYPE.has(updateType)
      ? updateType
      : _inferUpdateType(p.version, newVersion);

  const updateId = _id("update");
  const now = _now();
  const fromVersion = p.version;

  p.version = newVersion;
  p.status = PLUGIN_STATUS.ACTIVE;
  p.updated_at = now;

  const entry = {
    id: updateId,
    plugin_id: pluginId,
    from_version: fromVersion,
    to_version: newVersion,
    update_type: resolvedType,
    status: "completed",
    created_at: now,
  };
  _updates.set(updateId, entry);
  _metrics.hotUpdates++;

  db.prepare(
    "UPDATE runtime_plugins SET version = ?, status = ?, updated_at = ? WHERE id = ?",
  ).run(newVersion, PLUGIN_STATUS.ACTIVE, now, pluginId);

  db.prepare(
    `INSERT INTO runtime_updates (id, plugin_id, from_version, to_version, update_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    updateId,
    pluginId,
    fromVersion,
    newVersion,
    resolvedType,
    "completed",
    now,
  );

  return {
    updated: true,
    updateId,
    fromVersion,
    toVersion: newVersion,
    updateType: resolvedType,
  };
}

export function rollbackUpdate(db, updateId) {
  const u = _updates.get(updateId);
  if (!u) return { rolledBack: false, reason: "not_found" };
  if (u.update_type === UPDATE_TYPE.ROLLBACK)
    return { rolledBack: false, reason: "already_rollback" };

  const p = _plugins.get(u.plugin_id);
  if (!p) return { rolledBack: false, reason: "plugin_missing" };

  const rollbackId = _id("update");
  const now = _now();
  const fromVersion = p.version;
  const toVersion = u.from_version;

  p.version = toVersion;
  p.updated_at = now;

  const entry = {
    id: rollbackId,
    plugin_id: u.plugin_id,
    from_version: fromVersion,
    to_version: toVersion,
    update_type: UPDATE_TYPE.ROLLBACK,
    status: "completed",
    created_at: now,
  };
  _updates.set(rollbackId, entry);
  _metrics.rollbacks++;

  db.prepare(
    "UPDATE runtime_plugins SET version = ?, updated_at = ? WHERE id = ?",
  ).run(toVersion, now, u.plugin_id);

  db.prepare(
    `INSERT INTO runtime_updates (id, plugin_id, from_version, to_version, update_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rollbackId,
    u.plugin_id,
    fromVersion,
    toVersion,
    UPDATE_TYPE.ROLLBACK,
    "completed",
    now,
  );

  return {
    rolledBack: true,
    rollbackId,
    fromVersion,
    toVersion,
  };
}

export function listUpdates(db, { pluginId, limit = 50 } = {}) {
  let results = [..._updates.values()];
  if (pluginId) results = results.filter((u) => u.plugin_id === pluginId);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((u) => ({ ...u }));
}

/* ── Profile ────────────────────────────────────────────── */

function _sampleProfile(type, duration) {
  const now = _now();
  if (type === "cpu") {
    return {
      cores: os.cpus().length,
      loadAverage: os.loadavg ? os.loadavg() : [0, 0, 0],
      samples: Math.max(1, Math.floor((duration || 0) / 100)),
      sampledAt: now,
    };
  }
  if (type === "memory") {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external || 0,
      sampledAt: now,
    };
  }
  if (type === "flamegraph") {
    return {
      frames: [],
      totalSamples: Math.max(1, Math.floor((duration || 0) / 10)),
      duration,
      sampledAt: now,
    };
  }
  return { sampledAt: now };
}

export function takeProfile(db, { type, duration } = {}) {
  const resolvedType = type || "cpu";
  if (!PROFILE_TYPES.includes(resolvedType))
    return { taken: false, reason: "invalid_type" };

  const resolvedDuration = Number(duration) || 1000;
  if (resolvedDuration < 0) return { taken: false, reason: "invalid_duration" };

  const id = _id("profile");
  const now = _now();
  const data = _sampleProfile(resolvedType, resolvedDuration);
  const dataJson = JSON.stringify(data);

  const entry = {
    id,
    profile_type: resolvedType,
    duration_ms: resolvedDuration,
    data: dataJson,
    created_at: now,
  };
  _profiles.set(id, entry);
  _metrics.profilesTaken++;

  db.prepare(
    `INSERT INTO runtime_profiles (id, profile_type, duration_ms, data, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, resolvedType, resolvedDuration, dataJson, now);

  return { taken: true, profileId: id, type: resolvedType, data };
}

export function getProfile(db, id) {
  const p = _profiles.get(id);
  if (!p) return null;
  let data = null;
  try {
    data = p.data ? JSON.parse(p.data) : null;
  } catch (_e) {
    data = p.data;
  }
  return { ...p, data };
}

export function listProfiles(db, { type, limit = 50 } = {}) {
  let results = [..._profiles.values()];
  if (type) results = results.filter((p) => p.profile_type === type);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((p) => ({ ...p }));
}

/* ── State sync (CRDT-less LWW) ─────────────────────────── */

export function setState(db, key, value) {
  if (!key) return { set: false, reason: "missing_key" };
  const now = _now();
  const valueJson =
    value === undefined
      ? null
      : typeof value === "string"
        ? value
        : JSON.stringify(value);

  const existing = _state.get(key);
  if (existing) {
    db.prepare(
      "UPDATE runtime_state SET state_value = ?, updated_at = ? WHERE state_key = ?",
    ).run(valueJson, now, key);
  } else {
    db.prepare(
      `INSERT INTO runtime_state (state_key, state_value, updated_at) VALUES (?, ?, ?)`,
    ).run(key, valueJson, now);
  }

  _state.set(key, {
    state_key: key,
    state_value: valueJson,
    updated_at: now,
  });
  _metrics.stateWrites++;
  return { set: true, key, updatedAt: now };
}

export function getState(db, key) {
  const s = _state.get(key);
  if (!s) return null;
  let value = s.state_value;
  if (value) {
    try {
      value = JSON.parse(value);
    } catch (_e) {
      /* plain string */
    }
  }
  return { key: s.state_key, value, updatedAt: s.updated_at };
}

export function listState(db, { limit = 100 } = {}) {
  return [..._state.values()]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit)
    .map((s) => {
      let value = s.state_value;
      if (value) {
        try {
          value = JSON.parse(value);
        } catch (_e) {
          /* plain */
        }
      }
      return { key: s.state_key, value, updatedAt: s.updated_at };
    });
}

export function deleteState(db, key) {
  if (!_state.has(key)) return { deleted: false, reason: "not_found" };
  _state.delete(key);
  db.prepare("DELETE FROM runtime_state WHERE state_key = ?").run(key);
  return { deleted: true };
}

/* ── Configure ──────────────────────────────────────────── */

export function configure(db, key, value) {
  if (!key) return { configured: false, reason: "missing_key" };
  const now = _now();
  const valueJson = typeof value === "string" ? value : JSON.stringify(value);

  _config[key] = value;

  const existing = db
    .prepare("SELECT config_key FROM runtime_config WHERE config_key = ?")
    .get(key);
  if (existing) {
    db.prepare(
      "UPDATE runtime_config SET config_value = ?, updated_at = ? WHERE config_key = ?",
    ).run(valueJson, now, key);
  } else {
    db.prepare(
      `INSERT INTO runtime_config (config_key, config_value, updated_at) VALUES (?, ?, ?)`,
    ).run(key, valueJson, now);
  }
  return { configured: true, key, value };
}

export function getConfig() {
  return { ..._config };
}

/* ── Platform info ──────────────────────────────────────── */

export function getPlatformInfo() {
  const mem = process.memoryUsage();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions?.electron || null,
    pid: process.pid,
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem ? os.totalmem() : 0,
    freeMemoryBytes: os.freemem ? os.freemem() : 0,
    hostname: os.hostname ? os.hostname() : null,
    processUptimeMs: Math.floor(process.uptime() * 1000),
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
  };
}

/* ── Health check ───────────────────────────────────────── */

export function healthCheck() {
  const mem = process.memoryUsage();
  const limitBytes = (_config.memoryLimitMb || 512) * 1024 * 1024;
  const heapRatio = limitBytes > 0 ? mem.heapUsed / limitBytes : 0;

  let status = HEALTH_STATUS.HEALTHY;
  if (heapRatio > 0.95 || _metrics.errors > 50) {
    status = HEALTH_STATUS.CRITICAL;
  } else if (heapRatio > 0.75 || _metrics.errors > 10) {
    status = HEALTH_STATUS.DEGRADED;
  }

  const activePlugins = [..._plugins.values()].filter(
    (p) => p.status === PLUGIN_STATUS.ACTIVE,
  ).length;
  const errorPlugins = [..._plugins.values()].filter(
    (p) => p.status === PLUGIN_STATUS.ERROR,
  ).length;

  return {
    status,
    uptimeMs: _now() - _metrics.startedAt,
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      limitBytes,
      heapRatio: Number(heapRatio.toFixed(4)),
    },
    plugins: {
      total: _plugins.size,
      active: activePlugins,
      errors: errorPlugins,
    },
    errors: _metrics.errors,
  };
}

/* ── Metrics ────────────────────────────────────────────── */

export function getMetrics() {
  return {
    ..._metrics,
    uptimeMs: _now() - _metrics.startedAt,
    activePlugins: [..._plugins.values()].filter(
      (p) => p.status === PLUGIN_STATUS.ACTIVE,
    ).length,
    totalPlugins: _plugins.size,
    totalUpdates: _updates.size,
    totalProfiles: _profiles.size,
    stateKeys: _state.size,
  };
}

/* ── Stats (catalog counts) ─────────────────────────────── */

export function getRuntimeStats() {
  const byPluginStatus = {};
  for (const s of Object.values(PLUGIN_STATUS)) byPluginStatus[s] = 0;
  for (const p of _plugins.values())
    byPluginStatus[p.status] = (byPluginStatus[p.status] || 0) + 1;

  const byUpdateType = {};
  for (const t of Object.values(UPDATE_TYPE)) byUpdateType[t] = 0;
  for (const u of _updates.values())
    byUpdateType[u.update_type] = (byUpdateType[u.update_type] || 0) + 1;

  const byProfileType = {};
  for (const t of PROFILE_TYPES) byProfileType[t] = 0;
  for (const p of _profiles.values())
    byProfileType[p.profile_type] = (byProfileType[p.profile_type] || 0) + 1;

  return {
    plugins: _plugins.size,
    updates: _updates.size,
    profiles: _profiles.size,
    state: _state.size,
    byPluginStatus,
    byUpdateType,
    byProfileType,
    metrics: getMetrics(),
    health: healthCheck(),
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _plugins.clear();
  _updates.clear();
  _profiles.clear();
  _state.clear();
  _config = { ...DEFAULT_CONFIG };
  _metrics = {
    pluginsLoaded: 0,
    pluginsUnloaded: 0,
    hotUpdates: 0,
    rollbacks: 0,
    profilesTaken: 0,
    stateWrites: 0,
    errors: 0,
    startedAt: Date.now(),
  };
}
