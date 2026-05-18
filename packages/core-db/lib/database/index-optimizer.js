/**
 * @module core-db/index-optimizer
 * SQLite index analysis and optimization suggestions
 *
 * Extracted from desktop-app-vue/src/main/database/index-optimizer.js
 */
const EventEmitter = require("events");
const { getLogger } = require("../logger-adapter.js");

class IndexOptimizer extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._queryLog = [];
    this._queryLogLimit = 1000;
    this._suggestions = [];
  }

  async initialize(db) {
    if (this.initialized) return;
    this.db = db;
    this.initialized = true;
    getLogger().info("[IndexOptimizer] Initialized");
  }

  logQuery(sql, duration) {
    this._queryLog.push({
      sql: sql.substring(0, 500),
      duration,
      timestamp: Date.now(),
    });
    if (this._queryLog.length > this._queryLogLimit) {
      this._queryLog.shift();
    }
  }

  analyze() {
    const logger = getLogger();
    if (!this.db) {
      return { suggestions: [], tables: [] };
    }

    const suggestions = [];

    try {
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'",
        )
        .all();

      const existingIndexes = this.db
        .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index'")
        .all();

      const indexedTables = new Set(existingIndexes.map((i) => i.tbl_name));

      for (const table of tables) {
        const tableInfo = this.db
          .prepare(`PRAGMA table_info(${table.name})`)
          .all();

        if (!indexedTables.has(table.name) && tableInfo.length > 2) {
          suggestions.push({
            type: "missing_index",
            table: table.name,
            severity: "medium",
            message: `Table '${table.name}' has no indexes (${tableInfo.length} columns)`,
            suggestion: `Consider adding indexes on frequently queried columns`,
          });
        }

        for (const col of tableInfo) {
          if (
            col.name.endsWith("_id") ||
            col.name.endsWith("_at") ||
            col.name === "status" ||
            col.name === "type"
          ) {
            const hasIndex = existingIndexes.some(
              (idx) =>
                idx.tbl_name === table.name && idx.name.includes(col.name),
            );
            if (!hasIndex) {
              suggestions.push({
                type: "suggested_index",
                table: table.name,
                column: col.name,
                severity: "low",
                message: `Column '${table.name}.${col.name}' may benefit from an index`,
                suggestion: `CREATE INDEX IF NOT EXISTS idx_${table.name}_${col.name} ON ${table.name}(${col.name})`,
              });
            }
          }
        }
      }

      const slowQueries = this._queryLog.filter((q) => q.duration > 100);
      if (slowQueries.length > 0) {
        suggestions.push({
          type: "slow_queries",
          severity: "high",
          message: `${slowQueries.length} queries took >100ms`,
          queries: slowQueries.slice(-5).map((q) => ({
            sql: q.sql,
            duration: q.duration,
          })),
        });
      }

      this._suggestions = suggestions;
      return {
        suggestions,
        tables: tables.map((t) => t.name),
        existingIndexes: existingIndexes.length,
      };
    } catch (error) {
      logger.error("[IndexOptimizer] Analysis failed:", error.message);
      return { suggestions: [], tables: [], error: error.message };
    }
  }

  getQueryStats() {
    if (this._queryLog.length === 0) {
      return { totalQueries: 0, avgDuration: 0, slowQueries: 0 };
    }
    const durations = this._queryLog.map((q) => q.duration);
    return {
      totalQueries: this._queryLog.length,
      avgDuration: Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length,
      ),
      maxDuration: Math.max(...durations),
      slowQueries: durations.filter((d) => d > 100).length,
    };
  }
}

let instance = null;
function getIndexOptimizer() {
  if (!instance) {
    instance = new IndexOptimizer();
  }
  return instance;
}

module.exports = { IndexOptimizer, getIndexOptimizer };
