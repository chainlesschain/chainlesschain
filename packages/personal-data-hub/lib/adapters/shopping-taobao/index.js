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

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  normalizeOrderRecord,
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "shopping-taobao";
const VERSION = "0.6.0"; // §2.4d snapshot mode for Android in-APK cc
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

const TAOBAO_ORDERS_URL = "https://h5.m.taobao.com/mlapp/olist.html";

class TaobaoAdapter {
  constructor(opts = {}) {
    // §2.4d v0.2 — account.userId OPTIONAL (mirror shopping-jd/meituan/pinduoduo
    // dual-mode). Snapshot mode is stateless; cookie mode requires it; checked
    // at sync time, not construction. Earlier strict ctor blocked auto-register
    // at boot → user-driven HTML import worked but JSON snapshot path didn't.
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth = opts.account
      ? new CookieAuth({
          platform: "taobao",
          cookies: opts.account.cookies || "",
        })
      : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "userId";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "parse:taobao-orders",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 6, perDay: 200 }; // respect Taobao风控
    this.dataDisclosure = {
      fields: [
        "taobao:bizOrderId / sellerNick / items / payTime / actualFee / address",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { order: true },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require.
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
      platform: "taobao",
      identityKey: "userId",
    });
    if (cookieAuth) {
      const ok = await cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing or empty",
        };
      if (!account || !account.userId) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USERID",
          message: "cookie mode requires account.userId",
        };
      }
      return { ok: true, account: account.userId, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "TaobaoAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie mode)",
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
      "TaobaoAdapter.sync: needs opts.inputPath OR configured account.cookies OR opts.cookie + opts.accountId",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-taobao.sync: snapshot must be JSON (v0.3 will add HTML parsing for SAF-exported pages). Got parse error: ${err.message}`,
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `shopping-taobao.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
      platform: "taobao",
      identityKey: "userId",
    });
    if (!account || !account.userId) {
      throw new Error(
        "TaobaoAdapter._syncViaCookie: account.userId or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseWatermarkMs(opts.sinceWatermark)
        : Date.now() - 365 * 24 * 3600_000; // default last year
    const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : 20;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;
    let page = 1;
    let scanComplete = false;
    while (page <= maxPages) {
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({ operation: KIND_ORDER, page });
      }
      const resp = await this._fetchFn({
        url: TAOBAO_ORDERS_URL,
        cookies: cookieAuth.toHeader(),
        query: { page, pageSize, ts: Date.now() },
      });
      if (!resp || !Array.isArray(resp.orders)) break;
      if (resp.orders.length === 0) {
        scanComplete = true;
        break;
      }
      let pageHasNew = false;
      let reachedWatermark = false;
      for (const raw of resp.orders) {
        const rec = orderToRecord(raw);
        if (!rec) continue;
        if (rec.placedAt && rec.placedAt < sinceMs) {
          reachedWatermark = true;
          break; // older than watermark
        }
        pageHasNew = true;
        yield {
          adapter: NAME,
          originalId: rec.orderId,
          capturedAt: rec.paidAt || rec.placedAt || Date.now(),
          payload: { record: rec },
        };
      }
      if (reachedWatermark || (pageHasNew && resp.orders.length < pageSize)) {
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
      throw new Error("TaobaoAdapter.normalize: raw.payload missing");
    }
    // Snapshot mode payload is the raw event spread + account; cookie mode
    // wraps a normalized record under payload.record. Dispatch on shape.
    if (raw.payload.record) {
      return normalizeOrderRecord(raw.payload.record, {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    // Snapshot path: the Android collector ships records that already match
    // the OrderRecord shape (vendorId/orderId/placedAt/...). Pass through.
    return normalizeOrderRecord(raw.payload, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function parseTime(v) {
  if (Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function stableOriginalId(kind, id) {
  return id ? `taobao:${kind}:${id}` : `taobao:${kind}:unknown-${Date.now()}`;
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
    totalAmount: {
      value: parseFloat(o.actualFee || o.payAmount || o.totalAmount || 0),
      currency: "CNY",
    },
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
  if (t.includes("已取消") || t.includes("cancel") || t.includes("已关闭"))
    return "cancelled";
  if (t.includes("已发货") || t.includes("shipped")) return "shipped";
  if (t.includes("已签收") || t.includes("已完成") || t.includes("delivered"))
    return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  // Default: no-op so adapter doesn't accidentally hit real Taobao when
  // user hasn't configured a fetcher. Production wires a real HTTPS
  // fetch via the desktop main process (not from renderer).
  throw new Error(
    "TaobaoAdapter: no fetchFn configured (use a desktop-main wrapper)",
  );
}

module.exports = {
  TaobaoAdapter,
  orderToRecord,
  parseTaobaoTime,
  NAME,
  VERSION,
};
