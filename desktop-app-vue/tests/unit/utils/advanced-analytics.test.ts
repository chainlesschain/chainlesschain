/**
 * advanced-analytics 测试 — src/renderer/utils/advanced-analytics.ts
 *
 * Singleton that tracks events/features/errors and derives a summary/report.
 * Its dependency singletons (predictive-prefetcher, adaptive-performance) are
 * mocked; stop() halts the collection intervals/listeners and clearData()
 * isolates each test.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/utils/predictive-prefetcher", () => ({
  default: { getStats: () => ({ prefetched: 0 }) },
}));
vi.mock("@/utils/adaptive-performance", () => ({
  default: { getStats: () => ({ tier: "high" }) },
}));

import analytics, {
  ADVANCED_ANALYTICS_LIMITS,
} from "@/utils/advanced-analytics";

beforeAll(() => analytics.stop()); // halt the constructor's intervals + listeners
beforeEach(() => {
  analytics.clearData();
  localStorage.clear();
});

describe("advanced-analytics — trackEvent", () => {
  it("records events and routes file- events into userBehavior", () => {
    analytics.trackEvent("file-open", { path: "a.ts" });
    analytics.trackEvent("file-edit", { path: "a.ts" });
    analytics.trackEvent("click");
    expect(analytics.getSummary().eventsTracked).toBe(3);
    expect(analytics.exportData().userBehavior.fileEdits).toHaveLength(2);
  });

  it("bounds retained events, distinct types, and individual payloads", () => {
    analytics.trackEvent("large", {
      payload: "x".repeat(ADVANCED_ANALYTICS_LIMITS.maxEventDataBytes + 1),
    });
    expect(analytics.exportData().events.at(-1)?.data).toEqual({
      dropped: true,
      reason: "PAYLOAD_TOO_LARGE",
    });

    for (
      let index = 0;
      index < ADVANCED_ANALYTICS_LIMITS.maxEventTypes + 20;
      index += 1
    ) {
      analytics.trackEvent(`type-${index}`);
    }
    const internal = analytics as unknown as {
      eventTypes: Map<string, number>;
    };
    expect(internal.eventTypes.size).toBeLessThanOrEqual(
      ADVANCED_ANALYTICS_LIMITS.maxEventTypes,
    );
    expect(internal.eventTypes.get("__overflow__")).toBeGreaterThan(0);

    for (
      let index = 0;
      index < ADVANCED_ANALYTICS_LIMITS.maxEvents;
      index += 1
    ) {
      analytics.trackEvent("repeat");
    }
    expect(analytics.exportData().events).toHaveLength(
      ADVANCED_ANALYTICS_LIMITS.maxEvents,
    );
  });
});

describe("advanced-analytics — features + errors + warnings", () => {
  it("trackFeature increments usage and emits a feature-usage event", () => {
    analytics.trackFeature("search", "used");
    analytics.trackFeature("search", "used");
    const usage = analytics.exportData().featureUsage;
    expect(usage).toContainEqual(["search:used", 2]);
    expect(analytics.getSummary().eventsTracked).toBe(2); // each emits an event
  });

  it("buckets feature dimensions after the configured capacity", () => {
    for (
      let index = 0;
      index < ADVANCED_ANALYTICS_LIMITS.maxFeatureKeys + 20;
      index += 1
    ) {
      analytics.trackFeature(`feature-${index}`);
    }
    const usage = analytics.exportData().featureUsage;
    expect(usage.length).toBeLessThanOrEqual(
      ADVANCED_ANALYTICS_LIMITS.maxFeatureKeys,
    );
    expect(usage).toContainEqual(["__overflow__", 21]);
  });

  it("trackError / trackWarning accumulate and surface in the summary", () => {
    analytics.trackError({ message: "boom" });
    analytics.trackWarning({ message: "careful" });
    const s = analytics.getSummary();
    expect(s.errors).toBe(1);
    expect(s.warnings).toBe(1);
    // each also emits its own analytics event
    expect(s.eventsTracked).toBe(2);
  });

  it("bounds error and warning records and handles circular payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    analytics.trackError(circular);
    for (let index = 0; index < 55; index += 1) {
      analytics.trackWarning({ message: `warning-${index}` });
    }

    const dump = analytics.exportData();
    expect(dump.errors[0]).toMatchObject({
      dropped: true,
      reason: "PAYLOAD_NOT_SERIALIZABLE",
    });
    expect(dump.warnings).toHaveLength(ADVANCED_ANALYTICS_LIMITS.maxWarnings);
  });
});

describe("advanced-analytics — persisted history bounds", () => {
  it("normalizes loaded trend arrays and feature dimensions", () => {
    localStorage.setItem(
      "analytics-history",
      JSON.stringify({
        performanceTrends: {
          fileLoadTimes: Array.from({ length: 150 }, (_, index) => ({
            timestamp: index,
            value: index,
          })),
          renderTimes: [],
          memoryUsage: [],
          cachePerformance: [],
        },
        featureUsage: Array.from({ length: 300 }, (_, index) => [
          `feature-${index}`,
          1,
        ]),
      }),
    );

    (
      analytics as unknown as {
        loadHistory: () => void;
      }
    ).loadHistory();
    const dump = analytics.exportData();
    expect(dump.performanceTrends.fileLoadTimes).toHaveLength(
      ADVANCED_ANALYTICS_LIMITS.maxTrendPoints,
    );
    expect(dump.featureUsage.length).toBeLessThanOrEqual(
      ADVANCED_ANALYTICS_LIMITS.maxFeatureKeys,
    );
    expect(dump.featureUsage).toContainEqual(["__overflow__", 45]);
  });

  it("removes an oversized historical payload before parsing it", () => {
    localStorage.setItem(
      "analytics-history",
      "x".repeat(ADVANCED_ANALYTICS_LIMITS.maxHistoryBytes + 1),
    );

    (
      analytics as unknown as {
        loadHistory: () => void;
      }
    ).loadHistory();
    expect(localStorage.getItem("analytics-history")).toBeNull();
  });
});

describe("advanced-analytics — analyze() fileLoadTrend", () => {
  it("keeps change finite when the older sample averages zero (no Infinity/NaN)", () => {
    // 11 file-load samples: the single older-window value is 0, recent are 50.
    // older = slice(-30,-10) = [0] → olderAvg 0; without the guard the percent
    // change is (50-0)/0 = Infinity and leaks into the report.
    const fileLoadTimes = [
      { timestamp: 1, value: 0 },
      ...Array.from({ length: 10 }, (_, i) => ({
        timestamp: i + 2,
        value: 50,
      })),
    ];
    (
      analytics as unknown as {
        performanceTrends: { fileLoadTimes: typeof fileLoadTimes };
      }
    ).performanceTrends.fileLoadTimes = fileLoadTimes;

    const trend = analytics.analyze().performance.fileLoadTrend;
    expect(trend).toBeDefined();
    expect(Number.isFinite(trend!.change)).toBe(true);
    expect(trend!.change).toBe(0);
    expect(trend!.olderAvg).toBe(0);
    expect(trend!.recentAvg).toBe(50);
  });
});

describe("advanced-analytics — summary / report / export / clear", () => {
  it("getSummary returns the expected numeric shape", () => {
    analytics.trackEvent("x");
    const s = analytics.getSummary();
    expect(typeof s.sessionDuration).toBe("number");
    expect(s.eventsTracked).toBe(1);
    expect(s.recommendations).toBe(0);
    expect(Array.isArray(s.topFeatures)).toBe(true);
  });

  it("getReport pulls the mocked dependency stats", () => {
    const r = analytics.getReport();
    expect(r.prefetcher).toEqual({ prefetched: 0 });
    expect(r.adaptive).toEqual({ tier: "high" });
    expect(r.session.id).toMatch(/^session_/);
  });

  it("exportData exposes session + events; clearData resets everything", () => {
    analytics.trackEvent("a");
    analytics.trackError({ message: "e" });
    const dump = analytics.exportData();
    expect(dump.session.id).toMatch(/^session_/);
    expect(dump.events.length).toBeGreaterThan(0);
    analytics.clearData();
    expect(analytics.getSummary().eventsTracked).toBe(0);
    expect(analytics.exportData().errors).toHaveLength(0);
  });

  it("returns detached report and export snapshots", () => {
    analytics.trackEvent("file-open", { path: "a.ts" });
    const exported = analytics.exportData();
    exported.events[0].data.path = "mutated.ts";
    exported.userBehavior.fileEdits.length = 0;

    expect(analytics.exportData().events[0].data.path).toBe("a.ts");
    expect(analytics.exportData().userBehavior.fileEdits).toHaveLength(1);
  });
});
