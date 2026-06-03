/**
 * Memory Generator - AI-powered memory generation
 *
 * Generates "on this day" memories, annual reports, milestones,
 * and throwback content using LLM for text generation.
 * Writes results to the social_memories table.
 *
 * @module social/memory-generator
 * @version 0.43.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * MemoryGenerator class - AI memory generation engine
 */
class MemoryGenerator extends EventEmitter {
  constructor(database, llmManager) {
    super();

    this.database = database;
    this.llmManager = llmManager;
    this.initialized = false;
  }

  /**
   * Initialize the memory generator
   */
  async initialize() {
    logger.info("[MemoryGenerator] Initializing memory generator...");

    try {
      // social_memories table is created by TimeMachine; no separate table needed
      this.initialized = true;
      logger.info("[MemoryGenerator] Memory generator initialized successfully");
    } catch (error) {
      logger.error("[MemoryGenerator] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Generate "on this day" memory for a specific date
   * @param {string} date - Date string (YYYY-MM-DD) or Date object
   * @returns {Object} Generated memory
   */
  async generateOnThisDay(date) {
    try {
      const dateObj = typeof date === "string" ? new Date(date) : date;
      const month = dateObj.getMonth() + 1;
      const day = dateObj.getDate();
      const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const currentYear = new Date().getFullYear();

      const db = this.database.db;

      // Find past snapshots for this month-day
      const pastSnapshots = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           AND snapshot_date NOT LIKE ?
           ORDER BY snapshot_date DESC
           LIMIT 20`,
        )
        .all(`%-${monthDay}`, `${currentYear}-%`);

      if (pastSnapshots.length === 0) {
        logger.info("[MemoryGenerator] No past entries found for on-this-day:", monthDay);
        return null;
      }

      // Build context for LLM
      const snippets = pastSnapshots.map((s) => {
        const year = s.snapshot_date.split("-")[0];
        return `[${year}] ${s.content_preview || "(no preview)"}`;
      });

      let title = `On This Day - ${month}/${day}`;
      let description = `You had ${pastSnapshots.length} moment(s) on this day in previous years.`;

      // Use LLM for richer summary if available
      if (this.llmManager) {
        try {
          const prompt = `You are a friendly personal assistant. The user has the following timeline entries from previous years on ${month}/${day}:\n\n${snippets.join("\n")}\n\nWrite a warm, nostalgic 2-3 sentence summary titled "On This Day" that highlights key moments. Respond with JSON: { "title": "...", "description": "..." }`;

          const result = await this.llmManager.chat([
            { role: "user", content: prompt },
          ]);

          const responseText =
            typeof result === "string"
              ? result
              : result?.content || result?.message?.content || "";

          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              title = parsed.title || title;
              description = parsed.description || description;
            }
          } catch (parseError) {
            // Use LLM text as description if JSON parsing fails
            if (responseText.length > 10) {
              description = responseText.substring(0, 500);
            }
          }
        } catch (llmError) {
          logger.warn("[MemoryGenerator] LLM generation failed, using fallback:", llmError.message);
        }
      }

      // Store the memory
      const memory = await this._saveMemory({
        memoryType: "on_this_day",
        title,
        description,
        coverImage: this._extractFirstImage(pastSnapshots),
        relatedPosts: pastSnapshots.map((s) => s.source_id),
        targetDate: `${currentYear}-${monthDay}`,
      });

      this.emit("memory:generated", { memory });
      return memory;
    } catch (error) {
      logger.error("[MemoryGenerator] Failed to generate on-this-day:", error);
      throw error;
    }
  }

  /**
   * Generate annual report for a given year
   * @param {number} year - Year to generate report for
   * @returns {Object} Generated annual report memory
   */
  async generateAnnualReport(year) {
    try {
      const db = this.database.db;
      const yearStr = String(year);

      // Gather year statistics
      const totalCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM timeline_snapshots WHERE snapshot_date LIKE ?",
        )
        .get(`${yearStr}-%`);

      const byType = db
        .prepare(
          `SELECT source_type, COUNT(*) as count
           FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           GROUP BY source_type`,
        )
        .all(`${yearStr}-%`);

      const monthlyActivity = db
        .prepare(
          `SELECT SUBSTR(snapshot_date, 6, 2) as month, COUNT(*) as count
           FROM timeline_snapshots
           WHERE snapshot_date LIKE ?
           GROUP BY SUBSTR(snapshot_date, 6, 2)
           ORDER BY month`,
        )
        .all(`${yearStr}-%`);

      // Find the most active month
      let peakMonth = null;
      let peakCount = 0;
      for (const row of monthlyActivity) {
        if (row.count > peakCount) {
          peakCount = row.count;
          peakMonth = row.month;
        }
      }

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const peakMonthName = peakMonth ? monthNames[parseInt(peakMonth, 10) - 1] : "N/A";

      let title = `${year} Annual Report`;
      let description = `In ${year}, you created ${totalCount?.count || 0} timeline entries. `;
      description += `Your most active month was ${peakMonthName} with ${peakCount} entries. `;

      const typeBreakdown = byType.map((t) => `${t.count} ${t.source_type}(s)`).join(", ");
      if (typeBreakdown) {
        description += `Breakdown: ${typeBreakdown}.`;
      }

      // Use LLM for a more engaging summary
      if (this.llmManager && totalCount?.count > 0) {
        try {
          const prompt = `You are a personal assistant creating a year-in-review. Stats for ${year}:\n- Total entries: ${totalCount.count}\n- By type: ${typeBreakdown}\n- Most active month: ${peakMonthName} (${peakCount} entries)\n- Monthly activity: ${monthlyActivity.map((m) => `${monthNames[parseInt(m.month, 10) - 1]}: ${m.count}`).join(", ")}\n\nWrite a warm, celebratory 3-4 sentence annual report summary. Respond with JSON: { "title": "...", "description": "..." }`;

          const result = await this.llmManager.chat([
            { role: "user", content: prompt },
          ]);

          const responseText =
            typeof result === "string"
              ? result
              : result?.content || result?.message?.content || "";

          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              title = parsed.title || title;
              description = parsed.description || description;
            }
          } catch (parseError) {
            if (responseText.length > 10) {
              description = responseText.substring(0, 500);
            }
          }
        } catch (llmError) {
          logger.warn("[MemoryGenerator] LLM annual report generation failed:", llmError.message);
        }
      }

      const memory = await this._saveMemory({
        memoryType: "annual_report",
        title,
        description,
        coverImage: null,
        relatedPosts: [],
        targetDate: `${yearStr}-12-31`,
      });

      this.emit("report:ready", { memory, year });
      return memory;
    } catch (error) {
      logger.error("[MemoryGenerator] Failed to generate annual report:", error);
      throw error;
    }
  }

  /**
   * Generate a milestone memory for a friend relationship
   * @param {string} friendDid - Friend's DID
   * @param {string} type - Milestone type (e.g., 'anniversary', 'first_message', 'hundred_messages')
   * @returns {Object} Generated milestone memory
   */
  async generateMilestone(friendDid, type) {
    try {
      const db = this.database.db;

      // Gather context about the friendship
      const messageCount = db
        .prepare(
          `SELECT COUNT(*) as count FROM timeline_snapshots
           WHERE source_type = 'message' AND content_preview LIKE ?`,
        )
        .get(`%${friendDid.substring(0, 16)}%`);

      const milestoneLabels = {
        anniversary: "Friendship Anniversary",
        first_message: "First Message",
        hundred_messages: "100 Messages Milestone",
        year_together: "One Year Together",
      };

      const title = milestoneLabels[type] || `Milestone: ${type}`;
      let description = `A special milestone in your connection with ${friendDid.substring(0, 16)}...`;

      if (type === "hundred_messages") {
        description = `You have exchanged over ${messageCount?.count || 100} messages. What a journey!`;
      } else if (type === "anniversary") {
        description = `Happy friendship anniversary! Celebrating your bond.`;
      }

      // Enhance with LLM if available
      if (this.llmManager) {
        try {
          const prompt = `Write a brief, warm milestone message for a social app. Milestone type: "${type}". Context: ${messageCount?.count || 0} messages exchanged with a friend. Keep it to 2 sentences. Respond with JSON: { "title": "...", "description": "..." }`;

          const result = await this.llmManager.chat([
            { role: "user", content: prompt },
          ]);

          const responseText =
            typeof result === "string"
              ? result
              : result?.content || result?.message?.content || "";

          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              description = parsed.description || description;
            }
          } catch (parseError) {
            // Keep default description
          }
        } catch (llmError) {
          logger.warn("[MemoryGenerator] LLM milestone generation failed:", llmError.message);
        }
      }

      const memory = await this._saveMemory({
        memoryType: "milestone",
        title,
        description,
        coverImage: null,
        relatedPosts: [],
        targetDate: new Date().toISOString().split("T")[0],
      });

      this.emit("memory:generated", { memory });
      return memory;
    } catch (error) {
      logger.error("[MemoryGenerator] Failed to generate milestone:", error);
      throw error;
    }
  }

  /**
   * Generate a random throwback memory from past content
   * @returns {Object|null} Generated throwback memory or null if no content
   */
  async generateThrowback() {
    try {
      const db = this.database.db;

      // Pick a random past snapshot (at least 7 days old)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];

      const randomSnapshot = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE snapshot_date < ?
           ORDER BY RANDOM()
           LIMIT 1`,
        )
        .get(cutoffDate);

      if (!randomSnapshot) {
        logger.info("[MemoryGenerator] No past content for throwback");
        return null;
      }

      const snapshotDate = new Date(randomSnapshot.snapshot_date);
      const now = new Date();
      const diffDays = Math.floor((now - snapshotDate) / (1000 * 60 * 60 * 24));

      let timeAgo;
      if (diffDays < 30) {
        timeAgo = `${diffDays} days ago`;
      } else if (diffDays < 365) {
        timeAgo = `${Math.floor(diffDays / 30)} months ago`;
      } else {
        timeAgo = `${Math.floor(diffDays / 365)} year(s) ago`;
      }

      const title = `Throwback - ${timeAgo}`;
      const description =
        randomSnapshot.content_preview ||
        `A moment from ${randomSnapshot.snapshot_date}`;

      const memory = await this._saveMemory({
        memoryType: "throwback",
        title,
        description,
        coverImage: this._extractFirstImage([randomSnapshot]),
        relatedPosts: [randomSnapshot.source_id],
        targetDate: randomSnapshot.snapshot_date,
      });

      this.emit("memory:generated", { memory });
      return memory;
    } catch (error) {
      logger.error("[MemoryGenerator] Failed to generate throwback:", error);
      throw error;
    }
  }

  /**
   * Summarize a conversation with a friend over a date range
   * @param {string} friendDid - Friend's DID
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Object} Conversation summary
   */
  async summarizeConversation(friendDid, startDate, endDate) {
    try {
      const db = this.database.db;

      // Get message snapshots in range that relate to the friend
      const messages = db
        .prepare(
          `SELECT * FROM timeline_snapshots
           WHERE source_type = 'message'
           AND snapshot_date >= ? AND snapshot_date <= ?
           AND (content_preview LIKE ? OR source_id LIKE ?)
           ORDER BY snapshot_date ASC`,
        )
        .all(
          startDate,
          endDate,
          `%${friendDid.substring(0, 16)}%`,
          `%${friendDid.substring(0, 16)}%`,
        );

      if (messages.length === 0) {
        return {
          friendDid,
          startDate,
          endDate,
          messageCount: 0,
          summary: "No messages found in this date range.",
        };
      }

      let summary = `${messages.length} messages exchanged between ${startDate} and ${endDate}.`;

      // Use LLM for richer summary
      if (this.llmManager && messages.length > 0) {
        try {
          const previews = messages
            .slice(0, 30) // Limit to 30 messages for context window
            .map((m) => m.content_preview || "(media)")
            .join("\n");

          const prompt = `Summarize this conversation between two friends (${messages.length} messages total, showing first ${Math.min(messages.length, 30)}):\n\n${previews}\n\nProvide a brief, friendly summary in 3-4 sentences.`;

          const result = await this.llmManager.chat([
            { role: "user", content: prompt },
          ]);

          const responseText =
            typeof result === "string"
              ? result
              : result?.content || result?.message?.content || "";

          if (responseText.length > 10) {
            summary = responseText.substring(0, 1000);
          }
        } catch (llmError) {
          logger.warn("[MemoryGenerator] LLM conversation summary failed:", llmError.message);
        }
      }

      return {
        friendDid,
        startDate,
        endDate,
        messageCount: messages.length,
        summary,
      };
    } catch (error) {
      logger.error("[MemoryGenerator] Failed to summarize conversation:", error);
      throw error;
    }
  }

  /**
   * Save a memory to the social_memories table
   * @private
   * @param {Object} options - Memory options
   * @returns {Object} Saved memory
   */
  async _saveMemory({ memoryType, title, description, coverImage, relatedPosts, targetDate }) {
    const db = this.database.db;
    const memoryId = uuidv4();
    const now = Date.now();

    db.prepare(
      `INSERT INTO social_memories
       (id, memory_type, title, description, cover_image, related_posts, target_date, generated_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      memoryId,
      memoryType,
      title,
      description || null,
      coverImage || null,
      relatedPosts && relatedPosts.length > 0 ? JSON.stringify(relatedPosts) : null,
      targetDate || null,
      now,
    );

    return {
      id: memoryId,
      memory_type: memoryType,
      title,
      description,
      cover_image: coverImage,
      related_posts: relatedPosts || [],
      target_date: targetDate,
      generated_at: now,
      is_read: 0,
    };
  }

  /**
   * Extract the first media image from a set of snapshots
   * @private
   * @param {Array} snapshots
   * @returns {string|null}
   */
  _extractFirstImage(snapshots) {
    for (const s of snapshots) {
      if (s.media_urls) {
        try {
          const urls = typeof s.media_urls === "string" ? JSON.parse(s.media_urls) : s.media_urls;
          if (Array.isArray(urls) && urls.length > 0) {
            return urls[0];
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
    return null;
  }

  /**
   * Close the memory generator
   */
  async close() {
    logger.info("[MemoryGenerator] Closing memory generator");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  MemoryGenerator,
};
