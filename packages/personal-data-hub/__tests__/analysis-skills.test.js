"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const {
  AnalysisSkill,
  SpendingSkill,
  RelationsSkill,
  FootprintSkill,
  InterestsSkill,
  TimelineSkill,
  OverviewSkill,
  runAnalysisSkill,
  ANALYSIS_SKILL_NAMES,
} = require("../lib/analysis-skills");

// ─── Test fixtures ──────────────────────────────────────────────────────

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-skill-"));
  const vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
  vault.open();
  return { vault, dir };
}

function cleanup({ vault, dir }) {
  try { vault.close(); } catch (_e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
}

function defaultSource(adapter = "test") {
  return {
    adapter, adapterVersion: "0.1",
    originalId: "tx-" + Math.random().toString(36).slice(2, 10),
    capturedAt: Date.now(), capturedBy: "api",
  };
}

function makePerson(vault, id, names, identifiers = {}, opts = {}) {
  vault.putPerson({
    id, type: "person", subtype: opts.subtype || "contact",
    names, identifiers, ingestedAt: Date.now(),
    source: defaultSource(opts.adapter || "test"),
  });
}

function makePayment(vault, opts) {
  const participants = [];
  if (opts.counterpartyId) participants.push(opts.counterpartyId);
  participants.push("person-self");
  vault.putEvent({
    id: opts.id,
    type: "event",
    subtype: opts.subtype || "payment",
    occurredAt: opts.occurredAt,
    actor: opts.actor || "person-self",
    participants,
    content: {
      title: opts.title || "(no title)",
      amount: { value: opts.amount, currency: "CNY", direction: opts.direction || "out" },
    },
    ingestedAt: Date.now(),
    source: defaultSource(opts.adapter || "test"),
    extra: {
      counterparty: opts.counterpartyName,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.extra || {}),
    },
  });
}

function ts(year, month, day) {
  return new Date(year, month - 1, day).getTime();
}

// ─── AnalysisSkill base ─────────────────────────────────────────────────

describe("AnalysisSkill base", () => {
  it("requires vault", () => {
    expect(() => new AnalysisSkill()).toThrow();
    expect(() => new AnalysisSkill({})).toThrow(/vault/);
  });

  it("resolveTimeWindow handles since/until pair", () => {
    const skill = new AnalysisSkill({ vault: { dummy: true } });
    const r = skill.resolveTimeWindow({ since: 1000, until: 2000 });
    expect(r.since).toBe(1000);
    expect(r.until).toBe(2000);
  });

  it("resolveTimeWindow handles sinceDays", () => {
    const skill = new AnalysisSkill({ vault: { dummy: true } });
    const r = skill.resolveTimeWindow({ sinceDays: 7 });
    const days7Ms = 7 * 24 * 3600_000;
    expect(Date.now() - r.since).toBeGreaterThanOrEqual(days7Ms - 1000);
    expect(Date.now() - r.since).toBeLessThanOrEqual(days7Ms + 1000);
  });

  it("resolveTimeWindow returns null window for all-time", () => {
    const skill = new AnalysisSkill({ vault: { dummy: true } });
    expect(skill.resolveTimeWindow({}).since).toBeNull();
  });

  it("ANALYSIS_SKILL_NAMES lists exactly 6", () => {
    expect(ANALYSIS_SKILL_NAMES).toHaveLength(6);
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.spending");
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.relations");
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.footprint");
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.interests");
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.timeline");
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.overview");
  });

  it("base.run() throws (subclasses must override)", async () => {
    const skill = new AnalysisSkill({ vault: { dummy: true } });
    await expect(skill.run()).rejects.toThrow();
  });
});

// ─── SpendingSkill ───────────────────────────────────────────────────────

