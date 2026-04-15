import { describe, it, expect, vi } from "vitest";
import { MemoryStore, SCOPE } from "../lib/memory-store.js";
import { TraceStore, TRACE_TYPES } from "../lib/trace-store.js";
import {
  MemoryConsolidator,
  defaultExtractor,
  CATEGORIES,
} from "../lib/memory-consolidator.js";

function buildRig() {
  const memoryStore = new MemoryStore();
  const traceStore = new TraceStore();
  return { memoryStore, traceStore };
}

describe("defaultExtractor", () => {
  it("extracts preferences from user messages", () => {
    const facts = defaultExtractor([
      {
        type: TRACE_TYPES.MESSAGE,
        payload: { role: "user", content: "我喜欢用黑色主题" },
      },
      {
        type: TRACE_TYPES.MESSAGE,
        payload: { role: "user", content: "I prefer tabs over spaces" },
      },
      {
        type: TRACE_TYPES.MESSAGE,
        payload: { role: "user", content: "what time is it" },
      },
    ]);
    const prefs = facts.filter((f) => f.category === CATEGORIES.PREFERENCE);
    expect(prefs).toHaveLength(2);
  });

  it("extracts corrections from errors", () => {
    const facts = defaultExtractor([
      {
        type: TRACE_TYPES.ERROR,
        payload: { error: "tool failed: file not found" },
      },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe(CATEGORIES.CORRECTION);
  });

  it("extracts completed tasks from successful tool results", () => {
    const facts = defaultExtractor([
      {
        type: TRACE_TYPES.TOOL_RESULT,
        payload: { ok: true, tool: "read_file", summary: "read 42 lines" },
      },
      {
        type: TRACE_TYPES.TOOL_RESULT,
        payload: { ok: false, tool: "read_file" },
      },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe(CATEGORIES.TASK);
    expect(facts[0].tags).toContain("read_file");
  });

  it("ignores empty user messages", () => {
    const facts = defaultExtractor([
      { type: TRACE_TYPES.MESSAGE, payload: { role: "user", content: "" } },
    ]);
    expect(facts).toHaveLength(0);
  });
});

describe("MemoryConsolidator", () => {
  it("requires memoryStore and traceStore", () => {
    expect(() => new MemoryConsolidator({})).toThrow(/memoryStore/);
    expect(
      () => new MemoryConsolidator({ memoryStore: new MemoryStore() })
    ).toThrow(/traceStore/);
  });

  it("consolidate requires session.sessionId", async () => {
    const { memoryStore, traceStore } = buildRig();
    const c = new MemoryConsolidator({ memoryStore, traceStore });
    await expect(c.consolidate({})).rejects.toThrow(/sessionId/);
  });

  it("writes facts into memory at agent scope by default", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.MESSAGE,
      payload: { role: "user", content: "我喜欢简洁回答" },
    });
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.TOOL_RESULT,
      payload: { ok: true, tool: "read_file" },
    });

    const c = new MemoryConsolidator({ memoryStore, traceStore });
    const res = await c.consolidate({ sessionId: "s1", agentId: "agent_a" });

    expect(res.writtenCount).toBe(2);
    expect(res.scope).toBe(SCOPE.AGENT);
    expect(res.scopeId).toBe("agent_a");

    const recalled = memoryStore.list({ scope: SCOPE.AGENT, scopeId: "agent_a" });
    expect(recalled).toHaveLength(2);
    expect(recalled[0].metadata.fromSessionId).toBe("s1");
  });

  it("falls back to sessionId when agentId missing for agent scope", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.ERROR,
      payload: { error: "boom" },
    });
    const c = new MemoryConsolidator({ memoryStore, traceStore });
    const res = await c.consolidate({ sessionId: "s1" });
    expect(res.scopeId).toBe("s1");
  });

  it("honors session scope + explicit scopeId", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.ERROR,
      payload: { error: "x" },
    });
    const c = new MemoryConsolidator({ memoryStore, traceStore });
    const res = await c.consolidate(
      { sessionId: "s1", agentId: "a1" },
      { scope: SCOPE.SESSION }
    );
    expect(res.scope).toBe(SCOPE.SESSION);
    expect(res.scopeId).toBe("s1");
  });

  it("global scope writes with null scopeId", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.ERROR,
      payload: { error: "x" },
    });
    const c = new MemoryConsolidator({ memoryStore, traceStore });
    const res = await c.consolidate(
      { sessionId: "s1" },
      { scope: SCOPE.GLOBAL }
    );
    expect(res.scope).toBe(SCOPE.GLOBAL);
    expect(res.scopeId).toBe(null);
    expect(memoryStore.list({ scope: SCOPE.GLOBAL })).toHaveLength(1);
  });

  it("uses injected summarizer when useLLM=true", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.MESSAGE,
      payload: { role: "user", content: "hi" },
    });
    const summarizer = vi.fn(async () => [
      { category: CATEGORIES.SUMMARY, content: "LLM summary", tags: ["llm"] },
    ]);
    const c = new MemoryConsolidator({
      memoryStore,
      traceStore,
      summarizer,
    });
    const res = await c.consolidate(
      { sessionId: "s1", agentId: "a1" },
      { useLLM: true }
    );
    expect(summarizer).toHaveBeenCalledOnce();
    expect(res.writtenCount).toBe(1);
    expect(res.written[0].content).toBe("LLM summary");
  });

  it("falls back to rule extractor on summarizer error", async () => {
    const { memoryStore, traceStore } = buildRig();
    traceStore.record({
      sessionId: "s1",
      type: TRACE_TYPES.ERROR,
      payload: { error: "boom" },
    });
    const summarizer = vi.fn(async () => {
      throw new Error("llm down");
    });
    const c = new MemoryConsolidator({ memoryStore, traceStore, summarizer });
    const errSpy = vi.fn();
    c.on("summarizer-error", errSpy);
    const res = await c.consolidate(
      { sessionId: "s1", agentId: "a1" },
      { useLLM: true }
    );
    expect(errSpy).toHaveBeenCalledOnce();
    expect(res.writtenCount).toBeGreaterThan(0);
  });

  it("emits consolidated event with summary", async () => {
    const { memoryStore, traceStore } = buildRig();
    const c = new MemoryConsolidator({ memoryStore, traceStore });
    const spy = vi.fn();
    c.on("consolidated", spy);
    await c.consolidate({ sessionId: "s1", agentId: "a1" });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].sessionId).toBe("s1");
  });

  it("skips facts with empty content", async () => {
    const { memoryStore, traceStore } = buildRig();
    const extractor = () => [
      { category: "summary", content: "" },
      { category: "summary", content: "real fact" },
    ];
    const c = new MemoryConsolidator({ memoryStore, traceStore, extractor });
    const res = await c.consolidate({ sessionId: "s1", agentId: "a1" });
    expect(res.writtenCount).toBe(1);
  });

  it("emits memory-write-error when store rejects", async () => {
    const { memoryStore, traceStore } = buildRig();
    const extractor = () => [{ category: "summary", content: "x" }];
    const c = new MemoryConsolidator({ memoryStore, traceStore, extractor });
    // make memoryStore.add throw
    vi.spyOn(memoryStore, "add").mockImplementation(() => {
      throw new Error("nope");
    });
    const spy = vi.fn();
    c.on("memory-write-error", spy);
    const res = await c.consolidate({ sessionId: "s1", agentId: "a1" });
    expect(spy).toHaveBeenCalledOnce();
    expect(res.writtenCount).toBe(0);
  });
});
