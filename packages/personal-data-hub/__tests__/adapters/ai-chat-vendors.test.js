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
const doubaoModule = require("../../lib/adapters/ai-chat-history/vendors/doubao");

// ─── helpers ─────────────────────────────────────────────────────────────

function makeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function makeRoutedFetch(routes) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url, init });
      for (const [pattern, response] of routes) {
        if (
          typeof pattern === "string"
            ? url.includes(pattern)
            : pattern.test(url)
        ) {
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
    sleep: async (ms) => {
      t += ms;
    },
  };
}

function deepseekFixtureClient() {
  const fixture = makeRoutedFetch([
    [
      "/user/get_user_info",
      makeResponse({
        body: { code: 0, data: { biz_data: { user_id: "user-1" } } },
      }),
    ],
    // Any cursored page returns empty (terminates pagination).
    [
      /fetch_page.*before=/,
      makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } }),
    ],
    // First page (no `before` cursor): newest-first c2, then c1.
    [
      "/chat_session/fetch_page",
      makeResponse({
        body: {
          data: {
            biz_data: {
              chat_sessions: [
                {
                  id: "c2",
                  title: "second chat",
                  model: "deepseek-v3",
                  inserted_at: 200,
                  updated_at: 250,
                },
                {
                  id: "c1",
                  title: "first chat",
                  model: "deepseek-r1",
                  inserted_at: 100,
                  updated_at: 150,
                },
              ],
            },
          },
        },
      }),
    ],
    [
      "/chat/history_messages",
      makeResponse({
        body: {
          data: {
            biz_data: {
              chat_messages: [
                {
                  id: "m1",
                  role: "USER",
                  content: "hello",
                  inserted_at: 120,
                  parent_id: null,
                },
                {
                  id: "m2",
                  role: "ASSISTANT",
                  content: "hi there",
                  inserted_at: 121,
                  parent_id: "m1",
                  model: "deepseek-r1",
                  thinking_content: "<thinking>...</thinking>",
                  thinking_enabled: true,
                },
              ],
            },
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "deepseek",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

function kimiFixtureClient() {
  const fixture = makeRoutedFetch([
    ["/api/user", makeResponse({ body: { id: "user-k1", name: "tester" } })],
    [/list\?offset=30/, makeResponse({ body: { items: [], total: 1 } })],
    [
      /list\?offset=0/,
      makeResponse({
        body: {
          items: [
            {
              id: "kc1",
              name: "kimi convo",
              created_at: 100,
              updated_at: 200,
              message_count: 4,
            },
          ],
          total: 1,
        },
      }),
    ],
    [
      /segment\/scroll/,
      async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.last === "0") {
          return makeResponse({
            body: {
              items: [
                {
                  id: "km1",
                  role: "user",
                  content: "what is RAG?",
                  created_at: 1000,
                },
                {
                  id: "km2",
                  role: "assistant",
                  content: "RAG stands for...",
                  created_at: 1001,
                  parent_id: "km1",
                },
              ],
              has_more: false,
              last_id: "km1",
            },
          });
        }
        return makeResponse({ body: { items: [], has_more: false } });
      },
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "kimi",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

// ─── DeepSeek ────────────────────────────────────────────────────────────

describe("DeepSeek vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns ok with userId on success", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "x" }],
    });
    const r = await deepseekModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "deepseek",
    });
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
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const r = await deepseekModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "deepseek",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("COOKIE_EXPIRED");
  });

  it("listConversations yields RawConversation objects with normalized fields", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const c of deepseekModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "deepseek",
    })) {
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

  it("listConversations rejects a repeated pagination cursor", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/chat_session/fetch_page",
        makeResponse({
          body: {
            data: {
              biz_data: {
                chat_sessions: [
                  {
                    id: "c1",
                    title: "stalled",
                    inserted_at: 100,
                    updated_at: 150,
                  },
                ],
              },
            },
          },
        }),
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });

    const consume = async () => {
      for await (const _conversation of deepseekModule.SPEC.listConversations(
        { httpClient, session, vendor: "deepseek" },
        { pageSize: 1, maxPages: 10 },
      )) {
        void _conversation;
        // Consume until the vendor detects the repeated `before` cursor.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "AIChatPaginationError",
      code: "AI_CHAT_PAGINATION_STALLED",
      vendor: "deepseek",
    });
    expect(fixture.calls).toHaveLength(2);
  });

  it("listConversations rejects when its hard page limit is reached", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/chat_session/fetch_page",
        makeResponse({
          body: {
            data: {
              biz_data: {
                chat_sessions: [
                  {
                    id: "c1",
                    title: "more pages",
                    inserted_at: 100,
                    updated_at: 150,
                  },
                ],
              },
            },
          },
        }),
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });

    const consume = async () => {
      for await (const _conversation of deepseekModule.SPEC.listConversations(
        { httpClient, session, vendor: "deepseek" },
        { pageSize: 1, maxPages: 1 },
      )) {
        void _conversation;
        // Consume the allowed page; attempting another page must fail closed.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "AIChatPaginationError",
      code: "AI_CHAT_PAGINATION_LIMIT",
      maxPages: 1,
      vendor: "deepseek",
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it("listMessages yields user + assistant messages with normalized roles", async () => {
    const { httpClient } = deepseekFixtureClient();
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    const out = [];
    for await (const m of deepseekModule.SPEC.listMessages(
      { httpClient, session, vendor: "deepseek" },
      "c1",
    )) {
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

  it("listMessages rejects a missing biz_data list", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      ["/history_messages", makeResponse({ body: { data: {} } })],
    ]);
    const httpClient = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "deepseek", cookies: [] });
    await expect(
      consumeVendorGenerator(
        deepseekModule.SPEC.listMessages(
          { httpClient, session, vendor: "deepseek" },
          "c1",
        ),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });
  });

  it("_toMs handles seconds, ms, and ISO strings", () => {
    expect(deepseekModule._internal._toMs(100)).toBe(100_000);
    expect(deepseekModule._internal._toMs(1_700_000_000_000)).toBe(
      1_700_000_000_000,
    );
    expect(deepseekModule._internal._toMs("2026-05-20T00:00:00Z")).toBe(
      Date.parse("2026-05-20T00:00:00Z"),
    );
    expect(deepseekModule._internal._toMs(undefined)).toBe(0);
  });

  it("_normalizeRole handles uppercase + lowercase", () => {
    expect(deepseekModule._internal._normalizeRole("USER")).toBe("user");
    expect(deepseekModule._internal._normalizeRole("assistant")).toBe(
      "assistant",
    );
    expect(deepseekModule._internal._normalizeRole("SYSTEM")).toBe("system");
    expect(deepseekModule._internal._normalizeRole("anything")).toBe(
      "anything",
    );
  });
});

