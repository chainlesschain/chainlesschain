/**
 * Database Diff Tracker
 * SQLite trigger-based row-level change tracking
 * G-Counter and OR-Set CRDT implementations
 * Changelog compaction
 *
 * @module git/diff-sync/db-diff-tracker
 * @version 1.1.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * G-Counter (Grow-only Counter) CRDT
 * Supports increment only, merge via max per node
 */
class GCounter {
  /**
   * @param {string} nodeId - Local node identifier
   * @param {Object} [state] - Initial counter state { nodeId: value }
   */
  constructor(nodeId, state = {}) {
    this.nodeId = nodeId;
    this.state = { ...state };
    if (!(nodeId in this.state)) {
      this.state[nodeId] = 0;
    }
  }

  /**
   * Increment the counter
   * @param {number} [amount=1]
   */
  increment(amount = 1) {
    this.state[this.nodeId] = (this.state[this.nodeId] || 0) + amount;
    return this;
  }

  /**
   * Get total counter value
   * @returns {number}
   */
  value() {
    return Object.values(this.state).reduce((sum, v) => sum + v, 0);
  }

  /**
   * Merge with another G-Counter (take max per node)
   * @param {GCounter} other
   */
  merge(other) {
    const allNodes = new Set([
      ...Object.keys(this.state),
      ...Object.keys(other.state),
    ]);
    for (const node of allNodes) {
      this.state[node] = Math.max(
        this.state[node] || 0,
        other.state[node] || 0,
      );
    }
    return this;
  }

  toJSON() {
    return { ...this.state };
  }

  static fromJSON(nodeId, json) {
    return new GCounter(nodeId, json || {});
  }
}

/**
 * PN-Counter (Positive-Negative Counter) CRDT
 * Supports increment and decrement
 */
class PNCounter {
  constructor(nodeId, positive = {}, negative = {}) {
    this.positive = new GCounter(nodeId, positive);
    this.negative = new GCounter(nodeId, negative);
  }

  increment(amount = 1) {
    this.positive.increment(amount);
    return this;
  }

  decrement(amount = 1) {
    this.negative.increment(amount);
    return this;
  }

  value() {
    return this.positive.value() - this.negative.value();
  }

  merge(other) {
    this.positive.merge(other.positive);
    this.negative.merge(other.negative);
    return this;
  }

  toJSON() {
    return { p: this.positive.toJSON(), n: this.negative.toJSON() };
  }

  static fromJSON(nodeId, json) {
    return new PNCounter(nodeId, json?.p || {}, json?.n || {});
  }
}

/**
 * OR-Set (Observed-Remove Set) CRDT
 * Supports add and remove with unique tags
 */
class ORSet {
  /**
   * @param {string} nodeId
   * @param {Map} [elements] - Map<element, Set<tag>>
   * @param {Set} [tombstones] - Set<tag>
   */
  constructor(nodeId, elements = new Map(), tombstones = new Set()) {
    this.nodeId = nodeId;
    this.elements = elements;
    this.tombstones = tombstones;
    this._tagCounter = 0;
  }

  /**
   * Add an element to the set
   * @param {string} element
   */
  add(element) {
    const tag = `${this.nodeId}:${++this._tagCounter}:${Date.now()}`;
    if (!this.elements.has(element)) {
      this.elements.set(element, new Set());
    }
    this.elements.get(element).add(tag);
    return this;
  }

  /**
   * Remove an element from the set
   * @param {string} element
   */
  remove(element) {
    const tags = this.elements.get(element);
    if (tags) {
      for (const tag of tags) {
        this.tombstones.add(tag);
      }
      this.elements.delete(element);
    }
    return this;
  }

