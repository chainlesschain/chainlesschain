/**
 * 购物/二手 — Xianyu (闲鱼) adapter, dual-mode (snapshot + cookie-api).
 *
 * 闲鱼 (goofish, com.taobao.idlefish) is Alibaba's C2C second-hand marketplace
 * (shares the Taobao/Alipay account + cookie infrastructure under .taobao.com /
 * .goofish.com). It is NOT on the §12.1 真机 roadmap nor the reference device,
 * but is a high-value personal-data source — 二手买卖记录 carry purchase/sale
 * history, counterparties, spend, and income. Mirrors shopping-eleme (snapshot
 * + cookie-api dual path) with one twist: 闲鱼 is TWO-SIDED, so each order
 * carries a `side` (buy = 我买入, sell = 我卖出) and the counterparty role flips
 * accordingly (merchantName = seller on a buy, buyer on a sell).
 *
 *   1. snapshot mode (opts.inputPath): ingest a snapshot JSON produced by the
 *      Android in-APK cc (WebView cookie scrape + mtop fetch) or a hand-roll
 *      export. Stateless — account OPTIONAL.
 *
 *   2. cookie-api mode (opts.account.cookies): fetch the 闲鱼 order list via the
 *      injected `fetchFn`, paginating with a page cursor and stopping at the
 *      `sinceWatermark`. account.userId REQUIRED in this mode.
 *
 * ── signing seam ─────────────────────────────────────────────────────────
 *   闲鱼's order endpoints sit behind Alibaba's mtop gateway, which usually
 *   requires an `x-sign`/`x-mini-wua` token computed by client-side JS. No
 *   pure-Node implementation survives the rotation, so signing is injected via
 *   `opts.signProvider` (async ({ url, query, cookies }) → string|null). When no
 *   signProvider is configured the request is still issued with `sign: null` —
 *   best-effort: the endpoint may 4xx, surfacing as zero events not a crash.
 *
 *   ⚠️ The default endpoint (XIANYU_ORDERS_URL) is best-effort and NOT
 *   field-verified — override via `opts.ordersUrl` once the real mtop path is
 *   captured (FAMILY-23 playbook). Snapshot mode is the reliable path.
 *
 * Snapshot schema:
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "xianyu",
 *     "account": { "userId": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<orderId>", "capturedAt": <ms>,
 *         "orderId": "...", "side": "buy|sell", "title": "...",
 *         "counterparty": "...",       // seller (buy) or buyer (sell)
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

const NAME = "shopping-xianyu";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

// Best-effort, NOT field-verified. Override via opts.ordersUrl.
const XIANYU_ORDERS_URL = "https://h5api.m.goofish.com/h5/mtop.idle.trade.order.list/1.0/";

class XianyuAdapter {
  constructor(opts = {}) {
    // account is OPTIONAL — snapshot mode is stateless. Cookie-api mode
    // activates only when account.cookies is supplied; account.userId is then
    // required (checked at sync time).
    this.account = opts.account || null;
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "xianyu", cookies: opts.account.cookies })
        : null;
    this._fetchFn = typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // mtop signing seam — see file header. Async fn({ url, query, cookies }) →
    // string|null. When absent, requests carry sign: null.
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : XIANYU_ORDERS_URL;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "sync:cookie-api", "parse:xianyu-orders"];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: ["xianyu:orderId / side / itemTitle / counterparty / amount / address"],
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
        "XianyuAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode — mtop signing via signProvider)",
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
      "XianyuAdapter.sync: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie-api mode; 闲鱼's mtop API requires signing supplied via opts.signProvider)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-xianyu.sync: snapshot must be JSON (HTML parsing is future work). Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-xianyu.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        "XianyuAdapter._syncViaCookie: account.userId required (set via new XianyuAdapter({ account: { userId, cookies } }))",
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
    // 闲鱼 has separate buy/sell tabs; default to both. opts.sides overrides.
    const sides = Array.isArray(opts.sides) && opts.sides.length ? opts.sides : ["buy", "sell"];

    for (const side of sides) {
      let pageNumber = 1;
      while (true) {
        const query = { pageNumber, pageSize, tab: side, userId: this.account.userId };
        // mtop signing seam — best-effort. null when no signProvider.
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
          const rec = orderToRecord(rawOrder, side);
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
        pageNumber += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("XianyuAdapter.normalize: payload missing");
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
  return `xianyu:${kind}:${safe}`;
}

/**
 * Pull the order array out of a 闲鱼 mtop order-list response. The nesting key
 * varies; the injected fetchFn may also pre-flatten to `{ orders }`. Tolerant of
 * all common shapes (mtop wraps under data.* ).
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.order_list)) return resp.order_list;
  if (Array.isArray(resp.list)) return resp.list;
  if (resp.data && Array.isArray(resp.data.orders)) return resp.data.orders;
  if (resp.data && Array.isArray(resp.data.orderList)) return resp.data.orderList;
  if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
  if (resp.data && resp.data.cardList && Array.isArray(resp.data.cardList)) return resp.data.cardList;
  return [];
}

/**
 * Normalize a 闲鱼 side token to canonical "buy" | "sell". Accepts the platform's
 * various spellings (bought/sold, 买到/卖出, role codes).
 */
