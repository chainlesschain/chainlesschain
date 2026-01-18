/**
 * H5 Storage - IndexedDB implementation for web browsers
 * Uses IndexedDB for persistent storage with encryption support
 */

import { StorageInterface } from './storage-interface.js';
import CryptoJS from 'crypto-js';

export class H5Storage extends StorageInterface {
  constructor() {
    super();
    this.dbName = 'chainlesschain_db';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * Initialize IndexedDB and set up encryption
   */
  async init(pin) {
    if (this.isInitialized) {
      return;
    }

    // Derive encryption key from PIN
    const salt = localStorage.getItem('db_salt') || this._generateSalt();
    if (!localStorage.getItem('db_salt')) {
      localStorage.setItem('db_salt', salt);
    }

    this.encryptionKey = CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA256
    }).toString();

    // Open IndexedDB
    await this._openDatabase();
    this.isInitialized = true;
  }

  /**
   * Open IndexedDB connection
   */
  async _openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores for each table
        const tables = [
          'notes', 'chat_conversations', 'chat_messages', 'did_identities',
          'p2p_messages', 'contacts', 'social_posts', 'social_comments',
          'projects', 'project_files', 'project_tasks', 'trade_assets',
          'trade_orders', 'settings'
        ];

        tables.forEach(tableName => {
          if (!db.objectStoreNames.contains(tableName)) {
            const store = db.createObjectStore(tableName, { keyPath: 'id' });
            store.createIndex('created_at', 'created_at', { unique: false });
            store.createIndex('updated_at', 'updated_at', { unique: false });
          }
        });
      };
    });
  }

  /**
   * Query records from a table
   */
  async query(table, conditions = {}, options = {}) {
    this._checkInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([table], 'readonly');
      const store = transaction.objectStore(table);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result;

        // Decrypt data
        results = results.map(item => this._decrypt(item));

        // Apply conditions
        if (Object.keys(conditions).length > 0) {
          results = results.filter(item => {
            return Object.entries(conditions).every(([key, value]) => {
              return item[key] === value;
            });
          });
        }

        // Apply sorting
        if (options.orderBy) {
          const [field, direction] = options.orderBy.split(' ');
          results.sort((a, b) => {
            const aVal = a[field];
            const bVal = b[field];
            const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            return direction === 'DESC' ? -comparison : comparison;
          });
        }

        // Apply pagination
        if (options.limit) {
          const offset = options.offset || 0;
          results = results.slice(offset, offset + options.limit);
        }

        resolve(results);
      };

      request.onerror = () => reject(new Error(`Query failed for table ${table}`));
    });
  }

  /**
   * Get a single record by ID
   */
  async getById(table, id) {
    this._checkInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([table], 'readonly');
      const store = transaction.objectStore(table);
      const request = store.get(id);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? this._decrypt(result) : null);
      };

      request.onerror = () => reject(new Error(`Get by ID failed for table ${table}`));
    });
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
    const encryptedData = this._encrypt(data);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([table], 'readwrite');
      const store = transaction.objectStore(table);
      const request = store.add(encryptedData);

      request.onsuccess = () => resolve(data.id);
      request.onerror = () => reject(new Error(`Insert failed for table ${table}`));
    });
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
    const encryptedData = this._encrypt(updated);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([table], 'readwrite');
      const store = transaction.objectStore(table);
      const request = store.put(encryptedData);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error(`Update failed for table ${table}`));
    });
  }

  /**
   * Delete a record
   */
  async delete(table, id) {
    this._checkInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([table], 'readwrite');
      const store = transaction.objectStore(table);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error(`Delete failed for table ${table}`));
    });
  }

  /**
   * Execute a batch of operations in a transaction
   */
  async transaction(operations) {
    this._checkInitialized();

    try {
      return await operations();
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * Count records in a table
   */
  async count(table, conditions = {}) {
    const results = await this.query(table, conditions);
    return results.length;
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Clear all data
   */
  async clear() {
    this._checkInitialized();

    const tables = Array.from(this.db.objectStoreNames);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(tables, 'readwrite');

      tables.forEach(table => {
        transaction.objectStore(table).clear();
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Clear failed'));
    });
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
