"use strict";

import { describe, it, expect } from "vitest";

const {
  AIChatHistoryAdapter,
  CookieAuthSession,
  HttpClient,
  DEFAULT_VENDOR_SPECS,
} = require("../../lib/adapters/ai-chat-history");
const deepseekModule = require("../../lib/adapters/ai-chat-history/vendors/deepseek");
const kimiModule = require("../../lib/adapters/ai-chat-history/vendors/kimi");

// ─── helpers ─────────────────────────────────────────────────────────────

function makeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function makeRoutedFetch(routes) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url, init });
      for (const [pattern, response] of routes) {
        if (typeof pattern === "string" ? url.includes(pattern) : pattern.test(url)) {
          if (typeof response === "function") return response(url, init);
          return response;
        }
      }
      return makeResponse({ status: 404, body: { error: "no route", url } });
    },
  };
}

function makeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
}

function deepseekFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/user/get_user_info", makeResponse({ body: { code: 0, data: { biz_data: { user_id: "user-1" } } } })],
    // Any cursored page returns empty (terminates pagination).
    [/fetch_page.*before=/, makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } })],
    // First page (no `before` cursor): newest-first c2, then c1.
    ["/chat_session/fetch_page", makeResponse({ body: {
      data: { biz_data: { chat_sessions: [
        { id: "c2", title: "second chat", model: "deepseek-v3", inserted_at: 200, updated_at: 250 },
        { id: "c1", title: "first chat", model: "deepseek-r1", inserted_at: 100, updated_at: 150 },
      ] } },
    } })],
    ["/chat/history_messages", makeResponse({ body: {
      data: { biz_data: { chat_messages: [
        { id: "m1", role: "USER", content: "hello", inserted_at: 120, parent_id: null },
        { id: "m2", role: "ASSISTANT", content: "hi there", inserted_at: 121, parent_id: "m1",
          model: "deepseek-r1", thinking_content: "<thinking>...</thinking>", thinking_enabled: true },
      ] } },
    } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "deepseek",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

function kimiFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user", makeResponse({ body: { id: "user-k1", name: "tester" } })],
    [/list\?offset=30/, makeResponse({ body: { items: [], total: 1 } })],
    [/list\?offset=0/, makeResponse({ body: { items: [
      { id: "kc1", name: "kimi convo", created_at: 100, updated_at: 200, message_count: 4 },
    ], total: 1 } })],
    [/segment\/scroll/, async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.last === "0") {
        return makeResponse({ body: {
          items: [
            { id: "km1", role: "user", content: "what is RAG?", created_at: 1000 },
            { id: "km2", role: "assistant", content: "RAG stands for...", created_at: 1001, parent_id: "km1" },
          ],
          has_more: false,
          last_id: "km1",
        } });
      }
      return makeResponse({ body: { items: [], has_more: false } });
    }],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "kimi",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

// ─── DeepSeek ────────────────────────────────────────────────────────────

describe("DeepSeek vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns ok with userId on success", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [{ name: "userToken", value: "x" }] });
    const r = await deepseekModule.SPEC.validateCookie({ httpClient, session, vendor: "deepseek" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("user-1");
  });

  it("validateCookie classifies 401 as cookie expired", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      ["/get_user_info", makeResponse({ status: 401 })],
    ]);
    const httpClient = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const r = await deepseekModule.SPEC.validateCookie({ httpClient, session, vendor: "deepseek" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("COOKIE_EXPIRED");
  });

  it("listConversations yields RawConversation objects with normalized fields", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const c of deepseekModule.SPEC.listConversations({ httpClient, session, vendor: "deepseek" })) {
      out.push(c);
    }
    expect(out.length).toBe(2);
    // Newest first (c2) then older (c1).
    expect(out[0].originalId).toBe("c2");
    expect(out[1].originalId).toBe("c1");
    expect(out[1].title).toBe("first chat");
    expect(out[1].modelName).toBe("deepseek-r1");
    expect(out[1].createdAt).toBe(100_000); // seconds → ms
    expect(out[0].vendor).toBe("deepseek");
  });

  it("listConversations stops paginating when since watermark satisfied", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const c of deepseekModule.SPEC.listConversations(
      { httpClient, session, vendor: "deepseek" },
      { since: { lastUpdatedAt: 200_000 } },
    )) {
      out.push(c);
    }
    // Only c2 (updated_at=250) is newer than since=200; c1 (updated_at=150) is older.
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("c2");
  });

  it("listMessages yields user + assistant messages with normalized roles", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const m of deepseekModule.SPEC.listMessages({ httpClient, session, vendor: "deepseek" }, "c1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[0].content.text).toBe("hello");
    expect(out[1].role).toBe("assistant");
    expect(out[1].modelName).toBe("deepseek-r1");
    expect(out[1].extra.thinking).toContain("<thinking>");
    expect(out[1].extra.thinkingEnabled).toBe(true);
    expect(out[1].parentMessageId).toBe("m1");
  });

  it("listMessages tolerates missing biz_data shape", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      ["/history_messages", makeResponse({ body: { data: {} } })],
    ]);
    const httpClient = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const m of deepseekModule.SPEC.listMessages({ httpClient, session, vendor: "deepseek" }, "c1")) {
      out.push(m);
    }
    expect(out).toEqual([]);
  });

  it("_toMs handles seconds, ms, and ISO strings", () => {
    expect(deepseekModule._internal._toMs(100)).toBe(100_000);
    expect(deepseekModule._internal._toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(deepseekModule._internal._toMs("2026-05-20T00:00:00Z")).toBe(Date.parse("2026-05-20T00:00:00Z"));
    expect(deepseekModule._internal._toMs(undefined)).toBe(0);
  });

  it("_normalizeRole handles uppercase + lowercase", () => {
    expect(deepseekModule._internal._normalizeRole("USER")).toBe("user");
    expect(deepseekModule._internal._normalizeRole("assistant")).toBe("assistant");
    expect(deepseekModule._internal._normalizeRole("SYSTEM")).toBe("system");
    expect(deepseekModule._internal._normalizeRole("anything")).toBe("anything");
  });
});