describe("SpendingSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  function setupAlipayPayments() {
    makePerson(rig.vault, "p-meituan", ["美团"], {}, { subtype: "merchant" });
    makePerson(rig.vault, "p-tb", ["淘宝"], {}, { subtype: "merchant" });
    makePerson(rig.vault, "p-jd", ["京东"], {}, { subtype: "merchant" });
    makePayment(rig.vault, { id: "evt-1", occurredAt: ts(2026, 4, 1), counterpartyName: "美团", counterpartyId: "p-meituan", amount: 38.50, adapter: "alipay", title: "美团外卖" });
    makePayment(rig.vault, { id: "evt-2", occurredAt: ts(2026, 4, 15), counterpartyName: "美团", counterpartyId: "p-meituan", amount: 25.00, adapter: "alipay", title: "美团外卖" });
    makePayment(rig.vault, { id: "evt-3", occurredAt: ts(2026, 4, 20), counterpartyName: "淘宝", counterpartyId: "p-tb", amount: 299.00, adapter: "alipay", title: "运动鞋" });
    makePayment(rig.vault, { id: "evt-4", occurredAt: ts(2026, 5, 5), counterpartyName: "京东", counterpartyId: "p-jd", amount: 999.00, adapter: "alipay", title: "iPhone case", subtype: "payment" });
    // Refund
    makePayment(rig.vault, { id: "evt-5", occurredAt: ts(2026, 4, 22), counterpartyName: "淘宝", counterpartyId: "p-tb", amount: 50.00, direction: "in", subtype: "refund", title: "淘宝退款", adapter: "alipay" });
  }

  it("aggregates total spend across all events", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.summary.totalSpend).toBeCloseTo(38.5 + 25 + 299 + 999, 2);
    expect(r.summary.totalIncome).toBe(50);
    expect(r.summary.eventCount).toBe(5);
    expect(r.summary.currency).toBe("CNY");
  });

  it("breakdown by merchant ranks top spenders", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({ dimension: "merchant" });
    expect(r.breakdown[0].key).toBe("京东");
    expect(r.breakdown[0].totalSpend).toBe(999);
    expect(r.breakdown[1].key).toBe("淘宝");
    expect(r.breakdown[1].totalSpend).toBe(299);
  });

  it("merchantFilter scopes to subset", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({ merchantFilter: "美团" });
    expect(r.summary.eventCount).toBe(2);
    expect(r.summary.totalSpend).toBeCloseTo(63.5, 2);
  });

  it("time window filters events", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({ since: ts(2026, 4, 1), until: ts(2026, 5, 1) });
    // Excludes evt-4 (May)
    expect(r.summary.eventCount).toBe(4);
  });

  it("trend returns monthly buckets", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.trend.length).toBeGreaterThanOrEqual(2);
    expect(r.trend[0].monthKey).toBe("2026-04");
    expect(r.trend[1].monthKey).toBe("2026-05");
  });

  it("LLM commentary fires when LLM provided", async () => {
    setupAlipayPayments();
    const llm = { isLocal: true, chat: async () => ({ text: "测试 commentary" }) };
    const skill = new SpendingSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.llm_commentary).toBe("测试 commentary");
  });

  it("no LLM → commentary is null", async () => {
    setupAlipayPayments();
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.llm_commentary).toBeNull();
  });

  it("empty vault → zero summary, no breakdown", async () => {
    const skill = new SpendingSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.summary.totalSpend).toBe(0);
    expect(r.breakdown).toEqual([]);
  });

  it("non-local LLM without acceptNonLocal → commentary suppressed", async () => {
    setupAlipayPayments();
    const llm = { isLocal: false, chat: async () => { throw new Error("should not call"); } };
    const skill = new SpendingSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.llm_commentary).toBeNull();
  });
});

// ─── RelationsSkill ──────────────────────────────────────────────────────