// ─── Kimi ────────────────────────────────────────────────────────────────

describe("Kimi vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId on success", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const r = await kimiModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "kimi",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("user-k1");
  });

  it("listConversations paginates by offset and respects `total`", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const out = [];
    for await (const c of kimiModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "kimi",
    })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].vendor).toBe("kimi");
    expect(out[0].originalId).toBe("kc1");
    expect(out[0].title).toBe("kimi convo");
  });

  it("listConversations keeps paging when a short page has a remaining total", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/api/chat/list",
        async (url) => {
          const offset = Number(new URL(url).searchParams.get("offset"));
          return makeResponse({
            body: {
              items:
                offset === 0
                  ? [
                      {
                        id: "kc1",
                        name: "first short page",
                        created_at: 100,
                        updated_at: 200,
                      },
                    ]
                  : [
                      {
                        id: "kc2",
                        name: "second short page",
                        created_at: 90,
                        updated_at: 190,
                      },
                    ],
              total: 2,
            },
          });
        },
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });

    const out = [];
    for await (const conversation of kimiModule.SPEC.listConversations(
      { httpClient, session, vendor: "kimi" },
      { pageSize: 3, maxPages: 3 },
    )) {
      out.push(conversation);
    }

    expect(out.map((conversation) => conversation.originalId)).toEqual([
      "kc1",
      "kc2",
    ]);
    expect(fixture.calls).toHaveLength(2);
  });

  it("listConversations keeps paging when a short page explicitly has more", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/api/chat/list",
        async (url) => {
          const offset = Number(new URL(url).searchParams.get("offset"));
          return makeResponse({
            body:
              offset === 0
                ? {
                    items: [
                      {
                        id: "kc1",
                        name: "explicitly continuing",
                        created_at: 100,
                        updated_at: 200,
                      },
                    ],
                    has_more: true,
                  }
                : {
                    items: [
                      {
                        id: "kc2",
                        name: "explicitly complete",
                        created_at: 90,
                        updated_at: 190,
                      },
                    ],
                    has_more: false,
                  },
          });
        },
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });

    const out = [];
    for await (const conversation of kimiModule.SPEC.listConversations(
      { httpClient, session, vendor: "kimi" },
      { pageSize: 3, maxPages: 3 },
    )) {
      out.push(conversation);
    }

    expect(out.map((conversation) => conversation.originalId)).toEqual([
      "kc1",
      "kc2",
    ]);
    expect(fixture.calls).toHaveLength(2);
  });

  it("listConversations rejects an identical repeated offset page", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/api/chat/list",
        makeResponse({
          body: {
            items: [
              { id: "kc1", name: "stalled", created_at: 100, updated_at: 200 },
            ],
            total: 20,
          },
        }),
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });

    const consume = async () => {
      for await (const _conversation of kimiModule.SPEC.listConversations(
        { httpClient, session, vendor: "kimi" },
        { pageSize: 1, maxPages: 10 },
      )) {
        void _conversation;
        // Consume until the repeated page is detected.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "AIChatPaginationError",
      code: "AI_CHAT_PAGINATION_STALLED",
      vendor: "kimi",
    });
    expect(fixture.calls).toHaveLength(2);
  });

  it("listConversations rejects when its hard page limit is reached", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/api/chat/list",
        makeResponse({
          body: {
            items: [
              {
                id: "kc1",
                name: "more pages",
                created_at: 100,
                updated_at: 200,
              },
            ],
            total: 20,
          },
        }),
      ],
    ]);
    const httpClient = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });

    const consume = async () => {
      for await (const _conversation of kimiModule.SPEC.listConversations(
        { httpClient, session, vendor: "kimi" },
        { pageSize: 1, maxPages: 1 },
      )) {
        void _conversation;
        // Consume the allowed page; attempting another page must fail closed.
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "AIChatPaginationError",
      code: "AI_CHAT_PAGINATION_LIMIT",
      maxPages: 1,
      vendor: "kimi",
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it("listMessages walks cursor + yields chronologically", async () => {
    const { httpClient } = kimiFixtureClient();
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    const out = [];
    for await (const m of kimiModule.SPEC.listMessages(
      { httpClient, session, vendor: "kimi" },
      "kc1",
    )) {
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
      [
        /fetch_page.*before=/,
        makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } }),
      ],
      [
        "/chat_session/fetch_page",
        makeResponse({
          body: {
            data: {
              biz_data: {
                chat_sessions: [
                  {
                    id: "c1",
                    title: "wired test",
                    model: "deepseek-r1",
                    inserted_at: 100,
                    updated_at: 150,
                  },
                ],
              },
            },
          },
        }),
      ],
      [
        "/chat/history_messages",
        makeResponse({
          body: {
            data: {
              biz_data: {
                chat_messages: [
                  {
                    id: "m1",
                    role: "USER",
                    content: "hello?",
                    inserted_at: 120,
                  },
                  {
                    id: "m2",
                    role: "ASSISTANT",
                    content: "hi!",
                    inserted_at: 121,
                    model: "deepseek-r1",
                  },
                ],
              },
            },
          },
        }),
      ],
    ]);
    const a = new AIChatHistoryAdapter({
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    a.setSession(
      "deepseek",
      new CookieAuthSession({
        vendor: "deepseek",
        cookies: [{ name: "userToken", value: "x" }],
      }),
    );

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
    const a = new AIChatHistoryAdapter({
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    a.setSession(
      "deepseek",
      new CookieAuthSession({ vendor: "deepseek", cookies: [] }),
    );
    const out = [];
    for await (const ev of a.sync({ vendors: ["deepseek"] })) out.push(ev);
    expect(out.length).toBe(1);
    expect(out[0].payload.kind).toBe("vendor-cookie-expired");
    expect(out[0].payload.vendor).toBe("deepseek");
  });

  it("healthCheck reports per-vendor wired result", async () => {
    const clk = makeClock();
    const fixture = makeRoutedFetch([
      [
        "/get_user_info",
        makeResponse({
          body: { code: 0, data: { biz_data: { user_id: "u" } } },
        }),
      ],
      ["/api/user", makeResponse({ body: { id: "k-u" } })],
    ]);
    const a = new AIChatHistoryAdapter({
      fetch: fixture.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    a.setSession(
      "deepseek",
      new CookieAuthSession({ vendor: "deepseek", cookies: [] }),
    );
    a.setSession(
      "kimi",
      new CookieAuthSession({ vendor: "kimi", cookies: [] }),
    );
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
    [
      "/api/user/info",
      makeResponse({
        body: { success: true, data: { userId: "ali-u1", uid: "ali-u1" } },
      }),
    ],
    [
      /conversation\/list.*pageNum=2/,
      makeResponse({ body: { data: { list: [] } } }),
    ],
    [
      "/dialog/conversation/list",
      makeResponse({
        body: {
          data: {
            has_more: false,
            list: [
              {
                sessionId: "tc1",
                summary: "通义对话",
                gmtCreate: 1700000000000,
                gmtModified: 1700001000000,
                modelName: "qwen-max",
                messageCount: 4,
              },
            ],
          },
        },
      }),
    ],
    [
      "/dialog/conversation/messages",
      makeResponse({
        body: {
          data: [
            {
              msgId: "tm1",
              senderType: "user",
              content: "你好",
              createTime: 1700000010000,
            },
            {
              msgId: "tm2",
              senderType: "assistant",
              contents: [{ content: "您好,有什么可以帮您?" }],
              createTime: 1700000020000,
              modelName: "qwen-max",
            },
          ],
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "tongyi",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
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
    const r = await tongyiModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "tongyi",
    });
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
    for await (const c of tongyiModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "tongyi",
    })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("tc1");
    // Verify CSRF header injected:
    const convCall = fixture.calls.find((c) =>
      c.url.includes("/conversation/list"),
    );
    expect(convCall.init.headers["X-Csrf-Token"]).toBe("csrf-x");
  });

  it("listMessages joins contents[].content for multi-segment replies", async () => {
    const { httpClient } = tongyiFixtureClient();
    const session = new CookieAuthSession({ vendor: "tongyi", cookies: [] });
    const out = [];
    for await (const m of tongyiModule.SPEC.listMessages(
      { httpClient, session, vendor: "tongyi" },
      "tc1",
    )) {
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
    [
      "/user/info",
      makeResponse({ body: { status: 0, result: { user_id: "glm-u1" } } }),
    ],
    [
      /conversation\/list.*page=2/,
      makeResponse({ body: { result: { list: [] } } }),
    ],
    [
      "/conversation/list",
      makeResponse({
        body: {
          result: {
            list: [
              {
                conversation_id: "zc1",
                title: "GLM-4 测试",
                create_time: 1700000000,
                update_time: 1700001000,
                model: "glm-4",
              },
            ],
          },
        },
      }),
    ],
    [
      /conversation\/zc1/,
      makeResponse({
        body: {
          result: {
            messages: [
              {
                id: "zm1",
                role: "user",
                content: "查一下天气",
                create_time: 1700000010,
              },
              {
                id: "zm2",
                role: "assistant",
                content: "今天厦门多云",
                create_time: 1700000020,
                tool_calls: [
                  { name: "web_search", arguments: { query: "厦门天气" } },
                ],
              },
            ],
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "zhipu",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
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
    const r = await zhipuModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "zhipu",
    });
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
    for await (const c of zhipuModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "zhipu",
    })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("zc1");
    expect(out[0].modelName).toBe("glm-4");
    const convCall = fixture.calls.find((c) =>
      c.url.includes("/conversation/list"),
    );
    expect(convCall.init.headers.Authorization).toBe("Bearer tok-x");
  });

  it("listMessages preserves tool_calls in extra", async () => {
    const { httpClient } = zhipuFixtureClient();
    const session = new CookieAuthSession({ vendor: "zhipu", cookies: [] });
    const out = [];
    for await (const m of zhipuModule.SPEC.listMessages(
      { httpClient, session, vendor: "zhipu" },
      "zc1",
    )) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("assistant");
    expect(out[1].content.text).toBe("今天厦门多云");
    expect(out[1].extra.toolCalls).toEqual([
      { name: "web_search", arguments: { query: "厦门天气" } },
    ]);
  });
});

// ─── Hunyuan ─────────────────────────────────────────────────────────────

function hunyuanFixtureClient() {
  const fixture = makeRoutedFetch([
    [
      "/api/user/info",
      makeResponse({ body: { ret: 0, data: { userId: "hy-u1" } } }),
    ],
    [
      "/api/user/conv/list",
      makeResponse({
        body: {
          data: {
            has_more: false,
            list: [
              {
                convId: "hyc1",
                title: "腾讯元宝对话",
                createTime: 1700000000000,
                updateTime: 1700001000000,
              },
            ],
          },
        },
      }),
    ],
    [
      /api\/user\/conv\/hyc1\/message\/list/,
      makeResponse({
        body: {
          data: {
            has_more: false,
            messages: [
              {
                msgId: "hym1",
                speaker: "user",
                content: "搜下今日新闻",
                createTime: 1700000010000,
              },
              {
                msgId: "hym2",
                speaker: "bot",
                content: "今日要闻三则...",
                createTime: 1700000020000,
                linkedArticles: [
                  { title: "央视新闻", url: "https://example.com/a1" },
                ],
              },
            ],
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "hunyuan",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Hunyuan vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = hunyuanFixtureClient();
    const session = new CookieAuthSession({
      vendor: "hunyuan",
      cookies: [{ name: "hy_token", value: "t" }],
    });
    const r = await hunyuanModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "hunyuan",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("hy-u1");
  });

  it("listConversations yields normalized RawConversation", async () => {
    const { httpClient } = hunyuanFixtureClient();
    const session = new CookieAuthSession({ vendor: "hunyuan", cookies: [] });
    const out = [];
    for await (const c of hunyuanModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "hunyuan",
    })) {
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
    for await (const m of hunyuanModule.SPEC.listMessages(
      { httpClient, session, vendor: "hunyuan" },
      "hyc1",
    )) {
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
    [
      "/aichat/user/info",
      makeResponse({ body: { code: 0, data: { uk: "qf-u1" } } }),
    ],
    [
      "/aichat/conversation/list",
      makeResponse({
        body: {
          data: {
            has_more: false,
            list: [
              {
                sessionId: "qfc1",
                sessionName: "文心一言对话",
                createTime: 1700000000,
                updateTime: 1700001000,
              },
            ],
          },
        },
      }),
    ],
    [
      "/aichat/conversation/getMessages",
      makeResponse({
        body: {
          data: {
            has_more: false,
            messages: [
              {
                messageId: "qm1",
                role: "user",
                content: "Python 列表去重",
                createTime: 1700000010,
              },
              {
                messageId: "qm2",
                role: "assistant",
                content: "可以用 set() 或字典推导...",
                createTime: 1700000020,
                references: [
                  { title: "Python doc", url: "https://docs.python.org/" },
                ],
              },
            ],
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "qianfan",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Qianfan vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = qianfanFixtureClient();
    const session = new CookieAuthSession({
      vendor: "qianfan",
      cookies: [{ name: "BAIDUID", value: "b" }],
    });
    const r = await qianfanModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "qianfan",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("qf-u1");
  });

  it("listConversations + listMessages cross-walk", async () => {
    const { httpClient } = qianfanFixtureClient();
    const session = new CookieAuthSession({ vendor: "qianfan", cookies: [] });
    const convs = [];
    for await (const c of qianfanModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "qianfan",
    })) {
      convs.push(c);
    }
    expect(convs.length).toBe(1);
    const msgs = [];
    for await (const m of qianfanModule.SPEC.listMessages(
      { httpClient, session, vendor: "qianfan" },
      convs[0].originalId,
    )) {
      msgs.push(m);
    }
    expect(msgs.length).toBe(2);
    expect(msgs[1].extra.references).toHaveLength(1);
  });
});

// ─── Coze ────────────────────────────────────────────────────────────────

function cozeFixtureClient() {
  const fixture = makeRoutedFetch([
    [
      "/api/user/info",
      makeResponse({ body: { code: 0, data: { user_id: "cz-u1" } } }),
    ],
    [
      /conversation\/list.*cursor=last/,
      makeResponse({ body: { data: { list: [], next_cursor: "" } } }),
    ],
    [
      "/api/conversation/list",
      makeResponse({
        body: {
          data: {
            list: [
              {
                conversation_id: "cz-c1",
                title: "agent task",
                created_at: 1700000000,
                last_updated_time: 1700001000,
                bot_id: "bot-1",
              },
            ],
            next_cursor: "last",
          },
        },
      }),
    ],
    [
      /conversation\/cz-c1\/message/,
      makeResponse({
        body: {
          data: {
            has_more: false,
            message_list: [
              {
                message_id: "czm1",
                role: "user",
                content: "搜下 SF 餐厅",
                created_at: 1700000010,
              },
              {
                message_id: "czm2",
                role: "assistant",
                content: "找到 3 家...",
                created_at: 1700000020,
                tool_calls: [
                  { name: "places_search", arguments: { city: "SF" } },
                ],
                workflow_run_id: "wf-1",
              },
            ],
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "coze",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Coze vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({
      vendor: "coze",
      cookies: [{ name: "s_v_web_id", value: "v" }],
    });
    const r = await cozeModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "coze",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("cz-u1");
  });

  it("listConversations carries bot_id in extra", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({ vendor: "coze", cookies: [] });
    const out = [];
    for await (const c of cozeModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "coze",
    })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].extra.botId).toBe("bot-1");
  });

  it("listMessages preserves toolCalls + workflow_run_id", async () => {
    const { httpClient } = cozeFixtureClient();
    const session = new CookieAuthSession({ vendor: "coze", cookies: [] });
    const out = [];
    for await (const m of cozeModule.SPEC.listMessages(
      { httpClient, session, vendor: "coze" },
      "cz-c1",
    )) {
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
    [
      "/api/user/info",
      makeResponse({ body: { code: 0, data: { user_id: "dm-u1" } } }),
    ],
    [
      "/api/workspace/list",
      makeResponse({
        body: {
          data: {
            has_more: false,
            workspaces: [
              {
                workspace_id: "ws-1",
                name: "海报设计",
                create_time: 1700000000,
                update_time: 1700001000,
              },
            ],
          },
        },
      }),
    ],
    [
      /workspace\/ws-1\/items/,
      makeResponse({
        body: {
          data: {
            has_more: false,
            items: [
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
            ],
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "dreamina",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Dreamina vendor — Phase 10.2 wiring", () => {
  it("validateCookie returns userId", async () => {
    const { httpClient } = dreaminaFixtureClient();
    const session = new CookieAuthSession({ vendor: "dreamina", cookies: [] });
    const r = await dreaminaModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "dreamina",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("dm-u1");
  });

  it("workspaces map to RawConversation with kind=creative-workspace", async () => {
    const { httpClient } = dreaminaFixtureClient();
    const session = new CookieAuthSession({ vendor: "dreamina", cookies: [] });
    const out = [];
    for await (const c of dreaminaModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "dreamina",
    })) {
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
    for await (const m of dreaminaModule.SPEC.listMessages(
      { httpClient, session, vendor: "dreamina" },
      "ws-1",
    )) {
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

// ─── Doubao 豆包 ────────────────────────────────────────────────────────

function doubaoFixtureClient() {
  const fixture = makeRoutedFetch([
    [
      "/samantha/user/info",
      makeResponse({ body: { code: 0, data: { user_id: "db-u1" } } }),
    ],
    [
      "/samantha/conversation/list",
      makeResponse({
        body: {
          data: {
            conversation_list: [
              {
                conversation_id: "conv-1",
                name: "聊聊 Rust",
                bot_id: "bot-default",
                bot_name: "豆包",
                create_time: 1700000000,
                last_message_time: 1700001000,
                message_count: 4,
              },
            ],
            has_more: false,
            cursor: "",
          },
        },
      }),
    ],
    [
      /samantha\/conversation\/conv-1\/message\/list/,
      makeResponse({
        body: {
          data: {
            message_list: [
              {
                id: "m-2",
                sender_type: 2,
                content: "Rust 的核心是所有权…",
                create_time: 1700000060,
                bot_id: "bot-default",
              },
              {
                id: "m-1",
                sender_type: 1,
                content: "讲讲 Rust 的特点",
                create_time: 1700000050,
              },
            ],
            has_more: false,
            cursor: "",
          },
        },
      }),
    ],
  ]);
  const clk = makeClock();
  const httpClient = new HttpClient({
    vendor: "doubao",
    rateLimits: { perMinute: 0, minIntervalMs: 0 },
    fetch: fixture.fetch,
    sleep: clk.sleep,
    now: clk.now,
  });
  return { httpClient, fixture };
}

describe("Doubao vendor — Phase 10.2(+) v0.1 scaffold", () => {
  it("validateCookie returns userId from /samantha/user/info", async () => {
    const { httpClient } = doubaoFixtureClient();
    const session = new CookieAuthSession({ vendor: "doubao", cookies: [] });
    const r = await doubaoModule.SPEC.validateCookie({
      httpClient,
      session,
      vendor: "doubao",
    });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("db-u1");
  });

  it("listConversations yields RawConversation with bot_name as modelName", async () => {
    const { httpClient } = doubaoFixtureClient();
    const session = new CookieAuthSession({ vendor: "doubao", cookies: [] });
    const out = [];
    for await (const c of doubaoModule.SPEC.listConversations({
      httpClient,
      session,
      vendor: "doubao",
    })) {
      out.push(c);
    }
    expect(out.length).toBe(1);
    expect(out[0].originalId).toBe("conv-1");
    expect(out[0].title).toBe("聊聊 Rust");
    expect(out[0].modelName).toBe("豆包");
    expect(out[0].extra.botId).toBe("bot-default");
  });

  it("listMessages sorts messages chronologically + maps numeric sender_type", async () => {
    const { httpClient } = doubaoFixtureClient();
    const session = new CookieAuthSession({ vendor: "doubao", cookies: [] });
    const out = [];
    for await (const m of doubaoModule.SPEC.listMessages(
      { httpClient, session, vendor: "doubao" },
      "conv-1",
    )) {
      out.push(m);
    }
    expect(out.length).toBe(2);
    // Re-sorted to chronological even though API returned reverse.
    expect(out[0].originalId).toBe("m-1");
    expect(out[0].role).toBe("user");
    expect(out[0].content.text).toBe("讲讲 Rust 的特点");
    expect(out[1].originalId).toBe("m-2");
    expect(out[1].role).toBe("assistant");
  });

  it("_normalizeRole handles numeric + string + uppercase sender_type", () => {
    const { _normalizeRole } = doubaoModule._internal;
    expect(_normalizeRole(1)).toBe("user");
    expect(_normalizeRole("2")).toBe("assistant");
    expect(_normalizeRole("SYSTEM")).toBe("system");
    expect(_normalizeRole("assistant")).toBe("assistant");
  });

  it("_extractConvList absorbs alternate response field names", () => {
    const { _extractConvList, _extractMsgList } = doubaoModule._internal;
    expect(_extractConvList({ data: { conversations: [{ id: 1 }] } })).toEqual([
      { id: 1 },
    ]);
    expect(_extractConvList({ data: { list: [{ id: 2 }] } })).toEqual([
      { id: 2 },
    ]);
    expect(_extractMsgList({ data: { messages: [{ id: "x" }] } })).toEqual([
      { id: "x" },
    ]);
    expect(_extractMsgList({ data: { message_list: [] } })).toEqual([]);
    expect(() => _extractMsgList({})).toThrow(
      expect.objectContaining({ code: "SOURCE_PAGE_UNRECOGNIZED" }),
    );
  });
});

// ─── Spec contract still valid after wiring ──────────────────────────────

function makeDirectVendorClient(method, response) {
  const calls = [];
  return {
    calls,
    [method]: async (...args) => {
      calls.push(args);
      return response;
    },
  };
}

function makeSequentialVendorClient(method, responses) {
  const calls = [];
  let index = 0;
  return {
    calls,
    [method]: async (...args) => {
      calls.push(args);
      if (index >= responses.length) {
        throw new Error(`unexpected ${method} call ${index + 1}`);
      }
      const response = responses[index];
      index += 1;
      return response;
    },
  };
}

async function consumeVendorGenerator(iterable) {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
}

const STRICT_RESPONSE_CASES = [
  [
    "deepseek",
    deepseekModule.SPEC,
    "getJson",
    "getJson",
    {
      code: 1001,
      data: { biz_data: { chat_sessions: [] } },
    },
  ],
  ["kimi", kimiModule.SPEC, "getJson", "postJson", { code: 1001, items: [] }],
  [
    "tongyi",
    tongyiModule.SPEC,
    "postJson",
    "postJson",
    { code: 5001, data: { list: [] } },
  ],
  [
    "zhipu",
    zhipuModule.SPEC,
    "getJson",
    "getJson",
    { status: 1, result: { list: [] } },
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    "postJson",
    { ret: 1, data: { list: [] } },
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    "postJson",
    { errno: 1, data: { list: [] } },
  ],
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    "getJson",
    { code: 1001, data: { list: [] } },
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    "postJson",
    { code: 1001, data: { workspaces: [] } },
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    "postJson",
    { code: 1001, data: { conversation_list: [] } },
  ],
];

describe("AI chat vendor source response contract", () => {
  it.each(STRICT_RESPONSE_CASES)(
    "%s conversations reject unknown JSON structures",
    async (vendor, spec, conversationMethod) => {
      const httpClient = makeDirectVendorClient(conversationMethod, {});
      const session = new CookieAuthSession({ vendor, cookies: [] });

      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { maxPages: 1 },
          ),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });
    },
  );

  it.each(STRICT_RESPONSE_CASES)(
    "%s messages reject HTML responses",
    async (vendor, spec, _conversationMethod, messageMethod) => {
      const httpClient = makeDirectVendorClient(
        messageMethod,
        "<html>login</html>",
      );
      const session = new CookieAuthSession({ vendor, cookies: [] });

      await expect(
        consumeVendorGenerator(
          spec.listMessages({ httpClient, session, vendor }, "conversation-1", {
            maxPages: 1,
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });
    },
  );

  it.each(STRICT_RESPONSE_CASES)(
    "%s conversations reject explicit business errors",
    async (vendor, spec, conversationMethod, _messageMethod, businessError) => {
      const httpClient = makeDirectVendorClient(
        conversationMethod,
        businessError,
      );
      const session = new CookieAuthSession({ vendor, cookies: [] });

      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { maxPages: 1 },
          ),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_ERROR" });
    },
  );
});

const NUMERIC_CONVERSATION_CASES = [
  [
    "tongyi",
    tongyiModule.SPEC,
    "postJson",
    {
      data: {
        list: [{ sessionId: "tc-page", gmtCreate: 100, gmtModified: 200 }],
      },
    },
  ],
  [
    "zhipu",
    zhipuModule.SPEC,
    "getJson",
    {
      result: {
        list: [
          {
            conversation_id: "zc-page",
            create_time: 100,
            update_time: 200,
          },
        ],
      },
    },
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    {
      data: {
        list: [{ sessionId: "qfc-page", createTime: 100, updateTime: 200 }],
      },
    },
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    {
      data: {
        workspaces: [
          { workspace_id: "ws-page", create_time: 100, update_time: 200 },
        ],
      },
    },
  ],
];

const CURSOR_CONVERSATION_CASES = [
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    {
      data: {
        list: [
          {
            conversation_id: "cz-page",
            created_at: 100,
            last_updated_time: 200,
          },
        ],
      },
    },
    {
      data: {
        list: [
          {
            conversation_id: "cz-page",
            created_at: 100,
            last_updated_time: 200,
          },
        ],
        next_cursor: "repeat",
      },
    },
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    {
      data: {
        list: [{ convId: "hy-page", createTime: 100, updateTime: 200 }],
      },
    },
    {
      data: {
        list: [{ convId: "hy-page", createTime: 100, updateTime: 200 }],
        cursor: "repeat",
      },
    },
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    {
      data: {
        conversation_list: [
          {
            conversation_id: "db-page",
            create_time: 100,
            last_message_time: 200,
          },
        ],
      },
    },
    {
      data: {
        conversation_list: [
          {
            conversation_id: "db-page",
            create_time: 100,
            last_message_time: 200,
          },
        ],
        has_more: true,
        cursor: "repeat",
      },
    },
  ],
];

const PAGED_MESSAGE_CASES = [
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    {
      data: {
        message_list: [{ message_id: "czm-page", created_at: 100 }],
      },
    },
    {
      data: {
        message_list: [{ message_id: "czm-page", created_at: 100 }],
        has_more: true,
        next_cursor: "repeat",
      },
    },
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    {
      data: {
        messages: [{ msgId: "hym-page", createTime: 100 }],
      },
    },
    {
      data: {
        messages: [{ msgId: "hym-page", createTime: 100 }],
        has_more: true,
        cursor: "repeat",
      },
    },
  ],
  [
    "kimi",
    kimiModule.SPEC,
    "postJson",
    { items: [{ id: "km-page", created_at: 100 }] },
    {
      items: [{ id: "km-page", created_at: 100 }],
      has_more: true,
      last_id: "repeat",
    },
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    { data: { message_list: [{ id: "dbm-page", create_time: 100 }] } },
    {
      data: {
        message_list: [{ id: "dbm-page", create_time: 100 }],
        has_more: true,
        cursor: "repeat",
      },
    },
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    {
      data: {
        items: [{ id: "item-page", create_time: 100 }],
      },
    },
    {
      data: {
        items: [{ id: "item-page", create_time: 100 }],
        has_more: true,
      },
    },
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    {
      data: {
        messages: [{ messageId: "qfm-page", createTime: 100 }],
      },
    },
    {
      data: {
        messages: [{ messageId: "qfm-page", createTime: 100 }],
        has_more: true,
      },
    },
  ],
];

const SHORT_PAGE_CONVERSATION_CASES = [
  [
    "deepseek",
    deepseekModule.SPEC,
    "getJson",
    [
      {
        data: {
          biz_data: {
            chat_sessions: [
              {
                id: "ds-short",
                inserted_at: 100,
                updated_at: 200,
              },
            ],
          },
        },
      },
      { data: { biz_data: { chat_sessions: [] } } },
    ],
    "empty-page",
  ],
  [
    "kimi",
    kimiModule.SPEC,
    "getJson",
    [
      {
        items: [{ id: "km-short", created_at: 100, updated_at: 200 }],
      },
      { items: [] },
    ],
    "empty-page",
  ],
  [
    "tongyi",
    tongyiModule.SPEC,
    "postJson",
    [
      {
        data: {
          list: [{ sessionId: "ty-short", gmtCreate: 100, gmtModified: 200 }],
        },
      },
      { data: { list: [] } },
    ],
    "empty-page",
  ],
  [
    "zhipu",
    zhipuModule.SPEC,
    "getJson",
    [
      {
        result: {
          list: [
            {
              conversation_id: "zp-short",
              create_time: 100,
              update_time: 200,
            },
          ],
        },
      },
      { result: { list: [] } },
    ],
    "empty-page",
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    [
      {
        data: {
          list: [{ sessionId: "qf-short", createTime: 100, updateTime: 200 }],
        },
      },
      { data: { list: [] } },
    ],
    "empty-page",
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    [
      {
        data: {
          workspaces: [
            { workspace_id: "dr-short", create_time: 100, update_time: 200 },
          ],
        },
      },
      { data: { workspaces: [] } },
    ],
    "empty-page",
  ],
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    [
      {
        data: {
          list: [
            {
              conversation_id: "cz-short",
              created_at: 100,
              last_updated_time: 200,
            },
          ],
        },
      },
    ],
    "stalled",
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    [
      {
        data: {
          list: [{ convId: "hy-short", createTime: 100, updateTime: 200 }],
        },
      },
    ],
    "stalled",
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    [
      {
        data: {
          conversation_list: [
            {
              conversation_id: "db-short",
              create_time: 100,
              last_message_time: 200,
            },
          ],
        },
      },
    ],
    "stalled",
  ],
];

const SHORT_PAGE_MESSAGE_CASES = [
  [
    "kimi",
    kimiModule.SPEC,
    "postJson",
    [{ items: [{ id: "km-short", created_at: 100 }] }, { items: [] }],
    "empty-page",
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    [
      {
        data: {
          messages: [{ messageId: "qf-short", createTime: 100 }],
        },
      },
      { data: { messages: [] } },
    ],
    "empty-page",
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    [
      {
        data: {
          items: [{ id: "dr-short", prompt: "hello", create_time: 100 }],
        },
      },
      { data: { items: [] } },
    ],
    "empty-page",
  ],
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    [
      {
        data: {
          message_list: [{ message_id: "cz-short", created_at: 100 }],
        },
      },
    ],
    "stalled",
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    [
      {
        data: {
          messages: [{ msgId: "hy-short", createTime: 100 }],
        },
      },
    ],
    "stalled",
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    [
      {
        data: {
          message_list: [{ id: "db-short", create_time: 100 }],
        },
      },
    ],
    "stalled",
  ],
];

const MISSING_TIMESTAMP_CONVERSATION_CASES = [
  [
    "deepseek",
    deepseekModule.SPEC,
    "getJson",
    {
      data: {
        biz_data: {
          has_more: false,
          chat_sessions: [{ id: "ds-untimed" }],
        },
      },
    },
    "ds-untimed",
  ],
  [
    "kimi",
    kimiModule.SPEC,
    "getJson",
    { items: [{ id: "km-untimed" }], total: 1 },
    "km-untimed",
  ],
  [
    "tongyi",
    tongyiModule.SPEC,
    "postJson",
    { data: { has_more: false, list: [{ sessionId: "ty-untimed" }] } },
    "ty-untimed",
  ],
  [
    "zhipu",
    zhipuModule.SPEC,
    "getJson",
    {
      result: {
        has_more: false,
        list: [{ conversation_id: "zp-untimed" }],
      },
    },
    "zp-untimed",
  ],
  [
    "hunyuan",
    hunyuanModule.SPEC,
    "postJson",
    { data: { has_more: false, list: [{ convId: "hy-untimed" }] } },
    "hy-untimed",
  ],
  [
    "qianfan",
    qianfanModule.SPEC,
    "postJson",
    { data: { has_more: false, list: [{ sessionId: "qf-untimed" }] } },
    "qf-untimed",
  ],
  [
    "coze",
    cozeModule.SPEC,
    "getJson",
    {
      data: {
        has_more: false,
        list: [{ conversation_id: "cz-untimed" }],
      },
    },
    "cz-untimed",
  ],
  [
    "dreamina",
    dreaminaModule.SPEC,
    "postJson",
    {
      data: {
        has_more: false,
        workspaces: [{ workspace_id: "dr-untimed" }],
      },
    },
    "dr-untimed",
  ],
  [
    "doubao",
    doubaoModule.SPEC,
    "postJson",
    {
      data: {
        has_more: false,
        conversation_list: [{ conversation_id: "db-untimed" }],
      },
    },
    "db-untimed",
  ],
];

describe("AI chat vendor pagination fail-closed contract", () => {
  it.each(SHORT_PAGE_CONVERSATION_CASES)(
    "%s conversations never complete a metadata-less non-empty short page",
    async (vendor, spec, method, responses, expectedBoundary) => {
      const httpClient = makeSequentialVendorClient(method, responses);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      const collection = consumeVendorGenerator(
        spec.listConversations(
          { httpClient, session, vendor },
          { pageSize: 30, maxPages: 3 },
        ),
      );

      if (expectedBoundary === "stalled") {
        await expect(collection).rejects.toMatchObject({
          code: "AI_CHAT_PAGINATION_STALLED",
          vendor,
        });
        expect(httpClient.calls).toHaveLength(1);
        return;
      }

      await expect(collection).resolves.toHaveLength(1);
      expect(httpClient.calls).toHaveLength(2);
    },
  );

  it.each(SHORT_PAGE_MESSAGE_CASES)(
    "%s messages never complete a metadata-less non-empty short page",
    async (vendor, spec, method, responses, expectedBoundary) => {
      const httpClient = makeSequentialVendorClient(method, responses);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      const collection = consumeVendorGenerator(
        spec.listMessages({ httpClient, session, vendor }, "conversation-1", {
          pageSize: 30,
          maxPages: 3,
        }),
      );

      if (expectedBoundary === "stalled") {
        await expect(collection).rejects.toMatchObject({
          code: "AI_CHAT_PAGINATION_STALLED",
          vendor,
        });
        expect(httpClient.calls).toHaveLength(1);
        return;
      }

      await expect(collection).resolves.toHaveLength(1);
      expect(httpClient.calls).toHaveLength(2);
    },
  );

  it.each(MISSING_TIMESTAMP_CONVERSATION_CASES)(
    "%s conversations do not treat a missing timestamp as the since boundary",
    async (vendor, spec, method, response, expectedId) => {
      const httpClient = makeDirectVendorClient(method, response);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      const conversations = await consumeVendorGenerator(
        spec.listConversations(
          { httpClient, session, vendor },
          { since: { lastUpdatedAt: 1_000 }, maxPages: 2 },
        ),
      );

      expect(conversations).toHaveLength(1);
      expect(conversations[0].originalId).toBe(expectedId);
    },
  );

  it.each(NUMERIC_CONVERSATION_CASES)(
    "%s numeric conversations throw at page cap",
    async (vendor, spec, method, response) => {
      const httpClient = makeDirectVendorClient(method, response);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { pageSize: 1, maxPages: 1 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_LIMIT",
        vendor,
      });
      expect(httpClient.calls).toHaveLength(1);
    },
  );

  it.each(NUMERIC_CONVERSATION_CASES)(
    "%s numeric conversations reject a repeated page",
    async (vendor, spec, method, response) => {
      const httpClient = makeDirectVendorClient(method, response);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { pageSize: 1, maxPages: 3 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
      expect(httpClient.calls).toHaveLength(2);
    },
  );

  it.each(CURSOR_CONVERSATION_CASES)(
    "%s cursor conversations require continuation for a full page",
    async (vendor, spec, method, terminalResponse) => {
      const httpClient = makeDirectVendorClient(method, terminalResponse);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { pageSize: 1, maxPages: 2 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
    },
  );

  it.each(CURSOR_CONVERSATION_CASES)(
    "%s cursor conversations reject repeated cursors/pages",
    async (vendor, spec, method, _terminalResponse, continuingResponse) => {
      const httpClient = makeDirectVendorClient(method, continuingResponse);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listConversations(
            { httpClient, session, vendor },
            { maxPages: 3 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
      expect(httpClient.calls).toHaveLength(2);
    },
  );

  it.each(PAGED_MESSAGE_CASES)(
    "%s messages fail closed at caps and repeated cursors",
    async (vendor, spec, method, _terminalResponse, continuingResponse) => {
      const session = new CookieAuthSession({ vendor, cookies: [] });
      const limitedClient = makeDirectVendorClient(method, continuingResponse);
      await expect(
        consumeVendorGenerator(
          spec.listMessages(
            { httpClient: limitedClient, session, vendor },
            "conversation-1",
            { pageSize: 1, maxPages: 1 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_LIMIT",
        vendor,
      });

      const repeatedClient = makeDirectVendorClient(method, continuingResponse);
      await expect(
        consumeVendorGenerator(
          spec.listMessages(
            { httpClient: repeatedClient, session, vendor },
            "conversation-1",
            { pageSize: 1, maxPages: 3 },
          ),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
      expect(repeatedClient.calls).toHaveLength(2);
    },
  );

  it.each(PAGED_MESSAGE_CASES)(
    "%s messages require continuation for a full page",
    async (vendor, spec, method, terminalResponse) => {
      const httpClient = makeDirectVendorClient(method, terminalResponse);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listMessages({ httpClient, session, vendor }, "conversation-1", {
            pageSize: 1,
            maxPages: 2,
          }),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
    },
  );

  it.each([
    [
      "deepseek",
      deepseekModule.SPEC,
      "getJson",
      {
        data: {
          biz_data: {
            has_more: true,
          },
        },
      },
    ],
    [
      "tongyi",
      tongyiModule.SPEC,
      "postJson",
      {
        data: {
          list: [{ msgId: "tm-more", createTime: 100 }],
          has_more: true,
        },
      },
    ],
    [
      "zhipu",
      zhipuModule.SPEC,
      "getJson",
      {
        result: {
          messages: [{ id: "zm-more", create_time: 100 }],
          has_more: true,
        },
      },
    ],
  ])(
    "%s single-call messages reject explicit more data",
    async (vendor, spec, method, response) => {
      const httpClient = makeDirectVendorClient(method, response);
      const session = new CookieAuthSession({ vendor, cookies: [] });
      await expect(
        consumeVendorGenerator(
          spec.listMessages({ httpClient, session, vendor }, "conversation-1", {
            maxPages: 1,
          }),
        ),
      ).rejects.toMatchObject({
        code: "AI_CHAT_PAGINATION_STALLED",
        vendor,
      });
    },
  );
});

describe("vendor spec post-wire smoke (9 vendors total — 8 live + doubao scaffold)", () => {
  it.each([
    "deepseek",
    "kimi",
    "tongyi",
    "zhipu",
    "hunyuan",
    "qianfan",
    "coze",
    "dreamina",
    "doubao",
  ])("%s spec still has correct shape", (v) => {
    expect(DEFAULT_VENDOR_SPECS[v].name).toBe(v);
    expect(typeof DEFAULT_VENDOR_SPECS[v].listConversations).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS[v].listMessages).toBe("function");
    expect(typeof DEFAULT_VENDOR_SPECS[v].validateCookie).toBe("function");
  });
});
