/**
 * EvoMap Gene Synthesizer
 *
 * Converts local ChainlessChain knowledge artifacts (instincts, decisions,
 * workflows, skills) into GEP-A2A Gene+Capsule bundles for publication
 * to the EvoMap Hub.
 *
 * @module evomap/evomap-gene-synthesizer
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EvoMapClient } = require("./evomap-client.js");

/**
 * Instinct category → Gene category mapping
 */
const CATEGORY_MAP = {
  "error-fix": "repair",
  "coding-pattern": "optimize",
  style: "optimize",
  architecture: "optimize",
  "tool-preference": "optimize",
  workflow: "innovate",
  testing: "innovate",
  general: "optimize",
};

/**
 * Patterns that indicate potential secrets (never publish these)
 */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /(?:token|auth[_-]?token|access[_-]?token)\s*[:=]\s*\S+/gi,
  /(?:Bearer|Basic)\s+[A-Za-z0-9+/=]+/g,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
  /sk[-_][a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
];

/**
 * EvoMapGeneSynthesizer - Converts local knowledge to GEP assets
 */
class EvoMapGeneSynthesizer {
  constructor() {
    this.db = null;
    this.instinctManager = null;
    this.decisionKB = null;
    this.promptOptimizer = null;
    this.initialized = false;

    this._configCache = null;
  }

  /**
   * Initialize the synthesizer
   * @param {Object} db - Database manager instance
   * @param {Object} instinctManager - InstinctManager instance
   * @param {Object} decisionKB - DecisionKnowledgeBase instance
   * @param {Object} promptOptimizer - PromptOptimizer instance (optional)
   */
  async initialize(
    db,
    instinctManager,
    decisionKB = null,
    promptOptimizer = null,
  ) {
    if (this.initialized) {
      logger.warn("[EvoMapGeneSynthesizer] Already initialized");
      return;
    }

    this.db = db;
    this.instinctManager = instinctManager;
    this.decisionKB = decisionKB;
    this.promptOptimizer = promptOptimizer;
    this.initialized = true;

    logger.info("[EvoMapGeneSynthesizer] Initialized");
  }

  /**
   * Update the config cache (called by asset bridge)
   * @param {Object} config - EvoMap config object
   */
  setConfig(config) {
    this._configCache = config;
  }

  // ============================================================
  // Instinct → Gene+Capsule
  // ============================================================

  /**
   * Synthesize a Gene+Capsule bundle from an instinct
   * @param {Object} instinct - Instinct object from InstinctManager
   * @returns {Object} { gene, capsule, evolutionEvent }
   */
  synthesizeFromInstinct(instinct) {
    if (!instinct || !instinct.pattern) {
      throw new Error("Invalid instinct: missing pattern");
    }

    const sanitizedPattern = this._applyPrivacyFilter(instinct.pattern);
    const sanitizedExamples = this._sanitizeExamples(instinct.examples);
    const geneCategory = this._mapInstinctCategoryToGene(instinct.category);

    // Build Gene
    const gene = {
      type: "Gene",
      category: geneCategory,
      summary: sanitizedPattern,
      signals_match: this._extractSignals(sanitizedPattern),
      strategy: {
        description: sanitizedPattern,
        examples: sanitizedExamples,
        source_category: instinct.category || "general",
      },
      confidence_min: 0.5,
      metadata: {
        origin: "chainlesschain-instinct",
        instinct_category: instinct.category,
      },
    };

    gene.asset_id = EvoMapClient.computeAssetId(gene);

    // Build Capsule
    const capsule = {
      type: "Capsule",
      parent_gene_id: gene.asset_id,
      executor_node_id: null, // will be set during publish
      confidence: instinct.confidence || 0.5,
      success_streak: instinct.use_count || instinct.useCount || 0,
      result_summary: `Instinct "${sanitizedPattern}" validated via ${instinct.use_count || 0} uses`,
      signals_observed: this._extractSignals(sanitizedPattern),
      metadata: {
        origin: "chainlesschain-instinct",
      },
    };

    capsule.asset_id = EvoMapClient.computeAssetId(capsule);

    // Build EvolutionEvent
    const evolutionEvent = {
      type: "EvolutionEvent",
      event_type: "instinct_matured",
      related_assets: [gene.asset_id, capsule.asset_id],
      summary: `Instinct matured to confidence ${instinct.confidence}: ${sanitizedPattern.substring(0, 100)}`,
      timestamp: new Date().toISOString(),
    };

    evolutionEvent.asset_id = EvoMapClient.computeAssetId(evolutionEvent);

    return { gene, capsule, evolutionEvent };
  }

  // ============================================================
  // Decision → Gene+Capsule
  // ============================================================

