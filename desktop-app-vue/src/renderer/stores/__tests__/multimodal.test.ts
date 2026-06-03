/**
 * useMultimodalStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: tokenBudgetUsed / tokenBudgetTotal / tokenBudgetPercent
 *    (rounding + divide-by-zero guard)
 *  - IPC actions (window.electronAPI.invoke mocked): fuseInput (set session +
 *    error path), generateOutput (push artifact + error path),
 *    getSupportedModalities, getStats
 *  - Pure action: reset
 *
 * NB: store calls (window as any).electronAPI.invoke directly, so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useMultimodalStore } from "../multimodal";
import type { MultimodalSession, MultimodalArtifact } from "../multimodal";

const mockInvoke = vi.fn();

function session(used: number, total: number): MultimodalSession {
  return {
    id: "s1",
    inputs: [],
    context: {},
    tokenBudget: { used, total },
    status: "active",
    createdAt: "2026-01-01",
  };
}

function artifact(id: string): MultimodalArtifact {
  return {
    id,
    sessionId: "s1",
    format: "md",
    content: "x",
    size: 1,
    createdAt: "2026-01-01",
  };
}

describe("useMultimodalStore", () => {
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
    it("starts with no session and empty artifacts", () => {
      const store = useMultimodalStore();
      expect(store.currentSession).toBeNull();
      expect(store.artifacts).toEqual([]);
      expect(store.supportedModalities).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("tokenBudgetUsed / tokenBudgetTotal default to 0 without a session", () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetUsed).toBe(0);
      expect(store.tokenBudgetTotal).toBe(0);
    });

    it("token budget getters read the current session", () => {
      const store = useMultimodalStore();
      store.currentSession = session(30, 120);
      expect(store.tokenBudgetUsed).toBe(30);
      expect(store.tokenBudgetTotal).toBe(120);
      expect(store.tokenBudgetPercent).toBe(25);
    });

    it("tokenBudgetPercent rounds and guards divide-by-zero", () => {
      const store = useMultimodalStore();
      expect(store.tokenBudgetPercent).toBe(0); // no session → total 0
      store.currentSession = session(1, 3);
      expect(store.tokenBudgetPercent).toBe(33); // Math.round(33.33)
      store.currentSession = session(5, 0);
      expect(store.tokenBudgetPercent).toBe(0); // total 0 guard
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fuseInput stores the session on success", async () => {
      const store = useMultimodalStore();
      mockInvoke.mockResolvedValue({ success: true, data: session(10, 100) });
      const result = await store.fuseInput([{ modality: "text" }]);
      expect(mockInvoke).toHaveBeenCalledWith("mm:fuse-input", [
        { modality: "text" },
      ]);
      expect(store.currentSession?.tokenBudget.total).toBe(100);
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it("fuseInput records the error on failure", async () => {
      const store = useMultimodalStore();
      mockInvoke.mockResolvedValue({ success: false, error: "bad input" });
      await store.fuseInput([]);
      expect(store.error).toBe("bad input");
      expect(store.currentSession).toBeNull();
    });

    it("generateOutput pushes the produced artifact", async () => {
      const store = useMultimodalStore();
      mockInvoke.mockResolvedValue({ success: true, data: artifact("a1") });
      await store.generateOutput("s1", "md");
      expect(mockInvoke).toHaveBeenCalledWith("mm:generate-output", "s1", "md");
      expect(store.artifacts.map((a) => a.id)).toEqual(["a1"]);
    });

    it("generateOutput records the error on failure", async () => {
      const store = useMultimodalStore();
      mockInvoke.mockResolvedValue({ success: false, error: "gen fail" });
      await store.generateOutput("s1", "pdf");
      expect(store.error).toBe("gen fail");
      expect(store.artifacts).toEqual([]);
    });

    it("getSupportedModalities + getStats populate their slices", async () => {
      const store = useMultimodalStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: ["text", "image"],
      });
      await store.getSupportedModalities();
      expect(store.supportedModalities).toEqual(["text", "image"]);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: { totalSessions: 4 },
      });
      await store.getStats();
      expect(store.stats).toEqual({ totalSessions: 4 });
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears session, artifacts, modalities, stats and flags", () => {
      const store = useMultimodalStore();
      store.currentSession = session(1, 2);
      store.artifacts = [artifact("a")];
      store.supportedModalities = ["text"];
      store.stats = { totalSessions: 1 } as any;
      store.error = "x";
      store.reset();
      expect(store.currentSession).toBeNull();
      expect(store.artifacts).toEqual([]);
      expect(store.supportedModalities).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.error).toBeNull();
    });
  });
});
