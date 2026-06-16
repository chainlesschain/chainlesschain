/**
 * socialAI store 测试 — src/renderer/stores/socialAI.ts
 *
 * NB: the module captures `electronAPI` at load time (const at module scope),
 * so we set window.electronAPI BEFORE a dynamic import (a post-import mock
 * wouldn't be seen). The captured invoke ref is reconfigured per test.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const invoke = vi.fn();
let useSocialAIStore: any;

beforeAll(async () => {
  (window as any).electronAPI = { invoke };
  ({ useSocialAIStore } = await import("@/stores/socialAI"));
});

beforeEach(() => {
  setActivePinia(createPinia());
  invoke.mockReset();
});

describe("socialAI — getters", () => {
  it("topTopics / sentimentLabel / contactCount with defaults", () => {
    const s = useSocialAIStore();
    expect(s.topTopics).toEqual([]);
    expect(s.sentimentLabel).toBe("neutral");
    expect(s.contactCount).toBe(0);
    s.currentAnalysis = { topics: ["a", "b"], sentiment: "positive" } as any;
    s.graphStats = { totalContacts: 5 } as any;
    expect(s.topTopics).toEqual(["a", "b"]);
    expect(s.sentimentLabel).toBe("positive");
    expect(s.contactCount).toBe(5);
  });
});

describe("socialAI — analyzeTopics", () => {
  it("stores the analysis on success", async () => {
    invoke.mockResolvedValue({ topics: ["t1"], sentiment: "neg" });
    const s = useSocialAIStore();
    await s.analyzeTopics("hello", { contentId: "c1" });
    expect(invoke).toHaveBeenCalledWith("social-ai:analyze-topics", {
      content: "hello",
      options: { contentId: "c1" },
    });
    expect(s.currentAnalysis).toMatchObject({ sentiment: "neg" });
    expect(s.loading).toBe(false);
  });

  it("records a handler error", async () => {
    invoke.mockResolvedValue({ error: "bad input" });
    const s = useSocialAIStore();
    await s.analyzeTopics("x");
    expect(s.error).toBe("bad input");
  });

  it("rethrows + records a thrown error", async () => {
    invoke.mockRejectedValue(new Error("ipc down"));
    const s = useSocialAIStore();
    await expect(s.analyzeTopics("x")).rejects.toThrow("ipc down");
    expect(s.error).toBe("ipc down");
    expect(s.loading).toBe(false);
  });
});

describe("socialAI — trending + sentiment + replies", () => {
  it("fetchTrendingTopics stores an array; returns [] on throw", async () => {
    invoke.mockResolvedValue([{ topic: "x", count: 3 }]);
    const s = useSocialAIStore();
    expect(await s.fetchTrendingTopics({ limit: 5 })).toHaveLength(1);
    expect(s.trendingTopics).toHaveLength(1);
    invoke.mockRejectedValue(new Error("e"));
    expect(await s.fetchTrendingTopics()).toEqual([]);
    expect(s.error).toBe("e");
  });

  it("analyzeBatchSentiment stores the summary", async () => {
    invoke.mockResolvedValue({ average: 0.5, distribution: {}, count: 2 });
    const s = useSocialAIStore();
    await s.analyzeBatchSentiment(["a", "b"]);
    expect(s.batchSentiment).toMatchObject({ average: 0.5, count: 2 });
  });

  it("getMultiStyleReplies stores the replies map", async () => {
    invoke.mockResolvedValue({ replies: { formal: { text: "Hi." } } });
    const s = useSocialAIStore();
    await s.getMultiStyleReplies(
      [{ role: "user", content: "hey" }],
      ["formal"],
    );
    expect(s.multiStyleReplies).toEqual({ formal: { text: "Hi." } });
  });
});

describe("socialAI — graph", () => {
  it("fetchGraph stores graph/stats/communities on success", async () => {
    invoke.mockResolvedValue({
      success: true,
      graph: { nodes: [] },
      stats: { totalContacts: 7 },
      communities: [{ id: "c1" }],
    });
    const s = useSocialAIStore();
    await s.fetchGraph("did:1", { depth: 2 });
    expect(s.graph).toEqual({ nodes: [] });
    expect(s.graphStats).toEqual({ totalContacts: 7 });
    expect(s.communities).toEqual([{ id: "c1" }]);
    expect(s.contactCount).toBe(7);
  });

  it("fetchClosestContacts stores an array", async () => {
    invoke.mockResolvedValue([{ did: "x", score: 1 }]);
    const s = useSocialAIStore();
    await s.fetchClosestContacts("did:1");
    expect(s.closestContacts).toHaveLength(1);
  });
});
