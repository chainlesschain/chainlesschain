import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import mod from "../webrtc-quality-monitor.js";
const { WebRTCQualityMonitor, QualityLevel } = mod;

// p2pManager is unused by the pure scoring methods — pass null.
const mk = (opts) => new WebRTCQualityMonitor(null, opts);

// Build a stats sample. calculateMetrics reads packetsSent/packetsLost/rtt/
// jitter/bytesReceived/timestamp.
const stat = (o = {}) => ({
  packetsSent: 0,
  packetsLost: 0,
  rtt: 0,
  jitter: 0,
  bytesReceived: 0,
  timestamp: 0,
  ...o,
});

describe("WebRTCQualityMonitor", () => {
  describe("calculateMetrics", () => {
    const m = mk();
    it("returns zeros with fewer than 2 samples", () => {
      expect(m.calculateMetrics([])).toEqual({
        packetLoss: 0,
        rtt: 0,
        jitter: 0,
        bandwidth: 0,
      });
      expect(m.calculateMetrics([stat({ rtt: 99 })])).toEqual({
        packetLoss: 0,
        rtt: 0,
        jitter: 0,
        bandwidth: 0,
      });
    });

    it("computes packet loss from the inter-sample delta", () => {
      const r = m.calculateMetrics([
        stat({ packetsSent: 0, packetsLost: 0 }),
        stat({ packetsSent: 100, packetsLost: 5, rtt: 40, jitter: 7 }),
      ]);
      expect(r.packetLoss).toBe(5); // 5 lost / 100 sent
      expect(r.rtt).toBe(40);
      expect(r.jitter).toBe(7);
    });

    it("guards a zero or reset packetsSent delta (no divide-by-zero / no negative)", () => {
      // no new packets sent
      expect(
        m.calculateMetrics([
          stat({ packetsSent: 100 }),
          stat({ packetsSent: 100, packetsLost: 9 }),
        ]).packetLoss,
      ).toBe(0);
      // counters reset (latest < previous)
      expect(
        m.calculateMetrics([
          stat({ packetsSent: 500 }),
          stat({ packetsSent: 10 }),
        ]).packetLoss,
      ).toBe(0);
    });

    it("computes bandwidth (bits/s) and guards a zero time delta", () => {
      const r = m.calculateMetrics([
        stat({ bytesReceived: 0, timestamp: 0 }),
        stat({ bytesReceived: 1000, timestamp: 1000 }), // +1000 bytes over 1s
      ]);
      expect(r.bandwidth).toBe(8000); // 1000 bytes * 8 / 1s
      // same timestamp -> no divide-by-zero
      expect(
        m.calculateMetrics([
          stat({ bytesReceived: 0, timestamp: 5 }),
          stat({ bytesReceived: 1000, timestamp: 5 }),
        ]).bandwidth,
      ).toBe(0);
    });
  });

  describe("calculateQuality", () => {
    const m = mk();
    const pair = (latest) => [stat(), stat({ packetsSent: 100, ...latest })];

    it("defaults to GOOD with no samples", () => {
      expect(m.calculateQuality([])).toBe(QualityLevel.GOOD);
    });

    it("scores a clean connection EXCELLENT", () => {
      expect(m.calculateQuality(pair({ packetsLost: 0, rtt: 50, jitter: 10 }))).toBe(
        QualityLevel.EXCELLENT,
      );
    });

    it("maps each score band", () => {
      // loss 3% (-15) + rtt 200 (-10) = 75 -> GOOD
      expect(m.calculateQuality(pair({ packetsLost: 3, rtt: 200 }))).toBe(
        QualityLevel.GOOD,
      );
      // loss 6% (-30) + jitter 60 (-20) = 50 -> FAIR
      expect(m.calculateQuality(pair({ packetsLost: 6, jitter: 60 }))).toBe(
        QualityLevel.FAIR,
      );
      // loss 6% (-30) + rtt 550 (-30) = 40 -> POOR
      expect(m.calculateQuality(pair({ packetsLost: 6, rtt: 550 }))).toBe(
        QualityLevel.POOR,
      );
      // loss 12% (-40) + rtt 550 (-30) + jitter 110 (-30) = 0 -> CRITICAL
      expect(
        m.calculateQuality(pair({ packetsLost: 12, rtt: 550, jitter: 110 })),
      ).toBe(QualityLevel.CRITICAL);
    });
  });

  describe("getOptimizationSuggestions", () => {
    it("returns [] for an unknown peer", () => {
      expect(mk().getOptimizationSuggestions("nobody")).toEqual([]);
    });

    it("surfaces high-loss / high-rtt / high-jitter suggestions", () => {
      const m = mk();
      m.processStats("p", stat());
      m.processStats("p", stat({ packetsSent: 100, packetsLost: 8, rtt: 400, jitter: 70, bytesReceived: 1e6, timestamp: 1000 }));
      const issues = m.getOptimizationSuggestions("p").map((s) => s.issue);
      expect(issues).toContain("高丢包率");
      expect(issues).toContain("高延迟");
      expect(issues).toContain("高抖动");
    });

    it("flags a spurious low-bandwidth tip when there is no throughput data (documents quirk)", () => {
      // A single sample => calculateMetrics returns bandwidth: 0, which is < the
      // 100000 threshold, so a brand-new connection always gets a "低带宽 /
      // upgrade your plan" suggestion even though bandwidth is simply unknown.
      const m = mk();
      m.processStats("fresh", stat({ rtt: 20 }));
      const issues = m.getOptimizationSuggestions("fresh").map((s) => s.issue);
      expect(issues).toContain("低带宽");
    });
  });
});
