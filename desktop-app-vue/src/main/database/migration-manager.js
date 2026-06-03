/**
 * @module database/migration-manager
 * Phase 80: Database migration framework
 * Supports versioned migrations (v1→v5) with up/down
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class MigrationManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._migrations = new Map();
    this._applied = new Set();
  }

  async initialize(db) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureMigrationTable();
    this._loadAppliedMigrations();
    this.initialized = true;
    logger.info(
      `[MigrationManager] Initialized, ${this._applied.size} migrations already applied`,
    );
  }

  _ensureMigrationTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now')),
          checksum TEXT,
          execution_time_ms INTEGER DEFAULT 0,
          status TEXT DEFAULT 'applied'
        )
      `);
    } catch (error) {
      logger.error(
        "[MigrationManager] Failed to create migration table:",
        error.message,
      );
    }
  }

  _loadAppliedMigrations() {
    try {
      const rows = this.db
        .prepare("SELECT id FROM _migrations WHERE status = 'applied'")
        .all();
      for (const row of rows) {
        this._applied.add(row.id);
      }
    } catch (error) {
      logger.warn(
        "[MigrationManager] Failed to load applied migrations:",
        error.message,
      );
    }
  }

  register(id, migration) {
    this._migrations.set(id, {
      id,
      version: migration.version || "1.0.0",
      name: migration.name || id,
      up: migration.up,
      down: migration.down || null,
      dependencies: migration.dependencies || [],
    });
  }

  async runAll() {
    const pending = this._getPendingMigrations();
    if (pending.length === 0) {
      logger.info("[MigrationManager] No pending migrations");
      return { applied: 0, skipped: 0, errors: [] };
    }

    let applied = 0;
    const errors = [];

    for (const migration of pending) {
      try {
        // Check dependencies
        for (const dep of migration.dependencies) {
          if (!this._applied.has(dep)) {
            throw new Error(`Dependency '${dep}' not yet applied`);
          }
        }

        const startTime = Date.now();
        await migration.up(this.db);
        const duration = Date.now() - startTime;

        this._recordMigration(migration, duration);
        this._applied.add(migration.id);
        applied++;

        this.emit("migration:applied", { id: migration.id, duration });
        logger.info(
          `[MigrationManager] Applied: ${migration.id} (${duration}ms)`,
        );
      } catch (error) {
        errors.push({ id: migration.id, error: error.message });
        logger.error(
          `[MigrationManager] Failed: ${migration.id}:`,
          error.message,
        );
        this.emit("migration:error", {
          id: migration.id,
          error: error.message,
        });
        break; // Stop on first error
      }
    }

    return {
      applied,
      skipped: pending.length - applied - errors.length,
      errors,
    };
  }

  async rollback(migrationId) {
    const migration = this._migrations.get(migrationId);
    if (!migration) {
      return { success: false, error: `Migration '${migrationId}' not found` };
    }
    if (!this._applied.has(migrationId)) {
      return {
        success: false,
        error: `Migration '${migrationId}' not applied`,
      };
    }
    if (!migration.down) {
      return {
        success: false,
        error: `Migration '${migrationId}' has no down function`,
      };
    }

    try {
      const startTime = Date.now();
      await migration.down(this.db);
      const duration = Date.now() - startTime;

      this.db
        .prepare("UPDATE _migrations SET status = 'rolled_back' WHERE id = ?")
        .run(migrationId);
      this._applied.delete(migrationId);

      this.emit("migration:rolled_back", { id: migrationId, duration });
      logger.info(
        `[MigrationManager] Rolled back: ${migrationId} (${duration}ms)`,
      );
      return { success: true, duration };
    } catch (error) {
      logger.error(
        `[MigrationManager] Rollback failed for ${migrationId}:`,
        error.message,
      );
      return { success: false, error: error.message };
    }
  }

  _getPendingMigrations() {
    return Array.from(this._migrations.values())
      .filter((m) => !this._applied.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  _recordMigration(migration, duration) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO _migrations (id, version, name, applied_at, execution_time_ms, status)
        VALUES (?, ?, ?, datetime('now'), ?, 'applied')
      `,
        )
        .run(migration.id, migration.version, migration.name, duration);
    } catch (error) {
      logger.error(
        "[MigrationManager] Failed to record migration:",
        error.message,
      );
    }
  }

  getStatus() {
    const all = Array.from(this._migrations.values());
    return {
      total: all.length,
      applied: this._applied.size,
      pending: all.filter((m) => !this._applied.has(m.id)).length,
      migrations: all.map((m) => ({
        id: m.id,
        version: m.version,
        name: m.name,
        status: this._applied.has(m.id) ? "applied" : "pending",
        hasDown: !!m.down,
      })),
    };
  }
}

let instance = null;
function getMigrationManager() {
  if (!instance) {
    instance = new MigrationManager();
  }
  return instance;
}

module.exports = { MigrationManager, getMigrationManager };
