'use strict';

/**
 * Adapter Registry - LoRA adapter tracking and management
 *
 * Provides CRUD operations for LoRA adapter metadata stored in the
 * local SQLite database.  Each adapter record tracks the filesystem
 * path, base model, size, and optional link back to the training job
 * that produced it.
 *
 * @module fine-tuning/adapter-registry
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

class AdapterRegistry {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database manager instance
   */
  constructor({ database } = {}) {
    this.database = database || null;
  }

  /**
   * Get the raw database handle, unwrapping the manager wrapper if needed.
   * @private
   * @returns {Object|null}
   */
  _db() {
    if (!this.database) {return null;}
    return this.database.db || this.database;
  }

  /**
   * Register a new LoRA adapter in the database.
   *
   * @param {Object} adapterInfo
   * @param {string} adapterInfo.name - Unique human-readable name
   * @param {string} adapterInfo.baseModel - The base model this adapter targets
   * @param {string} adapterInfo.adapterPath - Filesystem path to the adapter files
   * @param {number} [adapterInfo.sizeBytes=0] - Size on disk in bytes
   * @param {string} [adapterInfo.trainingJobId] - ID of the originating training job
   * @param {string} [adapterInfo.description] - Free-text description
   * @returns {Object} The created adapter record
   */
  register(adapterInfo) {
    const db = this._db();
    if (!db) {
      throw new Error('Database not available');
    }

    const id = uuidv4();
    const now = Date.now();

    const {
      name,
      baseModel,
      adapterPath,
      sizeBytes = 0,
      trainingJobId = null,
      description = null,
    } = adapterInfo;

    if (!name || !baseModel || !adapterPath) {
      throw new Error('name, baseModel, and adapterPath are required');
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO lora_adapters (id, name, base_model, adapter_path, size_bytes, training_job_id, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, name, baseModel, adapterPath, sizeBytes, trainingJobId, description, now);

      logger.info(`[AdapterRegistry] Registered adapter "${name}" (${id})`);

      return {
        id,
        name,
        baseModel,
        adapterPath,
        sizeBytes,
        trainingJobId,
        description,
        createdAt: now,
      };
    } catch (error) {
      logger.error('[AdapterRegistry] Failed to register adapter:', error.message);
      throw error;
    }
  }

  /**
   * Remove an adapter record from the database.
   *
   * @param {string} adapterId - Adapter ID to remove
   * @returns {boolean} True if a record was deleted
   */
  unregister(adapterId) {
    const db = this._db();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      const stmt = db.prepare('DELETE FROM lora_adapters WHERE id = ?');
      const result = stmt.run(adapterId);
      const deleted = (result && result.changes > 0) || false;

      if (deleted) {
        logger.info(`[AdapterRegistry] Unregistered adapter ${adapterId}`);
      } else {
        logger.warn(`[AdapterRegistry] Adapter ${adapterId} not found for unregister`);
      }

      return deleted;
    } catch (error) {
      logger.error('[AdapterRegistry] Failed to unregister adapter:', error.message);
      throw error;
    }
  }

  /**
   * Get adapter details by ID.
   *
   * @param {string} adapterId
   * @returns {Object|null} Adapter record or null if not found
   */
  getAdapter(adapterId) {
    const db = this._db();
    if (!db) {return null;}

    try {
      const stmt = db.prepare('SELECT * FROM lora_adapters WHERE id = ?');
      const row = stmt.get(adapterId);

      if (!row) {return null;}

      return {
        id: row.id,
        name: row.name,
        baseModel: row.base_model,
        adapterPath: row.adapter_path,
        sizeBytes: row.size_bytes,
        trainingJobId: row.training_job_id,
        description: row.description,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error('[AdapterRegistry] Failed to get adapter:', error.message);
      return null;
    }
  }

  /**
   * List adapters with optional filtering and pagination.
   *
   * @param {Object} [options={}]
   * @param {string} [options.baseModel] - Filter by base model name
   * @param {number} [options.limit=50] - Maximum records to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Array<Object>} Array of adapter records
   */
  listAdapters(options = {}) {
    const db = this._db();
    if (!db) {return [];}

    const { baseModel, limit = 50, offset = 0 } = options;

    try {
      let query = 'SELECT * FROM lora_adapters';
      const params = [];

      if (baseModel) {
        query += ' WHERE base_model = ?';
        params.push(baseModel);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        baseModel: row.base_model,
        adapterPath: row.adapter_path,
        sizeBytes: row.size_bytes,
        trainingJobId: row.training_job_id,
        description: row.description,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error('[AdapterRegistry] Failed to list adapters:', error.message);
      return [];
    }
  }

  /**
   * Update adapter metadata.
   *
   * @param {string} adapterId - Adapter ID
   * @param {Object} updates - Fields to update (name, description, sizeBytes)
   * @returns {boolean} True if a record was updated
   */
  updateAdapter(adapterId, updates = {}) {
    const db = this._db();
    if (!db) {
      throw new Error('Database not available');
    }

    const allowed = ['name', 'description', 'size_bytes'];
    const fieldMap = {
      name: 'name',
      description: 'description',
      sizeBytes: 'size_bytes',
    };

    const setClauses = [];
    const params = [];

    for (const [key, column] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        if (!allowed.includes(column)) {continue;}
        setClauses.push(`${column} = ?`);
        params.push(updates[key]);
      }
    }

    if (setClauses.length === 0) {
      logger.warn('[AdapterRegistry] No valid fields to update');
      return false;
    }

    params.push(adapterId);

    try {
      const stmt = db.prepare(
        `UPDATE lora_adapters SET ${setClauses.join(', ')} WHERE id = ?`
      );
      const result = stmt.run(...params);
      const updated = (result && result.changes > 0) || false;

      if (updated) {
        logger.info(`[AdapterRegistry] Updated adapter ${adapterId}`);
      }

      return updated;
    } catch (error) {
      logger.error('[AdapterRegistry] Failed to update adapter:', error.message);
      throw error;
    }
  }

  /**
   * Get the filesystem path for an adapter.
   *
   * @param {string} adapterId
   * @returns {string|null} Adapter file path or null
   */
  getAdapterPath(adapterId) {
    const adapter = this.getAdapter(adapterId);
    return adapter ? adapter.adapterPath : null;
  }
}

module.exports = { AdapterRegistry };
