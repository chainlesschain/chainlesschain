/**
 * `/cost` REPL command — live in-memory token spend + estimated $ (Claude-Code
 * parity). Covers the accumulator (addUsage), the aggregate snapshot, and the
 * priced renderer (reusing llm-pricing, with config override support).
 */
import { describe, it, expect } from "vitest";
import {
  newCostStore,
  addUsage,
  costAggregate,
  renderSessionCost,
  classifyModelRole,
  categorizeByRole,
} from "../../src/repl/session-cost.js";

const ev = (provider, model, input, output) => ({
  provider,
  model,
  usage: { input_tokens: input, output_tokens: output },
});

describe("addUsage / costAggregate", () => {
  it("accumulates per provider/model across turns", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1000, 200)]);
    addUsage(s, [ev("anthropic", "claude-opus", 500, 100)]);
    addUsage(s, [ev("openai", "gpt-4o", 300, 50)]);
    const agg = costAggregate(s);
    expect(agg.total.calls).toBe(3);
    expect(agg.total.inputTokens).toBe(1800);
    expect(agg.total.outputTokens).toBe(350);
    // sorted by totalTokens desc → opus (1800) before gpt-4o (350)
    expect(agg.byModel[0].model).toBe("claude-opus");
    expect(agg.byModel[0].calls).toBe(2);
    expect(agg.byModel[0].inputTokens).toBe(1500);
    expect(agg.byModel[1].model).toBe("gpt-4o");
  });

  it("ignores zero-token events and supports token aliases", () => {
    const s = newCostStore();
    addUsage(s, [
      {
        provider: "x",
        model: "y",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    addUsage(s, [
      {
        provider: "x",
        model: "y",
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
    ]);
    const agg = costAggregate(s);
    expect(agg.total.calls).toBe(1);
    expect(agg.total.inputTokens).toBe(10);
    expect(agg.total.outputTokens).toBe(4);
  });

  it("tolerates malformed / missing usage", () => {
    const s = newCostStore();
    addUsage(s, [{ provider: "a", model: "b" }, null, { usage: null }]);
    addUsage(s, undefined);
    expect(costAggregate(s).total.calls).toBe(0);
  });
});

describe("renderSessionCost", () => {
  it("reports nothing before any LLM call", () => {
    expect(renderSessionCost(newCostStore())).toContain("no LLM calls yet");
  });

  it("prices a known model (anthropic opus: 15/75 per 1M)", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1_000_000, 1_000_000)]);
    const out = renderSessionCost(s);
    expect(out).toContain("Session cost (estimated):");
    // 1M in × $15 + 1M out × $75 = $90.0000
    expect(out).toContain("$90.0000");
    expect(out).toContain("anthropic");
    expect(out).toContain("in=1000000 out=1000000");
  });

  it("marks local providers free and unknown models unpriced", () => {
    const s = newCostStore();
    addUsage(s, [ev("ollama", "qwen2.5:7b", 500, 500)]);
    addUsage(s, [ev("mystery", "who-knows", 1000, 1000)]);
    const out = renderSessionCost(s);
    expect(out).toContain("free (local)");
    expect(out).toContain("unpriced");
    expect(out).toContain("no rate");
  });

  it("honors config.llm.pricing overrides", () => {
    const s = newCostStore();
    addUsage(s, [ev("mystery", "who-knows", 1_000_000, 0)]);
    const out = renderSessionCost(s, {
      pricingOverrides: { mystery: [{ match: "who-knows", in: 2, out: 8 }] },
    });
    expect(out).toContain("$2.0000"); // 1M input × $2
    expect(out).not.toContain("unpriced");
  });
});

describe("classifyModelRole", () => {
  const roles = {
    mainProvider: "anthropic",
    mainModel: "claude-opus",
    visionModel: "gpt-4o",
    fallbackModels: ["deepseek-chat", "qwen-max"],
  };
  it("classifies main / vision / fallback / other", () => {
    expect(classifyModelRole("anthropic", "claude-opus", roles)).toBe("main");
    expect(classifyModelRole("openai", "gpt-4o", roles)).toBe("vision");
    expect(classifyModelRole("deepseek", "deepseek-chat", roles)).toBe(
      "fallback",
    );
    expect(classifyModelRole("x", "something-else", roles)).toBe("other");
  });
  it("active model wins when names collide and is case-insensitive", () => {
    const r = { mainModel: "M", visionModel: "M", fallbackModels: ["M"] };
    expect(classifyModelRole("p", "m", r)).toBe("main");
    expect(classifyModelRole("ANTHROPIC", "CLAUDE-OPUS", roles)).toBe("main");
  });
});

