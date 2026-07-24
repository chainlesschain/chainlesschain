/**
 * 购物/外卖 — Ele.me (饿了么) adapter, dual-mode (snapshot + cookie-api).
 *
 * 饿了么 is China's #2 food-delivery platform (Alibaba-owned, shares the
 * Taobao/Alipay account + cookie infrastructure). It is NOT on the §12.1 真机
 * inventory roadmap (the reference Redmi device didn't have it installed) but
 * is a high-value personal-data source — 外卖订单 carry eating habits, delivery
 * addresses, merchants, and spend. This adapter mirrors shopping-meituan (the
 * sibling 外卖 platform) for normalize parity, plus pinduoduo's `signProvider`
 * seam (Alibaba mtop endpoints need a client-computed signature like 拼多多's
 * anti_token).
 *
 *   1. snapshot mode (opts.inputPath): ingest a snapshot JSON produced by the
 *      Android in-APK cc (WebView cookie scrape + OkHttp fetch of the order
 *      list) or a hand-roll export. Stateless — account OPTIONAL.
 *
 *   2. cookie-api mode (opts.account.cookies): fetch the Ele.me order list via
 *      the injected `fetchFn`, paginating with a limit/offset cursor and
 *      stopping at the `sinceWatermark`. account.userId REQUIRED in this mode.
 *
 * ── signing seam ─────────────────────────────────────────────────────────
 *   Ele.me's order endpoints sit behind Alibaba's mtop gateway, which usually
 *   requires an `x-sign`/`x-mini-wua` token computed by client-side JS. No
 *   pure-Node implementation survives the rotation, so signing is injected via
 *   `opts.signProvider` (async ({ url, query, cookies }) → string|null). On
 *   Android the in-APK WebView JS VM produces it; in tests a stub returns a
 *   fixed value. When no signProvider is configured the request is still issued
 *   with `sign: null`; HTTP/non-JSON rejection is surfaced as a sync failure so
 *   the previous watermark is preserved.
 *
 *   ⚠️ The default endpoint (ELEME_ORDERS_URL) is best-effort and NOT
 *   field-verified — override via `opts.ordersUrl` once the real SOA path is
 *   captured (FAMILY-23 playbook). Snapshot mode is the reliable path.
 *
 * Snapshot schema (mirrors a future ElemeLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "eleme",
 *     "account": { "userId": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<orderId>", "capturedAt": <ms>,
 *         "orderId": "...", "merchantName": "...",
 *         "items": [{ "name": ..., "quantity": ..., "unitPrice": ... }],
 *         "placedAt": ..., "paidAt": ..., "status": "...",
 *         "totalAmount": { "value": ..., "currency": "CNY" },
 *         "recipient": "...", "shippingAddress": "..." }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  normalizeOrderRecord,
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "shopping-eleme";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);
const UNKNOWN_ORDERS = Object.freeze([]);

// Best-effort, NOT field-verified. Override via opts.ordersUrl.
const ELEME_ORDERS_URL = "https://www.ele.me/restapi/bos/v2/users/orders";

class ElemeAdapter {
  constructor(opts = {}) {
    // account is OPTIONAL — snapshot mode is stateless. Cookie-api mode
    // activates only when account.cookies is supplied; account.userId is then
    // required (checked at sync time).
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "eleme", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // mtop signing seam — see file header. Async fn({ url, query, cookies }) →
    // string|null. When absent, requests carry sign: null.
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : ELEME_ORDERS_URL;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "userId";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:eleme-orders",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "eleme:orderId / restaurantName / dishes / totalAmount / deliveryAddress",
      ],
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
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "eleme",
      identityKey: "userId",
    });
    if (cookieAuth) {
      const ok = await cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      if (!account || !account.userId) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USER_ID",
          message: "cookie-api mode requires account.userId",
        };
      }
      return { ok: true, account: account.userId, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "ElemeAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode — mtop signing via signProvider)",
    };
  }

  async healthCheck(opts = {}) {
    if (this._cookieAuth || hasRuntimeCookie(opts)) {
      const r = await this.authenticate(opts);
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
    if (this._cookieAuth || hasRuntimeCookie(opts)) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "ElemeAdapter.sync: needs opts.inputPath OR configured account.cookies OR opts.cookie + opts.accountId (cookie-api signing via signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-eleme.sync: snapshot must be JSON (HTML parsing is future work). Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-eleme.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "eleme",
      identityKey: "userId",
    });
    if (!account || !account.userId) {
      throw new Error(
        "ElemeAdapter._syncViaCookie: account.userId or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000; // default last year
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : 10;
    const include = opts.include || {};
    if (include[KIND_ORDER] === false) return;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    let page = 1;
    let scanComplete = false;
    while (page <= maxPages) {
      const offset = (page - 1) * pageSize;
      const query = { limit: pageSize, offset, userId: account.userId };
      // mtop signing seam — best-effort. null when no signProvider.
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({
          url: this._ordersUrl,
          query,
          cookies: cookieAuth.toHeader(),
        });
      }
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({ operation: KIND_ORDER, page });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies: cookieAuth.toHeader(),
        sign,
        query,
      });
      const orders = extractOrders(resp);
      if (!orders.length) {
        scanComplete = orders !== UNKNOWN_ORDERS;
        break;
      }
      let pageHasNew = false;
      let reachedWatermark = false;
      for (const rawOrder of orders) {
        const rec = orderToRecord(rawOrder);
        if (!rec) continue;
        if (rec.placedAt && rec.placedAt < sinceMs) {
          reachedWatermark = true; // everything from here on is older
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
      if (reachedWatermark || (pageHasNew && orders.length < pageSize)) {
        scanComplete = true;
        break;
      }
      if (!pageHasNew) break;
      page += 1;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("ElemeAdapter.normalize: payload missing");
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
  return `eleme:${kind}:${safe}`;
}

/**
 * Pull the order array out of an Ele.me order-list response. The nesting key
 * varies across endpoint versions; the injected fetchFn may also pre-flatten to
 * `{ orders }`. Tolerant of all common shapes.
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return UNKNOWN_ORDERS;
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.order_list)) return resp.order_list;
  if (Array.isArray(resp.list)) return resp.list;
  if (resp.data && Array.isArray(resp.data.orders)) return resp.data.orders;
  if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
  if (resp.result && Array.isArray(resp.result.orders))
    return resp.result.orders;
  return UNKNOWN_ORDERS;
}

/**
 * Map one Ele.me order object → vendor-neutral OrderRecord. Ele.me restapi
 * amounts are in 元 (yuan, with decimals); field names are best-effort across
 * endpoint versions (camelCase + snake_case fallbacks).
 */
