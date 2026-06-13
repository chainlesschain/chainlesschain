/**
 * §2.4c 购物三联 — Pinduoduo (拼多多) adapter, dual-mode (snapshot + cookie-api).
 *
 * v0.3 brings 拼多多 to parity with shopping-taobao / shopping-jd /
 * shopping-meituan by adding a cookie-api fetch path alongside the existing
 * snapshot ingest. As with the other shopping adapters the actual HTTP call is
 * delegated to an injected `fetchFn` (the Android in-APK cc uses OkHttp; the
 * desktop hub uses an Electron WebView net request) so this module stays a
 * pure-Node parser + orchestrator.
 *
 *   1. snapshot mode (opts.inputPath): ingest a snapshot JSON produced by a
 *      browser extension / hand-roll (stateless — account OPTIONAL).
 *
 *   2. cookie-api mode (opts.account.cookies): fetch
 *      `mobile.yangkeduo.com/proxy/api/galerie/transaction/transaction_list`
 *      via the injected `fetchFn`, paginating with the `pageNumber` cursor and
 *      stopping at the `sinceWatermark`. account.uid REQUIRED in this mode.
 *
 * ── anti_token signing seam ──────────────────────────────────────────────
 *   Pinduoduo's transaction_list requires an `anti_token` (a.k.a.
 *   `anti-content`) computed by client-side JS — analogous to 抖音 X-Bogus.
 *   No pure-Node implementation survives pinduoduo's anti_token rotation, so
 *   the signing itself is injected via `opts.signProvider` (or constructor
 *   `signProvider`). On Android the in-APK WebView JS VM produces the token;
 *   in tests a stub returns a fixed value. When no signProvider is configured
 *   the request is still issued with `antiToken: null` — best-effort, the
 *   endpoint may 403, which surfaces as zero events rather than a crash.
 *
 * Snapshot schema (mirrors PinduoduoLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "pinduoduo",
 *     "account": { "uid": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<orderSn>", "capturedAt": <ms>,
 *         "orderId": "...",            // pinduoduo's order_sn
 *         "merchantName": "...",       // mall_name
 *         "items": [{ "name": ..., "quantity": ..., "unitPrice": ..., "sku": ... }],
 *         "placedAt": ...,             // create_at_text or order_create_at
 *         "paidAt": ...,
 *         "status": "placed|shipped|delivered|cancelled|refunded",
 *         "totalAmount": { "value": ..., "currency": "CNY" },
 *         "recipient": "...",
 *         "shippingAddress": "...",
 *         "trackingNumber": "..." }
 *     ]
 *   }
 *
 * Future v0.4: HTML parsing (`Save As Webpage` from `mobile.yangkeduo.com/
 * users/orders.html` — pinduoduo's order list endpoint).
 */

"use strict";

const fs = require("node:fs");
const { normalizeOrderRecord, CookieAuth } = require("../shopping-base");

const NAME = "shopping-pinduoduo";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

const PINDUODUO_ORDERS_URL =
  "https://mobile.yangkeduo.com/proxy/api/galerie/transaction/transaction_list";

