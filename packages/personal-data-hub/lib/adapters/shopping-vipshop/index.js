/**
 * 购物 — VIP.com (唯品会) adapter, dual-mode (snapshot + cookie-api).
 *
 * 唯品会 (com.achievo.vipshop) is a major Chinese flash-sale (品牌特卖) e-commerce
 * platform. It is NOT on the §12.1 真机 roadmap nor the reference device, but is
 * a high-value personal-data source — 订单 carry brand/品类 preferences, spend,
 * and shipping addresses. Mirrors shopping-eleme / shopping-taobao (snapshot +
 * cookie-api dual path, 元 amounts) with VIP's own order endpoint + signing seam.
 *
 *   1. snapshot mode (opts.inputPath): ingest a snapshot JSON produced by the
 *      Android in-APK cc (WebView cookie scrape + order fetch) or a hand-roll
 *      export. Stateless — account OPTIONAL.
 *
 *   2. cookie-api mode (opts.account.cookies): fetch the VIP order list via the
 *      injected `fetchFn`, paginating with a page cursor and stopping at the
 *      `sinceWatermark`. account.userId REQUIRED in this mode.
 *
 * ── signing seam ─────────────────────────────────────────────────────────
 *   VIP's mapi endpoints require an `api_sign`/`fdc_area_id` style token. No
 *   pure-Node implementation survives the rotation, so signing is injected via
 *   `opts.signProvider` (async ({ url, query, cookies }) → string|null). When no
 *   signProvider is configured the request is still issued with `sign: null` —
 *   best-effort: the endpoint may 4xx, surfacing as zero events not a crash.
 *
 *   ⚠️ The default endpoint (VIPSHOP_ORDERS_URL) is best-effort and NOT
 *   field-verified — override via `opts.ordersUrl` once the real path is
 *   captured (FAMILY-23 playbook). Snapshot mode is the reliable path.
 *
 * Snapshot schema:
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "vipshop",
 *     "account": { "userId": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<orderSn>", "capturedAt": <ms>,
 *         "orderId": "...", "merchantName": "...",   // brand / store
 *         "items": [{ "name": ..., "quantity": ..., "unitPrice": ... }],
 *         "placedAt": ..., "paidAt": ..., "status": "...",
 *         "totalAmount": { "value": ..., "currency": "CNY" },
 *         "recipient": "...", "shippingAddress": "..." }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { normalizeOrderRecord, CookieAuth } = require("../shopping-base");

const NAME = "shopping-vipshop";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

// Best-effort, NOT field-verified. Override via opts.ordersUrl.
const VIPSHOP_ORDERS_URL = "https://mapi.vip.com/vips-mobile/rest/order/list/v2";

class VipshopAdapter {
  constructor(opts = {}) {
    // account is OPTIONAL — snapshot mode is stateless. Cookie-api mode
    // activates only when account.cookies is supplied; account.userId is then
    // required (checked at sync time).
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "vipshop", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // VIP signing seam — see file header. Async fn({ url, query, cookies }) →
    // string|null. When absent, requests carry sign: null.
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : VIPSHOP_ORDERS_URL;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "sync:cookie-api", "parse:vipshop-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: ["vipshop:orderSn / brandName / goods / amount / deliveryAddress"],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { order: true },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require
    // (see .claude/rules/testing.md).
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `snapshot not readable at ${ctx.inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      if (!this.account || !this.account.userId) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USER_ID",
          message: "cookie-api mode requires account.userId",
        };
      }
      return { ok: true, account: this.account.userId, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "VipshopAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode — signing via signProvider)",
    };
  }

  async healthCheck() {
    if (this._cookieAuth) {
      const r = await this.authenticate();
      return r.ok
        ? { ok: true, lastChecked: Date.now() }
        : { ok: false, reason: r.reason, error: r.error };
    }
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    if (this._cookieAuth) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "VipshopAdapter.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode; VIP's mapi requires signing supplied via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-vipshop.sync: snapshot must be JSON (HTML parsing is future work). Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-vipshop.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      const kind = ev.kind;
      if (!VALID_SNAPSHOT_KINDS.includes(kind)) continue;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.placedAt) ||
        parseTime(ev.paidAt) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.orderId ||
        null;

      yield {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!this.account || !this.account.userId) {
      throw new Error(
        "VipshopAdapter._syncViaCookie: account.userId required (set via new VipshopAdapter({ account: { userId, cookies } }))",
      );
    }
    if (!(await this._cookieAuth.validate())) return;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000; // default last year
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : 10;
    const include = opts.include || {};
    if (include[KIND_ORDER] === false) return;

    let page = 1;
    while (true) {
      const query = { page, pageSize, userId: this.account.userId };
      // VIP signing seam — best-effort. null when no signProvider.
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({
          url: this._ordersUrl,
          query,
          cookies: this._cookieAuth.toHeader(),
        });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies: this._cookieAuth.toHeader(),
        sign,
        query,
      });
      const orders = extractOrders(resp);
      if (!orders.length) break;
      let pageHasNew = false;
      let reachedWatermark = false;
      for (const rawOrder of orders) {
        const rec = orderToRecord(rawOrder);
        if (!rec) continue;
        if (rec.placedAt && rec.placedAt < sinceMs) {
          reachedWatermark = true;
          break;
        }
        pageHasNew = true;
        yield {
          adapter: NAME,
          originalId: rec.orderId,
          capturedAt: rec.paidAt || rec.placedAt || Date.now(),
          payload: { record: rec },
        };
      }
      if (reachedWatermark || !pageHasNew || orders.length < pageSize) break;
      page += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("VipshopAdapter.normalize: payload missing");
    }
    if (raw.payload.record) {
      return normalizeOrderRecord(raw.payload.record, {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    const rec = snapshotEventToRecord(raw.payload);
    return normalizeOrderRecord(rec, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `vipshop:${kind}:${safe}`;
}

/**
 * Pull the order array out of a VIP order-list response. The nesting key varies
 * across endpoint versions; the injected fetchFn may also pre-flatten to
 * `{ orders }`. Tolerant of all common shapes (VIP wraps under data.orders).
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.orderList)) return resp.orderList;
  if (Array.isArray(resp.list)) return resp.list;
  if (resp.data && Array.isArray(resp.data.orders)) return resp.data.orders;
  if (resp.data && Array.isArray(resp.data.orderList)) return resp.data.orderList;
  if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
  return [];
}

/**
 * Map one VIP order object → vendor-neutral OrderRecord. VIP amounts are in 元
 * (yuan, with decimals); field names are best-effort across endpoint versions
 * (camelCase + snake_case fallbacks).
 */
