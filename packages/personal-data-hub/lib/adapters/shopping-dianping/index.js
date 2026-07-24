/**
 * §2.4d 购物 long-tail — Dianping (大众点评) adapter, dual-mode (snapshot + cookie-api).
 *
 * 大众点评 is a Phase 7 inventory platform (ROI ⭐⭐⭐⭐ in
 * docs/design/Personal_Data_Hub_Architecture.md §12.1) that was skipped when
 * the shopping 三件套 (taobao/jd/meituan) + pinduoduo shipped. It is owned by
 * Meituan and shares the same order/H5 backend, so this adapter mirrors
 * shopping-meituan's structure: 团购订单 (group-buy orders) map cleanly onto
 * the vendor-neutral OrderRecord (POI = merchantName, deals = items).
 *
 *   1. snapshot mode (opts.inputPath): ingest a snapshot JSON produced by a
 *      browser extension / Android in-APK collector / hand-roll. Stateless —
 *      account OPTIONAL at construction.
 *
 *   2. cookie-api mode (opts.account.cookies): fetch the Dianping order centre
 *      via the injected `fetchFn` (Android in-APK cc → OkHttp; desktop hub →
 *      Electron WebView net request), paginating with the `page` cursor and
 *      stopping at the `sinceWatermark`. account.userId REQUIRED in this mode.
 *
 *      ── sign seam ──────────────────────────────────────────────────────────
 *      Dianping's H5 / m-API requests carry an anti-bot token (`_token` /
 *      `mtgsig`, analogous to 拼多多 anti_token / 美团 mtgsig) computed by
 *      client-side JS. No pure-Node implementation survives the rotation, so
 *      signing is injected via `opts.signProvider` (or constructor
 *      `signProvider`). When absent the request is still issued with
 *      `sign: null`; HTTP/non-JSON rejection is surfaced as a sync failure and
 *      preserves the previous watermark. The endpoint constant is best-effort
 *      and overridable via `opts.ordersUrl`; Dianping/Meituan rotate H5 paths,
 *      so adjust / pass opts.ordersUrl if it drifts (FAMILY-23 playbook —
 *      endpoints are not field-verified here).
 *
 * Snapshot schema (schemaVersion 1, mirrors the sibling shopping collectors):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "dianping",
 *     "account": { "userId": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<orderId>", "capturedAt": <ms>,
 *         "orderId": "...", "merchantName": "...", "platform": "groupbuy|reservation",
 *         "items": [{ "name": ..., "quantity": ..., "unitPrice": ... }],
 *         "placedAt": ..., "paidAt": ..., "status": "...",
 *         "totalAmount": { "value": ..., "currency": "CNY" },
 *         "recipient": "...", "shippingAddress": "..." }
 *     ]
 *   }
 *
 * Future: 评价 / 收藏 (reviews / favorites — Dianping's signature UGC) once a
 * review-shaped UnifiedSchema record type lands; v0.1 scopes to orders for
 * parity with the other shopping adapters.
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

const NAME = "shopping-dianping";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);
const UNKNOWN_ORDERS = Object.freeze([]);

// Best-effort Dianping order-centre list endpoint (shares Meituan's H5 infra).
// Overridable via opts.ordersUrl; the injected fetchFn host may also point at
// whichever order API the captured cookie is currently scoped to.
const DIANPING_ORDERS_URL = "https://m.dianping.com/order/list";

class DianpingAdapter {
  constructor(opts = {}) {
    // account OPTIONAL — snapshot mode is stateless. Cookie-api mode activates
    // only when account.cookies is supplied; account.userId is then required
    // (checked at sync time).
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({
            platform: "dianping",
            cookies: opts.account.cookies,
          })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // sign seam — async fn({ url, query, cookies }) → string|null. When absent,
    // requests carry sign: null (best-effort, the endpoint may reject).
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : DIANPING_ORDERS_URL;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "userId";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:dianping-orders",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: ["dianping:orderId / poiName / deals / totalPrice / address"],
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
      platform: "dianping",
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
        "DianpingAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode — sign via signProvider)",
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
      "DianpingAdapter.sync: needs opts.inputPath OR configured account.cookies OR opts.cookie + opts.accountId (cookie-api signing via signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-dianping.sync: snapshot must be JSON. Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-dianping.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      platform: "dianping",
      identityKey: "userId",
    });
    if (!account || !account.userId) {
      throw new Error(
        "DianpingAdapter._syncViaCookie: account.userId or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000; // default last year
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : 10;
    const include = opts.include || {};
    if (include[KIND_ORDER] === false) return;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;

    let emitted = 0;
    let page = 1;
    let scanComplete = false;
    while (page <= maxPages) {
      const query = { page, pageSize, ts: Date.now() };
      // sign seam — best-effort. null when no signProvider.
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({
          url: this._ordersUrl,
          query,
          cookies,
        });
      }
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({ operation: KIND_ORDER, page });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies,
        query,
        sign,
      });
      const orders = extractOrders(resp);
      if (!orders.length) {
        scanComplete = orders !== UNKNOWN_ORDERS;
        break;
      }
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
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          originalId: rec.orderId,
          capturedAt: rec.paidAt || rec.placedAt || Date.now(),
          payload: { record: rec },
        };
        emitted += 1;
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
      throw new Error("DianpingAdapter.normalize: payload missing");
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
  return `dianping:${kind}:${safe}`;
}

/**
 * Pull the order array out of a Dianping order-centre response. Dianping nests
 * the list under different keys across H5 versions; the injected fetchFn may
 * also pre-flatten to `{ orders }`. Tolerant of all common shapes.
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return UNKNOWN_ORDERS;
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.orderList)) return resp.orderList;
  if (Array.isArray(resp.list)) return resp.list;
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  if (data) {
    if (Array.isArray(data.orders)) return data.orders;
    if (Array.isArray(data.orderList)) return data.orderList;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.records)) return data.records;
  }
  return UNKNOWN_ORDERS;
}

/**
 * Map one Dianping order object → vendor-neutral OrderRecord. Field names are
 * best-effort across H5 versions (camelCase + snake_case fallbacks). Amounts
 * are treated as 元 (Dianping H5 returns decimal-yuan strings); an integer
 * `*Fen` field is divided by 100.
 */