class PinduoduoAdapter {
  constructor(opts = {}) {
    // §2.4c: account is OPTIONAL — snapshot mode is stateless. Cookie-api mode
    // activates only when account.cookies is supplied; account.uid is then
    // required (checked at sync time).
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "pinduoduo", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // anti_token signing seam — see file header. Async fn({ url, query,
    // cookies }) → string|null. When absent, requests carry antiToken: null.
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "sync:cookie-api", "parse:pinduoduo-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "pinduoduo:order_sn / mall_name / goods_list / order_amount / address",
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
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok) return { ok: false, reason: "INVALID_COOKIE", error: "cookies missing" };
      if (!this.account || !this.account.uid) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_UID",
          message: "cookie-api mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "PinduoduoAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode — anti_token signing via signProvider)",
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
      "PinduoduoAdapter.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode; pinduoduo's web API requires anti_token signing supplied via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    // v0.2 explicit JSON-only. HTML parsing (SAF-exported webpage from
    // yangkeduo.com order list) is future v0.4 work.
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-pinduoduo.sync: snapshot must be JSON (v0.4 will add HTML parsing). Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-pinduoduo.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
    if (!this.account || !this.account.uid) {
      throw new Error(
        "PinduoduoAdapter._syncViaCookie: account.uid required (set via new PinduoduoAdapter({ account: { uid, cookies } }))",
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

    let pageNumber = 1;
    while (true) {
      const query = { pageNumber, pageSize, ts: Date.now() };
      // anti_token signing seam — best-effort. null when no signProvider.
      let antiToken = null;
      if (this._signProvider) {
        antiToken = await this._signProvider({
          url: PINDUODUO_ORDERS_URL,
          query,
          cookies: this._cookieAuth.toHeader(),
        });
      }
      const resp = await this._fetchFn({
        url: PINDUODUO_ORDERS_URL,
        cookies: this._cookieAuth.toHeader(),
        antiToken,
        query,
      });
      const orders = extractOrders(resp);
      if (!orders.length) break;
      let pageHasNew = false;
      let reachedWatermark = false;
      for (const raw of orders) {
        const rec = orderToRecord(raw);
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
      // Stop once we've crossed the watermark, drained the page, or the page
      // came back short (last page).
      if (reachedWatermark || !pageHasNew || orders.length < pageSize) break;
      pageNumber += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("PinduoduoAdapter.normalize: payload missing");
    }
    // Cookie-api mode wraps a normalized record under payload.record; snapshot
    // mode carries the raw event fields directly on the payload.
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
  return `pinduoduo:${kind}:${safe}`;
}

/**
 * Pull the order array out of a transaction_list response. Pinduoduo nests it
 * under different keys across endpoint versions; the injected fetchFn may also
 * pre-flatten to `{ orders }`. Tolerant of all common shapes.
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.order_list)) return resp.order_list;
  if (Array.isArray(resp.list)) return resp.list;
  if (resp.result && Array.isArray(resp.result.order_list)) return resp.result.order_list;
  if (resp.result && Array.isArray(resp.result.list)) return resp.result.list;
  return [];
}

/**
 * Map one pinduoduo transaction_list order object → vendor-neutral OrderRecord.
 * Pinduoduo amounts are in 分 (cents); converted to 元 here. Field names are
 * best-effort across endpoint versions (camelCase + snake_case fallbacks).
 */
function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.order_sn || o.orderSn || o.orderId || o.id;
  if (!orderId) return null;
  const merchant = o.mall_name || o.mallName || o.merchantName || o.shop_name || "拼多多";

  const items = [];
  const rawItems = o.goods_list || o.order_goods || o.goodsList || o.items || [];
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    if (!it) continue;
    items.push({
      name: it.goods_name || it.goodsName || it.name || it.skuName,
      quantity: parseInt(it.goods_number || it.goods_count || it.quantity || 1, 10),
      unitPrice: centsToYuan(it.goods_price || it.goodsPrice || it.unitPrice || 0),
      sku: it.sku_id || it.skuId || it.goods_id || it.sku || null,
    });
  }

  return {
    vendorId: "pinduoduo",
    orderId: String(orderId),
    placedAt: parseTime(o.order_time || o.create_at || o.createAt || o.order_create_at),
    paidAt: parseTime(o.pay_time || o.payTime || o.group_order_pay_time),
    status: mapStatus(pickStatusText(o)),
    merchantName: merchant,
    totalAmount: {
      value: centsToYuan(o.order_amount || o.orderAmount || o.pay_amount || o.total_amount || 0),
      currency: "CNY",
    },
    items,
    recipient: o.receive_name || o.receiver || o.recipient || null,
    shippingAddress: o.address || o.receive_address || o.shippingAddress || null,
    trackingNumber: o.tracking_number || o.waybill_no || o.trackingNumber || null,
    extras: { capturedBy: "cookie-api", platform: "pinduoduo" },
  };
}

/**
 * Pinduoduo carries a human-readable status under several keys; prefer text
 * over the numeric `order_status` code so mapStatus's keyword match works.
 */
function pickStatusText(o) {
  const text =
    o.order_status_prompt ||
    o.orderStatusPrompt ||
    o.status_prompt ||
    o.statusPrompt ||
    o.status_desc ||
    null;
  if (text) return text;
  // Fall back to the numeric order_status code (best-effort PDD mapping).
  const code = o.order_status != null ? o.order_status : o.orderStatus;
  switch (Number(code)) {
    case 1:
      return "待付款";
    case 2:
      return "待发货";
    case 3:
      return "已发货";
    case 4:
      return "已完成";
    case 5:
    case 6:
      return "已关闭";
    default:
      return o.status != null ? String(o.status) : "";
  }
}

function centsToYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Snapshot/test inputs may already be 元 with a decimal point; treat any
  // non-integer as 元, integers as 分.
  if (!Number.isInteger(n)) return n;
  return Math.round(n) / 100;
}

function snapshotEventToRecord(ev) {
  const items = [];
  const rawItems = Array.isArray(ev.items) ? ev.items : [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.goods_name || it.skuName,
      quantity: parseInt(it.quantity || it.goods_count || 1, 10),
      unitPrice: parseFloat(it.unitPrice || it.goods_price || 0),
      sku: it.sku || it.sku_id || null,
    });
  }
  return {
    vendorId: "pinduoduo",
    orderId: String(ev.orderId || ev.id || "unknown"),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: mapStatus(ev.status),
    merchantName: ev.merchantName || ev.mall_name || "拼多多",
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
    trackingNumber: ev.trackingNumber || null,
    extras: { capturedBy: "snapshot", platform: "pinduoduo" },
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
  if (t.includes("取消") || t.includes("cancel") || t.includes("已关闭")) return "cancelled";
  if (t.includes("已发货") || t.includes("配送") || t.includes("shipped")) return "shipped";
  if (t.includes("已完成") || t.includes("已收货") || t.includes("delivered")) return "delivered";
  // Pinduoduo-specific statuses
  if (t === "placed" || t.includes("待付款") || t.includes("待支付")) return "placed";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("PinduoduoAdapter: no fetchFn configured");
}

module.exports = {
  PinduoduoAdapter,
  orderToRecord,
  extractOrders,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
