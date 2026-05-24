"use strict";

import { describe, it, expect, afterEach, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { newId } = require("../lib/ids");
const { AnalysisEngine } = require("../lib/analysis");
const { MockLLMClient } = require("../lib/llm-client");

// ─── Scaffolding ─────────────────────────────────────────────────────────

let tmpDir;
let vault;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-ana-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

afterEach(() => {
  if (vault) { try { vault.close(); } catch (_e) {} vault = null; }
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ts = (year, month0, day, hour = 12) =>
  new Date(year, month0, day, hour, 0, 0, 0).getTime();

const source = (adapter = "taobao", originalId) => ({
  adapter,
  adapterVersion: "0.1.0",
  capturedAt: ts(2026, 3, 15),
  capturedBy: "api",
  ...(originalId ? { originalId } : {}),
});

function seedOrders(vault) {
  // 3 April-2026 orders to mom, 1 in May-2026 to self.
  const e1 = {
    id: newId(),
    type: "event",
    subtype: "order",
    occurredAt: ts(2026, 3, 9),
    actor: "person-self",
    participants: ["person-self", "person-mom"],
    content: {
      title: "蛋白粉 给妈妈",
      amount: { value: 288.5, currency: "CNY", direction: "out" },
    },
    ingestedAt: Date.now(),
    source: source("taobao", "ord-1"),
  };
  const e2 = {
    id: newId(),
    type: "event",
    subtype: "order",
    occurredAt: ts(2026, 3, 12),
    actor: "person-self",
    content: {
      title: "按摩仪 给妈妈",
      amount: { value: 459, currency: "CNY", direction: "out" },
    },
    ingestedAt: Date.now(),
    source: source("taobao", "ord-2"),
  };
  const e3 = {
    id: newId(),
    type: "event",
    subtype: "order",
    occurredAt: ts(2026, 3, 12, 10),
    actor: "person-self",
    content: {
      title: "鲜花 给妈妈生日",
      amount: { value: 199, currency: "CNY", direction: "out" },
    },
    ingestedAt: Date.now(),
    source: source("taobao", "ord-3"),
  };
  const e4 = {
    id: newId(),
    type: "event",
    subtype: "order",
    occurredAt: ts(2026, 4, 5), // May (out of window for "上个月" if now=mid-May)
    actor: "person-self",
    content: {
      title: "电子产品",
      amount: { value: 1599, currency: "CNY", direction: "out" },
    },
    ingestedAt: Date.now(),
    source: source("taobao", "ord-4"),
  };
  vault.putBatch({ events: [e1, e2, e3, e4], persons: [], places: [], items: [], topics: [] });
  return [e1, e2, e3, e4];
}

const NOW = new Date("2026-05-19T12:00:00Z").getTime();

// ─── Construction ────────────────────────────────────────────────────────

describe("AnalysisEngine construction", () => {
  it("requires vault + llm + llm.isLocal", () => {
    expect(() => new AnalysisEngine({})).toThrow(/vault/);
    expect(() => new AnalysisEngine({ vault: {} })).toThrow(/llm/);
    expect(() => new AnalysisEngine({ vault: {}, llm: {} })).toThrow(/chat/);
    expect(() => new AnalysisEngine({
      vault: {},
      llm: { chat: () => {} },
    })).toThrow(/isLocal/);
  });

  it("constructs cleanly with mock LLM", () => {
    freshVault();
    const llm = new MockLLMClient({ reply: "" });
    const e = new AnalysisEngine({ vault, llm });
    expect(e.maxFacts).toBe(80);
  });
});

// ─── Privacy gate ────────────────────────────────────────────────────────

describe("AnalysisEngine privacy gate", () => {
  it("refuses non-local LLM without acceptNonLocal opt-in", async () => {
    freshVault();
    const llm = new MockLLMClient({ reply: "" });
    llm.isLocal = false; // simulate cloud
    const e = new AnalysisEngine({ vault, llm });
    await expect(e.ask("hello")).rejects.toThrow(/non-local/);
    // Explicit opt-in unlocks
    await expect(e.ask("hello", { acceptNonLocal: true })).resolves.toBeDefined();
  });
});

// ─── E2E: 5 typical questions from architecture-doc §8.1 / §15.1 ────────

describe("AnalysisEngine E2E (mock LLM, real vault)", () => {
  it("Q1 sum: '上个月在淘宝总共花了多少？' — facts gathered + cited", async () => {
    freshVault();
    const [e1, e2, e3] = seedOrders(vault);

    // Mock LLM that cites e1+e2+e3 with the total. We don't compute the sum
    // here — the LLM would do that in production. We assert the engine
    // hands the right facts and correctly validates the citations.
    const llm = new MockLLMClient({
      reply: `上个月你在淘宝下了 3 单：[${e1.id}] [${e2.id}] [${e3.id}]，共 ¥946.50。`,
    });
    const engine = new AnalysisEngine({ vault, llm });
    const r = await engine.ask("上个月在淘宝总共花了多少？", { now: NOW });

    expect(r.warning).toBeNull();
    expect(r.citations.length).toBe(3);
    expect(r.citations).toContain(e1.id);
    expect(r.citations).toContain(e2.id);
    expect(r.citations).toContain(e3.id);
    expect(r.hallucinatedCitations).toEqual([]);
    // facts: exactly the 3 April orders (May order excluded by time window)
    expect(r.facts.length).toBe(3);
    expect(r.facts.every((f) => f.subtype === "order")).toBe(true);
    expect(r.parsed.filters.adapter).toBe("taobao");
    expect(r.parsed.intent).toBe("sum-amount");
  });

  it("Q2 list: '我妈生日那周买了啥' — wider window, mocked LLM cites facts", async () => {
    freshVault();
    const orders = seedOrders(vault);
    const llm = new MockLLMClient({
      reply: `你给妈妈准备了：蛋白粉 [${orders[0].id}]、按摩仪 [${orders[1].id}]、鲜花 [${orders[2].id}]。`,
    });
    const engine = new AnalysisEngine({ vault, llm });
    const r = await engine.ask("2026 年 4 月买了什么给妈妈？", { now: NOW });

    expect(r.facts.length).toBe(3); // April orders
    expect(r.citations.length).toBe(3);
    expect(r.parsed.timeWindow).not.toBeNull();
  });

  it("Q3 no-facts: empty vault yields warning='no-facts'", async () => {
    freshVault();
    const llm = new MockLLMClient({
      reply: "你的本月开销记录是空的。",
    });
    const engine = new AnalysisEngine({ vault, llm });
    const r = await engine.ask("本月总共花了多少？", { now: NOW });

    expect(r.warning).toBe("no-facts");
    expect(r.facts).toEqual([]);
    expect(r.citations).toEqual([]);
    // The mocked answer should still come through unchanged.
    expect(r.answer).toContain("空的");
  });

  it("Q4 hallucination detection: LLM cites unknown ids → warning='hallucinated-citations'", async () => {
    freshVault();
    seedOrders(vault);
    const llm = new MockLLMClient({
      reply: "总计 ¥1234 [evt-fake-id-1] [evt-also-fake-2]。",
    });
    const engine = new AnalysisEngine({ vault, llm });
    const r = await engine.ask("上个月在淘宝总共花了多少？", { now: NOW });

    expect(r.warning).toBe("hallucinated-citations");
    expect(r.hallucinatedCitations).toContain("evt-fake-id-1");
    expect(r.hallucinatedCitations).toContain("evt-also-fake-2");
    expect(r.citations).toEqual([]); // no known ids cited
  });

  it("Q5 LLM error propagates: vault stays intact, audit recorded", async () => {
    freshVault();
    seedOrders(vault);
    const llm = new MockLLMClient({});
    llm.chat = async () => { throw new Error("Ollama down"); };
    llm.isLocal = true;
    const engine = new AnalysisEngine({ vault, llm });

    await expect(engine.ask("test", { now: NOW })).rejects.toThrow(/Ollama down/);

    const audits = vault.queryAudit({ action: "analysis.llm_failed" });
    expect(audits.length).toBe(1);
  });

  it("audits every successful ask with fact + citation counts", async () => {
    freshVault();
    const orders = seedOrders(vault);
    const llm = new MockLLMClient({ reply: `cited [${orders[0].id}]` });
    const engine = new AnalysisEngine({ vault, llm });
    await engine.ask("上个月在淘宝总共花了多少？", { now: NOW });

    const audits = vault.queryAudit({ action: "analysis.ask" });
    expect(audits.length).toBe(1);
    const details = JSON.parse(audits[0].details);
    expect(details.factCount).toBe(3);
    expect(details.citationsKnown).toBe(1);
    expect(details.citationsUnknown).toBe(0);
    expect(details.warning).toBeNull();
  });

  it("skipAudit option suppresses audit row", async () => {
    freshVault();
    seedOrders(vault);
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault, llm });
    await engine.ask("test", { now: NOW, skipAudit: true });
    expect(vault.queryAudit({ action: "analysis.ask" }).length).toBe(0);
  });
});

// ─── RAG augmentation ────────────────────────────────────────────────────

describe("AnalysisEngine RAG retriever", () => {
  it("adds RAG-retrieved events to facts (by id lookup in vault)", async () => {
    freshVault();
    const orders = seedOrders(vault);

    // RAG returns the May order (which falls OUTSIDE the "上个月" time window)
    // — engine should still include it because RAG marks it semantically
    // relevant.
    const ragRetriever = async () => [{ id: orders[3].id, text: "fake", metadata: {} }];

    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault, llm, ragRetriever });
    const r = await engine.ask("上个月在淘宝总共花了多少？", { now: NOW });

    // Original 3 April orders + 1 May order pulled by RAG.
    expect(r.facts.length).toBe(4);
    expect(r.ragContextIds).toEqual([orders[3].id]);
  });

  it("RAG failure is captured but doesn't abort the ask", async () => {
    freshVault();
    seedOrders(vault);
    const ragRetriever = async () => { throw new Error("qdrant unreachable"); };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault, llm, ragRetriever });

    const r = await engine.ask("test", { now: NOW });
    expect(r.answer).toBe("ok");
    const audits = vault.queryAudit({ action: "analysis.rag_failed" });
    expect(audits.length).toBe(1);
  });
});