// ─── Kimi ────────────────────────────────────────────────────────────────

describe("Kimi vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId on success", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const r = await kimiModule.SPEC.validateCookie({ httpClient, session, vendor: "kimi" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("user-k1");
  });

  it("listConversations paginates by offset and respects `total`", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const out = [];
    for await (const c of kimiModule.SPEC.listConversations({ httpClient, session, vendor: "kimi" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].vendor).toBe("kimi");
    expect(out[0].originalId).toBe("kc1");
    expect(out[0].title).toBe("kimi convo");
  });

  it("listMessages walks cursor + yields chronologically", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const out = [];
    for await (const m of kimiModule.SPEC.listMessages({ httpClient, session, vendor: "kimi" }, "kc1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].originalId).toBe("km1");
    expect(out[0].role).toBe("user");
    expect(out[1].originalId).toBe("km2");
    expect(out[1].role).toBe("assistant");
    expect(out[1].parentMessageId).toBe("km1");
  });
});

// ─── End-to-end via AIChatHistoryAdapter.sync ────────────────────────────

describe("AIChatHistoryAdapter.sync — wired DeepSeek path E2E", () => {
  it("yields conversation + messages via real HttpClient + fixture fetch", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      // Cursored page terminates.
      [/fetch_page.*before=/, makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } })],
      ["/chat_session/fetch_page", makeResponse({ body: {
        data: { biz_data: { chat_sessions: [
          { id: "c1", title: "wired test", model: "deepseek-r1", inserted_at: 100, updated_at: 150 },
        ] } },
      } })],
      ["/chat/history_messages", makeResponse({ body: {
        data: { biz_data: { chat_messages: [
          { id: "m1", role: "USER", content: "hello?", inserted_at: 120 },
          { id: "m2", role: "ASSISTANT", content: "hi!", inserted_at: 121, model: "deepseek-r1" },
        ] } },
      } })],
    ]);
    const a = new AIChatHistoryAdapter({
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    a.setSession("deepseek", new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "x" }],
    }));

    const out = [];
    for await (const ev of a.sync({ vendors: ["deepseek"] })) out.push(ev);
    expect(out.length).toBe(3); // 1 conv + 2 msgs
    expect(out[0].kind).toBe("conversation");
    expect(out[0].conversation.title).toBe("wired test");
    expect(out[1].kind).toBe("message");
    expect(out[1].message.role).toBe("user");
    expect(out[2].message.role).toBe("assistant");

    // normalize → events / topics
    const batches = out.map((r) => a.normalize(r));
    expect(batches[0].topics[0].name).toBe("wired test");
    expect(batches[1].events.length).toBe(1);
    expect(batches[2].events[0].extra.modelName).toBe("deepseek-r1");
  });

  it("emits vendor-cookie-expired sentinel when http layer reports 401", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      ["/chat_session/fetch_page", makeResponse({ status: 401 })],
    ]);
    const a = new AIChatHistoryAdapter({ fetch: fixture.fetch, sleep: clk.sleep, now: clk.now });
    a.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [] }));
    const out = [];
    for await (const ev of a.sync({ vendors: ["deepseek"] })) out.push(ev);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("vendor-cookie-expired");
    expect(out[0].vendor).toBe("deepseek");
  });

  it("healthCheck reports per-vendor wired result", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      ["/get_user_info", makeResponse({ body: { code: 0, data: { biz_data: { user_id: "u" } } } })],
      ["/api/user", makeResponse({ body: { id: "k-u" } })],
    ]);
    const a = new AIChatHistoryAdapter({ fetch: fixture.fetch, sleep: clk.sleep, now: clk.now });
    a.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [] }));
    a.setSession("kimi", new CookieAuthSession({ vendor: "kimi", cookies: [] }));
    const h = await a.healthCheck();
    expect(h.perVendor.deepseek.ok).toBe(true);
    expect(h.perVendor.deepseek.userId).toBe("u");
    expect(h.perVendor.kimi.ok).toBe(true);
    expect(h.perVendor.kimi.userId).toBe("k-u");
  });
});

// ─── Spec contract still valid after wiring ──────────────────────────────

describe("vendor spec post-wire smoke", () => {
  it("deepseek spec still has correct shape", () => {
    expect(DEFAULT_VENDOR_SPECS.deepseek.name).toBe("deepseek");
    expect(typeof DEFAULT_VENDOR_SPECS.deepseek.listConversations).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS.deepseek.listMessages).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS.deepseek.validateCookie).toBe("function");
  });

  it("kimi spec still has correct shape", () => {
    expect(DEFAULT_VENDOR_SPECS.kimi.name).toBe("kimi");
    expect(typeof DEFAULT_VENDOR_SPECS.kimi.listConversations).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS.kimi.listMessages).toBe("function");
  });
});
