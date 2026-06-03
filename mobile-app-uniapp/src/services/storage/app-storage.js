/**
 * App Plus Storage - plus.sqlite implementation for iOS/Android native apps
 * Uses uni-app's plus.sqlite APIs for native SQLite database
 */

import { StorageInterface } from './storage-interface.js';
import CryptoJS from 'crypto-js';

export class AppStorage extends StorageInterface {
  constructor() {
    super();
    this.dbName = 'chainlesschain.db';
    this.db = null;
  }

  /**
   * Initialize SQLite database and set up encryption
   */
  async init(pin) {
    if (this.isInitialized) {
      return;
    }

    // Derive encryption key from PIN
    const salt = plus.storage.getItem('db_salt') || this._generateSalt();
    if (!plus.storage.getItem('db_salt')) {
      plus.storage.setItem('db_salt', salt);
    }

    this.encryptionKey = CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA256
    }).toString();

    // Open SQLite database
    await this._openDatabase();
    await this._createTables();
    this.isInitialized = true;
  }

  /**
   * Open SQLite database connection
   */
  async _openDatabase() {
    return new Promise((resolve, reject) => {
      this.db = plus.sqlite.openDatabase({
        name: this.dbName,
        path: '_doc/' + this.dbName,
        success: () => resolve(),
        fail: (error) => reject(new Error(`Failed to open database: ${error.message}`))
      });
    });
  }

  /**
   * Create database tables
   */
  async _createTables() {
    const tables = [
      {
        name: 'notes',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'chat_conversations',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'chat_messages',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'did_identities',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'p2p_messages',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'contacts',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'social_posts',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'social_comments',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'projects',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'project_files',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'project_tasks',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'trade_assets',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'trade_orders',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      },
      {
        name: 'settings',
        columns: 'id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT'
      }
    ];

    for (const table of tables) {
      await this._executeSql(
        `CREATE TABLE IF NOT EXISTS ${table.name} (${table.columns})`
      );
      await this._executeSql(
        `CREATE INDEX IF NOT EXISTS idx_${table.name}_created ON ${table.name}(created_at)`
      );
      await this._executeSql(
        `CREATE INDEX IF NOT EXISTS idx_${table.name}_updated ON ${table.name}(updated_at)`
      );
    }
  }

  /**
   * Execute SQL statement
   */
  async _executeSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      plus.sqlite.executeSql({
        name: this.dbName,
        sql: sql,
        success: (result) => resolve(result),
        fail: (error) => reject(new Error(`SQL execution failed: ${error.message}`))
      });
    });
  }

  /**
   * Select SQL query
   */
  async _selectSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      plus.sqlite.selectSql({
        name: this.dbName,
        sql: sql,
        success: (result) => resolve(result),
        fail: (error) => reject(new Error(`SQL select failed: ${error.message}`))
      });
    });
  }

  /**
   * Query records from a table
   */
  async query(table, conditions = {}, options = {}) {
    this._checkInitialized();

    let sql = `SELECT * FROM ${table}`;
    const params = [];

    // Build WHERE clause
    if (Object.keys(conditions).length > 0) {
      const whereClauses = Object.entries(conditions).map(([key, value]) => {
        params.push(value);
        return `json_extract(data, '$.${key}') = ?`;
      });
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    // Add ORDER BY
    if (options.orderBy) {
      const [field, direction] = options.orderBy.split(' ');
      sql += ` ORDER BY ${field} ${direction || 'ASC'}`;
    }

    // Add LIMIT and OFFSET
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
      if (options.offset) {
        sql += ` OFFSET ${options.offset}`;
      }
    }

    const result = await this._selectSql(sql, params);

    // Decrypt and parse data
    return result.map(row => {
      const decrypted = this._decrypt({ _encrypted: row.data });
      return {
        ...decrypted,
        id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
  }

  /**
   * Get a single record by ID
   */
  async getById(table, id) {
    this._checkInitialized();

    const sql = `SELECT * FROM ${table} WHERE id = ?`;
    const result = await this._selectSql(sql, [id]);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    const decrypted = this._decrypt({ _encrypted: row.data });
    return {
      ...decrypted,
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Insert a new record
   */
  async insert(table, data) {
    this._checkInitialized();

    // Generate ID if not provided
    if (!data.id) {
      data.id = this._generateId();
    }

    // Add timestamps
    const now = new Date().toISOString();
    data.created_at = data.created_at || now;
    data.updated_at = now;

    // Encrypt data
    const encrypted = this._encrypt(data);

    const sql = `INSERT INTO ${table} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`;
    await this._executeSql(sql, [data.id, encrypted._encrypted, data.created_at, data.updated_at]);

    return data.id;
  }

  /**
   * Update an existing record
   */
  async update(table, id, data) {
    this._checkInitialized();

    // Get existing record
    const existing = await this.getById(table, id);
    if (!existing) {
      return false;
    }

    // Merge data
    const updated = { ...existing, ...data, id, updated_at: new Date().toISOString() };

    // Encrypt data
    const encrypted = this._encrypt(updated);

    const sql = `UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`;
    await this._executeSql(sql, [encrypted._encrypted, updated.updated_at, id]);

    return true;
  }

  /**
   * Delete a record
   */
  async delete(table, id) {
    this._checkInitialized();

    const sql = `DELETE FROM ${table} WHERE id = ?`;
    await this._executeSql(sql, [id]);

    return true;
  }

  /**
   * Execute a batch of operations in a transaction
   */
  async transaction(operations) {
    this._checkInitialized();

    try {
      await this._executeSql('BEGIN TRANSACTION');
      const result = await operations();
      await this._executeSql('COMMIT');
      return result;
    } catch (error) {
      await this._executeSql('ROLLBACK');
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * Count records in a table
   */
  async count(table, conditions = {}) {
    this._checkInitialized();

    let sql = `SELECT COUNT(*) as count FROM ${table}`;
    const params = [];

    // Build WHERE clause
    if (Object.keys(conditions).length > 0) {
      const whereClauses = Object.entries(conditions).map(([key, value]) => {
        params.push(value);
        return `json_extract(data, '$.${key}') = ?`;
      });
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    const result = await this._selectSql(sql, params);
    return result[0].count;
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        plus.sqlite.closeDatabase({
          name: this.dbName,
          success: () => {
            this.db = null;
            this.isInitialized = false;
            resolve();
          },
          fail: (error) => reject(new Error(`Failed to close database: ${error.message}`))
        });
      });
    }
  }

  /**
   * Clear all data
   */
  async clear() {
    this._checkInitialized();

    const tables = [
      'notes', 'chat_conversations', 'chat_messages', 'did_identities',
      'p2p_messages', 'contacts', 'social_posts', 'social_comments',
      'projects', 'project_files', 'project_tasks', 'trade_assets',
      'trade_orders', 'settings'
    ];

    for (const table of tables) {
      await this._executeSql(`DELETE FROM ${table}`);
    }
  }

  // Helper methods

  _checkInitialized() {
    if (!this.isInitialized) {
      throw new Error('Storage not initialized. Call init() first.');
    }
  }

  _generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateSalt() {
    return CryptoJS.lib.WordArray.random(256 / 8).toString();
  }

  _encrypt(data) {
    const jsonStr = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonStr, this.encryptionKey).toString();
    return { id: data.id, _encrypted: encrypted };
  }

  _decrypt(data) {
    if (!data._encrypted) {
      return data; // Not encrypted
    }

    try {
      const decrypted = CryptoJS.AES.decrypt(data._encrypted, this.encryptionKey);
      const jsonStr = decrypted.toString(CryptoJS.enc.Utf8);
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Decryption failed:', error);
      return data;
    }
  }
}