// ─── TOTALS block — authoritative counts beat FACTS sample length ─────
//
// Bug 2026-05-21: even after _gatherFacts pulled persons + items into the
// prompt, the LLM still said "32 contacts" because FACTS is capped at 80
// items and the LLM was counting the array. Real vault had ~500 contacts.
// Fix: stick vault.stats() totals at the head of the user message so the
// model has an authoritative ground-truth number to quote.

describe("AnalysisEngine emits TOTALS preamble", () => {
  it("includes vault.stats() totals in the prompt", async () => {
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: () => [],
      queryItems: () => [],
      stats: () => ({ events: 12, persons: 512, places: 3, items: 89, topics: 0 }),
      getEvent: () => null,
      audit: () => {},
    };
    const chatCalls = [];
    const llm = {
      isLocal: true,
      chat: async (msgs) => {
        chatCalls.push(msgs);
        return { text: "ok", usage: {} };
      },
    };
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("几个联系人");
    const userMsg = chatCalls[0][1].content;
    expect(userMsg).toContain("TOTALS");
    expect(userMsg).toContain('"persons": 512');
    expect(userMsg).toContain('"items": 89');
    // System prompt tells LLM to trust TOTALS for counts.
    expect(chatCalls[0][0].content).toMatch(/TOTALS.*authoritative/i);
  });

  it("intent=count for '几个联系人' and '几个 app' and '多少个 X'", () => {
    const { parseQuery } = require("../lib/query-parser");
    expect(parseQuery("几个联系人").intent).toBe("count");
    expect(parseQuery("几个 app").intent).toBe("count");
    expect(parseQuery("我有多少个联系人？").intent).toBe("count");
    expect(parseQuery("how many contacts do I have").intent).toBe("count");
    expect(parseQuery("列出我的联系人").intent).toBe("list");
  });

  it("legacy vault without stats() falls back gracefully — no TOTALS block", async () => {
    const legacyVault = {
      queryEvents: () => [],
      // no stats()
      getEvent: () => null,
      audit: () => {},
    };
    const chatCalls = [];
    const llm = {
      isLocal: true,
      chat: async (msgs) => {
        chatCalls.push(msgs);
        return { text: "ok", usage: {} };
      },
    };
    const engine = new AnalysisEngine({ vault: legacyVault, llm });
    await engine.ask("test");
    const userMsg = chatCalls[0][1].content;
    expect(userMsg).not.toContain("TOTALS");
  });
});

