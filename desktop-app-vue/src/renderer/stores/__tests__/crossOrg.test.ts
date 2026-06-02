/**
 * useCrossOrgStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activePartners / pendingPartnershipCount /
 *    activeWorkspaceCount / pendingTransactionCount / isLoading
 *  - IPC action (mocked window.electronAPI.invoke): loadPartnerships
 *    (sets partnerships + derives pending requests) + error rethrow
 *  - reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useCrossOrgStore } from "../crossOrg";
import type { Partnership } from "../crossOrg";

function partnership(overrides: Partial<Partnership> = {}): Partnership {
  return {
    id: "p1",
    initiatorOrgId: "o1",
    targetOrgId: "o2",
    status: "active",
    trustLevel: 1,
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("useCrossOrgStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with loading flags off", () => {
      const store = useCrossOrgStore();
      expect(store.partnerships).toEqual([]);
      expect(store.pendingPartnershipRequests).toEqual([]);
      expect(store.workspaces).toEqual([]);
      expect(store.pendingTransactions).toEqual([]);
      expect(store.error).toBeNull();
      expect(store.isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activePartners filters status === 'active'", () => {
      const store = useCrossOrgStore();
      store.partnerships = [
        partnership({ id: "a", status: "active" }),
        partnership({ id: "b", status: "pending" }),
        partnership({ id: "c", status: "terminated" }),
        partnership({ id: "d", status: "active" }),
      ];
      expect(store.activePartners.map((p) => p.id)).toEqual(["a", "d"]);
    });

    it("pendingPartnershipCount mirrors pendingPartnershipRequests length", () => {
      const store = useCrossOrgStore();
      store.pendingPartnershipRequests = [
        partnership({ status: "pending" }),
        partnership({ status: "pending" }),
      ];
      expect(store.pendingPartnershipCount).toBe(2);
    });

    it("activeWorkspaceCount counts non-archived workspaces", () => {
      const store = useCrossOrgStore();
      store.workspaces = [
        { id: "w1", status: "active" } as any,
        { id: "w2", status: "archived" } as any,
        { id: "w3", status: "draft" } as any,
      ];
      expect(store.activeWorkspaceCount).toBe(2);
    });

    it("pendingTransactionCount mirrors pendingTransactions length", () => {
      const store = useCrossOrgStore();
      store.pendingTransactions = [{ id: "t1" } as any];
      expect(store.pendingTransactionCount).toBe(1);
    });

    it("isLoading is true when any loading flag is set", () => {
      const store = useCrossOrgStore();
      expect(store.isLoading).toBe(false);
      store.loading.partnerships = true;
      expect(store.isLoading).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // loadPartnerships
  // -------------------------------------------------------------------------

  describe("loadPartnerships", () => {
    it("sets partnerships and derives pending requests on success", async () => {
      const store = useCrossOrgStore();
      const partnerships = [
        partnership({ id: "a", status: "active" }),
        partnership({ id: "b", status: "pending" }),
        partnership({ id: "c", status: "pending" }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, partnerships });
      const result = await store.loadPartnerships("o1");
      expect(mockInvoke).toHaveBeenCalledWith("crossorg:get-partnerships", {
        orgId: "o1",
        options: {},
      });
      expect(result.success).toBe(true);
      expect(store.partnerships).toHaveLength(3);
      expect(store.pendingPartnershipRequests.map((p) => p.id)).toEqual([
        "b",
        "c",
      ]);
      expect(store.loading.partnerships).toBe(false);
    });

    it("rethrows on IPC error and resets the loading flag", async () => {
      const store = useCrossOrgStore();
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      await expect(store.loadPartnerships("o1")).rejects.toThrow("boom");
      expect(store.loading.partnerships).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("restores initial state", () => {
      const store = useCrossOrgStore();
      store.partnerships = [partnership()];
      store.error = "x";
      store.reset();
      expect(store.partnerships).toEqual([]);
      expect(store.error).toBeNull();
    });
  });
});
