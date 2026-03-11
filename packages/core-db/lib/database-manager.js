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
 */
function loadSQLiteDriver() {
  const logger = getLogger();

  // Try better-sqlite3-multiple-ciphers (with encryption)
  try {
    const Database = require("better-sqlite3-multiple-ciphers");
    logger.info("[DatabaseManager] Using better-sqlite3-multiple-ciphers");
    return { type: "native-cipher", Database };
  } catch {
    // Not available
  }

  // Try better-sqlite3 (no encryption)
  try {
    const Database = require("better-sqlite3");
    logger.info("[DatabaseManager] Using better-sqlite3 (no encryption)");
    return { type: "native", Database };
  } catch {
    // Not available
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
        if (fs.existsSync(dbPath)) {
          const fileBuffer = fs.readFileSync(dbPath);
          this.db = new SQL.Database(fileBuffer);
        } else {
          this.db = new SQL.Database();
        }
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
        if (this.driver.type === "wasm") {
          // Save WASM database to file before closing
          const data = this.db.export();
          const buffer = Buffer.from(data);
          fs.writeFileSync(this.dbPath, buffer);
          this.db.close();
        } else {
          this.db.close();
        }
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

let instance = null;

function getDatabaseManager() {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

module.exports = { DatabaseManager, getDatabaseManager };
