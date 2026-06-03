/**
 * useAnalyticsDashboardStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state + formatted getters
 *  - fetchDashboard() success + period update
 *  - fetchDashboard() envelope failure sets error
 *  - fetchDashboard() thrown error captured
 *  - fetchTimeSeries() routes result to ai/skill/error arrays by metric prefix
 *  - fetchTopSkills / fetchTopModels / fetchTopErrors success writes state
 *  - exportCSV / exportJSON return data or null on failure
 *  - startRealtimeUpdates registers listener + snapshot updates kpis
 *  - stopRealtimeUpdates removes listener
 *  - clearError + reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAnalyticsDashboardStore } from "../analytics-dashboard";

describe("useAnalyticsDashboardStore", () => {
  let invoke: ReturnType<typeof vi.fn>;
  let on: ReturnType<typeof vi.fn>;
  let removeListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    on = vi.fn();
    removeListener = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      invoke,
      on,
      removeListener,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("initial state is empty with sensible defaults", () => {
    const store = useAnalyticsDashboardStore();
    expect(store.summary).toBeNull();
    expect(store.kpis).toBeNull();
    expect(store.aiTimeSeries).toEqual([]);
    expect(store.skillTimeSeries).toEqual([]);
    expect(store.errorTimeSeries).toEqual([]);
    expect(store.selectedPeriod).toBe("24h");
    expect(store.autoRefresh).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasData).toBe(false);
  });

  it("formattedUptime handles days/hours/minutes segments", () => {
    const store = useAnalyticsDashboardStore();
    store.$patch({
      kpis: {
        totalAICalls: 0,
        totalTokens: 0,
        tokenCost: 0,
        skillExecutions: 0,
        skillSuccessRate: 0,
        errorCount: 0,
        activePeers: 0,
        uptime: 2 * 86400 + 5 * 3600 + 13 * 60,
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });
    expect(store.formattedUptime).toBe("2d 5h 13m");
  });

  it("formattedUptime shows minutes only when <1h", () => {
    const store = useAnalyticsDashboardStore();
    store.$patch({
      kpis: {
        totalAICalls: 0,
        totalTokens: 0,
        tokenCost: 0,
        skillExecutions: 0,
        skillSuccessRate: 0,
        errorCount: 0,
        activePeers: 0,
        uptime: 45 * 60,
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });
    expect(store.formattedUptime).toBe("45m");
  });

  it("tokenCostFormatted and skillSuccessRateFormatted compute correctly", () => {
    const store = useAnalyticsDashboardStore();
    store.$patch({
      kpis: {
        totalAICalls: 0,
        totalTokens: 0,
        tokenCost: 1.234,
        skillExecutions: 0,
        skillSuccessRate: 0.857,
        errorCount: 0,
        activePeers: 0,
        uptime: 0,
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });
    expect(store.tokenCostFormatted).toBe("$1.23");
    expect(store.skillSuccessRateFormatted).toBe("85.7%");
  });

  it("tokenCostFormatted defaults to $0.00 when no kpis", () => {
    const store = useAnalyticsDashboardStore();
    expect(store.tokenCostFormatted).toBe("$0.00");
    expect(store.skillSuccessRateFormatted).toBe("0.0%");
    expect(store.formattedUptime).toBe("0m");
  });

  it("fetchDashboard() success stores summary/kpis + updates period when supplied", async () => {
    const kpis = {
      totalAICalls: 10,
      totalTokens: 123,
      tokenCost: 0.5,
      skillExecutions: 3,
      skillSuccessRate: 1,
      errorCount: 0,
      activePeers: 2,
      uptime: 60,
      cpuUsage: 0,
      memoryUsage: 0,
    };
    invoke.mockResolvedValueOnce({
      success: true,
      data: { current: {}, period: "7d", kpis, historyCount: 100 },
    });
    const store = useAnalyticsDashboardStore();
    await store.fetchDashboard("7d");
    expect(store.summary?.historyCount).toBe(100);
    expect(store.kpis).toEqual(kpis);
    expect(store.selectedPeriod).toBe("7d");
    expect(store.hasData).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "analytics:get-dashboard-summary",
      "7d",
    );
  });

  it("fetchDashboard() envelope failure sets error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "down" });
    const store = useAnalyticsDashboardStore();
    await store.fetchDashboard();
    expect(store.error).toBe("down");
    expect(store.loading).toBe(false);
  });

  it("fetchDashboard() thrown error captured", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    const store = useAnalyticsDashboardStore();
    await store.fetchDashboard();
    expect(store.error).toBe("boom");
    expect(store.loading).toBe(false);
  });

  it("fetchTimeSeries() routes to aiTimeSeries for ai.* metrics", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: [{ timestamp: "2026", value: 1 }],
    });
    const store = useAnalyticsDashboardStore();
    const out = await store.fetchTimeSeries("ai.totalTokens");
    expect(store.aiTimeSeries).toHaveLength(1);
    expect(out).toHaveLength(1);
  });

  it("fetchTimeSeries() routes to skillTimeSeries for skills.*", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: [{ timestamp: "t", value: 2 }],
    });
    const store = useAnalyticsDashboardStore();
    await store.fetchTimeSeries("skills.totalExecutions");
    expect(store.skillTimeSeries).toHaveLength(1);
  });

  it("fetchTimeSeries() routes to errorTimeSeries for errors.*", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: [{ timestamp: "t", value: 3 }],
    });
    const store = useAnalyticsDashboardStore();
    await store.fetchTimeSeries("errors.totalErrors");
    expect(store.errorTimeSeries).toHaveLength(1);
  });

  it("fetchTopSkills/Models/Errors populate respective lists", async () => {
    invoke
      .mockResolvedValueOnce({ success: true, data: [{ name: "s1" }] })
      .mockResolvedValueOnce({ success: true, data: [{ name: "m1" }] })
      .mockResolvedValueOnce({ success: true, data: [{ name: "e1" }] });
    const store = useAnalyticsDashboardStore();
    await store.fetchTopSkills(5);
    await store.fetchTopModels(5);
    await store.fetchTopErrors(5);
    expect(store.topSkills[0].name).toBe("s1");
    expect(store.topModels[0].name).toBe("m1");
    expect(store.topErrors[0].name).toBe("e1");
  });

  it("exportCSV returns data on success", async () => {
    invoke.mockResolvedValueOnce({ success: true, data: "col\n1" });
    const store = useAnalyticsDashboardStore();
    expect(await store.exportCSV()).toBe("col\n1");
  });

  it("exportCSV returns null + sets error on envelope failure", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "denied" });
    const store = useAnalyticsDashboardStore();
    expect(await store.exportCSV()).toBeNull();
    expect(store.error).toBe("denied");
  });

  it("exportJSON returns data on success", async () => {
    invoke.mockResolvedValueOnce({ success: true, data: { rows: [] } });
    const store = useAnalyticsDashboardStore();
    expect(await store.exportJSON()).toEqual({ rows: [] });
  });

  it("startRealtimeUpdates registers listener exactly once", () => {
    const store = useAnalyticsDashboardStore();
    store.startRealtimeUpdates();
    store.startRealtimeUpdates();
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0][0]).toBe("analytics:realtime-update");
  });

  it("startRealtimeUpdates handler maps snapshot into kpis", () => {
    const store = useAnalyticsDashboardStore();
    store.startRealtimeUpdates();
    const handler = on.mock.calls[0][1];
    handler(null, {
      ai: { totalCalls: 11, totalTokens: 22, costEstimate: 0.33 },
      skills: { totalExecutions: 4, successRate: 0.75 },
      errors: { totalErrors: 1 },
      p2p: { activePeers: 3 },
      system: { uptime: 100, cpuUsage: 0.5, memoryUsage: 0.6 },
    });
    expect(store.kpis?.totalAICalls).toBe(11);
    expect(store.kpis?.activePeers).toBe(3);
  });

  it("stopRealtimeUpdates removes the listener and clears _realtimeListener", () => {
    const store = useAnalyticsDashboardStore();
    store.startRealtimeUpdates();
    store.stopRealtimeUpdates();
    expect(removeListener).toHaveBeenCalledWith(
      "analytics:realtime-update",
      expect.any(Function),
    );
    // Second stop is a no-op
    store.stopRealtimeUpdates();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("clearError nulls the error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "x" });
    const store = useAnalyticsDashboardStore();
    await store.fetchDashboard();
    expect(store.error).toBe("x");
    store.clearError();
    expect(store.error).toBeNull();
  });

  it("reset() clears state and stops realtime updates", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: { current: {}, period: "24h", kpis: null, historyCount: 0 },
    });
    const store = useAnalyticsDashboardStore();
    await store.fetchDashboard();
    store.startRealtimeUpdates();
    store.reset();
    expect(store.summary).toBeNull();
    expect(store.kpis).toBeNull();
    expect(removeListener).toHaveBeenCalled();
  });
});
