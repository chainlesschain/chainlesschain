"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { newId } = require("../lib/ids");
const { generateKeyHex } = require("../lib/key-providers");
const { LocalVault } = require("../lib/vault");
const { TARGET_VERSION, getFtsMode } = require("../lib/migrations");

// ─── Fixtures ─────────────────────────────────────────────────────────────

const source = (adapter = "test", overrides = {}) => ({
  adapter,
  adapterVersion: "0.1.0",
  capturedAt: Date.now(),
  capturedBy: "manual",
  ...overrides,
});

const eventOk = (overrides = {}) => ({
  id: newId(),
  type: "event",
  subtype: "message",
  occurredAt: Date.now(),
  ingestedAt: Date.now(),
  content: { text: "Hello" },
  source: source(),
  ...overrides,
});

// Realistic per-category seed data — one event per major category so the
// browser sidebar can be exercised end-to-end. CJK + ASCII mixed.
function seedMixedCategories(vault, baseTime = 1700000000000) {
  const seeds = [
    {
      adapter: "wechat",
      subtype: "message",
      content: { text: "妈妈让我记得带钥匙" },
      actor: "wxid_self",
    },
    {
      adapter: "messaging-qq",
      subtype: "message",
      content: { text: "晚上一起吃火锅吗" },
      actor: "qq_1234",
    },
    {
      adapter: "social-bilibili",
      subtype: "media",
      content: { title: "支付宝年度账单怎么看", url: "https://b23.tv/x" },
    },
    {
      adapter: "social-weibo",
      subtype: "post",
      content: { text: "今天天气真好" },
    },
    {
      adapter: "email-imap-qq",
      subtype: "message",
      content: { subject: "招商银行账单提醒", from: "noreply@cmbchina.com" },
    },
    {
      adapter: "shopping-taobao",
      subtype: "order",
      content: {
        title: "罗技 MX Master 3S",
        amount: { value: 729.0, currency: "CNY", direction: "out" },
      },
      extra: { merchant: "罗技旗舰店", orderNo: "TAO-2024-09-001" },
    },
    {
      adapter: "alipay-bill",
      subtype: "transfer",
      content: {
        amount: { value: 25.5, currency: "CNY", direction: "out" },
        counterparty: "瑞幸咖啡",
      },
    },
    {
      adapter: "travel-12306",
      subtype: "trip",
      content: { from: "厦门北", to: "上海虹桥", trainNo: "G3204" },
      place: "厦门北",
    },
    {
      adapter: "system-data-android",
      subtype: "other",
      content: { name: "李雷", phone: "13800000000" },
    },
    {
      adapter: "ai-chat-history",
      subtype: "ai-message",
      content: { prompt: "帮我写一段 Kotlin 代码", model: "deepseek-r1" },
    },
    {
      adapter: "unknown-collector",
      subtype: "other",
      content: { x: 1 },
    },
  ];
  let i = 0;
  for (const seed of seeds) {
    // schema-aware fixture: omit place/extra/actor when nullish so validator
    // accepts (it rejects explicit null on optional-typed fields)
    const ev = {
      id: `seed-${i.toString().padStart(3, "0")}-${seed.adapter}`,
      subtype: seed.subtype,
      occurredAt: baseTime + i * 1000,
      content: seed.content,
      source: source(seed.adapter),
    };
    if (seed.actor) ev.actor = seed.actor;
    if (seed.place) ev.place = seed.place;
    if (seed.extra) ev.extra = seed.extra;
    vault.putEvent(eventOk(ev));
    i++;
  }
  return i;
}

// ─── Test scaffolding ─────────────────────────────────────────────────────

let tmpDir;
let vaultPath;
let vault;
let key;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-vault-search-"));
  vaultPath = path.join(tmpDir, "vault.db");
  key = generateKeyHex();
  vault = new LocalVault({ path: vaultPath, key, skipAudit: true });
  vault.open();
}

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch (_e) {}
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Migration 3 — FTS5 / LIKE mode setup ─────────────────────────────────

