"use strict";

import { describe, it, expect } from "vitest";

const {
  parseQuery,
  parseTimeWindow,
  parseFilters,
  parseIntent,
  extractEntityTerm,
} = require("../lib/query-parser");

// Pin "now" to 2026-05-19 12:00:00 UTC for deterministic windows
const NOW = new Date("2026-05-19T12:00:00Z").getTime();

describe("parseTimeWindow", () => {
  it("今天 → start of today through end of today", () => {
    const w = parseTimeWindow("我今天花了多少？", NOW);
    expect(w).not.toBeNull();
    const startOfDay = new Date(NOW);
    startOfDay.setHours(0, 0, 0, 0);
    expect(w.since).toBe(startOfDay.getTime());
    expect(w.until).toBe(startOfDay.getTime() + 86_400_000 - 1);
  });

  it("昨天 → start of yesterday through end of yesterday", () => {
    const w = parseTimeWindow("昨天的订单", NOW);
    expect(w).not.toBeNull();
    expect(w.until - w.since).toBe(86_400_000 - 1);
  });

  it("上个月 → full previous calendar month", () => {
    const w = parseTimeWindow("上个月支出", NOW);
    expect(w).not.toBeNull();
    // NOW is 2026-05-19; previous month = 2026-04
    const apr1 = new Date(2026, 3, 1).getTime();
    const may1 = new Date(2026, 4, 1).getTime();
    expect(w.since).toBe(apr1);
    expect(w.until).toBe(may1 - 1);
  });

  it("本月 → current calendar month", () => {
    const w = parseTimeWindow("本月开销", NOW);
    expect(w).not.toBeNull();
    expect(w.since).toBe(new Date(2026, 4, 1).getTime());
    expect(w.until).toBe(new Date(2026, 5, 1).getTime() - 1);
  });

  it("去年 → full previous calendar year", () => {
    const w = parseTimeWindow("去年我去过哪些地方", NOW);
    expect(w.since).toBe(new Date(2025, 0, 1).getTime());
    expect(w.until).toBe(new Date(2025, 11, 1).getTime() + 31 * 86_400_000 - 1);
  });

  it("最近 30 天 → past 30-day window ending now", () => {
    const w = parseTimeWindow("最近 30 天聊过什么", NOW);
    expect(w.until).toBe(NOW);
    expect(NOW - w.since).toBe(30 * 86_400_000);
  });

  it("最近 N 周 / 最近 N 个月 patterns work", () => {
    const week = parseTimeWindow("最近 2 周", NOW);
    expect(NOW - week.since).toBe(14 * 86_400_000);

    const months = parseTimeWindow("最近 3 个月", NOW);
    expect(months.until).toBe(NOW);
    expect(months.since).toBeLessThan(NOW);
  });

  it("YYYY 年 M 月 → that calendar month", () => {
    const w = parseTimeWindow("2024 年 7 月在淘宝下过几单", NOW);
    expect(w.since).toBe(new Date(2024, 6, 1).getTime());
    expect(w.until).toBe(new Date(2024, 7, 1).getTime() - 1);
  });

  it("returns null for question without time clue", () => {
    expect(parseTimeWindow("妈妈手机号是多少", NOW)).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseTimeWindow(null)).toBeNull();
    expect(parseTimeWindow(undefined)).toBeNull();
  });
});

describe("parseFilters", () => {
  it("identifies subtype via keywords (Chinese + English)", () => {
    expect(parseFilters("今年在淘宝下了多少单").subtype).toBe("order");
    expect(parseFilters("上个月总共花了多少").subtype).toBe("payment");
    expect(parseFilters("转给妈妈多少钱").subtype).toBe("transfer");
    expect(parseFilters("我今年的收入").subtype).toBe("income");
    expect(parseFilters("我跟妈妈聊了什么").subtype).toBe("message");
    expect(parseFilters("我朋友圈发了啥").subtype).toBe("post");
  });

  it("identifies adapter via keywords (Chinese + English)", () => {
    expect(parseFilters("淘宝今年下了多少单").adapter).toBe("taobao");
    expect(parseFilters("支付宝账单").adapter).toBe("alipay-bill");
    expect(parseFilters("微信里我跟谁聊最多").adapter).toBe("wechat");
    expect(parseFilters("高德历史足迹").adapter).toBe("amap");
    expect(parseFilters("DeepSeek 我之前问过啥").adapter).toBe("ai-chat-history");
  });

  it("returns empty object when no clue", () => {
    expect(parseFilters("hello world")).toEqual({});
  });
});

