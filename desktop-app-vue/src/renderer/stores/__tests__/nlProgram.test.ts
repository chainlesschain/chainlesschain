/**
 * useNLProgramStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: specCompleteness (spec?.completeness ?? 0) / hasSpec
 *  - IPC actions (window.electronAPI.invoke mocked): translate (set spec /
 *    error), refine (set spec), generate (data.code vs bare-data fallback),
 *    getHistory (populate), getConventions (populate)
 *  - Pure action: reset
 *
 * NB: store calls (window as any).electronAPI.invoke directly, so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useNLProgramStore } from "../nlProgram";
import type { NLSpec } from "../nlProgram";

const mockInvoke = vi.fn();

function spec(completeness: number): NLSpec {
  return {
    id: "s1",
    intent: "build X",
    entities: [],
    acceptanceCriteria: [],
    completeness,
    rawText: "build X",
    createdAt: "2026-01-01",
  };
}

describe("useNLProgramStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useNLProgramStore();
      expect(store.currentSpec).toBeNull();
      expect(store.generatedCode).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.conventions).toBeNull();
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("specCompleteness defaults to 0 and reads currentSpec", () => {
      const store = useNLProgramStore();
      expect(store.specCompleteness).toBe(0);
      store.currentSpec = spec(0.75);
      expect(store.specCompleteness).toBe(0.75);
    });

    it("hasSpec reflects currentSpec presence", () => {
      const store = useNLProgramStore();
      expect(store.hasSpec).toBe(false);
      store.currentSpec = spec(1);
      expect(store.hasSpec).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("translate stores the spec on success", async () => {
      const store = useNLProgramStore();
      mockInvoke.mockResolvedValue({ success: true, data: spec(0.9) });
      const result = await store.translate("make a todo app");
      expect(mockInvoke).toHaveBeenCalledWith(
        "nl-prog:translate",
        "make a todo app",
      );
      expect(store.currentSpec?.completeness).toBe(0.9);
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it("translate records the error on failure", async () => {
      const store = useNLProgramStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no llm" });
      await store.translate("x");
      expect(store.error).toBe("no llm");
      expect(store.currentSpec).toBeNull();
    });

    it("refine replaces the current spec", async () => {
      const store = useNLProgramStore();
      store.currentSpec = spec(0.5);
      mockInvoke.mockResolvedValue({ success: true, data: spec(0.95) });
      await store.refine({ id: "s1" }, "add edge cases");
      expect(mockInvoke).toHaveBeenCalledWith(
        "nl-prog:refine",
        { id: "s1" },
        "add edge cases",
      );
      expect(store.currentSpec?.completeness).toBe(0.95);
    });

    it("generate unwraps data.code when present", async () => {
      const store = useNLProgramStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { code: "const x = 1;" },
      });
      await store.generate({ id: "s1" });
      expect(mockInvoke).toHaveBeenCalledWith("nl-prog:generate", { id: "s1" });
      expect(store.generatedCode).toBe("const x = 1;");
    });

    it("generate falls back to bare-string data", async () => {
      const store = useNLProgramStore();
      mockInvoke.mockResolvedValue({ success: true, data: "raw code" });
      await store.generate({ id: "s1" });
      expect(store.generatedCode).toBe("raw code");
    });

    it("getHistory + getConventions populate their slices", async () => {
      const store = useNLProgramStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [{ id: "h1" }],
      });
      await store.getHistory();
      expect(store.history).toHaveLength(1);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: {
          naming: "camel",
          framework: "vue",
          testFramework: "vitest",
          style: "x",
          patterns: [],
        },
      });
      await store.getConventions();
      expect(store.conventions?.framework).toBe("vue");
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears spec, code, history, conventions, stats and flags", () => {
      const store = useNLProgramStore();
      store.currentSpec = spec(1);
      store.generatedCode = "code";
      store.history = [{ id: "h" } as any];
      store.error = "x";
      store.reset();
      expect(store.currentSpec).toBeNull();
      expect(store.generatedCode).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.error).toBeNull();
    });
  });
});