  /**
   * Synthesize a Gene+Capsule bundle from a decision record
   * @param {Object} decision - Decision record from DecisionKnowledgeBase
   * @returns {Object} { gene, capsule, evolutionEvent }
   */
  synthesizeFromDecision(decision) {
    if (!decision) {
      throw new Error("Invalid decision record");
    }

    const sanitizedContext = this._applyPrivacyFilter(
      decision.context || decision.description || "",
    );
    const sanitizedOutcome = this._applyPrivacyFilter(
      decision.outcome || decision.chosen_option || "",
    );

    const gene = {
      type: "Gene",
      category: "optimize",
      summary: `Decision: ${sanitizedContext.substring(0, 200)}`,
      signals_match: this._extractSignals(sanitizedContext),
      strategy: {
        description: `Context: ${sanitizedContext}\nDecision: ${sanitizedOutcome}`,
        rationale: this._applyPrivacyFilter(decision.rationale || ""),
        source_type: "decision",
      },
      confidence_min: 0.5,
      metadata: {
        origin: "chainlesschain-decision",
        decision_source: decision.source || "manual",
      },
    };

    gene.asset_id = EvoMapClient.computeAssetId(gene);

    const capsule = {
      type: "Capsule",
      parent_gene_id: gene.asset_id,
      executor_node_id: null,
      confidence: decision.success_rate || 0.7,
      success_streak: decision.apply_count || 0,
      result_summary: `Decision applied ${decision.apply_count || 0} times with ${(decision.success_rate || 0) * 100}% success`,
      signals_observed: this._extractSignals(sanitizedContext),
      metadata: {
        origin: "chainlesschain-decision",
      },
    };

    capsule.asset_id = EvoMapClient.computeAssetId(capsule);

    const evolutionEvent = {
      type: "EvolutionEvent",
      event_type: "decision_validated",
      related_assets: [gene.asset_id, capsule.asset_id],
      summary: `Decision validated: ${sanitizedContext.substring(0, 100)}`,
      timestamp: new Date().toISOString(),
    };

    evolutionEvent.asset_id = EvoMapClient.computeAssetId(evolutionEvent);

    return { gene, capsule, evolutionEvent };
  }

  // ============================================================
  // Workflow → Recipe
  // ============================================================

  /**
   * Synthesize a Recipe from an orchestrate workflow template
   * @param {Object} workflowTemplate - Workflow template definition
   * @param {Array} executionHistory - Array of past execution results
   * @returns {Object} recipe asset
   */
  synthesizeRecipeFromWorkflow(workflowTemplate, executionHistory = []) {
    if (!workflowTemplate) {
      throw new Error("Workflow template is required");
    }

    const sanitizedName = this._applyPrivacyFilter(
      workflowTemplate.name || workflowTemplate.id || "unnamed",
    );

    const successCount = executionHistory.filter(
      (e) => e.success || e.status === "success",
    ).length;
    const totalCount = executionHistory.length || 1;

    const recipe = {
      type: "Gene",
      category: "innovate",
      summary: `Workflow recipe: ${sanitizedName}`,
      signals_match: this._extractSignals(sanitizedName),
      strategy: {
        description: `Multi-step workflow: ${sanitizedName}`,
        steps: (workflowTemplate.steps || []).map((step) => ({
          role: step.role || step.name || "agent",
          description: this._applyPrivacyFilter(
            step.description || step.task || "",
          ),
        })),
        source_type: "workflow",
        success_rate: successCount / totalCount,
      },
      confidence_min: 0.6,
      metadata: {
        origin: "chainlesschain-workflow",
        template_id: workflowTemplate.id,
        execution_count: totalCount,
      },
    };

    recipe.asset_id = EvoMapClient.computeAssetId(recipe);

    return recipe;
  }

  // ============================================================
  // Skill → Gene
  // ============================================================

  /**
   * Synthesize a Gene from a skill definition
   * @param {Object} skillDefinition - SKILL.md parsed object
   * @returns {Object} { gene, capsule }
   */
  synthesizeFromSkill(skillDefinition) {
    if (!skillDefinition) {
      throw new Error("Skill definition is required");
    }

    const sanitizedDesc = this._applyPrivacyFilter(
      skillDefinition.description || skillDefinition.name || "",
    );

    const gene = {
      type: "Gene",
      category: "innovate",
      summary: `Skill: ${this._applyPrivacyFilter(skillDefinition.name || "unnamed")}`,
      signals_match: this._extractSignals(sanitizedDesc),
      strategy: {
        description: sanitizedDesc,
        instructions: this._applyPrivacyFilter(
          skillDefinition.instructions || "",
        ),
        tools: skillDefinition.tools || [],
        source_type: "skill",
      },
      confidence_min: 0.5,
      metadata: {
        origin: "chainlesschain-skill",
        skill_name: skillDefinition.name,
        skill_version: skillDefinition.version,
      },
    };

    gene.asset_id = EvoMapClient.computeAssetId(gene);

    const capsule = {
      type: "Capsule",
      parent_gene_id: gene.asset_id,
      executor_node_id: null,
      confidence: 0.7,
      success_streak: 0,
      result_summary: `Skill exported: ${this._applyPrivacyFilter(skillDefinition.name || "unnamed")}`,
      signals_observed: this._extractSignals(sanitizedDesc),
      metadata: {
        origin: "chainlesschain-skill",
      },
    };

    capsule.asset_id = EvoMapClient.computeAssetId(capsule);

    return { gene, capsule };
  }

