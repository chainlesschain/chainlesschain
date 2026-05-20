/**
 * Phase 7.3b — Meituan (美团) adapter.
 *
 * Meituan covers 外卖 (food delivery) + 团购 (group buy) + 酒店 (hotel
 * — though Ctrip is more common). v0 focuses on 外卖 + 团购 since that's
 * where most users have the longest history.
 *
 * Auth: cookie-based, similar to Taobao/JD.
 */

"use strict";

const { normalizeOrderRecord, CookieAuth } = require("../shopping-base");

const NAME = "shopping-meituan";
const VERSION = "0.5.0";

const MEITUAN_ORDERS_URL = "https://h5.meituan.com/order/list";

class MeituanAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.userId) {
      throw new Error("MeituanAdapter: opts.account.userId required");
    }
    this.account = opts.account;
    this._cookieAuth = new CookieAuth({
      platform: "meituan",
      cookies: opts.account.cookies || "",
    });
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:cookie-api", "parse:meituan-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: ["meituan:orderId / poiName / dishes / totalPrice / deliveryAddress"],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate() {
    const ok = await this._cookieAuth.validate();
    if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
    return { ok: true, account: this.account.userId };
  }

  async healthCheck() {
    const r = await this.authenticate();
    return r.ok
      ? { ok: true, lastChecked: Date.now() }
      : { ok: false, reason: r.reason, error: r.error };
  }

  async *sync(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const sinceMs = opts.sinceWatermark != null
      ? parseInt(String(opts.sinceWatermark), 10) || 0
      : (Date.now() - 365 * 24 * 3600_000);
    const platforms = opts.platforms || ["waimai", "groupbuy"]; // sub-types

    for (const platform of platforms) {
      let page = 1;
      while (true) {
        const resp = await this._fetchFn({
          url: MEITUAN_ORDERS_URL,
          cookies: this._cookieAuth.toHeader(),
          query: { page, platform },
        });
        if (!resp || !Array.isArray(resp.orders)) break;
        let pageHasNew = false;
        for (const raw of resp.orders) {
          const rec = orderToRecord(raw, platform);
          if (!rec) continue;
          if (rec.placedAt && rec.placedAt < sinceMs) break;
          pageHasNew = true;
          yield {
            adapter: NAME,
            originalId: rec.orderId,
            capturedAt: rec.placedAt || Date.now(),
            payload: { record: rec, platform },
          };
        }
        if (!pageHasNew || resp.orders.length < 10) break;
        page += 1;
      }
    }
  }

  normalize(raw) {
    return normalizeOrderRecord(raw.payload.record, {
      adapterName: NAME, adapterVersion: VERSION,
    });
  }
}

function orderToRecord(o, platform = "waimai") {
  if (!o || typeof o !== "object") return null;
  const orderId = o.orderId || o.viewOrderId || o.id;
  if (!orderId) return null;
  const merchant = o.poiName || o.dealName || o.shopName || o.merchantName || "美团";

  const items = [];
  const dishes = o.dishes || o.dealList || o.itemList || o.items || [];
  for (const it of dishes) {
    if (!it) continue;
    items.push({
      name: it.name || it.dishName || it.dealName,
      quantity: parseInt(it.quantity || it.count || 1, 10),
      unitPrice: parseFloat(it.price || it.unitPrice || 0),
      sku: it.sku || null,
    });
  }

  return {
    vendorId: "meituan",
    orderId: String(orderId),
    placedAt: parseTime(o.orderTime || o.createTime),
    paidAt: parseTime(o.payTime),
    status: mapStatus(o.statusDesc || o.statusText || o.status),
    merchantName: merchant,
    totalAmount: { value: parseFloat(o.totalPrice || o.totalFee || o.payAmount || 0), currency: "CNY" },
    items,
    recipient: o.recipientName,
    shippingAddress: o.recipientAddress || o.deliveryAddress,
    extras: { platform, rawStatus: o.statusDesc || o.statusText },
  };
}

function parseTime(v) {
  if (Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function mapStatus(s) {
  const t = String(s || "").toLowerCase();
  if (t.includes("退款") || t.includes("refund")) return "refunded";
  if (t.includes("取消") || t.includes("cancel")) return "cancelled";
  if (t.includes("配送中") || t.includes("派送") || t.includes("shipped")) return "shipped";
  if (t.includes("已完成") || t.includes("已送达") || t.includes("delivered")) return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("MeituanAdapter: no fetchFn configured");
}

module.exports = { MeituanAdapter, orderToRecord, NAME, VERSION };
