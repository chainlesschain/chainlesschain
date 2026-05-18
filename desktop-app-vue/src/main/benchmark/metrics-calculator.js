/**
 * Metrics Calculator - Benchmark Metrics Computation Utilities
 *
 * Provides statistical and NLP-based metrics for benchmark evaluation:
 * latency statistics, BLEU, ROUGE-L, throughput, and composite scoring.
 *
 * @module benchmark/metrics-calculator
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");

/**
 * Calculate latency statistics from an array of latency measurements
 * @param {number[]} latencies - Array of latency values in milliseconds
 * @returns {Object} Latency metrics: min, max, mean, median, p95, p99, stddev
 */
function calculateLatencyMetrics(latencies) {
  if (!Array.isArray(latencies) || latencies.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p95: 0,
      p99: 0,
      stddev: 0,
      count: 0,
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  // Median
  let median;
  if (count % 2 === 0) {
    median = (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  } else {
    median = sorted[Math.floor(count / 2)];
  }

  // Percentiles using nearest-rank method
  const p95Index = Math.max(0, Math.ceil(count * 0.95) - 1);
  const p99Index = Math.max(0, Math.ceil(count * 0.99) - 1);
  const p95 = sorted[p95Index];
  const p99 = sorted[p99Index];

  // Standard deviation
  const squaredDiffs = sorted.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / count;
  const stddev = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[count - 1],
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    p95,
    p99,
    stddev: Math.round(stddev * 100) / 100,
    count,
  };
}

/**
 * Tokenize a string into lowercase words
 * @param {string} text - Input text
 * @returns {string[]} Array of tokens
 * @private
 */
function _tokenize(text) {
  if (!text || typeof text !== "string") {
    return [];
  }
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Extract n-grams from a token array
 * @param {string[]} tokens - Array of tokens
 * @param {number} n - N-gram size
 * @returns {Map<string, number>} Map of n-gram to count
 * @private
 */
function _getNgrams(tokens, n) {
  const ngrams = new Map();
  for (let i = 0; i <= tokens.length - n; i++) {
    const ngram = tokens.slice(i, i + n).join(" ");
    ngrams.set(ngram, (ngrams.get(ngram) || 0) + 1);
  }
  return ngrams;
}

/**
 * Calculate a simplified BLEU score (unigram + bigram) between reference and candidate
 *
 * Uses modified precision with clipping, combined unigram (weight 0.5) and
 * bigram (weight 0.5) precision, and a brevity penalty.
 *
 * @param {string} reference - Expected/reference text
 * @param {string} candidate - Generated/candidate text
 * @returns {number} BLEU score between 0 and 1
 */
function calculateBLEU(reference, candidate) {
  if (!reference || !candidate) {
    return 0;
  }

  if (typeof reference !== "string" || typeof candidate !== "string") {
    return 0;
  }

  const refTokens = _tokenize(reference);
  const candTokens = _tokenize(candidate);

  if (refTokens.length === 0 || candTokens.length === 0) {
    return 0;
  }

  // Identical text => perfect score
  if (reference.toLowerCase().trim() === candidate.toLowerCase().trim()) {
    return 1;
  }

  // Calculate modified precision for n=1 and n=2
  const precisions = [];

  for (const n of [1, 2]) {
    const refNgrams = _getNgrams(refTokens, n);
    const candNgrams = _getNgrams(candTokens, n);

    if (candNgrams.size === 0) {
      precisions.push(0);
      continue;
    }

    let clippedCount = 0;
    let totalCount = 0;

    for (const [ngram, candCount] of candNgrams) {
      const refCount = refNgrams.get(ngram) || 0;
      clippedCount += Math.min(candCount, refCount);
      totalCount += candCount;
    }

    precisions.push(totalCount > 0 ? clippedCount / totalCount : 0);
  }

  // Geometric mean of precisions (with smoothing for zero values)
  const weights = [0.5, 0.5];
  let logSum = 0;
  let hasZero = false;

  for (let i = 0; i < precisions.length; i++) {
    if (precisions[i] === 0) {
      hasZero = true;
      break;
    }
    logSum += weights[i] * Math.log(precisions[i]);
  }

  if (hasZero) {
    // Apply smoothing: use only unigram precision if bigram is zero
    if (precisions[0] > 0) {
      logSum = Math.log(precisions[0]);
    } else {
      return 0;
    }
  }

  const geometricMean = Math.exp(logSum);

  // Brevity penalty
  const brevityPenalty =
    candTokens.length >= refTokens.length
      ? 1
      : Math.exp(1 - refTokens.length / candTokens.length);

  const bleu = brevityPenalty * geometricMean;

  return Math.round(Math.min(1, Math.max(0, bleu)) * 10000) / 10000;
}

/**
 * Calculate ROUGE-L score using Longest Common Subsequence
 *
 * ROUGE-L computes F-measure based on the LCS between reference and candidate.
 *
 * @param {string} reference - Expected/reference text
 * @param {string} candidate - Generated/candidate text
 * @returns {number} ROUGE-L F1 score between 0 and 1
 */
function calculateROUGEL(reference, candidate) {
  if (!reference || !candidate) {
    return 0;
  }

  if (typeof reference !== "string" || typeof candidate !== "string") {
    return 0;
  }

  const refTokens = _tokenize(reference);
  const candTokens = _tokenize(candidate);

  if (refTokens.length === 0 || candTokens.length === 0) {
    return 0;
  }

  // Identical text => perfect score
  if (reference.toLowerCase().trim() === candidate.toLowerCase().trim()) {
    return 1;
  }

  // Compute LCS length using dynamic programming
  const lcsLength = _computeLCSLength(refTokens, candTokens);

  if (lcsLength === 0) {
    return 0;
  }

  // Precision and recall
  const precision = lcsLength / candTokens.length;
  const recall = lcsLength / refTokens.length;

  // F1 score
  if (precision + recall === 0) {
    return 0;
  }

  const f1 = (2 * precision * recall) / (precision + recall);

  return Math.round(Math.min(1, Math.max(0, f1)) * 10000) / 10000;
}

/**
 * Compute the length of the Longest Common Subsequence between two token arrays
 * @param {string[]} a - First token array
 * @param {string[]} b - Second token array
 * @returns {number} LCS length
 * @private
 */
function _computeLCSLength(a, b) {
  const m = a.length;
  const n = b.length;

  // Use 2-row optimization for memory efficiency
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    // Swap rows
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

/**
 * Calculate throughput in tokens per second
 * @param {number} totalTokens - Total tokens processed
 * @param {number} totalTimeMs - Total time in milliseconds
 * @returns {number} Tokens per second (rounded to 2 decimal places)
 */
function calculateThroughput(totalTokens, totalTimeMs) {
  if (!totalTokens || !totalTimeMs || totalTimeMs <= 0) {
    return 0;
  }

  const tokensPerSecond = (totalTokens / totalTimeMs) * 1000;
  return Math.round(tokensPerSecond * 100) / 100;
}

/**
 * Calculate a weighted overall score from various metrics
 *
 * Scoring weights:
 * - Latency (lower is better): 30% - based on inverse of mean latency
 * - Quality (BLEU avg): 25%
 * - Quality (ROUGE-L avg): 20%
 * - Throughput: 15%
 * - Success rate: 10%
 *
 * @param {Object} metrics - Aggregated metrics
 * @param {Object} [metrics.latency] - Latency metrics with mean
 * @param {number|null} [metrics.avgBleu] - Average BLEU score
 * @param {number|null} [metrics.avgRougeL] - Average ROUGE-L score
 * @param {number} [metrics.throughput] - Tokens per second
 * @param {number} [metrics.successRate] - Success rate (0-1)
 * @returns {number} Overall score between 0 and 100
 */
function calculateOverallScore(metrics) {
  if (!metrics) {
    return 0;
  }

  let score = 0;
  let totalWeight = 0;

  // Latency score: inverse mapping (lower latency = higher score)
  // 0ms = 100, 1000ms = 50, 5000ms+ = 0
  if (metrics.latency && metrics.latency.mean > 0) {
    const meanLatency = metrics.latency.mean;
    let latencyScore;
    if (meanLatency <= 100) {
      latencyScore = 100;
    } else if (meanLatency >= 5000) {
      latencyScore = 0;
    } else {
      latencyScore = Math.max(0, 100 - (meanLatency / 5000) * 100);
    }
    score += latencyScore * 0.3;
    totalWeight += 0.3;
  }

  // BLEU score contribution
  if (metrics.avgBleu !== null && metrics.avgBleu !== undefined) {
    score += metrics.avgBleu * 100 * 0.25;
    totalWeight += 0.25;
  }

  // ROUGE-L score contribution
  if (metrics.avgRougeL !== null && metrics.avgRougeL !== undefined) {
    score += metrics.avgRougeL * 100 * 0.2;
    totalWeight += 0.2;
  }

  // Throughput score: normalize to 0-100 range (50 tok/s = 100 score)
  if (metrics.throughput > 0) {
    const throughputScore = Math.min(100, (metrics.throughput / 50) * 100);
    score += throughputScore * 0.15;
    totalWeight += 0.15;
  }

  // Success rate contribution
  if (metrics.successRate !== undefined && metrics.successRate !== null) {
    score += metrics.successRate * 100 * 0.1;
    totalWeight += 0.1;
  }

  // Normalize by actual weight used (in case some metrics are missing)
  if (totalWeight > 0) {
    score = score / totalWeight;
  }

  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

module.exports = {
  calculateLatencyMetrics,
  calculateBLEU,
  calculateROUGEL,
  calculateThroughput,
  calculateOverallScore,
};
