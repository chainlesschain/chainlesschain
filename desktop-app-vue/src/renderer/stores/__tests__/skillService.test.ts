/**
 * useSkillServiceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: publishedSkills (status === 'published') / skillCount
 *  - IPC actions (electronAPI.invoke mocked): fetchSkills (populate / error),
 *    publishSkill (chains fetchSkills), invokeRemote (pass-through), fetchVersions
 *    (populate), composePipeline (pass-through)
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

import { useSkillServiceStore } from "../skillService";

describe("useSkillServiceStore", () => {
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
      const store = useSkillServiceStore();
      expect(store.skills).toEqual([]);
      expect(store.versions).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("publishedSkills filters status === 'published'; skillCount counts all", () => {
      const store = useSkillServiceStore();
      store.skills = [
        { id: "a", status: "published" },
        { id: "b", status: "draft" },
        { id: "c", status: "published" },
      ];
      expect(store.publishedSkills.map((s: any) => s.id)).toEqual(["a", "c"]);
      expect(store.skillCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchSkills populates on success", async () => {
      const store = useSkillServiceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        skills: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchSkills({ category: "nlp" });
      expect(mockInvoke).toHaveBeenCalledWith("skill-service:list-skills", {
        category: "nlp",
      });
      expect(store.skills).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("fetchSkills records the error on failure", async () => {
      const store = useSkillServiceStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchSkills();
      expect(store.error).toBe("no svc");
    });

    it("publishSkill chains fetchSkills on success", async () => {
      const store = useSkillServiceStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // publish
        .mockResolvedValueOnce({
          success: true,
          skills: [{ id: "n", status: "published" }],
        }); // list
      await store.publishSkill({ name: "n" });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "skill-service:publish-skill",
        { name: "n" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "skill-service:list-skills",
        undefined,
      );
      expect(store.skills).toHaveLength(1);
    });

    it("invokeRemote passes the result through", async () => {
      const store = useSkillServiceStore();
      mockInvoke.mockResolvedValue({ success: true, output: "ok" });
      const result = await store.invokeRemote({ skill: "s1", input: {} });
      expect(mockInvoke).toHaveBeenCalledWith("skill-service:invoke-remote", {
        skill: "s1",
        input: {},
      });
      expect(result).toEqual({ success: true, output: "ok" });
    });

    it("fetchVersions populates the version list", async () => {
      const store = useSkillServiceStore();
      mockInvoke.mockResolvedValue({
        success: true,
        versions: [{ v: "1.0" }, { v: "1.1" }],
      });
      await store.fetchVersions("my-skill");
      expect(mockInvoke).toHaveBeenCalledWith(
        "skill-service:get-versions",
        "my-skill",
      );
      expect(store.versions).toHaveLength(2);
    });

    it("composePipeline passes the result through", async () => {
      const store = useSkillServiceStore();
      mockInvoke.mockResolvedValue({ success: true, pipelineId: "p1" });
      const result = await store.composePipeline({ steps: [] });
      expect(mockInvoke).toHaveBeenCalledWith(
        "skill-service:compose-pipeline",
        { steps: [] },
      );
      expect(result).toEqual({ success: true, pipelineId: "p1" });
    });
  });
});