// ─── Cache bypass — PDH ask must always go to LLM, never cached ───────
//
// Bug 2026-05-21: desktop ResponseCache (7-day TTL) served a stale
// hallucinated answer ("32 contacts") even after _gatherFacts fix put real
// persons in the prompt — same sha256(messages) hit from an earlier session.
// AnalysisEngine.ask must pass skipCache:true so LLMManager bypasses cache.

describe("AnalysisEngine.ask cache bypass", () => {
  it("passes skipCache:true to llm.chat options", async () => {
    freshVault();
    seedOrders(vault);
    const chatCalls = [];
    const llm = {
      isLocal: true,
      chat: async (messages, opts) => {
        chatCalls.push({ messages, opts });
        return { text: "ok", usage: {} };
      },
    };
    const engine = new AnalysisEngine({ vault, llm });
    await engine.ask("test", { now: NOW });
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].opts.skipCache).toBe(true);
  });

  it("retrieveContext does NOT need skipCache (no LLM call)", async () => {
    freshVault();
    seedOrders(vault);
    const llm = {
      isLocal: true,
      chat: () => {
        throw new Error("must not be called");
      },
    };
    const engine = new AnalysisEngine({ vault, llm });
    // retrieveContext is Path Y — caller hosts the LLM, so cache concerns
    // belong to the caller, not us. Don't pass skipCache here.
    const r = await engine.retrieveContext("test");
    expect(r.factCount).toBeGreaterThanOrEqual(0);
  });
});

