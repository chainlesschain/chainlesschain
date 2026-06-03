/**
 * Interest Profiler
 *
 * Builds and maintains user interest profiles from topic analyses
 * and social interactions, with time-decay weighted merging.
 *
 * @module social/interest-profiler
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../utils/logger.js");

// ============================================================
// InterestProfiler
// ============================================================

class InterestProfiler extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._profiles = new Map();
  }

  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------

  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[InterestProfiler] Database not available, skipping table creation");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS user_interest_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        topics BLOB,
        interaction_weights BLOB,
        last_updated INTEGER,
        update_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_user_interest_profiles_user ON user_interest_profiles(user_id);
    `);
  }

  async initialize() {
    logger.info("[InterestProfiler] Initializing interest profiler...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[InterestProfiler] Interest profiler initialized successfully");
  }

  // ----------------------------------------------------------
  // Profile access
  // ----------------------------------------------------------

  async getProfile(userId) {
    try {
      // Check in-memory cache first
      if (this._profiles.has(userId)) {
        return this._profiles.get(userId);
      }

      if (!this.database || !this.database.db) {
        return null;
      }

      const row = this.database.db.prepare(`
        SELECT * FROM user_interest_profiles WHERE user_id = ?
      `).get(userId);

      if (!row) {
        return null;
      }

      const profile = {
        id: row.id,
        userId: row.user_id,
        topics: JSON.parse(row.topics || "{}"),
        interactionWeights: JSON.parse(row.interaction_weights || "{}"),
        lastUpdated: row.last_updated,
        updateCount: row.update_count,
      };

      this._profiles.set(userId, profile);
      return profile;
    } catch (error) {
      logger.error("[InterestProfiler] Failed to get profile:", error);
      return null;
    }
  }

  // ----------------------------------------------------------
  // Profile updates
  // ----------------------------------------------------------

  async updateProfile({ userId, interactions }) {
    try {
      if (!interactions || interactions.length === 0) {
        return null;
      }

      // Extract topics from interactions
      const newTopics = {};
      for (const interaction of interactions) {
        const topics = interaction.topics || [];
        const weight = interaction.weight || 1;
        for (const topic of topics) {
          newTopics[topic] = (newTopics[topic] || 0) + weight;
        }
      }

      // Merge with existing profile
      const existing = await this.getProfile(userId);
      let mergedTopics;
      let mergedWeights;

      if (existing) {
        mergedTopics = this._mergeTopics(existing.topics, newTopics, 0.9);
        mergedWeights = this._mergeTopics(
          existing.interactionWeights,
          this._extractWeights(interactions),
          0.9
        );
      } else {
        mergedTopics = this._normalizeWeights(newTopics);
        mergedWeights = this._normalizeWeights(this._extractWeights(interactions));
      }

      const now = Date.now();
      const id = existing ? existing.id : uuidv4();
      const updateCount = existing ? existing.updateCount + 1 : 1;

      if (this.database && this.database.db) {
        this.database.db.prepare(`
          INSERT OR REPLACE INTO user_interest_profiles
            (id, user_id, topics, interaction_weights, last_updated, update_count)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          id,
          userId,
          JSON.stringify(mergedTopics),
          JSON.stringify(mergedWeights),
          now,
          updateCount
        );
      }

      const profile = {
        id,
        userId,
        topics: mergedTopics,
        interactionWeights: mergedWeights,
        lastUpdated: now,
        updateCount,
      };

      this._profiles.set(userId, profile);
      this.emit("profile-updated", { userId, updateCount });
      logger.info(`[InterestProfiler] Profile updated for user ${userId} (update #${updateCount})`);
      return profile;
    } catch (error) {
      logger.error("[InterestProfiler] Failed to update profile:", error);
      return null;
    }
  }

  async buildProfileFromHistory({ userId, topicAnalyses, socialInteractions }) {
    try {
      const topics = {};
      const weights = {};

      // Extract from topic analyses
      if (topicAnalyses && topicAnalyses.length > 0) {
        for (const analysis of topicAnalyses) {
          const analysisTopics = Array.isArray(analysis.topics)
            ? analysis.topics
            : JSON.parse(analysis.topics || "[]");
          for (const topic of analysisTopics) {
            const name = typeof topic === "string" ? topic : topic.name || topic.label;
            if (name) {
              topics[name] = (topics[name] || 0) + 1;
            }
          }
        }
      }

      // Extract from social interactions
      if (socialInteractions && socialInteractions.length > 0) {
        for (const interaction of socialInteractions) {
          const type = interaction.interaction_type || interaction.type || "general";
          weights[type] = (weights[type] || 0) + 1;
        }
      }

      const normalizedTopics = this._normalizeWeights(topics);
      const normalizedWeights = this._normalizeWeights(weights);

      const now = Date.now();
      const id = uuidv4();

      if (this.database && this.database.db) {
        this.database.db.prepare(`
          INSERT OR REPLACE INTO user_interest_profiles
            (id, user_id, topics, interaction_weights, last_updated, update_count)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(
          id,
          userId,
          JSON.stringify(normalizedTopics),
          JSON.stringify(normalizedWeights),
          now
        );
      }

      const profile = {
        id,
        userId,
        topics: normalizedTopics,
        interactionWeights: normalizedWeights,
        lastUpdated: now,
        updateCount: 1,
      };

      this._profiles.set(userId, profile);
      this.emit("profile-built", { userId });
      logger.info(`[InterestProfiler] Profile built from history for user ${userId}`);
      return profile;
    } catch (error) {
      logger.error("[InterestProfiler] Failed to build profile from history:", error);
      return null;
    }
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  _mergeTopics(existing, newTopics, decayFactor = 0.9) {
    const merged = {};

    // Apply decay to existing topics
    for (const [key, value] of Object.entries(existing || {})) {
      merged[key] = value * decayFactor;
    }

    // Add new topics
    for (const [key, value] of Object.entries(newTopics || {})) {
      merged[key] = (merged[key] || 0) + value;
    }

    return this._normalizeWeights(merged);
  }

  _normalizeWeights(weights) {
    if (!weights || Object.keys(weights).length === 0) {
      return {};
    }

    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sum === 0) {
      return weights;
    }

    const normalized = {};
    for (const [key, value] of Object.entries(weights)) {
      normalized[key] = Math.round((value / sum) * 10000) / 10000;
    }

    return normalized;
  }

  _extractWeights(interactions) {
    const weights = {};
    for (const interaction of interactions) {
      const type = interaction.type || "general";
      weights[type] = (weights[type] || 0) + (interaction.weight || 1);
    }
    return weights;
  }

  async close() {
    logger.info("[InterestProfiler] Closing interest profiler");
    this._profiles.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

let _instance;
function getInterestProfiler() {
  if (!_instance) {
    _instance = new InterestProfiler();
  }
  return _instance;
}

module.exports = { InterestProfiler, getInterestProfiler };
