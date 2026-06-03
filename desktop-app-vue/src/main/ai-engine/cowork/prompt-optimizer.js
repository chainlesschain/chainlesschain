/**
 * Prompt Optimizer — v2.1.0
 *
 * Self-optimization engine for skill prompts with A/B variant testing.
 * Tracks execution success/failure per prompt, generates improved variants,
 * and auto-selects the best-performing prompt for each skill.
 *
 * Uses SHA-256 prompt hashing for dedup and performance tracking.
 *
 * @module ai-engine/cowork/prompt-optimizer
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const MIN_EXECUTIONS_FOR_COMPARISON = 5;
const SUCCESS_RATE_IMPROVEMENT_THRESHOLD = 0.1;

// ============================================================
// PromptOptimizer
// ============================================================

class PromptOptimizer {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize with database
   * @param {Object} db - Database manager
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    this.initialized = true;

    const stats = this.getStats();
    logger.info(
      `[PromptOptimizer] Initialized: ${stats.totalExecutions} executions, ${stats.totalVariants} variants`,
    );
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_executions (
          id TEXT PRIMARY KEY,
          skill_name TEXT NOT NULL,
          prompt_hash TEXT,
          prompt_text TEXT,
          result_success INTEGER DEFAULT 0,
          execution_time_ms INTEGER DEFAULT 0,
          feedback TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_exec_skill ON prompt_executions(skill_name);
        CREATE INDEX IF NOT EXISTS idx_prompt_exec_hash ON prompt_executions(prompt_hash);

        CREATE TABLE IF NOT EXISTS prompt_variants (
          id TEXT PRIMARY KEY,
          skill_name TEXT NOT NULL,
          variant_name TEXT,
          prompt_text TEXT NOT NULL,
          success_rate REAL DEFAULT 0,
          use_count INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_variants_skill ON prompt_variants(skill_name);
        CREATE INDEX IF NOT EXISTS idx_prompt_variants_active ON prompt_variants(is_active);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[PromptOptimizer] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Execution Recording
  // ============================================================

  /**
   * Record a prompt execution
   * @param {Object} data - { skillName, promptText, resultSuccess, executionTimeMs, feedback }
   * @returns {Object} Recorded execution
   */
  recordExecution(data) {
    if (!data.skillName) {
      throw new Error("skillName is required");
    }

    const id = uuidv4();
    const promptHash = this._hashPrompt(data.promptText || "");
    const now = new Date().toISOString();

    const execution = {
      id,
      skillName: data.skillName,
      promptHash,
      promptText: data.promptText || null,
      resultSuccess: data.resultSuccess ? 1 : 0,
      executionTimeMs: data.executionTimeMs || 0,
      feedback: data.feedback || null,
      createdAt: now,
    };

    try {
      this.db.run(
        `INSERT INTO prompt_executions (id, skill_name, prompt_hash, prompt_text, result_success, execution_time_ms, feedback, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          execution.skillName,
          promptHash,
          execution.promptText,
          execution.resultSuccess,
          execution.executionTimeMs,
          execution.feedback,
          now,
        ],
      );

      // Update variant success rate if variant exists
      this._updateVariantSuccessRate(execution.skillName, promptHash);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
      return execution;
    } catch (e) {
      logger.error("[PromptOptimizer] recordExecution error:", e.message);
      throw e;
    }
  }

  // ============================================================
  // Variant Management
  // ============================================================

  /**
   * Create a prompt variant for a skill
   * @param {Object} data - { skillName, variantName, promptText }
   * @returns {Object} Created variant
   */
  createVariant(data) {
    if (!data.skillName || !data.promptText) {
      throw new Error("skillName and promptText are required");
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const variant = {
      id,
      skillName: data.skillName,
      variantName: data.variantName || `variant-${Date.now()}`,
      promptText: data.promptText,
      successRate: 0,
      useCount: 0,
      isActive: true,
      createdAt: now,
    };

    try {
      this.db.run(
        `INSERT INTO prompt_variants (id, skill_name, variant_name, prompt_text, success_rate, use_count, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          variant.skillName,
          variant.variantName,
          variant.promptText,
          0,
          0,
          1,
          now,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info(
        `[PromptOptimizer] Created variant: ${variant.variantName} for ${variant.skillName}`,
      );
      return variant;
    } catch (e) {
      logger.error("[PromptOptimizer] createVariant error:", e.message);
      throw e;
    }
  }

  /**
   * Get the currently best-performing active variant for a skill
   * @param {string} skillName - Skill name
   * @returns {Object|null} Best variant
   */
  getActiveVariant(skillName) {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM prompt_variants WHERE skill_name = ? AND is_active = 1
           ORDER BY success_rate DESC, use_count DESC LIMIT 1`,
        )
        .get(skillName);
      return row ? this._rowToVariant(row) : null;
    } catch (e) {
      logger.error("[PromptOptimizer] getActiveVariant error:", e.message);
      return null;
    }
  }

  /**
   * Get all variants for a skill
   * @param {string} skillName - Skill name
   * @returns {Array} Variants
   */
  getVariants(skillName) {
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM prompt_variants WHERE skill_name = ? ORDER BY success_rate DESC",
        )
        .all(skillName);
      return rows.map(this._rowToVariant);
    } catch (e) {
      logger.error("[PromptOptimizer] getVariants error:", e.message);
      return [];
    }
  }

  // ============================================================
  // Optimization
  // ============================================================

  /**
   * Analyze execution history and suggest an optimized prompt
   * @param {string} skillName - Skill to optimize
   * @returns {Object} Optimization result with suggestions
   */
  optimizePrompt(skillName) {
    try {
      // Get execution history grouped by prompt hash
      const hashStats = this.db
        .prepare(
          `SELECT prompt_hash, prompt_text,
                  COUNT(*) as total,
                  SUM(result_success) as successes,
                  AVG(execution_time_ms) as avg_time
           FROM prompt_executions
           WHERE skill_name = ?
           GROUP BY prompt_hash
           ORDER BY total DESC
           LIMIT 20`,
        )
        .all(skillName);

      if (hashStats.length === 0) {
        return {
          skillName,
          status: "no-data",
          message: "No execution history to analyze",
        };
      }

      // Calculate success rates
      const analyzed = hashStats.map((row) => ({
        promptHash: row.prompt_hash,
        promptText: row.prompt_text,
        total: row.total,
        successes: row.successes,
        successRate: row.total > 0 ? row.successes / row.total : 0,
        avgTime: Math.round(row.avg_time || 0),
      }));

      // Find best and worst
      const best = analyzed.reduce((a, b) =>
        a.successRate > b.successRate ? a : b,
      );
      const worst = analyzed.reduce((a, b) =>
        a.successRate < b.successRate ? a : b,
      );

      // Generate suggestions
      const suggestions = [];

      if (best.successRate < 0.5) {
        suggestions.push({
          type: "low-overall-success",
          message: `All prompts for "${skillName}" have low success rates (best: ${(best.successRate * 100).toFixed(0)}%). Consider revising the skill approach.`,
        });
      }

      if (
        analyzed.length > 1 &&
        best.successRate - worst.successRate >
          SUCCESS_RATE_IMPROVEMENT_THRESHOLD
      ) {
        suggestions.push({
          type: "variant-performance-gap",
          message: `Performance gap detected: best ${(best.successRate * 100).toFixed(0)}% vs worst ${(worst.successRate * 100).toFixed(0)}%. Deactivate low performers.`,
          bestHash: best.promptHash,
          worstHash: worst.promptHash,
        });
      }

      // Get feedback from failed executions
      const failures = this.db
        .prepare(
          `SELECT feedback FROM prompt_executions
           WHERE skill_name = ? AND result_success = 0 AND feedback IS NOT NULL
           ORDER BY created_at DESC LIMIT 5`,
        )
        .all(skillName);

      if (failures.length > 0) {
        suggestions.push({
          type: "failure-feedback",
          message: "Recent failure feedback available",
          feedback: failures.map((f) => f.feedback),
        });
      }

      return {
        skillName,
        status: "analyzed",
        variants: analyzed,
        best,
        suggestions,
      };
    } catch (e) {
      logger.error("[PromptOptimizer] optimizePrompt error:", e.message);
      return { skillName, status: "error", error: e.message };
    }
  }

  /**
   * Compare two variants' performance
   * @param {string} variantIdA - First variant ID
   * @param {string} variantIdB - Second variant ID
   * @returns {Object} Comparison result
   */
  compareVariants(variantIdA, variantIdB) {
    try {
      const a = this.db
        .prepare("SELECT * FROM prompt_variants WHERE id = ?")
        .get(variantIdA);
      const b = this.db
        .prepare("SELECT * FROM prompt_variants WHERE id = ?")
        .get(variantIdB);

      if (!a || !b) {
        return { error: "One or both variants not found" };
      }

      const va = this._rowToVariant(a);
      const vb = this._rowToVariant(b);

      const winner =
        va.successRate > vb.successRate
          ? va
          : vb.successRate > va.successRate
            ? vb
            : null;

      return {
        variantA: va,
        variantB: vb,
        winner: winner ? winner.id : "tie",
        successRateDiff: Math.abs(va.successRate - vb.successRate),
        sufficient:
          va.useCount >= MIN_EXECUTIONS_FOR_COMPARISON &&
          vb.useCount >= MIN_EXECUTIONS_FOR_COMPARISON,
      };
    } catch (e) {
      logger.error("[PromptOptimizer] compareVariants error:", e.message);
      return { error: e.message };
    }
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get optimizer statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const totalExecutions = this.db
        .prepare("SELECT COUNT(*) as count FROM prompt_executions")
        .get().count;
      const totalVariants = this.db
        .prepare("SELECT COUNT(*) as count FROM prompt_variants")
        .get().count;
      const activeVariants = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM prompt_variants WHERE is_active = 1",
        )
        .get().count;
      const skillsCovered = this.db
        .prepare(
          "SELECT COUNT(DISTINCT skill_name) as count FROM prompt_executions",
        )
        .get().count;
      const avgSuccessRate =
        this.db
          .prepare("SELECT AVG(result_success) as avg FROM prompt_executions")
          .get().avg || 0;

      return {
        totalExecutions,
        totalVariants,
        activeVariants,
        skillsCovered,
        avgSuccessRate: parseFloat(avgSuccessRate.toFixed(3)),
      };
    } catch (e) {
      logger.error("[PromptOptimizer] stats error:", e.message);
      return {
        totalExecutions: 0,
        totalVariants: 0,
        activeVariants: 0,
        skillsCovered: 0,
        avgSuccessRate: 0,
      };
    }
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  _hashPrompt(text) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  _updateVariantSuccessRate(skillName, promptHash) {
    try {
      // Find variant matching this prompt hash
      const variants = this.db
        .prepare("SELECT * FROM prompt_variants WHERE skill_name = ?")
        .all(skillName);

      for (const variant of variants) {
        const variantHash = this._hashPrompt(variant.prompt_text);
        if (variantHash === promptHash) {
          const stats = this.db
            .prepare(
              `SELECT COUNT(*) as total, SUM(result_success) as successes
               FROM prompt_executions WHERE skill_name = ? AND prompt_hash = ?`,
            )
            .get(skillName, promptHash);

          const successRate =
            stats.total > 0 ? stats.successes / stats.total : 0;

          this.db.run(
            "UPDATE prompt_variants SET success_rate = ?, use_count = ? WHERE id = ?",
            [successRate, stats.total, variant.id],
          );
          break;
        }
      }
    } catch (e) {
      // Non-critical
      logger.warn("[PromptOptimizer] Variant update error:", e.message);
    }
  }

  _rowToVariant(row) {
    return {
      id: row.id,
      skillName: row.skill_name,
      variantName: row.variant_name,
      promptText: row.prompt_text,
      successRate: row.success_rate,
      useCount: row.use_count,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    };
  }
}

// Singleton
let instance = null;

function getPromptOptimizer() {
  if (!instance) {
    instance = new PromptOptimizer();
  }
  return instance;
}

module.exports = {
  PromptOptimizer,
  getPromptOptimizer,
};
