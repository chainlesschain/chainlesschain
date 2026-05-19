"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  EntityResolverEmbeddingStage,
  entityResolverCosineSimilarity: cosineSimilarity,
  EntityResolverLLMStage,
  parseEntityResolverLLMResponse: parseLLMResponse,
  EntityResolverWorker,
  EntityResolver,
} = require("../lib/entity-resolver");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// ─── cosineSimilarity ────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("opposite vectors → 0 (clamped)", () => {
    // Mathematically -1, but we clamp to [0,1]
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  it("empty inputs → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
  });

  it("zero-norm vectors → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("Float32Array works equivalently to plain array", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

// ─── EmbeddingStage with injected embedFn ────────────────────────────────

describe("EntityResolverEmbeddingStage", () => {
  const personA = {
    id: "p-a",
    type: "person",
    names: ["张三", "Zhang"],
    identifiers: { email: ["a@x.com"], phone: ["13800001111"] },
  };
  const personB = {
    id: "p-b",
    type: "person",
    names: ["张三"],
    identifiers: { phone: ["13800001111"] },
  };

  it("constructor accepts empty opts (defaults Ollama)", () => {
    const stage = new EntityResolverEmbeddingStage({});
    expect(stage._ollamaUrl).toContain("11434");
    expect(stage._model).toBe("nomic-embed-text");
  });

  it("constructor rejects non-object opts", () => {
    expect(() => new EntityResolverEmbeddingStage(null)).toThrow();
    expect(() => new EntityResolverEmbeddingStage("string")).toThrow();
  });

  it("compare returns sim + profile", async () => {
    const stage = new EntityResolverEmbeddingStage({
      embedFn: async (text) => {
        // Deterministic stub: hash → vec
        return text.length === text.length ? [1, 2, 3] : [3, 2, 1];
      },
    });
    const r = await stage.compare(personA, personB);
    expect(r.sim).toBeCloseTo(1, 5);
    expect(r.profileA).toContain("张三");
    expect(r.profileB).toContain("张三");
  });

  it("buildProfile includes name/aliases/identifiers", () => {
    const stage = new EntityResolverEmbeddingStage({ embedFn: async () => [1] });
    const p = stage.buildProfile(personA);
    expect(p).toContain("张三");
    expect(p).toContain("Zhang");
    expect(p).toContain("email:a@x.com");
    expect(p).toContain("phone:13800001111");
  });

  it("caches embeddings per person id (1 embedFn call for repeated person)", async () => {
    let callCount = 0;
    const stage = new EntityResolverEmbeddingStage({
      embedFn: async () => { callCount += 1; return [1, 2, 3]; },
    });
    await stage.compare(personA, personB);
    await stage.compare(personA, personB);
    expect(callCount).toBe(2); // first compare embeds both; second uses cache
  });

  it("cache evicts FIFO when over cacheMaxSize", async () => {
    const stage = new EntityResolverEmbeddingStage({
      embedFn: async () => [1, 2, 3],
      cacheMaxSize: 2,
    });
    await stage.compare({ id: "p-1", names: ["a"], identifiers: {} }, { id: "p-2", names: ["b"], identifiers: {} });
    await stage.compare({ id: "p-3", names: ["c"], identifiers: {} }, { id: "p-4", names: ["d"], identifiers: {} });
    expect(stage._cache.size).toBeLessThanOrEqual(2);
  });

  it("asStageFn returns bound function", async () => {
    const stage = new EntityResolverEmbeddingStage({
      embedFn: async () => [1, 0, 0],
    });
    const fn = stage.asStageFn();
    const r = await fn(personA, personB);
    expect(r.sim).toBeDefined();
  });

  it("rejects non-array embedFn output", async () => {
    const stage = new EntityResolverEmbeddingStage({
      embedFn: async () => "not an array",
    });
    await expect(stage.compare(personA, personB)).rejects.toThrow(/Array/);
  });
});

// ─── parseLLMResponse ────────────────────────────────────────────────────

describe("parseLLMResponse", () => {
  it("parses strict JSON", () => {
    const r = parseLLMResponse('{"same":true,"confidence":0.9,"reason":"phone match"}');
    expect(r.same).toBe(true);
    expect(r.confidence).toBe(0.9);
  });

  it("parses fenced JSON", () => {
    const r = parseLLMResponse('```json\n{"same":false,"confidence":0.8,"reason":"different ids"}\n```');
    expect(r.same).toBe(false);
  });

  it("parses fenced JSON without language tag", () => {
    const r = parseLLMResponse('```\n{"same":null,"confidence":0.5,"reason":"unclear"}\n```');
    expect(r.same).toBeNull();
  });

  it("falls back to regex extraction from messy preamble", () => {
    const text = 'Here is my analysis:\n{"same":true,"confidence":0.85,"reason":"shared phone"}\nLet me know if you have questions.';
    const r = parseLLMResponse(text);
    expect(r.same).toBe(true);
  });

  it("returns null on totally garbage input", () => {
    expect(parseLLMResponse("just some prose, no json")).toBeNull();
    expect(parseLLMResponse("")).toBeNull();
    expect(parseLLMResponse(null)).toBeNull();
  });

  it("ignores JSON objects without a 'same' field", () => {
    expect(parseLLMResponse('{"foo":"bar"}')).toBeNull();
  });
});

// ─── LLMStage ────────────────────────────────────────────────────────────

describe("EntityResolverLLMStage", () => {
  const a = { id: "p-a", names: ["张三"], identifiers: { phone: ["13800001111"] }, source: { adapter: "email" } };
  const b = { id: "p-b", names: ["张三"], identifiers: { phone: ["13800001111"] }, source: { adapter: "alipay" } };

  it("constructor requires llm with .chat()", () => {
    expect(() => new EntityResolverLLMStage()).toThrow();
    expect(() => new EntityResolverLLMStage({})).toThrow();
    expect(() => new EntityResolverLLMStage({ llm: {} })).toThrow();
  });

  it("arbitrate maps same:true → verdict yes", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => ({ text: '{"same":true,"confidence":0.92,"reason":"phone match"}' }),
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("yes");
    expect(r.confidence).toBe(0.92);
  });

  it("arbitrate maps same:false → verdict no", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => ({ text: '{"same":false,"confidence":0.8,"reason":"different ids"}' }),
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("no");
  });

  it("arbitrate maps same:null → verdict maybe", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => ({ text: '{"same":null,"confidence":0.5,"reason":"insufficient evidence"}' }),
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("maybe");
  });

  it("unparseable LLM response → maybe + reason", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => ({ text: 'just some prose' }),
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("maybe");
    expect(r.confidence).toBe(0);
    expect(r.reason).toMatch(/not parseable/);
  });

  it("non-local LLM without acceptNonLocal → refuses + returns maybe", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: false,
        chat: async () => { throw new Error("should not be called"); },
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("maybe");
    expect(r.reason).toMatch(/non-local/);
  });

  it("non-local LLM with acceptNonLocal:true → allowed", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: false,
        chat: async () => ({ text: '{"same":true,"confidence":0.9,"reason":"ok"}' }),
      },
      acceptNonLocal: true,
    });
    const r = await stage.arbitrate(a, b);
    expect(r.verdict).toBe("yes");
  });

  it("LLM throwing propagates (caller handles retry)", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => { throw new Error("ollama down"); },
      },
    });
    await expect(stage.arbitrate(a, b)).rejects.toThrow(/ollama/);
  });

  it("confidence outside [0,1] gets clamped", async () => {
    const stage = new EntityResolverLLMStage({
      llm: {
        isLocal: true,
        chat: async () => ({ text: '{"same":true,"confidence":42}' }),
      },
    });
    const r = await stage.arbitrate(a, b);
    expect(r.confidence).toBe(1);
  });
});

