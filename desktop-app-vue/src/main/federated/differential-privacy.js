/**
 * Differential Privacy Module
 *
 * Provides gradient clipping and calibrated noise injection for
 * privacy-preserving federated learning. Supports Gaussian and
 * Laplace mechanisms with configurable privacy budgets.
 *
 * @module federated/differential-privacy
 * @version 1.0.0
 */

"use strict";

const { logger } = require("../utils/logger.js");

class DifferentialPrivacy {
  /**
   * @param {Object} config - DP configuration
   * @param {number} [config.epsilon=1.0] - Privacy budget
   * @param {number} [config.delta=1e-5] - Failure probability
   * @param {string} [config.mechanism='gaussian'] - Noise mechanism ('gaussian' | 'laplace')
   * @param {number} [config.clipNorm=1.0] - Gradient clipping L2 norm
   */
  constructor(config = {}) {
    this.epsilon = config.epsilon !== undefined ? config.epsilon : 1.0;
    this.delta = config.delta !== undefined ? config.delta : 1e-5;
    this.mechanism = config.mechanism || "gaussian";
    this.clipNorm = config.clipNorm !== undefined ? config.clipNorm : 1.0;
    this.totalQueries = 0;
    this.maxQueries = config.maxQueries || 1000;

    if (this.mechanism !== "gaussian" && this.mechanism !== "laplace") {
      throw new Error(
        `Invalid mechanism '${this.mechanism}', must be 'gaussian' or 'laplace'`
      );
    }

    if (this.epsilon <= 0) {
      throw new Error("Epsilon must be positive");
    }

    if (this.delta <= 0 || this.delta >= 1) {
      throw new Error("Delta must be in (0, 1)");
    }

    if (this.clipNorm <= 0) {
      throw new Error("clipNorm must be positive");
    }

    logger.info(
      `[DifferentialPrivacy] Initialized: epsilon=${this.epsilon}, delta=${this.delta}, mechanism=${this.mechanism}, clipNorm=${this.clipNorm}`
    );
  }

  /**
   * Clip gradient vector by L2 norm.
   * If the L2 norm exceeds clipNorm, the gradient is scaled down
   * so that its norm equals clipNorm.
   *
   * @param {number[]} gradients - Gradient vector
   * @param {number} [clipNorm] - Maximum L2 norm (defaults to this.clipNorm)
   * @returns {number[]} Clipped gradient vector
   */
  clipGradients(gradients, clipNorm) {
    const norm = clipNorm !== undefined ? clipNorm : this.clipNorm;

    if (!Array.isArray(gradients) || gradients.length === 0) {
      throw new Error("Gradients must be a non-empty array");
    }

    // Compute L2 norm
    let l2Norm = 0;
    for (let i = 0; i < gradients.length; i++) {
      l2Norm += gradients[i] * gradients[i];
    }
    l2Norm = Math.sqrt(l2Norm);

    // If norm is within bound, return a copy unchanged
    if (l2Norm <= norm) {
      return gradients.slice();
    }

    // Scale down the gradient
    const scale = norm / l2Norm;
    const clipped = new Array(gradients.length);
    for (let i = 0; i < gradients.length; i++) {
      clipped[i] = gradients[i] * scale;
    }

    logger.debug(
      `[DifferentialPrivacy] Clipped gradient: L2 norm ${l2Norm.toFixed(4)} -> ${norm}`
    );

    return clipped;
  }

  /**
   * Add calibrated noise to gradients based on the configured mechanism.
   *
   * For Gaussian: sigma = clipNorm * sqrt(2 * ln(1.25 / delta)) / epsilon
   * For Laplace:  scale = clipNorm / epsilon
   *
   * @param {number[]} gradients - Gradient vector (assumed already clipped)
   * @returns {number[]} Noisy gradient vector
   */
  addNoise(gradients) {
    if (!Array.isArray(gradients) || gradients.length === 0) {
      throw new Error("Gradients must be a non-empty array");
    }

    const noisy = new Array(gradients.length);

    if (this.mechanism === "gaussian") {
      const sigma =
        (this.clipNorm * Math.sqrt(2 * Math.log(1.25 / this.delta))) /
        this.epsilon;

      for (let i = 0; i < gradients.length; i++) {
        noisy[i] = gradients[i] + this._gaussianNoise(sigma);
      }

      logger.debug(
        `[DifferentialPrivacy] Added Gaussian noise with sigma=${sigma.toFixed(6)}`
      );
    } else {
      // Laplace mechanism
      const scale = this.clipNorm / this.epsilon;

      for (let i = 0; i < gradients.length; i++) {
        noisy[i] = gradients[i] + this._laplaceNoise(scale);
      }

      logger.debug(
        `[DifferentialPrivacy] Added Laplace noise with scale=${scale.toFixed(6)}`
      );
    }

    this.totalQueries += 1;

    return noisy;
  }

  /**
   * Full DP pipeline: clip gradients then add noise.
   *
   * @param {number[]} gradients - Raw gradient vector
   * @returns {number[]} Noisy clipped gradient vector
   */
  applyDP(gradients) {
    if (!Array.isArray(gradients) || gradients.length === 0) {
      throw new Error("Gradients must be a non-empty array");
    }

    const clipped = this.clipGradients(gradients);
    const noisy = this.addNoise(clipped);

    logger.info(
      `[DifferentialPrivacy] Applied DP pipeline: ${gradients.length} parameters processed`
    );

    return noisy;
  }

  /**
   * Get the remaining privacy budget information.
   *
   * @returns {Object} Privacy budget info
   */
  getPrivacyBudget() {
    // Under basic composition, each query uses epsilon of the budget.
    // The effective epsilon after k queries is k * epsilon.
    const effectiveEpsilon = this.totalQueries * this.epsilon;

    return {
      epsilon: this.epsilon,
      delta: this.delta,
      mechanism: this.mechanism,
      clipNorm: this.clipNorm,
      totalQueries: this.totalQueries,
      maxQueries: this.maxQueries,
      effectiveEpsilon: effectiveEpsilon,
      budgetRemaining:
        this.maxQueries > 0
          ? Math.max(0, 1 - this.totalQueries / this.maxQueries)
          : 1,
    };
  }

  /**
   * Generate a sample from a Gaussian (normal) distribution
   * using the Box-Muller transform.
   *
   * @param {number} sigma - Standard deviation
   * @returns {number} A random sample from N(0, sigma^2)
   */
  _gaussianNoise(sigma) {
    // Box-Muller transform: generate two uniform random numbers in (0,1)
    let u1 = 0;
    let u2 = 0;

    // Avoid log(0)
    while (u1 === 0) {
      u1 = Math.random();
    }
    while (u2 === 0) {
      u2 = Math.random();
    }

    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z * sigma;
  }

  /**
   * Generate a sample from a Laplace distribution using
   * inverse CDF sampling.
   *
   * Laplace(0, scale): F^{-1}(p) = -scale * sign(p-0.5) * ln(1-2|p-0.5|)
   *
   * @param {number} scale - Scale parameter (b) of the Laplace distribution
   * @returns {number} A random sample from Laplace(0, scale)
   */
  _laplaceNoise(scale) {
    // Generate U ~ Uniform(-0.5, 0.5), excluding 0
    let u = 0;
    while (u === 0) {
      u = Math.random() - 0.5;
    }

    // Inverse CDF of Laplace distribution
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  }
}

module.exports = { DifferentialPrivacy };