describe("Migration v3 — events_fts setup", () => {
  it("schemaVersion reaches TARGET_VERSION", () => {
    freshVault();
    expect(vault.schemaVersion()).toBe(TARGET_VERSION);
  });

  it("records fts_mode = 'fts5' or 'like' in _meta", () => {
    freshVault();
    const mode = vault.ftsMode();
    expect(["fts5", "like"]).toContain(mode);
    // Cross-check against the underlying _meta query
    expect(getFtsMode(vault.db)).toBe(mode);
  });

  it("creates events_fts virtual table when fts_mode = 'fts5'", () => {
    freshVault();
    if (vault.ftsMode() !== "fts5") return; // env without FTS5/trigram — skip
    const row = vault.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'")
      .get();
    expect(row).toBeTruthy();
  });

  it("triggers events_ai / events_au / events_ad exist when fts_mode = 'fts5'", () => {
    freshVault();
    if (vault.ftsMode() !== "fts5") return;
    const names = vault.db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='events'")
      .all()
      .map((r) => r.name);
    expect(names).toContain("events_ai");
    expect(names).toContain("events_au");
    expect(names).toContain("events_ad");
  });
});

// ─── searchEvents — keyword / adapter / category / cursor ─────────────────

describe("vault.searchEvents", () => {
  beforeEach(() => freshVault());

  it("returns no rows when vault is empty", () => {
    const r = vault.searchEvents({});
    expect(r.rows).toEqual([]);
    expect(r.nextCursor).toBeNull();
    expect(["fts5", "like"]).toContain(r.mode);
  });

  it("returns all events newest-first when no filter given", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ limit: 20 });
    expect(r.rows.length).toBe(11);
    // Newest first ⇒ first row's occurredAt > last
    expect(r.rows[0].occurredAt).toBeGreaterThan(r.rows[r.rows.length - 1].occurredAt);
  });

  it("filters by exact adapter", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ adapter: "wechat" });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].source.adapter).toBe("wechat");
  });

  it("filters by category 'chat' (wechat + messaging-*)", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ category: "chat" });
    const adapters = r.rows.map((e) => e.source.adapter).sort();
    expect(adapters).toEqual(["messaging-qq", "wechat"]);
  });

  it("filters by category 'social' (social-*)", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ category: "social" });
    const adapters = r.rows.map((e) => e.source.adapter).sort();
    expect(adapters).toEqual(["social-bilibili", "social-weibo"]);
  });

  it("filters by category 'shopping' (shopping-* + alipay-*)", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ category: "shopping" });
    const adapters = r.rows.map((e) => e.source.adapter).sort();
    expect(adapters).toEqual(["alipay-bill", "shopping-taobao"]);
  });

  it("filters by category 'other' (no-prefix adapters)", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ category: "other" });
    const adapters = r.rows.map((e) => e.source.adapter);
    expect(adapters).toEqual(["unknown-collector"]);
  });

  it("filters by date range (since/until)", () => {
    seedMixedCategories(vault, 1700000000000);
    // Seed adds 1 row per second; first 3 rows are at base, base+1000, base+2000
    const r = vault.searchEvents({
      since: 1700000000000,
      until: 1700000002000,
    });
    expect(r.rows.length).toBe(3);
  });

  it("keyword search finds CJK content (FTS5 trigram path)", () => {
    seedMixedCategories(vault);
    if (vault.ftsMode() !== "fts5") return; // skip on LIKE-only envs
    const r = vault.searchEvents({ q: "支付宝" });
    // Should match the bilibili video (title contains 支付宝)
    expect(r.rows.some((e) => e.source.adapter === "social-bilibili")).toBe(true);
  });

  it("keyword search finds ASCII content", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ q: "Kotlin" });
    expect(r.rows.some((e) => e.source.adapter === "ai-chat-history")).toBe(true);
  });

  it("reports shortQuery=true for sub-3-char query in FTS5 mode", () => {
    seedMixedCategories(vault);
    if (vault.ftsMode() !== "fts5") return;
    const r = vault.searchEvents({ q: "钥" });
    expect(r.shortQuery).toBe(true);
    expect(r.rows.length).toBe(11); // all rows — q was dropped
  });

  it("LIKE-mode search matches 1-char CJK (no min length)", () => {
    seedMixedCategories(vault);
    if (vault.ftsMode() !== "like") return; // FTS5 mode covered separately
    const r = vault.searchEvents({ q: "妈" });
    expect(r.shortQuery).toBe(false);
    expect(r.rows.some((e) => e.source.adapter === "wechat")).toBe(true);
  });

  it("cursor pagination yields stable non-overlapping pages", () => {
    seedMixedCategories(vault, 1700000000000);
    const page1 = vault.searchEvents({ limit: 5 });
    expect(page1.rows.length).toBe(5);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = vault.searchEvents({ limit: 5, cursor: page1.nextCursor });
    const page1Ids = new Set(page1.rows.map((e) => e.id));
    for (const e of page2.rows) {
      expect(page1Ids.has(e.id)).toBe(false);
    }
    // Page2 rows are strictly older than page1's last
    const p1Last = page1.rows[page1.rows.length - 1].occurredAt;
    for (const e of page2.rows) {
      expect(e.occurredAt).toBeLessThanOrEqual(p1Last);
    }
  });

  it("nextCursor is null on final page", () => {
    seedMixedCategories(vault);
    const r = vault.searchEvents({ limit: 100 });
    expect(r.rows.length).toBe(11);
    expect(r.nextCursor).toBeNull();
  });

  it("combines q + category + date filters (AND)", () => {
    seedMixedCategories(vault, 1700000000000);
    if (vault.ftsMode() !== "fts5") return;
    const r = vault.searchEvents({
      q: "支付宝",
      category: "social",
      since: 1700000000000,
      until: 1700000005000,
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].source.adapter).toBe("social-bilibili");
  });
});

