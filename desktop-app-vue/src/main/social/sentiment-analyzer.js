/**
 * Sentiment Analyzer - Post sentiment scoring
 *
 * Provides keyword-based sentiment analysis for social posts,
 * emotion classification, and trend tracking.
 * No external LLM dependency required for basic analysis.
 *
 * @module social/sentiment-analyzer
 * @version 0.43.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Emotion types
 */
const Emotion = {
  JOY: "joy",
  SADNESS: "sadness",
  ANGER: "anger",
  FEAR: "fear",
  SURPRISE: "surprise",
  NEUTRAL: "neutral",
};

/**
 * Keyword dictionaries for sentiment analysis
 * @private
 */
const POSITIVE_KEYWORDS = [
  "happy", "great", "awesome", "wonderful", "love", "excellent", "amazing",
  "fantastic", "beautiful", "brilliant", "cheerful", "delighted", "enjoy",
  "excited", "glad", "good", "grateful", "incredible", "joyful", "lovely",
  "nice", "outstanding", "perfect", "pleased", "positive", "proud",
  "satisfied", "smile", "success", "superb", "thankful", "thrilled",
  "triumph", "win", "celebrate", "congratulations", "best", "fun",
  "laugh", "blessed", "hope", "kind", "warm",
];

const NEGATIVE_KEYWORDS = [
  "sad", "bad", "terrible", "awful", "hate", "horrible", "angry", "annoyed",
  "disappointed", "disgusted", "dreadful", "fail", "frustrated", "grief",
  "guilty", "helpless", "hurt", "lonely", "miserable", "nervous", "pain",
  "regret", "scared", "sorry", "stressed", "suffer", "ugly", "unhappy",
  "upset", "worried", "worse", "worst", "cry", "fear", "lost", "broken",
  "anxious", "depressed", "exhausted", "tired",
];

/**
 * Emotion keyword maps
 * @private
 */
const EMOTION_KEYWORDS = {
  [Emotion.JOY]: [
    "happy", "joy", "celebrate", "excited", "delighted", "love", "fun",
    "laugh", "smile", "cheerful", "grateful", "blessed", "thrilled", "enjoy",
  ],
  [Emotion.SADNESS]: [
    "sad", "cry", "grief", "lonely", "miss", "heartbroken", "depressed",
    "miserable", "sorry", "loss", "tears", "unhappy", "melancholy",
  ],
  [Emotion.ANGER]: [
    "angry", "furious", "rage", "hate", "annoyed", "frustrated", "mad",
    "irritated", "outraged", "disgusted", "hostile",
  ],
  [Emotion.FEAR]: [
    "afraid", "fear", "scared", "worried", "anxious", "nervous", "terrified",
    "panic", "dread", "horror", "alarmed",
  ],
  [Emotion.SURPRISE]: [
    "surprised", "shocked", "amazed", "astonished", "wow", "unexpected",
    "incredible", "unbelievable", "stunning", "startled",
  ],
};

/**
 * SentimentAnalyzer class
 */