describe("RelationsSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  it("single person mode: aggregates interactions with one person", async () => {
    makePerson(rig.vault, "p-mom", ["妈"]);
    makePayment(rig.vault, { id: "e1", occurredAt: ts(2026, 4, 1), counterpartyId: "p-mom", counterpartyName: "妈", amount: 500 });
    makePayment(rig.vault, { id: "e2", occurredAt: ts(2026, 5, 1), counterpartyId: "p-mom", counterpartyName: "妈", amount: 300 });
    makePayment(rig.vault, { id: "e3", occurredAt: ts(2026, 5, 5), counterpartyId: "p-other", counterpartyName: "其他", amount: 100 });

    const skill = new RelationsSkill({ vault: rig.vault });
    const r = await skill.run({ personId: "p-mom" });
    expect(r.mode).toBe("single");
    expect(r.profile.totalInteractions).toBe(2);
    expect(r.profile.totalSpend).toBe(800);
    expect(r.profile.names).toContain("妈");
  });

  it("ranked mode: returns top counterparties", async () => {
    makePerson(rig.vault, "p-mom", ["妈"]);
    makePerson(rig.vault, "p-dad", ["爸"]);
    makePayment(rig.vault, { id: "e1", occurredAt: ts(2026, 4, 1), counterpartyId: "p-mom", counterpartyName: "妈", amount: 500 });
    makePayment(rig.vault, { id: "e2", occurredAt: ts(2026, 4, 2), counterpartyId: "p-mom", counterpartyName: "妈", amount: 200 });
    makePayment(rig.vault, { id: "e3", occurredAt: ts(2026, 4, 3), counterpartyId: "p-dad", counterpartyName: "爸", amount: 100 });

    const skill = new RelationsSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.mode).toBe("ranked");
    expect(r.ranked.length).toBeGreaterThanOrEqual(2);
    expect(r.ranked[0].personId).toBe("p-mom");
    expect(r.ranked[0].totalInteractions).toBe(2);
  });

  it("empty vault → ranked mode returns empty list, no crash", async () => {
    const skill = new RelationsSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.mode).toBe("ranked");
    expect(r.ranked).toEqual([]);
    expect(r.citations).toEqual([]);
    expect(r.llm_commentary).toBeNull();
  });

  it("non-local LLM gate: isLocal=false without acceptNonLocal → commentary stays null", async () => {
    makePerson(rig.vault, "p-mom", ["妈"]);
    makePayment(rig.vault, { id: "e1", occurredAt: ts(2026, 5, 1), counterpartyId: "p-mom", counterpartyName: "妈", amount: 100 });
    const nonLocalLlm = {
      isLocal: false,
      chat: async () => ({ text: "this should never reach the caller" }),
    };
    const skill = new RelationsSkill({ vault: rig.vault, llm: nonLocalLlm });
    const r = await skill.run({ personId: "p-mom" });
    expect(r.mode).toBe("single");
    expect(r.profile.totalInteractions).toBe(1);
    // gate enforced by base.callLlmCommentary
    expect(r.llm_commentary).toBeNull();
  });

  it("LLM exception swallowed → commentary null but profile data intact", async () => {
    makePerson(rig.vault, "p-mom", ["妈"]);
    makePayment(rig.vault, { id: "e1", occurredAt: ts(2026, 5, 1), counterpartyId: "p-mom", counterpartyName: "妈", amount: 100 });
    const throwingLlm = {
      isLocal: true,
      chat: async () => { throw new Error("model timeout"); },
    };
    const skill = new RelationsSkill({ vault: rig.vault, llm: throwingLlm });
    const r = await skill.run({ personId: "p-mom" });
    expect(r.profile.totalInteractions).toBe(1); // data path unaffected
    expect(r.llm_commentary).toBeNull();
  });

  it("merge-group expansion: vault.getMergeGroupMembers fans the personId out", async () => {
    // Two PersonIds representing the same real-world person across sources;
    // EntityResolver (Phase 8) would normally merge them into a group.
    makePerson(rig.vault, "p-mom-email", ["妈"], { email: ["mom@163.com"] });
    makePerson(rig.vault, "p-mom-alipay", ["陈XX"], { alipay: ["mom@163.com"] });
    makePayment(rig.vault, { id: "e1", occurredAt: ts(2026, 4, 1), counterpartyId: "p-mom-email", counterpartyName: "妈", amount: 200, adapter: "email-imap" });
    makePayment(rig.vault, { id: "e2", occurredAt: ts(2026, 5, 1), counterpartyId: "p-mom-alipay", counterpartyName: "陈XX", amount: 300, adapter: "alipay-bill" });

    // Stub the resolver hook
    rig.vault.getMergeGroupMembers = (pid) =>
      (pid === "p-mom-email" || pid === "p-mom-alipay")
        ? ["p-mom-email", "p-mom-alipay"]
        : [pid];

    const skill = new RelationsSkill({ vault: rig.vault });
    const r = await skill.run({ personId: "p-mom-email" });
    expect(r.profile.totalInteractions).toBe(2); // both events counted
    expect(r.profile.totalSpend).toBe(500);
    expect(Object.keys(r.profile.byAdapter).sort()).toEqual(["alipay-bill", "email-imap"]);
  });
});

