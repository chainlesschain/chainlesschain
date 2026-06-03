/**
 * useSLAManagerStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeContracts (status === 'active') / unresolvedViolations
 *    (!resolved) / violationCount
 *  - IPC actions (electronAPI.invoke mocked): fetchContracts (populate / error),
 *    createContract (chains fetchContracts), fetchViolations (populate),
 *    checkCompliance (chains fetchViolations), fetchDashboard (set dashboard)
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

import { useSLAManagerStore } from "../slaManager";
import type { SLAContract } from "../slaManager";

function contract(id: string, status: string): SLAContract {
  return {
    id,
    name: `C ${id}`,
    org_id: "org1",
    partner_org_id: "org2",
    status,
    guarantees: {},
    penalties: {},
    rewards: {},
    valid_from: 1700000000000,
    valid_until: 1800000000000,
    created_at: 1700000000000,
  };
}

describe("useSLAManagerStore", () => {
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
      const store = useSLAManagerStore();
      expect(store.contracts).toEqual([]);
      expect(store.violations).toEqual([]);
      expect(store.dashboard).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeContracts filters status === 'active'", () => {
      const store = useSLAManagerStore();
      store.contracts = [
        contract("a", "active"),
        contract("b", "expired"),
        contract("c", "active"),
      ];
      expect(store.activeContracts.map((c) => c.id)).toEqual(["a", "c"]);
    });

    it("unresolvedViolations + violationCount derive from violations", () => {
      const store = useSLAManagerStore();
      store.violations = [
        { id: "v1", resolved: false },
        { id: "v2", resolved: true },
        { id: "v3", resolved: false },
      ];
      expect(store.unresolvedViolations.map((v: any) => v.id)).toEqual([
        "v1",
        "v3",
      ]);
      expect(store.violationCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchContracts populates on success", async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValue({
        success: true,
        contracts: [contract("a", "active"), contract("b", "expired")],
      });
      await store.fetchContracts({ status: "active" });
      expect(mockInvoke).toHaveBeenCalledWith("sla:list-contracts", {
        status: "active",
      });
      expect(store.contracts.map((c) => c.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchContracts records the error on failure", async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchContracts();
      expect(store.error).toBe("no svc");
    });

    it("createContract chains fetchContracts on success", async () => {
      const store = useSLAManagerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // create
        .mockResolvedValueOnce({
          success: true,
          contracts: [contract("n", "active")],
        }); // list
      await store.createContract("n", { uptime: 0.99 }, "org1", "org2");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "sla:create-contract", {
        name: "n",
        guarantees: { uptime: 0.99 },
        orgId: "org1",
        partnerOrgId: "org2",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "sla:list-contracts",
        undefined,
      );
      expect(store.contracts.map((c) => c.id)).toEqual(["n"]);
    });

    it("fetchViolations populates on success", async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValue({
        success: true,
        violations: [{ id: "v1" }],
      });
      await store.fetchViolations({ severity: "high" });
      expect(mockInvoke).toHaveBeenCalledWith("sla:get-violations", {
        severity: "high",
      });
      expect(store.violations).toHaveLength(1);
    });

    it("checkCompliance chains fetchViolations for the contract", async () => {
      const store = useSLAManagerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // check
        .mockResolvedValueOnce({
          success: true,
          violations: [{ id: "v1" }],
        }); // get-violations
      await store.checkCompliance("c1");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "sla:check-compliance",
        "c1",
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "sla:get-violations", {
        contractId: "c1",
      });
      expect(store.violations).toHaveLength(1);
    });

    it("fetchDashboard stores the dashboard on success", async () => {
      const store = useSLAManagerStore();
      mockInvoke.mockResolvedValue({
        success: true,
        dashboard: { compliance: 0.97 },
      });
      await store.fetchDashboard();
      expect(mockInvoke).toHaveBeenCalledWith("sla:get-dashboard");
      expect(store.dashboard).toEqual({ compliance: 0.97 });
    });
  });
});
