/**
 * DLP Policy Manager
 *
 * Manages Data Loss Prevention policies:
 * - CRUD operations for DLP policies
 * - Pattern validation (regex)
 * - Channel-based policy filtering
 * - In-memory cache with DB persistence
 *
 * @module audit/dlp-policy
 * @version 1.1.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// DLPPolicyManager
// ============================================================

class DLPPolicyManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._policies = new Map();
  }

  async initialize() {
    logger.info("[DLPPolicyManager] Initializing DLP policy manager...");
    this._ensureTables();
    await this._loadPolicies();
    this.initialized = true;
    logger.info(`[DLPPolicyManager] DLP policy manager initialized (${this._policies.size} policies loaded)`);
  }

  _ensureTables() {
    if (!this.database || !this.database.db) { return; }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS dlp_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        channels TEXT,
        patterns TEXT NOT NULL,
        keywords TEXT,
        action TEXT DEFAULT 'alert',
        severity TEXT DEFAULT 'medium',
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dlp_policies_enabled ON dlp_policies(enabled);
    `);
  }

  /**
   * Load all policies from DB into in-memory Map.
   */
  async _loadPolicies() {
    if (!this.database || !this.database.db) { return; }

    try {
      const rows = this.database.db.prepare("SELECT * FROM dlp_policies").all();
      for (const row of rows) {
        this._policies.set(row.id, row);
      }
    } catch (err) {
      logger.error("[DLPPolicyManager] Failed to load policies:", err);
    }
  }

  /**
   * Create a new DLP policy.
   * @param {object} params
   * @param {string} params.name - Policy name
   * @param {string} [params.description] - Policy description
   * @param {string[]} [params.channels] - Applicable channels
   * @param {string[]} params.patterns - Regex patterns to match
   * @param {string[]} [params.keywords] - Keywords to match
   * @param {string} [params.action='alert'] - Action on match (allow/alert/block/quarantine)
   * @param {string} [params.severity='medium'] - Severity level
   * @returns {Promise<object>} The created policy
   */
  async createPolicy({ name, description, channels, patterns, keywords, action = "alert", severity = "medium" }) {
    if (!name || !name.trim()) {
      throw new Error("Policy name is required");
    }
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
      throw new Error("At least one pattern is required");
    }

    this._validatePatterns(patterns);

    const policy = {
      id: uuidv4(),
      name: name.trim(),
      description: description || null,
      enabled: 1,
      channels: JSON.stringify(channels || []),
      patterns: JSON.stringify(patterns),
      keywords: JSON.stringify(keywords || []),
      action,
      severity,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    if (this.database && this.database.db) {
      this.database.db.prepare(`
        INSERT INTO dlp_policies (id, name, description, enabled, channels, patterns, keywords, action, severity, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        policy.id, policy.name, policy.description, policy.enabled,
        policy.channels, policy.patterns, policy.keywords,
        policy.action, policy.severity, policy.created_at, policy.updated_at
      );
    }

    this._policies.set(policy.id, policy);
    this.emit("policy-created", policy);
    logger.info(`[DLPPolicyManager] Policy created: ${policy.id} (${policy.name})`);
    return policy;
  }

  /**
   * Update specific fields of an existing policy.
   * @param {string} id - Policy ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} The updated policy
   */
  async updatePolicy(id, updates) {
    const existing = this._policies.get(id);
    if (!existing) {
      throw new Error(`Policy not found: ${id}`);
    }

    // Validate patterns if being updated
    if (updates.patterns) {
      if (!Array.isArray(updates.patterns)) {
        throw new Error("Patterns must be an array");
      }
      this._validatePatterns(updates.patterns);
      updates.patterns = JSON.stringify(updates.patterns);
    }
    if (updates.channels && Array.isArray(updates.channels)) {
      updates.channels = JSON.stringify(updates.channels);
    }
    if (updates.keywords && Array.isArray(updates.keywords)) {
      updates.keywords = JSON.stringify(updates.keywords);
    }

    const allowedFields = ["name", "description", "enabled", "channels", "patterns", "keywords", "action", "severity"];
    const setClauses = [];
    const values = [];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    if (setClauses.length === 0) {
      return existing;
    }

    setClauses.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    if (this.database && this.database.db) {
      this.database.db.prepare(
        `UPDATE dlp_policies SET ${setClauses.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    // Reload the policy from DB or merge locally
    const updated = { ...existing, ...updates, updated_at: Date.now() };
    this._policies.set(id, updated);

    this.emit("policy-updated", updated);
    logger.info(`[DLPPolicyManager] Policy updated: ${id}`);
    return updated;
  }

  /**
   * Delete a policy by ID.
   */
  async deletePolicy(id) {
    if (!this._policies.has(id)) {
      throw new Error(`Policy not found: ${id}`);
    }

    if (this.database && this.database.db) {
      this.database.db.prepare("DELETE FROM dlp_policies WHERE id = ?").run(id);
    }

    this._policies.delete(id);
    this.emit("policy-deleted", { id });
    logger.info(`[DLPPolicyManager] Policy deleted: ${id}`);
    return { success: true };
  }

  /**
   * Get a single policy by ID.
   */
  async getPolicy(id) {
    const cached = this._policies.get(id);
    if (cached) { return cached; }

    if (this.database && this.database.db) {
      const row = this.database.db.prepare("SELECT * FROM dlp_policies WHERE id = ?").get(id);
      if (row) {
        this._policies.set(row.id, row);
        return row;
      }
    }

    return null;
  }

  /**
   * List all policies, optionally filtered by enabled status.
   * @param {object} [options]
   * @param {boolean} [options.enabled] - Filter by enabled status
   * @returns {Promise<Array>}
   */
  async listPolicies({ enabled } = {}) {
    const all = Array.from(this._policies.values());
    if (enabled !== undefined) {
      const enabledInt = enabled ? 1 : 0;
      return all.filter((p) => p.enabled === enabledInt);
    }
    return all;
  }

  /**
   * Get all enabled policies that apply to a specific channel.
   * @param {string} channel
   * @returns {Promise<Array>}
   */
  async getActivePoliciesForChannel(channel) {
    const all = Array.from(this._policies.values());
    return all.filter((p) => {
      if (p.enabled !== 1) { return false; }
      const channels = typeof p.channels === "string" ? JSON.parse(p.channels) : (p.channels || []);
      // If no channels specified, policy applies to all channels
      return channels.length === 0 || channels.includes(channel);
    });
  }

  /**
   * Validate that each pattern string is a valid regex.
   * @param {string[]} patterns
   */
  _validatePatterns(patterns) {
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch (_err) {
        throw new Error(`Invalid regex pattern: ${pattern}`);
      }
    }
  }

  async close() {
    this._policies.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[DLPPolicyManager] Closed");
  }
}

let _instance;
function getDLPPolicyManager() {
  if (!_instance) { _instance = new DLPPolicyManager(); }
  return _instance;
}

module.exports = { DLPPolicyManager, getDLPPolicyManager };
