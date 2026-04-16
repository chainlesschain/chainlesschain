import { describe, it, expect } from "vitest";
import { MemoryStore } from "../lib/memory-store.js";
import {
  resolveBundle,
  applyUserMemorySeed,
  parseUserMdSeed,
  buildSystemPrompt,
} from "../lib/agent-bundle-resolver.js";

function makeBundle(overrides = {}) {
  return {
    path: "/tmp/x",
    manifest: { id: "acme", name: "Acme", mode: "local", version: "1.0.0" },
    agentsMd: "# Acme\nBe concise.",
    userMd: "# profile\nUser prefers Rust.\n# tone\nCasual.",
    skillsDir: null,
    mcpConfig: null,
    approvalPolicy: null,
    sandboxPolicy: null,
    capabilities: null,
    warnings: [],
    ...overrides,
  };
}

describe("parseUserMdSeed", () => {
  it("splits by H1 categories", () => {
    const entries = parseUserMdSeed("# profile\nAlice\n# tone\nCasual");
    expect(entries).toEqual([
      { category: "profile", content: "Alice" },
      { category: "tone", content: "Casual" },
    ]);
  });
  it("falls back to profile category when no heading", () => {
    const entries = parseUserMdSeed("Just a note.");
    expect(entries).toEqual([{ category: "profile", content: "Just a note." }]);
  });
  it("returns empty array for empty/null", () => {
    expect(parseUserMdSeed(null)).toEqual([]);
    expect(parseUserMdSeed("")).toEqual([]);
    expect(parseUserMdSeed("   ")).toEqual([]);
  });
  it("normalizes heading into kebab-case category", () => {
    const entries = parseUserMdSeed("# My Favorite Topics\nfoo");
    expect(entries[0].category).toBe("my-favorite-topics");
  });
});

describe("buildSystemPrompt", () => {
  it("returns trimmed AGENTS.md", () => {
    expect(buildSystemPrompt(makeBundle({ agentsMd: "  hi  " }))).toBe("hi");
  });
  it("returns null when absent", () => {
    expect(buildSystemPrompt(makeBundle({ agentsMd: null }))).toBeNull();
    expect(buildSystemPrompt(null)).toBeNull();
  });
});

describe("applyUserMemorySeed", () => {
  it("writes each USER.md segment as memory", () => {
    const store = new MemoryStore();
    const res = applyUserMemorySeed(store, makeBundle());
    expect(res.seeded).toBe(2);
    const all = store.recall({ tags: ["user-seed"], limit: 10 });
    expect(all.length).toBe(2);
    expect(all.some((m) => m.content.includes("Rust"))).toBe(true);
  });

  it("is idempotent — second call skips", () => {
    const store = new MemoryStore();
    const bundle = makeBundle();
    const first = applyUserMemorySeed(store, bundle);
    const second = applyUserMemorySeed(store, bundle);
    expect(first.seeded).toBe(2);
    expect(second.seeded).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("returns zero when USER.md missing", () => {
    const store = new MemoryStore();
    const res = applyUserMemorySeed(store, makeBundle({ userMd: null }));
    expect(res).toEqual({ seeded: 0, skipped: 0 });
  });

  it("returns zero when store lacks add()", () => {
    const res = applyUserMemorySeed({}, makeBundle());
    expect(res).toEqual({ seeded: 0, skipped: 0 });
  });

  it("tags include bundle id", () => {
    const store = new MemoryStore();
    applyUserMemorySeed(store, makeBundle());
    const rows = store.recall({ tags: ["bundle:acme"], limit: 10 });
    expect(rows.length).toBe(2);
  });

  it("writes to user scope when userId provided", () => {
    const store = new MemoryStore();
    applyUserMemorySeed(store, makeBundle(), { userId: "u_42" });
    const rows = store.list({ scope: "user", scopeId: "u_42" });
    expect(rows.length).toBe(2);
  });

  it("defaults to global when userId absent", () => {
    const store = new MemoryStore();
    applyUserMemorySeed(store, makeBundle());
    const rows = store.list({ scope: "global" });
    expect(rows.length).toBe(2);
  });
});

describe("resolveBundle", () => {
  it("returns runtime view without deps", () => {
    const v = resolveBundle(makeBundle());
    expect(v.manifest.id).toBe("acme");
    expect(v.systemPrompt).toMatch(/Be concise/);
    expect(v.seedResult).toBeNull();
  });

  it("seeds memory when memoryStore dep provided", () => {
    const store = new MemoryStore();
    const v = resolveBundle(makeBundle(), { memoryStore: store });
    expect(v.seedResult.seeded).toBe(2);
  });

  it("throws for invalid bundle input", () => {
    expect(() => resolveBundle(null)).toThrow(/bundle is required/);
  });

  it("propagates warnings", () => {
    const v = resolveBundle(makeBundle({ warnings: ["w1"] }));
    expect(v.warnings).toEqual(["w1"]);
    // 防污染:修改返回的数组不影响源 bundle
    v.warnings.push("w2");
    const v2 = resolveBundle(makeBundle({ warnings: ["w1"] }));
    expect(v2.warnings).toEqual(["w1"]);
  });
});
