"use strict";

import { describe, it, expect } from "vitest";

const {
  normalizeOrderRecord,
  mapStatusToSubtype,
  CookieAuth,
} = require("../../lib/adapters/shopping-base");

describe("normalizeOrderRecord", () => {
  const ORDER = {
    vendorId: "jd",
    orderId: "JD123456",
    placedAt: 1716383021000,
    paidAt: 1716383100000,
    status: "delivered",
    merchantName: "京东自营旗舰店",
    totalAmount: { value: 299.9, currency: "CNY" },
    items: [
      { name: "机械键盘", quantity: 1, unitPrice: 249.9, sku: "SKU1" },
      { name: "键帽", quantity: 2, unitPrice: 25 },
    ],
    recipient: "张三",
    shippingAddress: "上海市幸福路1号",
    trackingNumber: "SF123",
    extras: { shopId: "S1" },
  };

  it("throws on missing rec / orderId / merchantName", () => {
    expect(() => normalizeOrderRecord(null)).toThrow(/rec required/);
    expect(() => normalizeOrderRecord({})).toThrow(/orderId required/);
    expect(() => normalizeOrderRecord({ orderId: "X" })).toThrow(
      /merchantName required/,
    );
  });

  it("emits order event with amount out + items text + cross-source link extras", () => {
    const batch = normalizeOrderRecord(ORDER, {
      adapterName: "shopping-jd",
      adapterVersion: "0.5.0",
    });
    expect(batch.events).toHaveLength(1);
    const ev = batch.events[0];
    expect(ev.subtype).toBe("order");
    expect(ev.occurredAt).toBe(1716383021000);
    expect(ev.actor).toBe("person-self");
    expect(ev.content.title).toBe("京东自营旗舰店 订单 JD123456");
    expect(ev.content.amount).toEqual({
      value: 299.9,
      currency: "CNY",
      direction: "out",
    });
    expect(ev.content.text).toBe("机械键盘 x1; 键帽 x2");
    expect(ev.extra).toMatchObject({
      vendorId: "jd",
      orderId: "JD123456",
      merchantOrderNumber: "JD123456", // Email/Alipay cross-source link key
      orderStatus: "delivered",
      itemCount: 2,
      recipient: "张三",
      trackingNumber: "SF123",
      paidAt: 1716383100000,
      vendorExtras: { shopId: "S1" },
    });
    expect(ev.source).toMatchObject({
      adapter: "shopping-jd",
      adapterVersion: "0.5.0",
      originalId: "JD123456",
      capturedBy: "api",
    });
  });

  it("emits merchant person + per-SKU item entities inheriting order currency", () => {
    const batch = normalizeOrderRecord(ORDER, { adapterName: "shopping-jd" });
    expect(batch.persons).toHaveLength(1);
    expect(batch.persons[0]).toMatchObject({
      subtype: "merchant",
      names: ["京东自营旗舰店"],
    });
    expect(batch.items).toHaveLength(2);
    expect(batch.items[0]).toMatchObject({
      type: "item",
      subtype: "product",
      name: "机械键盘",
      merchant: batch.persons[0].id,
      price: { value: 249.9, currency: "CNY" },
    });
    expect(batch.items[0].extra).toMatchObject({ quantity: 1, sku: "SKU1" });
    // nameless item entries are dropped
    const withJunk = normalizeOrderRecord(
      { ...ORDER, items: [{ quantity: 3 }, { name: "ok" }] },
      {},
    );
    expect(withJunk.items).toHaveLength(1);
  });

  it("refund order → refund subtype with money direction IN", () => {
    const batch = normalizeOrderRecord(
      { ...ORDER, status: "refunded" },
      { adapterName: "shopping-jd" },
    );
    expect(batch.events[0].subtype).toBe("refund");
    expect(batch.events[0].content.amount.direction).toBe("in");
  });

  it("omits amount when totalAmount missing; occurredAt falls back to now", () => {
    const before = Date.now();
    const batch = normalizeOrderRecord({
      orderId: "X1",
      merchantName: "店",
    });
    expect(batch.events[0].content.amount).toBeUndefined();
    expect(batch.events[0].occurredAt).toBeGreaterThanOrEqual(before);
    expect(batch.events[0].extra.orderStatus).toBe("placed");
  });
});

describe("mapStatusToSubtype", () => {
  it("maps refund variants (en + 中文)", () => {
    expect(mapStatusToSubtype("refunded")).toBe("refund");
    expect(mapStatusToSubtype("REFUND_PENDING")).toBe("refund");
    expect(mapStatusToSubtype("退款中")).toBe("refund");
  });

  it("maps cancel variants (en + 中文)", () => {
    expect(mapStatusToSubtype("cancelled")).toBe("cancelled");
    expect(mapStatusToSubtype("closed")).toBe("cancelled");
    expect(mapStatusToSubtype("已取消")).toBe("cancelled");
    expect(mapStatusToSubtype("已关闭")).toBe("cancelled");
  });

  it("everything else (placed/shipped/delivered/blank) → order", () => {
    expect(mapStatusToSubtype("placed")).toBe("order");
    expect(mapStatusToSubtype("shipped")).toBe("order");
    expect(mapStatusToSubtype("delivered")).toBe("order");
    expect(mapStatusToSubtype(undefined)).toBe("order");
  });
});

describe("CookieAuth", () => {
  it("requires platform; setCookies type-checks", () => {
    expect(() => new CookieAuth({})).toThrow(/platform required/);
    const c = new CookieAuth({ platform: "jd" });
    expect(() => c.setCookies(42)).toThrow(/string required/);
  });

  it("toHeader returns raw string or null when empty", () => {
    const c = new CookieAuth({ platform: "jd" });
    expect(c.toHeader()).toBe(null);
    c.setCookies("pt_key=abc; pt_pin=u1");
    expect(c.toHeader()).toBe("pt_key=abc; pt_pin=u1");
  });

  it("validate: false on empty, true on non-empty, defers to injected validator", async () => {
    const empty = new CookieAuth({ platform: "jd" });
    expect(await empty.validate()).toBe(false);
    const plain = new CookieAuth({ platform: "jd", cookies: "k=v" });
    expect(await plain.validate()).toBe(true);
    const probed = new CookieAuth({
      platform: "jd",
      cookies: "k=v",
      validator: async (raw) => raw.includes("pt_key"),
    });
    expect(await probed.validate()).toBe(false);
  });

  it("getCookieValue: case-insensitive, URI-decodes, escapes regex metachars", () => {
    const c = new CookieAuth({
      platform: "taobao",
      cookies: "Name=%E5%BC%A0%E4%B8%89; a.b+c=literal; last=v",
    });
    expect(c.getCookieValue("name")).toBe("张三");
    // dot/plus in cookie name must be treated literally, not as regex
    expect(c.getCookieValue("a.b+c")).toBe("literal");
    expect(c.getCookieValue("missing")).toBe(null);
    expect(c.getCookieValue("")).toBe(null);
  });

  it("getCookieValue: bare `%` in value falls back to raw (no URIError)", () => {
    // Cookie values legitimately contain `%` (e.g. "100%off") — must not throw.
    const c = new CookieAuth({
      platform: "taobao",
      cookies: "promo=100%off; bad=%zz; ok=%E5%BC%A0",
    });
    expect(() => c.getCookieValue("promo")).not.toThrow();
    expect(c.getCookieValue("promo")).toBe("100%off");
    expect(c.getCookieValue("bad")).toBe("%zz");
    // well-formed values still decode
    expect(c.getCookieValue("ok")).toBe("张");
  });
});
