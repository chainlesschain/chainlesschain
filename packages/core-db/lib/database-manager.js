/**
 * @module core-db/database-manager
 * Headless database manager for CLI and shared usage.
 *
 * This is a lightweight adapter that:
 * 1. Loads the best available SQLite driver
 * 2. Runs schema creation/migrations
 * 3. Provides a simple query interface
 *
 * The full DatabaseManager (9400+ lines) remains in desktop-app-vue
 * and will be gradually migrated. This module covers CLI use cases.
 */

const fs = require("fs");
const path = require("path");
const { getLogger } = require("./logger-adapter.js");

/**
 * Try to load the best available SQLite driver
 * Priority: better-sqlite3-multiple-ciphers > better-sqlite3 > sql.js
 *
 * Each native candidate is probed with `new Database(':memory:').close()`
 * before being accepted — `require()` on the JS wrapper succeeds even
 * when the underlying `.node` has an ABI mismatch (e.g. pkg packages
 * Node 20 but the prebuilt .node targets Node 22, surfacing as
 * `NODE_MODULE_VERSION 127 ... requires 115` only at construct time).
 * Without the probe, the manager would pick an unusable driver and
 * blow up later during initialize(), instead of transparently falling
 * back to the sql.js WASM runtime.
 */
function loadSQLiteDriver() {
  const logger = getLogger();

  // Try better-sqlite3-multiple-ciphers (with encryption)
  try {
    const Database = require("better-sqlite3-multiple-ciphers");
    const probe = new Database(":memory:");
    probe.close();
    logger.info("[DatabaseManager] Using better-sqlite3-multiple-ciphers");
    return { type: "native-cipher", Database };
  } catch (err) {
    logger.warn(
      `[DatabaseManager] better-sqlite3-multiple-ciphers unusable: ${
        (err && err.message ? err.message : String(err)).split("\n")[0]
      }`,
    );
  }

  // Try better-sqlite3 (no encryption)
  try {
    const Database = require("better-sqlite3");
    const probe = new Database(":memory:");
    probe.close();
    logger.info("[DatabaseManager] Using better-sqlite3 (no encryption)");
    return { type: "native", Database };
  } catch (err) {
    logger.warn(
      `[DatabaseManager] better-sqlite3 unusable: ${
        (err && err.message ? err.message : String(err)).split("\n")[0]
      }`,
    );
  }

  // Fallback: sql.js (pure JS, WASM)
  try {
    const initSqlJs = require("sql.js");
    logger.info("[DatabaseManager] Using sql.js (WASM fallback)");
    return { type: "wasm", initSqlJs };
  } catch {
    // Not available
  }

  return null;
}

class DatabaseManager {
  constructor(options = {}) {
    this.dbPath = options.dbPath || null;
    this.encryptionKey = options.encryptionKey || null;
    this.db = null;
    this.driver = null;
    this.initialized = false;
  }

  /**
   * Initialize the database
   * @param {object} [options]
   * @param {string} [options.dbPath] - Database file path
   * @param {string} [options.encryptionKey] - Encryption key for SQLCipher
   */
  async initialize(options = {}) {
    const logger = getLogger();

    if (this.initialized) return this.db;

    const dbPath = options.dbPath || this.dbPath;
    if (!dbPath) {
      throw new Error("Database path not specified");
    }

    this.dbPath = dbPath;
    this.encryptionKey = options.encryptionKey || this.encryptionKey;

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const driver = loadSQLiteDriver();
    if (!driver) {
      throw new Error(
        "No SQLite driver available. Install better-sqlite3 or sql.js.",
      );
    }

    this.driver = driver;

    try {
      if (driver.type === "native-cipher" || driver.type === "native") {
        this.db = new driver.Database(dbPath);

        // Apply encryption if using cipher driver and key provided
        if (driver.type === "native-cipher" && this.encryptionKey) {
          this.db.pragma(`key='${this.encryptionKey}'`);
        }

        // Enable WAL mode for better concurrency
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
      } else if (driver.type === "wasm") {
        const SQL = await driver.initSqlJs();
        const raw = fs.existsSync(dbPath)
          ? new SQL.Database(fs.readFileSync(dbPath))
          : new SQL.Database();
        // Wrap sql.js so calling code written against the better-sqlite3
        // surface (prepare().all/get/run, transaction, pragma) keeps
        // working transparently. Without this the fallback is theoretical
        // only — UI startup for instance calls `prepare(...).all()`.
        this.db = createSqlJsCompat(raw, dbPath);
      }

      this.initialized = true;
      logger.info(`[DatabaseManager] Database initialized: ${dbPath}`);
      return this.db;
    } catch (error) {
      logger.error("[DatabaseManager] Failed to initialize:", error.message);
      throw error;
    }
  }

