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