class SentimentAnalyzer extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
  }

  /**
   * Initialize the sentiment analyzer
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info("[SentimentAnalyzer] Initializing sentiment analyzer...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[SentimentAnalyzer] Sentiment analyzer initialized successfully");
    } catch (error) {
      logger.error("[SentimentAnalyzer] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS sentiment_data (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL UNIQUE,
        sentiment_score REAL NOT NULL CHECK(sentiment_score >= -1 AND sentiment_score <= 1),
        emotion TEXT NOT NULL CHECK(emotion IN ('joy', 'sadness', 'anger', 'fear', 'surprise', 'neutral')),
        confidence REAL NOT NULL,
        analyzed_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sentiment_post ON sentiment_data(post_id);
      CREATE INDEX IF NOT EXISTS idx_sentiment_analyzed ON sentiment_data(analyzed_at);
      CREATE INDEX IF NOT EXISTS idx_sentiment_emotion ON sentiment_data(emotion);
    `);

    logger.info("[SentimentAnalyzer] Database tables initialized");
  }

  /**
   * Analyze sentiment of a single post
   * @param {string} postId - Post ID
   * @param {string} text - Post text content
   * @returns {Object} Sentiment analysis result
   */
  async analyzePost(postId, text) {
    try {
      if (!postId || !text) {
        throw new Error("Post ID and text are required");
      }

      const db = this.database.db;

      // Check if already analyzed
      const existing = db
        .prepare("SELECT * FROM sentiment_data WHERE post_id = ?")
        .get(postId);

      if (existing) {
        return existing;
      }

      // Perform analysis
      const result = this._analyzeSentiment(text);
      const sentimentId = uuidv4();
      const now = Date.now();

      db.prepare(
        `INSERT INTO sentiment_data
         (id, post_id, sentiment_score, emotion, confidence, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        sentimentId,
        postId,
        result.score,
        result.emotion,
        result.confidence,
        now,
      );

      const sentimentData = {
        id: sentimentId,
        post_id: postId,
        sentiment_score: result.score,
        emotion: result.emotion,
        confidence: result.confidence,
        analyzed_at: now,
      };

      this.emit("sentiment:analyzed", { postId, sentiment: sentimentData });
      return sentimentData;
    } catch (error) {
      logger.error("[SentimentAnalyzer] Failed to analyze post:", error);
      throw error;
    }
  }

  /**
   * Analyze sentiment of multiple posts in batch
   * @param {Array<{id: string, text: string}>} posts - Array of posts with id and text
   * @returns {Array} Analysis results
   */
  async analyzeBatch(posts) {
    try {
      if (!Array.isArray(posts) || posts.length === 0) {
        return [];
      }

      const results = [];

      for (const post of posts) {
        try {
          const result = await this.analyzePost(post.id, post.text);
          results.push(result);
        } catch (err) {
          logger.warn("[SentimentAnalyzer] Failed to analyze post in batch:", post.id, err.message);
          results.push({
            post_id: post.id,
            sentiment_score: 0,
            emotion: Emotion.NEUTRAL,
            confidence: 0,
            error: err.message,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("[SentimentAnalyzer] Batch analysis failed:", error);
      throw error;
    }
  }

  /**
   * Get sentiment trend over a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Sentiment trend data points
   */
  async getSentimentTrend(startDate, endDate) {
    try {
      const db = this.database.db;
      const startTs = new Date(startDate).getTime();
      const endTs = new Date(endDate + "T23:59:59").getTime();

      const rows = db
        .prepare(
          `SELECT
             DATE(analyzed_at / 1000, 'unixepoch') as date,
             AVG(sentiment_score) as avg_score,
             COUNT(*) as count,
             MIN(sentiment_score) as min_score,
             MAX(sentiment_score) as max_score
           FROM sentiment_data
           WHERE analyzed_at >= ? AND analyzed_at <= ?
           GROUP BY DATE(analyzed_at / 1000, 'unixepoch')
           ORDER BY date ASC`,
        )
        .all(startTs, endTs);

      return rows.map((r) => ({
        date: r.date,
        avgScore: Math.round(r.avg_score * 1000) / 1000,
        count: r.count,
        minScore: Math.round(r.min_score * 1000) / 1000,
        maxScore: Math.round(r.max_score * 1000) / 1000,
      }));
    } catch (error) {
      logger.error("[SentimentAnalyzer] Failed to get sentiment trend:", error);
      throw error;
    }
  }

  /**
   * Get emotion distribution over a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Object} Emotion distribution with counts and percentages
   */
  async getEmotionDistribution(startDate, endDate) {
    try {
      const db = this.database.db;
      const startTs = new Date(startDate).getTime();
      const endTs = new Date(endDate + "T23:59:59").getTime();

      const rows = db
        .prepare(
          `SELECT emotion, COUNT(*) as count
           FROM sentiment_data
           WHERE analyzed_at >= ? AND analyzed_at <= ?
           GROUP BY emotion
           ORDER BY count DESC`,
        )
        .all(startTs, endTs);

      const total = rows.reduce((sum, r) => sum + r.count, 0);

      const distribution = {};
      for (const row of rows) {
        distribution[row.emotion] = {
          count: row.count,
          percentage: total > 0 ? Math.round((row.count / total) * 10000) / 100 : 0,
        };
      }

      // Ensure all emotions are represented
      for (const emotion of Object.values(Emotion)) {
        if (!distribution[emotion]) {
          distribution[emotion] = { count: 0, percentage: 0 };
        }
      }

      return {
        total,
        distribution,
        startDate,
        endDate,
      };
    } catch (error) {
      logger.error("[SentimentAnalyzer] Failed to get emotion distribution:", error);
      throw error;
    }
  }

  /**
   * Get average sentiment for a period
   * @param {string} period - Period identifier ('day', 'week', 'month', 'year')
   * @returns {Object} Average sentiment data
   */
  async getAverageSentiment(period) {
    try {
      const db = this.database.db;
      const now = new Date();
      let startTs;

      switch (period) {
        case "day":
          startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          break;
        case "week":
          startTs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
          break;
        case "month":
          startTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          break;
        case "year":
          startTs = new Date(now.getFullYear(), 0, 1).getTime();
          break;
        default:
          startTs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      }

      const row = db
        .prepare(
          `SELECT
             AVG(sentiment_score) as avg_score,
             COUNT(*) as count,
             MIN(sentiment_score) as min_score,
             MAX(sentiment_score) as max_score
           FROM sentiment_data
           WHERE analyzed_at >= ?`,
        )
        .get(startTs);

      // Find dominant emotion
      const emotionRow = db
        .prepare(
          `SELECT emotion, COUNT(*) as count
           FROM sentiment_data
           WHERE analyzed_at >= ?
           GROUP BY emotion
           ORDER BY count DESC
           LIMIT 1`,
        )
        .get(startTs);

      return {
        period,
        averageScore: row?.avg_score != null ? Math.round(row.avg_score * 1000) / 1000 : 0,
        totalAnalyzed: row?.count || 0,
        minScore: row?.min_score != null ? Math.round(row.min_score * 1000) / 1000 : 0,
        maxScore: row?.max_score != null ? Math.round(row.max_score * 1000) / 1000 : 0,
        dominantEmotion: emotionRow?.emotion || Emotion.NEUTRAL,
      };
    } catch (error) {
      logger.error("[SentimentAnalyzer] Failed to get average sentiment:", error);
      throw error;
    }
  }

  /**
   * Perform keyword-based sentiment analysis
   * @private
   * @param {string} text - Text to analyze
   * @returns {Object} { score, emotion, confidence }
   */
  _analyzeSentiment(text) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
    const totalWords = words.length;

    if (totalWords === 0) {
      return { score: 0, emotion: Emotion.NEUTRAL, confidence: 0 };
    }

    // Count positive and negative keyword hits
    let positiveHits = 0;
    let negativeHits = 0;

    for (const word of words) {
      if (POSITIVE_KEYWORDS.includes(word)) {positiveHits++;}
      if (NEGATIVE_KEYWORDS.includes(word)) {negativeHits++;}
    }

    // Calculate sentiment score (-1 to 1)
    const totalHits = positiveHits + negativeHits;
    let score = 0;

    if (totalHits > 0) {
      score = (positiveHits - negativeHits) / totalHits;
    }

    // Clamp score
    score = Math.max(-1, Math.min(1, score));

    // Calculate confidence based on keyword density
    const keywordDensity = totalHits / totalWords;
    const confidence = Math.min(1, keywordDensity * 5); // Scale up to max 1

    // Determine emotion
    const emotion = this._detectEmotion(words);

    return {
      score: Math.round(score * 1000) / 1000,
      emotion,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  /**
   * Detect dominant emotion from words
   * @private
   * @param {Array<string>} words - Tokenized words
   * @returns {string} Detected emotion
   */
  _detectEmotion(words) {
    const emotionScores = {};

    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
      emotionScores[emotion] = 0;
      for (const word of words) {
        if (keywords.includes(word)) {
          emotionScores[emotion]++;
        }
      }
    }

    // Find the emotion with highest score
    let maxEmotion = Emotion.NEUTRAL;
    let maxScore = 0;

    for (const [emotion, score] of Object.entries(emotionScores)) {
      if (score > maxScore) {
        maxScore = score;
        maxEmotion = emotion;
      }
    }

    return maxEmotion;
  }

  /**
   * Close the sentiment analyzer
   */
  async close() {
    logger.info("[SentimentAnalyzer] Closing sentiment analyzer");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  SentimentAnalyzer,
  Emotion,
};
