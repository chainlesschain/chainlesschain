"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { newId } = require("../lib/ids");
const { generateKeyHex } = require("../lib/key-providers");
const { LocalVault } = require("../lib/vault");
const { TARGET_VERSION } = require("../lib/migrations");

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ts = () => Date.now();

const source = (overrides = {}) => ({
  adapter: "test",
  adapterVersion: "0.1.0",
  capturedAt: ts(),
  capturedBy: "manual",
  ...overrides,
});

const eventOk = (overrides = {}) => ({
  id: newId(),
  type: "event",
  subtype: "message",
  occurredAt: ts(),
  ingestedAt: ts(),
  content: { text: "Hello" },
  source: source(),
  ...overrides,
});

const personOk = (overrides = {}) => ({
  id: newId(),
  type: "person",
  subtype: "contact",
  names: ["妈妈"],
  ingestedAt: ts(),
  source: source(),
  ...overrides,
});

const placeOk = (overrides = {}) => ({
  id: newId(),
  type: "place",
  name: "妈妈家",
  aliases: ["home", "妈家"],
  ingestedAt: ts(),
  source: source(),
  ...overrides,
});

const itemOk = (overrides = {}) => ({
  id: newId(),
  type: "item",
  subtype: "product",
  name: "蛋白粉",
  ingestedAt: ts(),
  source: source(),
  ...overrides,
});

const topicOk = (overrides = {}) => ({
  id: newId(),
  type: "topic",
  name: "母亲健康",
  ingestedAt: ts(),
  source: source(),
  ...overrides,
});

// ─── Test scaffolding ─────────────────────────────────────────────────────

let tmpDir;
let vaultPath;
let vault;
let key;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-vault-"));
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

// ─── open / migrations ────────────────────────────────────────────────────

