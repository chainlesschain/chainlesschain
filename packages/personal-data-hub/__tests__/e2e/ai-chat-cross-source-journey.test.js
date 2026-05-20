"use strict";

// E2E — Personal Data Hub cross-source journey including Phase 10.2 AIChat.
//
// User has:
//   1. Two AI vendors with chat history (DeepSeek + Kimi)
//   2. EntityResolver wires up vendor Persons as ai-agents
//   3. Timeline + Relations skills weave AI conversations into the same
//      chronological story as other data sources (RAG-ready surface).
//
// Verifies the Phase 10.2 wiring through the entire stack — sync → vault
// → KG/RAG sinks → analysis skills — using fixture HTTP (no live cookies).

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  LocalVault, generateKeyHex, AdapterRegistry,
  EntityResolver,
  TimelineSkill, RelationsSkill,
} = require("../../lib");
const {
  AIChatHistoryAdapter, CookieAuthSession,
} = require("../../lib/adapters/ai-chat-history");

function makeResponse({ status = 200, body = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async json() { return body; },
  };
}

function makeRoutedFetch(routes) {
  return async (url, init) => {
    for (const [pattern, response] of routes) {
      if (typeof pattern === "string" ? url.includes(pattern) : pattern.test(url)) {
        if (typeof response === "function") return response(url, init);
        return response;
      }
    }
    return makeResponse({ status: 404 });
  };
}

