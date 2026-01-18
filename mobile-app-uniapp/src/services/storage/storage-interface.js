/**
 * Storage Interface - Base class for platform-specific storage implementations
 * Provides a unified API for database operations across H5, WeChat Mini Program, and App Plus
 */

export class StorageInterface {
  constructor() {
    this.isInitialized = false;
    this.encryptionKey = null;
  }

  /**
   * Initialize storage with encryption key derived from PIN
   * @param {string} pin - User's PIN code
   * @returns {Promise<void>}
   */
  async init(pin) {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Query records from a table
   * @param {string} table - Table name
   * @param {Object} conditions - Query conditions (e.g., { id: 1, status: 'active' })
   * @param {Object} options - Query options (e.g., { limit: 10, offset: 0, orderBy: 'created_at DESC' })
   * @returns {Promise<Array>}
   */
  async query(table, conditions = {}, options = {}) {
    throw new Error('query() must be implemented by subclass');
  }

  /**
   * Get a single record by ID
   * @param {string} table - Table name
   * @param {string|number} id - Record ID
   * @returns {Promise<Object|null>}
   */
  async getById(table, id) {
    throw new Error('getById() must be implemented by subclass');
  }

  /**
   * Insert a new record
   * @param {string} table - Table name
   * @param {Object} data - Record data
   * @returns {Promise<string|number>} - Inserted record ID
   */
  async insert(table, data) {
    throw new Error('insert() must be implemented by subclass');
  }

  /**
   * Update an existing record
   * @param {string} table - Table name
   * @param {string|number} id - Record ID
   * @param {Object} data - Updated data
   * @returns {Promise<boolean>} - Success status
   */
  async update(table, id, data) {
    throw new Error('update() must be implemented by subclass');
  }

  /**
   * Delete a record
   * @param {string} table - Table name
   * @param {string|number} id - Record ID
   * @returns {Promise<boolean>} - Success status
   */
  async delete(table, id) {
    throw new Error('delete() must be implemented by subclass');
  }

  /**
   * Execute a batch of operations in a transaction
   * @param {Function} operations - Async function containing operations
   * @returns {Promise<any>} - Transaction result
   */
  async transaction(operations) {
    throw new Error('transaction() must be implemented by subclass');
  }

  /**
   * Count records in a table
   * @param {string} table - Table name
   * @param {Object} conditions - Query conditions
   * @returns {Promise<number>}
   */
  async count(table, conditions = {}) {
    throw new Error('count() must be implemented by subclass');
  }

  /**
   * Close the storage connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('close() must be implemented by subclass');
  }

  /**
   * Clear all data (for testing/reset)
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('clear() must be implemented by subclass');
  }
}
