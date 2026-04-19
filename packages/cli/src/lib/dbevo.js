/**
 * Database Evolution Framework — CLI port of Phase 80
 * (docs/design/modules/45_数据库演进与迁移框架.md).
 *
 * Desktop uses MigrationManager (up/down versioned migrations),
 * QueryBuilder (fluent SQL), and IndexOptimizer (slow-query analysis).
 * CLI port ships:
 *
 *   - Migration registration, execution (up/down), rollback, history
 *   - Query logging with duration tracking and statistics
 *   - Index suggestion heuristics (slow-query analysis, table/column extraction)
 *   - Index suggestion application tracking
 *
 * What does NOT port: fluent QueryBuilder (runtime API, not CLI-facing),
 * auto-migration on startup, real EXPLAIN-based optimization,
 * periodic background analysis, database backup before migration.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const MIGRATION_STATUS = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
});

export const MIGRATION_DIRECTION = Object.freeze({
  UP: "up",
  DOWN: "down",
});

export const SUGGESTION_TYPE = Object.freeze({
  CREATE_INDEX: "create_index",
  COMPOSITE_INDEX: "composite_index",
  COVERING_INDEX: "covering_index",
});

/* ── State ──────────────────────────────────────────────── */

let _migrations = []; // registered migration definitions
let _migrationHistory = []; // executed migration records from DB
let _queryLogs = [];
let _suggestions = new Map();
let _slowQueryThresholdMs = 100;

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

