/**
 * DLP (Data Loss Prevention) Engine
 *
 * Content scanning engine for data loss prevention:
 * - Regex pattern matching against DLP policies
 * - Keyword-based content detection
 * - Incident creation, tracking, and resolution
 * - Per-channel scanning (email, chat, file transfer, clipboard, export)
 *
 * @module audit/dlp-engine
 * @version 1.1.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const DLP_ACTIONS = {
  ALLOW: "allow",
  ALERT: "alert",
  BLOCK: "block",
  QUARANTINE: "quarantine",
};

const DLP_CHANNELS = {
  EMAIL: "email",
  CHAT: "chat",
  FILE_TRANSFER: "file_transfer",
  CLIPBOARD: "clipboard",
  EXPORT: "export",
};

// ============================================================
// DLPEngine
// ============================================================

class DLPEngine extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._policyManager = null;
    this._scanCache = new Map();
    this._stats = { scanned: 0, blocked: 0, alerted: 0 };
  }

  async initialize() {
    logger.info("[DLPEngine] Initializing DLP engine...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[DLPEngine] DLP engine initialized");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) { return; }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS dlp_incidents (
        id TEXT PRIMARY KEY,
        policy_id TEXT,
        channel TEXT,
        action_taken TEXT,
        content_hash TEXT,
        matched_patterns TEXT,
        severity TEXT,
        user_id TEXT,
        metadata TEXT,
        created_at INTEGER,
        resolved_at INTEGER,
        resolution TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dlp_incidents_policy_id ON dlp_incidents(policy_id);
      CREATE INDEX IF NOT EXISTS idx_dlp_incidents_channel ON dlp_incidents(channel);
      CREATE INDEX IF NOT EXISTS idx_dlp_incidents_severity ON dlp_incidents(severity);
      CREATE INDEX IF NOT EXISTS idx_dlp_incidents_created_at ON dlp_incidents(created_at);
    `);
  }

  setPolicyManager(pm) {
    this._policyManager = pm;
  }

  /**
   * Scan content against all active DLP policies for a given channel.
   * @param {object} params
   * @param {string} params.content - The content to scan
   * @param {string} params.channel - The channel (email, chat, etc.)
   * @param {string} [params.userId] - The user performing the action
   * @param {object} [params.metadata] - Additional metadata
   * @returns {Promise<{allowed: boolean, action: string, matchedPolicies: Array, incidents: Array}>}
   */
  async scanContent({ content, channel, userId, metadata = {} }) {
    if (!content) {
      return { allowed: true, action: DLP_ACTIONS.ALLOW, matchedPolicies: [], incidents: [] };
    }

    this._stats.scanned++;
    const contentHash = this._hashContent(content);

    // Check cache for duplicate scans
    const cacheKey = `${contentHash}:${channel}`;
    if (this._scanCache.has(cacheKey)) {
      return this._scanCache.get(cacheKey);
    }

    const matchedPolicies = [];
    const incidents = [];
    let highestAction = DLP_ACTIONS.ALLOW;
    const actionPriority = [DLP_ACTIONS.ALLOW, DLP_ACTIONS.ALERT, DLP_ACTIONS.BLOCK, DLP_ACTIONS.QUARANTINE];

    // Get active policies for the channel
    let policies = [];
    if (this._policyManager) {
      policies = await this._policyManager.getActivePoliciesForChannel(channel);
    }

    for (const policy of policies) {
      const patterns = typeof policy.patterns === "string" ? JSON.parse(policy.patterns) : policy.patterns;
      const keywords = policy.keywords
        ? (typeof policy.keywords === "string" ? JSON.parse(policy.keywords) : policy.keywords)
        : [];

      const patternMatches = this._matchPatterns(content, patterns);
      const keywordMatches = this._matchKeywords(content, keywords);

      if (patternMatches.length > 0 || keywordMatches.length > 0) {
        const allMatches = [...patternMatches, ...keywordMatches];
        matchedPolicies.push({
          policyId: policy.id,
          policyName: policy.name,
          action: policy.action,
          severity: policy.severity,
          matches: allMatches,
        });

        // Determine highest-priority action
        const policyActionIndex = actionPriority.indexOf(policy.action);
        const currentActionIndex = actionPriority.indexOf(highestAction);
        if (policyActionIndex > currentActionIndex) {
          highestAction = policy.action;
        }

        // Create incident in DB
        const incident = {
          id: uuidv4(),
          policy_id: policy.id,
          channel,
          action_taken: policy.action,
          content_hash: contentHash,
          matched_patterns: JSON.stringify(allMatches),
          severity: policy.severity,
          user_id: userId || null,
          metadata: JSON.stringify(metadata),
          created_at: Date.now(),
          resolved_at: null,
          resolution: null,
        };

        this._saveIncident(incident);
        incidents.push(incident);

        // Update stats
        if (policy.action === DLP_ACTIONS.BLOCK || policy.action === DLP_ACTIONS.QUARANTINE) {
          this._stats.blocked++;
        } else if (policy.action === DLP_ACTIONS.ALERT) {
          this._stats.alerted++;
        }
      }
    }

    const allowed = highestAction === DLP_ACTIONS.ALLOW || highestAction === DLP_ACTIONS.ALERT;
    const result = { allowed, action: highestAction, matchedPolicies, incidents };

    // Cache result (TTL: 5 minutes)
    this._scanCache.set(cacheKey, result);
    setTimeout(() => this._scanCache.delete(cacheKey), 5 * 60 * 1000);

    if (matchedPolicies.length > 0) {
      this.emit("scan-match", { channel, action: highestAction, matchedPolicies, userId });
      logger.info(`[DLPEngine] Scan match on channel=${channel} action=${highestAction} policies=${matchedPolicies.length}`);
    }

    return result;
  }

  /**
   * Query DLP incidents with optional filters.
   */
  async getIncidents({ channel, severity, limit = 50, offset = 0 } = {}) {
    if (!this.database || !this.database.db) {
      return { incidents: [], total: 0 };
    }

    let where = "WHERE 1=1";
    const params = [];

    if (channel) {
      where += " AND channel = ?";
      params.push(channel);
    }
    if (severity) {
      where += " AND severity = ?";
      params.push(severity);
    }

    const countRow = this.database.db.prepare(
      `SELECT COUNT(*) as total FROM dlp_incidents ${where}`
    ).get(...params);

    const incidents = this.database.db.prepare(
      `SELECT * FROM dlp_incidents ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    return { incidents, total: countRow ? countRow.total : 0 };
  }

  /**
   * Resolve an incident with a resolution note.
   */
  async resolveIncident(incidentId, resolution) {
    if (!this.database || !this.database.db) {
      throw new Error("Database not available");
    }

    this.database.db.prepare(
      `UPDATE dlp_incidents SET resolved_at = ?, resolution = ? WHERE id = ?`
    ).run(Date.now(), resolution, incidentId);

    this.emit("incident-resolved", { incidentId, resolution });
    logger.info(`[DLPEngine] Incident ${incidentId} resolved`);
    return { success: true };
  }

  /**
   * Return aggregate scan statistics.
   */
  async getStats() {
    let dbStats = { total: 0, unresolved: 0 };
    if (this.database && this.database.db) {
      const totalRow = this.database.db.prepare(
        "SELECT COUNT(*) as total FROM dlp_incidents"
      ).get();
      const unresolvedRow = this.database.db.prepare(
        "SELECT COUNT(*) as total FROM dlp_incidents WHERE resolved_at IS NULL"
      ).get();
      dbStats = {
        total: totalRow ? totalRow.total : 0,
        unresolved: unresolvedRow ? unresolvedRow.total : 0,
      };
    }

    return {
      scanned: this._stats.scanned,
      blocked: this._stats.blocked,
      alerted: this._stats.alerted,
      totalIncidents: dbStats.total,
      unresolvedIncidents: dbStats.unresolved,
    };
  }

  /**
   * Match content against an array of regex pattern strings.
   * @param {string} content
   * @param {string[]} patterns - Array of regex pattern strings
   * @returns {Array<{pattern: string, matches: string[]}>}
   */
  _matchPatterns(content, patterns) {
    const results = [];
    if (!patterns || !Array.isArray(patterns)) { return results; }

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, "gi");
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          results.push({ pattern, matches: matches.slice(0, 10) });
        }
      } catch (_err) {
        // Skip invalid regex patterns
        logger.warn(`[DLPEngine] Invalid regex pattern: ${pattern}`);
      }
    }
    return results;
  }

  /**
   * Match content against keyword list (case-insensitive).
   * @param {string} content
   * @param {string[]} keywords
   * @returns {Array<{keyword: string}>}
   */
  _matchKeywords(content, keywords) {
    const results = [];
    if (!keywords || !Array.isArray(keywords)) { return results; }

    const lowerContent = content.toLowerCase();
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        results.push({ keyword });
      }
    }
    return results;
  }

  /**
   * SHA-256 hash of content for deduplication.
   */
  _hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Persist an incident to the database.
   */
  _saveIncident(incident) {
    if (!this.database || !this.database.db) { return; }

    try {
      this.database.db.prepare(`
        INSERT INTO dlp_incidents (id, policy_id, channel, action_taken, content_hash, matched_patterns, severity, user_id, metadata, created_at, resolved_at, resolution)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        incident.id, incident.policy_id, incident.channel, incident.action_taken,
        incident.content_hash, incident.matched_patterns, incident.severity,
        incident.user_id, incident.metadata, incident.created_at,
        incident.resolved_at, incident.resolution
      );
    } catch (err) {
      logger.error("[DLPEngine] Failed to save incident:", err);
    }
  }

  async close() {
    this._scanCache.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[DLPEngine] Closed");
  }
}

let _instance;
function getDLPEngine() {
  if (!_instance) { _instance = new DLPEngine(); }
  return _instance;
}

module.exports = { DLPEngine, getDLPEngine, DLP_ACTIONS, DLP_CHANNELS };