// ─── Path C follow-up — persons / items show up as facts ───────────────
//
// Bug 2026-05-21: "我有几个联系人" hallucinated "2" because contacts ingest
// into persons table but _gatherFacts only queried events. Fix: pull persons
// + items into facts within the maxFacts budget.

describe("AnalysisEngine._gatherFacts includes persons and items", () => {
  it("returns persons + items even when events are empty (contacts-only vault)", async () => {
    freshVault();
    // Use a fake vault that exposes queryPersons / queryItems but no event
    // history — mimics the post-Path-C-ingest state where contacts +
    // installed apps are the only data.
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: ({ limit }) => {
        const n = Math.min(limit ?? 100, 5);
        return Array.from({ length: n }, (_, i) => ({
          id: "person-android-" + i,
          type: "person",
          subtype: "contact",
          names: ["联系人" + i],
          ingestedAt: Date.now(),
          source: {
            adapter: "system-data-android",
            adapterVersion: "0.1.0",
            capturedAt: Date.now(),
            capturedBy: "api",
          },
        }));
      },
      queryItems: ({ limit }) => {
        const n = Math.min(limit ?? 100, 3);
        return Array.from({ length: n }, (_, i) => ({
          id: "item-android-app-com.foo" + i,
          type: "item",
          subtype: "other",
          name: "App" + i,
          ingestedAt: Date.now(),
          source: {
            adapter: "system-data-android",
            adapterVersion: "0.1.0",
            capturedAt: Date.now(),
            capturedBy: "api",
          },
        }));
      },
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "你共有 5 个联系人" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("我有几个联系人");
    expect(r.facts.length).toBe(8); // 0 events + 5 persons + 3 items
    expect(r.facts.filter((f) => f.type === "person").length).toBe(5);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(3);
  });

  it("respects maxFacts budget — events get majority, persons + items split remainder", async () => {
    const fakeVault = {
      queryEvents: () => Array.from({ length: 60 }, (_, i) => ({
        id: "event-" + i, type: "event", subtype: "order",
        occurredAt: Date.now(), actor: "person-self",
        ingestedAt: Date.now(), source: {
          adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api",
        },
      })),
      queryPersons: ({ limit }) => Array.from({ length: Math.min(limit, 100) }, (_, i) => ({
        id: "p-" + i, type: "person", subtype: "contact",
        names: ["P" + i], ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryItems: ({ limit }) => Array.from({ length: Math.min(limit, 100) }, (_, i) => ({
        id: "i-" + i, type: "item", subtype: "other", name: "Item" + i,
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 80 });
    const r = await engine.retrieveContext("hello");
    // 60 events + budget for the rest. remaining = 80-60 = 20 → 10 persons + 10 items
    expect(r.facts.filter((f) => f.type === "event").length).toBe(60);
    expect(r.facts.filter((f) => f.type === "person").length).toBe(10);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(10);
  });

  it("gracefully degrades when vault lacks queryPersons / queryItems (legacy fork)", async () => {
    const legacyVault = {
      queryEvents: () => [],
      // no queryPersons / queryItems methods
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: legacyVault, llm });
    const r = await engine.ask("hello");
    expect(r.facts.length).toBe(0);
    expect(r.warning).toBe("no-facts");
  });

  it("events take majority when budget < events.length (no person/item budget left)", async () => {
    const fakeVault = {
      queryEvents: () => Array.from({ length: 80 }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "order",
        occurredAt: Date.now(), actor: "self",
        ingestedAt: Date.now(),
        source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryPersons: vi.fn(() => []),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 80 });
    const r = await engine.ask("hi");
    expect(r.facts.length).toBe(80);
    // budget exhausted → queryPersons / queryItems still called but with limit 0
    // (current impl skips with personBudget <= 0). Verify they're NOT called.
    expect(fakeVault.queryPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryItems).not.toHaveBeenCalled();
  });
});

// ─── Empty / bad input ────────────────────────────────────────────────────

describe("AnalysisEngine input validation", () => {
  it("rejects empty / non-string question", async () => {
    freshVault();
    const engine = new AnalysisEngine({
      vault,
      llm: new MockLLMClient({ reply: "" }),
    });
    await expect(engine.ask("")).rejects.toThrow(/non-empty/);
    await expect(engine.ask(null)).rejects.toThrow();
  });
});

// ─── retrieveContext: prompt assembly without LLM call ───────────────────
//
// Path Y wiring lets a mobile front-end host the LLM call locally (e.g. the
// Android-side Volcengine Doubao adapter) while keeping vault + retrieval on
// the desktop. retrieveContext mirrors the front half of ask() and returns
// the assembled messages so the caller can hand them straight to its own LLM.

describe("AnalysisEngine.retrieveContext", () => {
  it("returns parsed + facts + messages without invoking the LLM", async () => {
    freshVault();
    const [e1, e2, e3] = seedOrders(vault);

    // LLM that would throw if called — proves retrieveContext is LLM-free.
    const llm = {
      isLocal: true,
      chat: () => { throw new Error("LLM must not be called by retrieveContext"); },
    };
    const engine = new AnalysisEngine({ vault, llm });
    const r = await engine.retrieveContext("上个月在淘宝总共花了多少？", { now: NOW });

    expect(r.question).toBe("上个月在淘宝总共花了多少？");
    expect(r.parsed.filters.adapter).toBe("taobao");
    expect(r.facts.length).toBe(3);
    expect(r.factIds).toEqual(expect.arrayContaining([e1.id, e2.id, e3.id]));
    expect(r.factCount).toBe(3);
    expect(r.truncated).toBe(false);
    expect(Array.isArray(r.messages)).toBe(true);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages[0]).toHaveProperty("role");
    expect(r.messages[0]).toHaveProperty("content");
    expect(r.systemPrompt).toBeTypeOf("string");
    expect(r.retrievedAt).toBeTypeOf("number");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("ignores acceptNonLocal — privacy gate does not apply (no LLM contacted)", async () => {
    freshVault();
    seedOrders(vault);
    // Non-local LLM declared on the engine, but retrieveContext doesn't call it.
    const llm = {
      isLocal: false,
      chat: () => { throw new Error("must not be called"); },
    };
    const engine = new AnalysisEngine({ vault, llm });
    // No acceptNonLocal option needed.
    const r = await engine.retrieveContext("test", { now: NOW });
    expect(r.factCount).toBeGreaterThanOrEqual(0);
  });

  it("incorporates RAG retriever results into facts", async () => {
    freshVault();
    const orders = seedOrders(vault);
    const ragRetriever = async () => [{ id: orders[3].id, text: "fake", metadata: {} }];
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault, llm, ragRetriever });
    const r = await engine.retrieveContext("上个月在淘宝总共花了多少？", { now: NOW });
    expect(r.facts.length).toBe(4);
    expect(r.ragContextIds).toEqual([orders[3].id]);
  });

  it("RAG failure is captured but doesn't abort retrieval", async () => {
    freshVault();
    seedOrders(vault);
    const ragRetriever = async () => { throw new Error("qdrant unreachable"); };
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault, llm, ragRetriever });
    const r = await engine.retrieveContext("test", { now: NOW });
    expect(r.factCount).toBeGreaterThanOrEqual(0);
    const audits = vault.queryAudit({ action: "analysis.rag_failed" });
    expect(audits.length).toBe(1);
  });

  it("writes analysis.retrieve_context audit row by default", async () => {
    freshVault();
    seedOrders(vault);
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault, llm });
    await engine.retrieveContext("test", { now: NOW });
    const audits = vault.queryAudit({ action: "analysis.retrieve_context" });
    expect(audits.length).toBe(1);
  });

  it("rejects empty / non-string question", async () => {
    freshVault();
    const engine = new AnalysisEngine({
      vault,
      llm: new MockLLMClient({ reply: "" }),
    });
    await expect(engine.retrieveContext("")).rejects.toThrow(/non-empty/);
    await expect(engine.retrieveContext(null)).rejects.toThrow();
  });
});

