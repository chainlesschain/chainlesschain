/**
 * Federated Learning Aggregator — v4.0
 *
 * Implements pluggable aggregation strategies for federated learning:
 * FedAvg, FedProx, Secure Aggregation, Krum, and Trimmed Mean.
 *
 * Supports differential privacy via gradient clipping and Gaussian noise.
 * Integrates with FederatedLearningManager for round lifecycle management.
 *
 * @module ai-engine/cowork/federated-learning-aggregator
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const AGGREGATION_METHOD = {
  FED_AVG: "fedavg",
  FED_PROX: "fedprox",
  SECURE_AGG: "secure_agg",
  KRUM: "krum",
  TRIMMED_MEAN: "trimmed_mean",
};

const ROUND_STATUS = {
  COLLECTING: "collecting",
  AGGREGATING: "aggregating",
  COMPLETED: "completed",
  FAILED: "failed",
};

const DEFAULT_CONFIG = {
  defaultMethod: "fedavg",
  proximalTerm: 0.01,
  trimRatio: 0.1,
  krumByzantine: 1,
  noiseMultiplier: 0.1,
  clipNorm: 1.0,
  privacyBudget: 1.0,
  minGradientsForAggregation: 2,
};

// ============================================================
// FederatedLearningAggregator Class
// ============================================================

class FederatedLearningAggregator extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._config = { ...DEFAULT_CONFIG };

    // Dependencies
    this._flManager = null;
    this._zkpEngine = null;

    // In-memory state
    this._roundMetrics = new Map(); // `${taskId}:${roundNumber}` → metrics
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { flManager, zkpEngine }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._flManager = deps.flManager || null;
    this._zkpEngine = deps.zkpEngine || null;
    this._roundMetrics = new Map();

    this.initialized = true;
    logger.info("[FL Aggregator] Initialized");
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }
    logger.info(
      `[FL Aggregator] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Aggregation
  // ============================================================

  /**
   * Aggregate a training round
   * @param {string} taskId - Task ID
   * @param {number} roundNumber - Round number
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @param {Object} options - { method, globalModel }
   * @returns {Object} Aggregation result
   */
  async aggregateRound(taskId, roundNumber, gradients, options = {}) {
    const startTime = Date.now();
    const method = options.method || this._config.defaultMethod;
    const storeKey = `${taskId}:${roundNumber}`;

    logger.info(
      `[FL Aggregator] Aggregating round ${roundNumber} for task ${taskId} ` +
        `(method: ${method}, participants: ${gradients.size})`,
    );

    let aggregatedModel;

    try {
      switch (method) {
        case AGGREGATION_METHOD.FED_AVG:
          aggregatedModel = this.fedAvg(gradients);
          break;
        case AGGREGATION_METHOD.FED_PROX:
          aggregatedModel = this.fedProx(gradients, options.globalModel || []);
          break;
        case AGGREGATION_METHOD.SECURE_AGG:
          aggregatedModel = this.secureAggregate(gradients);
          break;
        case AGGREGATION_METHOD.KRUM:
          aggregatedModel = this.krum(gradients, this._config.krumByzantine);
          break;
        case AGGREGATION_METHOD.TRIMMED_MEAN:
          aggregatedModel = this.trimmedMean(gradients, this._config.trimRatio);
          break;
        default:
          aggregatedModel = this.fedAvg(gradients);
          break;
      }
    } catch (e) {
      const failedMetrics = {
        taskId,
        roundNumber,
        status: ROUND_STATUS.FAILED,
        error: e.message,
        aggregationTimeMs: Date.now() - startTime,
      };
      this._roundMetrics.set(storeKey, failedMetrics);
      logger.error(
        `[FL Aggregator] Aggregation failed for task ${taskId}, round ${roundNumber}: ${e.message}`,
      );
      throw e;
    }

    const aggregationTimeMs = Date.now() - startTime;

    const metrics = {
      taskId,
      roundNumber,
      method,
      participantCount: gradients.size,
      aggregationTimeMs,
      status: ROUND_STATUS.COMPLETED,
    };
    this._roundMetrics.set(storeKey, metrics);

    const result = {
      taskId,
      roundNumber,
      aggregatedModel,
      method,
      metrics: {
        participantCount: gradients.size,
        aggregationTimeMs,
      },
      status: "completed",
    };

    this.emit("round:aggregated", result);
    logger.info(
      `[FL Aggregator] Round ${roundNumber} aggregated for task ${taskId} ` +
        `in ${aggregationTimeMs}ms`,
    );

    return result;
  }

  // ============================================================
  // Aggregation Methods
  // ============================================================

  /**
   * Federated Averaging — element-wise mean of all gradient arrays
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @returns {number[]} Averaged gradient array
   */
  fedAvg(gradients) {
    const arrays = Array.from(gradients.values());
    if (arrays.length === 0) {
      return [];
    }
    if (arrays.length === 1) {
      return [...arrays[0]];
    }

    const length = arrays[0].length;
    const result = new Array(length).fill(0);

    for (const arr of arrays) {
      for (let i = 0; i < length; i++) {
        result[i] += arr[i] || 0;
      }
    }

    for (let i = 0; i < length; i++) {
      result[i] /= arrays.length;
    }

    return result;
  }

  /**
   * FedProx — FedAvg + proximal regularization term
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @param {number[]} globalModel - Current global model parameters
   * @returns {number[]} Regularized averaged gradient array
   */
  fedProx(gradients, globalModel = []) {
    const avg = this.fedAvg(gradients);
    const mu = this._config.proximalTerm;

    for (let i = 0; i < avg.length; i++) {
      const globalVal = globalModel[i] || 0;
      avg[i] = avg[i] + mu * (avg[i] - globalVal);
    }

    return avg;
  }

  /**
   * Secure Aggregation — simulated with random masks that cancel out
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @returns {number[]} Aggregated result
   */
  secureAggregate(gradients) {
    const arrays = Array.from(gradients.values());
    if (arrays.length === 0) {
      return [];
    }
    if (arrays.length === 1) {
      return [...arrays[0]];
    }

    const length = arrays[0].length;

    // Generate pairwise masks that cancel out when summed
    const maskedArrays = arrays.map((arr) => [...arr]);
    for (let i = 0; i < maskedArrays.length - 1; i++) {
      const mask = this._gaussianNoise(length, 1.0);
      for (let j = 0; j < length; j++) {
        maskedArrays[i][j] += mask[j];
        maskedArrays[i + 1][j] -= mask[j];
      }
    }

    // Sum all masked arrays — masks cancel out
    const summed = new Array(length).fill(0);
    for (const arr of maskedArrays) {
      for (let j = 0; j < length; j++) {
        summed[j] += arr[j];
      }
    }

    // Average
    for (let j = 0; j < length; j++) {
      summed[j] /= arrays.length;
    }

    return summed;
  }

  /**
   * Multi-Krum — select the gradient with minimum total distance to all others
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @param {number} byzantineCount - Number of suspected byzantine participants
   * @returns {number[]} Selected gradient array
   */
  krum(gradients, byzantineCount = 1) {
    const arrays = Array.from(gradients.values());
    if (arrays.length === 0) {
      return [];
    }
    if (arrays.length === 1) {
      return [...arrays[0]];
    }

    // For each gradient, compute sum of distances to all others
    let bestIndex = 0;
    let bestScore = Infinity;

    for (let i = 0; i < arrays.length; i++) {
      const distances = [];
      for (let j = 0; j < arrays.length; j++) {
        if (i === j) {
          continue;
        }
        const diff = arrays[i].map((val, idx) => val - (arrays[j][idx] || 0));
        distances.push(this._l2Norm(diff));
      }

      // Sort distances and take the n - byzantineCount - 2 closest
      distances.sort((a, b) => a - b);
      const k = Math.max(1, arrays.length - byzantineCount - 2);
      const score = distances.slice(0, k).reduce((sum, d) => sum + d, 0);

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return [...arrays[bestIndex]];
  }

  /**
   * Trimmed Mean — for each dimension, sort values, trim top/bottom, average rest
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @param {number} trimRatio - Fraction to trim from each end (0 to 0.5)
   * @returns {number[]} Trimmed mean gradient array
   */
  trimmedMean(gradients, trimRatio = 0.1) {
    const arrays = Array.from(gradients.values());
    if (arrays.length === 0) {
      return [];
    }
    if (arrays.length === 1) {
      return [...arrays[0]];
    }

    const length = arrays[0].length;
    const result = new Array(length);
    const trimCount = Math.floor(arrays.length * trimRatio);

    for (let i = 0; i < length; i++) {
      const values = arrays.map((arr) => arr[i] || 0);
      values.sort((a, b) => a - b);

      const trimmed = values.slice(trimCount, values.length - trimCount);
      if (trimmed.length === 0) {
        // If we trimmed everything, fall back to median
        result[i] = values[Math.floor(values.length / 2)];
      } else {
        result[i] = trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
      }
    }

    return result;
  }

  // ============================================================
  // Differential Privacy
  // ============================================================

  /**
   * Add differential privacy to a model
   * @param {number[]} model - Model parameters
   * @param {number} noiseMultiplier - Scale of Gaussian noise
   * @param {number} clipNorm - Clipping bound
   * @returns {number[]} Noisy model
   */
  addDifferentialPrivacy(model, noiseMultiplier, clipNorm) {
    // Clip model values
    const clipped = model.map((v) =>
      Math.max(-clipNorm, Math.min(clipNorm, v)),
    );

    // Add Gaussian noise
    const noise = this._gaussianNoise(clipped.length, noiseMultiplier);
    return clipped.map((v, i) => v + noise[i]);
  }

  /**
   * Clip gradients by L2 norm
   * @param {Map<string, number[]>} gradients - Map of agentDid to gradient arrays
   * @param {number} clipNorm - Maximum L2 norm
   * @returns {Map<string, number[]>} Clipped gradients
   */
  clipGradients(gradients, clipNorm) {
    const clipped = new Map();

    for (const [agentDid, grad] of gradients) {
      const norm = this._l2Norm(grad);
      if (norm > clipNorm) {
        const scale = clipNorm / norm;
        clipped.set(agentDid, this._scaleArray(grad, scale));
      } else {
        clipped.set(agentDid, [...grad]);
      }
    }

    return clipped;
  }

  // ============================================================
  // Query Methods
  // ============================================================

  /**
   * Get round status from metrics
   * @param {string} taskId - Task ID
   * @param {number} roundNumber - Round number
   * @returns {Object|null} Round metrics or null
   */
  getRoundStatus(taskId, roundNumber) {
    const storeKey = `${taskId}:${roundNumber}`;
    return this._roundMetrics.get(storeKey) || null;
  }

  /**
   * Get all metrics for a task
   * @param {string} taskId - Task ID
   * @returns {Object[]} Array of round metrics
   */
  getMetrics(taskId) {
    const results = [];
    for (const [key, metrics] of this._roundMetrics) {
      if (key.startsWith(`${taskId}:`)) {
        results.push(metrics);
      }
    }
    return results;
  }

  /**
   * Get aggregate statistics
   * @returns {Object} Stats
   */
  getStats() {
    let totalAggregations = 0;
    const byMethod = {};
    let totalTimeMs = 0;

    for (const [, metrics] of this._roundMetrics) {
      if (metrics.status === ROUND_STATUS.COMPLETED) {
        totalAggregations++;
        const method = metrics.method || "unknown";
        byMethod[method] = (byMethod[method] || 0) + 1;
        totalTimeMs += metrics.aggregationTimeMs || 0;
      }
    }

    return {
      totalAggregations,
      byMethod,
      avgAggregationTimeMs:
        totalAggregations > 0 ? Math.round(totalTimeMs / totalAggregations) : 0,
    };
  }

  // ============================================================
  // Cleanup & Destroy
  // ============================================================

  /**
   * Destroy the aggregator and clean up state
   */
  destroy() {
    this._roundMetrics.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[FL Aggregator] Destroyed");
  }

  // ============================================================
  // Private — Math Helpers
  // ============================================================

  /**
   * Compute L2 norm of an array
   * @param {number[]} arr
   * @returns {number}
   */
  _l2Norm(arr) {
    let sumSq = 0;
    for (let i = 0; i < arr.length; i++) {
      sumSq += arr[i] * arr[i];
    }
    return Math.sqrt(sumSq);
  }

  /**
   * Element-wise addition of two arrays
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number[]}
   */
  _addArrays(a, b) {
    const length = Math.max(a.length, b.length);
    const result = new Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = (a[i] || 0) + (b[i] || 0);
    }
    return result;
  }

  /**
   * Scale an array by a scalar value
   * @param {number[]} arr
   * @param {number} scalar
   * @returns {number[]}
   */
  _scaleArray(arr, scalar) {
    return arr.map((v) => v * scalar);
  }

  /**
   * Generate Gaussian noise using Box-Muller transform
   * @param {number} size - Number of elements
   * @param {number} scale - Standard deviation
   * @returns {number[]}
   */
  _gaussianNoise(size, scale) {
    const noise = new Array(size);
    for (let i = 0; i < size; i += 2) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      noise[i] = z0 * scale;
      if (i + 1 < size) {
        noise[i + 1] = z1 * scale;
      }
    }
    return noise;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getFederatedLearningAggregator() {
  if (!instance) {
    instance = new FederatedLearningAggregator();
  }
  return instance;
}

module.exports = {
  FederatedLearningAggregator,
  getFederatedLearningAggregator,
  AGGREGATION_METHOD,
  ROUND_STATUS,
};
