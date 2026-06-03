/**
 * Local Recommender
 *
 * Smart content recommendation engine that scores and ranks content
 * based on user interest profiles using cosine similarity.
 *
 * @module social/local-recommender
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../utils/logger.js");

// ============================================================
// LocalRecommender
// ============================================================

class LocalRecommender extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._interestProfiler = null;
    this._cache = new Map();
  }

  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------

  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[LocalRecommender] Database not available, skipping table creation");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS content_recommendations (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        content_id TEXT,
        content_type TEXT,
        score REAL,
        reason TEXT,
        source TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER,
        viewed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_content_recommendations_user ON content_recommendations(user_id);
      CREATE INDEX IF NOT EXISTS idx_content_recommendations_score ON content_recommendations(score DESC);
    `);
  }

  async initialize() {
    logger.info("[LocalRecommender] Initializing local recommender...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[LocalRecommender] Local recommender initialized successfully");
  }

  // ----------------------------------------------------------
  // Dependency injection
  // ----------------------------------------------------------

  setInterestProfiler(profiler) {
    this._interestProfiler = profiler;
    logger.info("[LocalRecommender] Interest profiler set");
  }

  // ----------------------------------------------------------
  // Recommendations
  // ----------------------------------------------------------

  async getRecommendations({ userId, limit = 20, contentType, minScore = 0.3 }) {
    try {
      if (!this.database || !this.database.db) {
        return [];
      }

      let sql = `
        SELECT * FROM content_recommendations
        WHERE user_id = ? AND score >= ?
      `;
      const params = [userId, minScore];

      if (contentType) {
        sql += " AND content_type = ?";
        params.push(contentType);
      }

      sql += " ORDER BY score DESC LIMIT ?";
      params.push(limit);

      const rows = this.database.db.prepare(sql).all(...params);
      return rows;
    } catch (error) {
      logger.error("[LocalRecommender] Failed to get recommendations:", error);
      return [];
    }
  }

  async generateRecommendations({ userId, contentPool }) {
    try {
      if (!contentPool || contentPool.length === 0) {
        return [];
      }

      // Get interest profile for scoring
      let profile = null;
      if (this._interestProfiler) {
        profile = await this._interestProfiler.getProfile(userId);
      }

      const scored = [];
      for (const item of contentPool) {
        let score = 0;
        let reason = "default";

        if (profile && profile.topics && item.topicVector) {
          score = this._cosineSimilarity(
            Object.values(profile.topics),
            item.topicVector
          );
          reason = "interest_match";
        } else {
          // Fallback: assign a base score
          score = 0.5;
          reason = "no_profile";
        }

        scored.push({
          ...item,
          score,
          reason,
        });
      }

      // Sort by score descending, take top items
      scored.sort((a, b) => b.score - a.score);
      const topItems = scored.slice(0, 50);

      // Insert into DB
      const results = [];
      const now = Date.now();

      if (this.database && this.database.db) {
        const stmt = this.database.db.prepare(`
          INSERT OR REPLACE INTO content_recommendations
            (id, user_id, content_id, content_type, score, reason, source, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `);

        for (const item of topItems) {
          const id = uuidv4();
          stmt.run(
            id,
            userId,
            item.contentId || item.id,
            item.contentType || "post",
            item.score,
            item.reason,
            item.source || "local",
            now
          );
          results.push({
            id,
            userId,
            contentId: item.contentId || item.id,
            contentType: item.contentType || "post",
            score: item.score,
            reason: item.reason,
            source: item.source || "local",
            status: "pending",
            createdAt: now,
          });
        }
      }

      this.emit("recommendations-generated", { userId, count: results.length });
      logger.info(`[LocalRecommender] Generated ${results.length} recommendations for user ${userId}`);
      return results;
    } catch (error) {
      logger.error("[LocalRecommender] Failed to generate recommendations:", error);
      return [];
    }
  }

  async markViewed(recommendationId) {
    try {
      if (!this.database || !this.database.db) {
        return false;
      }

      this.database.db.prepare(`
        UPDATE content_recommendations SET viewed_at = ? WHERE id = ?
      `).run(Date.now(), recommendationId);

      this.emit("recommendation-viewed", { recommendationId });
      return true;
    } catch (error) {
      logger.error("[LocalRecommender] Failed to mark viewed:", error);
      return false;
    }
  }

  async provideFeedback({ recommendationId, feedback }) {
    try {
      if (!this.database || !this.database.db) {
        return false;
      }

      this.database.db.prepare(`
        UPDATE content_recommendations SET status = ? WHERE id = ?
      `).run(feedback, recommendationId);

      this.emit("recommendation-feedback", { recommendationId, feedback });
      logger.info(`[LocalRecommender] Feedback '${feedback}' recorded for ${recommendationId}`);
      return true;
    } catch (error) {
      logger.error("[LocalRecommender] Failed to provide feedback:", error);
      return false;
    }
  }

  // ----------------------------------------------------------
  // Math helpers
  // ----------------------------------------------------------

  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
      return 0;
    }

    const len = Math.min(vecA.length, vecB.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  // ----------------------------------------------------------
  // Stats
  // ----------------------------------------------------------

  async getStats(userId) {
    try {
      if (!this.database || !this.database.db) {
        return { total: 0, pending: 0, liked: 0, dismissed: 0, saved: 0, viewed: 0 };
      }

      const rows = this.database.db.prepare(`
        SELECT status, COUNT(*) as count FROM content_recommendations
        WHERE user_id = ?
        GROUP BY status
      `).all(userId);

      const stats = { total: 0, pending: 0, liked: 0, dismissed: 0, saved: 0, viewed: 0 };
      for (const row of rows) {
        stats[row.status] = row.count;
        stats.total += row.count;
      }

      // Count viewed (has viewed_at set)
      const viewedRow = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM content_recommendations
        WHERE user_id = ? AND viewed_at IS NOT NULL
      `).get(userId);
      stats.viewed = viewedRow ? viewedRow.count : 0;

      return stats;
    } catch (error) {
      logger.error("[LocalRecommender] Failed to get stats:", error);
      return { total: 0, pending: 0, liked: 0, dismissed: 0, saved: 0, viewed: 0 };
    }
  }

  async close() {
    logger.info("[LocalRecommender] Closing local recommender");
    this._cache.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

let _instance;
function getLocalRecommender() {
  if (!_instance) {
    _instance = new LocalRecommender();
  }
  return _instance;
}

module.exports = { LocalRecommender, getLocalRecommender };
