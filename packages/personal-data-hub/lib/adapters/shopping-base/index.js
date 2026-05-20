/**
 * Phase 7 — shared shopping adapter base.
 *
 * Common normalize logic for Taobao / JD / Meituan (and future Pinduoduo,
 * Xiaohongshu, etc.) Each per-platform adapter parses platform-specific
 * JSON into a `OrderRecord` then calls `normalizeOrderRecord()` here.
 *
 * OrderRecord shape (vendor-neutral):
 *   {
 *     vendorId:          "taobao" | "jd" | "meituan" | ...
 *     orderId:           string  (vendor's order id, unique)
 *     placedAt:          ms epoch
 *     paidAt?:           ms epoch
 *     status:            "placed" | "shipped" | "delivered" | "refunded" | "cancelled"
 *     merchantName:      string
 *     totalAmount:       { value, currency }
 *     items:             [{ name, quantity, unitPrice, sku? }]
 *     recipient?:        string
 *     shippingAddress?:  string
 *     trackingNumber?:   string
 *     coupons?:          { value, currency }
 *     extras?:           { ... vendor-specific }
 *   }
 *
 * Output: Event(subtype="order"|"payment"|"refund") + merchant Person
 * + Item entities (per ordered SKU).
 */

"use strict";

const { newId } = require("../../ids");

/**
 * @param {OrderRecord} rec
 * @param {object} ctx { adapterName, adapterVersion }
 * @returns {NormalizedBatch}
 */
function normalizeOrderRecord(rec, ctx = {}) {
  if (!rec || typeof rec !== "object") {
    throw new Error("normalizeOrderRecord: rec required");
  }
  if (!rec.orderId) throw new Error("normalizeOrderRecord: rec.orderId required");
  if (!rec.merchantName) throw new Error("normalizeOrderRecord: rec.merchantName required");

  const now = Date.now();
  const occurredAt = Number.isFinite(rec.placedAt) ? rec.placedAt : now;
  const adapterName = ctx.adapterName || rec.vendorId || "shopping";
  const adapterVersion = ctx.adapterVersion || "0.1.0";

  const source = {
    adapter: adapterName,
    adapterVersion,
    originalId: String(rec.orderId),
    capturedAt: occurredAt,
    capturedBy: "api",
  };

  // Merchant Person
  const merchantId = `person-${adapterName}-merchant-${slug(rec.merchantName)}`;
  const persons = [{
    id: merchantId,
    type: "person",
    subtype: "merchant",
    names: [rec.merchantName],
    identifiers: {},
    ingestedAt: now,
    source,
    extra: { fromAdapter: adapterName, merchant: true },
  }];

  // Items
  const items = [];
  if (Array.isArray(rec.items)) {
    for (const it of rec.items) {
      if (!it || !it.name) continue;
      items.push({
        id: newId(),
        type: "item",
        subtype: "product",
        name: it.name,
        merchant: merchantId,
        price: it.unitPrice != null
          ? { value: Number(it.unitPrice) || 0, currency: rec.totalAmount?.currency || "CNY" }
          : null,
        ingestedAt: now,
        source,
        extra: {
          quantity: it.quantity || 1,
          sku: it.sku || null,
          fromAdapter: adapterName,
        },
      });
    }
  }

  // Event
  const subtype = mapStatusToSubtype(rec.status);
  const eventId = newId();
  const event = {
    id: eventId,
    type: "event",
    subtype,
    occurredAt,
    actor: "person-self",
    participants: ["person-self", merchantId],
    content: {
      title: `${rec.merchantName} 订单 ${rec.orderId}`,
      ...(rec.totalAmount && Number.isFinite(rec.totalAmount.value)
        ? { amount: { value: rec.totalAmount.value, currency: rec.totalAmount.currency || "CNY", direction: subtype === "refund" ? "in" : "out" } }
        : {}),
      ...(items.length > 0 ? { text: items.map((i) => `${i.name} x${i.extra.quantity || 1}`).join("; ") } : {}),
    },
    ingestedAt: now,
    source,
    extra: {
      vendorId: rec.vendorId,
      orderId: rec.orderId,
      merchantName: rec.merchantName,
      merchantOrderNumber: rec.orderId, // cross-source link to Email + Alipay
      orderStatus: rec.status || "placed",
      itemCount: items.length,
      ...(rec.recipient ? { recipient: rec.recipient } : {}),
      ...(rec.shippingAddress ? { shippingAddress: rec.shippingAddress } : {}),
      ...(rec.trackingNumber ? { trackingNumber: rec.trackingNumber } : {}),
      ...(rec.coupons ? { coupons: rec.coupons } : {}),
      ...(rec.paidAt ? { paidAt: rec.paidAt } : {}),
      ...(rec.extras ? { vendorExtras: rec.extras } : {}),
    },
  };

  return { events: [event], persons, places: [], items, topics: [] };
}

function mapStatusToSubtype(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("refund") || s.includes("退款")) return "refund";
  if (s.includes("cancel") || s.includes("close") || s.includes("已取消") || s.includes("已关闭")) return "cancelled";
  // All other order states ("placed", "shipped", "delivered") map to
  // `order` subtype — the lifecycle status is in extra.orderStatus.
  return "order";
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w一-鿿-]/g, "")
    .slice(0, 80);
}

// ─── CookieAuth helper ──────────────────────────────────────────────────

/**
 * Cookie storage + validation helper. Each platform adapter constructs
 * one and uses validate() before sync.
 */
class CookieAuth {
  constructor(opts = {}) {
    if (!opts.platform) throw new Error("CookieAuth: opts.platform required");
    this.platform = opts.platform;
    this.cookies = opts.cookies || ""; // raw "k=v; k2=v2" string
    this._validator = opts.validator || null; // optional async fn(cookies) → boolean
  }

  setCookies(raw) {
    if (typeof raw !== "string") throw new Error("setCookies: string required");
    this.cookies = raw;
  }

  /**
   * Get the cookie string for adding to Headers. Returns null when
   * cookies are empty.
   */
  toHeader() {
    return this.cookies && this.cookies.length > 0 ? this.cookies : null;
  }

  /**
   * Validate that the stored cookies are still good. Without an
   * injected validator returns true if non-empty (caller decides
   * whether to probe the platform).
   */
  async validate() {
    if (!this.cookies) return false;
    if (this._validator) return await this._validator(this.cookies);
    return true;
  }

  /**
   * Read a specific cookie value by name (case-insensitive).
   */
  getCookieValue(name) {
    if (!this.cookies || !name) return null;
    const re = new RegExp(`(?:^|;\\s*)${escapeRegex(name)}=([^;]*)`, "i");
    const m = re.exec(this.cookies);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

module.exports = {
  normalizeOrderRecord,
  mapStatusToSubtype,
  CookieAuth,
};
