"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { newId } = require("../lib/ids");
const { generateKeyHex } = require("../lib/key-providers");
const { LocalVault } = require("../lib/vault");

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
    expect(vault.schemaVersion()).toBe(2);
    expect(fs.existsSync(vaultPath)).toBe(true);
  });

  it("is idempotent: re-open same vault with same key works", () => {
    freshVault();
    const p = vault.putPerson(personOk());
    expect(p.changes).toBe(1);
    vault.close();

    const reopen = new LocalVault({ path: vaultPath, key, skipAudit: true });
    reopen.open();
    expect(reopen.schemaVersion()).toBe(2);
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
    expect(s.schemaVersion).toBe(2);
    expect(s.events).toBe(3);
    expect(s.persons).toBe(1);
    expect(s.places).toBe(2);
    expect(s.items).toBe(0);
    expect(s.topics).toBe(0);
    expect(s.rawEvents).toBe(1);
    expect(s.auditLog).toBeGreaterThanOrEqual(1);
  });
});
