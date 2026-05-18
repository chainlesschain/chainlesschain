/**
 * Content Quality Assessor
 * AI harmful content detection and quality scoring
 * @module social/content-quality-assessor
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

const QUALITY_LEVEL = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  HARMFUL: "harmful",
};

class ContentQualityAssessor {
  constructor(database) {
    this.database = database;
    this._assessments = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS content_quality_scores (
        id TEXT PRIMARY KEY,
        content_id TEXT,
        content_hash TEXT,
        quality_level TEXT DEFAULT 'medium',
        quality_score REAL DEFAULT 0.5,
        harmful_detected INTEGER DEFAULT 0,
        categories TEXT,
        reviewer_count INTEGER DEFAULT 0,
        consensus_reached INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_quality_scores_level ON content_quality_scores(quality_level);
      CREATE INDEX IF NOT EXISTS idx_quality_scores_content ON content_quality_scores(content_id);
    `);
  }

  async initialize() {
    logger.info("[ContentQualityAssessor] Initializing...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[ContentQualityAssessor] Initialized");
  }

  async assessQuality({ contentId, content } = {}) {
    if (!content) {
      throw new Error("Content is required");
    }
    const id = uuidv4();
    // Simulate AI quality assessment
    const score = 0.5 + Math.random() * 0.5;
    const harmful = score < 0.3;
    const level = harmful
      ? QUALITY_LEVEL.HARMFUL
      : score > 0.8
        ? QUALITY_LEVEL.HIGH
        : score > 0.5
          ? QUALITY_LEVEL.MEDIUM
          : QUALITY_LEVEL.LOW;
    const assessment = {
      id,
      content_id: contentId || uuidv4(),
      content_hash: `hash_${id.slice(0, 8)}`,
      quality_level: level,
      quality_score: score,
      harmful_detected: harmful ? 1 : 0,
      categories: JSON.stringify(["general"]),
      reviewer_count: 1,
      consensus_reached: 1,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO content_quality_scores (id,content_id,content_hash,quality_level,quality_score,harmful_detected,categories,reviewer_count,consensus_reached,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          assessment.content_id,
          assessment.content_hash,
          level,
          score,
          assessment.harmful_detected,
          assessment.categories,
          1,
          1,
          assessment.created_at,
        );
    }
    this._assessments.set(id, assessment);
    return assessment;
  }

  async getQualityReport(_filter = {}) {
    const assessments = Array.from(this._assessments.values());
    return {
      total: assessments.length,
      high: assessments.filter((a) => a.quality_level === QUALITY_LEVEL.HIGH)
        .length,
      medium: assessments.filter(
        (a) => a.quality_level === QUALITY_LEVEL.MEDIUM,
      ).length,
      low: assessments.filter((a) => a.quality_level === QUALITY_LEVEL.LOW)
        .length,
      harmful: assessments.filter(
        (a) => a.quality_level === QUALITY_LEVEL.HARMFUL,
      ).length,
      avgScore:
        assessments.length > 0
          ? assessments.reduce((s, a) => s + a.quality_score, 0) /
            assessments.length
          : 0,
    };
  }

  async close() {
    this._assessments.clear();
    logger.info("[ContentQualityAssessor] Closed");
  }
}

let _instance = null;
function getContentQualityAssessor(database) {
  if (!_instance) {
    _instance = new ContentQualityAssessor(database);
  }
  return _instance;
}

export { ContentQualityAssessor, getContentQualityAssessor, QUALITY_LEVEL };
export default ContentQualityAssessor;
