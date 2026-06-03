"use strict";

import { describe, it, expect } from "vitest";

const {
  normalizeOrderRecord,
  CookieAuth,
  TaobaoAdapter,
  JdAdapter,
  MeituanAdapter,
} = require("../lib");
const { orderToRecord: taobaoOrderToRecord, parseTaobaoTime } = require("../lib/adapters/shopping-taobao");
const { orderToRecord: jdOrderToRecord } = require("../lib/adapters/shopping-jd");
const { orderToRecord: meituanOrderToRecord } = require("../lib/adapters/shopping-meituan");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// ─── normalizeOrderRecord ───────────────────────────────────────────────

describe("normalizeOrderRecord", () => {
  it("produces Event + merchant Person + Item entities", () => {
    const rec = {
      vendorId: "taobao",
      orderId: "ORD-1",
      placedAt: 1700000000000,
      paidAt: 1700000010000,
      status: "delivered",
      merchantName: "Apple官方旗舰店",
      totalAmount: { value: 9999, currency: "CNY" },
      items: [
        { name: "iPhone 17 Pro 256GB", quantity: 1, unitPrice: 9999 },
      ],
      recipient: "张三",
      shippingAddress: "上海市某区某路",
      trackingNumber: "SF1234567",
    };
    const b = normalizeOrderRecord(rec, { adapterName: "shopping-taobao", adapterVersion: "0.5.0" });
    expect(b.events).toHaveLength(1);
    expect(b.events[0].subtype).toBe("order");
    expect(b.events[0].content.amount.value).toBe(9999);
    expect(b.events[0].content.amount.direction).toBe("out");
    expect(b.events[0].extra.merchantOrderNumber).toBe("ORD-1"); // cross-source link
    expect(b.events[0].extra.orderStatus).toBe("delivered");
    expect(b.events[0].extra.trackingNumber).toBe("SF1234567");
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].subtype).toBe("merchant");
    expect(b.items).toHaveLength(1);
    expect(b.items[0].name).toBe("iPhone 17 Pro 256GB");
    const v = validateBatch(b);
    expect(v.valid).toBe(true);
  });

  it("refund status maps to refund subtype + amount in", () => {
    const rec = {
      vendorId: "taobao", orderId: "X", placedAt: Date.now(),
      status: "refunded", merchantName: "Test",
      totalAmount: { value: 100, currency: "CNY" },
    };
    const b = normalizeOrderRecord(rec, { adapterName: "shopping-taobao" });
    expect(b.events[0].subtype).toBe("refund");
    expect(b.events[0].content.amount.direction).toBe("in");
  });

  it("cancelled status maps to cancelled subtype", () => {
    const rec = {
      vendorId: "jd", orderId: "X", placedAt: Date.now(),
      status: "已取消", merchantName: "Test",
    };
    const b = normalizeOrderRecord(rec, { adapterName: "shopping-jd" });
    expect(b.events[0].subtype).toBe("cancelled");
  });

  it("requires orderId + merchantName", () => {
    expect(() => normalizeOrderRecord({})).toThrow();
    expect(() => normalizeOrderRecord({ orderId: "x" })).toThrow();
  });
});

// ─── CookieAuth ──────────────────────────────────────────────────────────

describe("CookieAuth", () => {
  it("constructor requires platform", () => {
    expect(() => new CookieAuth({})).toThrow(/platform/);
  });

  it("toHeader returns null for empty", () => {
    const ca = new CookieAuth({ platform: "taobao" });
    expect(ca.toHeader()).toBeNull();
  });

  it("toHeader returns the cookie string when set", () => {
    const ca = new CookieAuth({ platform: "taobao", cookies: "k1=v1; k2=v2" });
    expect(ca.toHeader()).toBe("k1=v1; k2=v2");
  });

  it("getCookieValue reads single cookie", () => {
    const ca = new CookieAuth({ platform: "taobao", cookies: "k1=v1; k2=v%20space" });
    expect(ca.getCookieValue("k1")).toBe("v1");
    expect(ca.getCookieValue("k2")).toBe("v space"); // decoded
    expect(ca.getCookieValue("missing")).toBeNull();
  });

  it("validate returns false for empty", async () => {
    const ca = new CookieAuth({ platform: "taobao" });
    expect(await ca.validate()).toBe(false);
  });

  it("validate uses injected validator", async () => {
    const ca = new CookieAuth({
      platform: "taobao",
      cookies: "k=v",
      validator: async (c) => c.includes("good"),
    });
    expect(await ca.validate()).toBe(false);
    ca.setCookies("good=ok");
    expect(await ca.validate()).toBe(true);
  });
});

