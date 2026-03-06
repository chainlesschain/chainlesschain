/**
 * Analytics IPC Handler Unit Tests
 *
 * Tests the 16 IPC handlers registered by registerAnalyticsIPC().
 * Uses dependency injection pattern for ipcMain.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

const {
  registerAnalyticsIPC,
  ANALYTICS_CHANNELS,
} = require("../analytics-ipc.js");

function createMockAggregator() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getDashboardSummary: vi
      .fn()
      .mockResolvedValue({
        current: {},
        period: "24h",
        historyCount: 0,
        kpis: {},
      }),
    getTimeSeries: vi.fn().mockResolvedValue([]),
    getTopN: vi.fn().mockResolvedValue([]),
    generateReport: vi.fn().mockResolvedValue({ kpis: {} }),
    cleanupOldData: vi
      .fn()
      .mockResolvedValue({ deleted: 5, before: "2026-01-01" }),
    getAIMetrics: vi.fn().mockResolvedValue({ totalCalls: 100 }),
    getSkillMetrics: vi.fn().mockResolvedValue({ totalExecutions: 50 }),
    getErrorMetrics: vi.fn().mockResolvedValue({ totalErrors: 3 }),
    getSystemMetrics: vi.fn().mockResolvedValue({ cpuUsage: 45 }),
    getP2PMetrics: vi.fn().mockResolvedValue({ activePeers: 2 }),
    getAggregationHistory: vi.fn().mockResolvedValue([]),
    _aggregate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Analytics IPC Handlers", () => {
  let agg;
  let mockIpcMain;
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    agg = createMockAggregator();
    mockIpcMain = createMockIpcMain();
    registerAnalyticsIPC({ analyticsAggregator: agg, ipcMain: mockIpcMain });
    handlers = mockIpcMain.handlers;
  });

  it("should export ANALYTICS_CHANNELS with 16 entries", () => {
    expect(ANALYTICS_CHANNELS).toHaveLength(16);
  });

  it("should register all 16 IPC handlers", () => {
    expect(Object.keys(handlers)).toHaveLength(16);
  });

  it("should register all expected channel names", () => {
    for (const ch of ANALYTICS_CHANNELS) {
      expect(handlers[ch]).toBeDefined();
    }
  });

  it("should skip registration when no aggregator", () => {
    const ipc2 = createMockIpcMain();
    registerAnalyticsIPC({ ipcMain: ipc2 });
    expect(Object.keys(ipc2.handlers)).toHaveLength(0);
  });

  it("analytics:start should call aggregator.start()", async () => {
    const r = await handlers["analytics:start"]();
    expect(r.success).toBe(true);
    expect(agg.start).toHaveBeenCalled();
  });

  it("analytics:start error handling", async () => {
    agg.start.mockImplementation(() => {
      throw new Error("Start error");
    });
    const r = await handlers["analytics:start"]();
    expect(r.success).toBe(false);
    expect(r.error).toBe("Start error");
  });

  it("analytics:stop should call aggregator.stop()", async () => {
    const r = await handlers["analytics:stop"]();
    expect(r.success).toBe(true);
    expect(agg.stop).toHaveBeenCalled();
  });

  it("analytics:get-dashboard-summary with period", async () => {
    const r = await handlers["analytics:get-dashboard-summary"]({}, "7d");
    expect(r.success).toBe(true);
    expect(agg.getDashboardSummary).toHaveBeenCalledWith("7d");
  });

  it("analytics:get-dashboard-summary defaults to 24h", async () => {
    await handlers["analytics:get-dashboard-summary"]({}, null);
    expect(agg.getDashboardSummary).toHaveBeenCalledWith("24h");
  });

  it("analytics:get-time-series requires metric", async () => {
    const r = await handlers["analytics:get-time-series"]({}, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("metric");
  });

  it("analytics:get-time-series delegates", async () => {
    const r = await handlers["analytics:get-time-series"](
      {},
      { metric: "ai.totalTokens", from: "2026-01-01" },
    );
    expect(r.success).toBe(true);
    expect(agg.getTimeSeries).toHaveBeenCalled();
  });

  it("analytics:get-top-n requires metric", async () => {
    const r = await handlers["analytics:get-top-n"]({}, {});
    expect(r.success).toBe(false);
  });

  it("analytics:get-top-n with defaults", async () => {
    const r = await handlers["analytics:get-top-n"]({}, { metric: "skills" });
    expect(r.success).toBe(true);
    expect(agg.getTopN).toHaveBeenCalledWith("skills", 10, "24h");
  });

  it("analytics:generate-report delegates", async () => {
    const r = await handlers["analytics:generate-report"](
      {},
      { format: "csv", period: "30d" },
    );
    expect(r.success).toBe(true);
    expect(agg.generateReport).toHaveBeenCalledWith({
      format: "csv",
      period: "30d",
    });
  });

  it("analytics:cleanup delegates", async () => {
    const r = await handlers["analytics:cleanup"]({}, 60);
    expect(r.success).toBe(true);
    expect(agg.cleanupOldData).toHaveBeenCalledWith(60);
  });

  it("analytics:get-ai-metrics", async () => {
    const r = await handlers["analytics:get-ai-metrics"]();
    expect(r.success).toBe(true);
    expect(r.data.totalCalls).toBe(100);
  });

  it("analytics:get-skill-metrics", async () => {
    const r = await handlers["analytics:get-skill-metrics"]();
    expect(r.success).toBe(true);
    expect(r.data.totalExecutions).toBe(50);
  });

  it("analytics:get-error-metrics", async () => {
    const r = await handlers["analytics:get-error-metrics"]();
    expect(r.success).toBe(true);
    expect(r.data.totalErrors).toBe(3);
  });

  it("analytics:get-system-metrics", async () => {
    const r = await handlers["analytics:get-system-metrics"]();
    expect(r.success).toBe(true);
    expect(r.data.cpuUsage).toBe(45);
  });

  it("analytics:get-p2p-metrics", async () => {
    const r = await handlers["analytics:get-p2p-metrics"]();
    expect(r.success).toBe(true);
    expect(r.data.activePeers).toBe(2);
  });

  it("analytics:export-csv", async () => {
    const r = await handlers["analytics:export-csv"]({}, "30d");
    expect(r.success).toBe(true);
    expect(agg.generateReport).toHaveBeenCalledWith({
      format: "csv",
      period: "30d",
    });
  });

  it("analytics:export-csv defaults to 7d", async () => {
    await handlers["analytics:export-csv"]({}, null);
    expect(agg.generateReport).toHaveBeenCalledWith({
      format: "csv",
      period: "7d",
    });
  });

  it("analytics:export-json", async () => {
    const r = await handlers["analytics:export-json"]({}, "1d");
    expect(r.success).toBe(true);
    expect(agg.generateReport).toHaveBeenCalledWith({
      format: "json",
      period: "1d",
    });
  });

  it("analytics:get-aggregation-history with pagination", async () => {
    const r = await handlers["analytics:get-aggregation-history"](
      {},
      { limit: 20, offset: 5 },
    );
    expect(r.success).toBe(true);
    expect(agg.getAggregationHistory).toHaveBeenCalledWith({
      limit: 20,
      offset: 5,
    });
  });

  it("analytics:get-aggregation-history defaults", async () => {
    await handlers["analytics:get-aggregation-history"]({}, null);
    expect(agg.getAggregationHistory).toHaveBeenCalledWith({
      limit: 50,
      offset: 0,
    });
  });

  it("analytics:trigger-aggregation", async () => {
    const r = await handlers["analytics:trigger-aggregation"]();
    expect(r.success).toBe(true);
    expect(agg._aggregate).toHaveBeenCalled();
  });

  it("analytics:trigger-aggregation error handling", async () => {
    agg._aggregate.mockRejectedValue(new Error("Agg error"));
    const r = await handlers["analytics:trigger-aggregation"]();
    expect(r.success).toBe(false);
    expect(r.error).toBe("Agg error");
  });

  it("dashboard summary error handling", async () => {
    agg.getDashboardSummary.mockRejectedValue(new Error("Summary fail"));
    const r = await handlers["analytics:get-dashboard-summary"]({}, "24h");
    expect(r.success).toBe(false);
  });
});
