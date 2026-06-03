/**
 * useTechLearningStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: promotedPractices (status === 'promoted') / profileCount
 *  - IPC actions (electronAPI.invoke mocked): detectStack (chains fetchProfiles),
 *    fetchProfiles (populate), extractPractices (chains fetchPractices),
 *    fetchPractices (populate), synthesizeSkill (return / error)
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

import { useTechLearningStore } from "../techLearning";

describe("useTechLearningStore", () => {
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
      const store = useTechLearningStore();
      expect(store.profiles).toEqual([]);
      expect(store.practices).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("promotedPractices filters status === 'promoted'; profileCount counts profiles", () => {
      const store = useTechLearningStore();
      store.practices = [
        { id: "a", status: "promoted" },
        { id: "b", status: "candidate" },
        { id: "c", status: "promoted" },
      ];
      store.profiles = [{ id: "p1" }, { id: "p2" }];
      expect(store.promotedPractices.map((p: any) => p.id)).toEqual(["a", "c"]);
      expect(store.profileCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("detectStack chains fetchProfiles on success", async () => {
      const store = useTechLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // detect
        .mockResolvedValueOnce({ success: true, profiles: [{ id: "p1" }] }); // get-profiles
      await store.detectStack("/proj");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "tech-learning:detect-stack",
        {
          projectPath: "/proj",
        },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "tech-learning:get-profiles",
        undefined,
      );
      expect(store.profiles).toHaveLength(1);
      expect(store.loading).toBe(false);
    });

    it("fetchProfiles populates on success", async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        profiles: [{ id: "p1" }, { id: "p2" }],
      });
      await store.fetchProfiles({ limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith("tech-learning:get-profiles", {
        limit: 10,
      });
      expect(store.profiles).toHaveLength(2);
    });

    it("extractPractices chains fetchPractices for the profile", async () => {
      const store = useTechLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // extract
        .mockResolvedValueOnce({
          success: true,
          practices: [{ id: "pr1", status: "candidate" }],
        }); // get-practices
      await store.extractPractices("p1", "git");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "tech-learning:extract-practices",
        { profileId: "p1", source: "git" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "tech-learning:get-practices",
        { profileId: "p1" },
      );
      expect(store.practices).toHaveLength(1);
    });

    it("fetchPractices populates on success", async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        practices: [{ id: "pr1" }],
      });
      await store.fetchPractices({ status: "promoted" });
      expect(mockInvoke).toHaveBeenCalledWith("tech-learning:get-practices", {
        status: "promoted",
      });
      expect(store.practices).toHaveLength(1);
    });

    it("synthesizeSkill returns the result and records errors", async () => {
      const store = useTechLearningStore();
      mockInvoke.mockResolvedValue({ success: true, skillId: "s1" });
      const ok = await store.synthesizeSkill("pr1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "tech-learning:synthesize-skill",
        { practiceId: "pr1" },
      );
      expect(ok).toEqual({ success: true, skillId: "s1" });

      mockInvoke.mockResolvedValue({ success: false, error: "fail" });
      await store.synthesizeSkill("pr1");
      expect(store.error).toBe("fail");
    });
  });
});
