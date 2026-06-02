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

// ─── intent=sum-amount Phase 2 — AMOUNT_SUM authoritative total ──────────
describe("AnalysisEngine emits AMOUNT_SUM preamble (intent=sum-amount Phase 2)", () => {
  const baseVault = (over) => ({
    queryEvents: () => [],
    queryPersons: () => [],
    queryItems: () => [],
    stats: () => ({ events: 5, persons: 0, places: 0, items: 0, topics: 0 }),
    getEvent: () => null,
    audit: () => {},
    ...over,
  });
  const captureLlm = (calls) => ({
    isLocal: true,
    chat: async (msgs) => {
      calls.push(msgs);
      return { text: "ok", usage: {} };
    },
  });

  it("calls sumEventAmount for sum-amount intent and puts AMOUNT_SUM in prompt", async () => {
    const sumCalls = [];
    const fakeVault = baseVault({
      sumEventAmount: (f) => {
        sumCalls.push(f);
        return { total: 888.8, currency: "CNY", count: 5, byDirection: { out: 888.8, in: 0 } };
      },
    });
    const chatCalls = [];
    const engine = new AnalysisEngine({ vault: fakeVault, llm: captureLlm(chatCalls) });
    await engine.ask("我总共花了多少钱");
    expect(sumCalls.length).toBe(1);
    const userMsg = chatCalls[0][1].content;
    expect(userMsg).toContain("AMOUNT_SUM");
    expect(userMsg).toContain('"total": 888.8');
    expect(chatCalls[0][0].content).toMatch(/AMOUNT_SUM.*authoritative/i);
  });

  it("does NOT call sumEventAmount for non-sum-amount intent", async () => {
    const sumCalls = [];
    const fakeVault = baseVault({
      sumEventAmount: (f) => {
        sumCalls.push(f);
        return { total: 0, currency: "CNY", count: 0, byDirection: { out: 0, in: 0 } };
      },
    });
    const engine = new AnalysisEngine({ vault: fakeVault, llm: captureLlm([]) });
    await engine.ask("列出我的联系人"); // intent=list
    expect(sumCalls.length).toBe(0);
  });

  it("omits AMOUNT_SUM block when sumEventAmount returns count 0", async () => {
    const fakeVault = baseVault({
      sumEventAmount: () => ({ total: 0, currency: "CNY", count: 0, byDirection: { out: 0, in: 0 } }),
    });
    const chatCalls = [];
    const engine = new AnalysisEngine({ vault: fakeVault, llm: captureLlm(chatCalls) });
    await engine.ask("我总共花了多少钱");
    expect(chatCalls[0][1].content).not.toContain("AMOUNT_SUM");
  });

  it("legacy vault without sumEventAmount falls back gracefully", async () => {
    const fakeVault = baseVault({}); // no sumEventAmount
    const chatCalls = [];
    const engine = new AnalysisEngine({ vault: fakeVault, llm: captureLlm(chatCalls) });
    await engine.ask("我总共花了多少钱");
    expect(chatCalls[0][1].content).not.toContain("AMOUNT_SUM");
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
  it("contact question routes via entityFocus=persons — persons only, no items competition", async () => {
    freshVault();
    // 2026-05-27 fix: "我有几个联系人" now matches parseEntityFocus → "persons",
    // which intentionally skips the items table to give the full prompt
    // budget to contacts. Pre-fix this test asserted 5 persons + 3 items
    // (8 facts) because _gatherFacts always pulled both tables; post-fix
    // items are deliberately excluded — the user asked about contacts, not
    // apps. Items still surface for generic "what's in my vault" questions
    // (entityFocus=null) and for explicit "我装了哪些 app" (entityFocus=
    // "items"). Verified at __tests__:_gatherFacts entityFocus routing.
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
    expect(r.facts.filter((f) => f.type === "person").length).toBe(5);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(0);
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

  it("events overflow + empty side tables → events refill the reserved slots", async () => {
    // 2026-05-27 fix: when events would monopolize effMaxFacts the engine
    // reserves slots for persons + items; if BOTH side tables return 0 rows
    // the reserve is refilled with events so a contact-less vault still
    // sees the full event budget.
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
    expect(r.facts.filter((f) => f.type === "event").length).toBe(80);
    // Side queries WERE called (different from pre-fix); they just returned [].
    expect(fakeVault.queryPersons).toHaveBeenCalledWith({ limit: 16 });
    expect(fakeVault.queryItems).toHaveBeenCalledWith({ limit: 8 });
  });

  it("Android small-model budget — events overflow cap, persons survive", async () => {
    // Regression: Android local path (effMaxFacts=20, effMaxQueryLimit=50).
    // Vault returns 50 events; pre-fix _gatherFacts shipped 50 events,
    // buildPrompt sliced to first 20 events, persons = 0 → "几个联系人"
    // hallucinated zero. Now events cap at 14 (20*0.7), persons get 3,
    // items get 3 → contact rows reach the LLM.
    const fakeVault = {
      queryEvents: () => Array.from({ length: 50 }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "message",
        occurredAt: Date.now(), actor: "self",
        ingestedAt: Date.now(),
        source: { adapter: "wechat", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryPersons: ({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "p" + i, type: "person", subtype: "contact",
        names: ["联系人" + i], ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryItems: ({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "i" + i, type: "item", subtype: "other", name: "App" + i,
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({
      vault: fakeVault, llm,
      maxFacts: 20, maxQueryLimit: 50,
    });
    const r = await engine.ask("hi"); // generic question — default path
    // 20 * 0.2 = 4 persons, 20 * 0.1 = 2 items, remainder 14 for events.
    expect(r.facts.filter((f) => f.type === "event").length).toBe(14);
    expect(r.facts.filter((f) => f.type === "person").length).toBe(4);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(2);
  });
});

// ─── entityFocus routing — persons / items table priority ────────────────
//
// 2026-05-27 fix: when the question is explicitly about contacts ("我有
// 哪些联系人", "妈手机号"), _gatherFacts must NOT compete persons against
// the events pool. Pre-fix Android small-model budgets (20 facts / 50 row
// cap) had events drown out the contact slice → user saw "没数据" even
// when the vault held hundreds of contacts.

describe("AnalysisEngine._gatherFacts entityFocus routing", () => {
  it("entityFocus=persons skips events broad scan, prioritizes persons", async () => {
    const fakeVault = {
      queryEvents: vi.fn(() => Array.from({ length: 50 }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "message",
        occurredAt: Date.now(), actor: "self",
        ingestedAt: Date.now(),
        source: { adapter: "wechat", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      }))),
      queryPersons: vi.fn(({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "p" + i, type: "person", subtype: "contact",
        names: ["联系人" + i], ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      }))),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({
      vault: fakeVault, llm,
      maxFacts: 20, maxQueryLimit: 50,
    });
    const r = await engine.ask("我有哪些联系人");
    // 95% goes to persons (19), 5% headroom = 1 event slot.
    expect(r.facts.filter((f) => f.type === "person").length).toBe(19);
    expect(r.facts.filter((f) => f.type === "event").length).toBeLessThanOrEqual(1);
    expect(fakeVault.queryPersons).toHaveBeenCalledWith({ limit: 19 });
  });

  it("entityFocus=persons falls through to default path when persons table is empty", async () => {
    const fakeVault = {
      queryEvents: () => Array.from({ length: 5 }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "message",
        occurredAt: Date.now(), actor: "self",
        ingestedAt: Date.now(),
        source: { adapter: "wechat", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryPersons: () => [], // empty contacts table
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("我有哪些联系人");
    // Fell through to default → 5 events surfaced (no cap since 5 < 80).
    expect(r.facts.filter((f) => f.type === "event").length).toBe(5);
  });

  it("entityFocus=persons with name candidate → searchPersons short-circuit", async () => {
    // 2026-05-27 S3 治本 — "妈手机号" must hit searchPersons LIKE search
    // even when vault holds 500 contacts. Pre-S3 _gatherFacts dumped the
    // first N by ingest_at; the target person rarely landed in the slice.
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: vi.fn(() => [
        { id: "p-other", type: "person", subtype: "contact", names: ["张三"], ingestedAt: 0,
          source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: 0, capturedBy: "api" } },
      ]),
      searchPersons: vi.fn(({ q, limit }) => {
        if (q === "妈") {
          return [{
            id: "p-mom", type: "person", subtype: "contact", names: ["妈妈"],
            identifiers: { phone: ["13800138000"] }, ingestedAt: 0,
            source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: 0, capturedBy: "api" },
          }];
        }
        return [];
      }),
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "妈手机号是 13800138000" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 20 });
    const r = await engine.ask("妈手机号是多少");
    expect(fakeVault.searchPersons).toHaveBeenCalledWith({ q: "妈", limit: 19 });
    expect(fakeVault.queryPersons).not.toHaveBeenCalled(); // search hit → skip fallback
    expect(r.facts.filter((f) => f.type === "person").length).toBe(1);
    expect(r.facts.find((f) => f.id === "p-mom")).toBeDefined();
  });

  it("entityFocus=persons with name candidate but 0 search hits → falls back to queryPersons", async () => {
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: vi.fn(({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "p" + i, type: "person", subtype: "contact", names: ["P" + i], ingestedAt: 0,
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: 0, capturedBy: "api" },
      }))),
      searchPersons: vi.fn(() => []), // 0 hits
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 20 });
    await engine.ask("张三的电话号码");
    expect(fakeVault.searchPersons).toHaveBeenCalled();
    expect(fakeVault.queryPersons).toHaveBeenCalledWith({ limit: 19 });
  });

  it("entityFocus=persons without name candidate (pure list) skips searchPersons", async () => {
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: vi.fn(({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "p" + i, type: "person", subtype: "contact", names: ["P" + i], ingestedAt: 0,
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: 0, capturedBy: "api" },
      }))),
      searchPersons: vi.fn(() => []),
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 20 });
    await engine.ask("我有哪些联系人");
    // Pure list — no name in question → skip searchPersons, go straight to queryPersons.
    expect(fakeVault.searchPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryPersons).toHaveBeenCalledWith({ limit: 19 });
  });

  it("entityFocus=persons tolerates vault without searchPersons (legacy)", async () => {
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: vi.fn(({ limit }) => Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        id: "p" + i, type: "person", subtype: "contact", names: ["P" + i], ingestedAt: 0,
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: 0, capturedBy: "api" },
      }))),
      // No searchPersons method
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 20 });
    const r = await engine.ask("妈手机号");
    expect(fakeVault.queryPersons).toHaveBeenCalled();
    expect(r.facts.filter((f) => f.type === "person").length).toBe(3);
  });

  it("entityFocus=items prioritizes items table over events", async () => {
    const fakeVault = {
      queryEvents: () => Array.from({ length: 100 }, (_, i) => ({
        id: "e" + i, type: "event", subtype: "browse",
        occurredAt: Date.now(), actor: "self",
        ingestedAt: Date.now(),
        source: { adapter: "browser-history", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryPersons: () => [],
      queryItems: vi.fn(({ limit }) => Array.from({ length: limit }, (_, i) => ({
        id: "i" + i, type: "item", subtype: "other", name: "App" + i,
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      }))),
      getEvent: () => null,
      audit: () => {},
    };
    const llm = new MockLLMClient({ reply: "" });
    const engine = new AnalysisEngine({
      vault: fakeVault, llm,
      maxFacts: 20, maxQueryLimit: 50,
    });
    const r = await engine.ask("我装了哪些 app");
    expect(r.facts.filter((f) => f.type === "item").length).toBe(19);
    expect(fakeVault.queryItems).toHaveBeenCalledWith({ limit: 19 });
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
    // `truncated` is the count of dropped facts (Number), not a boolean.
    // 3 gathered, all kept (no maxFacts cap) → 0 dropped.
    expect(r.truncated).toBe(0);
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
    // 2026-05-27 fix: _gatherFacts now respects effMaxFacts upstream
    // (events would have overflowed → reservation branch; persons/items
    // returned [] → refill back to events.slice(0,10)). buildPrompt sees
    // exactly 10 facts, nothing to truncate.
    expect(r.factCount).toBe(10);
    expect(r.truncated).toBe(0);
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

// ─── intent=list + entity-name FTS5 augmentation ────────────────────────
//
// 2026-05-24 follow-up — when the parser pulls a probable entity name out
// of the question (extractEntityTerm), _gatherFacts appends FTS5 hits to
// the FACTS pool via vault.searchEvents. Strictly additive: wrong term →
// 0 rows wasted, never lost events. FTS unavailable / errors → main path
// (queryEvents + persons + items) unaffected. Memory:
// pdh_analysis_engine_intent_routing.md.

describe("AnalysisEngine._gatherFacts intent=list + entity-name FTS augmentation", () => {
  // Shared event row factory.
  const mkEvent = (id, adapter = "wechat") => ({
    id, type: "event", subtype: "message",
    occurredAt: Date.now(), actor: "self",
    ingestedAt: Date.now(),
    source: { adapter, adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
  });

  it("(a) entity extracted → searchEvents called with q + adapter + timeWindow passthrough", async () => {
    const queryEventsCalls = [];
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: (qq) => {
        queryEventsCalls.push(qq);
        return [mkEvent("e-1", "wechat"), mkEvent("e-2", "wechat")];
      },
      searchEvents: (qq) => {
        searchEventsCalls.push(qq);
        return { rows: [mkEvent("fts-1", "wechat"), mkEvent("fts-2", "wechat")], nextCursor: null, mode: "fts5", shortQuery: false };
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 4, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("提到王老板的微信消息");

    expect(r.parsed.intent).toBe("list");
    expect(searchEventsCalls).toHaveLength(1);
    expect(searchEventsCalls[0].q).toBe("王老板");
    expect(searchEventsCalls[0].adapter).toBe("wechat"); // parsed.filters.adapter passthrough
    expect(searchEventsCalls[0].limit).toBe(10); // LIST_INTENT_FTS_LIMIT cap
    // facts: 2 events + 2 FTS hits = 4 unique
    expect(r.facts.filter((f) => f.type === "event")).toHaveLength(4);
    expect(r.facts.map((f) => f.id)).toEqual(expect.arrayContaining(["e-1", "e-2", "fts-1", "fts-2"]));
  });

  it("(b) no extractable entity → searchEvents NOT called", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1")],
      searchEvents: (qq) => { searchEventsCalls.push(qq); return { rows: [], mode: "fts5", shortQuery: false }; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    // "在淘宝买了什么" — extractEntityTerm strips everything → null
    await engine.ask("在淘宝买了什么");
    expect(searchEventsCalls).toHaveLength(0);
  });

  it("(c) vault without searchEvents method → graceful skip, main path runs", async () => {
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1")],
      // no searchEvents — legacy vault fork
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("提到王老板的消息");
    // Engine doesn't blow up; main path returns the 1 event.
    expect(r.facts).toHaveLength(1);
  });

  it("(d) FTS hits with overlapping ids are deduped (no double-count)", async () => {
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1"), mkEvent("e-2")],
      searchEvents: () => ({
        rows: [mkEvent("e-1"), mkEvent("fts-3")], // e-1 overlaps with main query
        nextCursor: null, mode: "fts5", shortQuery: false,
      }),
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 3, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("提到王老板的消息");
    // e-1, e-2, fts-3 — NOT 4 entries (e-1 dedup'd)
    expect(r.facts.filter((f) => f.type === "event")).toHaveLength(3);
    const ids = r.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("(e) intent=count / latest / sum-amount do NOT trigger FTS augmentation", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1")],
      searchEvents: (qq) => { searchEventsCalls.push(qq); return { rows: [], mode: "fts5", shortQuery: false }; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    // intent=count
    await engine.ask("提到王老板的几个消息");
    // intent=latest is short-circuited in narrow path; with extracted entity
    // "王老板" wouldn't be hit because narrow returns 1 event and bails. Still
    // verify the augmentation branch doesn't fire post-narrow.
    await engine.ask("最近提到王老板的消息");
    // intent=sum-amount
    await engine.ask("总共花了多少在王老板这？");
    expect(searchEventsCalls).toHaveLength(0);
  });

  it("(f) searchEvents throwing does not block — main events still returned", async () => {
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1"), mkEvent("e-2")],
      searchEvents: () => { throw new Error("FTS5 module missing"); },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 2, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("提到王老板的消息");
    expect(r.facts).toHaveLength(2); // main path's events survive
  });

  it("(g) FTS limit respects headroom — small maxFacts shrinks the FTS slice", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1"), mkEvent("e-2"), mkEvent("e-3")],
      searchEvents: (qq) => {
        searchEventsCalls.push(qq);
        return { rows: [mkEvent("fts-" + qq.limit)], mode: "fts5", shortQuery: false };
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 4, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 5 });
    await engine.ask("提到王老板的消息");
    // maxFacts=5, events=3 → headroom=2, FTS limit = min(2, 10) = 2
    expect(searchEventsCalls[0].limit).toBe(2);
  });

  it("(h) when events already fill maxFacts, FTS skipped entirely", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => Array.from({ length: 10 }, (_, i) => mkEvent("e-" + i)),
      searchEvents: (qq) => { searchEventsCalls.push(qq); return { rows: [], mode: "fts5", shortQuery: false }; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 10, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 10 });
    await engine.ask("提到王老板的消息");
    expect(searchEventsCalls).toHaveLength(0); // headroom = 0
  });

  it("(i) FTS hit budget consumes persons/items remainder — not additive on top", async () => {
    // FTS hits push events.length up → remaining budget for persons/items shrinks.
    // Validates the FTS augment happens BEFORE persons/items calc.
    const queryPersonsCalls = [];
    const queryItemsCalls = [];
    const fakeVault = {
      queryEvents: () => [mkEvent("e-1"), mkEvent("e-2")], // 2 events
      searchEvents: () => ({ rows: [mkEvent("fts-1"), mkEvent("fts-2")], mode: "fts5", shortQuery: false }),
      queryPersons: ({ limit }) => { queryPersonsCalls.push(limit); return []; },
      queryItems: ({ limit }) => { queryItemsCalls.push(limit); return []; },
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 4, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm, maxFacts: 10 });
    await engine.ask("提到王老板的消息");
    // 2 events + 2 FTS = 4 in events array → remaining = 10-4 = 6
    // sideBudget = 3 → personBudget=3, itemBudget=3
    expect(queryPersonsCalls[0]).toBe(3);
    expect(queryItemsCalls[0]).toBe(3);
  });
});

// ─── intent=sum-amount routing — subtype-narrowed amount slice ──────────
//
// 2026-05-24 follow-up — "总共花了多少" / "在淘宝花了多少钱" only needs
// events from amount-bearing subtypes (order/payment/transfer/income).
// Pulling messages / visits / browses wastes prompt budget on rows the
// LLM can't sum. We split the budget across the 4 subtypes (min 20 each),
// union+dedup+sort by occurredAt DESC, skip persons/items entirely.
// 0 hits → fall through to default (defensive: empty-vault graceful).
// Memory: pdh_analysis_engine_intent_routing.md.

describe("AnalysisEngine._gatherFacts intent=sum-amount routing", () => {
  const mkEvent = (id, subtype, adapter = "taobao", occurredAt = Date.now()) => ({
    id, type: "event", subtype, occurredAt, actor: "self",
    content: { amount: { value: 100, currency: "CNY", direction: "out" } },
    ingestedAt: Date.now(),
    source: { adapter, adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
  });

  it("(a) hits 4 subtype queries: order/payment/transfer/income → merged + deduped + sorted DESC", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        // Return one event per subtype, occurredAt staggered so we can verify sort.
        if (q.subtype === "order") return [mkEvent("o-1", "order", "taobao", 5000)];
        if (q.subtype === "payment") return [mkEvent("p-1", "payment", "alipay-bill", 4000)];
        if (q.subtype === "transfer") return [mkEvent("t-1", "transfer", "wechat", 3000)];
        if (q.subtype === "income") return [mkEvent("i-1", "income", "email-imap", 2000)];
        return [];
      },
      queryPersons: vi.fn(() => []),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 4, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("总共花了多少钱");

    expect(r.parsed.intent).toBe("sum-amount");
    // 4 queryEvents calls, one per subtype.
    expect(queryEventsCalls).toHaveLength(4);
    expect(queryEventsCalls.map((c) => c.subtype).sort()).toEqual(
      ["income", "order", "payment", "transfer"]
    );
    // facts: 4 unique events, sorted DESC by occurredAt → o-1 first.
    expect(r.facts.map((f) => f.id)).toEqual(["o-1", "p-1", "t-1", "i-1"]);
    // persons + items skipped — sum-amount doesn't need them.
    expect(fakeVault.queryPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryItems).not.toHaveBeenCalled();
  });

  it("(b) 0 amount events → return EMPTY (NOT fall through, prevents LLM summing unrelated rows)", async () => {
    // Design change 2026-05-24: sum-amount narrow returning 0 used to fall
    // through to the default broader path, which pulled persons/items.
    // Bug: default path would also pull messages/visits/browsing — events
    // the LLM might wrongly try to "sum" when asked total spending.
    // Fix: return empty → warning="no-facts" → LLM uses TOTALS preamble to
    // say "找不到相关花费记录" cleanly. Diverges from latest's fallback
    // (which surfaces context); for sum-amount fallback actively misleads.
    const queryEventsCalls = [];
    const queryPersonsCalls = [];
    const queryItemsCalls = [];
    const fakeVault = {
      queryEvents: (q) => { queryEventsCalls.push(q); return []; },
      queryPersons: vi.fn(() => { queryPersonsCalls.push(true); return []; }),
      queryItems: vi.fn(() => { queryItemsCalls.push(true); return []; }),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 5, places: 0, items: 2, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "找不到相关花费记录" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("总共花了多少");

    // Only the 4 narrow (subtype-keyed) calls — NO default path call.
    expect(queryEventsCalls).toHaveLength(4);
    expect(queryEventsCalls.map((c) => c.subtype).sort()).toEqual(
      ["income", "order", "payment", "transfer"]
    );
    // persons/items NOT pulled (sum-amount skips them; no fallback to default).
    expect(fakeVault.queryPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryItems).not.toHaveBeenCalled();
    // Empty facts + warning fired.
    expect(r.facts).toHaveLength(0);
    expect(r.warning).toBe("no-facts");
  });

  it("(c) adapter filter passes through to all 4 subtype queries", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return q.subtype === "order" ? [mkEvent("o-1", "order", "taobao")] : [];
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("在淘宝总共花了多少钱");

    expect(queryEventsCalls).toHaveLength(4);
    for (const c of queryEventsCalls) {
      expect(c.adapter).toBe("taobao");
    }
  });

  it("(d) timeWindow passes through to all 4 subtype queries", async () => {
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
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("上个月总共花了多少", { now: NOW });

    // Narrow path's 4 subtype calls — NO default fallback since 2026-05-24
    // sum-amount bug fix (empty narrow no longer falls through).
    expect(queryEventsCalls).toHaveLength(4);
    for (const c of queryEventsCalls) {
      expect(c.since).toBeDefined();
      expect(c.until).toBeDefined();
    }
  });

  it("(e) sum-amount does NOT trigger FTS augmentation (list-only branch)", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => [mkEvent("o-1", "order")],
      searchEvents: (q) => { searchEventsCalls.push(q); return { rows: [], mode: "fts5", shortQuery: false }; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    // Question carries a potential entity name "王老板", but intent=sum-amount
    // must NOT call searchEvents (FTS is list-only).
    await engine.ask("总共付给王老板多少钱");
    expect(searchEventsCalls).toHaveLength(0);
  });

  it("(f) per-subtype budget respects effMaxQueryLimit/4 with floor of 20", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => { queryEventsCalls.push(q); return []; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    // effMaxQueryLimit = 200 (constructor default) → 200/4 = 50 per subtype
    await engine.ask("总共花了多少");
    // First 4 calls are narrow path (subtype-keyed).
    expect(queryEventsCalls[0].limit).toBe(50);

    // Small-model budget: effMaxQueryLimit=50 → 50/4 = 12 → max(20, 12) = 20
    queryEventsCalls.length = 0;
    await engine.ask("总共花了多少", { maxQueryLimit: 50 });
    expect(queryEventsCalls[0].limit).toBe(20);
  });

  it("(g) dedup: same event id surfaced under multiple subtypes appears once", async () => {
    // Defensive — events have unique subtype, but verify dedup if vault
    // ever returns the same event from multiple subtype queries.
    const fakeVault = {
      queryEvents: (q) => {
        // Both "order" and "payment" return e-shared (impossible in real
        // vault but proves dedup logic).
        if (q.subtype === "order" || q.subtype === "payment") {
          return [mkEvent("e-shared", q.subtype)];
        }
        return [];
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("总共花了多少");

    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].id).toBe("e-shared");
  });

  it("(h) result truncated to effMaxFacts (small-model 20 budget)", async () => {
    const fakeVault = {
      queryEvents: (q) => {
        // Each subtype returns 50 events → 4*50 = 200 total before cap
        return Array.from({ length: 50 }, (_, i) => mkEvent(
          q.subtype + "-" + i, q.subtype, "taobao", Date.now() - i
        ));
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 200, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("总共花了多少", { maxFacts: 20 });
    expect(r.facts).toHaveLength(20);
  });
});

// ─── intent=count routing — isolated coverage ───────────────────────────
//
// 2026-05-24 — `intent=count` ("几个 X" / "多少个 Y") is handled by the
// TOTALS preamble (commit 19c11920e): vault.stats() is rendered before
// FACTS so the LLM quotes the real number instead of FACTS array length.
//
// 2026-06-02 — FACTS now ALSO hard-caps to COUNT_INTENT_FACT_LIMIT (5)
// illustrative rows instead of the full ≤80 default sample: TOTALS already
// carries the authoritative count (Rule 6), so a count question only needs a
// few examples — saves prompt budget on local small models. Scoped by reliable
// adapter+time filters; persons/items skipped (count-of-contacts/apps routes
// via entityFocus). 0 hits → fall through to the default broader path (safety
// net for a count misclassification of a list question). Memory:
// pdh_analysis_engine_intent_routing.md.

describe("AnalysisEngine._gatherFacts intent=count routing", () => {
  const mkEvent = (id, subtype = "order", adapter = "taobao") => ({
    id, type: "event", subtype, occurredAt: Date.now(), actor: "self",
    ingestedAt: Date.now(),
    source: { adapter, adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
  });

  it("(a) intent=count → ≤5 illustrative events (capped), persons/items NOT queried", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return Array.from({ length: 20 }, (_, i) => mkEvent("e-" + i)).slice(0, q.limit);
      },
      queryPersons: vi.fn(() => []),
      queryItems: vi.fn(() => []),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 20, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("我有多少个订单");

    expect(r.parsed.intent).toBe("count");
    // Capped to COUNT_INTENT_FACT_LIMIT (5), NOT the old default 200 — TOTALS
    // carries the authoritative count, FACTS is just a few examples.
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(5);
    expect(queryEventsCalls[0].subtype).toBeUndefined(); // subtype NOT passed (unreliable)
    expect(r.facts).toHaveLength(5);
    // count-of-events doesn't need contacts/apps — skipped (those route via entityFocus).
    expect(fakeVault.queryPersons).not.toHaveBeenCalled();
    expect(fakeVault.queryItems).not.toHaveBeenCalled();
  });

  it("(a2) intent=count with adapter scope → adapter passed through on the capped query", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => {
        queryEventsCalls.push(q);
        return [mkEvent("e-1")];
      },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 1, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("我在淘宝有多少个订单");

    expect(r.parsed.intent).toBe("count");
    expect(queryEventsCalls).toHaveLength(1);
    expect(queryEventsCalls[0].limit).toBe(5);
    expect(queryEventsCalls[0].adapter).toBe("taobao");
  });

  it("(b) intent=count emits TOTALS block in prompt (authoritative ground truth)", async () => {
    const chatCalls = [];
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 12, persons: 512, places: 3, items: 89, topics: 0 }),
    };
    const llm = {
      isLocal: true,
      chat: async (msgs) => { chatCalls.push(msgs); return { text: "你有 512 个联系人", usage: {} }; },
    };
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("我有多少个联系人");

    const userMsg = chatCalls[0][1].content;
    expect(userMsg).toContain("TOTALS");
    expect(userMsg).toContain('"persons": 512');
    expect(userMsg).toContain('"items": 89');
    // System prompt instructs LLM to trust TOTALS over FACTS length.
    expect(chatCalls[0][0].content).toMatch(/TOTALS.*authoritative/i);
  });

  it("(c) intent=count does NOT trigger FTS augmentation (even with entity name)", async () => {
    const searchEventsCalls = [];
    const fakeVault = {
      queryEvents: () => [],
      searchEvents: (q) => { searchEventsCalls.push(q); return { rows: [], mode: "fts5", shortQuery: false }; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    // Question carries an entity name "王老板" but intent=count must not call FTS
    // (FTS is list-only; count uses TOTALS path).
    await engine.ask("提到王老板的几个消息");
    expect(searchEventsCalls).toHaveLength(0);
  });

  it("(d) intent=count does NOT trigger sum-amount narrow (separate routing)", async () => {
    const queryEventsCalls = [];
    const fakeVault = {
      queryEvents: (q) => { queryEventsCalls.push(q); return []; },
      queryPersons: () => [],
      queryItems: () => [],
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 0, places: 0, items: 0, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    await engine.ask("几个订单");
    // count branch (limit 5, 0 hits) → fall through to default (limit 200).
    // Neither call carries a subtype filter — NOT the 4 subtype-narrowed calls
    // that are sum-amount only.
    expect(queryEventsCalls.map((q) => q.limit)).toEqual([5, 200]);
    expect(queryEventsCalls.every((q) => q.subtype === undefined)).toBe(true);
  });

  it("(e) intent=count with 0 events falls through → persons + items in FACTS (safety net)", async () => {
    const fakeVault = {
      queryEvents: () => [],
      queryPersons: ({ limit }) => Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
        id: "p-" + i, type: "person", subtype: "contact", names: ["P" + i],
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      queryItems: ({ limit }) => Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        id: "i-" + i, type: "item", subtype: "other", name: "App" + i,
        ingestedAt: Date.now(),
        source: { adapter: "system-data-android", adapterVersion: "0", capturedAt: Date.now(), capturedBy: "api" },
      })),
      getEvent: () => null,
      audit: () => {},
      stats: () => ({ events: 0, persons: 5, places: 0, items: 3, topics: 0 }),
    };
    const llm = new MockLLMClient({ reply: "ok" });
    const engine = new AnalysisEngine({ vault: fakeVault, llm });
    const r = await engine.ask("我有几个 app");

    expect(r.parsed.intent).toBe("count");
    expect(r.facts.filter((f) => f.type === "person").length).toBe(5);
    expect(r.facts.filter((f) => f.type === "item").length).toBe(3);
  });
});
