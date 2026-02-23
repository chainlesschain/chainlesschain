/**
 * Gradient Aggregator
 *
 * Implements Federated Averaging (FedAvg) and FedProx aggregation
 * algorithms for combining local model updates from multiple
 * participants in a federated learning round.
 *
 * @module federated/gradient-aggregator
 * @version 1.0.0
 */

"use strict";

const { logger } = require("../utils/logger.js");

class GradientAggregator {
  /**
   * Federated Averaging (FedAvg) aggregation.
   *
   * Computes the weighted average of all participant gradients,
   * where weights are typically proportional to local sample counts.
   *
   * @param {number[][]} gradients - Array of gradient arrays (one per participant)
   * @param {number[]} weights - Array of weights for each participant
   * @returns {number[]} Aggregated gradient array
   */
  aggregateFedAvg(gradients, weights) {
    if (!gradients || gradients.length === 0) {
      throw new Error("Gradients array must be non-empty");
    }

    if (!weights || weights.length !== gradients.length) {
      throw new Error("Weights array must have same length as gradients");
    }

    const validation = this.validateGradients(gradients);
    if (!validation.valid) {
      throw new Error(
        `Invalid gradients: ${validation.errors.join("; ")}`
      );
    }

    const dim = gradients[0].length;
    const numParticipants = gradients.length;

    // Normalize weights so they sum to 1
    let totalWeight = 0;
    for (let i = 0; i < numParticipants; i++) {
      totalWeight += weights[i];
    }

    if (totalWeight === 0) {
      throw new Error("Total weight must be non-zero");
    }

    const normalizedWeights = new Array(numParticipants);
    for (let i = 0; i < numParticipants; i++) {
      normalizedWeights[i] = weights[i] / totalWeight;
    }

    // Compute weighted average
    const aggregated = new Array(dim).fill(0);
    for (let i = 0; i < numParticipants; i++) {
      for (let j = 0; j < dim; j++) {
        aggregated[j] += gradients[i][j] * normalizedWeights[i];
      }
    }

    logger.info(
      `[GradientAggregator] FedAvg aggregation complete: ${numParticipants} participants, ${dim} parameters`
    );

    return aggregated;
  }

  /**
   * FedProx aggregation.
   *
   * Like FedAvg but adds a proximal regularization term that penalizes
   * deviation from the global model: mu/2 * ||w - w_global||^2.
   * This helps with heterogeneous data distributions.
   *
   * @param {number[][]} gradients - Array of gradient arrays (one per participant)
   * @param {number[]} weights - Array of weights for each participant
   * @param {number[]} globalModel - Current global model parameters
   * @param {number} [mu=0.01] - Proximal term coefficient
   * @returns {number[]} Aggregated gradient array with proximal regularization
   */
  aggregateFedProx(gradients, weights, globalModel, mu = 0.01) {
    if (!gradients || gradients.length === 0) {
      throw new Error("Gradients array must be non-empty");
    }

    if (!weights || weights.length !== gradients.length) {
      throw new Error("Weights array must have same length as gradients");
    }

    if (!globalModel || globalModel.length === 0) {
      throw new Error("Global model must be a non-empty array");
    }

    const validation = this.validateGradients(gradients);
    if (!validation.valid) {
      throw new Error(
        `Invalid gradients: ${validation.errors.join("; ")}`
      );
    }

    const dim = gradients[0].length;

    if (globalModel.length !== dim) {
      throw new Error(
        `Global model dimension (${globalModel.length}) must match gradient dimension (${dim})`
      );
    }

    const numParticipants = gradients.length;

    // First compute FedAvg
    let totalWeight = 0;
    for (let i = 0; i < numParticipants; i++) {
      totalWeight += weights[i];
    }

    if (totalWeight === 0) {
      throw new Error("Total weight must be non-zero");
    }

    const normalizedWeights = new Array(numParticipants);
    for (let i = 0; i < numParticipants; i++) {
      normalizedWeights[i] = weights[i] / totalWeight;
    }

    // Compute weighted average (same as FedAvg)
    const avgGradient = new Array(dim).fill(0);
    for (let i = 0; i < numParticipants; i++) {
      for (let j = 0; j < dim; j++) {
        avgGradient[j] += gradients[i][j] * normalizedWeights[i];
      }
    }

    // Apply proximal term: adjusted = avg_gradient + mu * (avg_gradient - globalModel)
    // The proximal regularization biases the result toward the global model
    const aggregated = new Array(dim);
    for (let j = 0; j < dim; j++) {
      aggregated[j] = avgGradient[j] + mu * (avgGradient[j] - globalModel[j]);
    }

    logger.info(
      `[GradientAggregator] FedProx aggregation complete: ${numParticipants} participants, ${dim} parameters, mu=${mu}`
    );

    return aggregated;
  }

