/**
 * WeChat Mini Program Storage - wx.setStorage/wx.getStorage implementation
 * Uses WeChat's storage APIs with chunking for large data
 */

import { StorageInterface } from './storage-interface.js';
import CryptoJS from 'crypto-js';

export class MPWeixinStorage extends StorageInterface {
  constructor() {
    super();
    this.storagePrefix = 'cc_'; // ChainlessChain prefix
    this.maxChunkSize = 1024 * 1024; // 1MB per chunk (WeChat limit is 10MB per key)
  }

  /**
   * Initialize storage and set up encryption
   */
  async init(pin) {
    if (this.isInitialized) {
      return;
    }

    // Derive encryption key from PIN
    const salt = wx.getStorageSync('db_salt') || this._generateSalt();
    if (!wx.getStorageSync('db_salt')) {
      wx.setStorageSync('db_salt', salt);
    }

    this.encryptionKey = CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA256
    }).toString();

    // Initialize table indexes
    await this._initializeTables();
    this.isInitialized = true;
  }

  /**
   * Initialize table indexes in storage
   */
  async _initializeTables() {
    const tables = [
      'notes', 'chat_conversations', 'chat_messages', 'did_identities',
      'p2p_messages', 'contacts', 'social_posts', 'social_comments',
      'projects', 'project_files', 'project_tasks', 'trade_assets',
      'trade_orders', 'settings'
    ];

    tables.forEach(table => {
      const indexKey = `${this.storagePrefix}index_${table}`;
      if (!wx.getStorageSync(indexKey)) {
        wx.setStorageSync(indexKey, []);
      }
    });
  }

  /**
   * Query records from a table
   */
  async query(table, conditions = {}, options = {}) {
    this._checkInitialized();

    // Get all record IDs from index
    const indexKey = `${this.storagePrefix}index_${table}`;
    const ids = wx.getStorageSync(indexKey) || [];

    // Load all records
    let results = [];
    for (const id of ids) {
      const record = await this.getById(table, id);
      if (record) {
        results.push(record);
      }
    }

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

    return results;
  }

  /**
   * Get a single record by ID
   */
  async getById(table, id) {
    this._checkInitialized();

    const key = `${this.storagePrefix}${table}_${id}`;
    const encryptedData = wx.getStorageSync(key);

    if (!encryptedData) {
      return null;
    }

    // Handle chunked data
    if (encryptedData._chunked) {
      return this._getChunkedData(key);
    }

    return this._decrypt(encryptedData);
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

    // Store data (with chunking if needed)
    const key = `${this.storagePrefix}${table}_${data.id}`;
    const dataStr = JSON.stringify(encryptedData);

    if (dataStr.length > this.maxChunkSize) {
      await this._setChunkedData(key, dataStr);
    } else {
      wx.setStorageSync(key, encryptedData);
    }

    // Update index
    const indexKey = `${this.storagePrefix}index_${table}`;
    const ids = wx.getStorageSync(indexKey) || [];
    if (!ids.includes(data.id)) {
      ids.push(data.id);
      wx.setStorageSync(indexKey, ids);
    }

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
    const encryptedData = this._encrypt(updated);

    // Store data (with chunking if needed)
    const key = `${this.storagePrefix}${table}_${id}`;
    const dataStr = JSON.stringify(encryptedData);

    if (dataStr.length > this.maxChunkSize) {
      await this._setChunkedData(key, dataStr);
    } else {
      wx.setStorageSync(key, encryptedData);
    }

    return true;
  }

  /**
   * Delete a record
   */
  async delete(table, id) {
    this._checkInitialized();

    const key = `${this.storagePrefix}${table}_${id}`;

    // Check if data is chunked
    const data = wx.getStorageSync(key);
    if (data && data._chunked) {
      // Delete all chunks
      for (let i = 0; i < data._chunkCount; i++) {
        wx.removeStorageSync(`${key}_chunk_${i}`);
      }
    }

    // Delete main key
    wx.removeStorageSync(key);

    // Update index
    const indexKey = `${this.storagePrefix}index_${table}`;
    const ids = wx.getStorageSync(indexKey) || [];
    const newIds = ids.filter(existingId => existingId !== id);
    wx.setStorageSync(indexKey, newIds);

    return true;
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
   * Close the storage connection
   */
  async close() {
    this.isInitialized = false;
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

    tables.forEach(table => {
      const indexKey = `${this.storagePrefix}index_${table}`;
      const ids = wx.getStorageSync(indexKey) || [];

      // Delete all records
      ids.forEach(id => {
        const key = `${this.storagePrefix}${table}_${id}`;
        const data = wx.getStorageSync(key);

        // Delete chunks if exists
        if (data && data._chunked) {
          for (let i = 0; i < data._chunkCount; i++) {
            wx.removeStorageSync(`${key}_chunk_${i}`);
          }
        }

        wx.removeStorageSync(key);
      });

      // Clear index
      wx.setStorageSync(indexKey, []);
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

  /**
   * Store large data in chunks
   */
  async _setChunkedData(key, dataStr) {
    const chunks = [];
    for (let i = 0; i < dataStr.length; i += this.maxChunkSize) {
      chunks.push(dataStr.slice(i, i + this.maxChunkSize));
    }

    // Store chunks
    chunks.forEach((chunk, index) => {
      wx.setStorageSync(`${key}_chunk_${index}`, chunk);
    });

    // Store metadata
    wx.setStorageSync(key, {
      _chunked: true,
      _chunkCount: chunks.length
    });
  }

  /**
   * Retrieve chunked data
   */
  _getChunkedData(key) {
    const metadata = wx.getStorageSync(key);
    if (!metadata._chunked) {
      return null;
    }

    // Retrieve all chunks
    let dataStr = '';
    for (let i = 0; i < metadata._chunkCount; i++) {
      const chunk = wx.getStorageSync(`${key}_chunk_${i}`);
      dataStr += chunk;
    }

    const encryptedData = JSON.parse(dataStr);
    return this._decrypt(encryptedData);
  }
}
