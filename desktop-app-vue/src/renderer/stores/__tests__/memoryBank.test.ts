/**
 * useMemoryBankStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: totalPatterns (sum of 4 lists) / totalPreferences /
 *    totalSessions / totalInsights
 *  - IPC actions (window.electronAPI.invoke mocked): loadPatterns (nested map +
 *    ?? [] defaults), loadPreferences (Array.isArray guard), loadStorageStats
 *    (default-filled), loadAutoSummaryInfo (Number/!! coercion), exportData
 *    (success filePath / failure error)
 *  - getInvoke() null-guard: exportData returns "IPC 不可用" with no electronAPI;
 *    openMemoryFolder no-ops without a memoryPath
 *
 * NB: store reads window.electronAPI.invoke lazily via getInvoke(), so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useMemoryBankStore } from "../memoryBank";

const mockInvoke = vi.fn();

describe("useMemoryBankStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with default storage + auto-summary config", () => {
      const store = useMemoryBankStore();
      expect(store.promptPatterns).toEqual([]);
      expect(store.preferences).toEqual([]);
      expect(store.recentSessions).toEqual([]);
      expect(store.memoryPath).toBe("");
      expect(store.storageStats).toEqual({
        totalFiles: 0,
        totalSize: 0,
        lastBackup: null,
      });
      expect(store.autoSummaryConfig.threshold).toBe(5);
      expect(store.loading).toBe(false);
      expect(store.hasLoaded).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("totalPatterns sums the four pattern lists", () => {
      const store = useMemoryBankStore();
      store.promptPatterns = [{}, {}];
      store.errorFixPatterns = [{}];
      store.codeSnippets = [{}, {}, {}];
      store.workflowPatterns = [{}];
      expect(store.totalPatterns).toBe(7);
    });

    it("totalPreferences / totalSessions / totalInsights mirror lengths", () => {
      const store = useMemoryBankStore();
      store.preferences = [{}, {}];
      store.recentSessions = [{}];
      store.recommendations = [{}, {}, {}];
      expect(store.totalPreferences).toBe(2);
      expect(store.totalSessions).toBe(1);
      expect(store.totalInsights).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Load actions
  // -------------------------------------------------------------------------

  describe("load actions", () => {
    it("loadPatterns maps each list, defaulting missing ones to []", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue({
        promptPatterns: [{ id: "p1" }],
        codeSnippets: [{ id: "c1" }, { id: "c2" }],
        // errorFixPatterns + workflowPatterns omitted
      });
      await store.loadPatterns();
      expect(mockInvoke).toHaveBeenCalledWith("memory:get-all-patterns");
      expect(store.promptPatterns).toHaveLength(1);
      expect(store.codeSnippets).toHaveLength(2);
      expect(store.errorFixPatterns).toEqual([]);
      expect(store.workflowPatterns).toEqual([]);
    });

    it("loadPreferences coerces a non-array result to []", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue(null);
      await store.loadPreferences();
      expect(store.preferences).toEqual([]);
      mockInvoke.mockResolvedValue([{ key: "k" }]);
      await store.loadPreferences();
      expect(store.preferences).toHaveLength(1);
    });

    it("loadStorageStats fills defaults for missing fields", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue({ memoryPath: "/m", totalFiles: 3 });
      await store.loadStorageStats();
      expect(store.memoryPath).toBe("/m");
      expect(store.storageStats).toEqual({
        totalFiles: 3,
        totalSize: 0,
        lastBackup: null,
      });
    });

    it("loadAutoSummaryInfo coerces config + stats numbers and booleans", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue({
        config: { enabled: 1, threshold: "10", queueLength: "2" },
        stats: { totalSessions: "5", coverage: "0.8" },
      });
      await store.loadAutoSummaryInfo();
      expect(store.autoSummaryConfig.enabled).toBe(true);
      expect(store.autoSummaryConfig.threshold).toBe(10);
      expect(store.autoSummaryConfig.queueLength).toBe(2);
      expect(store.autoSummaryStats.totalSessions).toBe(5);
      expect(store.autoSummaryStats.coverage).toBe(0.8);
      expect(store.loadingAutoSummary).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // exportData
  // -------------------------------------------------------------------------

  describe("exportData", () => {
    it("returns the filePath on success and clears the exporting flag", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue({ success: true, filePath: "/out.json" });
      const res = await store.exportData("all");
      expect(mockInvoke).toHaveBeenCalledWith("memory:export-data", {
        type: "all",
      });
      expect(res).toEqual({ success: true, filePath: "/out.json" });
      expect(store.exporting).toBe(false);
    });

    it("returns the error envelope on failure", async () => {
      const store = useMemoryBankStore();
      mockInvoke.mockResolvedValue({ success: false, error: "disk full" });
      const res = await store.exportData("patterns");
      expect(res).toEqual({ success: false, error: "disk full" });
    });
  });

  // -------------------------------------------------------------------------
  // getInvoke() null-guard
  // -------------------------------------------------------------------------

  describe("no-IPC guard", () => {
    it("exportData returns 'IPC 不可用' when electronAPI is absent", async () => {
      delete (window as any).electronAPI;
      const store = useMemoryBankStore();
      const res = await store.exportData("all");
      expect(res).toEqual({ success: false, error: "IPC 不可用" });
    });

    it("openMemoryFolder is a no-op without a memoryPath", async () => {
      const store = useMemoryBankStore();
      store.memoryPath = "";
      await store.openMemoryFolder();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("openMemoryFolder invokes shell:open-path when a path is set", async () => {
      const store = useMemoryBankStore();
      store.memoryPath = "/mem";
      mockInvoke.mockResolvedValue(undefined);
      await store.openMemoryFolder();
      expect(mockInvoke).toHaveBeenCalledWith("shell:open-path", "/mem");
    });
  });
});
