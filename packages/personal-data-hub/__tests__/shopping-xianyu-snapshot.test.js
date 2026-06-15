"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  XianyuAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  orderToRecord,
  extractOrders,
  normSide,
} = require("../lib/adapters/shopping-xianyu");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

// 闲鱼 (Xianyu / goofish) — Alibaba C2C 二手交易; mirrors shopping-eleme with a
// two-sided buy/sell `side`. mtop signing is injected (signProvider) so the
// adapter stays pure-Node.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "shopping-xianyu.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

function writeRaw(dir, fileName, content) {
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

describe("XianyuAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xianyu-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 and VALID_SNAPSHOT_KINDS = [order]", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["order"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: Date.now(), events: [] });
    const a = new XianyuAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new XianyuAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with no inputPath returns NO_INPUT", async () => {
    const a = new XianyuAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
    expect(res.message).toMatch(/snapshot mode/);
  });

  it("sync() without inputPath throws with signing hint", async () => {
    const a = new XianyuAdapter();
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
    const a = new XianyuAdapter();
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
    const a = new XianyuAdapter();
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
    const a = new XianyuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("buy order round-trips normalize cleanly (counterparty = seller)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "xianyu",
      account: { userId: "u-alice", displayName: "alice" },
      events: [
        {
          kind: "order",
          id: "order-XY-9001",
          capturedAt: now - 1000,
          orderId: "XY-9001",
          side: "buy",
          title: "二手 iPhone 13 128G",
          counterparty: "卖家阿强",
          placedAt: now - 86400_000,
          paidAt: now - 86400_000 + 5_000,
          status: "交易成功",
          totalAmount: { value: 2800.0, currency: "CNY" },
          recipient: "张三",
          shippingAddress: "上海市浦东新区...",
        },
      ],
    });
    const a = new XianyuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].originalId).toBe("xianyu:order:order-XY-9001");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(batch)).toContain("二手 iPhone 13 128G");
    expect(JSON.stringify(batch)).toContain("卖家阿强");
    expect(JSON.stringify(batch)).toContain("delivered");
  });

  it("sell order maps side=sell into the record", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "order", id: "XY-SELL-1", orderId: "XY-SELL-1", side: "sell",
          title: "出闲置耳机", counterparty: "买家小李",
          placedAt: now, paidAt: now, status: "已完成",
          totalAmount: { value: 120, currency: "CNY" },
        },
      ],
    });
    const a = new XianyuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(JSON.stringify(batch)).toContain("sell");
    expect(JSON.stringify(batch)).toContain("买家小李");
  });

  it("status mapping handles xianyu-typical strings", async () => {
    const now = Date.now();
    const cases = [
      { status: "已发货", expect: "shipped" },
      { status: "待收货", expect: "shipped" },
      { status: "交易成功", expect: "delivered" },
      { status: "已完成", expect: "delivered" },
      { status: "退款成功", expect: "refunded" },
      { status: "已关闭", expect: "cancelled" },
      { status: "等待付款", expect: "placed" },
    ];
    for (const c of cases) {
      const p = writeSnapshot(tmpDir, {
        schemaVersion: 1,
        snapshottedAt: now,
        events: [
          { kind: "order", id: `o-${c.status}`, orderId: `o-${c.status}`, side: "buy",
            title: "x", counterparty: "c", placedAt: now, paidAt: now, status: c.status,
            totalAmount: { value: 1, currency: "CNY" } },
        ],
      });
      const a = new XianyuAdapter();
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
        { kind: "order", id: "o1", orderId: "o1", side: "buy", title: "t", placedAt: now,
          totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new XianyuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { order: false } })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "order", id: `o${i}`, orderId: `o${i}`, side: "buy", title: "t",
      placedAt: now - i * 1000, totalAmount: { value: 1, currency: "CNY" },
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new XianyuAdapter();
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
        { kind: "order", id: "o1", orderId: "o1", side: "buy", title: "t", placedAt: now,
          totalAmount: { value: 1, currency: "CNY" } },
        { kind: "message", id: "m1" },
        { kind: "future-kind", id: "x" },
      ],
    });
    const a = new XianyuAdapter();
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
        { kind: "order", id: "o1", orderId: "o1", side: "buy", title: "t",
          totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new XianyuAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("advertises both snapshot and cookie-api capabilities", () => {
    const a = new XianyuAdapter();
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:cookie-api");
    expect(assertAdapter(a).ok).toBe(true);
  });
});

