/**
 * Phase 7.3 — JD (京东) adapter.
 *
 * Parallels Taobao but with JD's order endpoint + JSON shape:
 *   url: https://order.jd.com/center/list.action
 *   fields: orderId, orderTotalPrice, orderStartTime, orderStatusText,
 *           venderName, productList (with name/quantity/price)
 */

"use strict";

const { normalizeOrderRecord, CookieAuth } = require("../shopping-base");

const NAME = "shopping-jd";
const VERSION = "0.5.0";

const JD_ORDERS_URL = "https://order.jd.com/center/list.action";

class JdAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.pin) {
      throw new Error("JdAdapter: opts.account.pin required (JD user pin)");
    }
    this.account = opts.account;
    this._cookieAuth = new CookieAuth({
      platform: "jd",
      cookies: opts.account.cookies || "",
    });
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:cookie-api", "parse:jd-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 6, perDay: 200 };
    this.dataDisclosure = {
      fields: ["jd:orderId / venderName / productList / orderTotalPrice / address"],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate() {
    const ok = await this._cookieAuth.validate();
    if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
    return { ok: true, account: this.account.pin };
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
    let page = 1;
    while (true) {
      const resp = await this._fetchFn({
        url: JD_ORDERS_URL,
        cookies: this._cookieAuth.toHeader(),
        query: { page },
      });
      if (!resp || !Array.isArray(resp.orders)) break;
      let pageHasNew = false;
      for (const raw of resp.orders) {
        const rec = orderToRecord(raw);
        if (!rec) continue;
        if (rec.placedAt && rec.placedAt < sinceMs) break;
        pageHasNew = true;
        yield {
          adapter: NAME,
          originalId: rec.orderId,
          capturedAt: rec.placedAt || Date.now(),
          payload: { record: rec },
        };
      }
      if (!pageHasNew || resp.orders.length < 10) break;
      page += 1;
    }
  }

  normalize(raw) {
    return normalizeOrderRecord(raw.payload.record, {
      adapterName: NAME, adapterVersion: VERSION,
    });
  }
}

function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.orderId || o.id;
  const merchant = o.venderName || o.shopName || o.merchantName || "京东自营";
  if (!orderId) return null;

  const items = [];
  const products = o.productList || o.products || [];
  for (const it of products) {
    if (!it) continue;
    items.push({
      name: it.productName || it.skuName || it.name,
      quantity: parseInt(it.productQuantity || it.quantity || 1, 10),
      unitPrice: parseFloat(it.productPrice || it.unitPrice || 0),
      sku: it.skuId || it.sku || null,
    });
  }

  return {
    vendorId: "jd",
    orderId: String(orderId),
    placedAt: parseTime(o.orderStartTime || o.orderTime || o.createTime),
    paidAt: parseTime(o.paymentTime || o.payTime),
    status: mapStatus(o.orderStatusText || o.statusName || o.status),
    merchantName: merchant,
    totalAmount: { value: parseFloat(o.orderTotalPrice || o.totalPrice || 0), currency: "CNY" },
    items,
    recipient: o.consigneeName || o.receiverName,
    shippingAddress: o.address || o.consigneeAddress,
    trackingNumber: o.shipmentNo || o.trackingNumber,
    extras: { rawStatus: o.orderStatusText || o.statusName },
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
  if (t.includes("已发货") || t.includes("配送") || t.includes("shipped")) return "shipped";
  if (t.includes("已完成") || t.includes("已收货") || t.includes("delivered")) return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("JdAdapter: no fetchFn configured");
}

module.exports = { JdAdapter, orderToRecord, NAME, VERSION };