// ─── TaobaoAdapter ──────────────────────────────────────────────────────

describe("TaobaoAdapter", () => {
  it("contract conformance", () => {
    const a = new TaobaoAdapter({ account: { userId: "u-1", cookies: "k=v" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.extractMode).toBe("web-api");
  });

  it("orderToRecord maps Taobao fields", () => {
    const o = {
      bizOrderId: "TB-1",
      sellerNick: "Apple官方旗舰店",
      createTime: 1700000000,
      payTime: 1700000010,
      statusText: "已发货",
      actualFee: "9999.00",
      subOrders: [
        { itemTitle: "iPhone 17", buyCount: 1, itemPrice: "9999" },
      ],
      receiverName: "张三",
      fullAddress: "上海...",
    };
    const rec = taobaoOrderToRecord(o);
    expect(rec.orderId).toBe("TB-1");
    expect(rec.merchantName).toBe("Apple官方旗舰店");
    expect(rec.status).toBe("shipped");
    expect(rec.totalAmount.value).toBe(9999);
    expect(rec.items).toHaveLength(1);
    expect(rec.placedAt).toBeGreaterThan(0);
  });

  it("parseTaobaoTime upgrades seconds → ms", () => {
    expect(parseTaobaoTime(1700000000)).toBe(1700000000000);
    expect(parseTaobaoTime(1700000000000)).toBe(1700000000000);
    expect(parseTaobaoTime("2026-04-15T10:00:00Z")).toBeGreaterThan(0);
  });

  it("sync yields raw events from fetchFn fixture", async () => {
    const fetchFn = async () => ({
      orders: [
        {
          bizOrderId: "TB-2", sellerNick: "Test",
          createTime: 1700000000, payTime: 1700000010,
          statusText: "已签收", actualFee: "100",
          subOrders: [{ itemTitle: "Item A", buyCount: 1, itemPrice: "100" }],
        },
      ],
    });
    const a = new TaobaoAdapter({
      account: { userId: "u-1", cookies: "valid=cookie" },
      fetchFn,
    });
    const raws = [];
    for await (const r of a.sync({ pageSize: 20, sinceWatermark: 0 })) raws.push(r);
    expect(raws).toHaveLength(1);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
  });

  it("sync no-ops on invalid cookies", async () => {
    const a = new TaobaoAdapter({ account: { userId: "u-1" } }); // no cookies
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  // §2.4d v0.2 — snapshot mode (mirror shopping-jd/meituan/pinduoduo dual-mode).
  // Android in-APK collector ships JSON snapshot via syncAdapter("shopping-
  // taobao", path); desktop adapter consumes via inputPath.

  it("snapshot mode — no-arg ctor passes contract", () => {
    const a = new TaobaoAdapter();
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:cookie-api"); // both advertised
  });

  it("snapshot mode — authenticate(ctx.inputPath) returns ok when file readable", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taobao-snap-"));
    const inputPath = path.join(dir, "snap.json");
    fs.writeFileSync(inputPath, "{}", "utf-8");
    try {
      const a = new TaobaoAdapter();
      const auth = await a.authenticate({ inputPath });
      expect(auth.ok).toBe(true);
      expect(auth.mode).toBe("snapshot-file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("snapshot mode — sync yields order events from snapshot file", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taobao-snap-yield-"));
    const inputPath = path.join(dir, "snap.json");
    fs.writeFileSync(inputPath, JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_000_000,
      account: { userId: "u-snap" },
      events: [
        {
          kind: "order",
          id: "TB-SNAP-1",
          capturedAt: 1_700_000_100_000,
          vendorId: "taobao",
          orderId: "TB-SNAP-1",
          placedAt: 1_700_000_000_000,
          paidAt: 1_700_000_010_000,
          status: "delivered",
          merchantName: "Test 旗舰店",
          totalAmount: { value: 123.45, currency: "CNY" },
          items: [{ name: "Item X", quantity: 1, unitPrice: 123.45 }],
        },
      ],
    }), "utf-8");
    try {
      const a = new TaobaoAdapter();
      const raws = [];
      for await (const r of a.sync({ inputPath })) raws.push(r);
      expect(raws).toHaveLength(1);
      expect(raws[0].adapter).toBe("shopping-taobao");
      expect(raws[0].kind).toBe("order");
      expect(raws[0].originalId).toBe("taobao:order:TB-SNAP-1");
      const batch = a.normalize(raws[0]);
      expect(validateBatch(batch).valid).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("snapshot mode — schemaVersion mismatch throws", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taobao-snap-bad-"));
    const inputPath = path.join(dir, "snap.json");
    fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 99, events: [] }), "utf-8");
    try {
      const a = new TaobaoAdapter();
      let threw = null;
      try {
        for await (const _r of a.sync({ inputPath })) { /* drain */ }
      } catch (err) { threw = err; }
      expect(threw).toBeTruthy();
      expect(threw.message).toMatch(/schemaVersion mismatch/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-arg ctor + no inputPath = NO_INPUT (legible failure)", async () => {
    const a = new TaobaoAdapter();
    const auth = await a.authenticate({});
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("NO_INPUT");
  });
});

// ─── JdAdapter ───────────────────────────────────────────────────────────

describe("JdAdapter", () => {
  it("contract conformance", () => {
    const a = new JdAdapter({ account: { pin: "p1", cookies: "k=v" } });
    expect(assertAdapter(a).ok).toBe(true);
  });

  it("orderToRecord maps JD fields", () => {
    const o = {
      orderId: "JD-1",
      orderTotalPrice: "1999.00",
      orderStartTime: "2026-04-15 10:00:00",
      orderStatusText: "已收货",
      venderName: "京东自营",
      productList: [
        { productName: "Kindle", productPrice: "999", productQuantity: 2 },
      ],
      consigneeName: "张三",
    };
    const rec = jdOrderToRecord(o);
    expect(rec.orderId).toBe("JD-1");
    expect(rec.merchantName).toBe("京东自营");
    expect(rec.status).toBe("delivered");
    expect(rec.totalAmount.value).toBe(1999);
    expect(rec.items[0].name).toBe("Kindle");
    expect(rec.items[0].quantity).toBe(2);
  });

  it("sync + normalize end-to-end", async () => {
    const fetchFn = async () => ({
      orders: [
        {
          orderId: "JD-2", orderTotalPrice: "299",
          orderStartTime: "2026-04-15 10:00:00",
          orderStatusText: "已发货",
          venderName: "京东",
          productList: [{ productName: "鼠标", productPrice: "299", productQuantity: 1 }],
        },
      ],
    });
    const a = new JdAdapter({
      account: { pin: "p1", cookies: "v=ok" },
      fetchFn,
    });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 0 })) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(validateBatch(a.normalize(raws[0])).valid).toBe(true);
  });
});