function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const orderId =
    o.orderId || o.unifiedOrderId || o.dealId || o.id || o.order_id;
  if (!orderId) return null;
  const merchant =
    o.shopName ||
    o.poiName ||
    o.dealTitle ||
    o.title ||
    o.merchantName ||
    "大众点评";

  const items = [];
  const rawItems = o.dealList || o.deals || o.itemList || o.items || [];
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    if (!it) continue;
    items.push({
      name: it.name || it.dealName || it.dealTitle || it.title,
      quantity: parseInt(it.quantity || it.count || it.num || 1, 10),
      unitPrice: parseAmount(it.price || it.unitPrice || it.dealPrice || 0),
      sku: it.dealId || it.sku || it.skuId || null,
    });
  }

  return {
    vendorId: "dianping",
    orderId: String(orderId),
    placedAt: parseTime(
      o.orderTime || o.addTime || o.createTime || o.order_time,
    ),
    paidAt: parseTime(o.payTime || o.paidTime || o.pay_time),
    status: mapStatus(o.statusText || o.statusDesc || o.statusName || o.status),
    merchantName: merchant,
    totalAmount: {
      value: parseAmount(
        o.totalPrice != null
          ? o.totalPrice
          : o.payMoney != null
            ? o.payMoney
            : o.payAmount != null
              ? o.payAmount
              : o.totalFee != null
                ? o.totalFee
                : o.amount,
        o.totalFen != null ? o.totalFen : o.payFen,
      ),
      currency: "CNY",
    },
    items,
    recipient: o.recipientName || o.contactName || null,
    shippingAddress:
      o.recipientAddress || o.deliveryAddress || o.address || null,
    extras: { capturedBy: "cookie-api", platform: "dianping" },
  };
}

function snapshotEventToRecord(ev) {
  const items = [];
  const rawItems = Array.isArray(ev.items) ? ev.items : [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.dealName || it.title,
      quantity: parseInt(it.quantity || it.count || 1, 10),
      unitPrice: parseAmount(it.unitPrice || it.price || 0),
      sku: it.sku || it.dealId || null,
    });
  }
  return {
    vendorId: "dianping",
    orderId: String(ev.orderId || ev.id || "unknown"),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: mapStatus(ev.status),
    merchantName: ev.merchantName || "大众点评",
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
    extras: { platform: ev.platform || "dianping", capturedBy: "snapshot" },
  };
}

/**
 * Resolve a money value. Prefer an explicit 元 field; fall back to a 分 (cents)
 * integer field divided by 100. Tolerates numeric or decimal-string input.
 */
function parseAmount(yuanVal, fenVal) {
  if (yuanVal != null && yuanVal !== "") {
    const n = parseFloat(yuanVal);
    if (Number.isFinite(n)) return n;
  }
  if (fenVal != null && fenVal !== "") {
    const n = Number(fenVal);
    if (Number.isFinite(n)) return Math.round(n) / 100;
  }
  return 0;
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
  if (t.includes("退款") || t.includes("退订") || t.includes("refund"))
    return "refunded";
  if (t.includes("取消") || t.includes("cancel") || t.includes("已关闭"))
    return "cancelled";
  if (t.includes("配送") || t.includes("派送") || t.includes("shipped"))
    return "shipped";
  if (
    t.includes("已完成") ||
    t.includes("已消费") ||
    t.includes("已使用") ||
    t.includes("delivered")
  )
    return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("DianpingAdapter: no fetchFn configured for cookie-api mode");
}

module.exports = {
  DianpingAdapter,
  orderToRecord,
  extractOrders,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