describe("categorizeByRole", () => {
  const roles = {
    mainProvider: "anthropic",
    mainModel: "claude-opus",
    visionModel: "gpt-4o",
    fallbackModels: ["deepseek-chat"],
  };
  it("groups priced rows by role, sorted by cost desc", () => {
    const priced = {
      byModel: [
        {
          provider: "openai",
          model: "gpt-4o",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          calls: 1,
          cost: 0.1,
          matched: true,
          free: false,
        },
        {
          provider: "anthropic",
          model: "claude-opus",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          calls: 2,
          cost: 0.5,
          matched: true,
          free: false,
        },
        {
          provider: "ollama",
          model: "qwen",
          inputTokens: 5,
          outputTokens: 5,
          totalTokens: 10,
          calls: 1,
          cost: 0,
          matched: false,
          free: true,
        },
      ],
    };
    const cats = categorizeByRole(priced, roles);
    expect(cats.map((c) => c.category)).toEqual(["main", "vision", "other"]);
    expect(cats[0]).toMatchObject({ category: "main", cost: 0.5, calls: 2 });
    expect(cats[1]).toMatchObject({ category: "vision", cost: 0.1 });
    expect(cats[2]).toMatchObject({ category: "other", cost: 0 });
  });
});

describe("renderSessionCost — category breakdown", () => {
  it("shows a by-category section when >1 role was used", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1_000_000, 0)]); // main → $15
    addUsage(s, [ev("myprov", "my-vision", 1_000_000, 0)]); // vision → $2
    const out = renderSessionCost(s, {
      pricingOverrides: { myprov: [{ match: "my-vision", in: 2, out: 8 }] },
      roles: {
        mainProvider: "anthropic",
        mainModel: "claude-opus",
        visionModel: "my-vision",
        fallbackModels: [],
      },
    });
    expect(out).toContain("by category:");
    expect(out).toMatch(/main\s+\$15\.0000/);
    expect(out).toMatch(/vision\s+\$2\.0000/);
    expect(out).toMatch(/main\s+\$15\.0000 \(88%\)/); // 15 of 17
  });

  it("omits the breakdown for a single-model session", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1000, 200)]);
    const out = renderSessionCost(s, {
      roles: { mainProvider: "anthropic", mainModel: "claude-opus" },
    });
    expect(out).not.toContain("by category:");
  });

  it("omits the breakdown when no roles are supplied", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1000, 200)]);
    addUsage(s, [ev("openai", "gpt-4o", 500, 100)]);
    expect(renderSessionCost(s)).not.toContain("by category:");
  });
});

describe("/cost prompt-cache tokens", () => {
  const cacheEv = (input, output, cacheRead, cacheWrite) => ({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
  });

  it("accumulates cache read/write tokens into total and rows", () => {
    const s = newCostStore();
    addUsage(s, [cacheEv(100, 20, 900, 100)]);
    addUsage(s, [cacheEv(50, 10, 950, 0)]);
    const agg = costAggregate(s);
    expect(agg.total.cacheReadTokens).toBe(1850);
    expect(agg.total.cacheCreationTokens).toBe(100);
    expect(agg.byModel[0].cacheReadTokens).toBe(1850);
    expect(agg.byModel[0].cacheCreationTokens).toBe(100);
  });

  it("renders a cache line and per-row cache_read when caching occurred", () => {
    const s = newCostStore();
    addUsage(s, [cacheEv(100, 20, 1800, 200)]);
    const out = renderSessionCost(s);
    expect(out).toMatch(/cache: 1,800 read \+ 200 write tokens/);
    expect(out).toContain("cache_read=1800");
  });

  it("omits the cache line for a non-caching session", () => {
    const s = newCostStore();
    addUsage(s, [ev("openai", "gpt-4o", 100, 20)]);
    const out = renderSessionCost(s);
    expect(out).not.toContain("cache:");
    expect(out).not.toContain("cache_read=");
  });

  it("prices cached reads cheaper than the same tokens uncached", () => {
    const cached = newCostStore();
    addUsage(cached, [cacheEv(0, 0, 1_000_000, 0)]);
    const uncached = newCostStore();
    addUsage(uncached, [ev("anthropic", "claude-sonnet-4-6", 1_000_000, 0)]);
    // Both have nonzero token totals; cached read total cost << uncached input.
    const cText = renderSessionCost(cached);
    const uText = renderSessionCost(uncached);
    expect(cText).toContain("cache: 1,000,000 read");
    expect(uText).not.toContain("cache:");
  });
});
