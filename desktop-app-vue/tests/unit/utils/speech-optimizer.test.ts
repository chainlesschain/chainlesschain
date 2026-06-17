/**
 * speech-optimizer 测试 — src/renderer/utils/speech-optimizer.ts
 *
 * Pure DSP (normalizeVolume / applyNoiseReduction), the recognition cache
 * (save/check/clear/cleanupExpired), and metrics (recordRecognitionTime /
 * getMetrics). Fresh instances via the named class (the singleton starts an
 * auto-cleanup interval on import; we don't). logger mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { SpeechPerformanceOptimizer } from "@/utils/speech-optimizer";

let opt: SpeechPerformanceOptimizer;
beforeEach(() => {
  opt = new SpeechPerformanceOptimizer();
});
afterEach(() => {
  opt.destroy();
});

describe("speech-optimizer — DSP", () => {
  it("normalizeVolume scales the peak amplitude to 0.9", () => {
    const out = opt.normalizeVolume(new Float32Array([0.5, -0.25, 0]));
    expect(out[0]).toBeCloseTo(0.9, 5);
    expect(out[1]).toBeCloseTo(-0.45, 5);
    expect(out[2]).toBeCloseTo(0, 5);
  });

  it("normalizeVolume returns silence unchanged", () => {
    const silent = new Float32Array([0, 0, 0]);
    expect(opt.normalizeVolume(silent)).toBe(silent); // no scaling when peak is 0
  });

  it("applyNoiseReduction high-pass filters (first sample preserved)", () => {
    const out = opt.applyNoiseReduction(new Float32Array([1, 1, 1]));
    expect(out).toBeInstanceOf(Float32Array);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0.95, 5); // 0.95*(1 + 1 - 1)
  });
});

describe("speech-optimizer — cache", () => {
  it("save/check round-trips and counts a hit; misses return null", () => {
    opt.saveToCache("hash-a", "hello");
    const hit = opt.checkCache("hash-a");
    expect(hit?.result).toBe("hello");
    expect(opt.checkCache("missing")).toBeNull();
    expect(opt.getMetrics().cacheHits).toBe(1);
  });

  it("clearCache empties; cleanupExpiredCache drops aged entries", () => {
    opt.saveToCache("a", "x");
    opt.saveToCache("b", "y");
    opt.cleanupExpiredCache(-1); // maxAge -1 → every entry counts as expired
    expect(opt.checkCache("a")).toBeNull();
    opt.saveToCache("c", "z");
    opt.clearCache();
    expect(opt.getMetrics().cacheSize).toBe(0);
  });
});

describe("speech-optimizer — metrics", () => {
  it("recordRecognitionTime tracks count + running average; getMetrics reports", () => {
    opt.recordRecognitionTime(100);
    opt.recordRecognitionTime(300);
    opt.saveToCache("k", "v");
    opt.checkCache("k"); // one hit
    const m = opt.getMetrics();
    expect(m.totalRecognitions).toBe(2);
    expect(m.averageRecognitionTime).toBe(200);
    expect(m.cacheSize).toBe(1);
    expect(m.cacheHitRate).toBe("50.00%"); // 1 hit / 2 recognitions
  });
});
