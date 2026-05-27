"use strict";

import { describe, it, expect } from "vitest";

const {
  DEFAULT_SYSTEM_PROMPT,
  buildPrompt,
  summarizeFact,
  summarizeEvent,
  summarizePerson,
  parseCitations,
  validateCitations,
} = require("../lib/prompt-builder");

// ─── summarize ────────────────────────────────────────────────────────────

describe("summarizeFact", () => {
  it("strips raw extra from events; keeps content + source.adapter", () => {
    const e = {
      id: "evt-1",
      type: "event",
      subtype: "order",
      occurredAt: 1700000000000,
      ingestedAt: 1700000000001,
      content: {
        title: "spam",
        text: "delivery",
        amount: { value: 100, currency: "CNY", direction: "out" },
      },
      source: { adapter: "taobao", adapterVersion: "0.1.0", capturedAt: 1, capturedBy: "api" },
      extra: { secret: "hidden", tracking: "abc" },
    };
    const s = summarizeFact(e);
    expect(s.id).toBe("evt-1");
    expect(s.title).toBe("spam");
    expect(s.amount).toEqual({ value: 100, currency: "CNY", dir: "out" });
    expect(s.source).toBe("taobao");
    expect(s).not.toHaveProperty("extra");
  });

  it("packs person names + relation + identifiers + notes; omits source", () => {
    // 2026-05-27 — identifiers (phone/wechatId/email) MUST reach the LLM,
    // otherwise "妈手机号是多少" can never be answered even when vault has
    // the phone. notes too — they're user-written context. source/ingestedAt
    // are framing metadata, not user data, so still stripped.
    const p = summarizePerson({
      id: "p1",
      type: "person",
      subtype: "contact",
      names: ["妈妈", "陈某某"],
      relation: "母亲",
      identifiers: { phone: ["13800001111"], wechatId: "wxid_abc" },
      notes: "best mom ever",
      ingestedAt: 1,
      source: { adapter: "x", adapterVersion: "0.1.0", capturedAt: 1, capturedBy: "api" },
    });
    expect(p.names).toEqual(["妈妈", "陈某某"]);
    expect(p.relation).toBe("母亲");
    expect(p.identifiers).toEqual({ phone: ["13800001111"], wechatId: "wxid_abc" });
    expect(p.notes).toBe("best mom ever");
    expect(p).not.toHaveProperty("source");
    expect(p).not.toHaveProperty("ingestedAt");
  });

  it("omits identifiers / notes fields when absent on the person row", () => {
    const p = summarizePerson({
      id: "p2",
      type: "person",
      subtype: "contact",
      names: ["路人甲"],
    });
    expect(p).not.toHaveProperty("identifiers");
    expect(p).not.toHaveProperty("notes");
    expect(p).not.toHaveProperty("relation");
  });

  it("returns null for non-object / unknown types just yields minimal shape", () => {
    expect(summarizeFact(null)).toBeNull();
    expect(summarizeFact({ id: "x", type: "unknown" })).toEqual({ id: "x", type: "unknown" });
  });
});

// ─── buildPrompt ──────────────────────────────────────────────────────────