// ─── EntityResolverWorker ───────────────────────────────────────────────

function makeMockResolver(initialQueue, drainResults) {
  let i = 0;
  const queue = [...initialQueue];
  return {
    drain: async ({ limit }) => {
      if (queue.length === 0) {
        return { processed: 0, same: 0, different: 0, review: 0, error: 0, skipped: 0 };
      }
      const result = drainResults[i] || {
        processed: Math.min(limit, queue.length),
        same: 0, different: 0, review: 0, error: 0, skipped: 0,
      };
      queue.splice(0, result.processed);
      i += 1;
      return result;
    },
    _queueLength: () => queue.length,
  };
}

describe("EntityResolverWorker", () => {
  it("constructor requires resolver", () => {
    expect(() => new EntityResolverWorker()).toThrow();
    expect(() => new EntityResolverWorker({})).toThrow(/resolver/);
  });

  it("tick processes one batch and updates stats", async () => {
    const resolver = makeMockResolver(["p1", "p2", "p3"], [
      { processed: 3, same: 1, different: 1, review: 1, error: 0, skipped: 0 },
    ]);
    const worker = new EntityResolverWorker({ resolver });
    const r = await worker.tick();
    expect(r.processed).toBe(3);
    const s = worker.stats();
    expect(s.batchesProcessed).toBe(1);
    expect(s.itemsProcessed).toBe(3);
    expect(s.same).toBe(1);
    expect(s.review).toBe(1);
  });

  it("start + stop cycle works without leaks", async () => {
    const resolver = makeMockResolver([], []);
    const worker = new EntityResolverWorker({ resolver, idleIntervalMs: 100 });
    expect(worker.isRunning()).toBe(false);
    worker.start();
    expect(worker.isRunning()).toBe(true);
    // Give the loop one tick
    await new Promise((resolve) => setTimeout(resolve, 250));
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it("processes queue then sleeps; onProgress fires per batch", async () => {
    const resolver = makeMockResolver(["p1", "p2"], [
      { processed: 2, same: 2, different: 0, review: 0, error: 0, skipped: 0 },
    ]);
    const events = [];
    const worker = new EntityResolverWorker({
      resolver,
      idleIntervalMs: 5000, // long so we observe just the first batch
      batchSpacingMs: 1,
      onProgress: (e) => events.push(e),
    });
    worker.start();
    // Give time for one batch + post-batch tiny delay
    await new Promise((resolve) => setTimeout(resolve, 200));
    await worker.stop();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].batch.same).toBe(2);
  });

  it("onProgress listener errors do NOT break the loop", async () => {
    const resolver = makeMockResolver(["p1"], [
      { processed: 1, same: 0, different: 0, review: 0, error: 0, skipped: 1 },
    ]);
    const worker = new EntityResolverWorker({
      resolver,
      idleIntervalMs: 5000,
      onProgress: () => { throw new Error("listener boom"); },
    });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await worker.stop();
    expect(worker.stats().batchesProcessed).toBeGreaterThanOrEqual(1);
  });
});

