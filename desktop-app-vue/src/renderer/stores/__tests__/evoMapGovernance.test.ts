/**
 * useEvoMapGovernanceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): registerOwnership (pass-through),
 *    traceContributions (forward geneId), createProposal (pass-through), castVote
 *    (pass-through), fetchDashboard (store whole result / error envelope)
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

import { useEvoMapGovernanceStore } from "../evoMapGovernance";

describe("useEvoMapGovernanceStore", () => {
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
      const store = useEvoMapGovernanceStore();
      expect(store.dashboard).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("registerOwnership passes the result through", async () => {
      const store = useEvoMapGovernanceStore();
      mockInvoke.mockResolvedValue({ success: true, ownershipId: "o1" });
      const result = await store.registerOwnership({ geneId: "g1" });
      expect(mockInvoke).toHaveBeenCalledWith("evomap-gov:register-ownership", {
        geneId: "g1",
      });
      expect(result).toEqual({ success: true, ownershipId: "o1" });
    });

    it("traceContributions forwards the gene id", async () => {
      const store = useEvoMapGovernanceStore();
      mockInvoke.mockResolvedValue({ success: true, contributions: [] });
      await store.traceContributions("g1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "evomap-gov:trace-contributions",
        "g1",
      );
    });

    it("createProposal + castVote pass results through", async () => {
      const store = useEvoMapGovernanceStore();
      mockInvoke.mockResolvedValueOnce({ success: true, proposalId: "p1" });
      expect(await store.createProposal({ title: "x" })).toEqual({
        success: true,
        proposalId: "p1",
      });
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "evomap-gov:create-proposal",
        { title: "x" },
      );

      mockInvoke.mockResolvedValueOnce({ success: true, recorded: true });
      expect(await store.castVote({ proposalId: "p1", vote: "yes" })).toEqual({
        success: true,
        recorded: true,
      });
      expect(mockInvoke).toHaveBeenLastCalledWith("evomap-gov:cast-vote", {
        proposalId: "p1",
        vote: "yes",
      });
    });

    it("fetchDashboard stores the whole result on success", async () => {
      const store = useEvoMapGovernanceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        proposals: 3,
        voters: 12,
      });
      await store.fetchDashboard();
      expect(mockInvoke).toHaveBeenCalledWith(
        "evomap-gov:get-governance-dashboard",
      );
      expect(store.dashboard).toMatchObject({ proposals: 3, voters: 12 });
      expect(store.loading).toBe(false);
    });

    it("fetchDashboard records the error envelope on rejection", async () => {
      const store = useEvoMapGovernanceStore();
      mockInvoke.mockRejectedValue(new Error("offline"));
      const result = await store.fetchDashboard();
      expect(result).toEqual({ success: false, error: "offline" });
      expect(store.error).toBe("offline");
      expect(store.dashboard).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