describe("parseIntent", () => {
  it("sum-amount when 'total ... money' phrasing", () => {
    expect(parseIntent("上个月总共花了多少")).toBe("sum-amount");
    expect(parseIntent("我今年开销加起来")).toBe("sum-amount");
  });

  it("count when 'how many' phrasing", () => {
    expect(parseIntent("最近多少次跟妈妈聊过")).toBe("count");
    expect(parseIntent("我下了几单")).toBe("count");
  });

  it("latest when 'recent / latest'", () => {
    expect(parseIntent("最近一次转账")).toBe("latest");
  });

  it("list as default", () => {
    expect(parseIntent("妈妈的手机号")).toBe("list");
  });
});

describe("parseQuery (integration)", () => {
  it("full parse for spending question", () => {
    const r = parseQuery("上个月在淘宝总共花了多少钱？", { now: NOW });
    expect(r.timeWindow.since).toBe(new Date(2026, 3, 1).getTime());
    expect(r.filters.subtype).toBe("payment");
    expect(r.filters.adapter).toBe("taobao");
    expect(r.intent).toBe("sum-amount");
  });

  it("full parse for footprint question", () => {
    const r = parseQuery("去年我在高德上去过哪些地方", { now: NOW });
    expect(r.timeWindow.since).toBe(new Date(2025, 0, 1).getTime());
    expect(r.filters.adapter).toBe("amap");
    expect(r.intent).toBe("list");
  });

  it("non-string question returns empty raw + nulls", () => {
    const r = parseQuery(undefined);
    expect(r.raw).toBe("");
    expect(r.timeWindow).toBeNull();
    expect(r.filters).toEqual({});
  });
});

// ─── extractEntityTerm — FTS5 fulltext routing helper ───────────────────
//
// 2026-05-24 — Powers AnalysisEngine._gatherFacts intent=list augmentation:
// when the parser pulls a probable entity-name out of the question, the
// engine appends vault.searchEvents(q=term) hits to the FACTS pool. Wrong
// extractions are intentionally non-fatal — they waste a few rows of
// budget at worst, never lose existing events. Memory:
// pdh_analysis_engine_intent_routing.md.

describe("extractEntityTerm", () => {
  it("extracts named entity from '提到 X 的消息' phrasing", () => {
    expect(extractEntityTerm("提到王老板的消息")).toBe("王老板");
  });

  it("returns null when only stop-words remain (no entity hint)", () => {
    expect(extractEntityTerm("上个月在淘宝总共花了多少？")).toBeNull();
    expect(extractEntityTerm("在淘宝买了什么")).toBeNull();
  });

  it("picks the longest remaining chunk when several survive cleaning", () => {
    // 苹果(2) vs 订单(stop) — only 苹果 left.
    expect(extractEntityTerm("苹果的订单")).toBe("苹果");
  });

  it("strips list/search trigger words ('提到', '查找', '看一下')", () => {
    expect(extractEntityTerm("查找王医生的订单")).toBe("王医生");
    expect(extractEntityTerm("看一下王医生的最新消息")).toBe("王医生");
  });

  it("strips compound subtype keywords before shorter intent forms", () => {
    // "多少钱" must clear before "多少" leaves stranded "钱". With clean
    // stripping there is no leftover ≥2 char chunk → null.
    expect(extractEntityTerm("我总共花了多少钱")).toBeNull();
  });

  it("ignores single-character residues (verbs leak through; 1-char names skipped first-pass)", () => {
    // "我妈" → "我" stripped (pronoun), "妈" left as single char → filtered.
    // Documented limitation; first-pass tradeoff for higher precision.
    expect(extractEntityTerm("我妈最近发的微信")).toBeNull();
  });

  it("handles ASCII entity tokens (≥2 chars)", () => {
    expect(extractEntityTerm("提到 GitHub 的消息")).toBe("GitHub");
  });

  it("returns null for non-string / empty input", () => {
    expect(extractEntityTerm("")).toBeNull();
    expect(extractEntityTerm(null)).toBeNull();
    expect(extractEntityTerm(undefined)).toBeNull();
    expect(extractEntityTerm(123)).toBeNull();
  });

  it("does not pick adapter keywords as the entity (handled by filters)", () => {
    // "淘宝" 是 adapter，会被 parseFilters 抽走当 q.adapter；不该再被
    // 当实体名重复 FTS 搜。
    expect(extractEntityTerm("看下淘宝的订单")).toBeNull();
  });

  it("> 10 char tokens are dropped (probable concatenated noise)", () => {
    // 拼出一个 12 char ASCII token，期望被 length 上限过滤掉
    const r = extractEntityTerm("提到 abcdefghijkl 的消息");
    expect(r).toBeNull();
  });
});