describe("LocalVault open + migrations", () => {
  it("opens a fresh vault and runs initial migrations", () => {
    freshVault();
    expect(vault.schemaVersion()).toBe(TARGET_VERSION);
    expect(fs.existsSync(vaultPath)).toBe(true);
  });

  it("is idempotent: re-open same vault with same key works", () => {
    freshVault();
    const p = vault.putPerson(personOk());
    expect(p.changes).toBe(1);
    vault.close();

    const reopen = new LocalVault({ path: vaultPath, key, skipAudit: true });
    reopen.open();
    expect(reopen.schemaVersion()).toBe(TARGET_VERSION);
    expect(reopen.stats().persons).toBe(1);
    reopen.close();
  });

  it("rejects open with wrong key", () => {
    freshVault();
    vault.close();

    const wrongKey = generateKeyHex();
    const bad = new LocalVault({ path: vaultPath, key: wrongKey, skipAudit: true });
    expect(() => bad.open()).toThrow(/decryption failed/);
  });

  it("rejects construction with invalid key", () => {
    expect(() => new LocalVault({ path: "/tmp/x.db", key: "tooshort" })).toThrow(/hex/);
    expect(() => new LocalVault({ path: "/tmp/x.db" })).toThrow(/key/);
    expect(() => new LocalVault({})).toThrow(/path/);
  });

  it("opens unencrypted-rejection: file without key cannot be read with wrong key", () => {
    freshVault();
    vault.putEvent(eventOk());
    vault.close();

    const wrong = new LocalVault({ path: vaultPath, key: generateKeyHex(), skipAudit: true });
    expect(() => wrong.open()).toThrow();
  });

  // ── 2026-05-24 trap #25 — partial-index residue from `IF NOT EXISTS` ─────
  // Older vaults (pre commit 44c4188a8) may have full unique indices on
  // uniq_{events,persons,places,items}_source without the WHERE clause.
  // Migration v4 explicitly DROPs + CREATEs to force partial index, fixing
  // the "2nd ON CONFLICT clause does not match" SQLite error that silently
  // breaks adapter.sync.putEvent path.
  it("migration v4 recreates uniq_*_source as partial indices (WHERE NOT NULL)", () => {
    freshVault();
    const tables = ["events", "persons", "places", "items"];
    for (const t of tables) {
      const row = vault.db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name=?`)
        .get(`uniq_${t}_source`);
      expect(row, `index uniq_${t}_source must exist on fresh vault`).toBeTruthy();
      expect(
        row.sql,
        `uniq_${t}_source must include WHERE source_original_id IS NOT NULL`
      ).toContain("source_original_id IS NOT NULL");
    }
  });

  it("migration v4 fixes pre-existing FULL unique indices (simulated drift)", () => {
    freshVault();
    const tables = ["events", "persons", "places", "items"];
    for (const t of tables) {
      vault.db.exec(`DROP INDEX uniq_${t}_source`);
      vault.db.exec(
        `CREATE UNIQUE INDEX uniq_${t}_source ON ${t}(source_adapter, source_original_id)`
      );
    }
    vault.db
      .prepare(`UPDATE _meta SET value=?, updated_at=? WHERE key='schema_version'`)
      .run("3", Date.now());
    vault.close();

    const reopen = new LocalVault({ path: vaultPath, key, skipAudit: true });
    reopen.open();
    for (const t of tables) {
      const row = reopen.db
        .prepare(`SELECT sql FROM sqlite_master WHERE name=?`)
        .get(`uniq_${t}_source`);
      expect(
        row.sql,
        `migration v4 must add WHERE clause to uniq_${t}_source`
      ).toContain("source_original_id IS NOT NULL");
    }
    expect(reopen.schemaVersion()).toBe(TARGET_VERSION);
    reopen.close();
  });

  it("putEvent ON CONFLICT WHERE matches after migration v4 (no SQLite parse error)", () => {
    freshVault();
    vault.db.exec(`DROP INDEX uniq_events_source`);
    vault.db.exec(
      `CREATE UNIQUE INDEX uniq_events_source ON events(source_adapter, source_original_id)`
    );
    vault.db
      .prepare(`UPDATE _meta SET value='3' WHERE key='schema_version'`)
      .run();
    vault.close();

    const reopen = new LocalVault({ path: vaultPath, key, skipAudit: true });
    reopen.open();
    const baseSource = source({ originalId: "test:dup:1" });
    expect(() => reopen.putEvent(eventOk({ source: baseSource }))).not.toThrow();
    expect(() =>
      reopen.putEvent(
        eventOk({ source: baseSource, content: { text: "updated" } })
      )
    ).not.toThrow();
    reopen.close();
  });
});

// ─── Entity put/get ───────────────────────────────────────────────────────

describe("LocalVault entity put/get round-trip", () => {
  it("event round-trips with content + extra preserved", () => {
    freshVault();
    const e = eventOk({
      content: { text: "买妈妈生日礼物", title: "淘宝订单", amount: { value: 288.5, currency: "CNY", direction: "out" } },
      extra: { vendor: "taobao", orderId: "T-12345" },
    });
    vault.putEvent(e);
    const got = vault.getEvent(e.id);
    expect(got).not.toBeNull();
    expect(got.id).toBe(e.id);
    expect(got.content.text).toBe("买妈妈生日礼物");
    expect(got.content.amount.value).toBe(288.5);
    expect(got.extra.vendor).toBe("taobao");
  });

  it("person round-trips with identifiers + names array", () => {
    freshVault();
    const p = personOk({
      names: ["妈妈", "陈某某"],
      identifiers: { phone: ["13800001111"], wechatId: "wxid_xyz" },
    });
    vault.putPerson(p);
    const got = vault.getPerson(p.id);
    expect(got.names).toEqual(["妈妈", "陈某某"]);
    expect(got.identifiers.phone).toEqual(["13800001111"]);
  });

  it("place round-trips with coordinates + aliases", () => {
    freshVault();
    const pl = placeOk({
      coordinates: { lat: 24.4798, lng: 118.0894 },
      address: "厦门思明区 XX 路 88 号",
      aliases: ["home", "妈家"],
    });
    vault.putPlace(pl);
    const got = vault.getPlace(pl.id);
    expect(got.coordinates).toEqual({ lat: 24.4798, lng: 118.0894 });
    expect(got.aliases).toEqual(["home", "妈家"]);
  });

  it("item round-trips with price object", () => {
    freshVault();
    const it = itemOk({ price: { value: 288.5, currency: "CNY" }, merchant: "person-taobao" });
    vault.putItem(it);
    const got = vault.getItem(it.id);
    expect(got.price).toEqual({ value: 288.5, currency: "CNY" });
    expect(got.merchant).toBe("person-taobao");
  });

  it("topic round-trips with parent + derivedFromEvents", () => {
    freshVault();
    const eId = newId();
    const t = topicOk({ parentTopic: "topic-family", derivedFromEvents: [eId] });
    vault.putTopic(t);
    const got = vault.getTopic(t.id);
    expect(got.parentTopic).toBe("topic-family");
    expect(got.derivedFromEvents).toEqual([eId]);
  });

  it("put with invalid entity throws (validators gate the vault)", () => {
    freshVault();
    expect(() => vault.putEvent({ id: "x", type: "event" })).toThrow(/invalid event/);
    expect(() => vault.putPerson({ id: "x", type: "person", subtype: "alien", names: [] })).toThrow(
      /invalid person/
    );
  });

  it("get returns null for unknown id", () => {
    freshVault();
    expect(vault.getEvent(newId())).toBeNull();
    expect(vault.getPerson(newId())).toBeNull();
    expect(vault.getPlace(newId())).toBeNull();
  });

  it("upsert: re-putting same id overwrites", () => {
    freshVault();
    const id = newId();
    vault.putEvent(eventOk({ id, content: { text: "v1" } }));
    vault.putEvent(eventOk({ id, content: { text: "v2" } }));
    expect(vault.getEvent(id).content.text).toBe("v2");
    expect(vault.stats().events).toBe(1);
  });
});

// ─── putBatch (transactional) ─────────────────────────────────────────────

describe("LocalVault.putBatch", () => {
  it("commits all entities in a single transaction", () => {
    freshVault();
    const batch = {
      events: [eventOk(), eventOk()],
      persons: [personOk(), personOk(), personOk()],
      places: [placeOk()],
      items: [],
      topics: [topicOk()],
    };
    const counts = vault.putBatch(batch);
    expect(counts).toEqual({ events: 2, persons: 3, places: 1, items: 0, topics: 1 });
    expect(vault.stats().events).toBe(2);
    expect(vault.stats().persons).toBe(3);
  });

  it("rolls back on any invalid entity (atomicity)", () => {
    freshVault();
    const before = vault.stats();
    expect(() =>
      vault.putBatch({
        events: [eventOk(), { id: "bad", type: "event" /* invalid */ }],
        persons: [],
      })
    ).toThrow(/invalid event/);
    const after = vault.stats();
    expect(after.events).toBe(before.events); // no partial commit
  });

  it("findBySource locates a row by (adapter, originalId)", () => {
    freshVault();
    const e = eventOk({ source: source({ originalId: "msg-42" }) });
    vault.putEvent(e);
    const found = vault.findBySource("events", "test", "msg-42");
    expect(found).not.toBeNull();
    expect(found.id).toBe(e.id);
    expect(vault.findBySource("events", "test", "no-such")).toBeNull();
  });
});

// ─── raw_events ──────────────────────────────────────────────────────────

describe("LocalVault.putRawEvent", () => {
  it("stores and replaces by (adapter, originalId)", () => {
    freshVault();
    vault.putRawEvent({
      adapter: "email-imap",
      originalId: "<msg-1@example.com>",
      capturedAt: ts(),
      payload: { from: "a@b.c", subject: "v1" },
    });
    vault.putRawEvent({
      adapter: "email-imap",
      originalId: "<msg-1@example.com>",
      capturedAt: ts(),
      payload: { from: "a@b.c", subject: "v2" },
    });
    expect(vault.stats().rawEvents).toBe(1); // dedup, not duplicate
  });

  it("validates required fields", () => {
    freshVault();
    expect(() =>
      vault.putRawEvent({ adapter: "", originalId: "x", capturedAt: ts(), payload: {} })
    ).toThrow(/adapter/);
    expect(() =>
      vault.putRawEvent({ adapter: "a", originalId: "", capturedAt: ts(), payload: {} })
    ).toThrow(/originalId/);
    expect(() =>
      vault.putRawEvent({ adapter: "a", originalId: "x", capturedAt: 0, payload: {} })
    ).toThrow(/capturedAt/);
  });
});

// ─── queryEvents / countEvents ───────────────────────────────────────────

describe("LocalVault.queryEvents + countEvents", () => {
  it("filters by subtype + time window, ordered by occurred_at DESC", () => {
    freshVault();
    const t0 = ts() - 1_000_000;
    vault.putEvent(eventOk({ subtype: "order", occurredAt: t0 + 1000 }));
    vault.putEvent(eventOk({ subtype: "order", occurredAt: t0 + 5000 }));
    vault.putEvent(eventOk({ subtype: "message", occurredAt: t0 + 3000 }));

    const orders = vault.queryEvents({ subtype: "order", since: t0 });
    expect(orders.length).toBe(2);
    expect(orders[0].occurredAt).toBe(t0 + 5000); // newest first
    expect(orders[1].occurredAt).toBe(t0 + 1000);

    expect(vault.countEvents({ subtype: "order" })).toBe(2);
    expect(vault.countEvents({ subtype: "message" })).toBe(1);
  });

  it("filters by adapter", () => {
    freshVault();
    vault.putEvent(eventOk({ source: source({ adapter: "alipay" }) }));
    vault.putEvent(eventOk({ source: source({ adapter: "alipay" }) }));
    vault.putEvent(eventOk({ source: source({ adapter: "wechat" }) }));
    expect(vault.queryEvents({ adapter: "alipay" }).length).toBe(2);
    expect(vault.queryEvents({ adapter: "wechat" }).length).toBe(1);
  });

  it("limit + offset paginate correctly", () => {
    freshVault();
    const t0 = ts() - 1_000_000;
    for (let i = 0; i < 5; i++) {
      vault.putEvent(eventOk({ subtype: "message", occurredAt: t0 + i * 1000 }));
    }
    const page1 = vault.queryEvents({ limit: 2, offset: 0 });
    const page2 = vault.queryEvents({ limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].occurredAt).toBeGreaterThan(page2[0].occurredAt);
  });
});

// ─── searchPersons (LIKE name search) ────────────────────────────────────
//
// 2026-05-27 — AnalysisEngine entityFocus="persons" routes to searchPersons
// when the question carries a name candidate ("妈手机号", "张三的电话").
// LIKE on names / identifiers / notes / relation, no FTS5 migration.

describe("LocalVault.searchPersons", () => {
  it("matches against names column (JSON-serialized array)", () => {
    freshVault();
    vault.putPerson(personOk({ names: ["妈妈", "陈某某"] }));
    vault.putPerson(personOk({ names: ["张三"] }));
    vault.putPerson(personOk({ names: ["王医生"] }));

    const r = vault.searchPersons({ q: "妈" });
    expect(r.length).toBe(1);
    expect(r[0].names).toContain("妈妈");
  });

  it("matches against identifiers (phone numbers)", () => {
    freshVault();
    vault.putPerson(personOk({
      names: ["张三"],
      identifiers: { phone: ["13800001111"] },
    }));
    vault.putPerson(personOk({
      names: ["李四"],
      identifiers: { phone: ["13900002222"] },
    }));

    const r = vault.searchPersons({ q: "13800" });
    expect(r.length).toBe(1);
    expect(r[0].names).toContain("张三");
  });

  it("matches against notes + relation", () => {
    freshVault();
    vault.putPerson(personOk({
      names: ["陈某某"], relation: "母亲", notes: "best mom ever",
    }));
    vault.putPerson(personOk({ names: ["路人甲"], relation: "stranger" }));

    expect(vault.searchPersons({ q: "母亲" }).length).toBe(1);
    expect(vault.searchPersons({ q: "best mom" }).length).toBe(1);
  });

  it("empty q delegates to queryPersons (ingest-ordered)", () => {
    freshVault();
    vault.putPerson(personOk({ names: ["A"] }));
    vault.putPerson(personOk({ names: ["B"] }));
    vault.putPerson(personOk({ names: ["C"] }));

    const r = vault.searchPersons({ q: "", limit: 2 });
    expect(r.length).toBe(2);
  });

  it("LIKE meta-characters in user input are escaped (no wildcard injection)", () => {
    freshVault();
    vault.putPerson(personOk({ names: ["100%棉"] }));
    vault.putPerson(personOk({ names: ["AAA"] }));

    // "100%" should match only the literal "100%棉" row, not everything.
    const r = vault.searchPersons({ q: "100%" });
    expect(r.length).toBe(1);
    expect(r[0].names).toContain("100%棉");
  });

  it("respects subtype + adapter filters", () => {
    freshVault();
    vault.putPerson(personOk({
      subtype: "contact", names: ["张三"],
      source: source({ adapter: "wechat" }),
    }));
    vault.putPerson(personOk({
      subtype: "merchant", names: ["张三"],
      source: source({ adapter: "system-data-android" }),
    }));

    expect(vault.searchPersons({ q: "张三", subtype: "merchant" }).length).toBe(1);
    expect(vault.searchPersons({ q: "张三", adapter: "wechat" }).length).toBe(1);
  });

  it("returns empty array when no match", () => {
    freshVault();
    vault.putPerson(personOk({ names: ["张三"] }));
    expect(vault.searchPersons({ q: "完全不存在的名字" })).toEqual([]);
  });
});

// ─── sync watermarks ──────────────────────────────────────────────────────

describe("LocalVault sync watermarks", () => {
  it("get returns null for missing adapter", () => {
    freshVault();
    expect(vault.getWatermark("never-synced")).toBeNull();
  });

  it("set then get round-trips", () => {
    freshVault();
    vault.setWatermark("email-imap", "INBOX", {
      watermark: "12345",
      lastSyncedAt: 1700000000000,
      lastStatus: "ok",
    });
    const got = vault.getWatermark("email-imap", "INBOX");
    expect(got.adapter).toBe("email-imap");
    expect(got.scope).toBe("INBOX");
    expect(got.watermark).toBe("12345");
    expect(got.last_synced_at).toBe(1700000000000);
    expect(got.last_status).toBe("ok");
  });

  it("scope defaults to empty string", () => {
    freshVault();
    vault.setWatermark("alipay", "", { watermark: "2026-04" });
    expect(vault.getWatermark("alipay").watermark).toBe("2026-04");
    expect(vault.getWatermark("alipay", "").watermark).toBe("2026-04");
  });

  it("overwrites on duplicate (adapter, scope)", () => {
    freshVault();
    vault.setWatermark("a", "s", { watermark: "v1" });
    vault.setWatermark("a", "s", { watermark: "v2", lastStatus: "ok" });
    expect(vault.getWatermark("a", "s").watermark).toBe("v2");
  });
});

// ─── audit log ────────────────────────────────────────────────────────────

describe("LocalVault audit_log", () => {
  it("appends audit rows", () => {
    freshVault();
    vault.audit("test.event", "target-1", { foo: "bar" });
    vault.audit("test.event", "target-2");
    const rows = vault.queryAudit({ action: "test.event" });
    expect(rows.length).toBe(2);
    expect(JSON.parse(rows.find((r) => r.target === "target-1").details).foo).toBe("bar");
  });

  it("filters by since + sorts DESC", () => {
    freshVault();
    vault.audit("a"); // older
    const middle = Date.now();
    vault.audit("b"); // newer
    const rows = vault.queryAudit({ since: middle });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].action).toBe("b");
  });
});

// ─── key rotation ─────────────────────────────────────────────────────────

describe("LocalVault.rotateKey", () => {
  it("rotates to a new key and old key can no longer decrypt", () => {
    freshVault();
    vault.putEvent(eventOk());
    vault.putPerson(personOk());

    const newKey = generateKeyHex();
    vault.rotateKey(newKey);
    vault.close();

    // Old key should fail.
    const withOldKey = new LocalVault({ path: vaultPath, key, skipAudit: true });
    expect(() => withOldKey.open()).toThrow();

    // New key opens fine and data is intact.
    const withNewKey = new LocalVault({ path: vaultPath, key: newKey, skipAudit: true });
    withNewKey.open();
    expect(withNewKey.stats().events).toBe(1);
    expect(withNewKey.stats().persons).toBe(1);
    withNewKey.close();
  });

  it("refuses to rotate to the same key", () => {
    freshVault();
    expect(() => vault.rotateKey(key)).toThrow(/refusing/);
  });

  it("validates new key shape", () => {
    freshVault();
    expect(() => vault.rotateKey("nope")).toThrow(/hex/);
  });

  it("records vault.key_rotated audit row", () => {
    freshVault();
    vault.rotateKey(generateKeyHex());
    const rows = vault.queryAudit({ action: "vault.key_rotated" });
    expect(rows.length).toBe(1);
  });
});

// ─── destroy ──────────────────────────────────────────────────────────────

describe("LocalVault.destroy", () => {
  it("removes vault file + wal/shm sidecars", () => {
    freshVault();
    vault.putEvent(eventOk()); // forces WAL creation
    vault.destroy();
    expect(fs.existsSync(vaultPath)).toBe(false);
    expect(fs.existsSync(vaultPath + "-wal")).toBe(false);
    expect(fs.existsSync(vaultPath + "-shm")).toBe(false);
  });

  it("is safe to call on an already-closed vault", () => {
    freshVault();
    vault.close();
    expect(() => vault.destroy()).not.toThrow();
  });
});

// ─── stats ────────────────────────────────────────────────────────────────

describe("LocalVault.stats", () => {
  it("reports per-table counts + schema version", () => {
    freshVault();
    vault.putBatch({
      events: [eventOk(), eventOk(), eventOk()],
      persons: [personOk()],
      places: [placeOk(), placeOk()],
      items: [],
      topics: [],
    });
    vault.putRawEvent({
      adapter: "x",
      originalId: "y",
      capturedAt: ts(),
      payload: {},
    });
    vault.audit("hello");

    const s = vault.stats();
    expect(s.schemaVersion).toBe(TARGET_VERSION);
    expect(s.events).toBe(3);
    expect(s.persons).toBe(1);
    expect(s.places).toBe(2);
    expect(s.items).toBe(0);
    expect(s.topics).toBe(0);
    expect(s.rawEvents).toBe(1);
    expect(s.auditLog).toBeGreaterThanOrEqual(1);
  });
});

describe("LocalVault.sumEventAmount", () => {
  // shopping/travel shape: content.amount = { value, currency, direction }
  const shopEvent = (amount, over = {}) =>
    eventOk({
      subtype: "order",
      source: source({ adapter: "shopping-jd" }),
      content: { title: "订单", amount },
      ...over,
    });
  // alipay shape: extra.amountFen (cents) + extra.direction
  const alipayEvent = (amountFen, direction, over = {}) =>
    eventOk({
      subtype: "payment",
      source: source({ adapter: "finance-alipay" }),
      content: { title: "支付" },
      extra: { amountFen, direction },
      ...over,
    });

  it("sums content.amount (shopping/travel) split by direction", () => {
    freshVault();
    vault.putEvent(shopEvent({ value: 100, currency: "CNY", direction: "out" }));
    vault.putEvent(shopEvent({ value: 30, currency: "CNY", direction: "out" }));
    vault.putEvent(shopEvent({ value: 50, currency: "CNY", direction: "in" }));
    const r = vault.sumEventAmount();
    expect(r.count).toBe(3);
    expect(r.byDirection.out).toBe(130);
    expect(r.byDirection.in).toBe(50);
    expect(r.total).toBe(180);
    expect(r.currency).toBe("CNY");
  });

  it("sums extra.amountFen (alipay), converting cents → yuan", () => {
    freshVault();
    vault.putEvent(alipayEvent(12345, "out"));
    vault.putEvent(alipayEvent(5500, "in"));
    const r = vault.sumEventAmount();
    expect(r.count).toBe(2);
    expect(r.byDirection.out).toBe(123.45);
    expect(r.byDirection.in).toBe(55);
  });

  it("excludes events with no extractable amount (messages/visits)", () => {
    freshVault();
    vault.putEvent(eventOk({ subtype: "message", content: { text: "hi" }, source: source({ adapter: "wechat" }) }));
    vault.putEvent(shopEvent({ value: 10, currency: "CNY", direction: "out" }));
    const r = vault.sumEventAmount();
    expect(r.count).toBe(1);
    expect(r.total).toBe(10);
  });

  it("filters by adapter and by time window", () => {
    freshVault();
    vault.putEvent(shopEvent({ value: 10, currency: "CNY", direction: "out" }, { occurredAt: 1000, source: source({ adapter: "shopping-jd" }) }));
    vault.putEvent(shopEvent({ value: 20, currency: "CNY", direction: "out" }, { occurredAt: 5000, source: source({ adapter: "shopping-taobao" }) }));
    expect(vault.sumEventAmount({ adapter: "shopping-jd" }).total).toBe(10);
    expect(vault.sumEventAmount({ since: 2000 }).total).toBe(20);
    expect(vault.sumEventAmount({ until: 2000 }).total).toBe(10);
  });

  it("mixed shapes coexist; per-currency breakdown, NO cross-currency sum", () => {
    freshVault();
    vault.putEvent(shopEvent({ value: 100, currency: "CNY", direction: "out" }));
    vault.putEvent(alipayEvent(20000, "out")); // 200 元 (CNY, alipay shape)
    vault.putEvent(shopEvent({ value: 5, currency: "USD", direction: "out" }));
    const r = vault.sumEventAmount();
    expect(r.count).toBe(3);
    // CNY has 2 events → primary; top-level reports CNY only (NOT 305 cross-sum).
    expect(r.currency).toBe("CNY");
    expect(r.total).toBe(300);
    expect(r.byDirection.out).toBe(300);
    // Full breakdown per currency.
    expect(r.byCurrency.CNY).toEqual({ total: 300, count: 2, byDirection: { out: 300, in: 0 } });
    expect(r.byCurrency.USD).toEqual({ total: 5, count: 1, byDirection: { out: 5, in: 0 } });
  });

  it("single currency → byCurrency has one entry matching top-level", () => {
    freshVault();
    vault.putEvent(shopEvent({ value: 40, currency: "CNY", direction: "out" }));
    vault.putEvent(shopEvent({ value: 10, currency: "CNY", direction: "in" }));
    const r = vault.sumEventAmount();
    expect(Object.keys(r.byCurrency)).toEqual(["CNY"]);
    expect(r.byCurrency.CNY).toEqual({ total: 50, count: 2, byDirection: { out: 40, in: 10 } });
    expect(r.total).toBe(50);
    expect(r.currency).toBe("CNY");
  });

  it("empty vault → zeros, CNY, count 0, empty byCurrency", () => {
    freshVault();
    expect(vault.sumEventAmount()).toEqual({
      total: 0,
      currency: "CNY",
      byCurrency: {},
      count: 0,
      byDirection: { out: 0, in: 0 },
    });
  });
});
