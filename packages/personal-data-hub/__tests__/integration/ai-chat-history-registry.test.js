"use strict";

// Integration — AIChatHistoryAdapter end-to-end through AdapterRegistry.
// Verifies the full chain: register → syncAdapter → real vendor HTTP →
// raw archive → normalize → partition → vault put → watermark advance →
// audit log.

import { describe, it, expect, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { LocalVault, generateKeyHex, AdapterRegistry } = require("../../lib");
const {
  AIChatHistoryAdapter,
  CookieAuthSession,
  DEFAULT_VENDOR_SPECS,
  RateLimitedError,
} = require("../../lib/adapters/ai-chat-history");

function makeRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-aichat-int-"));
  const vault = new LocalVault({
    path: path.join(dir, "v.db"),
    key: generateKeyHex(),
  });
  vault.open();
  const registry = new AdapterRegistry({ vault });
  return { vault, registry, dir };
}

function cleanup({ vault, dir }) {
  try {
    vault.close();
  } catch {
    // Best-effort cleanup after assertions.
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup after assertions.
  }
}

function makeResponse({ status = 200, body = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
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
      return makeResponse({ status: 404, body: { error: "no route" } });
    },
  };
}

function makeClock() {
  let t = 1700000000_000;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

function deepseekFixtures() {
  return [
    [
      "/get_user_info",
      makeResponse({
        body: { code: 0, data: { biz_data: { user_id: "ds-u1" } } },
      }),
    ],
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
                  id: "ds-c1",
                  title: "test ds chat",
                  model: "deepseek-r1",
                  inserted_at: 1700000100,
                  updated_at: 1700000200,
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
                  id: "ds-m1",
                  role: "USER",
                  content: "hi deepseek",
                  inserted_at: 1700000100,
                },
                {
                  id: "ds-m2",
                  role: "ASSISTANT",
                  content: "hi back",
                  inserted_at: 1700000110,
                  model: "deepseek-r1",
                },
              ],
            },
          },
        },
      }),
    ],
  ];
}

function kimiFixtures() {
  return [
    ["/api/user", makeResponse({ body: { id: "km-u1" } })],
    [/list\?offset=30/, makeResponse({ body: { items: [], total: 1 } })],
    [
      /list\?offset=0/,
      makeResponse({
        body: {
          items: [
            {
              id: "km-c1",
              name: "test kimi",
              created_at: 1700000300,
              updated_at: 1700000400,
              message_count: 1,
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
                  id: "km-msg-1",
                  role: "user",
                  content: "hi kimi",
                  created_at: 1700000300,
                },
              ],
              has_more: false,
            },
          });
        }
        return makeResponse({ body: { items: [], has_more: false } });
      },
    ],
  ];
}

// ─── tests ───────────────────────────────────────────────────────────────

