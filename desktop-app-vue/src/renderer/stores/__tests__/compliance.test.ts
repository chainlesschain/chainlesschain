/**
 * useComplianceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: complianceScore (report?.score || 0) / evidenceCount /
 *    hasCriticalFindings (severity === 'critical')
 *  - IPC actions (electronAPI.invoke mocked): collectAuditEvidence (push),
 *    generateReport (set report), classifyContent (set result), fetchPolicies
 *    (populate), getEvidenceByCriteria (replace evidence)
 *
 * NB: compliance.ts captures `electronAPI` at MODULE LOAD
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

import { useComplianceStore } from "../compliance";
import type { Evidence, ComplianceReport } from "../compliance";

function evidence(id: string): Evidence {
  return {
    id,
    criteria: "c1",
    evidence_type: "audit",
    title: `E ${id}`,
    description: "",
    data: "{}",
    status: "collected",
    period_start: 0,
    period_end: 0,
    created_at: 1700000000000,
  };
}

function report(score: number): ComplianceReport {
  return {
    title: "R",
    generatedAt: 1700000000000,
    complianceScore: score,
    totalEvidence: 0,
    summary: { totalCriteria: 10, coveredCriteria: 8, missingCriteria: 2 },
    recommendations: [],
  };
}

describe("useComplianceStore", () => {
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
      const store = useComplianceStore();
      expect(store.evidence).toEqual([]);
      expect(store.report).toBeNull();
      expect(store.classificationResult).toBeNull();
      expect(store.policies).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("complianceScore reads the report, defaulting to 0", () => {
      const store = useComplianceStore();
      expect(store.complianceScore).toBe(0);
      store.report = report(92);
      expect(store.complianceScore).toBe(92);
    });

    it("evidenceCount mirrors the evidence list", () => {
      const store = useComplianceStore();
      store.evidence = [evidence("a"), evidence("b")];
      expect(store.evidenceCount).toBe(2);
    });

    it("hasCriticalFindings is true only for a critical classification", () => {
      const store = useComplianceStore();
      expect(store.hasCriticalFindings).toBe(false);
      store.classificationResult = {
        category: "pii",
        detections: [],
        severity: "low",
        confidence: 0.5,
      };
      expect(store.hasCriticalFindings).toBe(false);
      store.classificationResult = {
        category: "pii",
        detections: [],
        severity: "critical",
        confidence: 0.9,
      };
      expect(store.hasCriticalFindings).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("collectAuditEvidence pushes the returned evidence", async () => {
      const store = useComplianceStore();
      mockInvoke.mockResolvedValue({ success: true, evidence: evidence("a") });
      await store.collectAuditEvidence({ periodStart: 1, periodEnd: 2 });
      expect(mockInvoke).toHaveBeenCalledWith(
        "compliance:collect-audit-evidence",
        { periodStart: 1, periodEnd: 2 },
      );
      expect(store.evidence.map((e) => e.id)).toEqual(["a"]);
      expect(store.loading).toBe(false);
    });

    it("generateReport stores the report on success", async () => {
      const store = useComplianceStore();
      mockInvoke.mockResolvedValue({ success: true, report: report(75) });
      await store.generateReport();
      expect(mockInvoke).toHaveBeenCalledWith("compliance:generate-report", {});
      expect(store.report?.complianceScore).toBe(75);
    });

    it("classifyContent stores the classification result", async () => {
      const store = useComplianceStore();
      const result = {
        category: "secret",
        detections: [],
        severity: "high",
        confidence: 0.8,
      };
      mockInvoke.mockResolvedValue({ success: true, result });
      await store.classifyContent("some text");
      expect(mockInvoke).toHaveBeenCalledWith("compliance:classify-content", {
        content: "some text",
      });
      expect(store.classificationResult).toEqual(result);
    });

    it("fetchPolicies populates policies, defaulting to []", async () => {
      const store = useComplianceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        policies: [
          {
            id: "p1",
            name: "GDPR",
            level: "high",
            triggers: [],
            description: "",
          },
        ],
      });
      await store.fetchPolicies();
      expect(mockInvoke).toHaveBeenCalledWith("compliance:get-policies");
      expect(store.policies.map((p) => p.id)).toEqual(["p1"]);
    });

    it("getEvidenceByCriteria replaces the evidence list", async () => {
      const store = useComplianceStore();
      store.evidence = [evidence("old")];
      mockInvoke.mockResolvedValue({
        success: true,
        evidence: [evidence("x"), evidence("y")],
      });
      await store.getEvidenceByCriteria("c1");
      expect(mockInvoke).toHaveBeenCalledWith("compliance:get-evidence", {
        criteria: "c1",
      });
      expect(store.evidence.map((e) => e.id)).toEqual(["x", "y"]);
    });
  });
});
