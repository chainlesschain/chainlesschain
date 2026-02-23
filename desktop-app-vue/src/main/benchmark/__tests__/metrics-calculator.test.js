/**
 * MetricsCalculator Unit Tests
 *
 * Covers:
 * - calculateLatencyMetrics: min, max, mean, median, p95, p99, stddev
 * - calculateBLEU: unigram + bigram scoring, brevity penalty
 * - calculateROUGEL: LCS-based F1 scoring
 * - calculateThroughput: tokens per second
 * - calculateOverallScore: weighted composite
 * - Edge cases: empty inputs, identical strings, null/undefined, single values
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  calculateLatencyMetrics,
  calculateBLEU,
  calculateROUGEL,
  calculateThroughput,
  calculateOverallScore,
} = require("../metrics-calculator.js");

// ----------------------------------------------------------------
// calculateLatencyMetrics
// ----------------------------------------------------------------

describe("calculateLatencyMetrics", () => {
  it("returns zeroed metrics for empty array", () => {
    const result = calculateLatencyMetrics([]);
    expect(result.min).toBe(0);
    expect(result.max).toBe(0);
    expect(result.mean).toBe(0);
    expect(result.median).toBe(0);
    expect(result.p95).toBe(0);
    expect(result.p99).toBe(0);
    expect(result.stddev).toBe(0);
    expect(result.count).toBe(0);
  });

  it("returns zeroed metrics for null input", () => {
    const result = calculateLatencyMetrics(null);
    expect(result.count).toBe(0);
  });

  it("returns zeroed metrics for undefined input", () => {
    const result = calculateLatencyMetrics(undefined);
    expect(result.count).toBe(0);
  });

  it("calculates correctly for single value", () => {
    const result = calculateLatencyMetrics([100]);
    expect(result.min).toBe(100);
    expect(result.max).toBe(100);
    expect(result.mean).toBe(100);
    expect(result.median).toBe(100);
    expect(result.p95).toBe(100);
    expect(result.p99).toBe(100);
    expect(result.stddev).toBe(0);
    expect(result.count).toBe(1);
  });

  it("calculates correct median for even-count array", () => {
    const result = calculateLatencyMetrics([100, 200, 300, 400]);
    expect(result.median).toBe(250);
  });

  it("calculates correct median for odd-count array", () => {
    const result = calculateLatencyMetrics([100, 200, 300, 400, 500]);
    expect(result.median).toBe(300);
  });

  it("calculates min and max correctly", () => {
    const result = calculateLatencyMetrics([500, 100, 300, 200, 400]);
    expect(result.min).toBe(100);
    expect(result.max).toBe(500);
  });

  it("calculates mean correctly", () => {
    const result = calculateLatencyMetrics([100, 200, 300]);
    expect(result.mean).toBe(200);
  });

  it("calculates standard deviation correctly", () => {
    // Values: 10, 20, 30. Mean = 20. Variance = (100+0+100)/3 = 66.67
    // stddev = sqrt(66.67) ~ 8.16
    const result = calculateLatencyMetrics([10, 20, 30]);
    expect(result.stddev).toBeCloseTo(8.16, 1);
  });

  it("calculates p95 and p99 for large dataset", () => {
    // 100 values from 1 to 100
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = calculateLatencyMetrics(latencies);
    expect(result.p95).toBe(95);
    expect(result.p99).toBe(99);
    expect(result.count).toBe(100);
  });

  it("handles all-same values", () => {
    const result = calculateLatencyMetrics([50, 50, 50, 50]);
    expect(result.min).toBe(50);
    expect(result.max).toBe(50);
    expect(result.mean).toBe(50);
    expect(result.median).toBe(50);
    expect(result.stddev).toBe(0);
  });
});

// ----------------------------------------------------------------
// calculateBLEU
// ----------------------------------------------------------------

describe("calculateBLEU", () => {
  it("returns 0 for null reference", () => {
    expect(calculateBLEU(null, "hello")).toBe(0);
  });

  it("returns 0 for null candidate", () => {
    expect(calculateBLEU("hello", null)).toBe(0);
  });

  it("returns 0 for empty reference", () => {
    expect(calculateBLEU("", "hello")).toBe(0);
  });

  it("returns 0 for empty candidate", () => {
    expect(calculateBLEU("hello", "")).toBe(0);
  });

  it("returns 0 for non-string inputs", () => {
    expect(calculateBLEU(123, "hello")).toBe(0);
    expect(calculateBLEU("hello", 456)).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(calculateBLEU("hello world", "hello world")).toBe(1);
  });

  it("returns 1 for case-insensitive identical strings", () => {
    expect(calculateBLEU("Hello World", "hello world")).toBe(1);
  });

  it("returns score > 0 for partial match", () => {
    const score = calculateBLEU("the cat sat on the mat", "the cat on the mat");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns 0 for completely unrelated text", () => {
    const score = calculateBLEU("hello world", "goodbye universe");
    expect(score).toBe(0);
  });

  it("applies brevity penalty for short candidates", () => {
    const longScore = calculateBLEU(
      "the cat sat on the mat",
      "the cat sat on the mat"
    );
    const shortScore = calculateBLEU("the cat sat on the mat", "the cat");
    expect(shortScore).toBeLessThan(longScore);
  });

  it("handles punctuation gracefully", () => {
    const score = calculateBLEU(
      "Buenos días, ¿cómo estás?",
      "Buenos días, ¿cómo estás?"
    );
    expect(score).toBe(1);
  });

  it("scores higher for better matches", () => {
    const reference = "the quick brown fox jumps over the lazy dog";
    const good = "the quick brown fox jumps over a lazy dog";
    const bad = "a slow red cat sits under an active cat";

    const goodScore = calculateBLEU(reference, good);
    const badScore = calculateBLEU(reference, bad);
    expect(goodScore).toBeGreaterThan(badScore);
  });
});

// ----------------------------------------------------------------
// calculateROUGEL
// ----------------------------------------------------------------

describe("calculateROUGEL", () => {
  it("returns 0 for null reference", () => {
    expect(calculateROUGEL(null, "hello")).toBe(0);
  });

  it("returns 0 for null candidate", () => {
    expect(calculateROUGEL("hello", null)).toBe(0);
  });

  it("returns 0 for empty reference", () => {
    expect(calculateROUGEL("", "hello")).toBe(0);
  });

  it("returns 0 for empty candidate", () => {
    expect(calculateROUGEL("hello", "")).toBe(0);
  });

  it("returns 0 for non-string inputs", () => {
    expect(calculateROUGEL(123, "hello")).toBe(0);
    expect(calculateROUGEL("hello", 456)).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(calculateROUGEL("hello world", "hello world")).toBe(1);
  });

  it("returns 1 for case-insensitive identical strings", () => {
    expect(calculateROUGEL("Hello World", "hello world")).toBe(1);
  });

  it("returns score > 0 for partial match", () => {
    const score = calculateROUGEL(
      "the cat sat on the mat",
      "the cat was on a mat"
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns 0 for completely unrelated text", () => {
    const score = calculateROUGEL("hello world", "goodbye universe");
    expect(score).toBe(0);
  });

  it("handles single word overlap", () => {
    const score = calculateROUGEL("hello beautiful world", "hello cruel universe");
    expect(score).toBeGreaterThan(0);
  });

  it("scores higher for longer common subsequences", () => {
    const reference = "the quick brown fox jumps over the lazy dog";
    const good = "the quick brown fox leaps over the lazy dog";
    const bad = "the fox dog";

    const goodScore = calculateROUGEL(reference, good);
    const badScore = calculateROUGEL(reference, bad);
    expect(goodScore).toBeGreaterThan(badScore);
  });

  it("handles CJK characters", () => {
    const score = calculateROUGEL("机器学习很迷人", "机器学习很迷人");
    expect(score).toBe(1);
  });
});

// ----------------------------------------------------------------
// calculateThroughput
// ----------------------------------------------------------------

describe("calculateThroughput", () => {
  it("returns 0 for zero tokens", () => {
    expect(calculateThroughput(0, 1000)).toBe(0);
  });

  it("returns 0 for zero time", () => {
    expect(calculateThroughput(100, 0)).toBe(0);
  });

  it("returns 0 for negative time", () => {
    expect(calculateThroughput(100, -500)).toBe(0);
  });

  it("returns 0 for null inputs", () => {
    expect(calculateThroughput(null, 1000)).toBe(0);
    expect(calculateThroughput(100, null)).toBe(0);
  });

  it("returns 0 for undefined inputs", () => {
    expect(calculateThroughput(undefined, 1000)).toBe(0);
    expect(calculateThroughput(100, undefined)).toBe(0);
  });

  it("calculates correct tokens per second", () => {
    // 100 tokens in 1000ms = 100 tokens/sec
    expect(calculateThroughput(100, 1000)).toBe(100);
  });

  it("calculates correct throughput for sub-second durations", () => {
    // 50 tokens in 500ms = 100 tokens/sec
    expect(calculateThroughput(50, 500)).toBe(100);
  });

  it("rounds to 2 decimal places", () => {
    // 100 tokens in 3000ms = 33.333... tokens/sec
    expect(calculateThroughput(100, 3000)).toBe(33.33);
  });

  it("handles very high throughput", () => {
    // 10000 tokens in 100ms = 100000 tokens/sec
    expect(calculateThroughput(10000, 100)).toBe(100000);
  });
});

// ----------------------------------------------------------------
// calculateOverallScore
// ----------------------------------------------------------------

describe("calculateOverallScore", () => {
  it("returns 0 for null metrics", () => {
    expect(calculateOverallScore(null)).toBe(0);
  });

  it("returns 0 for undefined metrics", () => {
    expect(calculateOverallScore(undefined)).toBe(0);
  });

  it("returns 0 for empty metrics", () => {
    expect(calculateOverallScore({})).toBe(0);
  });

  it("returns score between 0 and 100", () => {
    const score = calculateOverallScore({
      latency: { mean: 500 },
      avgBleu: 0.7,
      avgRougeL: 0.65,
      throughput: 25,
      successRate: 0.95,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("gives higher score for lower latency", () => {
    const fast = calculateOverallScore({
      latency: { mean: 100 },
    });
    const slow = calculateOverallScore({
      latency: { mean: 4000 },
    });
    expect(fast).toBeGreaterThan(slow);
  });

  it("gives maximum latency score for very fast responses", () => {
    const score = calculateOverallScore({
      latency: { mean: 50 },
    });
    expect(score).toBe(100);
  });

  it("gives zero latency component for very slow responses", () => {
    const score = calculateOverallScore({
      latency: { mean: 6000 },
    });
    // Only latency contributes, and it's 0 for >= 5000ms
    expect(score).toBe(0);
  });

  it("handles partial metrics (only BLEU)", () => {
    const score = calculateOverallScore({
      avgBleu: 0.8,
    });
    // 0.8 * 100 = 80 (full weight goes to BLEU since it's the only metric)
    expect(score).toBe(80);
  });

  it("handles partial metrics (only throughput)", () => {
    const score = calculateOverallScore({
      throughput: 50,
    });
    // 50 tok/s maps to 100 score
    expect(score).toBe(100);
  });

  it("handles partial metrics (only success rate)", () => {
    const score = calculateOverallScore({
      successRate: 1.0,
    });
    expect(score).toBe(100);
  });

  it("handles all metrics combined for a high-quality model", () => {
    const score = calculateOverallScore({
      latency: { mean: 200 },
      avgBleu: 0.9,
      avgRougeL: 0.85,
      throughput: 40,
      successRate: 0.98,
    });
    expect(score).toBeGreaterThan(70);
  });

  it("handles all metrics combined for a low-quality model", () => {
    const score = calculateOverallScore({
      latency: { mean: 4500 },
      avgBleu: 0.1,
      avgRougeL: 0.1,
      throughput: 2,
      successRate: 0.5,
    });
    expect(score).toBeLessThan(30);
  });

  it("ignores null avgBleu and avgRougeL", () => {
    const scoreWithNull = calculateOverallScore({
      latency: { mean: 300 },
      avgBleu: null,
      avgRougeL: null,
      throughput: 30,
      successRate: 0.9,
    });

    // Should still return a valid score using the remaining metrics
    expect(scoreWithNull).toBeGreaterThan(0);
    expect(scoreWithNull).toBeLessThanOrEqual(100);
  });
});