// ─── facetCounts — sidebar / chip badges ──────────────────────────────────

describe("vault.facetCounts", () => {
  beforeEach(() => freshVault());

  it("returns zero counts on empty vault", () => {
    const r = vault.facetCounts({});
    expect(r.byCategory).toEqual({});
    expect(r.byAdapter).toEqual({});
    expect(r.total).toBe(0);
  });

  it("groups events by category", () => {
    seedMixedCategories(vault);
    const r = vault.facetCounts({});
    expect(r.byCategory.chat).toBe(2);
    expect(r.byCategory.social).toBe(2);
    expect(r.byCategory.email).toBe(1);
    expect(r.byCategory.shopping).toBe(2);
    expect(r.byCategory.travel).toBe(1);
    expect(r.byCategory.system).toBe(1);
    expect(r.byCategory["ai-chat"]).toBe(1);
    expect(r.byCategory.other).toBe(1);
    expect(r.total).toBe(11);
  });

  it("groups events by adapter (one per seed)", () => {
    seedMixedCategories(vault);
    const r = vault.facetCounts({});
    expect(r.byAdapter.wechat).toBe(1);
    expect(r.byAdapter["social-bilibili"]).toBe(1);
    expect(r.byAdapter["alipay-bill"]).toBe(1);
  });

  it("groups events by subtype", () => {
    seedMixedCategories(vault);
    const r = vault.facetCounts({});
    expect(r.bySubtype["message"]).toBe(3); // wechat + qq + email-imap-qq (all "message" subtype)
    expect(r.bySubtype["order"]).toBe(1);
  });

  it("respects since/until + keyword filters", () => {
    seedMixedCategories(vault, 1700000000000);
    const r = vault.facetCounts({ since: 1700000005000 });
    expect(r.total).toBeLessThan(11);
    expect(r.total).toBeGreaterThan(0);
  });
});

// ─── Trigger sync — putEvent / delete / update propagates to events_fts ──

describe("events_fts triggers (FTS5 mode only)", () => {
  beforeEach(() => freshVault());

  it("new putEvent becomes findable via FTS5 immediately", () => {
    if (vault.ftsMode() !== "fts5") return;
    vault.putEvent(
      eventOk({
        id: "trigger-test-001",
        content: { text: "蛋白粉到货了" },
        source: source("shopping-jd"),
      })
    );
    const r = vault.searchEvents({ q: "蛋白粉" });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe("trigger-test-001");
  });

  it("UPDATE to event re-indexes the new content", () => {
    if (vault.ftsMode() !== "fts5") return;
    const id = "trigger-test-002";
    vault.putEvent(
      eventOk({ id, content: { text: "原始文本" }, source: source("wechat") })
    );
    // Searching for new keyword first → 0 hits
    expect(vault.searchEvents({ q: "更新后" }).rows.length).toBe(0);
    // Update the same event (UPSERT via putEvent uses ON CONFLICT)
    vault.putEvent(
      eventOk({
        id,
        content: { text: "更新后的新内容" },
        source: source("wechat"),
      })
    );
    expect(vault.searchEvents({ q: "更新后" }).rows.length).toBe(1);
    // Old text no longer findable
    expect(vault.searchEvents({ q: "原始文本" }).rows.length).toBe(0);
  });

  it("DELETE removes event from FTS5 index", () => {
    if (vault.ftsMode() !== "fts5") return;
    const id = "trigger-test-003";
    vault.putEvent(
      eventOk({ id, content: { text: "待删除" }, source: source("wechat") })
    );
    expect(vault.searchEvents({ q: "待删除" }).rows.length).toBe(1);
    vault.db.prepare("DELETE FROM events WHERE id = ?").run(id);
    expect(vault.searchEvents({ q: "待删除" }).rows.length).toBe(0);
  });
});