export function ensureDbEvoTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    description TEXT,
    direction TEXT NOT NULL,
    executed_at INTEGER NOT NULL,
    duration_ms INTEGER,
    checksum TEXT,
    status TEXT DEFAULT 'success'
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS _query_log (
    id TEXT PRIMARY KEY,
    sql_text TEXT NOT NULL,
    params_json TEXT,
    duration_ms REAL NOT NULL,
    source TEXT,
    tables_accessed TEXT,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS _index_suggestions (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    columns TEXT NOT NULL,
    suggestion_type TEXT,
    estimated_improvement REAL,
    query_count INTEGER DEFAULT 0,
    applied INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _migrationHistory = [];
  _queryLogs = [];
  _suggestions.clear();

  const sources = [
    ["_migrations", (r) => _migrationHistory.push(r)],
    ["_query_log", (r) => _queryLogs.push(r)],
    ["_index_suggestions", (r) => _suggestions.set(r.id, r)],
  ];
  for (const [table, handler] of sources) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        handler(_strip(row));
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Migration Registration ─────────────────────────────── */

export function registerMigration(
  version,
  { description, upSql, downSql } = {},
) {
  if (!version) return { registered: false, reason: "missing_version" };
  if (!upSql) return { registered: false, reason: "missing_up_sql" };

  const existing = _migrations.find((m) => m.version === version);
  if (existing) return { registered: false, reason: "duplicate_version" };

  const checksum = crypto
    .createHash("sha256")
    .update(upSql + (downSql || ""))
    .digest("hex")
    .slice(0, 16);

  _migrations.push({
    version,
    description: description || null,
    upSql,
    downSql: downSql || null,
    checksum,
  });

  // Keep sorted by version
  _migrations.sort((a, b) => a.version.localeCompare(b.version));

  return { registered: true, version, checksum };
}

export function listRegisteredMigrations() {
  return _migrations.map((m) => ({
    version: m.version,
    description: m.description,
    checksum: m.checksum,
    hasDown: !!m.downSql,
  }));
}

/* ── Migration Execution ────────────────────────────────── */

export function getCurrentVersion(db) {
  // Find the latest successful "up" migration that hasn't been rolled back
  const ups = _migrationHistory
    .filter((h) => h.direction === "up" && h.status === "success")
    .map((h) => h.version);
  const downs = _migrationHistory
    .filter((h) => h.direction === "down" && h.status === "success")
    .map((h) => h.version);

  // Versions that have been migrated up and not rolled back
  const active = ups.filter(
    (v) => !downs.includes(v) || ups.lastIndexOf(v) > downs.lastIndexOf(v),
  );

  if (active.length === 0) return null;
  return active.sort((a, b) => b.localeCompare(a))[0];
}

export function getPendingMigrations(db) {
  const current = getCurrentVersion(db);
  return _migrations.filter(
    (m) => !current || m.version.localeCompare(current) > 0,
  );
}

export function migrateUp(db, targetVersion) {
  const pending = getPendingMigrations(db);
  if (pending.length === 0) return { migrated: false, reason: "no_pending" };

  const toRun = targetVersion
    ? pending.filter((m) => m.version.localeCompare(targetVersion) <= 0)
    : pending;

  if (toRun.length === 0) return { migrated: false, reason: "no_pending" };

  const results = [];
  for (const migration of toRun) {
    const start = _now();
    const id = _id();
    let status = "success";

    // In CLI port, we record the migration as executed (no real SQL execution)
    const durationMs = _now() - start;

    const record = {
      id,
      version: migration.version,
      description: migration.description,
      direction: "up",
      executed_at: _now(),
      duration_ms: durationMs,
      checksum: migration.checksum,
      status,
    };

    db.prepare(
      `INSERT INTO _migrations (id, version, description, direction, executed_at, duration_ms, checksum, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      record.version,
      record.description,
      "up",
      record.executed_at,
      durationMs,
      record.checksum,
      status,
    );

    _migrationHistory.push(record);
    results.push({ version: migration.version, status });
  }

  return { migrated: true, count: results.length, results };
}

export function migrateDown(db, targetVersion) {
  const current = getCurrentVersion(db);
  if (!current) return { rolledBack: false, reason: "no_current_version" };

  // Find migrations to roll back (from current down to target, exclusive)
  const toRollBack = _migrations
    .filter((m) => {
      if (targetVersion) {
        return (
          m.version.localeCompare(current) <= 0 &&
          m.version.localeCompare(targetVersion) > 0
        );
      }
      return m.version === current;
    })
    .sort((a, b) => b.version.localeCompare(a.version));

  if (toRollBack.length === 0)
    return { rolledBack: false, reason: "nothing_to_rollback" };

  const noDown = toRollBack.filter((m) => !m.downSql);
  if (noDown.length > 0) {
    return {
      rolledBack: false,
      reason: "missing_down_migration",
      versions: noDown.map((m) => m.version),
    };
  }

  const results = [];
  for (const migration of toRollBack) {
    const id = _id();
    const now = _now();

    const record = {
      id,
      version: migration.version,
      description: migration.description,
      direction: "down",
      executed_at: now,
      duration_ms: 0,
      checksum: migration.checksum,
      status: "success",
    };

    db.prepare(
      `INSERT INTO _migrations (id, version, description, direction, executed_at, duration_ms, checksum, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      record.version,
      record.description,
      "down",
      now,
      0,
      record.checksum,
      "success",
    );

    _migrationHistory.push(record);
    results.push({ version: migration.version, status: "success" });
  }

  return { rolledBack: true, count: results.length, results };
}

export function getMigrationHistory(db, { limit = 50 } = {}) {
  return _migrationHistory
    .sort((a, b) => b.executed_at - a.executed_at)
    .slice(0, limit)
    .map((h) => ({ ...h }));
}

export function getMigrationStatus(db) {
  const current = getCurrentVersion(db);
  const pending = getPendingMigrations(db);
  const history = getMigrationHistory(db, { limit: 5 });

  return {
    currentVersion: current,
    pendingCount: pending.length,
    pendingVersions: pending.map((m) => m.version),
    totalRegistered: _migrations.length,
    totalExecuted: _migrationHistory.length,
    recentHistory: history,
  };
}

export function validateMigrations() {
  if (_migrations.length === 0) return { valid: true, issues: [] };

  const issues = [];
  const versions = _migrations.map((m) => m.version).sort();

  // Check for gaps in version sequence
  for (let i = 1; i < versions.length; i++) {
    const prev = versions[i - 1];
    const curr = versions[i];
    // Simple gap detection: if versions are numeric-like, check continuity
    const prevNum = parseInt(prev.replace(/\D/g, ""), 10);
    const currNum = parseInt(curr.replace(/\D/g, ""), 10);
    if (!isNaN(prevNum) && !isNaN(currNum) && currNum - prevNum > 1) {
      issues.push({ type: "gap", between: [prev, curr] });
    }
  }

  // Check for missing down migrations
  for (const m of _migrations) {
    if (!m.downSql) {
      issues.push({ type: "missing_down", version: m.version });
    }
  }

  return { valid: issues.length === 0, issues };
}

/* ── Query Logging ──────────────────────────────────────── */

export function logQuery(db, sqlText, durationMs, { params, source } = {}) {
  if (!sqlText) return { logged: false, reason: "missing_sql" };
  if (durationMs == null || durationMs < 0)
    return { logged: false, reason: "invalid_duration" };

  const id = _id();
  const now = _now();

  // Extract table names from SQL
  const tableMatches =
    sqlText.match(/(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi) || [];
  const tables = [...new Set(tableMatches.map((m) => m.split(/\s+/).pop()))];
  const tablesAccessed = tables.join(",");

  const record = {
    id,
    sql_text: sqlText,
    params_json: params ? JSON.stringify(params) : null,
    duration_ms: durationMs,
    source: source || null,
    tables_accessed: tablesAccessed,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO _query_log (id, sql_text, params_json, duration_ms, source, tables_accessed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    record.sql_text,
    record.params_json,
    durationMs,
    record.source,
    tablesAccessed,
    now,
  );

  _queryLogs.push(record);

  return { logged: true, id, isSlow: durationMs >= _slowQueryThresholdMs };
}

export function getQueryStats(db) {
  if (_queryLogs.length === 0) {
    return {
      totalQueries: 0,
      slowQueries: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      slowQueryThresholdMs: _slowQueryThresholdMs,
      topSlow: [],
    };
  }

  const durations = _queryLogs.map((q) => q.duration_ms);
  const slow = _queryLogs.filter((q) => q.duration_ms >= _slowQueryThresholdMs);
  const avg =
    Math.round(
      (durations.reduce((s, d) => s + d, 0) / durations.length) * 100,
    ) / 100;
  const max = Math.max(...durations);

  // Top 10 slowest queries
  const topSlow = [..._queryLogs]
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 10)
    .map((q) => ({
      sql: q.sql_text.slice(0, 100),
      durationMs: q.duration_ms,
      tables: q.tables_accessed,
      source: q.source,
    }));

  return {
    totalQueries: _queryLogs.length,
    slowQueries: slow.length,
    avgDurationMs: avg,
    maxDurationMs: max,
    slowQueryThresholdMs: _slowQueryThresholdMs,
    topSlow,
  };
}

export function setSlowQueryThreshold(ms) {
  if (ms == null || ms < 0) return { set: false, reason: "invalid_threshold" };
  _slowQueryThresholdMs = ms;
  return { set: true, thresholdMs: ms };
}

export function clearQueryLog(db) {
  db.prepare("DELETE FROM _query_log").run();
  const count = _queryLogs.length;
  _queryLogs = [];
  return { cleared: true, count };
}

/* ── Index Optimization ─────────────────────────────────── */

/**
 * Analyze query logs to generate index suggestions.
 * Heuristic: extract WHERE-clause columns from slow queries,
 * count frequency per table+column, suggest indexes for frequent patterns.
 */
export function analyzeQueries(db, { minQueryCount = 2 } = {}) {
  const slow = _queryLogs.filter((q) => q.duration_ms >= _slowQueryThresholdMs);
  if (slow.length === 0) return { analyzed: true, suggestionsGenerated: 0 };

  // Extract WHERE columns per table
  const tableColumnCounts = new Map(); // "table:col" → count

  for (const q of slow) {
    const tables = (q.tables_accessed || "").split(",").filter(Boolean);
    if (tables.length === 0) continue;

    // Extract column names from WHERE clauses
    const whereMatch = q.sql_text.match(
      /WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/is,
    );
    if (!whereMatch) continue;

    const wherePart = whereMatch[1];
    const colMatches =
      wherePart.match(/(\w+)\s*(?:=|>|<|>=|<=|LIKE|IN)\s*/gi) || [];
    const cols = colMatches
      .map((m) => m.replace(/\s*(?:=|>|<|>=|<=|LIKE|IN)\s*/i, "").trim())
      .filter(Boolean);

    const primaryTable = tables[0];
    for (const col of cols) {
      const key = `${primaryTable}:${col}`;
      tableColumnCounts.set(key, (tableColumnCounts.get(key) || 0) + 1);
    }
  }

  // Generate suggestions for columns that appear at least minQueryCount times
  let generated = 0;
  for (const [key, count] of tableColumnCounts) {
    if (count < minQueryCount) continue;

    const [tableName, column] = key.split(":");
    const existingId = [..._suggestions.values()].find(
      (s) => s.table_name === tableName && s.columns === column && !s.applied,
    );
    if (existingId) continue; // Don't duplicate

    const id = _id();
    const now = _now();
    const estimatedImprovement = Math.min(
      0.9,
      Math.round((count / slow.length) * 100) / 100,
    );

    const suggestion = {
      id,
      table_name: tableName,
      columns: column,
      suggestion_type: "create_index",
      estimated_improvement: estimatedImprovement,
      query_count: count,
      applied: 0,
      created_at: now,
    };

    db.prepare(
      `INSERT INTO _index_suggestions (id, table_name, columns, suggestion_type, estimated_improvement, query_count, applied, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      tableName,
      column,
      "create_index",
      estimatedImprovement,
      count,
      0,
      now,
    );

    _suggestions.set(id, suggestion);
    generated++;
  }

  // Detect composite index opportunities (2+ columns on same table)
  const tableColumns = new Map(); // table → [cols]
  for (const [key] of tableColumnCounts) {
    const [table, col] = key.split(":");
    if (!tableColumns.has(table)) tableColumns.set(table, []);
    tableColumns.get(table).push(col);
  }

  for (const [table, cols] of tableColumns) {
    if (cols.length >= 2) {
      const compositeKey = cols.sort().join(",");
      const existingComposite = [..._suggestions.values()].find(
        (s) => s.table_name === table && s.columns === compositeKey,
      );
      if (!existingComposite) {
        const id = _id();
        const now = _now();
        const totalCount = cols.reduce(
          (s, c) => s + (tableColumnCounts.get(`${table}:${c}`) || 0),
          0,
        );

        const suggestion = {
          id,
          table_name: table,
          columns: compositeKey,
          suggestion_type: "composite_index",
          estimated_improvement: Math.min(
            0.95,
            Math.round((totalCount / slow.length) * 100) / 100,
          ),
          query_count: totalCount,
          applied: 0,
          created_at: now,
        };

        db.prepare(
          `INSERT INTO _index_suggestions (id, table_name, columns, suggestion_type, estimated_improvement, query_count, applied, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          table,
          compositeKey,
          "composite_index",
          suggestion.estimated_improvement,
          totalCount,
          0,
          now,
        );

        _suggestions.set(id, suggestion);
        generated++;
      }
    }
  }

  return {
    analyzed: true,
    suggestionsGenerated: generated,
    slowQueriesAnalyzed: slow.length,
  };
}

export function listSuggestions(db, { applied } = {}) {
  let sugs = [..._suggestions.values()];
  if (applied != null) {
    sugs = sugs.filter((s) => (applied ? s.applied === 1 : s.applied === 0));
  }
  return sugs
    .sort((a, b) => b.query_count - a.query_count)
    .map((s) => ({ ...s }));
}

export function getSuggestion(db, id) {
  const s = _suggestions.get(id);
  return s ? { ...s } : null;
}

export function applySuggestion(db, id) {
  const s = _suggestions.get(id);
  if (!s) return { applied: false, reason: "not_found" };
  if (s.applied) return { applied: false, reason: "already_applied" };

  s.applied = 1;
  db.prepare("UPDATE _index_suggestions SET applied = 1 WHERE id = ?").run(id);

  return {
    applied: true,
    indexSql: `CREATE INDEX IF NOT EXISTS idx_${s.table_name}_${s.columns.replace(/,/g, "_")} ON ${s.table_name} (${s.columns})`,
  };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getDbEvoStats(db) {
  const current = getCurrentVersion(db);
  const pending = getPendingMigrations(db);
  const slow = _queryLogs.filter((q) => q.duration_ms >= _slowQueryThresholdMs);
  const sugs = [..._suggestions.values()];

  return {
    migrations: {
      registered: _migrations.length,
      executed: _migrationHistory.length,
      currentVersion: current,
      pending: pending.length,
    },
    queryLog: {
      total: _queryLogs.length,
      slowQueries: slow.length,
      thresholdMs: _slowQueryThresholdMs,
    },
    suggestions: {
      total: sugs.length,
      pending: sugs.filter((s) => !s.applied).length,
      applied: sugs.filter((s) => s.applied).length,
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _migrations = [];
  _migrationHistory = [];
  _queryLogs = [];
  _suggestions.clear();
  _slowQueryThresholdMs = 100;
}

/* ═════════════════════════════════════════════════════════ *
 *  Phase 80 V2 — Schema Baseline + Migration-Run Lifecycle
 * ═════════════════════════════════════════════════════════ */

export const SCHEMA_BASELINE_V2 = Object.freeze({
  DRAFT: "draft",
  VALIDATED: "validated",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const MIGRATION_RUN_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  APPLIED: "applied",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
});

const BASELINE_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["validated", "retired"])],
  ["validated", new Set(["active", "retired"])],
  ["active", new Set(["deprecated", "retired"])],
  ["deprecated", new Set(["active", "retired"])],
]);
const BASELINE_TERMINALS_V2 = new Set(["retired"]);

const RUN_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "failed"])],
  ["running", new Set(["applied", "failed", "rolled_back"])],
  ["applied", new Set(["rolled_back"])],
]);
const RUN_TERMINALS_V2 = new Set(["failed", "rolled_back"]);

