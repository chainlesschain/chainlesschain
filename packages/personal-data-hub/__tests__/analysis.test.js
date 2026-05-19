"use strict";

import { describe, it, expect, afterEach } from "vitest";

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
