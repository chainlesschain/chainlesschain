/**
 * useGovernanceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeProposals / draftProposals (status filter) /
 *    proposalCount
 *  - IPC actions (electronAPI.invoke mocked): fetchProposals (populate / error),
 *    createProposal (chains fetchProposals on success), analyzeImpact (set
 *    currentAnalysis / error), predictVote (pass-through + error)
 *
 * NB: governance.ts captures `electronAPI` at MODULE LOAD
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

import { useGovernanceStore } from "../governance";
import type { GovernanceProposal } from "../governance";

function proposal(
  id: string,
  status: string,
  overrides: Partial<GovernanceProposal> = {},
): GovernanceProposal {
  return {
    id,
    title: `P ${id}`,
    description: "",
    type: "feature",
    proposer_did: "did:me",
    status,
    impact_level: null,
    impact_analysis: null,
    vote_yes: 0,
    vote_no: 0,
    vote_abstain: 0,
    voting_starts_at: null,
    voting_ends_at: null,
    created_at: 1700000000000,
    ...overrides,
  };
}

describe("useGovernanceStore", () => {
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
      const store = useGovernanceStore();
      expect(store.proposals).toEqual([]);
      expect(store.currentAnalysis).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeProposals / draftProposals filter by status, proposalCount counts all", () => {
      const store = useGovernanceStore();
      store.proposals = [
        proposal("a", "active"),
        proposal("b", "draft"),
        proposal("c", "active"),
        proposal("d", "closed"),
      ];
      expect(store.activeProposals.map((p) => p.id)).toEqual(["a", "c"]);
      expect(store.draftProposals.map((p) => p.id)).toEqual(["b"]);
      expect(store.proposalCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchProposals populates on success", async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        proposals: [proposal("a", "active"), proposal("b", "draft")],
      });
      await store.fetchProposals({ status: "active" });
      expect(mockInvoke).toHaveBeenCalledWith("governance-ai:list-proposals", {
        status: "active",
      });
      expect(store.proposals.map((p) => p.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchProposals records the error on failure", async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchProposals();
      expect(store.error).toBe("no svc");
    });

    it("createProposal chains fetchProposals on success", async () => {
      const store = useGovernanceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // create
        .mockResolvedValueOnce({
          success: true,
          proposals: [proposal("n", "draft")],
        }); // fetch
      await store.createProposal("title", "desc", "feature", "did:me");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "governance-ai:create-proposal",
        {
          title: "title",
          description: "desc",
          type: "feature",
          proposerDid: "did:me",
        },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "governance-ai:list-proposals",
        undefined,
      );
      expect(store.proposals.map((p) => p.id)).toEqual(["n"]);
    });

    it("analyzeImpact stores the analysis on success", async () => {
      const store = useGovernanceStore();
      const analysis = {
        impact_level: "high",
        affected_components: ["core"],
        risk_score: 7,
        benefit_score: 8,
        estimated_effort: "2w",
        community_sentiment: "positive",
        recommendations: [],
        analyzed_at: 1,
      };
      mockInvoke.mockResolvedValue({ success: true, analysis });
      await store.analyzeImpact("p1");
      expect(mockInvoke).toHaveBeenCalledWith("governance-ai:analyze-impact", {
        proposalId: "p1",
      });
      expect(store.currentAnalysis).toEqual(analysis);
    });

    it("analyzeImpact records the error on failure", async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValue({ success: false, error: "fail" });
      await store.analyzeImpact("p1");
      expect(store.error).toBe("fail");
      expect(store.currentAnalysis).toBeNull();
    });

    it("predictVote passes through the result and records errors", async () => {
      const store = useGovernanceStore();
      mockInvoke.mockResolvedValue({ success: true, prediction: { yes: 60 } });
      const ok = await store.predictVote("p1");
      expect(mockInvoke).toHaveBeenCalledWith("governance-ai:predict-vote", {
        proposalId: "p1",
      });
      expect(ok).toEqual({ success: true, prediction: { yes: 60 } });

      mockInvoke.mockResolvedValue({ success: false, error: "boom" });
      await store.predictVote("p1");
      expect(store.error).toBe("boom");
    });
  });
});