function normSide(side, o) {
  const s = String(side || (o && (o.tab || o.bizType || o.role || o.orderType)) || "").toLowerCase();
  if (s.includes("sell") || s.includes("sold") || s.includes("卖") || s === "2") return "sell";
  if (s.includes("buy") || s.includes("bought") || s.includes("买") || s === "1") return "buy";
  return "buy"; // default: most 闲鱼 history is purchases
}

/**
 * Map one 闲鱼 order object → vendor-neutral OrderRecord. 闲鱼 mtop amounts are
 * in 元 (yuan) strings/numbers; field names are best-effort across endpoint
 * versions (camelCase + snake_case fallbacks). `side` flips the counterparty
 * role (seller on a buy, buyer on a sell).
 */
function orderToRecord(o, side) {
  if (!o || typeof o !== "object") return null;
  const orderId = o.order_id || o.orderId || o.bizOrderId || o.id || o.mainOrderId;
  if (!orderId) return null;
  const resolvedSide = normSide(side, o);
  const title = o.title || o.itemTitle || o.item_title || o.subject || o.auctionTitle || "闲鱼商品";
  // On a buy the counterparty is the seller; on a sell it's the buyer.
  const counterparty =
    resolvedSide === "sell"
      ? o.buyer_nick || o.buyerNick || o.buyer || o.counterparty || null
      : o.seller_nick || o.sellerNick || o.seller || o.counterparty || null;

  const items = [{
    name: title,
    quantity: parseInt(o.quantity || o.itemNum || 1, 10),
    unitPrice: parseFloat(o.price || o.item_price || o.unitPrice || o.actualFee || 0),
    sku: o.item_id || o.itemId || o.auctionId || null,
  }];

  return {
    vendorId: "xianyu",
    orderId: String(orderId),
    placedAt: parseTime(o.order_time || o.createTime || o.created_at || o.create_at || o.gmtCreate),
    paidAt: parseTime(o.pay_time || o.payTime || o.paid_at),
    status: mapStatus(o.status_text || o.statusText || o.status_desc || o.orderStatus || o.status),
    merchantName: counterparty || (resolvedSide === "sell" ? "买家" : "卖家"),
    totalAmount: {
      value: parseFloat(o.total_amount || o.totalAmount || o.actualFee || o.payAmount || o.price || 0),
      currency: "CNY",
    },
    items,
    recipient: o.receiver || o.recipient || o.receiverName || null,
    shippingAddress: o.address || o.delivery_address || o.deliveryAddress || null,
    extras: { capturedBy: "cookie-api", platform: "xianyu", side: resolvedSide },
  };
}

function snapshotEventToRecord(ev) {
  const side = normSide(ev.side, ev);
  const title = ev.title || ev.itemTitle || ev.name || "闲鱼商品";
  const rawItems = Array.isArray(ev.items) && ev.items.length ? ev.items : [{ name: title }];
  const items = [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.itemTitle || title,
      quantity: parseInt(it.quantity || 1, 10),
      unitPrice: parseFloat(it.unitPrice || it.price || 0),
      sku: it.sku || it.itemId || null,
    });
  }
  return {
    vendorId: "xianyu",
    orderId: String(ev.orderId || ev.id || "unknown"),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: mapStatus(ev.status || "placed"),
    merchantName: ev.counterparty || (side === "sell" ? "买家" : "卖家"),
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
    extras: { capturedBy: "snapshot", platform: "xianyu", side },
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
  if (t.includes("待收货") || t.includes("已发货") || t.includes("运送") || t.includes("shipped")) return "shipped";
  if (t.includes("已完成") || t.includes("交易成功") || t.includes("已收货") || t.includes("delivered") || t.includes("success")) return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("XianyuAdapter: no fetchFn configured");
}

module.exports = {
  XianyuAdapter,
  orderToRecord,
  extractOrders,
  normSide,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
