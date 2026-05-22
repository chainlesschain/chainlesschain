"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  JdAdapter,
  SNAPSHOT_SCHEMA_VERSION: JD_VERSION,
} = require("../lib/adapters/shopping-jd");
const {
  MeituanAdapter,
  SNAPSHOT_SCHEMA_VERSION: MT_VERSION,
} = require("../lib/adapters/shopping-meituan");
const { validateBatch } = require("../lib/batch");

// §2.4b 购物双联 v0.2 — snapshot-mode tests, mirror of social-weibo-snapshot
// & travel-maps-snapshot patterns.
//
// Snapshot mode is in-APK Android cc reading JSON written by Jd/Meituan
// LocalCollector (WebView cookie scrape + OkHttp fetch order list). Cookie-
// mode tests stay in legacy shopping-adapters tests.

function writeSnapshot(dir, fileName, snapshot) {
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("JdAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jd-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1", () => {
    expect(JD_VERSION).toBe(1);
  });

  it("constructor allows missing account (stateless snapshot mode)", () => {
    expect(() => new JdAdapter()).not.toThrow();
    expect(() => new JdAdapter({})).not.toThrow();
  });

  it("authenticate(inputPath) ok + mode=snapshot-file", async () => {
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new JdAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new JdAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor account returns NO_INPUT", async () => {
    const a = new JdAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new JdAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("rejects non-JSON snapshot (v0.3 will add HTML parsing)", async () => {
    const p = path.join(tmpDir, "shopping-jd.html");
    fs.writeFileSync(p, "<!DOCTYPE html><html><body>not json</body></html>", "utf-8");
    const a = new JdAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/must be JSON.*v0\.3.*HTML/);
  });

  it("empty events array yields nothing", async () => {
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new JdAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("order kind round-trip normalize cleanly + namespaced originalId", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "jd",
      account: { pin: "alice_pin", displayName: "alice" },
      events: [
        {
          kind: "order",
          id: "order-J1",
          capturedAt: now - 1000,
          orderId: "JD200001",
          merchantName: "京东自营",
          items: [
            { name: "AirPods Pro 2", quantity: 1, unitPrice: 1899, sku: "100012345" },
          ],
          placedAt: now - 86400_000,
          paidAt: now - 86300_000,
          status: "delivered",
          totalAmount: { value: 1899, currency: "CNY" },
          recipient: "alice",
          shippingAddress: "厦门市象屿路 93 号",
        },
      ],
    });
    const a = new JdAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
    expect(raws[0].originalId).toMatch(/^jd:order:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // OrderRecord → events[0] = "purchase" subtype with merchant 京东自营 / amount 1899
    expect(batch.events.length).toBe(1);
    const merchantPerson = batch.persons.find((p) => p.names && p.names.includes("京东自营"));
    expect(merchantPerson).toBeTruthy();
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "order",
      id: `order-J${i}`,
      capturedAt: now - i * 100,
      orderId: `JD${i}`,
      merchantName: "京东自营",
      items: [],
      placedAt: now - i * 100,
      status: "delivered",
      totalAmount: { value: 100, currency: "CNY" },
    }));
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events,
    });
    const a = new JdAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "order",
          id: "order-J1",
          capturedAt: now,
          orderId: "JD1",
          merchantName: "京东",
          items: [],
          totalAmount: { value: 0, currency: "CNY" },
        },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "review", id: "rev1", capturedAt: now }, // hypothetical future
      ],
    });
    const a = new JdAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
  });

  it("snapshottedAt fallback when event capturedAt+placedAt+paidAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, "shopping-jd.json", {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        {
          kind: "order",
          id: "order-J1",
          orderId: "JD1",
          merchantName: "京东",
          items: [],
          status: "placed",
          totalAmount: { value: 0, currency: "CNY" },
        },
      ],
    });
    const a = new JdAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("sync() without inputPath OR cookies throws", async () => {
    const a = new JdAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/needs opts\.inputPath/);
  });

  it("legacy cookie mode still works (regression guard)", async () => {
    const a = new JdAdapter({
      account: { pin: "alice", cookies: "pt_key=abc; pt_pin=alice" },
      fetchFn: async () => ({
        orders: [
          {
            orderId: "JD-LEGACY-1",
            venderName: "京东自营",
            orderStartTime: "2026-05-22 10:00:00",
            orderTotalPrice: 99,
            productList: [
              { productName: "test", productQuantity: 1, productPrice: 99 },
            ],
            orderStatusText: "已完成",
          },
        ],
      }),
    });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.length).toBeGreaterThanOrEqual(1);
    expect(raws[0].originalId).toBe("JD-LEGACY-1");
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
  });
});