describe("XianyuAdapter cookie-api mode", () => {
  it("authenticate(cookie) ok when userId + cookies present", async () => {
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("cookie");
    expect(res.account).toBe("u-1");
  });

  it("authenticate(cookie) requires account.userId", async () => {
    const a = new XianyuAdapter({ account: { cookies: "_m_h5_tk=ok" } });
    const res = await a.authenticate();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_USER_ID");
  });

  it("sync yields normalized buy+sell records from fetchFn fixture", async () => {
    const byTab = {
      buy: [
        { order_id: "XY-BUY-1", title: "二手相机", seller_nick: "卖家A", status_text: "交易成功",
          total_amount: 1500, order_time: 1700000000, pay_time: 1700000010,
          receiver: "李四", address: "广州..." },
      ],
      sell: [
        { order_id: "XY-SELL-1", title: "出旧书", buyer_nick: "买家B", status_text: "交易成功",
          total_amount: 30, order_time: 1700000500 },
      ],
    };
    const fetchFn = async (opts) => ({ orders: byTab[opts.query.tab] || [] });
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 0 })) raws.push(r);
    expect(raws.map((r) => r.originalId).sort()).toEqual(["XY-BUY-1", "XY-SELL-1"]);
    const buy = raws.find((r) => r.originalId === "XY-BUY-1");
    expect(buy.payload.record.extras.side).toBe("buy");
    expect(buy.payload.record.merchantName).toBe("卖家A");
    expect(buy.payload.record.totalAmount.value).toBe(1500);
    expect(buy.payload.record.status).toBe("delivered");
    const sell = raws.find((r) => r.originalId === "XY-SELL-1");
    expect(sell.payload.record.extras.side).toBe("sell");
    expect(sell.payload.record.merchantName).toBe("买家B");

    const batch = a.normalize(buy);
    expect(validateBatch(batch).valid).toBe(true);
    expect(JSON.stringify(batch)).toContain("二手相机");
  });

  it("invokes signProvider and passes sign to fetchFn", async () => {
    let seenSign = null;
    const signProvider = async () => "SIGN-XYZ";
    const fetchFn = async (opts) => {
      seenSign = opts.sign;
      return { orders: [] };
    };
    const a = new XianyuAdapter({
      account: { userId: "u-1", cookies: "_m_h5_tk=ok" },
      fetchFn,
      signProvider,
    });
    for await (const _r of a.sync({ sinceWatermark: 0, sides: ["buy"] })) { /* drain */ }
    expect(seenSign).toBe("SIGN-XYZ");
  });

  it("passes sign: null when no signProvider configured", async () => {
    let seen = "unset";
    const fetchFn = async (opts) => {
      seen = opts.sign;
      return { orders: [] };
    };
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" }, fetchFn });
    for await (const _r of a.sync({ sinceWatermark: 0, sides: ["buy"] })) { /* drain */ }
    expect(seen).toBe(null);
  });

  it("paginates and stops at sinceWatermark within one side", async () => {
    const pages = {
      1: [
        { order_id: "p1-a", title: "t", order_time: 1700000000, total_amount: 10 },
        { order_id: "p1-b", title: "t", order_time: 1699000000, total_amount: 10 },
      ],
      2: [{ order_id: "p2-a", title: "t", order_time: 1698000000, total_amount: 10 }],
    };
    const seenPages = [];
    const fetchFn = async (opts) => {
      seenPages.push(opts.query.pageNumber);
      return { orders: pages[opts.query.pageNumber] || [] };
    };
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ sinceWatermark: 1699500000 * 1000, pageSize: 2, sides: ["buy"] })) {
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
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" }, fetchFn });
    const raws = [];
    for await (const r of a.sync({ include: { order: false } })) raws.push(r);
    expect(raws.length).toBe(0);
    expect(called).toBe(false);
  });

  it("normSide canonicalizes buy/sell tokens", () => {
    expect(normSide("buy")).toBe("buy");
    expect(normSide("sell")).toBe("sell");
    expect(normSide("卖出")).toBe("sell");
    expect(normSide("我买到的")).toBe("buy");
    expect(normSide(null, { bizType: "sold" })).toBe("sell");
    expect(normSide(undefined, {})).toBe("buy"); // default
  });

  it("orderToRecord maps xianyu buy fields (counterparty=seller)", () => {
    const rec = orderToRecord({
      order_id: "XY-9",
      title: "二手键盘",
      seller_nick: "卖家C",
      status_text: "已完成",
      total_amount: 88.0,
      order_time: 1700000000,
    }, "buy");
    expect(rec.orderId).toBe("XY-9");
    expect(rec.merchantName).toBe("卖家C");
    expect(rec.status).toBe("delivered");
    expect(rec.totalAmount.value).toBe(88.0);
    expect(rec.items[0].name).toBe("二手键盘");
    expect(rec.extras.side).toBe("buy");
    expect(rec.extras.capturedBy).toBe("cookie-api");
  });

  it("extractOrders tolerates nested mtop response shapes", () => {
    expect(extractOrders({ orders: [1] })).toEqual([1]);
    expect(extractOrders({ order_list: [2] })).toEqual([2]);
    expect(extractOrders({ data: { orderList: [3] } })).toEqual([3]);
    expect(extractOrders({ data: { list: [4] } })).toEqual([4]);
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
    const a = new XianyuAdapter({
      account: { userId: "u-1", cookies: "_m_h5_tk=ok" },
      fetchFn,
      ordersUrl: "https://custom.example/orders",
    });
    for await (const _r of a.sync({ sinceWatermark: 0, sides: ["buy"] })) { /* drain */ }
    expect(seenUrl).toBe("https://custom.example/orders");
  });

  it("default fetchFn throws a legible error when cookie mode used without injection", async () => {
    const a = new XianyuAdapter({ account: { userId: "u-1", cookies: "_m_h5_tk=ok" } });
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
