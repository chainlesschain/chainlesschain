/**
 * useAuditStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - fetchLogs()           -> audit:query-logs
 *  - getLogDetail()        -> audit:get-log-detail
 *  - exportLogs()          -> audit:export-logs
 *  - fetchStatistics()     -> audit:get-statistics
 *  - fetchPolicies()       -> compliance:get-policies
 *  - createPolicy()        -> compliance:create-policy
 *  - updatePolicy()        -> compliance:update-policy
 *  - deletePolicy()        -> compliance:delete-policy
 *  - checkCompliance()     -> compliance:check-compliance
 *  - generateReport()      -> compliance:generate-report
 *  - fetchDSRRequests()    -> dsr:list-requests
 *  - createDSR()           -> dsr:create-request
 *  - processDSR()          -> dsr:process-request
 *  - approveDSR()          -> dsr:approve-request
 *  - updateFilters()       -> resets page and re-fetches
 *  - Getters: highRiskLogs, failedLogs, enabledPolicies, pendingDSRRequests, overdueDSRRequests, complianceScore, totalPages, hasMorePages
 *  - Error handling
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  AuditLogEntry,
  CompliancePolicy,
  DataSubjectRequest,
} from "../audit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "log-1",
    timestamp: Date.now(),
    event_type: "data_access",
    actor_did: "did:example:alice",
    operation: "read",
    risk_level: "low",
    outcome: "success",
    ...overrides,
  };
}

function makePolicy(
  overrides: Partial<CompliancePolicy> = {},
): CompliancePolicy {
  return {
    id: "policy-1",
    policy_type: "retention",
    framework: "GDPR",
    rules: "{}",
    enabled: true,
    created_at: Date.now(),
    ...overrides,
  };
}

function makeDSR(
  overrides: Partial<DataSubjectRequest> = {},
): DataSubjectRequest {
  return {
    id: "dsr-1",
    request_type: "access",
    subject_did: "did:example:bob",
    status: "pending",
    created_at: Date.now(),
    deadline: Date.now() + 86400000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAuditStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      invoke: mockInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("logs starts as empty array", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.logs).toEqual([]);
    });

    it("totalLogs starts as 0", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.totalLogs).toBe(0);
    });

    it("currentPage starts as 1 and pageSize as 20", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.currentPage).toBe(1);
      expect(store.pageSize).toBe(20);
    });

    it("policies starts as empty array", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.policies).toEqual([]);
    });

    it("loading starts as false and error as null", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // fetchLogs
  // -------------------------------------------------------------------------

  describe("fetchLogs()", () => {
    it("calls audit:query-logs and populates logs", async () => {
      const logs = [makeLog()];
      mockInvoke.mockResolvedValue({ success: true, logs, total: 1 });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.fetchLogs();

      expect(mockInvoke).toHaveBeenCalledWith(
        "audit:query-logs",
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        }),
      );
      expect(store.logs).toHaveLength(1);
      expect(store.totalLogs).toBe(1);
    });

    it("uses provided filters", async () => {
      mockInvoke.mockResolvedValue({ success: true, logs: [], total: 0 });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.fetchLogs({ eventType: "login", page: 3 });

      expect(mockInvoke).toHaveBeenCalledWith(
        "audit:query-logs",
        expect.objectContaining({
          eventType: "login",
          page: 3,
        }),
      );
      expect(store.currentPage).toBe(3);
    });

    it("sets error and throws when IPC fails", async () => {
      mockInvoke.mockRejectedValue(new Error("Network error"));

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await expect(store.fetchLogs()).rejects.toThrow("Network error");
      expect(store.error).toBe("Network error");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getLogDetail
  // -------------------------------------------------------------------------

  describe("getLogDetail()", () => {
    it("calls audit:get-log-detail with logId", async () => {
      mockInvoke.mockResolvedValue({ success: true, log: makeLog() });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      const result = await store.getLogDetail("log-42");

      expect(mockInvoke).toHaveBeenCalledWith("audit:get-log-detail", {
        logId: "log-42",
      });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // exportLogs
  // -------------------------------------------------------------------------

  describe("exportLogs()", () => {
    it("calls audit:export-logs via IPC", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        filePath: "/tmp/export.csv",
      });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      const result = await store.exportLogs({ riskLevel: "high" });

      expect(mockInvoke).toHaveBeenCalledWith(
        "audit:export-logs",
        expect.objectContaining({
          riskLevel: "high",
        }),
      );
      expect(result.success).toBe(true);
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("Export failed"));

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await expect(store.exportLogs()).rejects.toThrow("Export failed");
      expect(store.error).toBe("Export failed");
    });
  });

  // -------------------------------------------------------------------------
  // fetchStatistics
  // -------------------------------------------------------------------------

  describe("fetchStatistics()", () => {
    it("populates statistics from IPC result", async () => {
      const stats = {
        totalLogs: 100,
        byEventType: {},
        byRiskLevel: {},
        byOutcome: {},
      };
      mockInvoke.mockResolvedValue({ success: true, statistics: stats });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.fetchStatistics();

      expect(mockInvoke).toHaveBeenCalledWith(
        "audit:get-statistics",
        expect.any(Object),
      );
      expect(store.statistics).toEqual(stats);
    });
  });

  // -------------------------------------------------------------------------
  // Compliance policies
  // -------------------------------------------------------------------------

  describe("fetchPolicies()", () => {
    it("populates policies from IPC result", async () => {
      const policies = [makePolicy()];
      mockInvoke.mockResolvedValue({ success: true, policies });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.fetchPolicies();

      expect(mockInvoke).toHaveBeenCalledWith("compliance:get-policies");
      expect(store.policies).toHaveLength(1);
    });
  });

  describe("createPolicy()", () => {
    it("calls compliance:create-policy and refreshes list", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true, policyId: "policy-new" }) // create
        .mockResolvedValueOnce({
          success: true,
          policies: [makePolicy({ id: "policy-new" })],
        }); // fetchPolicies

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.createPolicy({
        policy_type: "retention",
        framework: "GDPR",
        rules: "{}",
        enabled: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "compliance:create-policy",
        expect.objectContaining({
          framework: "GDPR",
        }),
      );
      expect(store.policies).toHaveLength(1);
    });
  });

  describe("updatePolicy()", () => {
    it("updates policy in local array on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.policies = [makePolicy({ id: "p1", enabled: true })];

      await store.updatePolicy("p1", { enabled: false });

      expect(mockInvoke).toHaveBeenCalledWith("compliance:update-policy", {
        policyId: "p1",
        updates: { enabled: false },
      });
      expect(store.policies[0].enabled).toBe(false);
    });
  });

  describe("deletePolicy()", () => {
    it("removes policy from local array on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.policies = [makePolicy({ id: "p1" }), makePolicy({ id: "p2" })];

      await store.deletePolicy("p1");
      expect(store.policies).toHaveLength(1);
      expect(store.policies[0].id).toBe("p2");
    });
  });

  describe("checkCompliance()", () => {
    it("populates complianceResult on success", async () => {
      const result = {
        framework: "GDPR",
        score: 85,
        passed: 17,
        failed: 3,
        checks: [],
        recommendations: [],
      };
      mockInvoke.mockResolvedValue({ success: true, result });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.checkCompliance("GDPR");

      expect(mockInvoke).toHaveBeenCalledWith("compliance:check-compliance", {
        framework: "GDPR",
      });
      expect(store.complianceResult).toEqual(result);
    });
  });

  describe("generateReport()", () => {
    it("populates complianceReport on success", async () => {
      const report = { title: "GDPR Report", sections: [] };
      mockInvoke.mockResolvedValue({ success: true, report });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.generateReport("GDPR", { detailed: true });

      expect(mockInvoke).toHaveBeenCalledWith(
        "compliance:generate-report",
        expect.objectContaining({
          framework: "GDPR",
          detailed: true,
        }),
      );
      expect(store.complianceReport).toEqual(report);
    });
  });

  // -------------------------------------------------------------------------
  // DSR operations
  // -------------------------------------------------------------------------

  describe("fetchDSRRequests()", () => {
    it("populates dsrRequests from IPC result", async () => {
      mockInvoke.mockResolvedValue({ success: true, requests: [makeDSR()] });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.fetchDSRRequests({ status: "pending" });

      expect(mockInvoke).toHaveBeenCalledWith(
        "dsr:list-requests",
        expect.objectContaining({ status: "pending" }),
      );
      expect(store.dsrRequests).toHaveLength(1);
    });
  });

  describe("createDSR()", () => {
    it("calls dsr:create-request and refreshes list", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true, requestId: "dsr-new" }) // create
        .mockResolvedValueOnce({
          success: true,
          requests: [makeDSR({ id: "dsr-new" })],
        }); // fetchDSRRequests

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await store.createDSR({
        request_type: "deletion",
        subject_did: "did:example:bob",
        deadline: Date.now() + 86400000,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "dsr:create-request",
        expect.objectContaining({
          request_type: "deletion",
        }),
      );
    });
  });

  describe("processDSR()", () => {
    it("updates local DSR status to in_progress on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.dsrRequests = [makeDSR({ id: "dsr-1", status: "pending" })];

      await store.processDSR("dsr-1", "start");
      expect(store.dsrRequests[0].status).toBe("in_progress");
    });
  });

  describe("approveDSR()", () => {
    it("updates local DSR status to completed on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.dsrRequests = [makeDSR({ id: "dsr-1", status: "in_progress" })];

      await store.approveDSR("dsr-1", "did:example:admin");
      expect(store.dsrRequests[0].status).toBe("completed");
      expect(store.dsrRequests[0].completed_at).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateFilters / clearFilters
  // -------------------------------------------------------------------------

  describe("updateFilters()", () => {
    it("merges filters, resets page to 1, and re-fetches", async () => {
      mockInvoke.mockResolvedValue({ success: true, logs: [], total: 0 });

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.currentPage = 5;

      await store.updateFilters({ riskLevel: "high" });

      expect(store.currentPage).toBe(1);
      expect(store.filters).toEqual(
        expect.objectContaining({ riskLevel: "high" }),
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        "audit:query-logs",
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("highRiskLogs returns only high and critical logs", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.logs = [
        makeLog({ id: "l1", risk_level: "low" }),
        makeLog({ id: "l2", risk_level: "high" }),
        makeLog({ id: "l3", risk_level: "critical" }),
        makeLog({ id: "l4", risk_level: "medium" }),
      ];
      expect(store.highRiskLogs).toHaveLength(2);
    });

    it("failedLogs returns failure and blocked logs", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.logs = [
        makeLog({ id: "l1", outcome: "success" }),
        makeLog({ id: "l2", outcome: "failure" }),
        makeLog({ id: "l3", outcome: "blocked" }),
      ];
      expect(store.failedLogs).toHaveLength(2);
    });

    it("enabledPolicies returns only enabled policies", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.policies = [
        makePolicy({ id: "p1", enabled: true }),
        makePolicy({ id: "p2", enabled: false }),
      ];
      expect(store.enabledPolicies).toHaveLength(1);
      expect(store.enabledPolicies[0].id).toBe("p1");
    });

    it("pendingDSRRequests returns pending and in_progress requests", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.dsrRequests = [
        makeDSR({ id: "d1", status: "pending" }),
        makeDSR({ id: "d2", status: "in_progress" }),
        makeDSR({ id: "d3", status: "completed" }),
      ];
      expect(store.pendingDSRRequests).toHaveLength(2);
    });

    it("overdueDSRRequests returns non-completed requests past deadline", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.dsrRequests = [
        makeDSR({ id: "d1", status: "pending", deadline: Date.now() - 100000 }),
        makeDSR({ id: "d2", status: "pending", deadline: Date.now() + 100000 }),
        makeDSR({
          id: "d3",
          status: "completed",
          deadline: Date.now() - 100000,
        }),
      ];
      expect(store.overdueDSRRequests).toHaveLength(1);
      expect(store.overdueDSRRequests[0].id).toBe("d1");
    });

    it("complianceScore returns score from complianceResult", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.complianceScore).toBeNull();
      store.complianceResult = {
        framework: "GDPR",
        score: 92,
        passed: 18,
        failed: 2,
        checks: [],
        recommendations: [],
      };
      expect(store.complianceScore).toBe(92);
    });

    it("totalPages computes correct page count", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      expect(store.totalPages).toBe(1); // 0 total, defaults to 1
      store.totalLogs = 45;
      expect(store.totalPages).toBe(3); // ceil(45/20)
    });

    it("hasMorePages returns true when more pages exist", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.totalLogs = 45;
      store.currentPage = 1;
      expect(store.hasMorePages).toBe(true);
      store.currentPage = 3;
      expect(store.hasMorePages).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("Error handling", () => {
    it("clearError resets error to null", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      store.error = "Something went wrong";
      store.clearError();
      expect(store.error).toBeNull();
    });

    it("loading is set back to false after error", async () => {
      mockInvoke.mockRejectedValue(new Error("fail"));

      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();
      await expect(store.fetchPolicies()).rejects.toThrow("fail");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("resets all state via $reset", async () => {
      const { useAuditStore } = await import("../audit");
      const store = useAuditStore();

      store.logs = [makeLog()];
      store.totalLogs = 50;
      store.currentPage = 3;
      store.policies = [makePolicy()];
      store.dsrRequests = [makeDSR()];
      store.error = "some error";
      store.complianceResult = {
        framework: "GDPR",
        score: 80,
        passed: 16,
        failed: 4,
        checks: [],
        recommendations: [],
      };

      store.reset();

      expect(store.logs).toEqual([]);
      expect(store.totalLogs).toBe(0);
      expect(store.currentPage).toBe(1);
      expect(store.policies).toEqual([]);
      expect(store.dsrRequests).toEqual([]);
      expect(store.error).toBeNull();
      expect(store.complianceResult).toBeNull();
    });
  });
});