// ─── Per-call budget overrides (small-model callers) ─────────────────────
//
// On-device Qwen2.5-1.5B has an effective instruction-following window of
// 2-4K tokens, much tighter than the 80-fact / 200-row default sized for
// desktop 7B+ models. Android passes `maxFacts=20 maxQueryLimit=50` per
// call to keep the prompt ~1.5K tokens. Construction stays untouched so
// the desktop default path is unaffected.
describe("AnalysisEngine per-call budget overrides", () => {
  it("ask() honors options.maxFacts and options.maxQueryLimit", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        // Return exactly q.limit rows so we can detect the cap.
        return Array.from({ length: q.limit }, (_, i) => ({
          id: "e" + i, type: "event", subtype: "order",
          occurredAt: Date.now(), actor: "self", ingestedAt: Date.now(),
          source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
        }));
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 30, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    // Default constructor (maxFacts=80, maxQueryLimit=200) — overridden per call.
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("hi", { maxFacts: 10, maxQueryLimit: 50 });
    // queryEvents.limit must reflect the per-call override, not the default 200.
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(50);
  });

  it("ask() retrieveContext-level maxFacts bounds factCount via buildPrompt", async () => {
    const fakeVault = {
      queryEvents: (q) => Array.from({ length: q.limit }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "order",
        occurredAt: Date.now(), actor: "self", ingestedAt: Date.now(),
        source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 200, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.retrieveContext("hi", { maxFacts: 10, maxQueryLimit: 50 });
    // _gatherFacts returns 50 events, but buildPrompt caps factCount to maxFacts=10.
    // `truncated` is a count of dropped facts, not a boolean.
    expect(r.factCount).toBe(10);
    expect(r.truncated).toBe(40); // 50 gathered - 10 kept = 40 truncated
  });

  it("retrieveContext() honors options.maxFacts and options.maxQueryLimit", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return [];
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.retrieveContext("hi", { maxFacts: 15, maxQueryLimit: 40 });
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(40);
  });

  it("ignores non-positive / non-integer overrides → falls back to constructor defaults", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => { queryEventsCalls.push(q); return []; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = { isLocal: true, chat: () => { throw new Error("nope"); } };
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.retrieveContext("hi", { maxFacts: 0, maxQueryLimit: -5 });
    // Both bogus → fall back to ctor defaults (maxQueryLimit=200)
    expect(queryEventsCalls[0].limit).toBe(200);
  });
});