function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.order_id || o.orderId || o.id || o.unique_id || o.uniqueId;
  if (!orderId) return null;
  const merchant =
    o.restaurant_name ||
    o.restaurantName ||
    o.shop_name ||
    o.shopName ||
    o.merchantName ||
    "饿了么";

  const items = [];
  const dishes =
    o.basket ||
    o.dishes ||
    o.items ||
    o.item_list ||
    o.itemList ||
    o.foods ||
    [];
  for (const it of Array.isArray(dishes) ? dishes : []) {
    if (!it) continue;
    items.push({
      name: it.name || it.dishName || it.food_name || it.title,
      quantity: parseInt(it.quantity || it.count || it.num || 1, 10),
      unitPrice: parseFloat(it.price || it.unitPrice || it.unit_price || 0),
      sku: it.sku_id || it.skuId || it.id || it.sku || null,
    });
  }

  return {
    vendorId: "eleme",
    orderId: String(orderId),
    placedAt: parseTime(
      o.time_pass_string ||
        o.order_time ||
        o.createTime ||
        o.created_at ||
        o.create_at,
    ),
    paidAt: parseTime(o.pay_time || o.payTime || o.paid_at),
    status: mapStatus(
      o.status_bar_text || o.statusText || o.status_text || o.status,
    ),
    merchantName: merchant,
    totalAmount: {
      value: parseFloat(
        o.total_amount ||
          o.totalAmount ||
          o.total ||
          o.pay_amount ||
          o.original_price ||
          0,
      ),
      currency: "CNY",
    },
    items,
    recipient: o.consignee || o.recipient || o.receiver || o.user_name || null,
    shippingAddress:
      o.address || o.delivery_address || o.deliveryAddress || o.addr || null,
    extras: { capturedBy: "cookie-api", platform: "eleme" },
  };
}

function snapshotEventToRecord(ev) {
  const items = [];
  const rawItems = Array.isArray(ev.items) ? ev.items : [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.dishName || it.food_name,
      quantity: parseInt(it.quantity || it.count || 1, 10),
      unitPrice: parseFloat(it.unitPrice || it.price || 0),
      sku: it.sku || it.sku_id || null,
    });
  }
  return {
    vendorId: "eleme",
    orderId: String(ev.orderId || ev.id || "unknown"),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: mapStatus(ev.status || "placed"),
    merchantName: ev.merchantName || ev.restaurant_name || "饿了么",
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
    extras: { capturedBy: "snapshot", platform: "eleme" },
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
  if (t.includes("退款") || t.includes("refund")) return "refunded";
  if (t.includes("取消") || t.includes("cancel")) return "cancelled";
  if (
    t.includes("配送中") ||
    t.includes("派送") ||
    t.includes("商家已接单") ||
    t.includes("shipped")
  )
    return "shipped";
  if (
    t.includes("已完成") ||
    t.includes("已送达") ||
    t.includes("已收货") ||
    t.includes("delivered")
  )
    return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("ElemeAdapter: no fetchFn configured");
}

module.exports = {
  ElemeAdapter,
  orderToRecord,
  extractOrders,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
