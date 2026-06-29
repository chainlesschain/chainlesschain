"use strict";

import { describe, it, expect } from "vitest";

const {
  parseQuery,
  parseTimeWindow,
  parseFilters,
  parseIntent,
  parseRankDimension,
  parseEntityFocus,
  extractEntityTerm,
  extractPersonNameCandidate,
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

  it("最近 N 个月 does NOT month-overflow on a month-end day (regression)", () => {
    // Naive setMonth(getMonth()-1) on Mar 31 lands on "Feb 31" → Mar 3, silently
    // dropping all of February from the window. since must land in February.
    const mar31 = new Date(2026, 2, 31, 12, 0, 0).getTime();
    const since = parseTimeWindow("最近1个月", mar31).since;
    const d = new Date(since);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // February, NOT still March
    expect(d.getDate()).toBe(28); // clamped to Feb's last day

    // May 31 −1mo → April 30 (April has 30 days), not May 1.
    const may31 = new Date(2026, 4, 31, 12, 0, 0).getTime();
    const aprSince = new Date(parseTimeWindow("最近1个月", may31).since);
    expect(aprSince.getMonth()).toBe(3); // April
    expect(aprSince.getDate()).toBe(30);

    // mid-month is unaffected: Mar 15 −1mo → Feb 15.
    const mar15 = new Date(2026, 2, 15, 12, 0, 0).getTime();
    expect(new Date(parseTimeWindow("最近1个月", mar15).since).getDate()).toBe(15);
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

  it("bare 收到 does not steal non-income subtypes (regression)", () => {
    // 收到 ("receive") used to match income before message → "收到多少消息"
    // was mis-classified as income.
    expect(parseFilters("我收到多少消息").subtype).toBe("message");
    expect(parseFilters("收到的快递").subtype).toBeUndefined();
    expect(parseFilters("收到转账了吗").subtype).toBe("transfer"); // still transfer
    // genuine income keywords still classify
    expect(parseFilters("这个月工资多少").subtype).toBe("income");
    expect(parseFilters("进账多少").subtype).toBe("income");
  });

  it("identifies adapter via keywords (Chinese + English)", () => {
    expect(parseFilters("淘宝今年下了多少单").adapter).toBe("taobao");
    expect(parseFilters("支付宝账单").adapter).toBe("alipay-bill");
    expect(parseFilters("微信里我跟谁聊最多").adapter).toBe("wechat");
    expect(parseFilters("高德历史足迹").adapter).toBe("amap");
    expect(parseFilters("DeepSeek 我之前问过啥").adapter).toBe("ai-chat-history");
  });

  it("app-scope adapters (plural) — maps an app to ALL its message adapters (for rank)", () => {
    expect(parseFilters("谁给我发QQ消息最多").adapters).toEqual(["qq-pc", "messaging-qq"]);
    expect(parseFilters("谁给我发微信最多").adapters).toEqual(["wechat-pc", "wechat"]);
    expect(parseFilters("谁给我发抖音最多").adapters).toEqual(["social-douyin"]);
    // no app keyword → no plural scope → global rank
    expect(parseFilters("我最常联系谁").adapters).toBeUndefined();
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

  it("sum-amount for spending questions WITHOUT an explicit 总共/合计", () => {
    // Regression: these very common phrasings previously fell through to
    // intent=list (→ engine returned a row sample instead of the authoritative
    // sumEventAmount total).
    expect(parseIntent("我这个月花了多少钱")).toBe("sum-amount");
    expect(parseIntent("上个月在淘宝花了多少钱")).toBe("sum-amount");
    expect(parseIntent("这个月消费多少")).toBe("sum-amount");
    expect(parseIntent("花了多少")).toBe("sum-amount");
  });

  it("sum-amount for INCOME-side questions (收入/赚/到账)", () => {
    // Regression: income amount words were missing → "总共收入多少" even
    // mis-returned "count". Both with and without 总共.
    expect(parseIntent("这个月收入多少")).toBe("sum-amount");
    expect(parseIntent("我这个月赚了多少")).toBe("sum-amount");
    expect(parseIntent("上个月到账多少")).toBe("sum-amount");
    expect(parseIntent("总共收入多少")).toBe("sum-amount");
  });

  it("count for 多少X / 几X measure-word symmetry (多少条/多少单 were missed)", () => {
    expect(parseIntent("我有多少条朋友圈")).toBe("count");
    expect(parseIntent("下了多少单")).toBe("count");
    expect(parseIntent("发了多少条微博")).toBe("count");
    expect(parseIntent("多少笔交易")).toBe("count");
    expect(parseIntent("几部电影")).toBe("count");
  });

  it("count when 'how many' phrasing", () => {
    expect(parseIntent("最近多少次跟妈妈聊过")).toBe("count");
    expect(parseIntent("我下了几单")).toBe("count");
    // the new sum-amount rule must NOT steal a count question that also
    // mentions spending ("how many TIMES did I spend").
    expect(parseIntent("消费了多少次")).toBe("count");
    expect(parseIntent("花了多少次钱")).toBe("count");
  });

  it("latest when 'recent / latest'", () => {
    expect(parseIntent("最近一次转账")).toBe("latest");
    expect(parseIntent("最新消息")).toBe("latest");
    expect(parseIntent("最近的订单")).toBe("latest");
  });

  it("latest does NOT steal SUMMARY questions (3-row cap can't answer them) — route to list", () => {
    // Regression: "最近" routed these to intent=latest → hard-capped to 3 rows
    // → LLM said "没有相关记录". Summary questions need the broad list path (≤80 + FTS).
    expect(parseIntent("我的QQ群里大家最近在聊什么")).toBe("list");
    expect(parseIntent("我QQ最近聊了啥新话题")).toBe("list");
    expect(parseIntent("最近都在讨论什么")).toBe("list");
    expect(parseIntent("最近聊天记录里有哪些话题")).toBe("list");
  });

  it("rank for who + superlative + interaction-verb (谁发最多 / 最常联系谁) — even with 最近", () => {
    // These need an authoritative GROUP BY actor top-N (vault.topActors), not a
    // ≤80-fact sample. Take precedence over latest/breadth.
    expect(parseIntent("谁给我发消息最多")).toBe("rank");
    expect(parseIntent("最近谁给我发QQ消息最多")).toBe("rank");
    expect(parseIntent("最近谁给我打电话最多")).toBe("rank");
    expect(parseIntent("我最常联系谁")).toBe("rank");
    expect(parseIntent("群里谁发言最多")).toBe("rank");
  });

  it("rank does NOT over-trigger: summary / amount-superlative are not rank", () => {
    expect(parseIntent("群里大家在聊什么")).toBe("list"); // no who + superlative
    expect(parseIntent("谁花钱最多")).not.toBe("rank"); // superlative but no interaction verb (amount)
  });

  it("rank by TOPIC/group — '哪个群最活跃' (group + superlative, no who)", () => {
    expect(parseIntent("哪个群最活跃")).toBe("rank");
    expect(parseIntent("哪个群聊得最多")).toBe("rank");
    expect(parseIntent("我哪个QQ群消息最多")).toBe("rank");
    expect(parseIntent("群里在聊什么")).toBe("list"); // no superlative → summary
  });

  it("distinct-count — '多少人' + interaction verb → COUNT(DISTINCT actor), not the table total", () => {
    expect(parseIntent("我跟多少人聊过")).toBe("distinct-count");
    expect(parseIntent("认识多少人")).toBe("distinct-count");
    expect(parseIntent("我和多少人有来往")).toBe("distinct-count");
    expect(parseIntent("多少人给我发过消息")).toBe("distinct-count");
    expect(parseIntent("总共跟多少人聊过")).toBe("distinct-count"); // 总共 doesn't override
    // contacts-table count is the RIGHT answer here → stays intent=count
    expect(parseIntent("我有多少个联系人")).toBe("count");
    expect(parseIntent("通讯录里有多少人")).toBe("count"); // no interaction verb
  });

  it("list as default", () => {
    expect(parseIntent("妈妈的手机号")).toBe("list");
  });
});

describe("parseRankDimension", () => {
  it("topic for a group-about question (no who)", () => {
    expect(parseRankDimension("哪个群最活跃")).toBe("topic");
    expect(parseRankDimension("我哪个会话消息最多")).toBe("topic");
  });
  it("actor for who-in-group or person questions", () => {
    expect(parseRankDimension("群里谁发言最多")).toBe("actor"); // who inside a group → person
    expect(parseRankDimension("我最常联系谁")).toBe("actor");
    expect(parseRankDimension("谁给我发QQ最多")).toBe("actor");
  });
  it("parseQuery sets rankDimension only for intent=rank", () => {
    expect(parseQuery("哪个群最活跃").rankDimension).toBe("topic");
    expect(parseQuery("我最常联系谁").rankDimension).toBe("actor");
    expect(parseQuery("妈妈的手机号").rankDimension).toBeUndefined(); // not rank
  });
});

describe("parseEntityFocus", () => {
  it("returns 'persons' for 联系人 / 通讯录 phrasing", () => {
    expect(parseEntityFocus("我有哪些联系人")).toBe("persons");
    expect(parseEntityFocus("通讯录里有多少人")).toBe("persons");
    expect(parseEntityFocus("好友列表谁是张三")).toBe("persons");
  });

  it("returns 'persons' for phone-number phrasing", () => {
    expect(parseEntityFocus("妈手机号是多少")).toBe("persons");
    expect(parseEntityFocus("王医生的电话号码")).toBe("persons");
    expect(parseEntityFocus("show me my contacts")).toBe("persons");
  });

  it("returns 'items' for installed-app phrasing", () => {
    expect(parseEntityFocus("我装了哪些 app")).toBe("items");
    expect(parseEntityFocus("有哪些游戏")).toBe("items");
    expect(parseEntityFocus("installed apps")).toBe("items");
  });

  it("returns null when no focus signal", () => {
    expect(parseEntityFocus("上个月在淘宝花了多少")).toBeNull();
    expect(parseEntityFocus("最近的订单")).toBeNull();
    expect(parseEntityFocus("hello")).toBeNull();
  });

  it("returns null for non-string / empty input", () => {
    expect(parseEntityFocus("")).toBeNull();
    expect(parseEntityFocus(null)).toBeNull();
    expect(parseEntityFocus(undefined)).toBeNull();
  });
});

describe("parseQuery (integration)", () => {
  it("full parse for spending question", () => {
    const r = parseQuery("上个月在淘宝总共花了多少钱？", { now: NOW });
    expect(r.timeWindow.since).toBe(new Date(2026, 3, 1).getTime());
    expect(r.filters.subtype).toBe("payment");
    expect(r.filters.adapter).toBe("taobao");
    expect(r.intent).toBe("sum-amount");
    expect(r.entityFocus).toBeNull();
  });

  it("contact question carries entityFocus=persons", () => {
    const r = parseQuery("我有哪些联系人", { now: NOW });
    expect(r.entityFocus).toBe("persons");
    expect(r.intent).toBe("list");
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

// ─── extractPersonNameCandidate — persons-branch name search ─────────────
//
// 2026-05-27 — Powers AnalysisEngine entityFocus=persons name-search
// short-circuit. Differs from extractEntityTerm in two ways: strips
// person-FOCUS framing words first (联系人/手机号/etc.) and allows
// single-char Chinese names from a relation whitelist (妈/爸/姐/...).

describe("extractPersonNameCandidate", () => {
  it("extracts multi-char name when present", () => {
    expect(extractPersonNameCandidate("张三的电话号码")).toBe("张三");
    expect(extractPersonNameCandidate("王医生手机号是多少")).toBe("王医生");
  });

  it("falls back to single-char relation word ('妈', '爸', '姐')", () => {
    expect(extractPersonNameCandidate("妈手机号是多少")).toBe("妈");
    expect(extractPersonNameCandidate("爸的电话")).toBe("爸");
    expect(extractPersonNameCandidate("姐姐的号码")).toBe("姐姐");
  });

  it("multi-char wins over single-char fallback", () => {
    // "王医生" (3 char) preferred over leaked single "医" / "生".
    expect(extractPersonNameCandidate("王医生的手机号")).toBe("王医生");
  });

  it("returns null when no name candidate (pure framing)", () => {
    expect(extractPersonNameCandidate("我有哪些联系人")).toBeNull();
    expect(extractPersonNameCandidate("通讯录里有多少人")).toBeNull();
  });

  it("ignores single-char Chinese outside the relation whitelist", () => {
    // "说" / "看" are not relation chars — should NOT slip through as names.
    expect(extractPersonNameCandidate("说手机号")).toBeNull();
  });

  it("returns null for non-string / empty input", () => {
    expect(extractPersonNameCandidate("")).toBeNull();
    expect(extractPersonNameCandidate(null)).toBeNull();
    expect(extractPersonNameCandidate(undefined)).toBeNull();
  });

  it("handles ASCII names ≥2 chars", () => {
    expect(extractPersonNameCandidate("Alice 的电话号码")).toBe("Alice");
  });
});