  /**
   * Check if an element is in the set
   * @param {string} element
   * @returns {boolean}
   */
  has(element) {
    const tags = this.elements.get(element);
    if (!tags) {
      return false;
    }

    // Element is present if it has at least one non-tombstoned tag
    for (const tag of tags) {
      if (!this.tombstones.has(tag)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all elements in the set
   * @returns {string[]}
   */
  values() {
    const result = [];
    for (const [element, tags] of this.elements) {
      for (const tag of tags) {
        if (!this.tombstones.has(tag)) {
          result.push(element);
          break;
        }
      }
    }
    return result;
  }

  /**
   * Merge with another OR-Set
   * @param {ORSet} other
   */
  merge(other) {
    // Merge elements
    for (const [element, otherTags] of other.elements) {
      if (!this.elements.has(element)) {
        this.elements.set(element, new Set());
      }
      const localTags = this.elements.get(element);
      for (const tag of otherTags) {
        localTags.add(tag);
      }
    }

    // Merge tombstones
    for (const tag of other.tombstones) {
      this.tombstones.add(tag);
    }

    // Clean up tombstoned elements
    for (const [element, tags] of this.elements) {
      for (const tag of tags) {
        if (this.tombstones.has(tag)) {
          tags.delete(tag);
        }
      }
      if (tags.size === 0) {
        this.elements.delete(element);
      }
    }

    return this;
  }

  toJSON() {
    const elements = {};
    for (const [element, tags] of this.elements) {
      elements[element] = Array.from(tags);
    }
    return {
      elements,
      tombstones: Array.from(this.tombstones),
    };
  }

  static fromJSON(nodeId, json) {
    const elements = new Map();
    if (json?.elements) {
      for (const [element, tags] of Object.entries(json.elements)) {
        elements.set(element, new Set(tags));
      }
    }
    const tombstones = new Set(json?.tombstones || []);
    return new ORSet(nodeId, elements, tombstones);
  }
}

/**
 * Database Diff Tracker
 * Tracks row-level changes using SQLite triggers
 */
class DbDiffTracker extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - DatabaseManager instance
   * @param {string} options.nodeId - Local node identifier
   * @param {string[]} [options.trackedTables] - Tables to track
   */
  constructor(options = {}) {
    super();
    this.db = options.database || null;
    this.nodeId = options.nodeId || `node-${uuidv4().slice(0, 8)}`;
    this.trackedTables = options.trackedTables || [];

    // CRDT instances
    this._counters = new Map(); // fieldName -> GCounter/PNCounter
    this._sets = new Map(); // setName -> ORSet

    // Change version counter
    this._version = 0;

    // Stats
    this._stats = {
      changesTracked: 0,
      changesCompacted: 0,
      triggersInstalled: 0,
    };
  }

  /**
   * Initialize change tracking
   * Install SQLite triggers for tracked tables
   */
  async initialize() {
    if (!this.db) {
      logger.warn("[DbDiffTracker] No database, running in memory-only mode");
      return;
    }

    logger.info(
      `[DbDiffTracker] Initializing for ${this.trackedTables.length} tables`,
    );

    for (const table of this.trackedTables) {
      await this._installTriggers(table);
    }

    // Load existing CRDT state from database
    await this._loadCRDTState();

    logger.info(
      `[DbDiffTracker] Initialized (${this._stats.triggersInstalled} triggers installed)`,
    );
  }

  /**
   * Install INSERT/UPDATE/DELETE triggers for a table
   * @param {string} tableName
   */
  async _installTriggers(tableName) {
    if (!this.db) {
      return;
    }

    try {
      // Get table columns
      const columns = this._getTableColumns(tableName);
      if (columns.length === 0) {
        logger.warn(
          `[DbDiffTracker] Table ${tableName} not found or has no columns`,
        );
        return;
      }

      const primaryKey = columns.find((c) => c.pk > 0)?.name || "id";

      // INSERT trigger
      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS track_${tableName}_insert
        AFTER INSERT ON ${tableName}
        BEGIN
          INSERT INTO db_change_log (table_name, row_id, operation, new_values, version)
          VALUES ('${tableName}', NEW.${primaryKey}, 'INSERT', json_object(${columns
            .map((c) => `'${c.name}', NEW.${c.name}`)
            .join(
              ", ",
            )}), (SELECT COALESCE(MAX(version), 0) + 1 FROM db_change_log));
        END;
      `);

      // UPDATE trigger
      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS track_${tableName}_update
        AFTER UPDATE ON ${tableName}
        BEGIN
          INSERT INTO db_change_log (table_name, row_id, operation, old_values, new_values, version)
          VALUES ('${tableName}', NEW.${primaryKey}, 'UPDATE',
            json_object(${columns.map((c) => `'${c.name}', OLD.${c.name}`).join(", ")}),
            json_object(${columns.map((c) => `'${c.name}', NEW.${c.name}`).join(", ")}),
            (SELECT COALESCE(MAX(version), 0) + 1 FROM db_change_log));
        END;
      `);

      // DELETE trigger
      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS track_${tableName}_delete
        AFTER DELETE ON ${tableName}
        BEGIN
          INSERT INTO db_change_log (table_name, row_id, operation, old_values, version)
          VALUES ('${tableName}', OLD.${primaryKey}, 'DELETE',
            json_object(${columns.map((c) => `'${c.name}', OLD.${c.name}`).join(", ")}),
            (SELECT COALESCE(MAX(version), 0) + 1 FROM db_change_log));
        END;
      `);

      this._stats.triggersInstalled += 3;
      logger.info(`[DbDiffTracker] Triggers installed for table: ${tableName}`);
    } catch (error) {
      logger.error(
        `[DbDiffTracker] Failed to install triggers for ${tableName}:`,
        error.message,
      );
    }
  }

  /**
   * Get table column info
   * @param {string} tableName
   * @returns {Array<{name: string, type: string, pk: number}>}
   */
  _getTableColumns(tableName) {
    if (!this.db) {
      return [];
    }
    try {
      return this.db.all(`PRAGMA table_info(${tableName})`);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get changes since a specific version
   * @param {number} sinceVersion
   * @param {Object} [options]
   * @param {string} [options.tableName] - Filter by table
   * @param {number} [options.limit=1000]
   * @returns {Array}
   */
  getChangesSince(sinceVersion, options = {}) {
    if (!this.db) {
      return [];
    }

    try {
      let sql = `SELECT * FROM db_change_log WHERE version > ? AND compacted = 0`;
      const params = [sinceVersion];

      if (options.tableName) {
        sql += ` AND table_name = ?`;
        params.push(options.tableName);
      }

      sql += ` ORDER BY version ASC LIMIT ?`;
      params.push(options.limit || 1000);

      return this.db.all(sql, params);
    } catch (error) {
      logger.error("[DbDiffTracker] getChangesSince error:", error.message);
      return [];
    }
  }

  /**
   * Get latest version number
   * @returns {number}
   */
  getLatestVersion() {
    if (!this.db) {
      return this._version;
    }

    try {
      const result = this.db.get(
        `SELECT MAX(version) as maxVersion FROM db_change_log`,
      );
      return result?.maxVersion || 0;
    } catch (error) {
      return this._version;
    }
  }

  /**
   * Compact changelog: merge multiple changes to the same row into final state
   */
  async compactChangelog() {
    if (!this.db) {
      return { compacted: 0 };
    }

    try {
      // Find rows with multiple uncompacted changes
      const duplicates = this.db.all(`
        SELECT table_name, row_id, COUNT(*) as change_count, MAX(version) as latest_version
        FROM db_change_log
        WHERE compacted = 0
        GROUP BY table_name, row_id
        HAVING change_count > 1
      `);

      let compactedCount = 0;

      for (const dup of duplicates) {
        // Get all changes for this row
        const changes = this.db.all(
          `SELECT * FROM db_change_log
           WHERE table_name = ? AND row_id = ? AND compacted = 0
           ORDER BY version ASC`,
          [dup.table_name, dup.row_id],
        );

        if (changes.length <= 1) {
          continue;
        }

        const firstChange = changes[0];
        const lastChange = changes[changes.length - 1];

        // Determine final operation
        let finalOp = lastChange.operation;
        if (
          firstChange.operation === "INSERT" &&
          lastChange.operation === "DELETE"
        ) {
          // Insert then delete = no change needed
          finalOp = "NOOP";
        } else if (firstChange.operation === "INSERT") {
          finalOp = "INSERT";
        }

        // Mark older changes as compacted
        const olderIds = changes.slice(0, -1).map((c) => c.id);
        if (olderIds.length > 0) {
          this.db.run(
            `UPDATE db_change_log SET compacted = 1 WHERE id IN (${olderIds.map(() => "?").join(",")})`,
            olderIds,
          );
          compactedCount += olderIds.length;
        }

        // Update the latest change with the final state
        if (finalOp === "NOOP") {
          this.db.run(
            `UPDATE db_change_log SET compacted = 1 WHERE table_name = ? AND row_id = ?`,
            [dup.table_name, dup.row_id],
          );
          compactedCount++;
        } else {
          this.db.run(
            `UPDATE db_change_log SET operation = ?, old_values = ? WHERE id = ?`,
            [finalOp, firstChange.old_values || "{}", lastChange.id],
          );
        }
      }

      this._stats.changesCompacted += compactedCount;
      logger.info(
        `[DbDiffTracker] Compacted ${compactedCount} changelog entries`,
      );
      return { compacted: compactedCount };
    } catch (error) {
      logger.error("[DbDiffTracker] Compaction error:", error.message);
      return { compacted: 0, error: error.message };
    }
  }

  // ==========================================
  // CRDT Operations
  // ==========================================

  /**
   * Get or create a G-Counter for a field
   * @param {string} fieldName
   * @returns {GCounter}
   */
  getCounter(fieldName) {
    if (!this._counters.has(fieldName)) {
      this._counters.set(fieldName, new GCounter(this.nodeId));
    }
    return this._counters.get(fieldName);
  }

  /**
   * Get or create a PN-Counter for a field
   * @param {string} fieldName
   * @returns {PNCounter}
   */
  getPNCounter(fieldName) {
    if (!this._counters.has(fieldName)) {
      this._counters.set(fieldName, new PNCounter(this.nodeId));
    }
    return this._counters.get(fieldName);
  }

  /**
   * Get or create an OR-Set
   * @param {string} setName
   * @returns {ORSet}
   */
  getSet(setName) {
    if (!this._sets.has(setName)) {
      this._sets.set(setName, new ORSet(this.nodeId));
    }
    return this._sets.get(setName);
  }

  /**
   * Merge remote CRDT state
   * @param {Object} remoteState - { counters: {...}, sets: {...} }
   */
  mergeRemoteState(remoteState) {
    // Merge counters
    if (remoteState.counters) {
      for (const [field, state] of Object.entries(remoteState.counters)) {
        const local = this.getCounter(field);
        const remote = GCounter.fromJSON(this.nodeId, state);
        local.merge(remote);
      }
    }

    // Merge sets
    if (remoteState.sets) {
      for (const [name, state] of Object.entries(remoteState.sets)) {
        const local = this.getSet(name);
        const remote = ORSet.fromJSON(this.nodeId, state);
        local.merge(remote);
      }
    }

    // Persist merged state
    this._saveCRDTState();
  }

  /**
   * Get all CRDT state for sync
   * @returns {Object}
   */
  getCRDTState() {
    const counters = {};
    for (const [field, counter] of this._counters) {
      counters[field] = counter.toJSON();
    }

    const sets = {};
    for (const [name, set] of this._sets) {
      sets[name] = set.toJSON();
    }

    return { counters, sets };
  }

  /**
   * Load CRDT state from database
   */
  async _loadCRDTState() {
    if (!this.db) {
      return;
    }

    try {
      // Load counters
      const counterRows = this.db.all(`SELECT * FROM crdt_counters`);
      for (const row of counterRows) {
        const counter = this.getCounter(row.field_name);
        counter.state[row.node_id] = row.value;
      }

      // Load sets
      const setRows = this.db.all(`SELECT * FROM crdt_sets WHERE removed = 0`);
      for (const row of setRows) {
        const set = this.getSet(row.set_name);
        set.add(row.element);
      }
    } catch (error) {
      logger.warn("[DbDiffTracker] Failed to load CRDT state:", error.message);
    }
  }

  /**
   * Save CRDT state to database
   */
  _saveCRDTState() {
    if (!this.db) {
      return;
    }

    try {
      // Save counters
      for (const [field, counter] of this._counters) {
        for (const [nodeId, value] of Object.entries(
          counter.state || counter.toJSON(),
        )) {
          this.db.run(
            `INSERT OR REPLACE INTO crdt_counters (id, field_name, node_id, value, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [`${field}:${nodeId}`, field, nodeId, value],
          );
        }
      }

      // Save sets
      for (const [name, set] of this._sets) {
        const elements = set.values();
        for (const element of elements) {
          this.db.run(
            `INSERT OR REPLACE INTO crdt_sets (id, set_name, element, added_by, removed, updated_at)
             VALUES (?, ?, ?, ?, 0, datetime('now'))`,
            [`${name}:${element}`, name, element, this.nodeId],
          );
        }
      }
    } catch (error) {
      logger.warn("[DbDiffTracker] Failed to save CRDT state:", error.message);
    }
  }

  /**
   * Get tracker statistics
   */
  getStats() {
    return {
      ...this._stats,
      latestVersion: this.getLatestVersion(),
      counterCount: this._counters.size,
      setCount: this._sets.size,
    };
  }

  /**
   * Destroy tracker
   */
  destroy() {
    this._counters.clear();
    this._sets.clear();
    this.removeAllListeners();
    logger.info("[DbDiffTracker] Destroyed");
  }
}

module.exports = {
  DbDiffTracker,
  GCounter,
  PNCounter,
  ORSet,
};
