/**
 * Topic Analyzer
 *
 * Extracts topics, sentiment, and trending analysis from social content
 * using LLM-based analysis with template fallbacks.
 *
 * @module social/topic-analyzer
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const SENTIMENT = {
  POSITIVE: "positive",
  NEGATIVE: "negative",
  NEUTRAL: "neutral",
  MIXED: "mixed",
};

const TOPIC_CATEGORIES = {
  TECHNOLOGY: "technology",
  SOCIAL: "social",
  BUSINESS: "business",
  SCIENCE: "science",
  CULTURE: "culture",
  GENERAL: "general",
};

// ============================================================
// TopicAnalyzer
// ============================================================

class TopicAnalyzer extends EventEmitter {
  constructor(database, llmManager) {
    super();
    this.database = database;
    this.llmManager = llmManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[TopicAnalyzer] Initializing topic analyzer...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[TopicAnalyzer] Topic analyzer initialized successfully");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[TopicAnalyzer] Database not available, skipping table creation");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_analyses (
        id TEXT PRIMARY KEY,
        content_id TEXT,
        content_type TEXT DEFAULT 'post',
        topics TEXT DEFAULT '[]',
        sentiment TEXT DEFAULT 'neutral',
        sentiment_score REAL DEFAULT 0.0,
        category TEXT DEFAULT 'general',
        keywords TEXT DEFAULT '[]',
        summary TEXT,
        language TEXT DEFAULT 'en',
        source TEXT DEFAULT 'template',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_content ON topic_analyses(content_id);
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_category ON topic_analyses(category);
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_created ON topic_analyses(created_at DESC);
    `);
  }

  _isLLMAvailable() {
    return !!(this.llmManager && this.llmManager.isInitialized);
  }

  async _llmChat(systemPrompt, userMessage) {
    try {
      if (!this._isLLMAvailable()) return null;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ];

      const result = await this.llmManager.chat(messages, {
        temperature: 0.3,
        maxTokens: 1024,
      });

      if (result && result.content) {
        return typeof result.content === "string"
          ? result.content
          : result.content.toString();
      }
      return null;
    } catch (error) {
      logger.warn("[TopicAnalyzer] LLM chat failed:", error.message);
      return null;
    }
  }

  /**
   * Extract topics from content.
   * @param {string} content - Text content to analyze
   * @param {Object} [options] - Analysis options
   * @returns {Object} Topic analysis result
   */
  async analyzeTopics(content, options = {}) {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error("Content is required");
      }

      const systemPrompt = `You are a topic extraction engine. Analyze the given text and return a JSON object with:
- "topics": array of topic strings (max 5)
- "sentiment": one of "positive", "negative", "neutral", "mixed"
- "sentimentScore": number from -1.0 to 1.0
- "category": one of "technology", "social", "business", "science", "culture", "general"
- "keywords": array of keyword strings (max 8)
- "summary": one-sentence summary
Reply with ONLY valid JSON, no markdown.`;

      const llmResult = await this._llmChat(systemPrompt, content.trim());

      if (llmResult) {
        try {
          const parsed = JSON.parse(llmResult.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
          const analysis = {
            topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 5) : [],
            sentiment: parsed.sentiment || SENTIMENT.NEUTRAL,
            sentimentScore: typeof parsed.sentimentScore === "number" ? parsed.sentimentScore : 0,
            category: parsed.category || TOPIC_CATEGORIES.GENERAL,
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
            summary: parsed.summary || "",
            source: "llm",
          };

          if (options.contentId) {
            await this._saveAnalysis(options.contentId, options.contentType || "post", analysis);
          }

          return analysis;
        } catch (parseError) {
          logger.warn("[TopicAnalyzer] Failed to parse LLM JSON:", parseError.message);
        }
      }

      // Fallback: simple keyword extraction
      const words = content.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
      const wordFreq = {};
      for (const word of words) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
      const topWords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);

      const analysis = {
        topics: topWords.slice(0, 3),
        sentiment: SENTIMENT.NEUTRAL,
        sentimentScore: 0,
        category: TOPIC_CATEGORIES.GENERAL,
        keywords: topWords,
        summary: content.trim().substring(0, 100) + (content.length > 100 ? "..." : ""),
        source: "template",
      };

      if (options.contentId) {
        await this._saveAnalysis(options.contentId, options.contentType || "post", analysis);
      }

      return analysis;
    } catch (error) {
      logger.error("[TopicAnalyzer] Failed to analyze topics:", error);
      throw error;
    }
  }

  /**
   * Get trending topics from recent analyses.
   * @param {Object} [options] - Query options
   * @param {number} [options.limit=10] - Max topics to return
   * @param {number} [options.sinceMs] - Time window in milliseconds
   * @returns {Array} Trending topics
   */
  async getTrendingTopics(options = {}) {
    try {
      const limit = options.limit || 10;
      const sinceMs = options.sinceMs || 24 * 60 * 60 * 1000; // 24 hours
      const since = Date.now() - sinceMs;

      if (!this.database || !this.database.db) {
        return [];
      }

      const rows = this.database.db
        .prepare(
          `SELECT topics FROM topic_analyses WHERE created_at > ? ORDER BY created_at DESC LIMIT 100`,
        )
        .all(since);

      const topicCounts = {};
      for (const row of rows) {
        try {
          const topics = JSON.parse(row.topics || "[]");
          for (const topic of topics) {
            const key = topic.toLowerCase().trim();
            if (key) {
              topicCounts[key] = (topicCounts[key] || 0) + 1;
            }
          }
        } catch (_) {
          // skip malformed
        }
      }

      return Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([topic, count]) => ({ topic, count }));
    } catch (error) {
      logger.error("[TopicAnalyzer] Failed to get trending topics:", error);
      return [];
    }
  }

  /**
   * Analyze sentiment of a batch of contents.
   * @param {Array<string>} contents - Array of text contents
   * @returns {Object} Aggregate sentiment
   */
  async batchSentiment(contents) {
    try {
      if (!Array.isArray(contents) || contents.length === 0) {
        return { average: 0, distribution: { positive: 0, negative: 0, neutral: 0, mixed: 0 } };
      }

      const results = [];
      for (const content of contents.slice(0, 20)) {
        const analysis = await this.analyzeTopics(content);
        results.push(analysis);
      }

      const distribution = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
      let totalScore = 0;

      for (const r of results) {
        distribution[r.sentiment] = (distribution[r.sentiment] || 0) + 1;
        totalScore += r.sentimentScore;
      }

      return {
        average: results.length > 0 ? totalScore / results.length : 0,
        distribution,
        count: results.length,
      };
    } catch (error) {
      logger.error("[TopicAnalyzer] Batch sentiment failed:", error);
      throw error;
    }
  }

  async _saveAnalysis(contentId, contentType, analysis) {
    try {
      if (!this.database || !this.database.db) return;

      const id = uuidv4();

      this.database.db
        .prepare(
          `INSERT INTO topic_analyses (id, content_id, content_type, topics, sentiment, sentiment_score, category, keywords, summary, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          contentId,
          contentType,
          JSON.stringify(analysis.topics),
          analysis.sentiment,
          analysis.sentimentScore,
          analysis.category,
          JSON.stringify(analysis.keywords),
          analysis.summary,
          analysis.source,
          Date.now(),
        );

      this.database.saveToFile();
    } catch (error) {
      logger.warn("[TopicAnalyzer] Failed to save analysis:", error.message);
    }
  }

  /**
   * Get analysis history for a content item.
   * @param {string} contentId - Content identifier
   * @returns {Array} Analysis history
   */
  async getAnalysisHistory(contentId) {
    try {
      if (!this.database || !this.database.db) return [];

      return this.database.db
        .prepare(
          `SELECT * FROM topic_analyses WHERE content_id = ? ORDER BY created_at DESC LIMIT 10`,
        )
        .all(contentId);
    } catch (error) {
      logger.error("[TopicAnalyzer] Failed to get analysis history:", error);
      return [];
    }
  }

  async close() {
    logger.info("[TopicAnalyzer] Closing topic analyzer");
    this.removeAllListeners();
    this.initialized = false;
  }
}

let _instance;
function getTopicAnalyzer() {
  if (!_instance) _instance = new TopicAnalyzer();
  return _instance;
}

export { TopicAnalyzer, getTopicAnalyzer, SENTIMENT, TOPIC_CATEGORIES };