  // ============================================================
  // Privacy Filter
  // ============================================================

  /**
   * Apply privacy filter to content before publishing
   * @param {string} content - Raw content
   * @returns {string} Sanitized content
   */
  _applyPrivacyFilter(content) {
    if (!content || typeof content !== "string") {
      return "";
    }

    let sanitized = content;

    // Check for secrets - reject entirely if found
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex state before test()
      if (pattern.test(sanitized)) {
        logger.warn(
          "[EvoMapGeneSynthesizer] Secret detected in content, redacting",
        );
        pattern.lastIndex = 0; // Reset again before replace()
        sanitized = sanitized.replace(pattern, "[REDACTED]");
      }
    }

    const config = this._configCache || {};
    const privacyConfig = config.privacyFilter || {};

    // Anonymize mode: strip file paths, project names, usernames
    if (privacyConfig.anonymize !== false) {
      // Strip absolute paths (Windows + Unix)
      sanitized = sanitized.replace(
        /[A-Z]:\\(?:Users|home)\\[^\s\\]+(?:\\[^\s\\]+)*/gi,
        "<path>",
      );
      sanitized = sanitized.replace(
        /\/(?:home|Users)\/[^\s/]+(?:\/[^\s/]+)*/g,
        "<path>",
      );

      // Strip common project-specific paths
      sanitized = sanitized.replace(
        /(?:\/|\\)[a-zA-Z0-9_-]+(?:\/|\\)(?:src|lib|dist|build|node_modules)(?:\/|\\)[^\s]*/g,
        "<project-path>",
      );

      // Strip email addresses
      sanitized = sanitized.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        "<email>",
      );
    }

    // Apply custom exclude patterns
    if (
      privacyConfig.excludePatterns &&
      Array.isArray(privacyConfig.excludePatterns)
    ) {
      for (const pattern of privacyConfig.excludePatterns) {
        try {
          const regex = new RegExp(pattern, "gi");
          sanitized = sanitized.replace(regex, "[EXCLUDED]");
        } catch (_e) {
          // invalid regex, skip
        }
      }
    }

    return sanitized;
  }

  /**
   * Sanitize examples array
   * @private
   * @param {Array|string} examples
   * @returns {Array}
   */
  _sanitizeExamples(examples) {
    let parsed = examples;
    if (typeof examples === "string") {
      try {
        parsed = JSON.parse(examples);
      } catch (_e) {
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .slice(0, 5)
      .map((ex) =>
        this._applyPrivacyFilter(
          typeof ex === "string" ? ex : JSON.stringify(ex),
        ),
      );
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Map instinct category to Gene category
   * @private
   * @param {string} instinctCategory
   * @returns {string} "repair"|"optimize"|"innovate"
   */
  _mapInstinctCategoryToGene(instinctCategory) {
    return CATEGORY_MAP[instinctCategory] || "optimize";
  }

  /**
   * Extract signal keywords from text
   * @private
   * @param {string} text
   * @returns {string[]}
   */
  _extractSignals(text) {
    if (!text) {
      return [];
    }

    // Extract meaningful keywords (3+ chars, not common stop words)
    const stopWords = new Set([
      "the",
      "and",
      "for",
      "that",
      "this",
      "with",
      "from",
      "are",
      "was",
      "were",
      "been",
      "have",
      "has",
      "had",
      "will",
      "can",
      "could",
      "would",
      "should",
      "may",
      "might",
      "not",
      "but",
      "its",
      "use",
      "used",
      "using",
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    // Deduplicate and take top 10
    return [...new Set(words)].slice(0, 10);
  }

  /**
   * Check if content contains secrets
   * @param {string} content
   * @returns {boolean}
   */
  containsSecrets(content) {
    if (!content) {
      return false;
    }
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }
}

// ==================== Singleton Support ====================

let _instance = null;

/**
 * Get or create a singleton EvoMapGeneSynthesizer instance
 * @returns {EvoMapGeneSynthesizer}
 */
function getEvoMapGeneSynthesizer() {
  if (!_instance) {
    _instance = new EvoMapGeneSynthesizer();
  }
  return _instance;
}

module.exports = {
  EvoMapGeneSynthesizer,
  getEvoMapGeneSynthesizer,
};
