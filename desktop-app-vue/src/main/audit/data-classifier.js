/**
 * Data Classifier
 *
 * Rule + LLM-based sensitive data detection:
 * - PII: name, ID, phone, email, address
 * - PHI: medical records, health data
 * - PCI: credit card numbers, CVV
 *
 * @module audit/data-classifier
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

// ============================================================
// Constants
// ============================================================

const DATA_CATEGORIES = {
  PII: "pii",
  PHI: "phi",
  PCI: "pci",
  GENERAL: "general",
};

const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  PHONE: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  SSN: /\b\d{3}-?\d{2}-?\d{4}\b/g,
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  IP_ADDRESS: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // Chinese ID
  CN_ID: /\b\d{17}[\dXx]\b/g,
  CN_PHONE: /\b1[3-9]\d{9}\b/g,
};

const PHI_KEYWORDS = [
  "diagnosis", "patient", "medical", "prescription", "treatment",
  "hospital", "clinic", "symptom", "blood", "medication",
  "allergy", "surgery", "health record", "lab result",
];

const SEVERITY_LEVELS = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

// ============================================================
// DataClassifier
// ============================================================

class DataClassifier extends EventEmitter {
  constructor(database, llmManager) {
    super();
    this.database = database;
    this.llmManager = llmManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[DataClassifier] Initializing data classifier...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[DataClassifier] Data classifier initialized");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) return;

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS data_classifications (
        id TEXT PRIMARY KEY,
        content_hash TEXT,
        content_preview TEXT,
        category TEXT NOT NULL,
        detections TEXT DEFAULT '[]',
        severity TEXT DEFAULT 'low',
        confidence REAL DEFAULT 0.0,
        source TEXT DEFAULT 'rule',
        context TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_data_class_category ON data_classifications(category);
      CREATE INDEX IF NOT EXISTS idx_data_class_severity ON data_classifications(severity);
      CREATE INDEX IF NOT EXISTS idx_data_class_hash ON data_classifications(content_hash);
    `);
  }

  /**
   * Classify content for sensitive data.
   * @param {string} content - Text content to classify
   * @param {Object} [options] - Classification options
   * @returns {Object} Classification result
   */
  async classify(content, options = {}) {
    try {
      if (!content || content.trim().length === 0) {
        return { category: DATA_CATEGORIES.GENERAL, detections: [], severity: SEVERITY_LEVELS.LOW };
      }

      const detections = [];
      let maxSeverity = SEVERITY_LEVELS.LOW;

      // Rule-based detection
      for (const [patternName, regex] of Object.entries(PII_PATTERNS)) {
        const regexCopy = new RegExp(regex.source, regex.flags);
        const matches = content.match(regexCopy);
        if (matches && matches.length > 0) {
          const severity = this._getPatternSeverity(patternName);
          detections.push({
            type: patternName,
            category: patternName === "CREDIT_CARD" ? DATA_CATEGORIES.PCI : DATA_CATEGORIES.PII,
            count: matches.length,
            severity,
            source: "rule",
          });
          if (this._compareSeverity(severity, maxSeverity) > 0) {
            maxSeverity = severity;
          }
        }
      }

      // PHI keyword detection
      const lowerContent = content.toLowerCase();
      const phiMatches = PHI_KEYWORDS.filter((kw) => lowerContent.includes(kw));
      if (phiMatches.length >= 2) {
        detections.push({
          type: "PHI_KEYWORDS",
          category: DATA_CATEGORIES.PHI,
          count: phiMatches.length,
          keywords: phiMatches,
          severity: SEVERITY_LEVELS.HIGH,
          source: "rule",
        });
        if (this._compareSeverity(SEVERITY_LEVELS.HIGH, maxSeverity) > 0) {
          maxSeverity = SEVERITY_LEVELS.HIGH;
        }
      }

      // Determine primary category
      let category = DATA_CATEGORIES.GENERAL;
      if (detections.some((d) => d.category === DATA_CATEGORIES.PCI)) {
        category = DATA_CATEGORIES.PCI;
      } else if (detections.some((d) => d.category === DATA_CATEGORIES.PHI)) {
        category = DATA_CATEGORIES.PHI;
      } else if (detections.some((d) => d.category === DATA_CATEGORIES.PII)) {
        category = DATA_CATEGORIES.PII;
      }

      const result = {
        category,
        detections,
        severity: maxSeverity,
        confidence: detections.length > 0 ? 0.85 : 0,
        detectionCount: detections.length,
        source: "rule",
      };

      // Save classification
      if (options.save !== false && detections.length > 0) {
        await this._saveClassification(content, result, options.context);
      }

      return result;
    } catch (error) {
      logger.error("[DataClassifier] Classification failed:", error);
      throw error;
    }
  }

  /**
   * Scan multiple content items in batch.
   * @param {Array<{id: string, content: string}>} items - Items to scan
   * @returns {Object} Batch scan results
   */
  async batchScan(items) {
    try {
      if (!Array.isArray(items)) return { results: [], summary: {} };

      const results = [];
      const summary = { total: items.length, pii: 0, phi: 0, pci: 0, clean: 0 };

      for (const item of items.slice(0, 100)) {
        const result = await this.classify(item.content || "", { save: false });
        results.push({ id: item.id, ...result });

        if (result.category === DATA_CATEGORIES.PII) summary.pii++;
        else if (result.category === DATA_CATEGORIES.PHI) summary.phi++;
        else if (result.category === DATA_CATEGORIES.PCI) summary.pci++;
        else summary.clean++;
      }

      return { results, summary };
    } catch (error) {
      logger.error("[DataClassifier] Batch scan failed:", error);
      throw error;
    }
  }

  /**
   * Get classification history.
   * @param {Object} [options] - Query options
   * @returns {Array} Classification records
   */
  async getHistory(options = {}) {
    try {
      if (!this.database || !this.database.db) return [];

      const limit = options.limit || 50;
      const category = options.category;

      if (category) {
        return this.database.db
          .prepare("SELECT * FROM data_classifications WHERE category = ? ORDER BY created_at DESC LIMIT ?")
          .all(category, limit);
      }

      return this.database.db
        .prepare("SELECT * FROM data_classifications ORDER BY created_at DESC LIMIT ?")
        .all(limit);
    } catch (error) {
      logger.error("[DataClassifier] Failed to get history:", error);
      return [];
    }
  }

  _getPatternSeverity(patternName) {
    const criticalPatterns = ["SSN", "CREDIT_CARD", "CN_ID"];
    const highPatterns = ["EMAIL", "PHONE", "CN_PHONE"];
    if (criticalPatterns.includes(patternName)) return SEVERITY_LEVELS.CRITICAL;
    if (highPatterns.includes(patternName)) return SEVERITY_LEVELS.HIGH;
    return SEVERITY_LEVELS.MEDIUM;
  }

  _compareSeverity(a, b) {
    const order = { low: 0, medium: 1, high: 2, critical: 3 };
    return (order[a] || 0) - (order[b] || 0);
  }

  async _saveClassification(content, result, context) {
    try {
      if (!this.database || !this.database.db) return;

      const contentHash = crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);

      this.database.db
        .prepare(
          `INSERT INTO data_classifications (id, content_hash, content_preview, category, detections, severity, confidence, source, context, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuidv4(),
          contentHash,
          content.substring(0, 100),
          result.category,
          JSON.stringify(result.detections),
          result.severity,
          result.confidence,
          result.source,
          context || null,
          Date.now(),
        );

      this.database.saveToFile();
    } catch (error) {
      logger.warn("[DataClassifier] Failed to save classification:", error.message);
    }
  }

  async close() {
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[DataClassifier] Closed");
  }
}

let _instance;
function getDataClassifier() {
  if (!_instance) _instance = new DataClassifier();
  return _instance;
}

export { DataClassifier, getDataClassifier, DATA_CATEGORIES, PII_PATTERNS, SEVERITY_LEVELS };