  /**
   * Validate gradient format and dimensions.
   *
   * Checks that all gradients have the same length and do not
   * contain NaN or Infinity values.
   *
   * @param {number[][]} gradients - Array of gradient arrays
   * @returns {{ valid: boolean, errors: string[] }} Validation result
   */
  validateGradients(gradients) {
    const errors = [];

    if (!Array.isArray(gradients)) {
      return { valid: false, errors: ["Gradients must be an array"] };
    }

    if (gradients.length === 0) {
      return { valid: false, errors: ["Gradients array is empty"] };
    }

    const expectedDim = gradients[0].length;

    if (expectedDim === 0) {
      errors.push("Gradient dimension must be non-zero");
    }

    for (let i = 0; i < gradients.length; i++) {
      if (!Array.isArray(gradients[i])) {
        errors.push(`Gradient at index ${i} is not an array`);
        continue;
      }

      if (gradients[i].length !== expectedDim) {
        errors.push(
          `Dimension mismatch at index ${i}: expected ${expectedDim}, got ${gradients[i].length}`
        );
      }

      for (let j = 0; j < gradients[i].length; j++) {
        if (typeof gradients[i][j] !== "number") {
          errors.push(
            `Non-numeric value at gradient[${i}][${j}]: ${typeof gradients[i][j]}`
          );
        } else if (Number.isNaN(gradients[i][j])) {
          errors.push(`NaN value at gradient[${i}][${j}]`);
        } else if (!Number.isFinite(gradients[i][j])) {
          errors.push(`Infinity value at gradient[${i}][${j}]`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  /**
   * Compute contribution scores for each participant.
   *
   * Scores are based on cosine similarity between each individual
   * gradient and the aggregated result. Higher similarity means the
   * participant contributed more consistently with the consensus.
   *
   * @param {number[][]} gradients - Array of gradient arrays (one per participant)
   * @param {number[]} aggregated - The aggregated gradient result
   * @returns {number[]} Array of contribution scores in [0, 1]
   */
  computeContributionScores(gradients, aggregated) {
    if (!gradients || gradients.length === 0) {
      throw new Error("Gradients array must be non-empty");
    }

    if (!aggregated || aggregated.length === 0) {
      throw new Error("Aggregated gradient must be non-empty");
    }

    const scores = new Array(gradients.length);

    // Compute L2 norm of aggregated gradient
    let aggNorm = 0;
    for (let j = 0; j < aggregated.length; j++) {
      aggNorm += aggregated[j] * aggregated[j];
    }
    aggNorm = Math.sqrt(aggNorm);

    for (let i = 0; i < gradients.length; i++) {
      if (gradients[i].length !== aggregated.length) {
        scores[i] = 0;
        continue;
      }

      // Compute dot product and L2 norm of this gradient
      let dotProduct = 0;
      let gradNorm = 0;
      for (let j = 0; j < aggregated.length; j++) {
        dotProduct += gradients[i][j] * aggregated[j];
        gradNorm += gradients[i][j] * gradients[i][j];
      }
      gradNorm = Math.sqrt(gradNorm);

      // Cosine similarity = dot(a, b) / (||a|| * ||b||)
      if (gradNorm === 0 || aggNorm === 0) {
        scores[i] = 0;
      } else {
        const cosineSim = dotProduct / (gradNorm * aggNorm);
        // Clamp to [0, 1]: cosine similarity is in [-1, 1], but
        // negative contributions are scored as 0
        scores[i] = Math.max(0, Math.min(1, cosineSim));
      }
    }

    logger.info(
      `[GradientAggregator] Computed contribution scores for ${gradients.length} participants`
    );

    return scores;
  }
}

module.exports = { GradientAggregator };
