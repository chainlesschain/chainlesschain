import { describe, it, expect, vi } from "vitest";
import {
  MemoryStore,
  SCOPE,
  defaultScorer,
  validateScope,
  generateMemoryId,
} from "../lib/memory-store.js";

describe("generateMemoryId", () => {
  it("returns unique mem_* ids", () => {
    const a = generateMemoryId();
    const b = generateMemoryId();
    expect(a).toMatch(/^mem_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});

describe("validateScope", () => {
  it("accepts valid scopes", () => {
    expect(() => validateScope("session")).not.toThrow();
    expect(() => validateScope("agent")).not.toThrow();
    expect(() => validateScope("global")).not.toThrow();
  });
  it("rejects invalid scope", () => {
    expect(() => validateScope("bogus")).toThrow(/invalid scope/);
  });
});

describe("defaultScorer", () => {
  it("returns score when query empty", () => {
    expect(defaultScorer("", { content: "x", score: 3 })).toBe(3);
  });
  it("scores by token overlap", () => {
    const m = { content: "hello world", tags: ["foo"], category: "bar" };
    expect(defaultScorer("hello", m)).toBeGreaterThan(0);
    expect(defaultScorer("missing", m)).toBe(0);
  });
  it("includes tags and category in haystack", () => {
    const m = { content: "abc", tags: ["alpha"], category: "beta" };
    expect(defaultScorer("alpha", m)).toBeGreaterThan(0);
    expect(defaultScorer("beta", m)).toBeGreaterThan(0);
  });
});

describe("MemoryStore.add", () => {
  it("creates a memory with required fields", () => {
    const store = new MemoryStore();
    const m = store.add({
      scope: SCOPE.SESSION,
      scopeId: "sess_1",
      content: "user prefers dark mode",
      tags: ["ui"],
    });
    expect(m.id).toMatch(/^mem_/);
    expect(m.scope).toBe("session");
    expect(m.scopeId).toBe("sess_1");
    expect(m.content).toBe("user prefers dark mode");
    expect(m.tags).toEqual(["ui"]);
    expect(m.createdAt).toBeTypeOf("number");
  });

  it("requires content", () => {
    const store = new MemoryStore();
    expect(() => store.add({ scope: SCOPE.GLOBAL })).toThrow(/content/);
  });

  it("requires scopeId for non-global scopes", () => {
    const store = new MemoryStore();
    expect(() =>
      store.add({ scope: SCOPE.SESSION, content: "x" })
    ).toThrow(/scopeId required/);
    expect(() =>
      store.add({ scope: SCOPE.AGENT, content: "x" })
    ).toThrow(/scopeId required/);
  });

  it("allows global without scopeId", () => {
    const store = new MemoryStore();
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    expect(m.scope).toBe("global");
    expect(m.scopeId).toBe(null);
  });

  it("rejects invalid scope", () => {
    const store = new MemoryStore();
    expect(() => store.add({ scope: "x", content: "y" })).toThrow(/invalid scope/);
  });

  it("emits added event", () => {
    const store = new MemoryStore();
    const spy = vi.fn();
    store.on("added", spy);
    store.add({ scope: SCOPE.GLOBAL, content: "x" });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("MemoryStore.get", () => {
  it("returns memory clone with accessedAt updated", () => {
    let t = 1000;
    const store = new MemoryStore({ now: () => t });
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    t = 2000;
    const got = store.get(m.id);
    expect(got.accessedAt).toBe(2000);
  });

  it("returns null for missing id", () => {
    expect(new MemoryStore().get("nope")).toBe(null);
  });
});

describe("MemoryStore.recall", () => {
  function seed() {
    const store = new MemoryStore();
    store.add({
      scope: SCOPE.SESSION,
      scopeId: "s1",
      content: "hello world",
      tags: ["greet"],
      category: "chat",
    });
    store.add({
      scope: SCOPE.SESSION,
      scopeId: "s2",
      content: "goodbye moon",
      tags: ["farewell"],
    });
    store.add({
      scope: SCOPE.AGENT,
      scopeId: "agent_1",
      content: "hello machine",
      tags: ["greet", "robot"],
    });
    store.add({
      scope: SCOPE.GLOBAL,
      content: "universal fact",
      tags: ["fact"],
    });
    return store;
  }

  it("filters by scope", () => {
    const store = seed();
    const r = store.recall({ scope: SCOPE.SESSION });
    expect(r.every((m) => m.scope === "session")).toBe(true);
    expect(r).toHaveLength(2);
  });

  it("filters by scope + scopeId", () => {
    const store = seed();
    const r = store.recall({ scope: SCOPE.SESSION, scopeId: "s1" });
    expect(r).toHaveLength(1);
    expect(r[0].scopeId).toBe("s1");
  });

  it("ignores scopeId for global scope filter", () => {
    const store = seed();
    const r = store.recall({ scope: SCOPE.GLOBAL, scopeId: "anything" });
    expect(r).toHaveLength(1);
    expect(r[0].scope).toBe("global");
  });

  it("filters by category", () => {
    const store = seed();
    const r = store.recall({ category: "chat" });
    expect(r).toHaveLength(1);
    expect(r[0].category).toBe("chat");
  });

  it("filters by tags (any match)", () => {
    const store = seed();
    const r = store.recall({ tags: ["greet"] });
    expect(r.map((m) => m.content).sort()).toEqual(["hello machine", "hello world"]);
  });

  it("scores by query relevance", () => {
    const store = seed();
    const r = store.recall({ query: "hello" });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].relevance).toBeGreaterThan(0);
    expect(r.every((m) => /hello/i.test(m.content) || (m.tags || []).some((t) => /hello/i.test(t)))).toBe(true);
  });

  it("limits results", () => {
    const store = seed();
    const r = store.recall({ limit: 2 });
    expect(r).toHaveLength(2);
  });

  it("excludes zero-relevance when query provided", () => {
    const store = seed();
    const r = store.recall({ query: "zzz-nomatch" });
    expect(r).toHaveLength(0);
  });

  it("returns all when no query and no filters", () => {
    const store = seed();
    const r = store.recall({ limit: 10 });
    expect(r).toHaveLength(4);
  });
});

describe("MemoryStore.update", () => {
  it("updates whitelisted fields and bumps updatedAt", () => {
    let t = 1000;
    const store = new MemoryStore({ now: () => t });
    const m = store.add({ scope: SCOPE.GLOBAL, content: "old" });
    t = 2000;
    const u = store.update(m.id, { content: "new", tags: ["x"], score: 5 });
    expect(u.content).toBe("new");
    expect(u.tags).toEqual(["x"]);
    expect(u.score).toBe(5);
    expect(u.updatedAt).toBe(2000);
  });

  it("ignores unknown fields", () => {
    const store = new MemoryStore();
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    const u = store.update(m.id, { scope: "agent", id: "other" });
    expect(u.scope).toBe("global");
    expect(u.id).toBe(m.id);
  });

  it("returns null for missing id", () => {
    expect(new MemoryStore().update("nope", { content: "y" })).toBe(null);
  });

  it("emits updated event", () => {
    const store = new MemoryStore();
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    const spy = vi.fn();
    store.on("updated", spy);
    store.update(m.id, { content: "y" });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("MemoryStore.remove", () => {
  it("removes and emits", () => {
    const store = new MemoryStore();
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    const spy = vi.fn();
    store.on("removed", spy);
    expect(store.remove(m.id)).toBe(true);
    expect(store.get(m.id)).toBe(null);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns false for missing id", () => {
    expect(new MemoryStore().remove("nope")).toBe(false);
  });
});

describe("MemoryStore.clearScope", () => {
  it("removes all memories under a scope+scopeId", () => {
    const store = new MemoryStore();
    store.add({ scope: SCOPE.SESSION, scopeId: "s1", content: "a" });
    store.add({ scope: SCOPE.SESSION, scopeId: "s1", content: "b" });
    store.add({ scope: SCOPE.SESSION, scopeId: "s2", content: "c" });
    const n = store.clearScope(SCOPE.SESSION, "s1");
    expect(n).toBe(2);
    expect(store.size()).toBe(1);
  });

  it("removes all global memories regardless of scopeId", () => {
    const store = new MemoryStore();
    store.add({ scope: SCOPE.GLOBAL, content: "a" });
    store.add({ scope: SCOPE.GLOBAL, content: "b" });
    expect(store.clearScope(SCOPE.GLOBAL)).toBe(2);
    expect(store.size()).toBe(0);
  });
});

describe("MemoryStore.list / size / clear / stats", () => {
  it("list filters by scope and scopeId", () => {
    const store = new MemoryStore();
    store.add({ scope: SCOPE.SESSION, scopeId: "s1", content: "a" });
    store.add({ scope: SCOPE.AGENT, scopeId: "a1", content: "b" });
    expect(store.list({ scope: SCOPE.SESSION })).toHaveLength(1);
    expect(store.list({ scope: SCOPE.SESSION, scopeId: "s2" })).toHaveLength(0);
  });

  it("stats counts per scope", () => {
    const store = new MemoryStore();
    store.add({ scope: SCOPE.SESSION, scopeId: "s1", content: "a" });
    store.add({ scope: SCOPE.AGENT, scopeId: "a1", content: "b" });
    store.add({ scope: SCOPE.GLOBAL, content: "c" });
    expect(store.stats()).toEqual({
      total: 3,
      session: 1,
      agent: 1,
      user: 0,
      global: 1,
    });
  });

  it("user scope requires scopeId and is isolated per user", () => {
    const store = new MemoryStore();
    expect(() => store.add({ scope: SCOPE.USER, content: "x" })).toThrow(
      /scopeId required/
    );
    store.add({ scope: SCOPE.USER, scopeId: "u1", content: "alice-pref" });
    store.add({ scope: SCOPE.USER, scopeId: "u2", content: "bob-pref" });
    expect(store.list({ scope: SCOPE.USER, scopeId: "u1" })).toHaveLength(1);
    expect(store.list({ scope: SCOPE.USER, scopeId: "u2" })).toHaveLength(1);
    expect(store.stats()).toEqual({
      total: 2,
      session: 0,
      agent: 0,
      user: 2,
      global: 0,
    });
  });

  it("validateScope accepts user", () => {
    expect(() => validateScope("user")).not.toThrow();
  });

  it("clear wipes all", () => {
    const store = new MemoryStore();
    store.add({ scope: SCOPE.GLOBAL, content: "x" });
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe("MemoryStore adapter", () => {
  it("calls adapter.save on add and update", async () => {
    const save = vi.fn().mockResolvedValue();
    const store = new MemoryStore({ adapter: { save } });
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    store.update(m.id, { content: "y" });
    await new Promise((r) => setImmediate(r));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("calls adapter.remove on remove and clearScope", async () => {
    const remove = vi.fn().mockResolvedValue();
    const store = new MemoryStore({ adapter: { remove } });
    const m = store.add({ scope: SCOPE.GLOBAL, content: "x" });
    store.remove(m.id);
    store.add({ scope: SCOPE.SESSION, scopeId: "s1", content: "y" });
    store.clearScope(SCOPE.SESSION, "s1");
    await new Promise((r) => setImmediate(r));
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("emits adapter-error when save throws", async () => {
    const save = vi.fn().mockRejectedValue(new Error("boom"));
    const store = new MemoryStore({ adapter: { save } });
    const spy = vi.fn();
    store.on("adapter-error", spy);
    store.add({ scope: SCOPE.GLOBAL, content: "x" });
    await new Promise((r) => setImmediate(r));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].op).toBe("save");
  });
});

describe("MemoryStore custom scorer", () => {
  it("uses injected scorer", () => {
    const scorer = vi.fn(() => 42);
    const store = new MemoryStore({ scorer });
    store.add({ scope: SCOPE.GLOBAL, content: "x" });
    const r = store.recall({ query: "anything" });
    expect(scorer).toHaveBeenCalled();
    expect(r[0].relevance).toBe(42);
  });
});
