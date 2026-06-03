/**
 * useDlpStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activePolicies (enabled) / unresolvedIncidents (!resolved_at)
 *  - IPC actions (electronAPI.invoke mocked): fetchPolicies (populate / error),
 *    createPolicy (chains fetchPolicies), deletePolicy (chains fetchPolicies),
 *    fetchIncidents (populate), resolveIncident (chains fetchIncidents),
 *    scanContent (pass-through), fetchStats (set stats)
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

import { useDlpStore } from "../dlp";
import type { DLPPolicy, DLPIncident } from "../dlp";

function policy(id: string, enabled: boolean): DLPPolicy {
  return {
    id,
    name: `P ${id}`,
    description: "",
    enabled,
    channels: [],
    patterns: [],
    keywords: [],
    action: "block",
    severity: "high",
    created_at: 1700000000000,
    updated_at: 1700000000000,
  };
}

function incident(id: string, resolved_at: number | null): DLPIncident {
  return {
    id,
    policy_id: "p1",
    channel: "email",
    action_taken: "block",
    matched_patterns: "ssn",
    severity: "high",
    user_id: "u1",
    created_at: 1700000000000,
    resolved_at,
    resolution: null,
  };
}

describe("useDlpStore", () => {
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
      const store = useDlpStore();
      expect(store.policies).toEqual([]);
      expect(store.incidents).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activePolicies keeps enabled policies", () => {
      const store = useDlpStore();
      store.policies = [
        policy("a", true),
        policy("b", false),
        policy("c", true),
      ];
      expect(store.activePolicies.map((p) => p.id)).toEqual(["a", "c"]);
    });

    it("unresolvedIncidents keeps incidents without resolved_at", () => {
      const store = useDlpStore();
      store.incidents = [
        incident("a", null),
        incident("b", 1700000100000),
        incident("c", null),
      ];
      expect(store.unresolvedIncidents.map((i) => i.id)).toEqual(["a", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // Policy actions
  // -------------------------------------------------------------------------

  describe("policy actions", () => {
    it("fetchPolicies populates on success", async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValue({
        success: true,
        policies: [policy("a", true), policy("b", false)],
      });
      await store.fetchPolicies(true);
      expect(mockInvoke).toHaveBeenCalledWith("dlp:list-policies", {
        enabled: true,
      });
      expect(store.policies.map((p) => p.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchPolicies records the error on failure", async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchPolicies();
      expect(store.error).toBe("no svc");
    });

    it("createPolicy chains fetchPolicies on success", async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // create
        .mockResolvedValueOnce({
          success: true,
          policies: [policy("n", true)],
        }); // list
      await store.createPolicy({ name: "n" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "dlp:create-policy", {
        name: "n",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "dlp:list-policies", {
        enabled: undefined,
      });
      expect(store.policies.map((p) => p.id)).toEqual(["n"]);
    });

    it("deletePolicy chains fetchPolicies on success", async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // delete
        .mockResolvedValueOnce({ success: true, policies: [] }); // list
      await store.deletePolicy("p1");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "dlp:delete-policy", {
        id: "p1",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "dlp:list-policies", {
        enabled: undefined,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Incident actions + scan/stats
  // -------------------------------------------------------------------------

  describe("incident actions + scan/stats", () => {
    it("fetchIncidents populates on success", async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValue({
        success: true,
        incidents: [incident("a", null)],
      });
      await store.fetchIncidents({ severity: "high" });
      expect(mockInvoke).toHaveBeenCalledWith("dlp:get-incidents", {
        severity: "high",
      });
      expect(store.incidents).toHaveLength(1);
    });

    it("resolveIncident chains fetchIncidents on success", async () => {
      const store = useDlpStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // resolve
        .mockResolvedValueOnce({ success: true, incidents: [] }); // list
      await store.resolveIncident("i1", "false positive");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "dlp:resolve-incident", {
        id: "i1",
        resolution: "false positive",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "dlp:get-incidents", {});
    });

    it("scanContent passes the result through", async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValue({ success: true, matched: ["ssn"] });
      const result = await store.scanContent("123-45-6789", "email", "u1");
      expect(mockInvoke).toHaveBeenCalledWith("dlp:scan-content", {
        content: "123-45-6789",
        channel: "email",
        userId: "u1",
      });
      expect(result).toEqual({ success: true, matched: ["ssn"] });
    });

    it("fetchStats stores stats on success", async () => {
      const store = useDlpStore();
      mockInvoke.mockResolvedValue({
        success: true,
        stats: { scanned: 100, blocked: 3, alerted: 5 },
      });
      await store.fetchStats();
      expect(mockInvoke).toHaveBeenCalledWith("dlp:get-stats");
      expect(store.stats?.blocked).toBe(3);
    });
  });
});