// ─── FootprintSkill ──────────────────────────────────────────────────────

describe("FootprintSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  it("returns top places + monthly distribution", async () => {
    rig.vault.putEvent({
      id: "trip-1", type: "event", subtype: "trip",
      occurredAt: ts(2026, 4, 1),
      actor: "person-self",
      content: { title: "Beijing trip" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { from: "Shanghai", to: "Beijing" },
    });
    rig.vault.putEvent({
      id: "trip-2", type: "event", subtype: "trip",
      occurredAt: ts(2026, 4, 15),
      actor: "person-self",
      content: { title: "Beijing trip 2" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { from: "Shanghai", to: "Beijing" },
    });
    rig.vault.putEvent({
      id: "trip-3", type: "event", subtype: "trip",
      occurredAt: ts(2026, 5, 1),
      actor: "person-self",
      content: { title: "Hangzhou trip" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { to: "Hangzhou" },
    });

    const skill = new FootprintSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.summary.totalTrips).toBeGreaterThan(0);
    expect(r.topPlaces[0].name).toBeDefined();
    expect(r.monthlyDistribution.length).toBeGreaterThan(0);
  });

  it("empty vault → zero trips", async () => {
    const skill = new FootprintSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.summary.totalTrips).toBe(0);
    expect(r.topPlaces).toEqual([]);
  });

  it("local LLM commentary fires when trips present", async () => {
    rig.vault.putEvent({
      id: "trip-1", type: "event", subtype: "trip",
      occurredAt: ts(2026, 4, 1),
      actor: "person-self",
      content: { title: "Hangzhou trip" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { to: "Hangzhou" },
    });
    const llm = { isLocal: true, chat: async () => ({ text: "你这个月去过 1 个地方。" }) };
    const skill = new FootprintSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.llm_commentary).toBe("你这个月去过 1 个地方。");
  });

  it("non-local LLM gate → llm_commentary null", async () => {
    rig.vault.putEvent({
      id: "trip-1", type: "event", subtype: "trip",
      occurredAt: ts(2026, 4, 1),
      actor: "person-self",
      content: { title: "Beijing" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { to: "Beijing" },
    });
    const llm = { isLocal: false, chat: async () => ({ text: "should not appear" }) };
    const skill = new FootprintSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.llm_commentary).toBeNull();
  });

  it("LLM exception swallowed → commentary null but data intact", async () => {
    rig.vault.putEvent({
      id: "trip-1", type: "event", subtype: "trip",
      occurredAt: ts(2026, 4, 1),
      actor: "person-self",
      content: { title: "Tokyo" },
      ingestedAt: Date.now(),
      source: defaultSource("travel"),
      extra: { to: "Tokyo" },
    });
    const llm = { isLocal: true, chat: async () => { throw new Error("net down"); } };
    const skill = new FootprintSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.summary.totalTrips).toBe(1);
    expect(r.llm_commentary).toBeNull();
  });
});

// ─── InterestsSkill ──────────────────────────────────────────────────────