// ─── intent=latest routing — newest-few path ─────────────────────────────
//
// 2026-05-24 follow-up — _gatherFacts now routes intent=latest WITHOUT a
// time window to a hard-capped queryEvents({ limit: 3 }) and skips
// persons/items entirely. Frees prompt budget for the LLM to actually read
// row content instead of skimming 200 rows. Memory:
// pdh_analysis_engine_intent_routing.md.
//
// Guards covered:
//   (a) intent=latest + no timeWindow → ≤3 events, persons/items NOT touched
//   (b) intent=latest + timeWindow ("最近 30 天") → fall through (list semantics)
//   (c) intent=latest + 0 results → fall back to default (persons+items pulled)
//   (d) intent=latest + adapter filter → respects filter on the narrow path
//   (e) parseQuery sanity: "最近的订单" → intent=latest, timeWindow=null

describe("AnalysisEngine._gatherFacts intent=latest routing", () => {
  it("(a) latest without timeWindow → ≤3 events, persons/items NOT queried", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return Array.from({ length: 10 }, (_, i) => ({
          id: "e-" + i, type: "event", subtype: "order",
          occurredAt: Date.now() - i * 1000, actor: "self",
          ingestedAt: Date.now(),
          source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
        })).slice(0, q.limit);
      },
      queryPersons: vi.fn(() => []),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 10, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("最近的订单");

    expect(r.parsed.intent).toBe("latest");
    expect(r.parsed.timeWindow).toBeNull();
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(3);
    expect(r.facts).toHaveLength(3);
    expect(r.facts.every((f) => f.type === "event")).toBe(true);
    expect(fakeVault.queryPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryItems).not.toHaveBeenCalled();
  });

  it("(b) latest WITH timeWindow ('最近 30 天') → falls through to default broader path", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return [];
      },
      queryPersons: vi.fn(() => []),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("最近 30 天的消费", { now: NOW });

    expect(r.parsed.intent).toBe("latest");
    expect(r.parsed.timeWindow).not.toBeNull();
    // Default path: limit=200 (DEFAULT_MAX_QUERY_LIMIT), NOT 3.
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(200);
    // Default path also tries persons + items (budget remaining after 0 events).
    expect(fakeVault.queryPersons).toHaveBeenCalled();
    expect(fakeVault.queryItems).toHaveBeenCalled();
  });

  it("(c) latest with 0 results → fallback pulls persons + items via default path", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return []; // both narrow + default calls return 0 events
      },
      queryPersons: ({ limit }) => Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
        id: "p-" + i, type: "person", subtype: "contact", names: ["P" + i],
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryItems: ({ limit }) => Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
        id: "i-" + i, type: "item", subtype: "other", name: "I" + i,
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 2, places: 0, items: 2, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("最近的订单");

    // Narrow path (limit=3) called first, returned 0 → fall through to default
    // (limit=200) — so we expect 2 queryEvents calls total.
    expect(queryEventsCalls).toHaveLength(2);
    expect(queryEventsCalls[0].limit).toBe(3);
    expect(queryEventsCalls[1].limit).toBe(200);
    // Default path pulled persons + items; user gets a useful answer instead of "no-facts".
    expect(r.facts.filter((f) => f.type === "person").length).toBe(2);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(2);
  });

  it("(d) latest passes adapter filter to the narrow queryEvents call", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return Array.from({ length: 3 }, (_, i) => ({
          id: "e-" + i, type: "event", subtype: "order",
          occurredAt: Date.now() - i * 1000, actor: "self",
          ingestedAt: Date.now(),
          source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
        }));
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 3, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("最近在淘宝买的");

    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].adapter).toBe("taobao");
    expect(queryEventsCalls[0].limit).toBe(3);
  });

  it("(e) parseQuery sanity: '最近的订单' → intent=latest, timeWindow=null", () => {
    const { parseQuery } = require("../lib/query-parser");
    const q = parseQuery("最近的订单");
    expect(q.intent).toBe("latest");
    expect(q.timeWindow).toBeNull();
    // Sanity: 最近 N 天 still produces both (list-with-window semantics on
    // the engine side, but parser still tags intent=latest because "最近"
    // matches. Engine's heuristic handles the disambiguation.)
    const q2 = parseQuery("最近 30 天");
    expect(q2.intent).toBe("latest");
    expect(q2.timeWindow).not.toBeNull();
  });

  it("(f) latest narrow path respects per-call maxFacts cap (Android small-model 20 budget)", async () => {
    // If caller passes maxFacts=2 (tighter than LATEST_INTENT_FACT_LIMIT=3),
    // honor the tighter cap — small-model callers know their budget best.
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return Array.from({ length: q.limit }, (_, i) => ({
          id: "e-" + i, type: "event", subtype: "order",
          occurredAt: Date.now() - i * 1000, actor: "self",
          ingestedAt: Date.now(),
          source: { adapter: "taobao", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
        }));
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 2, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("最近消息", { maxFacts: 2 });
    expect(queryEventsCalls[0].limit).toBe(2);
  });
});
