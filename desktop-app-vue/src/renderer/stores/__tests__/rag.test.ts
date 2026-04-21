/**
 * useRagStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state defaults
 *  - loadStats() happy path + error envelope + undefined result + missing electronAPI
 *  - rebuildIndex() success triggers a follow-up loadStats
 *  - rebuildIndex() error envelope surfaces error message
 *  - rebuildIndex() thrown exception is captured into error
 *  - loading / rebuilding flags toggle correctly
 *  - clearError() resets error to null
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRagStore } from "../rag";

describe("useRagStore", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("initializes with empty state", () => {
    const store = useRagStore();
    expect(store.stats).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.rebuilding).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
  });

  it("loadStats() success populates stats + hasLoaded", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: { totalDocuments: 42, totalChunks: 100 },
    });
    const store = useRagStore();
    await store.loadStats();
    expect(store.stats).toEqual({ totalDocuments: 42, totalChunks: 100 });
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(invoke).toHaveBeenCalledWith("rag:get-stats");
  });

  it("loadStats() failure envelope surfaces error without clearing hasLoaded", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "db offline" });
    const store = useRagStore();
    await store.loadStats();
    expect(store.error).toBe("db offline");
    expect(store.hasLoaded).toBe(false);
    expect(store.stats).toBeNull();
  });

  it("loadStats() tolerates undefined result from invoke", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const store = useRagStore();
    await store.loadStats();
    expect(store.stats).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.error).toBeNull();
  });

  it("loadStats() without electronAPI treats as success=false", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const store = useRagStore();
    await store.loadStats();
    expect(store.stats).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.loading).toBe(false);
  });

  it("loadStats() thrown error is captured", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    const store = useRagStore();
    await store.loadStats();
    expect(store.error).toBe("boom");
    expect(store.loading).toBe(false);
  });

  it("rebuildIndex() success triggers follow-up loadStats + returns true", async () => {
    invoke.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
      success: true,
      data: { totalDocuments: 7, lastRebuiltAt: 1234 },
    });
    const store = useRagStore();
    const ok = await store.rebuildIndex();
    expect(ok).toBe(true);
    expect(invoke.mock.calls[0][0]).toBe("rag:rebuild-index");
    expect(invoke.mock.calls[1][0]).toBe("rag:get-stats");
    expect(store.stats).toEqual({ totalDocuments: 7, lastRebuiltAt: 1234 });
    expect(store.rebuilding).toBe(false);
  });

  it("rebuildIndex() envelope failure returns false with explicit error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "lock held" });
    const store = useRagStore();
    const ok = await store.rebuildIndex();
    expect(ok).toBe(false);
    expect(store.error).toBe("lock held");
    expect(store.rebuilding).toBe(false);
  });

  it("rebuildIndex() falls back to default message when envelope has no error", async () => {
    invoke.mockResolvedValueOnce({ success: false });
    const store = useRagStore();
    const ok = await store.rebuildIndex();
    expect(ok).toBe(false);
    expect(store.error).toBe("重建 RAG 索引失败");
  });

  it("rebuildIndex() thrown exception returns false", async () => {
    invoke.mockRejectedValueOnce(new Error("ipc dead"));
    const store = useRagStore();
    const ok = await store.rebuildIndex();
    expect(ok).toBe(false);
    expect(store.error).toBe("ipc dead");
    expect(store.rebuilding).toBe(false);
  });

  it("clearError() nulls the error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "x" });
    const store = useRagStore();
    await store.loadStats();
    expect(store.error).toBe("x");
    store.clearError();
    expect(store.error).toBeNull();
  });

  it("loading flag is true mid-call and false after", async () => {
    let resolveIt: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveIt = r;
        }),
    );
    const store = useRagStore();
    const p = store.loadStats();
    expect(store.loading).toBe(true);
    resolveIt({ success: true, data: {} });
    await p;
    expect(store.loading).toBe(false);
  });
});