describe("InterestsSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  it("returns topTopics + topItems (no LLM)", async () => {
    rig.vault.putTopic({
      id: "topic-coffee", type: "topic", name: "Coffee",
      derivedFromEvents: ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"],
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    rig.vault.putItem({
      id: "item-iphone", type: "item", subtype: "product",
      name: "iPhone 17",
      price: { value: 9999, currency: "CNY" },
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    const skill = new InterestsSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.topTopics.length).toBeGreaterThanOrEqual(1);
    expect(r.topTopics[0].name).toBe("Coffee");
    expect(r.topTopics[0].eventCount).toBe(5);
    expect(r.topItems.length).toBeGreaterThanOrEqual(1);
    expect(r.topItems[0].name).toBe("iPhone 17");
    expect(r.llmInterests).toBeNull();
  });

  it("LLM clustering parses JSON array response", async () => {
    rig.vault.putTopic({
      id: "topic-a", type: "topic", name: "Photography",
      derivedFromEvents: ["evt-1", "evt-2", "evt-3"],
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    const llm = {
      isLocal: true,
      chat: async () => ({
        text: '[{"category":"摄影","evidenceCount":3,"examples":["Photography topic"]}]',
      }),
    };
    const skill = new InterestsSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.llmInterests).toHaveLength(1);
    expect(r.llmInterests[0].category).toBe("摄影");
  });

  it("empty vault → topTopics + topItems empty, no crash", async () => {
    const skill = new InterestsSkill({ vault: rig.vault });
    const r = await skill.run({});
    expect(r.topTopics).toEqual([]);
    expect(r.topItems).toEqual([]);
    expect(r.llmInterests).toBeNull();
  });

  it("non-local LLM gate → llmInterests null even with topics present", async () => {
    rig.vault.putTopic({
      id: "topic-b", type: "topic", name: "Cooking",
      derivedFromEvents: ["e-1"],
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    const llm = {
      isLocal: false,
      chat: async () => ({ text: '[{"category":"烹饪","evidenceCount":1,"examples":["Cooking"]}]' }),
    };
    const skill = new InterestsSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.topTopics[0].name).toBe("Cooking");
    expect(r.llmInterests).toBeNull();
  });

  it("LLM clustering exception swallowed → llmInterests null but data intact", async () => {
    rig.vault.putTopic({
      id: "topic-c", type: "topic", name: "Travel",
      derivedFromEvents: ["e-1", "e-2"],
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    const llm = {
      isLocal: true,
      chat: async () => { throw new Error("vllm 500"); },
    };
    const skill = new InterestsSkill({ vault: rig.vault, llm });
    const r = await skill.run({});
    expect(r.topTopics[0].name).toBe("Travel");
    expect(r.llmInterests).toBeNull();
  });

  it("drops unresolved numeric group-id topics (e.g. WeChat chatroom ids) from the profile", async () => {
    // Real interest topic
    rig.vault.putTopic({
      id: "topic-doubao", type: "topic", name: "豆包",
      derivedFromEvents: ["e1"],
      ingestedAt: Date.now(), source: defaultSource("test"),
    });
    // Unresolved group-chat topics named by raw numeric chatroom id — noise.
    rig.vault.putTopic({
      id: "topic-g1", type: "topic", name: "45498354778",
      derivedFromEvents: [],
      ingestedAt: Date.now() + 1, source: defaultSource("test"),
    });
    rig.vault.putTopic({
      id: "topic-g2", type: "topic", name: "54346634535",
      derivedFromEvents: [],
      ingestedAt: Date.now() + 2, source: defaultSource("test"),
    });
    const skill = new InterestsSkill({ vault: rig.vault });
    const r = await skill.run({});
    const names = r.topTopics.map((t) => t.name);
    expect(names).toContain("豆包");
    expect(names).not.toContain("45498354778");
    expect(names).not.toContain("54346634535");
  });
});

// ─── TimelineSkill ──────────────────────────────────────────────────────

describe("TimelineSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  it("returns chronological entries with snippet + adapter tag", async () => {
    makePayment(rig.vault, { id: "tl-1", occurredAt: ts(2026, 5, 1), counterpartyName: "美团", amount: 38, adapter: "alipay-bill", title: "外卖" });
    makePayment(rig.vault, { id: "tl-2", occurredAt: ts(2026, 5, 2), counterpartyName: "淘宝", amount: 199, adapter: "alipay-bill", title: "购物" });
    const skill = new TimelineSkill({ vault: rig.vault });
    const r = await skill.run({ since: ts(2026, 4, 1) });
    expect(r.entries.length).toBe(2);
    expect(r.entries[0].occurredAt).toBeLessThanOrEqual(r.entries[1].occurredAt); // chronological
    expect(r.entries[0].adapter).toBe("alipay-bill");
    expect(r.summary.totalEvents).toBe(2);
  });

  it("topicFilter narrows events", async () => {
    makePayment(rig.vault, { id: "tl-1", occurredAt: ts(2026, 5, 1), counterpartyName: "美团", amount: 38, title: "美团外卖订单" });
    makePayment(rig.vault, { id: "tl-2", occurredAt: ts(2026, 5, 2), counterpartyName: "淘宝", amount: 199, title: "运动鞋" });
    const skill = new TimelineSkill({ vault: rig.vault });
    const r = await skill.run({ since: ts(2026, 4, 1), topicFilter: "美团" });
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].title).toBe("美团外卖订单");
  });

  it("LLM narrative fires when entries exist + LLM provided", async () => {
    makePayment(rig.vault, { id: "tl-1", occurredAt: ts(2026, 5, 1), counterpartyName: "美团", amount: 38, title: "外卖" });
    const llm = { isLocal: true, chat: async () => ({ text: "你这周点了一次外卖。" }) };
    const skill = new TimelineSkill({ vault: rig.vault, llm });
    const r = await skill.run({ since: ts(2026, 4, 1) });
    expect(r.llm_narrative).toBe("你这周点了一次外卖。");
  });

  it("excludes inventory-snapshot events (installed-app / contact roster) from the narrative", async () => {
    // Real activity event (extra has no `kind` → must be kept)
    makePayment(rig.vault, { id: "act-1", occurredAt: ts(2026, 5, 1), counterpartyName: "美团", amount: 10, adapter: "alipay-bill", title: "外卖" });
    // Inventory-snapshot events stamped at a LATER (collection) time — these
    // would dominate a DESC time query but must be filtered out.
    rig.vault.putEvent({
      id: "event-android-app-com.x", type: "event", subtype: "other",
      occurredAt: ts(2026, 6, 1), actor: "person-self",
      content: { title: "应用：X" },
      ingestedAt: Date.now(), source: defaultSource("system-data-android"),
      extra: { kind: "app-snapshot", packageName: "com.x" },
    });
    rig.vault.putEvent({
      id: "event-android-contact-y", type: "event", subtype: "other",
      occurredAt: ts(2026, 6, 1), actor: "person-self",
      content: { title: "联系人：Y" },
      ingestedAt: Date.now(), source: defaultSource("system-data-android"),
      extra: { kind: "contact-snapshot" },
    });
    const skill = new TimelineSkill({ vault: rig.vault });
    const r = await skill.run({ since: ts(2026, 4, 1) });
    const ids = r.entries.map((e) => e.id);
    expect(ids).toContain("act-1");
    expect(ids).not.toContain("event-android-app-com.x");
    expect(ids).not.toContain("event-android-contact-y");
    expect(r.summary.totalEvents).toBe(1);
  });
});