function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.order_sn || o.orderSn || o.order_id || o.orderId || o.id;
  if (!orderId) return null;
  const merchant =
    o.brand_name || o.brandName || o.store_name || o.storeName || o.supplier_name || o.merchantName || "唯品会";

  const items = [];
  const goods = o.goods_list || o.goodsList || o.goods || o.products || o.items || [];
  for (const it of Array.isArray(goods) ? goods : []) {
    if (!it) continue;
    items.push({
      name: it.goods_name || it.goodsName || it.product_name || it.name || it.title,
      quantity: parseInt(it.goods_num || it.num || it.quantity || it.count || 1, 10),
      unitPrice: parseFloat(it.vipshop_price || it.price || it.unitPrice || it.sale_price || 0),
      sku: it.size_id || it.sizeId || it.goods_id || it.sku || null,
    });
  }

  return {
    vendorId: "vipshop",
    orderId: String(orderId),
    placedAt: parseTime(o.add_time || o.order_time || o.create_time || o.createTime || o.created_at),
    paidAt: parseTime(o.pay_time || o.payTime || o.paid_at),
    status: mapStatus(o.order_status_name || o.statusName || o.status_text || o.statusText || o.order_status || o.status),
    merchantName: merchant,
    totalAmount: {
      value: parseFloat(o.money || o.order_amount || o.orderAmount || o.total_amount || o.pay_total || o.payAmount || 0),
      currency: "CNY",
    },
    items,
    recipient: o.consignee || o.receiver || o.recipient || o.user_name || null,
    shippingAddress: o.address || o.delivery_address || o.deliveryAddress || o.addr || null,
    extras: { capturedBy: "cookie-api", platform: "vipshop" },
  };
}

function snapshotEventToRecord(ev) {
  const items = [];
  const rawItems = Array.isArray(ev.items) ? ev.items : [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.goods_name || it.product_name,
      quantity: parseInt(it.quantity || it.num || 1, 10),
      unitPrice: parseFloat(it.unitPrice || it.price || 0),
      sku: it.sku || it.size_id || null,
    });
  }
  return {
    vendorId: "vipshop",
    orderId: String(ev.orderId || ev.id || "unknown"),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: mapStatus(ev.status || "placed"),
    merchantName: ev.merchantName || ev.brand_name || "唯品会",
    totalAmount:
      ev.totalAmount && typeof ev.totalAmount === "object"
        ? {
            value: parseFloat(ev.totalAmount.value || 0),
            currency: ev.totalAmount.currency || "CNY",
          }
        : { value: 0, currency: "CNY" },
    items,
    recipient: ev.recipient || null,
    shippingAddress: ev.shippingAddress || null,
    extras: { capturedBy: "snapshot", platform: "vipshop" },
  };
}

function parseTime(v) {
  if (Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function mapStatus(s) {
  const t = String(s || "").toLowerCase();
  if (t.includes("退款") || t.includes("退货") || t.includes("refund")) return "refunded";
  if (t.includes("取消") || t.includes("关闭") || t.includes("cancel")) return "cancelled";
  if (t.includes("待收货") || t.includes("已发货") || t.includes("配送") || t.includes("shipped")) return "shipped";
  if (t.includes("已完成") || t.includes("交易成功") || t.includes("已收货") || t.includes("delivered") || t.includes("success")) return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("VipshopAdapter: no fetchFn configured");
}

module.exports = {
  VipshopAdapter,
  orderToRecord,
  extractOrders,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
