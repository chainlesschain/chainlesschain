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
const tongyiModule = require("../../lib/adapters/ai-chat-history/vendors/tongyi");
const zhipuModule = require("../../lib/adapters/ai-chat-history/vendors/zhipu");
const hunyuanModule = require("../../lib/adapters/ai-chat-history/vendors/hunyuan");
const qianfanModule = require("../../lib/adapters/ai-chat-history/vendors/qianfan");
const cozeModule = require("../../lib/adapters/ai-chat-history/vendors/coze");
const dreaminaModule = require("../../lib/adapters/ai-chat-history/vendors/dreamina");

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
    expect(out[0].payload.kind).toBe("conversation");
    expect(out[0].payload.conversation.title).toBe("wired test");
    expect(out[1].payload.kind).toBe("message");
    expect(out[1].payload.message.role).toBe("user");
    expect(out[2].payload.message.role).toBe("assistant");

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
    expect(out[0].payload.kind).toBe("vendor-cookie-expired");
    expect(out[0].payload.vendor).toBe("deepseek");
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

// ─── Tongyi ──────────────────────────────────────────────────────────────

function tongyiFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user/info", makeResponse({ body: { success: true, data: { userId: "ali-u1", uid: "ali-u1" } } })],
    [/conversation\/list.*pageNum=2/, makeResponse({ body: { data: { list: [] } } })],
    ["/dialog/conversation/list", makeResponse({ body: { data: { list: [
      { sessionId: "tc1", summary: "通义对话", gmtCreate: 1700000000000, gmtModified: 1700001000000, modelName: "qwen-max", messageCount: 4 },
    ] } } })],
    ["/dialog/conversation/messages", makeResponse({ body: { data: [
      { msgId: "tm1", senderType: "user", content: "你好", createTime: 1700000010000 },
      { msgId: "tm2", senderType: "assistant", contents: [{ content: "您好,有什么可以帮您?" }],
        createTime: 1700000020000, modelName: "qwen-max" },
    ] } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "tongyi",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Tongyi vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = tongyiFixtureClient();
    const session = new CookieAuthSession({
      vendor: "tongyi",
      cookies: [{ name: "XSRF-TOKEN", value: "csrf-x" }],
    });
    const r = await tongyiModule.SPEC.validateCookie({ httpClient, session, vendor: "tongyi" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("ali-u1");
  });

  it("listConversations sends X-Csrf-Token header from cookie", async () => {
    const { httpClient, fixture } = tongyiFixtureClient();
    const session = new CookieAuthSession({
      vendor: "tongyi",
      cookies: [{ name: "XSRF-TOKEN", value: "csrf-x" }],
    });
    const out = [];
    for await (const c of tongyiModule.SPEC.listConversations({ httpClient, session, vendor: "tongyi" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("tc1");
    // Verify CSRF header injected:
    const convCall = fixture.calls.find((c) => c.url.includes("/conversation/list"));
    expect(convCall.init.headers["X-Csrf-Token"]).toBe("csrf-x");
  });

  it("listMessages joins contents[].content for multi-segment replies", async () => {
    const { httpClient } = tongyiFixtureClient();
    const session = new CookieAuthSession({ vendor: "tongyi", cookies: [] });
    const out = [];
    for await (const m of tongyiModule.SPEC.listMessages({ httpClient, session, vendor: "tongyi" }, "tc1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("assistant");
    expect(out[1].content.text).toBe("您好,有什么可以帮您?");
    expect(out[1].modelName).toBe("qwen-max");
  });
});

// ─── Zhipu ───────────────────────────────────────────────────────────────

function zhipuFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/user/info", makeResponse({ body: { status: 0, result: { user_id: "glm-u1" } } })],
    [/conversation\/list.*page=2/, makeResponse({ body: { result: { list: [] } } })],
    ["/conversation/list", makeResponse({ body: { result: { list: [
      { conversation_id: "zc1", title: "GLM-4 测试", create_time: 1700000000, update_time: 1700001000, model: "glm-4" },
    ] } } })],
    [/conversation\/zc1/, makeResponse({ body: { result: { messages: [
      { id: "zm1", role: "user", content: "查一下天气", create_time: 1700000010 },
      { id: "zm2", role: "assistant", content: "今天厦门多云", create_time: 1700000020,
        tool_calls: [{ name: "web_search", arguments: { query: "厦门天气" } }] },
    ] } } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "zhipu",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Zhipu vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = zhipuFixtureClient();
    const session = new CookieAuthSession({
      vendor: "zhipu",
      cookies: [{ name: "chatglm_token", value: "tok-x" }],
    });
    const r = await zhipuModule.SPEC.validateCookie({ httpClient, session, vendor: "zhipu" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("glm-u1");
  });

  it("listConversations sends Bearer token from chatglm_token cookie", async () => {
    const { httpClient, fixture } = zhipuFixtureClient();
    const session = new CookieAuthSession({
      vendor: "zhipu",
      cookies: [{ name: "chatglm_token", value: "tok-x" }],
    });
    const out = [];
    for await (const c of zhipuModule.SPEC.listConversations({ httpClient, session, vendor: "zhipu" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("zc1");
    expect(out[0].modelName).toBe("glm-4");
    const convCall = fixture.calls.find((c) => c.url.includes("/conversation/list"));
    expect(convCall.init.headers.Authorization).toBe("Bearer tok-x");
  });

  it("listMessages preserves tool_calls in extra", async () => {
    const { httpClient } = zhipuFixtureClient();
    const session = new CookieAuthSession({ vendor: "zhipu", cookies: [] });
    const out = [];
    for await (const m of zhipuModule.SPEC.listMessages({ httpClient, session, vendor: "zhipu" }, "zc1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("assistant");
    expect(out[1].content.text).toBe("今天厦门多云");
    expect(out[1].extra.toolCalls).toEqual([{ name: "web_search", arguments: { query: "厦门天气" } }]);
  });
});

// ─── Hunyuan ─────────────────────────────────────────────────────────────

function hunyuanFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user/info", makeResponse({ body: { ret: 0, data: { userId: "hy-u1" } } })],
    ["/api/user/conv/list", makeResponse({ body: { data: { list: [
      { convId: "hyc1", title: "腾讯元宝对话", createTime: 1700000000000, updateTime: 1700001000000 },
    ] } } })],
    [/api\/user\/conv\/hyc1\/message\/list/, makeResponse({ body: { data: { messages: [
      { msgId: "hym1", speaker: "user", content: "搜下今日新闻", createTime: 1700000010000 },
      { msgId: "hym2", speaker: "bot", content: "今日要闻三则...", createTime: 1700000020000,
        linkedArticles: [{ title: "央视新闻", url: "https://example.com/a1" }] },
    ] } } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "hunyuan",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Hunyuan vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = hunyuanFixtureClient();
    const session = new CookieAuthSession({ vendor: "hunyuan", cookies: [{ name: "hy_token", value: "t" }] });
    const r = await hunyuanModule.SPEC.validateCookie({ httpClient, session, vendor: "hunyuan" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("hy-u1");
  });

  it("listConversations yields normalized RawConversation", async () => {
    const { httpClient } = hunyuanFixtureClient();
    const session = new CookieAuthSession({ vendor: "hunyuan", cookies: [] });
    const out = [];
    for await (const c of hunyuanModule.SPEC.listConversations({ httpClient, session, vendor: "hunyuan" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("hyc1");
    expect(out[0].title).toBe("腾讯元宝对话");
  });

  it("listMessages preserves linkedArticles as attachments + extra", async () => {
    const { httpClient } = hunyuanFixtureClient();
    const session = new CookieAuthSession({ vendor: "hunyuan", cookies: [] });
    const out = [];
    for await (const m of hunyuanModule.SPEC.listMessages({ httpClient, session, vendor: "hunyuan" }, "hyc1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[1].role).toBe("assistant");
    expect(out[1].extra.linkedArticles).toHaveLength(1);
    expect(out[1].content.attachments[0].filename).toBe("央视新闻");
  });
});

// ─── Qianfan ─────────────────────────────────────────────────────────────

function qianfanFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/aichat/user/info", makeResponse({ body: { code: 0, data: { uk: "qf-u1" } } })],
    ["/aichat/conversation/list", makeResponse({ body: { data: { list: [
      { sessionId: "qfc1", sessionName: "文心一言对话", createTime: 1700000000, updateTime: 1700001000 },
    ] } } })],
    ["/aichat/conversation/getMessages", makeResponse({ body: { data: { messages: [
      { messageId: "qm1", role: "user", content: "Python 列表去重", createTime: 1700000010 },
      { messageId: "qm2", role: "assistant", content: "可以用 set() 或字典推导...", createTime: 1700000020,
        references: [{ title: "Python doc", url: "https://docs.python.org/" }] },
    ] } } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "qianfan",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Qianfan vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = qianfanFixtureClient();
    const session = new CookieAuthSession({ vendor: "qianfan", cookies: [{ name: "BAIDUID", value: "b" }] });
    const r = await qianfanModule.SPEC.validateCookie({ httpClient, session, vendor: "qianfan" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("qf-u1");
  });

  it("listConversations + listMessages cross-walk", async () => {
    const { httpClient } = qianfanFixtureClient();
    const session = new CookieAuthSession({ vendor: "qianfan", cookies: [] });
    const convs = [];
    for await (const c of qianfanModule.SPEC.listConversations({ httpClient, session, vendor: "qianfan" })) {
      convs.push(c);
    }
    expect(convs.length).toBe(1);
    const msgs = [];
    for await (const m of qianfanModule.SPEC.listMessages({ httpClient, session, vendor: "qianfan" }, convs[0].originalId)) {
      msgs.push(m);
    }
    expect(msgs.length).toBe(2);
    expect(msgs[1].extra.references).toHaveLength(1);
  });
});

// ─── Coze ────────────────────────────────────────────────────────────────

function cozeFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user/info", makeResponse({ body: { code: 0, data: { user_id: "cz-u1" } } })],
    [/conversation\/list.*cursor=last/, makeResponse({ body: { data: { list: [], next_cursor: "" } } })],
    ["/api/conversation/list", makeResponse({ body: { data: { list: [
      { conversation_id: "cz-c1", title: "agent task", created_at: 1700000000, last_updated_time: 1700001000,
        bot_id: "bot-1" },
    ], next_cursor: "last" } } })],
    [/conversation\/cz-c1\/message/, makeResponse({ body: { data: { message_list: [
      { message_id: "czm1", role: "user", content: "搜下 SF 餐厅", created_at: 1700000010 },
      { message_id: "czm2", role: "assistant", content: "找到 3 家...", created_at: 1700000020,
        tool_calls: [{ name: "places_search", arguments: { city: "SF" } }],
        workflow_run_id: "wf-1" },
    ] } } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "coze",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Coze vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({ vendor: "coze", cookies: [{ name: "s_v_web_id", value: "v" }] });
    const r = await cozeModule.SPEC.validateCookie({ httpClient, session, vendor: "coze" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("cz-u1");
  });

  it("listConversations carries bot_id in extra", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({ vendor: "coze", cookies: [] });
    const out = [];
    for await (const c of cozeModule.SPEC.listConversations({ httpClient, session, vendor: "coze" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].extra.botId).toBe("bot-1");
  });

  it("listMessages preserves toolCalls + workflow_run_id", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({ vendor: "coze", cookies: [] });
    const out = [];
    for await (const m of cozeModule.SPEC.listMessages({ httpClient, session, vendor: "coze" }, "cz-c1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[1].extra.toolCalls).toHaveLength(1);
    expect(out[1].extra.workflowRunId).toBe("wf-1");
  });
});

// ─── Dreamina ────────────────────────────────────────────────────────────

function dreaminaFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user/info", makeResponse({ body: { code: 0, data: { user_id: "dm-u1" } } })],
    ["/api/workspace/list", makeResponse({ body: { data: { workspaces: [
      { workspace_id: "ws-1", name: "海报设计", create_time: 1700000000, update_time: 1700001000 },
    ] } } })],
    [/workspace\/ws-1\/items/, makeResponse({ body: { data: { items: [
      {
        id: "item-1",
        prompt: "一只赛博朋克猫头鹰",
        model: "jimeng-2.0",
        create_time: 1700000100,
        complete_time: 1700000130,
        outputs: [
          { url: "https://cdn.example.com/cat1.png" },
          { url: "https://cdn.example.com/cat2.png" },
        ],
        status: "succeeded",
      },
    ] } } })],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "dreamina",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch, sleep: clk.sleep, now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Dreamina vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = dreaminaFixtureClient();
    const session = new CookieAuthSession({ vendor: "dreamina", cookies: [] });
    const r = await dreaminaModule.SPEC.validateCookie({ httpClient, session, vendor: "dreamina" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("dm-u1");
  });

  it("workspaces map to RawConversation with kind=creative-workspace", async () => {
    const { httpClient } = dreaminaFixtureClient();
    const session = new CookieAuthSession({ vendor: "dreamina", cookies: [] });
    const out = [];
    for await (const c of dreaminaModule.SPEC.listConversations({ httpClient, session, vendor: "dreamina" })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("海报设计");
    expect(out[0].extra.kind).toBe("creative-workspace");
  });

  it("items split into user-prompt + assistant-output messages with generatedImages", async () => {
    const { httpClient } = dreaminaFixtureClient();
    const session = new CookieAuthSession({ vendor: "dreamina", cookies: [] });
    const out = [];
    for await (const m of dreaminaModule.SPEC.listMessages({ httpClient, session, vendor: "dreamina" }, "ws-1")) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[0].content.text).toBe("一只赛博朋克猫头鹰");
    expect(out[1].role).toBe("assistant");
    expect(out[1].content.generatedImages).toHaveLength(2);
    expect(out[1].content.generatedImages[0].url).toMatch(/cat1\.png/);
    expect(out[1].parentMessageId).toBe("item-1:prompt");
  });
});

// ─── Spec contract still valid after wiring ──────────────────────────────

describe("vendor spec post-wire smoke (8/8 vendors live)", () => {
  it.each([
    "deepseek",
    "kimi",
    "tongyi",
    "zhipu",
    "hunyuan",
    "qianfan",
    "coze",
    "dreamina",
  ])("%s spec still has correct shape", (v) => {
    expect(DEFAULT_VENDOR_SPECS[v].name).toBe(v);
    expect(typeof DEFAULT_VENDOR_SPECS[v].listConversations).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS[v].listMessages).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS[v].validateCookie).toBe("function");
  });
});