describe("MeituanAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meituan-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1", () => {
    expect(MT_VERSION).toBe(1);
  });

  it("constructor allows missing account (stateless snapshot mode)", () => {
    expect(() => new MeituanAdapter()).not.toThrow();
    expect(() => new MeituanAdapter({})).not.toThrow();
  });

  it("authenticate(inputPath) ok", async () => {
    const p = writeSnapshot(tmpDir, "shopping-meituan.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new MeituanAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, "shopping-meituan.json", {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new MeituanAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("rejects non-JSON snapshot (HTML defer to v0.3)", async () => {
    const p = path.join(tmpDir, "shopping-meituan.html");
    fs.writeFileSync(p, "<html>not json</html>", "utf-8");
    const a = new MeituanAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/must be JSON.*v0\.3.*HTML/);
  });

  it("order round-trip normalize with carrier=美团 (waimai platform)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "shopping-meituan.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "meituan",
      account: { userId: "alice_uid", displayName: "alice" },
      events: [
        {
          kind: "order",
          id: "order-MT1",
          capturedAt: now - 1000,
          orderId: "MT200001",
          merchantName: "肯德基(厦门集美店)",
          platform: "waimai",
          items: [
            { name: "黄金鸡块 5 块", quantity: 1, unitPrice: 15.5 },
            { name: "雪顶咖啡", quantity: 1, unitPrice: 16 },
          ],
          placedAt: now - 86400_000,
          paidAt: now - 86300_000,
          status: "delivered",
          totalAmount: { value: 31.5, currency: "CNY" },
          recipient: "alice",
          shippingAddress: "厦门市集美区某街道",
        },
      ],
    });
    const a = new MeituanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toMatch(/^meituan:order:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // Merchant is per-POI in waimai (not generic "美团")
    const merchant = batch.persons.find((p) => p.names && p.names.includes("肯德基(厦门集美店)"));
    expect(merchant).toBeTruthy();
  });

  it("filters unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "shopping-meituan.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "order",
          id: "order-MT1",
          capturedAt: now,
          orderId: "MT1",
          merchantName: "测试餐厅",
          items: [],
          status: "placed",
          totalAmount: { value: 0, currency: "CNY" },
        },
        { kind: "speculative-coupon", id: "c1", capturedAt: now },
      ],
    });
    const a = new MeituanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
  });

  it("snapshottedAt fallback when no timestamps in event", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, "shopping-meituan.json", {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        {
          kind: "order",
          id: "order-MT1",
          orderId: "MT1",
          merchantName: "test",
          items: [],
          status: "placed",
          totalAmount: { value: 0, currency: "CNY" },
        },
      ],
    });
    const a = new MeituanAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("legacy cookie mode still works (regression guard)", async () => {
    const a = new MeituanAdapter({
      account: { userId: "alice", cookies: "iuuid=abc" },
      fetchFn: async () => ({
        orders: [
          {
            orderId: "MT-LEGACY-1",
            poiName: "测试餐厅",
            orderTime: "2026-05-22 12:00:00",
            totalPrice: 50,
            dishes: [{ name: "测试菜", quantity: 1, price: 50 }],
            statusDesc: "已完成",
          },
        ],
      }),
    });
    const raws = [];
    for await (const r of a.sync({})) raws.push(r);
    expect(raws.length).toBeGreaterThanOrEqual(1);
    expect(raws[0].originalId).toBe("MT-LEGACY-1");
  });
});