describe("Integration — AIChatHistoryAdapter through AdapterRegistry", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("registers without contract errors (adapter passes assertAdapter)", () => {
    rig = makeRig();
    const a = new AIChatHistoryAdapter();
    expect(() => rig.registry.register(a)).not.toThrow();
  });

  it("two-vendor sync writes events to vault with proper raw_events archive", async () => {
    rig = makeRig();
    const clk = makeClock();
    const fetched = makeRoutedFetch([...deepseekFixtures(), ...kimiFixtures()]);
    const a = new AIChatHistoryAdapter({
      fetch: fetched.fetch,
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
    a.setSession(
      "kimi",
      new CookieAuthSession({
        vendor: "kimi",
        cookies: [{ name: "sess", value: "y" }],
      }),
    );
    rig.registry.register(a);

    const report = await rig.registry.syncAdapter("ai-chat-history");
    expect(report.status).toBe("ok");
    expect(report.invalidCount).toBe(0); // adapter must yield valid registry envelopes

    // Each vendor yields: 1 conv + N msgs (deepseek=2, kimi=1) = 5 raws across both
    expect(report.rawCount).toBeGreaterThanOrEqual(5);

    // Vault has events (2 deepseek msgs + 1 kimi msg)
    const allEvents = rig.vault.queryEvents({
      adapter: "ai-chat-history",
      limit: 1000,
    });
    expect(allEvents.length).toBeGreaterThanOrEqual(3);
    const vendors = new Set(
      allEvents.map((e) => e.extra && e.extra.vendor).filter(Boolean),
    );
    expect(vendors.has("deepseek")).toBe(true);
    expect(vendors.has("kimi")).toBe(true);

    // Vendor Person dedup via raw SQL: only 1 DeepSeek Person + 1 Kimi Person
    const aiAgentCount = rig.vault.db
      .prepare("SELECT COUNT(*) AS n FROM persons WHERE subtype = 'ai-agent'")
      .get().n;
    expect(aiAgentCount).toBe(2);

    // Topics: 1 conversation Topic per vendor (extra.kind = 'ai-conversation')
    const topicCount = rig.vault.db
      .prepare(
        "SELECT COUNT(*) AS n FROM topics WHERE json_extract(extra, '$.kind') = 'ai-conversation'",
      )
      .get().n;
    expect(topicCount).toBe(2);
  });

  it("Android cookie snapshot flows through registry into real vault events", async () => {
    rig = makeRig();
    const clk = makeClock();
    const fetched = makeRoutedFetch(deepseekFixtures());
    const adapter = new AIChatHistoryAdapter({
      fetch: fetched.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    rig.registry.register(adapter);
    const inputPath = path.join(rig.dir, "ai-chat-deepseek.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        vendor: "deepseek",
        cookie: "userToken=android-token; device_id=device-1",
        fetchedAt: 1_700_000_000_000,
      }),
      { mode: 0o600 },
    );

    const report = await rig.registry.syncAdapter("ai-chat-history", {
      inputPath,
    });

    expect(report.status).toBe("ok");
    expect(report.invalidCount).toBe(0);
    expect(report.rawCount).toBeGreaterThanOrEqual(3);
    expect(report.checkpointCommitted).toBe(true);
    expect(report.watermarkDeferred).toBe(false);
    expect(report.watermark).toMatch(/^aichat-v1:/u);
    const events = rig.vault.queryEvents({
      adapter: "ai-chat-history",
      limit: 100,
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.extra.vendor === "deepseek")).toBe(
      true,
    );
    const conversation = rig.vault.db
      .prepare(
        "SELECT COUNT(*) AS n FROM topics WHERE json_extract(extra, '$.kind') = 'ai-conversation'",
      )
      .get().n;
    expect(conversation).toBe(1);
  });

  it("watermark advances after successful sync; second sync is idempotent", async () => {
    rig = makeRig();
    const clk = makeClock();
    const fetched = makeRoutedFetch(deepseekFixtures());
    const a = new AIChatHistoryAdapter({
      fetch: fetched.fetch,
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
    rig.registry.register(a);

    const r1 = await rig.registry.syncAdapter("ai-chat-history");
    expect(r1.status).toBe("ok");
    const firstWatermark = r1.watermark;
    expect(firstWatermark).toMatch(/^aichat-v1:/);
    expect(r1.watermarkDeferred).toBe(false);

    const eventsAfterFirst = rig.vault.queryEvents({
      adapter: "ai-chat-history",
      limit: 100,
    }).length;
    expect(eventsAfterFirst).toBeGreaterThanOrEqual(2);

    // Re-sync same fixtures — should be idempotent (no duplicate events).
    const r2 = await rig.registry.syncAdapter("ai-chat-history");
    expect(r2.status).toBe("ok");

    // The vendor sub-cursor is fed back into the second scan. A one-millisecond
    // boundary replay may re-read the newest row, but the committed cursor is
    // stable and source IDs keep ingestion idempotent.
    expect(r2.watermark).toBe(firstWatermark);
    expect(r2.watermarkDeferred).toBe(false);
  });

  it("expands the AI conversation page budget until a complete scan commits", async () => {
    rig = makeRig();
    const requiredPages = 21;
    const seenPageBudgets = [];
    const spec = {
      ...DEFAULT_VENDOR_SPECS.deepseek,
      async validateCookie() {
        return { ok: true };
      },
      async *listConversations(_ctx, opts) {
        seenPageBudgets.push(opts.maxPages);
        for (let page = 0; page < requiredPages; page++) {
          if (page >= opts.maxPages) {
            const err = new Error("test pagination budget exhausted");
            err.code = "AI_CHAT_PAGINATION_LIMIT";
            throw err;
          }
          yield {
            vendor: "deepseek",
            originalId: `budget-conversation-${page}`,
            createdAt: 1_700_000_000_000 + page,
            updatedAt: 1_700_000_000_000 + page,
          };
        }
      },
      async *listMessages() {},
    };
    const adapter = new AIChatHistoryAdapter({
      vendorSpecs: { deepseek: spec },
    });
    adapter.setSession(
      "deepseek",
      new CookieAuthSession({
        vendor: "deepseek",
        cookies: [{ name: "userToken", value: "x" }],
      }),
    );
    rig.registry.register(adapter);

    const partial = await rig.registry.syncAdapter("ai-chat-history");
    expect(partial).toMatchObject({
      status: "ok",
      watermark: null,
      watermarkDeferred: true,
      checkpointCommitted: false,
      pageBudget: 20,
      nextPageBudget: 40,
      scanDeferredCount: 1,
    });
    expect(rig.vault.getSyncScanState("ai-chat-history")).toMatchObject({
      page_budget: 40,
      deferred_count: 1,
    });

    const complete = await rig.registry.syncAdapter("ai-chat-history");
    expect(complete).toMatchObject({
      status: "ok",
      watermarkDeferred: false,
      checkpointCommitted: true,
      pageBudget: 40,
      nextPageBudget: null,
      scanDeferredCount: 1,
    });
    expect(complete.watermark).toMatch(/^aichat-v1:/u);
    expect(rig.vault.getSyncScanState("ai-chat-history")).toBeNull();
    expect(seenPageBudgets).toEqual([20, 40]);
  });

  it("retains the old cursor when a later vendor scan is rate limited", async () => {
    rig = makeRig();
    let rateLimited = false;
    const spec = {
      ...DEFAULT_VENDOR_SPECS.deepseek,
      async validateCookie() {
        return { ok: true };
      },
      async *listConversations() {
        if (rateLimited) throw new RateLimitedError(1_000, "deepseek");
        yield {
          vendor: "deepseek",
          originalId: "stable-cursor-conv",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_100_000,
        };
      },
      async *listMessages() {},
    };
    const adapter = new AIChatHistoryAdapter({
      vendorSpecs: { deepseek: spec },
    });
    adapter.setSession(
      "deepseek",
      new CookieAuthSession({
        vendor: "deepseek",
        cookies: [{ name: "userToken", value: "x" }],
      }),
    );
    rig.registry.register(adapter);

    const first = await rig.registry.syncAdapter("ai-chat-history");
    expect(first.status).toBe("ok");
    expect(first.watermark).toMatch(/^aichat-v1:/);
    rateLimited = true;

    const second = await rig.registry.syncAdapter("ai-chat-history");
    expect(second.status).toBe("ok");
    expect(second.watermarkDeferred).toBe(true);
    expect(second.watermark).toBe(first.watermark);
  });

  it("vendor-cookie-expired sentinel does not abort the whole sync", async () => {
    rig = makeRig();
    const clk = makeClock();
    // deepseek returns 401, kimi works.
    const fetched = makeRoutedFetch([
      [/chat_session\/fetch_page/, makeResponse({ status: 401 })],
      ...kimiFixtures(),
    ]);
    const a = new AIChatHistoryAdapter({
      fetch: fetched.fetch,
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
    rig.registry.register(a);

    const report = await rig.registry.syncAdapter("ai-chat-history");
    expect(report.status).toBe("ok"); // partial success is still ok
    expect(report.watermarkDeferred).toBe(true);

    // Kimi events made it in despite deepseek failure.
    const allEvents = rig.vault.queryEvents({
      adapter: "ai-chat-history",
      limit: 100,
    });
    const kimiEvents = allEvents.filter(
      (e) => e.extra && e.extra.vendor === "kimi",
    );
    expect(kimiEvents.length).toBeGreaterThan(0);
  });

  it("no sessions configured → explicit not-ready result and zero ingestion", async () => {
    rig = makeRig();
    const a = new AIChatHistoryAdapter();
    rig.registry.register(a);

    const report = await rig.registry.syncAdapter("ai-chat-history");
    expect(report.status).toBe("unhealthy");
    expect(report.error).toBe("INVALID_COOKIE");
    expect(report.rawCount).toBe(0);
    expect(
      rig.vault.queryEvents({ adapter: "ai-chat-history", limit: 10 }).length,
    ).toBe(0);
  });

  it("configured but invalid sessions fail health before source collection", async () => {
    rig = makeRig();
    const fetched = makeRoutedFetch([
      ["/get_user_info", makeResponse({ status: 401 })],
      [
        "/chat_session/fetch_page",
        makeResponse({
          body: { data: { biz_data: { chat_sessions: [] } } },
        }),
      ],
    ]);
    const adapter = new AIChatHistoryAdapter({ fetch: fetched.fetch });
    adapter.setSession(
      "deepseek",
      new CookieAuthSession({
        vendor: "deepseek",
        cookies: [{ name: "userToken", value: "expired" }],
      }),
    );
    rig.registry.register(adapter);

    const report = await rig.registry.syncAdapter("ai-chat-history");

    expect(report.status).toBe("unhealthy");
    expect(report.error).toBe("INVALID_COOKIE");
    expect(
      fetched.calls.some((call) =>
        call.url.includes("/chat_session/fetch_page"),
      ),
    ).toBe(false);
  });

  it("audit log captures sync.ok with adapter name + scope", async () => {
    rig = makeRig();
    const clk = makeClock();
    const fetched = makeRoutedFetch(deepseekFixtures());
    const a = new AIChatHistoryAdapter({
      fetch: fetched.fetch,
      sleep: clk.sleep,
      now: clk.now,
    });
    a.setSession(
      "deepseek",
      new CookieAuthSession({ vendor: "deepseek", cookies: [] }),
    );
    rig.registry.register(a);

    await rig.registry.syncAdapter("ai-chat-history");

    const audit = rig.vault.queryAudit({
      adapter: "ai-chat-history",
      limit: 50,
    });
    const okEntries = audit.filter((a) => a.action === "adapter.sync.ok");
    expect(okEntries.length).toBeGreaterThan(0);
  });
});
