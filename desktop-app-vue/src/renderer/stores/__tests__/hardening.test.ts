/**
 * useHardeningStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: latestBaseline (baselines[0]) / latestAudit (auditReports[0]) /
 *    hasRegressions (comparison?.hasRegressions || false)
 *  - IPC actions (electronAPI.invoke mocked): collectBaseline (chains
 *    fetchBaselines), compareBaseline (set comparison / error), fetchBaselines
 *    (populate), runSecurityAudit (chains fetchAuditReports), fetchAuditReports
 *    (populate), fetchAuditReport (pass-through)
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useHardeningStore } from "../hardening";
import type {
  PerformanceBaselineRecord,
  SecurityAuditReport,
} from "../hardening";

function baseline(id: string): PerformanceBaselineRecord {
  return {
    id,
    name: `B ${id}`,
    version: "1.0",
    status: "complete",
    metrics: {},
    environment: {},
    sample_count: 10,
    created_at: 1700000000000,
    completed_at: 1700000100000,
  };
}

function audit(id: string): SecurityAuditReport {
  return {
    id,
    name: `A ${id}`,
    status: "complete",
    findings: [],
    risk_score: 5,
    summary: {},
    created_at: 1700000000000,
    completed_at: 1700000100000,
  };
}

describe("useHardeningStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useHardeningStore();
      expect(store.baselines).toEqual([]);
      expect(store.auditReports).toEqual([]);
      expect(store.comparison).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("latestBaseline / latestAudit read the first entry, else null", () => {
      const store = useHardeningStore();
      expect(store.latestBaseline).toBeNull();
      expect(store.latestAudit).toBeNull();
      store.baselines = [baseline("b1"), baseline("b2")];
      store.auditReports = [audit("a1")];
      expect(store.latestBaseline?.id).toBe("b1");
      expect(store.latestAudit?.id).toBe("a1");
    });

    it("hasRegressions reads comparison, defaulting to false", () => {
      const store = useHardeningStore();
      expect(store.hasRegressions).toBe(false);
      store.comparison = { hasRegressions: true };
      expect(store.hasRegressions).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("collectBaseline chains fetchBaselines on success", async () => {
      const store = useHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // collect
        .mockResolvedValueOnce({
          success: true,
          baselines: [baseline("b1")],
        }); // get
      await store.collectBaseline("nightly", "1.0");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "hardening:collect-baseline",
        { name: "nightly", version: "1.0" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "hardening:get-baselines",
        undefined,
      );
      expect(store.baselines.map((b) => b.id)).toEqual(["b1"]);
    });

    it("compareBaseline stores the comparison on success", async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        comparison: { hasRegressions: true, deltas: [] },
      });
      await store.compareBaseline("b1", "b2");
      expect(mockInvoke).toHaveBeenCalledWith("hardening:compare-baseline", {
        baselineId: "b1",
        currentId: "b2",
      });
      expect(store.comparison).toMatchObject({ hasRegressions: true });
    });

    it("compareBaseline records the error on failure", async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValue({ success: false, error: "missing" });
      await store.compareBaseline("b1");
      expect(store.error).toBe("missing");
      expect(store.comparison).toBeNull();
    });

    it("fetchBaselines populates on success", async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        baselines: [baseline("b1"), baseline("b2")],
      });
      await store.fetchBaselines({ limit: 5 });
      expect(mockInvoke).toHaveBeenCalledWith("hardening:get-baselines", {
        limit: 5,
      });
      expect(store.baselines.map((b) => b.id)).toEqual(["b1", "b2"]);
    });

    it("runSecurityAudit chains fetchAuditReports on success", async () => {
      const store = useHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // run
        .mockResolvedValueOnce({ success: true, reports: [audit("a1")] }); // get
      await store.runSecurityAudit("full", ["crypto"]);
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "hardening:run-security-audit",
        { name: "full", categories: ["crypto"] },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "hardening:get-audit-reports",
        undefined,
      );
      expect(store.auditReports.map((a) => a.id)).toEqual(["a1"]);
    });

    it("fetchAuditReport passes the result through", async () => {
      const store = useHardeningStore();
      mockInvoke.mockResolvedValue({ success: true, report: audit("a1") });
      const result = await store.fetchAuditReport("a1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "hardening:get-audit-report",
        "a1",
      );
      expect(result.report.id).toBe("a1");
    });
  });
});