  /**
   * Get the raw database connection
   */
  getDatabase() {
    if (!this.initialized) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  /**
   * Execute a SQL statement (CREATE TABLE, INSERT, etc.)
   */
  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * Prepare a SQL statement
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * Run a query and return all rows
   */
  all(sql, ...params) {
    const stmt = this.db.prepare(sql);
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  }

  /**
   * Run a query and return the first row
   */
  get(sql, ...params) {
    const stmt = this.db.prepare(sql);
    return params.length > 0 ? stmt.get(...params) : stmt.get();
  }

  /**
   * Run an INSERT/UPDATE/DELETE statement
   */
  run(sql, ...params) {
    const stmt = this.db.prepare(sql);
    return params.length > 0 ? stmt.run(...params) : stmt.run();
  }

  /**
   * Run multiple statements in a transaction
   */
  transaction(fn) {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /**
   * Get database info
   */
  getInfo() {
    const logger = getLogger();
    try {
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();

      const fileSize = fs.existsSync(this.dbPath)
        ? fs.statSync(this.dbPath).size
        : 0;

      return {
        path: this.dbPath,
        driver: this.driver.type,
        encrypted: this.driver.type === "native-cipher" && !!this.encryptionKey,
        tables: tables.map((t) => t.name),
        tableCount: tables.length,
        fileSize,
        fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
      };
    } catch (error) {
      logger.error("[DatabaseManager] Failed to get info:", error.message);
      return { error: error.message };
    }
  }

  /**
   * Close the database connection
   */
  close() {
    const logger = getLogger();
    if (this.db) {
      try {
        // The wasm wrapper persists on close; native drivers close directly.
        this.db.close();
        logger.info("[DatabaseManager] Database closed");
      } catch (error) {
        logger.error(
          "[DatabaseManager] Error closing database:",
          error.message,
        );
      }
    }
    this.db = null;
    this.initialized = false;
  }

  /**
   * Create a backup of the database
   */
  backup(backupPath) {
    const logger = getLogger();
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      throw new Error("No database to backup");
    }

    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (this.driver.type === "wasm" && this.db) {
      const data = this.db.export();
      fs.writeFileSync(backupPath, Buffer.from(data));
    } else {
      // For native drivers, use file copy (db should be in WAL mode)
      fs.copyFileSync(this.dbPath, backupPath);
    }

    logger.info(`[DatabaseManager] Backup created: ${backupPath}`);
    return backupPath;
  }
}

/**
 * Adapt a raw sql.js Database so the subset of the better-sqlite3 API that
 * our callers actually use works unchanged. Covers prepare()/all/get/run,
 * exec, pragma (no-op — sql.js is in-memory so WAL/foreign-keys knobs are
 * either unsupported or already on), transaction, export, and close-with-
 * persist (sql.js lives in memory; changes vanish unless serialized to
 * disk).
 *
 * Limitations we accept:
 *   - pragma() is a no-op except `journal_mode=WAL` and `foreign_keys=ON`
 *     which sql.js treats as already handled internally.
 *   - run().lastInsertRowid is resolved via `SELECT last_insert_rowid()`
 *     immediately after step(), which is racy if the caller holds a
 *     reference across concurrent writes — fine for single-threaded node.
 *   - transaction() is synchronous; long async work inside a txn is not
 *     supported (same semantics as better-sqlite3).
 */
function createSqlJsCompat(raw, dbPath) {
  // Track transaction depth so write auto-persist inside run()/exec()
  // does not fire while a BEGIN…COMMIT is open. sql.js's `export()`
  // serializes the whole DB, and calling it between BEGIN and COMMIT
  // silently ends the transaction, which then surfaces as
  // "cannot commit - no transaction is active" when the txn wrapper
  // finally issues its COMMIT.
  const state = { txDepth: 0, closed: false };
  const persist = () => {
    if (state.txDepth > 0 || state.closed) return;
    try {
      const data = raw.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (e) {
      getLogger().warn(
        `[DatabaseManager] sql.js persist failed: ${e && e.message}`,
      );
    }
  };

  function prepare(sql) {
    return {
      all(...params) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(flattenParams(params));
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },
      get(...params) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(flattenParams(params));
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally {
          stmt.free();
        }
      },
      run(...params) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(flattenParams(params));
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = raw.getRowsModified();
        let lastInsertRowid = 0;
        try {
          const r = raw.exec("SELECT last_insert_rowid() AS id");
          lastInsertRowid = r[0] && r[0].values[0] ? r[0].values[0][0] : 0;
        } catch {
          /* best effort */
        }
        // Auto-persist on writes so a crash doesn't lose the row.
        persist();
        return { changes, lastInsertRowid: Number(lastInsertRowid) };
      },
    };
  }

  return {
    __isSqlJsCompat: true,
    _raw: raw,
    prepare,
    exec(sql) {
      raw.exec(sql);
      persist();
      return this;
    },
    pragma() {
      // No-op — sql.js in-memory semantics cover our WAL / foreign_keys use.
    },
    transaction(fn) {
      return (...args) => {
        raw.exec("BEGIN");
        state.txDepth++;
        try {
          const r = fn(...args);
          raw.exec("COMMIT");
          state.txDepth--;
          persist();
          return r;
        } catch (e) {
          state.txDepth--;
          try {
            raw.exec("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw e;
        }
      };
    },
    export() {
      return raw.export();
    },
    close() {
      if (state.closed) return;
      persist();
      state.closed = true;
      try {
        raw.close();
      } catch {
        /* best effort */
      }
    },
  };
}

function flattenParams(params) {
  // better-sqlite3 accepts (a, b, c) OR ([a, b, c]) OR ({name: v}).
  // sql.js bind() wants a single array or object.
  if (params.length === 1 && (Array.isArray(params[0]) || isPlainObject(params[0]))) {
    return params[0];
  }
  return params;
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

let instance = null;

function getDatabaseManager() {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

module.exports = {
  DatabaseManager,
  getDatabaseManager,
  // Exposed for unit tests that want to exercise the sql.js compat layer
  // directly without going through the driver-probe path (which is itself
  // hard to reach from a dev machine with working natives installed).
  createSqlJsCompat,
  loadSQLiteDriver,
};
