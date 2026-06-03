/**
 * useCollaborationGovernanceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: pendingCount / currentLevel (autonomyLevel?.level ?? 2) /
 *    trackRecord (autonomyLevel?.track_record ?? 0)
 *  - IPC actions (electronAPI.invoke mocked): fetchPendingDecisions (populate /
 *    error), approveDecision (chains fetchPendingDecisions), rejectDecision
 *    (chains fetchPendingDecisions), fetchAutonomyLevel (set autonomyLevel),
 *    setAutonomyPolicy (set autonomyLevel)
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

import { useCollaborationGovernanceStore } from "../collaborationGovernance";

describe("useCollaborationGovernanceStore", () => {
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
      const store = useCollaborationGovernanceStore();
      expect(store.pendingDecisions).toEqual([]);
      expect(store.autonomyLevel).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("pendingCount mirrors the pending list length", () => {
      const store = useCollaborationGovernanceStore();
      store.pendingDecisions = [{ id: "d1" }, { id: "d2" }];
      expect(store.pendingCount).toBe(2);
    });

    it("currentLevel defaults to 2; trackRecord defaults to 0", () => {
      const store = useCollaborationGovernanceStore();
      expect(store.currentLevel).toBe(2);
      expect(store.trackRecord).toBe(0);
      store.autonomyLevel = { level: 4, track_record: 0.87 };
      expect(store.currentLevel).toBe(4);
      expect(store.trackRecord).toBe(0.87);
    });
  });

  // -------------------------------------------------------------------------
  // Decision actions
  // -------------------------------------------------------------------------

  describe("decision actions", () => {
    it("fetchPendingDecisions populates on success", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        decisions: [{ id: "d1" }, { id: "d2" }],
      });
      await store.fetchPendingDecisions({ decisionType: "deploy" });
      expect(mockInvoke).toHaveBeenCalledWith("collab-governance:get-pending", {
        decisionType: "deploy",
      });
      expect(store.pendingDecisions).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("fetchPendingDecisions records the error on failure", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchPendingDecisions();
      expect(store.error).toBe("no svc");
    });

    it("approveDecision chains fetchPendingDecisions on success", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // approve
        .mockResolvedValueOnce({ success: true, decisions: [] }); // get-pending
      await store.approveDecision("d1", "did:rev", "ok");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "collab-governance:approve-decision",
        { decisionId: "d1", reviewer: "did:rev", comment: "ok" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "collab-governance:get-pending",
        undefined,
      );
    });

    it("rejectDecision chains fetchPendingDecisions on success", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // reject
        .mockResolvedValueOnce({ success: true, decisions: [] }); // get-pending
      await store.rejectDecision("d1", "did:rev", "nope");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "collab-governance:reject-decision",
        { decisionId: "d1", reviewer: "did:rev", comment: "nope" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "collab-governance:get-pending",
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Autonomy actions
  // -------------------------------------------------------------------------

  describe("autonomy actions", () => {
    it("fetchAutonomyLevel stores the level on success", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        level: { level: 3, track_record: 0.5 },
      });
      await store.fetchAutonomyLevel("deploy");
      expect(mockInvoke).toHaveBeenCalledWith(
        "collab-governance:get-autonomy-level",
        "deploy",
      );
      expect(store.currentLevel).toBe(3);
    });

    it("setAutonomyPolicy stores the returned policy on success", async () => {
      const store = useCollaborationGovernanceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        policy: { level: 5, track_record: 0.9 },
      });
      await store.setAutonomyPolicy({ scope: "deploy", level: 5 });
      expect(mockInvoke).toHaveBeenCalledWith(
        "collab-governance:set-autonomy-policy",
        { scope: "deploy", level: 5 },
      );
      expect(store.currentLevel).toBe(5);
      expect(store.trackRecord).toBe(0.9);
    });
  });
});