// ─── runAnalysisSkill dispatcher ─────────────────────────────────────────

describe("runAnalysisSkill", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  it("routes by name", async () => {
    const r = await runAnalysisSkill({ vault: rig.vault }, "analysis.spending", {});
    expect(r.skill).toBe("analysis.spending");
  });

  it("throws on unknown skill", async () => {
    await expect(runAnalysisSkill({ vault: rig.vault }, "analysis.unknown", {})).rejects.toThrow();
  });

  it("requires vault in deps", async () => {
    await expect(runAnalysisSkill({}, "analysis.spending", {})).rejects.toThrow(/vault/);
  });
});

// ─── OverviewSkill (cross-app de-silo aggregation) ──────────────────────
describe("OverviewSkill — cross-app unified snapshot", () => {
  let rig;
  beforeEach(() => { rig = makeVault(); });
  afterEach(() => cleanup(rig));

  function makeMsg(vault, opts) {
    vault.putEvent({
      id: opts.id, type: "event", subtype: opts.subtype || "message",
      occurredAt: opts.occurredAt, actor: opts.actor || "person-self",
      participants: opts.participants || [],
      content: { title: opts.title || "msg" },
      ingestedAt: Date.now(), source: defaultSource(opts.adapter || "test"),
    });
  }

  it("aggregates events/spend/contacts across multiple apps", async () => {
    const { vault } = rig;
    makePerson(vault, "p-friend", ["小明"], {}, { adapter: "wechat" });
    // payments from 2 finance/shopping apps
    makePayment(vault, { id: "e1", amount: 30, occurredAt: ts(2026, 5, 1), adapter: "alipay-bill", subtype: "payment" });
    makePayment(vault, { id: "e2", amount: 70, occurredAt: ts(2026, 5, 2), adapter: "shopping-taobao", subtype: "order" });
    // messages from 2 social/im apps, same friend
    makeMsg(vault, { id: "e3", occurredAt: ts(2026, 5, 3), adapter: "wechat", participants: ["p-friend"] });
    makeMsg(vault, { id: "e4", occurredAt: ts(2026, 5, 4), adapter: "social-douyin", participants: ["p-friend"] });
    makeMsg(vault, { id: "e5", occurredAt: ts(2026, 6, 1), adapter: "social-douyin", subtype: "post", participants: [] });

    const skill = new OverviewSkill({ vault });
    const r = await skill.run({ commentary: false });

    expect(r.summary.totalEvents).toBe(5);
    expect(r.summary.appsActive).toBe(4); // alipay-bill, shopping-taobao, wechat, social-douyin
  });

  it("counts 4 distinct apps + sums cross-app spend + top contact merged", async () => {
    const { vault } = rig;
    makePerson(vault, "p-friend", ["小明"], {}, { adapter: "wechat" });
    makePayment(vault, { id: "a", amount: 30, occurredAt: ts(2026, 5, 1), adapter: "alipay-bill", subtype: "payment" });
    makePayment(vault, { id: "b", amount: 70, occurredAt: ts(2026, 5, 2), adapter: "shopping-taobao", subtype: "order" });
    makeMsg(vault, { id: "c", occurredAt: ts(2026, 5, 3), adapter: "wechat", participants: ["p-friend"] });
    makeMsg(vault, { id: "d", occurredAt: ts(2026, 5, 4), adapter: "social-douyin", participants: ["p-friend"] });

    const r = await new OverviewSkill({ vault }).run({ commentary: false });
    const apps = r.byApp.map((x) => x.app).sort();
    expect(apps).toContain("wechat");
    expect(apps).toContain("social-douyin");
    expect(apps).toContain("alipay-bill");
    expect(apps).toContain("shopping-taobao");
    expect(r.summary.appsActive).toBe(4);
    expect(r.spending.total).toBe(100); // 30 + 70 across two apps
    // the friend appears in wechat + douyin → one merged top contact w/ byApp breakdown
    const friend = r.topContacts.find((c) => c.personId === "p-friend");
    expect(friend).toBeTruthy();
    expect(friend.interactions).toBe(2);
    expect(Object.keys(friend.byApp).sort()).toEqual(["social-douyin", "wechat"]);
    // byType has payment/order/message
    const types = r.byType.map((t) => t.type);
    expect(types).toContain("message");
  });

  it("is registered + runnable via runAnalysisSkill", async () => {
    expect(ANALYSIS_SKILL_NAMES).toContain("analysis.overview");
    const r = await runAnalysisSkill({ vault: rig.vault }, "analysis.overview", { commentary: false });
    expect(r.skill).toBe("analysis.overview");
  });
});
