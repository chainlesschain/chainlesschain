/**
 * Content Moderator
 * AI-powered content moderation for community messages and posts.
 * Provides content analysis, reporting, and moderation log management.
 *
 * @module content-moderator
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Content type constants
 */
const ContentType = {
  MESSAGE: "message",
  POST: "post",
  COMMENT: "comment",
};

/**
 * Moderation action constants
 */
const ModerationAction = {
  APPROVED: "approved",
  REMOVED: "removed",
  WARNING: "warning",
  ESCALATED: "escalated",
};

/**
 * Moderation status constants
 */
const ModerationStatus = {
  PENDING: "pending",
  REVIEWED: "reviewed",
  RESOLVED: "resolved",
};

/**
 * Harmful content categories
 */
const HarmCategories = {
  SPAM: "spam",
  HARASSMENT: "harassment",
  HATE_SPEECH: "hate_speech",
  VIOLENCE: "violence",
  SEXUAL: "sexual",
  MISINFORMATION: "misinformation",
  SELF_HARM: "self_harm",
  ILLEGAL: "illegal",
};

/**
 * Keyword-based content patterns for offline analysis
 */
const HARMFUL_PATTERNS = {
  [HarmCategories.SPAM]: [
    /(?:buy|sell|discount|free|click|subscribe|promo)\s+(?:now|today|here)/i,
    /(?:http|https):\/\/[^\s]+(?:\.xyz|\.tk|\.ml|\.cf)/i,
    /(?:\$\$\$|earn\s+money|make\s+money|get\s+rich)/i,
  ],
  [HarmCategories.HARASSMENT]: [
    /(?:you\s+are|you're)\s+(?:stupid|dumb|idiot|loser|worthless)/i,
    /(?:kill\s+yourself|go\s+die|nobody\s+likes\s+you)/i,
  ],
  [HarmCategories.HATE_SPEECH]: [
    /(?:all\s+\w+\s+(?:should|must|need\s+to)\s+(?:die|leave|go\s+back))/i,
  ],
  [HarmCategories.VIOLENCE]: [
    /(?:i\s+will|gonna|going\s+to)\s+(?:kill|hurt|beat|attack|destroy)/i,
  ],
};

/**
 * Scoring thresholds
 */
const SCORE_THRESHOLDS = {
  SAFE: 0.3,
  WARNING: 0.6,
  REMOVE: 0.85,
};

class ContentModerator extends EventEmitter {
  constructor(database, didManager) {
    super();

    this.database = database;
    this.didManager = didManager;

    // Optional AI service for enhanced analysis
    this.aiService = null;

    this.initialized = false;
  }

  /**
   * Initialize the content moderator
   */
  async initialize() {
    logger.info("[ContentModerator] Initializing content moderator...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[ContentModerator] Content moderator initialized successfully");
    } catch (error) {
      logger.error("[ContentModerator] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Set the AI service for enhanced content analysis
   * @param {Object} aiService - AI service instance
   */
  setAIService(aiService) {
    this.aiService = aiService;
    logger.info("[ContentModerator] AI service connected");
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS moderation_log (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL,
        content_id TEXT NOT NULL,
        content_type TEXT CHECK(content_type IN ('message', 'post', 'comment')),
        reporter_did TEXT,
        moderator_did TEXT,
        action TEXT CHECK(action IN ('approved', 'removed', 'warning', 'escalated')),
        reason TEXT,
        ai_score REAL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved')),
        created_at INTEGER,
        resolved_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_moderation_community ON moderation_log(community_id);
      CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_log(status);
      CREATE INDEX IF NOT EXISTS idx_moderation_content ON moderation_log(content_id);
      CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_log(created_at DESC);
    `);

    logger.info("[ContentModerator] Database tables initialized");
  }

  /**
   * Get the current user DID
   */
  getCurrentDid() {
    return this.didManager?.getCurrentIdentity()?.did || null;
  }

  /**
   * Analyze content for potential violations
   * Uses keyword-based local analysis with optional AI enhancement.
   *
   * @param {string} text - Content text to analyze
   * @returns {Object} Analysis result: { safe: boolean, categories: string[], score: number }
   */
  async analyzeContent(text) {
    if (!text || text.trim().length === 0) {
      return { safe: true, categories: [], score: 0 };
    }

    try {
      const detectedCategories = [];
      let maxScore = 0;

      // Local keyword-based analysis
      for (const [category, patterns] of Object.entries(HARMFUL_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            if (!detectedCategories.includes(category)) {
              detectedCategories.push(category);
            }
            // Increase score based on number of matches
            const matches = text.match(pattern);
            const matchScore = Math.min(0.3 + (matches ? matches.length : 1) * 0.2, 1.0);
            maxScore = Math.max(maxScore, matchScore);
          }
        }
      }

      // Additional heuristic checks
      const upperRatio = (text.replace(/[^A-Z]/g, "").length) / Math.max(text.length, 1);
      if (upperRatio > 0.7 && text.length > 20) {
        // Excessive caps is often aggressive
        maxScore = Math.max(maxScore, 0.3);
        if (!detectedCategories.includes("aggressive_tone")) {
          detectedCategories.push("aggressive_tone");
        }
      }

      // Check for repeated characters (spam indicator)
      if (/(.)\1{9,}/.test(text)) {
        maxScore = Math.max(maxScore, 0.4);
        if (!detectedCategories.includes(HarmCategories.SPAM)) {
          detectedCategories.push(HarmCategories.SPAM);
        }
      }

      // If AI service is available, enhance the analysis
      if (this.aiService) {
        try {
          const aiResult = await this.aiAnalyzeContent(text);
          if (aiResult) {
            maxScore = Math.max(maxScore, aiResult.score || 0);
            for (const cat of aiResult.categories || []) {
              if (!detectedCategories.includes(cat)) {
                detectedCategories.push(cat);
              }
            }
          }
        } catch (error) {
          logger.warn("[ContentModerator] AI analysis failed, using local result:", error.message);
        }
      }

      const safe = maxScore < SCORE_THRESHOLDS.SAFE;

      return {
        safe,
        categories: detectedCategories,
        score: Math.round(maxScore * 100) / 100,
      };
    } catch (error) {
      logger.error("[ContentModerator] Content analysis failed:", error);
      // Default to safe on analysis failure
      return { safe: true, categories: [], score: 0 };
    }
  }

  /**
   * AI-based content analysis (if AI service available)
   * @param {string} text - Content text
   * @returns {Object|null} AI analysis result
   */
  async aiAnalyzeContent(text) {
    if (!this.aiService) {
      return null;
    }

    try {
      const prompt = `Analyze the following text for harmful content. Return a JSON object with:
- score: number 0-1 (0=safe, 1=very harmful)
- categories: array of categories found (spam, harassment, hate_speech, violence, sexual, misinformation)

Text: "${text.substring(0, 500)}"

Respond with JSON only.`;

      const response = await this.aiService.chat(prompt, { maxTokens: 200 });
      if (response) {
        try {
          const parsed = JSON.parse(response);
          return {
            score: Math.min(Math.max(parsed.score || 0, 0), 1),
            categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          };
        } catch (parseError) {
          return null;
        }
      }
      return null;
    } catch (error) {
      logger.warn("[ContentModerator] AI analysis request failed:", error.message);
      return null;
    }
  }

  /**
   * Report content for moderation
   * @param {Object} options - Report options
   * @param {string} options.communityId - Community ID
   * @param {string} options.contentId - Content ID being reported
   * @param {string} options.contentType - Content type ('message', 'post', 'comment')
   * @param {string} options.reason - Reason for reporting
   * @param {string} options.contentText - Optional content text for auto-analysis
   */
  async reportContent({ communityId, contentId, contentType, reason = "", contentText = "" }) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      // Check for duplicate reports
      const existing = db.prepare(
        "SELECT * FROM moderation_log WHERE content_id = ? AND reporter_did = ? AND status != 'resolved'",
      ).get(contentId, currentDid);

      if (existing) {
        throw new Error("You have already reported this content");
      }

      // Auto-analyze if content text provided
      let aiScore = null;
      if (contentText) {
        const analysis = await this.analyzeContent(contentText);
        aiScore = analysis.score;
      }

      const reportId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO moderation_log (
          id, community_id, content_id, content_type, reporter_did,
          moderator_did, action, reason, ai_score, status, created_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        communityId,
        contentId,
        contentType,
        currentDid,
        null,
        null,
        reason,
        aiScore,
        ModerationStatus.PENDING,
        now,
        null,
      );

      this.database.saveToFile();

      logger.info("[ContentModerator] Content reported:", contentId, "by:", currentDid);
      this.emit("content:reported", { reportId, communityId, contentId, contentType });

      return { success: true, reportId, aiScore };
    } catch (error) {
      logger.error("[ContentModerator] Failed to report content:", error);
      throw error;
    }
  }

  /**
   * Review a content report (moderator action)
   * @param {string} reportId - Report ID
   * @param {string} action - Moderation action ('approved', 'removed', 'warning', 'escalated')
   * @param {string} reason - Optional reason for the action
   */
  async reviewReport(reportId, action, reason = "") {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!Object.values(ModerationAction).includes(action)) {
      throw new Error("Invalid moderation action");
    }

    try {
      const db = this.database.db;

      const report = db.prepare("SELECT * FROM moderation_log WHERE id = ?").get(reportId);
      if (!report) {
        throw new Error("Report not found");
      }

      if (report.status === ModerationStatus.RESOLVED) {
        throw new Error("Report has already been resolved");
      }

      // Check moderator permissions
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(report.community_id, currentDid);

      if (!member ||
        (member.role !== "owner" && member.role !== "admin" && member.role !== "moderator")) {
        throw new Error("Insufficient permissions to review reports");
      }

      const now = Date.now();
      const newStatus = action === ModerationAction.ESCALATED
        ? ModerationStatus.REVIEWED
        : ModerationStatus.RESOLVED;

      db.prepare(`
        UPDATE moderation_log
        SET moderator_did = ?, action = ?, reason = ?,
            status = ?, resolved_at = ?
        WHERE id = ?
      `).run(
        currentDid,
        action,
        reason || report.reason,
        newStatus,
        newStatus === ModerationStatus.RESOLVED ? now : null,
        reportId,
      );

      this.database.saveToFile();

      logger.info("[ContentModerator] Report reviewed:", reportId, "Action:", action);
      this.emit("report:reviewed", {
        reportId,
        action,
        moderatorDid: currentDid,
        contentId: report.content_id,
      });

      return { success: true };
    } catch (error) {
      logger.error("[ContentModerator] Failed to review report:", error);
      throw error;
    }
  }

  /**
   * Get moderation log for a community
   * @param {string} communityId - Community ID
   * @param {Object} options - Query options
   */
  async getModerationLog(communityId, { status = null, limit = 50, offset = 0 } = {}) {
    try {
      const db = this.database.db;

      let query = `
        SELECT ml.*, c_reporter.nickname as reporter_nickname, c_mod.nickname as moderator_nickname
        FROM moderation_log ml
        LEFT JOIN contacts c_reporter ON ml.reporter_did = c_reporter.did
        LEFT JOIN contacts c_mod ON ml.moderator_did = c_mod.did
        WHERE ml.community_id = ?
      `;
      const params = [communityId];

      if (status) {
        query += " AND ml.status = ?";
        params.push(status);
      }

      query += " ORDER BY ml.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const logs = db.prepare(query).all(...params);
      return logs || [];
    } catch (error) {
      logger.error("[ContentModerator] Failed to get moderation log:", error);
      return [];
    }
  }

  /**
   * Get moderation statistics for a community
   * @param {string} communityId - Community ID
   */
  async getStats(communityId) {
    try {
      const db = this.database.db;

      const total = db.prepare(
        "SELECT COUNT(*) as count FROM moderation_log WHERE community_id = ?",
      ).get(communityId);

      const byStatus = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM moderation_log
        WHERE community_id = ?
        GROUP BY status
      `).all(communityId);

      const byAction = db.prepare(`
        SELECT action, COUNT(*) as count
        FROM moderation_log
        WHERE community_id = ? AND action IS NOT NULL
        GROUP BY action
      `).all(communityId);

      const avgScore = db.prepare(`
        SELECT AVG(ai_score) as avg_score
        FROM moderation_log
        WHERE community_id = ? AND ai_score IS NOT NULL
      `).get(communityId);

      const recentReports = db.prepare(`
        SELECT COUNT(*) as count
        FROM moderation_log
        WHERE community_id = ? AND created_at > ?
      `).get(communityId, Date.now() - 24 * 60 * 60 * 1000);

      return {
        total: total?.count || 0,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
        byAction: Object.fromEntries(byAction.map((r) => [r.action, r.count])),
        averageAiScore: avgScore?.avg_score ? Math.round(avgScore.avg_score * 100) / 100 : null,
        reportsLast24h: recentReports?.count || 0,
      };
    } catch (error) {
      logger.error("[ContentModerator] Failed to get stats:", error);
      return {
        total: 0,
        byStatus: {},
        byAction: {},
        averageAiScore: null,
        reportsLast24h: 0,
      };
    }
  }

  /**
   * Clean up resources
   */
  async close() {
    logger.info("[ContentModerator] Closing content moderator");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  ContentModerator,
  ContentType,
  ModerationAction,
  ModerationStatus,
  HarmCategories,
  SCORE_THRESHOLDS,
};
