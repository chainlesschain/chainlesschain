"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  VipshopAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  orderToRecord,
  extractOrders,
} = require("../lib/adapters/shopping-vipshop");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// 唯品会 (VIP.com) — flash-sale e-commerce; mirrors shopping-eleme (snapshot +
// cookie-api, 元 amounts). VIP signing is injected (signProvider) so the adapter
// stays pure-Node.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "shopping-vipshop.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

function writeRaw(dir, fileName, content) {
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

describe("VipshopAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vip-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 and VALID_SNAPSHOT_KINDS = [order]", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["order"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new VipshopAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new VipshopAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with no inputPath returns NO_INPUT", async () => {
    const a = new VipshopAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
    expect(res.message).toMatch(/snapshot mode/);
  });

  it("sync() without inputPath throws with signing hint", async () => {
    const a = new VipshopAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/signProvider/);
  });

  it("rejects non-JSON inputPath", async () => {
    const p = writeRaw(tmpDir, "orders.html", "<html>not json</html>");
    const a = new VipshopAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/snapshot must be JSON/);
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 99, snapshottedAt: Date.now(), events: [] });
    const a = new VipshopAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("empty events array yields nothing (no crash)", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("order event round-trips normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "vipshop",
      account: { userId: "u-alice", displayName: "alice" },
      events: [
        {
          kind: "order",
          id: "order-VIP-9001",
          capturedAt: now - 1000,
          orderId: "VIP-9001",
          merchantName: "雅诗兰黛官方旗舰",
          placedAt: now - 86400_000,
          paidAt: now - 86400_000 + 5_000,
          status: "已收货",
          items: [
            { name: "小棕瓶精华 50ml", quantity: 1, unitPrice: 680.0 },
            { name: "面膜 5片装", quantity: 2, unitPrice: 99.0 },
          ],
          totalAmount: { value: 878.0, currency: "CNY" },
          recipient: "张三",
          shippingAddress: "上海市浦东新区...",
        },
      ],
    });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toBe("vipshop:order:order-VIP-9001");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(batch)).toContain("小棕瓶精华 50ml");
    expect(JSON.stringify(batch)).toContain("张三");
    expect(JSON.stringify(batch)).toContain("delivered");
  });

  it("status mapping handles vip-typical strings", async () => {
    const now = Date.now();
    const cases = [
      { status: "已发货", expect: "shipped" },
      { status: "待收货", expect: "shipped" },
      { status: "已收货", expect: "delivered" },
      { status: "交易成功", expect: "delivered" },
      { status: "退款成功", expect: "refunded" },
      { status: "已取消", expect: "cancelled" },
      { status: "待付款", expect: "placed" },
    ];
    for (const c of cases) {
      const p = writeSnapshot(tmpDir, {
        schemaVersion: 1,
        snapshottedAt: now,
        events: [
          { kind: "order", id: `o-${c.status}`, orderId: `o-${c.status}`, merchantName: "m",
            placedAt: now, paidAt: now, status: c.status,
            items: [{ name: "x", quantity: 1, unitPrice: 1 }],
            totalAmount: { value: 1, currency: "CNY" } },
        ],
      });
      const a = new VipshopAdapter();
      const raws = [];
      for await (const r of a.sync({ inputPath: p })) raws.push(r);
      const batch = a.normalize(raws[0]);
      expect(JSON.stringify(batch)).toContain(c.expect);
    }
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", placedAt: now,
          items: [], totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { order: false } })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "order", id: `o${i}`, orderId: `o${i}`, merchantName: "m",
      placedAt: now - i * 1000, items: [], totalAmount: { value: 1, currency: "CNY" },
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", placedAt: now,
          items: [], totalAmount: { value: 1, currency: "CNY" } },
        { kind: "browse", id: "b1" },
        { kind: "future-kind", id: "x" },
      ],
    });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", items: [],
          totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new VipshopAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("advertises both snapshot and cookie-api capabilities", () => {
    const a = new VipshopAdapter();
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:cookie-api");
    expect(assertAdapter(a).ok).toBe(true);
  });
});

