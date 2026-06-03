/**
 * useTokenIncentiveStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getter: rewardTransactions (type === 'reward')
 *  - IPC actions (electronAPI.invoke mocked): fetchBalance (set balance),
 *    fetchTransactions (populate), submitContribution (chains fetchBalance),
 *    fetchPricing (pass-through), fetchRewardsSummary (set summary)
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

import { useTokenIncentiveStore } from "../tokenIncentive";

describe("useTokenIncentiveStore", () => {
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
      const store = useTokenIncentiveStore();
      expect(store.balance).toBe(0);
      expect(store.transactions).toEqual([]);
      expect(store.rewardsSummary).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  describe("rewardTransactions", () => {
    it("filters transactions with type === 'reward'", () => {
      const store = useTokenIncentiveStore();
      store.transactions = [
        { id: "a", type: "reward" },
        { id: "b", type: "transfer" },
        { id: "c", type: "reward" },
      ];
      expect(store.rewardTransactions.map((t: any) => t.id)).toEqual([
        "a",
        "c",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchBalance stores the balance on success", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke.mockResolvedValue({ success: true, balance: 250 });
      await store.fetchBalance();
      expect(mockInvoke).toHaveBeenCalledWith("token:get-balance");
      expect(store.balance).toBe(250);
    });

    it("fetchTransactions populates the list", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke.mockResolvedValue({
        success: true,
        transactions: [{ id: "t1" }, { id: "t2" }],
      });
      await store.fetchTransactions({ limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith("token:get-transactions", {
        limit: 10,
      });
      expect(store.transactions).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("submitContribution chains fetchBalance on success", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, reward: 5 }) // submit
        .mockResolvedValueOnce({ success: true, balance: 105 }); // get-balance
      await store.submitContribution({ kind: "data" });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "token:submit-contribution",
        { kind: "data" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "token:get-balance");
      expect(store.balance).toBe(105);
    });

    it("fetchPricing passes the result through", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke.mockResolvedValue({ success: true, price: 1.5 });
      const result = await store.fetchPricing({ token: "CCT" });
      expect(mockInvoke).toHaveBeenCalledWith("token:get-pricing", {
        token: "CCT",
      });
      expect(result).toEqual({ success: true, price: 1.5 });
    });

    it("fetchRewardsSummary stores the summary on success", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke.mockResolvedValue({
        success: true,
        summary: { total: 99 },
      });
      await store.fetchRewardsSummary();
      expect(mockInvoke).toHaveBeenCalledWith("token:get-rewards-summary");
      expect(store.rewardsSummary).toEqual({ total: 99 });
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useTokenIncentiveStore();
      mockInvoke.mockRejectedValue(new Error("offline"));
      const result = await store.fetchBalance();
      expect(result).toEqual({ success: false, error: "offline" });
      expect(store.balance).toBe(0);
    });
  });
});
