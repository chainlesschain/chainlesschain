/**
 * MLTaskScheduler - ML-driven Task Scheduling
 *
 * Lightweight statistical model for predicting task complexity and resource needs.
 * Uses weighted linear regression on historical task data with online learning.
 *
 * Core capabilities:
 * 1. Task Complexity Prediction (1-10 scale)
 * 2. Resource Estimation (agent count, duration, token budget)
 * 3. Weighted Linear Regression (no external ML libs)
 * 4. Online Learning (exponential moving average weight updates)
 * 5. Integration with AgentCoordinator.orchestrate()
 *
 * @module ai-engine/cowork/ml-task-scheduler
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

/**
 * Feature keywords and their complexity weights
 */
const KEYWORD_WEIGHTS = {
  // High complexity keywords
  refactor: 0.8,
  architect: 0.9,
  migrate: 0.85,
  optimize: 0.7,
  security: 0.75,
  deploy: 0.65,
  integrate: 0.7,
  distributed: 0.85,
  concurrent: 0.8,
  // Medium complexity keywords
  analyze: 0.5,
  test: 0.4,
  review: 0.35,
  debug: 0.55,
  implement: 0.5,
  design: 0.6,
  database: 0.55,
  api: 0.45,
  // Low complexity keywords
  fix: 0.3,
  update: 0.25,
  add: 0.2,
  remove: 0.15,
  rename: 0.1,
  format: 0.1,
  document: 0.2,
  comment: 0.1,
};

/**
 * Task type to base complexity mapping
 */
const TASK_TYPE_COMPLEXITY = {
  code_review: 3,
  testing: 4,
  implementation: 6,
  refactoring: 7,
  architecture: 8,
  deployment: 5,
  documentation: 2,
  bug_fix: 4,
  feature: 6,
  research: 5,
  analysis: 5,
  default: 5,
};

/**
 * Resource estimation thresholds
 */
const RESOURCE_TIERS = [
  { maxComplexity: 2, agents: 1, tokenBudget: 2000, durationMultiplier: 0.5 },
  { maxComplexity: 4, agents: 1, tokenBudget: 4000, durationMultiplier: 0.75 },
  { maxComplexity: 6, agents: 2, tokenBudget: 8000, durationMultiplier: 1.0 },
  { maxComplexity: 8, agents: 3, tokenBudget: 15000, durationMultiplier: 1.5 },
  {
    maxComplexity: 10,
    agents: 5,
    tokenBudget: 30000,
    durationMultiplier: 2.0,
  },
];

/**
 * Default model configuration
 */
const DEFAULT_CONFIG = {
  learningRate: 0.1, // Exponential moving average alpha
  minSamples: 5, // Minimum samples before confident prediction
  maxHistorySize: 1000, // Max historical records to keep
  featureCount: 5, // Number of features in the model
  baselineDurationMs: 60000, // 60s baseline task duration
  confidenceDecayRate: 0.05, // Confidence decay per prediction without feedback
  retrainThreshold: 50, // Retrain after this many new samples
};

class MLTaskScheduler extends EventEmitter {
  /**
   * @param {Object} db - Database instance
   * @param {Object} [agentCoordinator] - AgentCoordinator instance (optional)
   * @param {Object} [config] - Configuration overrides
   */
  constructor(db, agentCoordinator = null, config = {}) {
    super();

    this.db = db;
    this.agentCoordinator = agentCoordinator;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Model weights: [wordCount, keywordDensity, subtaskCount, priorityWeight, taskTypeBase]
    this.weights = new Float64Array(this.config.featureCount);
    this.bias = 5.0; // Start at midpoint complexity

    // Model metadata
    this.modelVersion = 1;
    this.sampleCount = 0;
    this.predictionCount = 0;
    this.totalError = 0;
    this.newSamplesSinceRetrain = 0;

    // In-memory cache of recent predictions
    this._predictionCache = new Map();
    this._cacheMaxSize = 200;

    this.initialized = false;

    logger.info("[MLTaskScheduler] Created", {
      learningRate: this.config.learningRate,
      featureCount: this.config.featureCount,
    });
  }

