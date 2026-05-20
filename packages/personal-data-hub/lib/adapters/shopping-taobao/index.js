/**
 * Phase 7.2 — Taobao + Tmall adapter.
 *
 * Auth: cookie-based. User opens taobao.com in a browser, logs in,
 * copies cookies via the web extension, pastes into hub UI.
 *
 * Fetch: Taobao's `/orderList/list.htm` returns a JSON page with order
 * cards. We use a DI seam `fetchFn` so tests can run on fixture
 * responses without hitting the network.
 *
 * Order schema mapping (Taobao → OrderRecord):
 *   bizOrderId → orderId
 *   sellerNick → merchantName
 *   actualFee → totalAmount.value (yuan, sometimes string)
 *   mainOrders/subOrders → items[]
 *   payTime → paidAt (ms epoch)
 */

"use strict";

const { normalizeOrderRecord, CookieAuth } = require("../shopping-base");

const NAME = "shopping-taobao";
const VERSION = "0.5.0";

const TAOBAO_ORDERS_URL = "https://h5.m.taobao.com/mlapp/olist.html";

class TaobaoAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.userId) {
      throw new Error("TaobaoAdapter: opts.account.userId required");
    }
    this.account = opts.account;
    this._cookieAuth = new CookieAuth({
      platform: "taobao",
      cookies: opts.account.cookies || "",
    });
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:cookie-api", "parse:taobao-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 6, perDay: 200 }; // respect Taobao风控
    this.dataDisclosure = {
      fields: [
        "taobao:bizOrderId / sellerNick / items / payTime / actualFee / address",
      ],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate() {
    const ok = await this._cookieAuth.validate();
    if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing or empty" };
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
      ? parseWatermarkMs(opts.sinceWatermark)
      : (Date.now() - 365 * 24 * 3600_000); // default last year
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : 20;
    let page = 1;
    while (true) {
      const resp = await this._fetchFn({
        url: TAOBAO_ORDERS_URL,
        cookies: this._cookieAuth.toHeader(),
        query: { page, pageSize, ts: Date.now() },
      });
      if (!resp || !Array.isArray(resp.orders)) break;
      let pageHasNew = false;
      for (const raw of resp.orders) {
        const rec = orderToRecord(raw);
        if (!rec) continue;
        if (rec.placedAt && rec.placedAt < sinceMs) break; // older than watermark
        pageHasNew = true;
        yield {
          adapter: NAME,
          originalId: rec.orderId,
          capturedAt: rec.paidAt || rec.placedAt || Date.now(),
          payload: { record: rec },
        };
      }
      if (!pageHasNew || resp.orders.length < pageSize) break;
      page += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("TaobaoAdapter.normalize: raw.payload.record missing");
    }
    return normalizeOrderRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.bizOrderId || o.orderId || o.id;
  const merchant = o.sellerNick || o.shopName || o.merchantName;
  if (!orderId || !merchant) return null;
  const items = [];
  const subOrders = o.subOrders || o.itemList || o.items || [];
  for (const it of subOrders) {
    if (!it) continue;
    items.push({
      name: it.itemTitle || it.title || it.name,
      quantity: parseInt(it.quantity || it.buyCount || it.num || 1, 10),
      unitPrice: parseFloat(it.itemPrice || it.unitPrice || it.price || 0),
      sku: it.skuText || it.sku || null,
    });
  }
  return {
    vendorId: "taobao",
    orderId: String(orderId),
    placedAt: parseTaobaoTime(o.createTime || o.orderCreateTime),
    paidAt: parseTaobaoTime(o.payTime || o.paidAt),
    status: mapStatus(o.statusText || o.statusDesc || o.status),
    merchantName: merchant,
    totalAmount: { value: parseFloat(o.actualFee || o.payAmount || o.totalAmount || 0), currency: "CNY" },
    items,
    recipient: o.receiverName || o.address?.receiverName || null,
    shippingAddress: o.fullAddress || o.address?.fullAddress || null,
    trackingNumber: o.trackingNumber || o.expressNo || null,
    extras: { rawStatus: o.statusText || o.statusDesc, isTmall: !!o.tmallFlag },
  };
}

function parseTaobaoTime(v) {
  if (Number.isFinite(v)) {
    // Sometimes ms, sometimes seconds (10-digit)
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function parseWatermarkMs(wm) {
  if (Number.isFinite(wm)) return wm;
  const n = parseInt(String(wm), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function mapStatus(s) {
  const t = String(s || "").toLowerCase();
  if (t.includes("退款") || t.includes("refund")) return "refunded";
  if (t.includes("已取消") || t.includes("cancel") || t.includes("已关闭")) return "cancelled";
  if (t.includes("已发货") || t.includes("shipped")) return "shipped";
  if (t.includes("已签收") || t.includes("已完成") || t.includes("delivered")) return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  // Default: no-op so adapter doesn't accidentally hit real Taobao when
  // user hasn't configured a fetcher. Production wires a real HTTPS
  // fetch via the desktop main process (not from renderer).
  throw new Error("TaobaoAdapter: no fetchFn configured (use a desktop-main wrapper)");
}

module.exports = { TaobaoAdapter, orderToRecord, parseTaobaoTime, NAME, VERSION };