function makeClock() {
  let t = 1700000000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

describe("E2E — Personal Data Hub cross-source journey with AIChat", () => {
  let dir, vault, registry, resolver;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-aichat-e2e-"));
    vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
    vault.open();
    resolver = new EntityResolver({ vault });
    registry = new AdapterRegistry({ vault, entityResolver: resolver });
  });

  afterEach(() => {
    try { vault.close(); } catch (_e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
  });

  it("two AIChat vendors land in vault; TimelineSkill returns interleaved events", async () => {
    const clk = makeClock();
    const fetch = makeRoutedFetch([
      // DeepSeek
      ["/get_user_info", makeResponse({ body: { code: 0, data: { biz_data: { user_id: "ds-u1" } } } })],
      [/fetch_page.*before=/, makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } })],
      ["/chat_session/fetch_page", makeResponse({ body: { data: { biz_data: { chat_sessions: [
        { id: "ds-c1", title: "DeepSeek code review", model: "deepseek-r1", inserted_at: 1700000100, updated_at: 1700000200 },
      ] } } } })],
      ["/chat/history_messages", makeResponse({ body: { data: { biz_data: { chat_messages: [
        { id: "ds-m1", role: "USER", content: "explain this Go race condition", inserted_at: 1700000100 },
        { id: "ds-m2", role: "ASSISTANT", content: "The issue is the unlocked mutex...", inserted_at: 1700000150, model: "deepseek-r1" },
      ] } } } })],
      // Kimi
      ["/api/user", makeResponse({ body: { id: "km-u1" } })],
      [/list\?offset=30/, makeResponse({ body: { items: [], total: 1 } })],
      [/list\?offset=0/, makeResponse({ body: { items: [
        { id: "km-c1", name: "Kimi 200k context Q", created_at: 1700000300, updated_at: 1700000400 },
      ], total: 1 } })],
      [/segment\/scroll/, async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.last === "0") {
          return makeResponse({ body: {
            items: [
              { id: "km-msg-1", role: "user", content: "summarize this paper", created_at: 1700000300 },
              { id: "km-msg-2", role: "assistant", content: "The paper proposes...", created_at: 1700000350 },
            ],
            has_more: false,
          } });
        }
        return makeResponse({ body: { items: [], has_more: false } });
      }],
    ]);

    const adapter = new AIChatHistoryAdapter({ fetch, sleep: clk.sleep, now: clk.now });
    adapter.setSession("deepseek", new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "ds-cookie" }],
    }));
    adapter.setSession("kimi", new CookieAuthSession({
      vendor: "kimi",
      cookies: [{ name: "access_token", value: "km-cookie" }],
    }));
    registry.register(adapter);

    // ─── Sync ──────────────────────────────────────────────
    const report = await registry.syncAdapter("ai-chat-history");
    expect(report.status).toBe("ok");
    expect(report.invalidCount).toBe(0);
    expect(report.rawCount).toBeGreaterThanOrEqual(6); // 2 convs + 4 msgs

    // ─── Vault inspection ──────────────────────────────────
    const events = vault.queryEvents({ adapter: "ai-chat-history", limit: 100 });
    expect(events.length).toBe(4); // 2 deepseek msgs + 2 kimi msgs

    // Both vendors present
    const vendors = new Set(events.map((e) => e.extra && e.extra.vendor).filter(Boolean));
    expect(vendors.has("deepseek")).toBe(true);
    expect(vendors.has("kimi")).toBe(true);

    // Vendor AI-agent Persons deduped
    const aiAgentCount = vault.db
      .prepare("SELECT COUNT(*) AS n FROM persons WHERE subtype = 'ai-agent'")
      .get().n;
    expect(aiAgentCount).toBe(2);

    // ─── TimelineSkill: events interleaved by time ─────────
    const timeline = new TimelineSkill({ vault });
    const result = await timeline.run({ since: 1700000000_000, until: 1700001000_000, limit: 100 });
    expect(result.entries.length).toBeGreaterThanOrEqual(4);

    // Both vendors appear via the timeline entries (each entry references an event)
    const allText = result.entries.map((e) => JSON.stringify(e)).join(" ");
    expect(allText).toMatch(/Go race|race condition/);
    expect(allText).toMatch(/summarize this paper|paper proposes/);
  });

  it("RelationsSkill aggregates AI-agent interactions across vendors", async () => {
    const clk = makeClock();
    const fetch = makeRoutedFetch([
      ["/get_user_info", makeResponse({ body: { code: 0, data: { biz_data: { user_id: "ds-u1" } } } })],
      [/fetch_page.*before=/, makeResponse({ body: { data: { biz_data: { chat_sessions: [] } } } })],
      ["/chat_session/fetch_page", makeResponse({ body: { data: { biz_data: { chat_sessions: [
        { id: "ds-c1", title: "ds chat", model: "deepseek-r1", inserted_at: 1700000100, updated_at: 1700000200 },
      ] } } } })],
      ["/chat/history_messages", makeResponse({ body: { data: { biz_data: { chat_messages: [
        { id: "ds-m1", role: "USER", content: "hi", inserted_at: 1700000100 },
        { id: "ds-m2", role: "ASSISTANT", content: "hi back", inserted_at: 1700000110 },
        { id: "ds-m3", role: "USER", content: "more questions", inserted_at: 1700000120 },
      ] } } } })],
    ]);

    const adapter = new AIChatHistoryAdapter({ fetch, sleep: clk.sleep, now: clk.now });
    adapter.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [] }));
    registry.register(adapter);

    await registry.syncAdapter("ai-chat-history");

    const skill = new RelationsSkill({ vault });
    const r = await skill.run({ personId: "person-ai-deepseek" });
    expect(r.profile.totalInteractions).toBeGreaterThan(0);
  });

  it("AIChat + cookie-expired sentinel: partial success, journey continues", async () => {
    const clk = makeClock();
    // DeepSeek returns 401 (expired); Kimi works.
    const fetch = makeRoutedFetch([
      [/chat_session\/fetch_page/, makeResponse({ status: 401 })],
      ["/api/user", makeResponse({ body: { id: "km-u1" } })],
      [/list\?offset=30/, makeResponse({ body: { items: [], total: 1 } })],
      [/list\?offset=0/, makeResponse({ body: { items: [
        { id: "km-c1", name: "still works", created_at: 1700000300, updated_at: 1700000400 },
      ], total: 1 } })],
      [/segment\/scroll/, async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.last === "0") {
          return makeResponse({ body: {
            items: [{ id: "km-msg-1", role: "user", content: "hi kimi", created_at: 1700000300 }],
            has_more: false,
          } });
        }
        return makeResponse({ body: { items: [], has_more: false } });
      }],
    ]);
    const adapter = new AIChatHistoryAdapter({ fetch, sleep: clk.sleep, now: clk.now });
    adapter.setSession("deepseek", new CookieAuthSession({ vendor: "deepseek", cookies: [] }));
    adapter.setSession("kimi", new CookieAuthSession({ vendor: "kimi", cookies: [] }));
    registry.register(adapter);

    const report = await registry.syncAdapter("ai-chat-history");
    expect(report.status).toBe("ok");

    // Kimi events landed even though DeepSeek failed.
    const allEvents = vault.queryEvents({ adapter: "ai-chat-history", limit: 100 });
    const kimiEvents = allEvents.filter((e) => e.extra && e.extra.vendor === "kimi");
    expect(kimiEvents.length).toBeGreaterThan(0);

    // Timeline still returns kimi event despite deepseek failure.
    const timeline = new TimelineSkill({ vault });
    const result = await timeline.run({ since: 1700000000_000, until: 1700001000_000, limit: 100 });
    expect(result.entries.length).toBeGreaterThan(0);
  });
});