  /**
   * Initialize the scheduler: load historical data and compute initial weights
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this._ensureTable();
      await this._loadHistoricalData();
      this.initialized = true;
      logger.info("[MLTaskScheduler] Initialized", {
        modelVersion: this.modelVersion,
        sampleCount: this.sampleCount,
        weights: Array.from(this.weights),
      });
      this.emit("initialized", { modelVersion: this.modelVersion });
    } catch (error) {
      logger.error("[MLTaskScheduler] Initialization failed:", error.message);
      // Still mark as initialized to allow predictions with default weights
      this.initialized = true;
    }
  }

  /**
   * Ensure the ml_task_features table exists
   */
  _ensureTable() {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS ml_task_features (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          features TEXT,
          predicted_complexity REAL,
          predicted_duration INTEGER,
          actual_duration INTEGER,
          actual_complexity REAL,
          model_version INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_ml_task_features_task ON ml_task_features(task_id)",
      );
    } catch (error) {
      logger.warn("[MLTaskScheduler] Table creation warning:", error.message);
    }
  }

  /**
   * Load historical data and compute initial weights via batch regression
   */
  async _loadHistoricalData() {
    if (!this.db) {
      return;
    }

    try {
      const rows = this.db.all(
        `SELECT features, predicted_complexity, actual_complexity, actual_duration
         FROM ml_task_features
         WHERE actual_complexity IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`,
        [this.config.maxHistorySize],
      );

      if (!rows || rows.length === 0) {
        logger.info(
          "[MLTaskScheduler] No historical data, using default weights",
        );
        this._initDefaultWeights();
        return;
      }

      this.sampleCount = rows.length;
      this._batchTrain(rows);
    } catch (error) {
      logger.warn(
        "[MLTaskScheduler] Historical data load failed:",
        error.message,
      );
      this._initDefaultWeights();
    }
  }

  /**
   * Initialize default weights based on domain knowledge
   */
  _initDefaultWeights() {
    // [wordCount, keywordDensity, subtaskCount, priorityWeight, taskTypeBase]
    this.weights[0] = 0.01; // word count contribution
    this.weights[1] = 2.0; // keyword density contribution
    this.weights[2] = 0.5; // subtask count contribution
    this.weights[3] = 0.3; // priority weight contribution
    this.weights[4] = 0.8; // task type base contribution
    this.bias = 1.0;
  }

  /**
   * Batch train on historical data using ordinary least squares approximation
   * @param {Array} rows - Historical records with features and actual_complexity
   */
  _batchTrain(rows) {
    const n = rows.length;
    if (n < 2) {
      this._initDefaultWeights();
      return;
    }

    // Parse features and targets
    const features = [];
    const targets = [];

    for (const row of rows) {
      try {
        const f = JSON.parse(row.features);
        if (Array.isArray(f) && f.length === this.config.featureCount) {
          features.push(f);
          targets.push(row.actual_complexity);
        }
      } catch (_e) {
        // Skip malformed records
      }
    }

    if (features.length < 2) {
      this._initDefaultWeights();
      return;
    }

    // Simple gradient descent (10 epochs)
    this._initDefaultWeights();
    const lr = 0.001;
    const epochs = 10;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      for (let i = 0; i < features.length; i++) {
        const predicted = this._predict(features[i]);
        const error = predicted - targets[i];
        totalLoss += error * error;

        // Update weights
        for (let j = 0; j < this.config.featureCount; j++) {
          this.weights[j] -= lr * error * features[i][j];
        }
        this.bias -= lr * error;
      }

      // Early stopping if loss is low
      if (totalLoss / features.length < 0.01) {
        break;
      }
    }

    this.modelVersion++;
    logger.info("[MLTaskScheduler] Batch training complete", {
      samples: features.length,
      modelVersion: this.modelVersion,
      weights: Array.from(this.weights),
    });
  }

  /**
   * Raw prediction using current weights
   * @param {number[]} featureVector - Feature vector
   * @returns {number} Raw predicted value
   */
  _predict(featureVector) {
    let result = this.bias;
    for (let i = 0; i < this.config.featureCount; i++) {
      result += this.weights[i] * (featureVector[i] || 0);
    }
    return result;
  }

  /**
   * Extract feature vector from task description and context
   * @param {string} description - Task description text
   * @param {Object} [context] - Additional context
   * @returns {Object} Feature extraction result
   */
  extractFeatures(description, context = {}) {
    const text = (description || "").toLowerCase();
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    // Feature 1: Word count (normalized to 0-1 range, cap at 500 words)
    const wordCount = Math.min(words.length / 500, 1.0);

    // Feature 2: Keyword density (0-1)
    let keywordScore = 0;
    let keywordCount = 0;
    for (const word of words) {
      if (KEYWORD_WEIGHTS[word]) {
        keywordScore += KEYWORD_WEIGHTS[word];
        keywordCount++;
      }
    }
    const keywordDensity =
      words.length > 0
        ? Math.min(keywordScore / Math.max(words.length * 0.1, 1), 1.0)
        : 0;

    // Feature 3: Subtask count (from context or heuristic)
    let subtaskCount = 0;
    if (context.subtasks) {
      subtaskCount = Array.isArray(context.subtasks)
        ? context.subtasks.length
        : context.subtasks;
    } else {
      // Heuristic: count bullet points, numbered items, "then" conjunctions
      const bulletCount = (text.match(/^[\s]*[-*•]\s/gm) || []).length;
      const numberedCount = (text.match(/^[\s]*\d+[.)]\s/gm) || []).length;
      const thenCount = (text.match(/\bthen\b/gi) || []).length;
      subtaskCount = bulletCount + numberedCount + thenCount;
    }
    const normalizedSubtasks = Math.min(subtaskCount / 10, 1.0);

    // Feature 4: Priority weight (0-1)
    const priorityMap = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 };
    const priority = (context.priority || "medium").toLowerCase();
    const priorityWeight = priorityMap[priority] || 0.5;

    // Feature 5: Task type base complexity (normalized)
    const taskType = (
      context.type ||
      context.taskType ||
      "default"
    ).toLowerCase();
    const typeBase =
      (TASK_TYPE_COMPLEXITY[taskType] || TASK_TYPE_COMPLEXITY.default) / 10;

    const featureVector = [
      wordCount,
      keywordDensity,
      normalizedSubtasks,
      priorityWeight,
      typeBase,
    ];

    return {
      vector: featureVector,
      details: {
        wordCount: words.length,
        keywordDensity: Math.round(keywordDensity * 100) / 100,
        keywordMatches: keywordCount,
        subtaskCount,
        priority,
        taskType,
        typeBaseComplexity:
          TASK_TYPE_COMPLEXITY[taskType] || TASK_TYPE_COMPLEXITY.default,
      },
    };
  }

  /**
   * Predict task complexity
   * @param {string} taskDescription - Task description
   * @param {Object} [context] - Additional context { priority, type, subtasks }
   * @returns {Object} { complexity, confidence, features, estimatedDuration, featureVector }
   */
  predictComplexity(taskDescription, context = {}) {
    const { vector, details } = this.extractFeatures(taskDescription, context);

    // Get raw prediction
    const rawComplexity = this._predict(vector);

    // Clamp to 1-10 range
    const complexity = Math.max(
      1,
      Math.min(10, Math.round(rawComplexity * 10) / 10),
    );

    // Calculate confidence based on sample count
    const confidence = Math.min(
      0.95,
      this.sampleCount >= this.config.minSamples
        ? 0.5 + 0.45 * (1 - Math.exp(-this.sampleCount / 50))
        : 0.2 + 0.3 * (this.sampleCount / this.config.minSamples),
    );

    // Estimate duration
    const durationMs = this._estimateDuration(complexity);

    this.predictionCount++;

    const result = {
      complexity,
      confidence: Math.round(confidence * 100) / 100,
      estimatedDurationMs: durationMs,
      estimatedDurationHuman: this._humanDuration(durationMs),
      features: details,
      featureVector: vector,
      modelVersion: this.modelVersion,
      sampleCount: this.sampleCount,
    };

    // Cache the prediction
    const cacheKey = this._hashDescription(taskDescription);
    this._predictionCache.set(cacheKey, {
      ...result,
      timestamp: Date.now(),
    });
    if (this._predictionCache.size > this._cacheMaxSize) {
      const firstKey = this._predictionCache.keys().next().value;
      this._predictionCache.delete(firstKey);
    }

    this.emit("prediction", result);
    return result;
  }

  /**
   * Predict resource needs based on complexity
   * @param {number} complexity - Complexity score (1-10)
   * @param {string} [taskType] - Task type
   * @returns {Object} { agentCount, estimatedDuration, tokenBudget, tier }
   */
  predictResources(complexity, taskType = "default") {
    const tier =
      RESOURCE_TIERS.find((t) => complexity <= t.maxComplexity) ||
      RESOURCE_TIERS[RESOURCE_TIERS.length - 1];

    const baseDuration = this._estimateDuration(complexity);

    return {
      agentCount: tier.agents,
      estimatedDurationMs: baseDuration,
      estimatedDurationHuman: this._humanDuration(baseDuration),
      tokenBudget: tier.tokenBudget,
      tier: RESOURCE_TIERS.indexOf(tier) + 1,
      complexity,
      taskType,
      recommendation:
        complexity >= 7
          ? "Consider breaking this into smaller subtasks"
          : complexity >= 4
            ? "Standard multi-step task"
            : "Simple task, single agent sufficient",
    };
  }

  /**
   * Record task outcome for online learning
   * @param {string} taskId - Task ID
   * @param {number} actualDurationMs - Actual task duration in ms
   * @param {boolean} success - Whether the task succeeded
   * @param {Object} [meta] - Additional metadata
   */
  recordOutcome(taskId, actualDurationMs, success, meta = {}) {
    try {
      // Estimate actual complexity from duration
      const actualComplexity = this._durationToComplexity(actualDurationMs);

      // Find cached prediction for this task
      let features = null;
      let predictedComplexity = null;

      for (const [, cached] of this._predictionCache) {
        if (cached.taskId === taskId) {
          features = cached.featureVector;
          predictedComplexity = cached.complexity;
          break;
        }
      }

      // Store in database
      if (this.db) {
        const id = uuidv4();
        this.db.run(
          `INSERT INTO ml_task_features
           (id, task_id, features, predicted_complexity, predicted_duration,
            actual_duration, actual_complexity, model_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            taskId,
            features ? JSON.stringify(features) : null,
            predictedComplexity,
            meta.predictedDuration || null,
            actualDurationMs,
            actualComplexity,
            this.modelVersion,
          ],
        );
      }

      // Online learning update (EMA)
      if (features && predictedComplexity !== null) {
        const error = predictedComplexity - actualComplexity;
        this.totalError += Math.abs(error);

        // Update weights using exponential moving average
        const alpha = this.config.learningRate;
        for (let i = 0; i < this.config.featureCount; i++) {
          this.weights[i] -= alpha * error * features[i];
        }
        this.bias -= alpha * error;
      }

      this.sampleCount++;
      this.newSamplesSinceRetrain++;

      // Auto-retrain if threshold reached
      if (this.newSamplesSinceRetrain >= this.config.retrainThreshold) {
        this.retrain().catch((err) =>
          logger.warn("[MLTaskScheduler] Auto-retrain failed:", err.message),
        );
      }

      this.emit("outcome-recorded", {
        taskId,
        actualDurationMs,
        actualComplexity,
        success,
      });

      logger.info("[MLTaskScheduler] Outcome recorded", {
        taskId,
        actualDurationMs,
        actualComplexity,
        success,
      });
    } catch (error) {
      logger.error("[MLTaskScheduler] Record outcome error:", error.message);
    }
  }

  /**
   * Force full batch retrain from database
   * @returns {Object} Training result
   */
  async retrain() {
    if (!this.db) {
      return {
        success: false,
        error: "No database available",
      };
    }

    try {
      const rows = this.db.all(
        `SELECT features, predicted_complexity, actual_complexity, actual_duration
         FROM ml_task_features
         WHERE actual_complexity IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`,
        [this.config.maxHistorySize],
      );

      if (!rows || rows.length < 2) {
        return {
          success: false,
          error: "Insufficient training data",
          sampleCount: rows ? rows.length : 0,
        };
      }

      const previousWeights = Array.from(this.weights);
      this._batchTrain(rows);
      this.newSamplesSinceRetrain = 0;

      const result = {
        success: true,
        modelVersion: this.modelVersion,
        sampleCount: rows.length,
        previousWeights,
        newWeights: Array.from(this.weights),
      };

      this.emit("retrained", result);
      logger.info("[MLTaskScheduler] Retrained", result);

      return result;
    } catch (error) {
      logger.error("[MLTaskScheduler] Retrain error:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get model statistics
   * @returns {Object} Model stats
   */
  getStats() {
    const avgError =
      this.predictionCount > 0
        ? Math.round((this.totalError / this.predictionCount) * 100) / 100
        : 0;

    return {
      modelVersion: this.modelVersion,
      sampleCount: this.sampleCount,
      predictionCount: this.predictionCount,
      averageError: avgError,
      accuracy:
        this.predictionCount > 0
          ? Math.round((1 - avgError / 10) * 100) / 100
          : null,
      featureWeights: {
        wordCount: Math.round(this.weights[0] * 1000) / 1000,
        keywordDensity: Math.round(this.weights[1] * 1000) / 1000,
        subtaskCount: Math.round(this.weights[2] * 1000) / 1000,
        priorityWeight: Math.round(this.weights[3] * 1000) / 1000,
        taskTypeBase: Math.round(this.weights[4] * 1000) / 1000,
      },
      bias: Math.round(this.bias * 1000) / 1000,
      cacheSize: this._predictionCache.size,
      config: { ...this.config },
    };
  }

  /**
   * Get historical predictions vs actuals
   * @param {number} [limit=50] - Max records to return
   * @returns {Array} Historical records
   */
  getHistory(limit = 50) {
    if (!this.db) {
      return [];
    }

    try {
      return this.db.all(
        `SELECT id, task_id, features, predicted_complexity, predicted_duration,
                actual_duration, actual_complexity, model_version, created_at
         FROM ml_task_features
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit],
      );
    } catch (error) {
      logger.error("[MLTaskScheduler] Get history error:", error.message);
      return [];
    }
  }

  /**
   * Get feature importance rankings
   * @returns {Array} Sorted feature importance
   */
  getFeatureImportance() {
    const featureNames = [
      "wordCount",
      "keywordDensity",
      "subtaskCount",
      "priorityWeight",
      "taskTypeBase",
    ];

    const importance = featureNames.map((name, i) => ({
      feature: name,
      weight: Math.round(Math.abs(this.weights[i]) * 1000) / 1000,
      rawWeight: Math.round(this.weights[i] * 1000) / 1000,
      direction: this.weights[i] >= 0 ? "positive" : "negative",
    }));

    // Sort by absolute weight descending
    importance.sort((a, b) => b.weight - a.weight);

    return importance;
  }

  /**
   * Update scheduler configuration
   * @param {Object} newConfig - Configuration updates
   * @returns {Object} Updated config
   */
  configure(newConfig) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(newConfig)) {
      if (validKeys.includes(key)) {
        this.config[key] = newConfig[key];
      }
    }
    logger.info("[MLTaskScheduler] Config updated", this.config);
    return { ...this.config };
  }

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this.config };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Estimate duration from complexity
   * @param {number} complexity - Complexity score (1-10)
   * @returns {number} Estimated duration in ms
   */
  _estimateDuration(complexity) {
    const tier =
      RESOURCE_TIERS.find((t) => complexity <= t.maxComplexity) ||
      RESOURCE_TIERS[RESOURCE_TIERS.length - 1];
    return Math.round(
      this.config.baselineDurationMs *
        tier.durationMultiplier *
        (complexity / 5),
    );
  }

  /**
   * Estimate complexity from actual duration
   * @param {number} durationMs - Duration in ms
   * @returns {number} Estimated complexity (1-10)
   */
  _durationToComplexity(durationMs) {
    const ratio = durationMs / this.config.baselineDurationMs;
    return Math.max(1, Math.min(10, Math.round(ratio * 5 * 10) / 10));
  }

  /**
   * Convert ms to human-readable duration
   * @param {number} ms - Milliseconds
   * @returns {string} Human-readable string
   */
  _humanDuration(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }
    if (ms < 3600000) {
      return `${Math.round(ms / 60000)}m`;
    }
    return `${Math.round((ms / 3600000) * 10) / 10}h`;
  }

  /**
   * Simple hash for cache key
   * @param {string} text - Input text
   * @returns {string} Hash string
   */
  _hashDescription(text) {
    let hash = 0;
    const str = (text || "").substring(0, 200);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return `pred_${hash}`;
  }

  /**
   * Shutdown the scheduler
   */
  shutdown() {
    this._predictionCache.clear();
    this.removeAllListeners();
    logger.info("[MLTaskScheduler] Shutdown");
  }
}

module.exports = {
  MLTaskScheduler,
  KEYWORD_WEIGHTS,
  TASK_TYPE_COMPLEXITY,
  RESOURCE_TIERS,
};