export const DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB = 1;
export const DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB = 1;
export const DBEVO_DEFAULT_BASELINE_IDLE_MS = 180 * 86400000; // 180 days
export const DBEVO_DEFAULT_MIGRATION_STUCK_MS = 30 * 60000; // 30 minutes

let _maxActiveBaselinesPerDbV2 = DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB;
let _maxRunningMigrationsPerDbV2 = DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB;
let _baselineIdleMsV2 = DBEVO_DEFAULT_BASELINE_IDLE_MS;
let _migrationStuckMsV2 = DBEVO_DEFAULT_MIGRATION_STUCK_MS;

function _positiveIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getDefaultMaxActiveBaselinesPerDbV2() {
  return DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB;
}
export function getMaxActiveBaselinesPerDbV2() {
  return _maxActiveBaselinesPerDbV2;
}
export function setMaxActiveBaselinesPerDbV2(n) {
  return (_maxActiveBaselinesPerDbV2 = _positiveIntV2(
    n,
    "maxActiveBaselinesPerDb",
  ));
}
export function getDefaultMaxRunningMigrationsPerDbV2() {
  return DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB;
}
export function getMaxRunningMigrationsPerDbV2() {
  return _maxRunningMigrationsPerDbV2;
}
export function setMaxRunningMigrationsPerDbV2(n) {
  return (_maxRunningMigrationsPerDbV2 = _positiveIntV2(
    n,
    "maxRunningMigrationsPerDb",
  ));
}
export function getDefaultBaselineIdleMsV2() {
  return DBEVO_DEFAULT_BASELINE_IDLE_MS;
}
export function getBaselineIdleMsV2() {
  return _baselineIdleMsV2;
}
export function setBaselineIdleMsV2(ms) {
  return (_baselineIdleMsV2 = _positiveIntV2(ms, "baselineIdleMs"));
}
export function getDefaultMigrationStuckMsV2() {
  return DBEVO_DEFAULT_MIGRATION_STUCK_MS;
}
export function getMigrationStuckMsV2() {
  return _migrationStuckMsV2;
}
export function setMigrationStuckMsV2(ms) {
  return (_migrationStuckMsV2 = _positiveIntV2(ms, "migrationStuckMs"));
}

