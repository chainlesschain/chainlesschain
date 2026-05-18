/**
 * Timeline Time Machine - Timeline browsing engine
 *
 * Provides timeline snapshot browsing, "on this day" memories,
 * milestone tracking, and date-range based post retrieval.
 *
 * @module social/time-machine
 * @version 0.43.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * TimeMachine class - Timeline browsing engine
 */
class TimeMachine extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
  }

  /**
   * Initialize the time machine
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info("[TimeMachine] Initializing timeline time machine...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[TimeMachine] Timeline time machine initialized successfully");
    } catch (error) {
      logger.error("[TimeMachine] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Timeline snapshots table
    db.exec(`
      CREATE TABLE IF NOT EXISTS timeline_snapshots (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('post', 'message', 'event')),
        source_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        content_preview TEXT,
        media_urls TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Indexes for timeline snapshots
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timeline_snapshots_date ON timeline_snapshots(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_timeline_snapshots_source ON timeline_snapshots(source_type, source_id);
    `);

    // Social memories table
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_memories (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL CHECK(memory_type IN ('on_this_day', 'milestone', 'annual_report', 'throwback')),
        title TEXT NOT NULL,
        description TEXT,
        cover_image TEXT,
        related_posts TEXT,
        target_date TEXT,
        generated_at INTEGER NOT NULL,
        is_read INTEGER DEFAULT 0
      )
    `);

    // Indexes for social memories
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_social_memories_type ON social_memories(memory_type);
      CREATE INDEX IF NOT EXISTS idx_social_memories_target ON social_memories(target_date);
      CREATE INDEX IF NOT EXISTS idx_social_memories_read ON social_memories(is_read);
    `);

    logger.info("[TimeMachine] Database tables initialized");
  }

  /**
   * Get timeline posts for a specific date
   * @param {number} year - Year
   * @param {number} month - Month (1-12)
   * @param {number} day - Day (1-31)
   * @returns {Array} Timeline posts for the date
   */
  async getTimelinePosts(year, month, day) {
    try {
      const db = this.database.db;
      const dateStr = this._formatDate(year, month, day);

      const snapshots = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE snapshot_date = ?
           ORDER BY created_at DESC`,
        )
        .all(dateStr);

      return snapshots.map((s) => ({
        ...s,
        media_urls: s.media_urls ? JSON.parse(s.media_urls) : [],
      }));
    } catch (error) {
      logger.error("[TimeMachine] Failed to get timeline posts:", error);
      throw error;
    }
  }

  /**
   * Get "on this day" posts for a given month and day across all years
   * @param {number} month - Month (1-12)
   * @param {number} day - Day (1-31)
   * @returns {Array} Posts from this day in previous years
   */
  async getOnThisDay(month, day) {
    try {
      const db = this.database.db;
      const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const currentYear = new Date().getFullYear();

      // Find snapshots where the date ends with the month-day pattern
      // but not from the current year
      const snapshots = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           AND snapshot_date NOT LIKE ?
           ORDER BY snapshot_date DESC`,
        )
        .all(`%-${monthDay}`, `${currentYear}-%`);

      return snapshots.map((s) => ({
        ...s,
        media_urls: s.media_urls ? JSON.parse(s.media_urls) : [],
      }));
    } catch (error) {
      logger.error("[TimeMachine] Failed to get on-this-day posts:", error);
      throw error;
    }
  }

  /**
   * Get milestones (memories of type 'milestone')
   * @returns {Array} Milestone memories
   */
  async getMilestones() {
    try {
      const db = this.database.db;

      const milestones = db
        .prepare(
          `SELECT * FROM social_memories
           WHERE memory_type = 'milestone'
           ORDER BY generated_at DESC`,
        )
        .all();

      return milestones.map((m) => ({
        ...m,
        related_posts: m.related_posts ? JSON.parse(m.related_posts) : [],
      }));
    } catch (error) {
      logger.error("[TimeMachine] Failed to get milestones:", error);
      throw error;
    }
  }

  /**
   * Get memories with optional limit
   * @param {number} limit - Maximum number of memories to return
   * @returns {Array} Memory entries
   */
  async getMemories(limit = 20) {
    try {
      const db = this.database.db;

      const memories = db
        .prepare(
          `SELECT * FROM social_memories
           ORDER BY generated_at DESC
           LIMIT ?`,
        )
        .all(limit);

      return memories.map((m) => ({
        ...m,
        related_posts: m.related_posts ? JSON.parse(m.related_posts) : [],
      }));
    } catch (error) {
      logger.error("[TimeMachine] Failed to get memories:", error);
      throw error;
    }
  }

  /**
   * Mark a memory as read
   * @param {string} id - Memory ID
   * @returns {Object} Result
   */
  async markMemoryRead(id) {
    try {
      const db = this.database.db;

      const result = db
        .prepare("UPDATE social_memories SET is_read = 1 WHERE id = ?")
        .run(id);

      if (result.changes === 0) {
        throw new Error("Memory not found");
      }

      logger.info("[TimeMachine] Memory marked as read:", id);
      this.emit("memory:read", { id });

      return { success: true };
    } catch (error) {
      logger.error("[TimeMachine] Failed to mark memory as read:", error);
      throw error;
    }
  }

  /**
   * Create a timeline snapshot
   * @param {string} sourceType - Source type ('post', 'message', 'event')
   * @param {string} sourceId - Source ID
   * @param {string} date - Date string (YYYY-MM-DD)
   * @param {string} preview - Content preview text
   * @param {Array<string>} mediaUrls - Media URL list
   * @returns {Object} Created snapshot
   */
  async createSnapshot(sourceType, sourceId, date, preview, mediaUrls = []) {
    try {
      const db = this.database.db;
      const snapshotId = uuidv4();
      const now = Date.now();

      db.prepare(
        `INSERT INTO timeline_snapshots
         (id, source_type, source_id, snapshot_date, content_preview, media_urls, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        snapshotId,
        sourceType,
        sourceId,
        date,
        preview || null,
        mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
        now,
      );

      const snapshot = {
        id: snapshotId,
        source_type: sourceType,
        source_id: sourceId,
        snapshot_date: date,
        content_preview: preview,
        media_urls: mediaUrls,
        created_at: now,
      };

      logger.info("[TimeMachine] Snapshot created:", snapshotId);
      this.emit("snapshot:created", { snapshot });

      return snapshot;
    } catch (error) {
      logger.error("[TimeMachine] Failed to create snapshot:", error);
      throw error;
    }
  }

  /**
   * Get timeline entries within a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Timeline entries
   */
  async getTimelineRange(startDate, endDate) {
    try {
      const db = this.database.db;

      const snapshots = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE snapshot_date >= ? AND snapshot_date <= ?
           ORDER BY snapshot_date DESC, created_at DESC`,
        )
        .all(startDate, endDate);

      return snapshots.map((s) => ({
        ...s,
        media_urls: s.media_urls ? JSON.parse(s.media_urls) : [],
      }));
    } catch (error) {
      logger.error("[TimeMachine] Failed to get timeline range:", error);
      throw error;
    }
  }

  /**
   * Get a year summary with counts by month
   * @param {number} year - Year to summarize
   * @returns {Object} Year summary with monthly breakdown
   */
  async getYearSummary(year) {
    try {
      const db = this.database.db;
      const yearStr = String(year);

      // Get total count
      const totalRow = db
        .prepare(
          `SELECT COUNT(*) as total FROM timeline_snapshots
           WHERE snapshot_date LIKE ?`,
        )
        .get(`${yearStr}-%`);

      // Get monthly breakdown
      const monthlyRows = db
        .prepare(
          `SELECT
             SUBSTR(snapshot_date, 6, 2) as month,
             COUNT(*) as count,
             source_type
           FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           GROUP BY SUBSTR(snapshot_date, 6, 2), source_type
           ORDER BY month ASC`,
        )
        .all(`${yearStr}-%`);

      // Build monthly summary
      const months = {};
      for (let i = 1; i <= 12; i++) {
        const m = String(i).padStart(2, "0");
        months[m] = { posts: 0, messages: 0, events: 0, total: 0 };
      }

      for (const row of monthlyRows) {
        const m = row.month;
        if (months[m]) {
          if (row.source_type === "post") {months[m].posts = row.count;}
          else if (row.source_type === "message") {months[m].messages = row.count;}
          else if (row.source_type === "event") {months[m].events = row.count;}
          months[m].total += row.count;
        }
      }

      // Get top source types
      const sourceBreakdown = db
        .prepare(
          `SELECT source_type, COUNT(*) as count
           FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           GROUP BY source_type
           ORDER BY count DESC`,
        )
        .all(`${yearStr}-%`);

      // Get memories for this year
      const memories = db
        .prepare(
          `SELECT COUNT(*) as count FROM social_memories
           WHERE target_date LIKE ?`,
        )
        .get(`${yearStr}-%`);

      return {
        year,
        totalSnapshots: totalRow?.total || 0,
        memoriesCount: memories?.count || 0,
        months,
        sourceBreakdown: sourceBreakdown || [],
      };
    } catch (error) {
      logger.error("[TimeMachine] Failed to get year summary:", error);
      throw error;
    }
  }

  /**
   * Format date components into YYYY-MM-DD string
   * @private
   * @param {number} year
   * @param {number} month
   * @param {number} day
   * @returns {string}
   */
  _formatDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  /**
   * Close the time machine
   */
  async close() {
    logger.info("[TimeMachine] Closing timeline time machine");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  TimeMachine,
};