// ─── MeituanAdapter ──────────────────────────────────────────────────────

describe("MeituanAdapter", () => {
  it("contract conformance", () => {
    const a = new MeituanAdapter({ account: { userId: "u-1", cookies: "k=v" } });
    expect(assertAdapter(a).ok).toBe(true);
  });

  it("orderToRecord maps Meituan 外卖 fields", () => {
    const o = {
      orderId: "MT-1",
      poiName: "麦当劳(中山公园店)",
      orderTime: 1700000000,
      payTime: 1700000010,
      statusDesc: "已送达",
      totalPrice: "45.50",
      dishes: [
        { name: "巨无霸套餐", quantity: 1, price: "45.5" },
      ],
      recipientAddress: "上海...",
    };
    const rec = meituanOrderToRecord(o, "waimai");
    expect(rec.orderId).toBe("MT-1");
    expect(rec.merchantName).toBe("麦当劳(中山公园店)");
    expect(rec.status).toBe("delivered");
    expect(rec.totalAmount.value).toBe(45.5);
    expect(rec.extras.platform).toBe("waimai");
  });

  it("sync iterates multiple platforms", async () => {
    const seen = [];
    const fetchFn = async (opts) => {
      seen.push(opts.query.platform);
      return {
        orders: [
          {
            orderId: `MT-${opts.query.platform}`,
            poiName: "Test",
            orderTime: 1700000000,
            statusDesc: "已完成",
            totalPrice: "10",
            dishes: [{ name: "x", quantity: 1, price: "10" }],
          },
        ],
      };
    };
    const a = new MeituanAdapter({
      account: { userId: "u-1", cookies: "v=ok" },
      fetchFn,
    });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 0, platforms: ["waimai", "groupbuy"] })) raws.push(r);
    expect(seen).toContain("waimai");
    expect(seen).toContain("groupbuy");
    expect(raws.length).toBeGreaterThan(0);
  });
});