const _baselinesV2 = new Map();
const _runsV2 = new Map();

export function registerBaselineV2(
  _db,
  { baselineId, databaseId, version, initialStatus, metadata } = {},
) {
  if (!baselineId) throw new Error("baselineId is required");
  if (!databaseId) throw new Error("databaseId is required");
  if (!version) throw new Error("version is required");
  if (_baselinesV2.has(baselineId))
    throw new Error(`Baseline ${baselineId} already exists`);
  const status = initialStatus || SCHEMA_BASELINE_V2.DRAFT;
  if (!Object.values(SCHEMA_BASELINE_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (BASELINE_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === SCHEMA_BASELINE_V2.ACTIVE) {
    if (getActiveBaselineCount(databaseId) >= _maxActiveBaselinesPerDbV2)
      throw new Error(
        `Database ${databaseId} reached active-baseline cap (${_maxActiveBaselinesPerDbV2})`,
      );
  }
  const now = Date.now();
  const record = {
    baselineId,
    databaseId,
    version,
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
  };
  _baselinesV2.set(baselineId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getBaselineV2(baselineId) {
  const r = _baselinesV2.get(baselineId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setBaselineStatusV2(_db, baselineId, newStatus, patch = {}) {
  const record = _baselinesV2.get(baselineId);
  if (!record) throw new Error(`Unknown baseline: ${baselineId}`);
  if (!Object.values(SCHEMA_BASELINE_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = BASELINE_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === SCHEMA_BASELINE_V2.ACTIVE) {
    if (getActiveBaselineCount(record.databaseId) >= _maxActiveBaselinesPerDbV2)
      throw new Error(
        `Database ${record.databaseId} reached active-baseline cap (${_maxActiveBaselinesPerDbV2})`,
      );
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function validateBaseline(db, id, reason) {
  return setBaselineStatusV2(db, id, SCHEMA_BASELINE_V2.VALIDATED, { reason });
}
export function activateBaseline(db, id, reason) {
  return setBaselineStatusV2(db, id, SCHEMA_BASELINE_V2.ACTIVE, { reason });
}
export function deprecateBaseline(db, id, reason) {
  return setBaselineStatusV2(db, id, SCHEMA_BASELINE_V2.DEPRECATED, { reason });
}
export function retireBaseline(db, id, reason) {
  return setBaselineStatusV2(db, id, SCHEMA_BASELINE_V2.RETIRED, { reason });
}

export function touchBaselineActivity(baselineId) {
  const record = _baselinesV2.get(baselineId);
  if (!record) throw new Error(`Unknown baseline: ${baselineId}`);
  record.lastTouchedAt = Date.now();
  record.updatedAt = record.lastTouchedAt;
  return { ...record, metadata: { ...record.metadata } };
}

export function enqueueMigrationRunV2(
  _db,
  { runId, databaseId, migrationId, direction, metadata } = {},
) {
  if (!runId) throw new Error("runId is required");
  if (!databaseId) throw new Error("databaseId is required");
  if (!migrationId) throw new Error("migrationId is required");
  if (!direction) throw new Error("direction is required");
  if (!Object.values(MIGRATION_DIRECTION).includes(direction))
    throw new Error(`Invalid direction: ${direction}`);
  if (_runsV2.has(runId)) throw new Error(`Run ${runId} already exists`);
  const now = Date.now();
  const record = {
    runId,
    databaseId,
    migrationId,
    direction,
    status: MIGRATION_RUN_V2.QUEUED,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  _runsV2.set(runId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getMigrationRunV2(runId) {
  const r = _runsV2.get(runId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setMigrationRunStatusV2(_db, runId, newStatus, patch = {}) {
  const record = _runsV2.get(runId);
  if (!record) throw new Error(`Unknown run: ${runId}`);
  if (!Object.values(MIGRATION_RUN_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = RUN_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === MIGRATION_RUN_V2.RUNNING) {
    if (
      getRunningMigrationCount(record.databaseId) >=
      _maxRunningMigrationsPerDbV2
    )
      throw new Error(
        `Database ${record.databaseId} reached running-migration cap (${_maxRunningMigrationsPerDbV2})`,
      );
    if (!record.startedAt) record.startedAt = Date.now();
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function startMigrationRun(db, id, reason) {
  return setMigrationRunStatusV2(db, id, MIGRATION_RUN_V2.RUNNING, { reason });
}
export function applyMigrationRun(db, id, reason) {
  return setMigrationRunStatusV2(db, id, MIGRATION_RUN_V2.APPLIED, { reason });
}
export function failMigrationRun(db, id, reason) {
  return setMigrationRunStatusV2(db, id, MIGRATION_RUN_V2.FAILED, { reason });
}
export function rollbackMigrationRun(db, id, reason) {
  return setMigrationRunStatusV2(db, id, MIGRATION_RUN_V2.ROLLED_BACK, {
    reason,
  });
}

export function getActiveBaselineCount(databaseId) {
  let n = 0;
  for (const r of _baselinesV2.values()) {
    if (r.status !== SCHEMA_BASELINE_V2.ACTIVE) continue;
    if (databaseId && r.databaseId !== databaseId) continue;
    n++;
  }
  return n;
}

export function getRunningMigrationCount(databaseId) {
  let n = 0;
  for (const r of _runsV2.values()) {
    if (r.status !== MIGRATION_RUN_V2.RUNNING) continue;
    if (databaseId && r.databaseId !== databaseId) continue;
    n++;
  }
  return n;
}

export function autoRetireIdleBaselines(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _baselinesV2.values()) {
    if (
      r.status === SCHEMA_BASELINE_V2.DEPRECATED ||
      r.status === SCHEMA_BASELINE_V2.DRAFT ||
      r.status === SCHEMA_BASELINE_V2.VALIDATED
    ) {
      if (now - r.lastTouchedAt > _baselineIdleMsV2) {
        r.status = SCHEMA_BASELINE_V2.RETIRED;
        r.updatedAt = now;
        r.lastReason = "idle_timeout";
        flipped.push(r.baselineId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckMigrationRuns(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _runsV2.values()) {
    if (r.status === MIGRATION_RUN_V2.RUNNING) {
      const anchor = r.startedAt || r.createdAt;
      if (now - anchor > _migrationStuckMsV2) {
        r.status = MIGRATION_RUN_V2.FAILED;
        r.updatedAt = now;
        r.lastReason = "migration_timeout";
        flipped.push(r.runId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function getDbEvoStatsV2() {
  const baselinesByStatus = {};
  for (const s of Object.values(SCHEMA_BASELINE_V2)) baselinesByStatus[s] = 0;
  const runsByStatus = {};
  for (const s of Object.values(MIGRATION_RUN_V2)) runsByStatus[s] = 0;
  for (const r of _baselinesV2.values()) baselinesByStatus[r.status]++;
  for (const r of _runsV2.values()) runsByStatus[r.status]++;
  return {
    totalBaselinesV2: _baselinesV2.size,
    totalRunsV2: _runsV2.size,
    maxActiveBaselinesPerDb: _maxActiveBaselinesPerDbV2,
    maxRunningMigrationsPerDb: _maxRunningMigrationsPerDbV2,
    baselineIdleMs: _baselineIdleMsV2,
    migrationStuckMs: _migrationStuckMsV2,
    baselinesByStatus,
    runsByStatus,
  };
}

export function _resetStateV2() {
  _maxActiveBaselinesPerDbV2 = DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB;
  _maxRunningMigrationsPerDbV2 = DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB;
  _baselineIdleMsV2 = DBEVO_DEFAULT_BASELINE_IDLE_MS;
  _migrationStuckMsV2 = DBEVO_DEFAULT_MIGRATION_STUCK_MS;
  _baselinesV2.clear();
  _runsV2.clear();
}

// =====================================================================
// dbevo V2 governance overlay (iter23)
// =====================================================================
export const DBEVOGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const DBEVOGOV_MIGRATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  APPLYING: "applying",
  APPLIED: "applied",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _dbevogovPTrans = new Map([
  [
    DBEVOGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE,
      DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      DBEVOGOV_PROFILE_MATURITY_V2.PAUSED,
      DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DBEVOGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE,
      DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _dbevogovPTerminal = new Set([DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _dbevogovJTrans = new Map([
  [
    DBEVOGOV_MIGRATION_LIFECYCLE_V2.QUEUED,
    new Set([
      DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING,
      DBEVOGOV_MIGRATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING,
    new Set([
      DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLIED,
      DBEVOGOV_MIGRATION_LIFECYCLE_V2.FAILED,
      DBEVOGOV_MIGRATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLIED, new Set()],
  [DBEVOGOV_MIGRATION_LIFECYCLE_V2.FAILED, new Set()],
  [DBEVOGOV_MIGRATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _dbevogovPsV2 = new Map();
const _dbevogovJsV2 = new Map();
let _dbevogovMaxActive = 8,
  _dbevogovMaxPending = 20,
  _dbevogovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _dbevogovStuckMs = 60 * 1000;
function _dbevogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _dbevogovCheckP(from, to) {
  const a = _dbevogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dbevogov profile transition ${from} → ${to}`);
}
function _dbevogovCheckJ(from, to) {
  const a = _dbevogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dbevogov migration transition ${from} → ${to}`);
}
function _dbevogovCountActive(owner) {
  let c = 0;
  for (const p of _dbevogovPsV2.values())
    if (p.owner === owner && p.status === DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _dbevogovCountPending(profileId) {
  let c = 0;
  for (const j of _dbevogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === DBEVOGOV_MIGRATION_LIFECYCLE_V2.QUEUED ||
        j.status === DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING)
    )
      c++;
  return c;
}
export function setMaxActiveDbevogovProfilesPerOwnerV2(n) {
  _dbevogovMaxActive = _dbevogovPos(n, "maxActiveDbevogovProfilesPerOwner");
}
export function getMaxActiveDbevogovProfilesPerOwnerV2() {
  return _dbevogovMaxActive;
}
export function setMaxPendingDbevogovMigrationsPerProfileV2(n) {
  _dbevogovMaxPending = _dbevogovPos(
    n,
    "maxPendingDbevogovMigrationsPerProfile",
  );
}
export function getMaxPendingDbevogovMigrationsPerProfileV2() {
  return _dbevogovMaxPending;
}
export function setDbevogovProfileIdleMsV2(n) {
  _dbevogovIdleMs = _dbevogovPos(n, "dbevogovProfileIdleMs");
}
export function getDbevogovProfileIdleMsV2() {
  return _dbevogovIdleMs;
}
export function setDbevogovMigrationStuckMsV2(n) {
  _dbevogovStuckMs = _dbevogovPos(n, "dbevogovMigrationStuckMs");
}
export function getDbevogovMigrationStuckMsV2() {
  return _dbevogovStuckMs;
}
export function _resetStateDbevoGovV2() {
  _dbevogovPsV2.clear();
  _dbevogovJsV2.clear();
  _dbevogovMaxActive = 8;
  _dbevogovMaxPending = 20;
  _dbevogovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _dbevogovStuckMs = 60 * 1000;
}
export function registerDbevogovProfileV2({
  id,
  owner,
  schema,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_dbevogovPsV2.has(id))
    throw new Error(`dbevogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    schema: schema || "default",
    status: DBEVOGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dbevogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateDbevogovProfileV2(id) {
  const p = _dbevogovPsV2.get(id);
  if (!p) throw new Error(`dbevogov profile ${id} not found`);
  const isInitial = p.status === DBEVOGOV_PROFILE_MATURITY_V2.PENDING;
  _dbevogovCheckP(p.status, DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _dbevogovCountActive(p.owner) >= _dbevogovMaxActive)
    throw new Error(
      `max active dbevogov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseDbevogovProfileV2(id) {
  const p = _dbevogovPsV2.get(id);
  if (!p) throw new Error(`dbevogov profile ${id} not found`);
  _dbevogovCheckP(p.status, DBEVOGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = DBEVOGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveDbevogovProfileV2(id) {
  const p = _dbevogovPsV2.get(id);
  if (!p) throw new Error(`dbevogov profile ${id} not found`);
  _dbevogovCheckP(p.status, DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = DBEVOGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDbevogovProfileV2(id) {
  const p = _dbevogovPsV2.get(id);
  if (!p) throw new Error(`dbevogov profile ${id} not found`);
  if (_dbevogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal dbevogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDbevogovProfileV2(id) {
  const p = _dbevogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDbevogovProfilesV2() {
  return [..._dbevogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createDbevogovMigrationV2({
  id,
  profileId,
  version,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_dbevogovJsV2.has(id))
    throw new Error(`dbevogov migration ${id} already exists`);
  if (!_dbevogovPsV2.has(profileId))
    throw new Error(`dbevogov profile ${profileId} not found`);
  if (_dbevogovCountPending(profileId) >= _dbevogovMaxPending)
    throw new Error(
      `max pending dbevogov migrations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    version: version || "",
    status: DBEVOGOV_MIGRATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dbevogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function applyingDbevogovMigrationV2(id) {
  const j = _dbevogovJsV2.get(id);
  if (!j) throw new Error(`dbevogov migration ${id} not found`);
  _dbevogovCheckJ(j.status, DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING);
  const now = Date.now();
  j.status = DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeMigrationDbevogovV2(id) {
  const j = _dbevogovJsV2.get(id);
  if (!j) throw new Error(`dbevogov migration ${id} not found`);
  _dbevogovCheckJ(j.status, DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLIED);
  const now = Date.now();
  j.status = DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLIED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failDbevogovMigrationV2(id, reason) {
  const j = _dbevogovJsV2.get(id);
  if (!j) throw new Error(`dbevogov migration ${id} not found`);
  _dbevogovCheckJ(j.status, DBEVOGOV_MIGRATION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = DBEVOGOV_MIGRATION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelDbevogovMigrationV2(id, reason) {
  const j = _dbevogovJsV2.get(id);
  if (!j) throw new Error(`dbevogov migration ${id} not found`);
  _dbevogovCheckJ(j.status, DBEVOGOV_MIGRATION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = DBEVOGOV_MIGRATION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getDbevogovMigrationV2(id) {
  const j = _dbevogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listDbevogovMigrationsV2() {
  return [..._dbevogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleDbevogovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _dbevogovPsV2.values())
    if (
      p.status === DBEVOGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _dbevogovIdleMs
    ) {
      p.status = DBEVOGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDbevogovMigrationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _dbevogovJsV2.values())
    if (
      j.status === DBEVOGOV_MIGRATION_LIFECYCLE_V2.APPLYING &&
      j.startedAt != null &&
      t - j.startedAt >= _dbevogovStuckMs
    ) {
      j.status = DBEVOGOV_MIGRATION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getDbevoGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(DBEVOGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _dbevogovPsV2.values()) profilesByStatus[p.status]++;
  const migrationsByStatus = {};
  for (const v of Object.values(DBEVOGOV_MIGRATION_LIFECYCLE_V2))
    migrationsByStatus[v] = 0;
  for (const j of _dbevogovJsV2.values()) migrationsByStatus[j.status]++;
  return {
    totalDbevogovProfilesV2: _dbevogovPsV2.size,
    totalDbevogovMigrationsV2: _dbevogovJsV2.size,
    maxActiveDbevogovProfilesPerOwner: _dbevogovMaxActive,
    maxPendingDbevogovMigrationsPerProfile: _dbevogovMaxPending,
    dbevogovProfileIdleMs: _dbevogovIdleMs,
    dbevogovMigrationStuckMs: _dbevogovStuckMs,
    profilesByStatus,
    migrationsByStatus,
  };
}