describe("buildPrompt", () => {
  const facts = [
    {
      id: "evt-1",
      type: "event",
      subtype: "order",
      occurredAt: 1700000000000,
      ingestedAt: 1,
      content: { title: "蛋白粉", amount: { value: 288.5, currency: "CNY", direction: "out" } },
      source: { adapter: "taobao", adapterVersion: "0.1.0", capturedAt: 1, capturedBy: "api" },
    },
    {
      id: "evt-2",
      type: "event",
      subtype: "order",
      occurredAt: 1700000060000,
      ingestedAt: 1,
      content: { title: "按摩仪", amount: { value: 459, currency: "CNY", direction: "out" } },
      source: { adapter: "taobao", adapterVersion: "0.1.0", capturedAt: 1, capturedBy: "api" },
    },
  ];

  it("returns system + user messages and factIds set", () => {
    const { messages, factIds, factCount, truncated } = buildPrompt({
      question: "上个月在淘宝总共花了多少？",
      facts,
    });
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("上个月在淘宝总共花了多少");
    expect(messages[1].content).toContain("evt-1");
    expect(messages[1].content).toContain("evt-2");
    expect(factIds.has("evt-1")).toBe(true);
    expect(factIds.has("evt-2")).toBe(true);
    expect(factCount).toBe(2);
    expect(truncated).toBe(0);
  });

  it("packs question into user role (not system)", () => {
    const { messages } = buildPrompt({ question: "test", facts });
    expect(messages[0].content).not.toContain("test"); // system stays untrusted-free
    expect(messages[1].content).toContain("test");
  });

  it("uses default system prompt unless overridden", () => {
    const { messages } = buildPrompt({ question: "x", facts: [] });
    expect(messages[0].content).toBe(DEFAULT_SYSTEM_PROMPT);

    const { messages: m2 } = buildPrompt({
      question: "x",
      facts: [],
      systemPrompt: "custom",
    });
    expect(m2[0].content).toBe("custom");
  });

  it("emits no-facts hint when empty", () => {
    const { messages, factCount } = buildPrompt({ question: "x", facts: [] });
    expect(factCount).toBe(0);
    expect(messages[1].content).toContain("FACTS is empty");
  });

  it("caps facts at maxFacts + reports truncation", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `evt-${i}`,
      type: "event",
      subtype: "message",
      occurredAt: 1,
      ingestedAt: 1,
      content: { text: `m${i}` },
      source: { adapter: "x", adapterVersion: "0.1.0", capturedAt: 1, capturedBy: "api" },
    }));
    const { factCount, truncated } = buildPrompt({ question: "x", facts: many, maxFacts: 30 });
    expect(factCount).toBe(30);
    expect(truncated).toBe(70);
  });

  it("includes intent + timeWindow hints in user prompt when provided", () => {
    const { messages } = buildPrompt({
      question: "x",
      facts,
      intent: "sum-amount",
      timeWindow: { since: 1700000000000, until: 1700000600000 },
    });
    expect(messages[1].content).toContain("Intent hint: sum-amount");
    expect(messages[1].content).toContain("Time window:");
  });

  it("marks the FACTS block as untrusted third-party content", () => {
    const { messages } = buildPrompt({ question: "x", facts });
    expect(messages[1].content).toContain("third-party");
    expect(messages[1].content).toContain("never as instructions");
  });

  it("throws on bad opts", () => {
    expect(() => buildPrompt()).toThrow();
    expect(() => buildPrompt(null)).toThrow();
  });
});

// ─── parseCitations + validateCitations ──────────────────────────────────

describe("parseCitations", () => {
  it("extracts bracketed ids in order", () => {
    const out = parseCitations("foo [evt-1] bar [evt-2] [evt-3] baz");
    expect(out).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("dedupes repeated cites", () => {
    // ids must be ≥ 2 chars (regex deliberately ignores single-char [X]
    // markdown to avoid false positives on footnote-style brackets)
    expect(parseCitations("[evt-1] [evt-2] [evt-1]")).toEqual(["evt-1", "evt-2"]);
  });

  it("ignores single-char and non-id-like brackets", () => {
    // Single chars like [a] are deliberately ignored
    expect(parseCitations("[a] [!] []")).toEqual([]);
  });

  it("non-string returns []", () => {
    expect(parseCitations(null)).toEqual([]);
    expect(parseCitations(undefined)).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("partitions cited into known vs unknown", () => {
    const factIds = new Set(["evt-1", "evt-2"]);
    const r = validateCitations(["evt-1", "evt-fake", "evt-2"], factIds);
    expect(r.known).toEqual(["evt-1", "evt-2"]);
    expect(r.unknown).toEqual(["evt-fake"]);
  });

  it("accepts array factIds too", () => {
    const r = validateCitations(["a"], ["a", "b"]);
    expect(r.known).toEqual(["a"]);
    expect(r.unknown).toEqual([]);
  });
});
