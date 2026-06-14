"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  DianpingAdapter,
  orderToRecord,
  extractOrders,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/shopping-dianping");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-dianping-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "dper=abc; _lxsdk=xyz; cy=1";

describe("constants", () => {
  it("exposes name/version/schema", () => {
    expect(NAME).toBe("shopping-dianping");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("orderToRecord", () => {
  it("maps a Dianping group-buy order (poi/deals/yuan amount)", () => {
    const rec = orderToRecord({
      orderId: "DP1",
      shopName: "海底捞火锅(国贸店)",
      dealList: [{ dealName: "双人套餐", quantity: 1, price: "238" }],
      orderTime: 1716383021000,
      payTime: 1716383040000,
      statusText: "已消费",
      totalPrice: "238.00",
    });
    expect(rec).toMatchObject({
      vendorId: "dianping",
      orderId: "DP1",
      merchantName: "海底捞火锅(国贸店)",
      status: "delivered",
    });
    expect(rec.totalAmount).toEqual({ value: 238, currency: "CNY" });
    expect(rec.items[0]).toMatchObject({ name: "双人套餐", quantity: 1, unitPrice: 238 });
    expect(rec.placedAt).toBe(1716383021000);
  });

  it("falls back to 分 (cents) field when no 元 field present", () => {
    const rec = orderToRecord({ orderId: "DP2", shopName: "星巴克", totalFen: 4500 });
    expect(rec.totalAmount.value).toBe(45);
  });

  it("maps refund / cancelled status", () => {
    expect(orderToRecord({ orderId: "R", shopName: "x", statusText: "已退款" }).status).toBe("refunded");
    expect(orderToRecord({ orderId: "C", shopName: "x", statusText: "已取消" }).status).toBe("cancelled");
  });

  it("drops id-less rows; default merchant 大众点评", () => {
    expect(orderToRecord({ shopName: "x" })).toBe(null);
    expect(orderToRecord({ orderId: "M" }).merchantName).toBe("大众点评");
  });
});

describe("extractOrders", () => {
  it("pulls list from common shapes", () => {
    expect(extractOrders({ orders: [{ orderId: "A" }] })).toHaveLength(1);
    expect(extractOrders({ data: { records: [{ orderId: "B" }] } })).toHaveLength(1);
    expect(extractOrders({ orderList: [{ orderId: "C" }] })).toHaveLength(1);
    expect(extractOrders({})).toEqual([]);
    expect(extractOrders(null)).toEqual([]);
  });
});

describe("DianpingAdapter snapshot mode", () => {
  const SNAPSHOT = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    vendor: "dianping",
    account: { userId: "u1", displayName: "我" },
    events: [
      {
        kind: "order",
        id: "order-DPS1",
        orderId: "DPS1",
        merchantName: "西贝莜面村",
        platform: "groupbuy",
        items: [{ name: "莜面套餐", quantity: 2, unitPrice: 88 }],
        placedAt: 1716300000000,
        status: "已完成",
        totalAmount: { value: 176, currency: "CNY" },
      },
    ],
  });

  it("authenticate validates inputPath readability", async () => {
    const p = writeTmp(SNAPSHOT);
    try {
      const a = new DianpingAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const bad = await a.authenticate({ inputPath: path.join(os.tmpdir(), "nope-dp.json") });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields order + normalize end-to-end", async () => {
    const p = writeTmp(SNAPSHOT);
    try {
      const a = new DianpingAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("dianping:order:order-DPS1");
      const batch = a.normalize(items[0]);
      expect(batch.events[0].subtype).toBe("order");
      expect(batch.events[0].content.amount).toMatchObject({ value: 176, direction: "out" });
      expect(batch.persons.find((x) => x.subtype === "merchant").names).toEqual(["西贝莜面村"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schemaVersion mismatch throws", async () => {
    const p = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new DianpingAdapter();
      await expect(collect(a.sync({ inputPath: p }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("DianpingAdapter cookie-api mode", () => {
  it("authenticate cookie mode requires userId", async () => {
    const noId = new DianpingAdapter({ account: { cookies: COOKIES } });
    expect((await noId.authenticate()).reason).toBe("NO_ACCOUNT_USER_ID");
    const ok = new DianpingAdapter({ account: { cookies: COOKIES, userId: "u1" } });
    expect(await ok.authenticate()).toEqual({ ok: true, account: "u1", mode: "cookie" });
  });

  it("sync fetches, paginates, maps + normalizes", async () => {
    const pages = [
      { orderList: [{ orderId: "CK1", shopName: "肯德基", payMoney: "39.9", orderTime: 1716383021000, statusText: "已消费" }] },
      { orderList: [] },
    ];
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      calls.push({ url, cookies, page: query.page, sign });
      return pages[query.page - 1] || { orderList: [] };
    };
    const a = new DianpingAdapter({ account: { cookies: COOKIES, userId: "u1" }, fetchFn });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("CK1");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.events[0].content.amount).toMatchObject({ value: 39.9, direction: "out" });
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const a = new DianpingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ query }) =>
        query.page === 1 ? { orders: [{ orderId: "S1", shopName: "x" }] } : { orders: [] },
      signProvider: async (ctx) => {
        signCalls.push(ctx);
        return "MTGSIG-TOKEN";
      },
    });
    const items = await collect(a.sync({ sinceWatermark: 0 }));
    expect(items).toHaveLength(1);
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("stops at sinceWatermark", async () => {
    const a = new DianpingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async () => ({
        orderList: [
          { orderId: "NEW", shopName: "x", orderTime: 2_000_000_000_000 },
          { orderId: "OLD", shopName: "x", orderTime: 1_000_000_000_000 },
        ],
      }),
    });
    const items = await collect(a.sync({ sinceWatermark: 1_500_000_000_000, pageSize: 2 }));
    expect(items.map((x) => x.originalId)).toEqual(["NEW"]);
  });

  it("respects opts.limit", async () => {
    const a = new DianpingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async () => ({
        orderList: [
          { orderId: "L1", shopName: "x", orderTime: 2_000_000_000_000 },
          { orderId: "L2", shopName: "x", orderTime: 2_000_000_000_001 },
        ],
      }),
    });
    const items = await collect(a.sync({ sinceWatermark: 0, limit: 1, pageSize: 2 }));
    expect(items).toHaveLength(1);
  });

  it("empty/login-redirect response yields zero (no crash)", async () => {
    const a = new DianpingAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async () => "<html>login</html>",
    });
    expect(await collect(a.sync({ sinceWatermark: 0 }))).toEqual([]);
  });

  it("default fetch throws when no fetchFn (wiring bug)", async () => {
    const a = new DianpingAdapter({ account: { cookies: COOKIES, userId: "u1" } });
    await expect(collect(a.sync({ sinceWatermark: 0 }))).rejects.toThrow(/no fetchFn configured/);
  });

  it("no input throws", async () => {
    const a = new DianpingAdapter();
    await expect(collect(a.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
