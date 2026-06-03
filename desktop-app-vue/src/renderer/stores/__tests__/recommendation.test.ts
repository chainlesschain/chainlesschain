/**
 * useRecommendationStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: unviewedCount (!viewed_at) / topRecommendations (slice 10)
 *  - IPC actions (electronAPI.invoke mocked): fetchRecommendations (populate /
 *    error), generate (chains fetchRecommendations on success), provideFeedback
 *    (in-place status update), fetchProfile (set profile)
 *
 * NB: recommendation.ts captures `electronAPI` at MODULE LOAD
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

import { useRecommendationStore } from "../recommendation";
import type { Recommendation } from "../recommendation";

function rec(
  id: string,
  overrides: Partial<Recommendation> = {},
): Recommendation {
  return {
    id,
    user_id: "u1",
    content_id: `c-${id}`,
    content_type: "post",
    score: 1,
    reason: "",
    source: "engine",
    status: "active",
    created_at: 1700000000000,
    viewed_at: null,
    ...overrides,
  };
}

describe("useRecommendationStore", () => {
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
      const store = useRecommendationStore();
      expect(store.recommendations).toEqual([]);
      expect(store.profile).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("unviewedCount counts entries without viewed_at", () => {
      const store = useRecommendationStore();
      store.recommendations = [
        rec("a"),
        rec("b", { viewed_at: 1700000001000 }),
        rec("c"),
      ];
      expect(store.unviewedCount).toBe(2);
    });

    it("topRecommendations returns at most the first 10", () => {
      const store = useRecommendationStore();
      store.recommendations = Array.from({ length: 12 }, (_, i) =>
        rec(`r${i}`),
      );
      expect(store.topRecommendations).toHaveLength(10);
      expect(store.topRecommendations[0].id).toBe("r0");
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchRecommendations populates on success", async () => {
      const store = useRecommendationStore();
      mockInvoke.mockResolvedValue({
        success: true,
        recommendations: [rec("a"), rec("b")],
      });
      await store.fetchRecommendations("u1", 20, "post");
      expect(mockInvoke).toHaveBeenCalledWith(
        "recommendation:get-recommendations",
        { userId: "u1", limit: 20, contentType: "post" },
      );
      expect(store.recommendations.map((r) => r.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchRecommendations records the error on failure", async () => {
      const store = useRecommendationStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no engine" });
      await store.fetchRecommendations("u1");
      expect(store.error).toBe("no engine");
    });

    it("generate chains fetchRecommendations on success", async () => {
      const store = useRecommendationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // generate
        .mockResolvedValueOnce({ success: true, recommendations: [rec("g")] }); // fetch
      await store.generate("u1");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "recommendation:generate", {
        userId: "u1",
        contentPool: undefined,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "recommendation:get-recommendations",
        { userId: "u1", limit: 20, contentType: undefined },
      );
      expect(store.recommendations.map((r) => r.id)).toEqual(["g"]);
    });

    it("provideFeedback updates the local status on success", async () => {
      const store = useRecommendationStore();
      store.recommendations = [rec("a"), rec("b")];
      mockInvoke.mockResolvedValue({ success: true });
      await store.provideFeedback("a", "dismissed");
      expect(mockInvoke).toHaveBeenCalledWith("recommendation:feedback", {
        recommendationId: "a",
        feedback: "dismissed",
      });
      expect(store.recommendations.find((r) => r.id === "a")?.status).toBe(
        "dismissed",
      );
      expect(store.recommendations.find((r) => r.id === "b")?.status).toBe(
        "active",
      );
    });

    it("fetchProfile stores the returned profile", async () => {
      const store = useRecommendationStore();
      const profile = {
        user_id: "u1",
        topics: { tech: 0.8 },
        interaction_weights: {},
        last_updated: 1,
        update_count: 1,
      };
      mockInvoke.mockResolvedValue({ success: true, profile });
      await store.fetchProfile("u1");
      expect(mockInvoke).toHaveBeenCalledWith("recommendation:get-profile", {
        userId: "u1",
      });
      expect(store.profile).toEqual(profile);
    });
  });
});
