/**
 * Multimodal Context Builder — Unified Context Construction (v3.2)
 *
 * Fuses processed multimodal inputs into a unified LLM-ready context:
 * - Combines text, image OCR, document structure, audio transcription
 * - Manages context window budgets (token limits)
 * - Prioritizes inputs by relevance and recency
 * - Caches built contexts for session reuse
 *
 * @module ai-engine/cowork/multimodal-context
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const CONTEXT_STATUS = {
  BUILDING: "building",
  READY: "ready",
  STALE: "stale",
};

const MODALITY_WEIGHTS = {
  text: 1.0,
  image: 0.8,
  document: 0.9,
  audio: 0.7,
  screen: 0.6,
};

const DEFAULT_CONFIG = {
  maxContextTokens: 4000,
  charsPerToken: 3.5,
  maxInputsPerContext: 15,
  includeMetadata: true,
  prioritizeRecent: true,
  contextCacheTTLMs: 300000,
  sectionSeparator: "\n\n---\n\n",
};

// ============================================================
// MultimodalContext Class
// ============================================================

class MultimodalContext extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.modalityFusion = null;
    this.config = { ...DEFAULT_CONFIG };
    this.contextCache = new Map();
    this.stats = {
      totalBuilds: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageBuildTimeMs: 0,
      averageContextTokens: 0,
    };
    this._buildTimes = [];
    this._contextTokenCounts = [];
  }

  /**
   * Initialize with dependencies
   * @param {Object} deps
   * @param {Object} [deps.modalityFusion] - ModalityFusion instance
   */
  async initialize(deps = {}) {
    if (this.initialized) {
      return;
    }
    this.modalityFusion = deps.modalityFusion || null;
    logger.info("[MultimodalContext] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Build unified context from a multimodal session
   * @param {Object} options
   * @param {string} options.sessionId - Session ID from ModalityFusion
   * @param {string} [options.taskDescription] - Optional task context
   * @param {number} [options.maxTokens] - Override max token budget
   * @returns {Object} Built context
   */
  async buildContext(options = {}) {
    if (!this.initialized) {
      throw new Error("MultimodalContext not initialized");
    }

    const { sessionId, taskDescription, maxTokens } = options;
    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    // Check cache
    const cached = this._getCached(sessionId);
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }
    this.stats.cacheMisses++;

    const startTime = Date.now();
    const tokenBudget = maxTokens || this.config.maxContextTokens;

    // Get session from ModalityFusion
    const session = this.modalityFusion?.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Build context sections
    const sections = [];
    let usedTokens = 0;

    // Add task description if provided
    if (taskDescription) {
      const taskSection = this._createSection(
        "任务描述",
        taskDescription,
        "task",
        1.0,
      );
      sections.push(taskSection);
      usedTokens += taskSection.tokens;
    }

    // Process each input in the session
    const inputs = session.inputs || [];
    const sortedInputs = this._prioritizeInputs(inputs);

    for (const input of sortedInputs) {
      if (usedTokens >= tokenBudget) {
        break;
      }

      const remainingBudget = tokenBudget - usedTokens;
      const section = this._createSection(
        input.label || input.type,
        input.text,
        input.type,
        MODALITY_WEIGHTS[input.type] || 0.5,
        remainingBudget,
      );

      sections.push(section);
      usedTokens += section.tokens;
    }

    // Assemble final context
    const contextText = sections
      .map((s) => {
        const header = this.config.includeMetadata
          ? `[${s.label}] (${s.modality}, ~${s.tokens} tokens)`
          : `[${s.label}]`;
        return `${header}\n${s.text}`;
      })
      .join(this.config.sectionSeparator);

    const context = {
      sessionId,
      text: contextText,
      sections: sections.map((s) => ({
        label: s.label,
        modality: s.modality,
        tokens: s.tokens,
        truncated: s.truncated,
      })),
      totalTokens: usedTokens,
      tokenBudget,
      utilization: Math.round((usedTokens / tokenBudget) * 100) / 100,
      modalities: [...new Set(sections.map((s) => s.modality))],
      sectionCount: sections.length,
      status: CONTEXT_STATUS.READY,
      builtAt: new Date().toISOString(),
    };

    // Cache
    this._setCache(sessionId, context);

    // Stats
    const elapsed = Date.now() - startTime;
    this._buildTimes.push(elapsed);
    this._contextTokenCounts.push(usedTokens);
    if (this._buildTimes.length > 100) {
      this._buildTimes.shift();
    }
    if (this._contextTokenCounts.length > 100) {
      this._contextTokenCounts.shift();
    }
    this.stats.totalBuilds++;
    this.stats.averageBuildTimeMs = Math.round(
      this._buildTimes.reduce((a, b) => a + b, 0) / this._buildTimes.length,
    );
    this.stats.averageContextTokens = Math.round(
      this._contextTokenCounts.reduce((a, b) => a + b, 0) /
        this._contextTokenCounts.length,
    );

    this.emit("context:built", {
      sessionId,
      tokens: usedTokens,
      sections: sections.length,
      elapsed,
    });

    logger.info(
      `[MultimodalContext] Built context: ${sessionId} (${usedTokens} tokens, ${sections.length} sections, ${elapsed}ms)`,
    );

    return context;
  }

  /**
   * Get a previously built context from cache
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getCachedContext(sessionId) {
    return this._getCached(sessionId);
  }

  /**
   * Invalidate cached context for a session
   * @param {string} sessionId
   */
  invalidateCache(sessionId) {
    this.contextCache.delete(sessionId);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.contextCache.size,
    };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Input Prioritization
  // ============================================================

  _prioritizeInputs(inputs) {
    if (!inputs || inputs.length === 0) {
      return [];
    }

    const scored = inputs.map((input, index) => {
      const weight = MODALITY_WEIGHTS[input.type] || 0.5;
      const textLength = input.text?.length || 0;
      const contentScore = Math.min(textLength / 500, 1) * 0.4;
      const recencyScore = this.config.prioritizeRecent
        ? ((inputs.length - index) / inputs.length) * 0.3
        : 0;
      const errorPenalty = input.metadata?.error ? -0.5 : 0;

      return {
        ...input,
        score: weight * 0.3 + contentScore + recencyScore + errorPenalty,
      };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  // ============================================================
  // Section Building
  // ============================================================

  _createSection(label, text, modality, weight, maxTokens) {
    const fullTokens = this._estimateTokens(text || "");
    let sectionText = text || "";
    let truncated = false;

    if (maxTokens && fullTokens > maxTokens) {
      // Truncate to fit budget
      const maxChars = Math.floor(maxTokens * this.config.charsPerToken);
      sectionText = sectionText.slice(0, maxChars) + "\n[... 已截断]";
      truncated = true;
    }

    return {
      label,
      text: sectionText,
      modality,
      weight,
      tokens: truncated ? maxTokens || fullTokens : fullTokens,
      truncated,
    };
  }

  _estimateTokens(text) {
    if (!text) {
      return 0;
    }
    return Math.ceil(text.length / this.config.charsPerToken);
  }

  // ============================================================
  // Caching
  // ============================================================

  _getCached(sessionId) {
    const entry = this.contextCache.get(sessionId);
    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.config.contextCacheTTLMs) {
      this.contextCache.delete(sessionId);
      return null;
    }

    return entry.context;
  }

  _setCache(sessionId, context) {
    this.contextCache.set(sessionId, {
      context,
      timestamp: Date.now(),
    });

    // Evict old entries
    if (this.contextCache.size > 50) {
      const oldest = [...this.contextCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 10);
      for (const [key] of oldest) {
        this.contextCache.delete(key);
      }
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getMultimodalContext() {
  if (!instance) {
    instance = new MultimodalContext();
  }
  return instance;
}

module.exports = {
  MultimodalContext,
  getMultimodalContext,
  CONTEXT_STATUS,
  MODALITY_WEIGHTS,
};