// ─── End-to-end: real EntityResolver + real EmbeddingStage stub + real Worker ──

describe("EntityResolver + EmbeddingStage + LLMStage + Worker integration", () => {
  it("queued uncertain pair → embedding high sim → auto-merged", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "er-int-"));
    const vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
    vault.open();
    try {
      // 2 persons sharing only name (rule → uncertain)
      const baseSource = { adapter: "test", adapterVersion: "0.1", originalId: "x", capturedAt: Date.now(), capturedBy: "api" };
      vault.putPerson({
        id: "p-a", type: "person", subtype: "contact",
        names: ["张三"], identifiers: {}, ingestedAt: Date.now(),
        source: { ...baseSource, adapter: "email", originalId: "1" },
      });
      vault.putPerson({
        id: "p-b", type: "person", subtype: "contact",
        names: ["张三"], identifiers: {}, ingestedAt: Date.now(),
        source: { ...baseSource, adapter: "alipay", originalId: "2" },
      });

      const embedStage = new EntityResolverEmbeddingStage({
        embedFn: async () => [1, 0, 0], // deterministic identical vec → sim=1
      });
      const llmStage = new EntityResolverLLMStage({
        llm: { isLocal: true, chat: async () => ({ text: '{"same":true,"confidence":0.9,"reason":"name"}' }) },
      });
      const resolver = new EntityResolver({
        vault,
        embeddingStage: embedStage.asStageFn(),
        llmStage: llmStage.asStageFn(),
      });

      vault.enqueueResolve("p-b");
      const worker = new EntityResolverWorker({ resolver, batchSize: 10 });
      const r = await worker.tick();
      expect(r.same).toBe(1);
      expect(vault.getMergeGroupMembers("p-a").sort()).toEqual(["p-a", "p-b"]);
    } finally {
      try { vault.close(); } catch (_e) {}
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
    }
  });
});
