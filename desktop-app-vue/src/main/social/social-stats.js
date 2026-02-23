/**
 * Social Stats - Activity and network statistics
 *
 * Computes and caches social activity statistics including
 * activity metrics, network stats, engagement analytics,
 * interaction heatmaps, and word clouds.
 *
 * @module social/social-stats
 * @version 0.43.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Stat types
 */
const StatType = {
  ACTIVITY: "activity",
  NETWORK: "network",
  ENGAGEMENT: "engagement",
  WORDCLOUD: "wordcloud",
  HEATMAP: "heatmap",
};

/**
 * SocialStats class - Social activity and network statistics
 */
class SocialStats extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache TTL
  }

  /**
   * Initialize the social stats engine
   */
  async initialize() {
    logger.info("[SocialStats] Initializing social stats...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[SocialStats] Social stats initialized successfully");
    } catch (error) {
      logger.error("[SocialStats] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS social_stats_cache (
        id TEXT PRIMARY KEY,
        stat_type TEXT NOT NULL CHECK(stat_type IN ('activity', 'network', 'engagement', 'wordcloud', 'heatmap')),
        period TEXT NOT NULL,
        data TEXT NOT NULL,
        computed_at INTEGER NOT NULL,
        UNIQUE(stat_type, period)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_stats_type_period ON social_stats_cache(stat_type, period);
      CREATE INDEX IF NOT EXISTS idx_stats_computed ON social_stats_cache(computed_at);
    `);

    logger.info("[SocialStats] Database tables initialized");
  }

  /**
   * Get activity stats for a period
   * @param {string} period - Period ('day', 'week', 'month', 'year')
   * @returns {Object} Activity statistics
   */
  async getActivityStats(period = "month") {
    try {
      // Check cache first
      const cached = this._getFromCache(StatType.ACTIVITY, period);
      if (cached) return cached;

      const db = this.database.db;
      const startTs = this._periodToTimestamp(period);

      // Count posts
      const postCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM posts WHERE created_at >= ?",
        )
        .get(startTs);

      // Count messages (from timeline_snapshots)
      const messageCount = db
        .prepare(
          `SELECT COUNT(*) as count FROM timeline_snapshots
           WHERE source_type = 'message' AND created_at >= ?`,
        )
        .get(startTs);

      // Count likes given
      const likesGiven = db
        .prepare(
          "SELECT COUNT(*) as count FROM post_likes WHERE created_at >= ?",
        )
        .get(startTs);

      // Count comments made
      const commentsMade = db
        .prepare(
          "SELECT COUNT(*) as count FROM post_comments WHERE created_at >= ?",
        )
        .get(startTs);

      // Daily activity breakdown
      const dailyActivity = db
        .prepare(
          `SELECT DATE(created_at / 1000, 'unixepoch') as date, COUNT(*) as count
           FROM posts
           WHERE created_at >= ?
           GROUP BY DATE(created_at / 1000, 'unixepoch')
           ORDER BY date ASC`,
        )
        .all(startTs);

      const stats = {
        period,
        totalPosts: postCount?.count || 0,
        totalMessages: messageCount?.count || 0,
        totalLikes: likesGiven?.count || 0,
        totalComments: commentsMade?.count || 0,
        totalActivity:
          (postCount?.count || 0) +
          (messageCount?.count || 0) +
          (likesGiven?.count || 0) +
          (commentsMade?.count || 0),
        dailyActivity: dailyActivity || [],
      };

      this._saveToCache(StatType.ACTIVITY, period, stats);
      return stats;
    } catch (error) {
      logger.error("[SocialStats] Failed to get activity stats:", error);
      throw error;
    }
  }

  /**
   * Get network statistics (friends, connections)
   * @returns {Object} Network statistics
   */
  async getNetworkStats() {
    try {
      const cached = this._getFromCache(StatType.NETWORK, "all");
      if (cached) return cached;

      const db = this.database.db;

      // Count friends
      let friendCount = 0;
      try {
        const row = db
          .prepare(
            "SELECT COUNT(*) as count FROM friendships WHERE status = 'accepted'",
          )
          .get();
        friendCount = row?.count || 0;
      } catch {
        // friendships table might not exist
      }

      // Count contacts
      let contactCount = 0;
      try {
        const row = db
          .prepare("SELECT COUNT(*) as count FROM contacts")
          .get();
        contactCount = row?.count || 0;
      } catch {
        // contacts table might not exist
      }

      // Count groups
      let groupCount = 0;
      try {
        const row = db
          .prepare("SELECT COUNT(*) as count FROM group_chats")
          .get();
        groupCount = row?.count || 0;
      } catch {
        // group_chats table might not exist
      }

      // Count chat sessions
      let sessionCount = 0;
      try {
        const row = db
          .prepare("SELECT COUNT(*) as count FROM chat_sessions")
          .get();
        sessionCount = row?.count || 0;
      } catch {
        // chat_sessions table might not exist
      }

      const stats = {
        totalFriends: friendCount,
        totalContacts: contactCount,
        totalGroups: groupCount,
        totalChatSessions: sessionCount,
        networkSize: friendCount + contactCount,
      };

      this._saveToCache(StatType.NETWORK, "all", stats);
      return stats;
    } catch (error) {
      logger.error("[SocialStats] Failed to get network stats:", error);
      throw error;
    }
  }

  /**
   * Get engagement statistics for a period
   * @param {string} period - Period ('day', 'week', 'month', 'year')
   * @returns {Object} Engagement statistics
   */
  async getEngagementStats(period = "month") {
    try {
      const cached = this._getFromCache(StatType.ENGAGEMENT, period);
      if (cached) return cached;

      const db = this.database.db;
      const startTs = this._periodToTimestamp(period);

      // Average likes per post
      const avgLikes = db
        .prepare(
          `SELECT AVG(like_count) as avg_likes, MAX(like_count) as max_likes
           FROM posts WHERE created_at >= ?`,
        )
        .get(startTs);

      // Average comments per post
      const avgComments = db
        .prepare(
          `SELECT AVG(comment_count) as avg_comments, MAX(comment_count) as max_comments
           FROM posts WHERE created_at >= ?`,
        )
        .get(startTs);

      // Most liked posts
      const topLikedPosts = db
        .prepare(
          `SELECT id, content, like_count, comment_count, created_at
           FROM posts
           WHERE created_at >= ?
           ORDER BY like_count DESC
           LIMIT 5`,
        )
        .all(startTs);

      // Most commented posts
      const topCommentedPosts = db
        .prepare(
          `SELECT id, content, like_count, comment_count, created_at
           FROM posts
           WHERE created_at >= ?
           ORDER BY comment_count DESC
           LIMIT 5`,
        )
        .all(startTs);

      const stats = {
        period,
        averageLikesPerPost: avgLikes?.avg_likes != null
          ? Math.round(avgLikes.avg_likes * 100) / 100
          : 0,
        maxLikesOnPost: avgLikes?.max_likes || 0,
        averageCommentsPerPost: avgComments?.avg_comments != null
          ? Math.round(avgComments.avg_comments * 100) / 100
          : 0,
        maxCommentsOnPost: avgComments?.max_comments || 0,
        topLikedPosts: topLikedPosts || [],
        topCommentedPosts: topCommentedPosts || [],
      };

      this._saveToCache(StatType.ENGAGEMENT, period, stats);
      return stats;
    } catch (error) {
      logger.error("[SocialStats] Failed to get engagement stats:", error);
      throw error;
    }
  }

  /**
   * Get interaction heatmap data for a year
   * @param {number} year - Year to generate heatmap for
   * @returns {Array} Heatmap data with date and count
   */
  async getInteractionHeatmap(year) {
    try {
      const cacheKey = `${year}`;
      const cached = this._getFromCache(StatType.HEATMAP, cacheKey);
      if (cached) return cached;

      const db = this.database.db;
      const yearStr = String(year);

      // Get daily post counts
      const postActivity = db
        .prepare(
          `SELECT DATE(created_at / 1000, 'unixepoch') as date, COUNT(*) as count
           FROM posts
           WHERE DATE(created_at / 1000, 'unixepoch') LIKE ?
           GROUP BY DATE(created_at / 1000, 'unixepoch')`,
        )
        .all(`${yearStr}-%`);

      // Get daily snapshot counts
      const snapshotActivity = db
        .prepare(
          `SELECT snapshot_date as date, COUNT(*) as count
           FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           GROUP BY snapshot_date`,
        )
        .all(`${yearStr}-%`);

      // Merge activity data
      const dateMap = new Map();

      for (const row of postActivity) {
        dateMap.set(row.date, (dateMap.get(row.date) || 0) + row.count);
      }

      for (const row of snapshotActivity) {
        dateMap.set(row.date, (dateMap.get(row.date) || 0) + row.count);
      }

      // Convert to array sorted by date
      const heatmapData = Array.from(dateMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      this._saveToCache(StatType.HEATMAP, cacheKey, heatmapData);
      return heatmapData;
    } catch (error) {
      logger.error("[SocialStats] Failed to get interaction heatmap:", error);
      throw error;
    }
  }

  /**
   * Get word cloud data from posts in a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Word cloud items { word, count }
   */
  async getWordCloud(startDate, endDate) {
    try {
      const cacheKey = `${startDate}_${endDate}`;
      const cached = this._getFromCache(StatType.WORDCLOUD, cacheKey);
      if (cached) return cached;

      const db = this.database.db;
      const startTs = new Date(startDate).getTime();
      const endTs = new Date(endDate + "T23:59:59").getTime();

      // Get all post content in the range
      const posts = db
        .prepare(
          `SELECT content FROM posts
           WHERE created_at >= ? AND created_at <= ?`,
        )
        .all(startTs, endTs);

      // Also include timeline snapshot previews
      const snapshots = db
        .prepare(
          `SELECT content_preview as content FROM timeline_snapshots
           WHERE snapshot_date >= ? AND snapshot_date <= ?
           AND content_preview IS NOT NULL`,
        )
        .all(startDate, endDate);

      // Build word frequency map
      const wordFreq = new Map();
      const stopWords = new Set([
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "need", "dare", "ought",
        "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "as", "into", "through", "during", "before", "after", "above", "below",
        "between", "out", "off", "over", "under", "again", "further", "then",
        "once", "here", "there", "when", "where", "why", "how", "all", "both",
        "each", "few", "more", "most", "other", "some", "such", "no", "nor",
        "not", "only", "own", "same", "so", "than", "too", "very", "just",
        "because", "but", "and", "or", "if", "while", "that", "this", "it",
        "its", "i", "me", "my", "we", "our", "you", "your", "he", "she",
        "they", "them", "his", "her", "their", "what", "which", "who",
      ]);

      const allContent = [...posts, ...snapshots];

      for (const row of allContent) {
        if (!row.content) continue;

        const words = row.content
          .toLowerCase()
          .replace(/[^a-z\s\u4e00-\u9fff]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !stopWords.has(w));

        for (const word of words) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }

      // Sort by frequency and take top 100
      const wordCloud = Array.from(wordFreq.entries())
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);

      this._saveToCache(StatType.WORDCLOUD, cacheKey, wordCloud);
      return wordCloud;
    } catch (error) {
      logger.error("[SocialStats] Failed to get word cloud:", error);
      throw error;
    }
  }

  /**
   * Get top interactions (most-messaged friends)
   * @param {number} limit - Maximum number of results
   * @returns {Array} Top interaction entries
   */
  async getTopInteractions(limit = 10) {
    try {
      const db = this.database.db;

      let topFriends = [];
      try {
        topFriends = db
          .prepare(
            `SELECT participant_did as did,
                    friend_nickname as nickname,
                    COUNT(*) as session_count
             FROM chat_sessions
             GROUP BY participant_did
             ORDER BY session_count DESC
             LIMIT ?`,
          )
          .all(limit);
      } catch {
        // chat_sessions might not exist
      }

      // Also try to get from message counts
      let topByMessages = [];
      try {
        topByMessages = db
          .prepare(
            `SELECT receiver_did as did, COUNT(*) as message_count
             FROM p2p_chat_messages
             GROUP BY receiver_did
             ORDER BY message_count DESC
             LIMIT ?`,
          )
          .all(limit);
      } catch {
        // p2p_chat_messages might not exist
      }

      return {
        topBySession: topFriends,
        topByMessages: topByMessages,
      };
    } catch (error) {
      logger.error("[SocialStats] Failed to get top interactions:", error);
      throw error;
    }
  }

  /**
   * Refresh all cached stats
   * @returns {Object} Refresh result
   */
  async refreshStats() {
    try {
      const db = this.database.db;

      // Clear cache
      db.prepare("DELETE FROM social_stats_cache").run();

      logger.info("[SocialStats] Stats cache cleared, refreshing...");

      // Recompute key stats
      const [activity, network, engagement] = await Promise.all([
        this.getActivityStats("month"),
        this.getNetworkStats(),
        this.getEngagementStats("month"),
      ]);

      this.emit("stats:refreshed");

      return {
        success: true,
        refreshedAt: Date.now(),
        activity,
        network,
        engagement,
      };
    } catch (error) {
      logger.error("[SocialStats] Failed to refresh stats:", error);
      throw error;
    }
  }

  /**
   * Get the most active day of the week
   * @returns {Object} Most active day info
   */
  async getMostActiveDay() {
    try {
      const db = this.database.db;

      // Get day-of-week breakdown from posts
      const dayActivity = db
        .prepare(
          `SELECT
             CASE CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER)
               WHEN 0 THEN 'Sunday'
               WHEN 1 THEN 'Monday'
               WHEN 2 THEN 'Tuesday'
               WHEN 3 THEN 'Wednesday'
               WHEN 4 THEN 'Thursday'
               WHEN 5 THEN 'Friday'
               WHEN 6 THEN 'Saturday'
             END as day_name,
             CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) as day_number,
             COUNT(*) as count
           FROM posts
           GROUP BY day_number
           ORDER BY count DESC`,
        )
        .all();

      if (dayActivity.length === 0) {
        return { mostActiveDay: null, activity: [] };
      }

      return {
        mostActiveDay: dayActivity[0].day_name,
        mostActiveCount: dayActivity[0].count,
        activity: dayActivity,
      };
    } catch (error) {
      logger.error("[SocialStats] Failed to get most active day:", error);
      throw error;
    }
  }

  /**
   * Get posting frequency over a period
   * @param {string} period - Period ('week', 'month', 'year')
   * @returns {Object} Posting frequency data
   */
  async getPostingFrequency(period = "month") {
    try {
      const db = this.database.db;
      const startTs = this._periodToTimestamp(period);
      const now = Date.now();
      const daysDiff = Math.max(1, Math.ceil((now - startTs) / (1000 * 60 * 60 * 24)));

      const totalPosts = db
        .prepare("SELECT COUNT(*) as count FROM posts WHERE created_at >= ?")
        .get(startTs);

      const count = totalPosts?.count || 0;
      const postsPerDay = Math.round((count / daysDiff) * 100) / 100;
      const postsPerWeek = Math.round(postsPerDay * 7 * 100) / 100;

      return {
        period,
        totalPosts: count,
        days: daysDiff,
        postsPerDay,
        postsPerWeek,
        postsPerMonth: Math.round(postsPerDay * 30 * 100) / 100,
      };
    } catch (error) {
      logger.error("[SocialStats] Failed to get posting frequency:", error);
      throw error;
    }
  }

  /**
   * Get cached stats
   * @private
   * @param {string} statType
   * @param {string} period
   * @returns {Object|null}
   */
  _getFromCache(statType, period) {
    try {
      const db = this.database.db;
      const row = db
        .prepare(
          "SELECT data, computed_at FROM social_stats_cache WHERE stat_type = ? AND period = ?",
        )
        .get(statType, period);

      if (!row) return null;

      // Check if cache is expired
      if (Date.now() - row.computed_at > this.cacheExpiry) {
        return null;
      }

      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  /**
   * Save stats to cache
   * @private
   * @param {string} statType
   * @param {string} period
   * @param {Object} data
   */
  _saveToCache(statType, period, data) {
    try {
      const db = this.database.db;
      const now = Date.now();

      db.prepare(
        `INSERT OR REPLACE INTO social_stats_cache (id, stat_type, period, data, computed_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(uuidv4(), statType, period, JSON.stringify(data), now);
    } catch (error) {
      logger.warn("[SocialStats] Failed to save to cache:", error.message);
    }
  }

  /**
   * Convert period string to start timestamp
   * @private
   * @param {string} period
   * @returns {number}
   */
  _periodToTimestamp(period) {
    const now = new Date();

    switch (period) {
      case "day":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      case "week":
        return now.getTime() - 7 * 24 * 60 * 60 * 1000;
      case "month":
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      case "year":
        return new Date(now.getFullYear(), 0, 1).getTime();
      default:
        return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Close the social stats engine
   */
  async close() {
    logger.info("[SocialStats] Closing social stats engine");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  SocialStats,
  StatType,
};