describe("VipshopAdapter cookie-api mode", () => {
  it("authenticate(cookie) ok when userId + cookies present", async () => {
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("cookie");
    expect(res.account).toBe("u-1");
  });

  it("authenticate(cookie) requires account.userId", async () => {
    const a = new VipshopAdapter({ account: { cookies: "vip_access_token=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_USER_ID");
  });

  it("sync yields normalized records from fetchFn fixture (元)", async () => {
    const fetchFn = async () => ({
      data: {
        orders: [
          {
            order_sn: "VIP-COOKIE-1",
            brand_name: "Nike 官方",
            order_status_name: "已收货",
            money: 499.0,
            add_time: 1700000000, // sec
            pay_time: 1700000010,
            consignee: "李四",
            address: "广州市天河区...",
            goods_list: [
              { goods_name: "运动鞋", goods_num: 1, vipshop_price: 499.0, size_id: "42" },
            ],
          },
        ],
      },
    });
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 0 })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toBe("VIP-COOKIE-1");
    expect(raws[0].payload.record.merchantName).toBe("Nike 官方");
    expect(raws[0].payload.record.totalAmount.value).toBe(499.0);
    expect(raws[0].payload.record.items[0].unitPrice).toBe(499.0);
    expect(raws[0].payload.record.status).toBe("delivered");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(JSON.stringify(batch)).toContain("运动鞋");
    expect(JSON.stringify(batch)).toContain("李四");
  });

  it("invokes signProvider and passes sign to fetchFn", async () => {
    let seenSign = null;
    const signProvider = async () => "SIGN-XYZ";
    const fetchFn = async (opts) => {
      seenSign = opts.sign;
      return { orders: [] };
    };
    const a = new VipshopAdapter({
      account: { userId: "u-1", cookies: "vip_access_token=ok" },
      fetchFn,
      signProvider,
    });
    for await (const _r of a.sync({ sinceWatermark: 0 })) { /* drain */ }
    expect(seenSign).toBe("SIGN-XYZ");
  });

  it("passes sign: null when no signProvider configured", async () => {
    let seen = "unset";
    const fetchFn = async (opts) => {
      seen = opts.sign;
      return { orders: [] };
    };
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" }, fetchFn });
    for await (const _r of a.sync({ sinceWatermark: 0 })) { /* drain */ }
    expect(seen).toBe(null);
  });

  it("paginates and stops at sinceWatermark", async () => {
    const pages = {
      1: [
        { order_sn: "p1-a", brand_name: "m", add_time: 1700000000, money: 10, goods_list: [] },
        { order_sn: "p1-b", brand_name: "m", add_time: 1699000000, money: 10, goods_list: [] },
      ],
      2: [{ order_sn: "p2-a", brand_name: "m", add_time: 1698000000, money: 10, goods_list: [] }],
    };
    const seenPages = [];
    const fetchFn = async (opts) => {
      seenPages.push(opts.query.page);
      return { orders: pages[opts.query.page] || [] };
    };
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 1699500000 * 1000, pageSize: 2 })) {
      raws.push(r);
    }
    expect(raws.map((r) => r.originalId)).toEqual(["p1-a"]);
    expect(seenPages).toEqual([1]);
  });

  it("respects per-kind include opt-out in cookie mode (no fetch)", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return { orders: [] };
    };
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ include: { order: false } })) raws.push(r);
    expect(raws.length).toBe(0);
    expect(called).toBe(false);
  });

  it("orderToRecord maps vip fields (元 amounts, brand as merchant)", () => {
    const rec = orderToRecord({
      order_sn: "VIP-9",
      brand_name: "兰蔻",
      order_status_name: "已完成",
      money: 320.0,
      add_time: 1700000000,
      goods_list: [{ goods_name: "粉底液", goods_num: 1, vipshop_price: 320.0 }],
    });
    expect(rec.orderId).toBe("VIP-9");
    expect(rec.merchantName).toBe("兰蔻");
    expect(rec.status).toBe("delivered");
    expect(rec.totalAmount.value).toBe(320.0);
    expect(rec.items[0].name).toBe("粉底液");
    expect(rec.extras.capturedBy).toBe("cookie-api");
  });

  it("extractOrders tolerates nested response shapes", () => {
    expect(extractOrders({ orders: [1] })).toEqual([1]);
    expect(extractOrders({ orderList: [2] })).toEqual([2]);
    expect(extractOrders({ data: { orders: [3] } })).toEqual([3]);
    expect(extractOrders({ data: { orderList: [4] } })).toEqual([4]);
    expect(extractOrders([5])).toEqual([5]);
    expect(extractOrders({})).toEqual([]);
    expect(extractOrders(null)).toEqual([]);
  });

  it("uses opts.ordersUrl override when provided", async () => {
    let seenUrl = null;
    const fetchFn = async (opts) => {
      seenUrl = opts.url;
      return { orders: [] };
    };
    const a = new VipshopAdapter({
      account: { userId: "u-1", cookies: "vip_access_token=ok" },
      fetchFn,
      ordersUrl: "https://custom.example/orders",
    });
    for await (const _r of a.sync({ sinceWatermark: 0 })) { /* drain */ }
    expect(seenUrl).toBe("https://custom.example/orders");
  });

  it("default fetchFn throws a legible error when cookie mode used without injection", async () => {
    const a = new VipshopAdapter({ account: { userId: "u-1", cookies: "vip_access_token=ok" } });
    let threw = null;
    try {
      for await (const _r of a.sync({ sinceWatermark: 0 })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/no fetchFn configured/);
  });
});
