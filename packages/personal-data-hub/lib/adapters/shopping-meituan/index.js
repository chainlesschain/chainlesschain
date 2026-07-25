/**
 * §2.4b 购物双联 v0.2 — Meituan (美团) adapter, dual-mode (snapshot + cookie).
 *
 * Meituan covers 外卖 (food delivery) + 团购 (group buy) + 酒店 (hotel — though
 * Ctrip is more common). v0.2 expands the existing cookie-fetch flow with a
 * snapshot mode for the Android in-APK cc path.
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by MeituanLocalCollector (WebView cookie scrape +
 *      `h5.meituan.com/order/list` OkHttp fetch — both `waimai` and
 *      `groupbuy` platforms). Adapter stateless — account.userId OPTIONAL
 *      at construction.
 *
 *   2. cookie mode (legacy Phase 7.3b): existing web-api path — `cookies` +
 *      `fetchFn` injection seam fetches `h5.meituan.com/order/list` directly.
 *      account.userId REQUIRED in this mode (checked at sync time).
 *
 * Snapshot schema (mirrors MeituanLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "meituan",
 *     "account": { "userId": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "order", "id": "order-<mtId>", "capturedAt": <ms>,
 *         "orderId": "...", "merchantName": "...", "platform": "waimai|groupbuy|hotel",
 *         "items": [{ "name": ..., "quantity": ..., "unitPrice": ... }],
 *         "placedAt": ..., "paidAt": ..., "status": "...",
 *         "totalAmount": { "value": ..., "currency": "CNY" },
 *         "recipient": "...", "shippingAddress": "..." }
 *     ]
 *   }
 *
 * Future v0.3: SAF-exported HTML parsing (Save As Webpage from h5.meituan.com)
 * — currently snapshot mode accepts JSON only; non-JSON inputPath throws.
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const {
  normalizeOrderRecord,
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "shopping-meituan";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

const MEITUAN_ORDERS_URL = "https://h5.meituan.com/order/list";

class MeituanAdapter {
  constructor(opts = {}) {
    // §2.4b v0.2: account.userId OPTIONAL — snapshot mode is stateless. Cookie
    // mode requires it; checked at sync time.
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "userId",
    ]);
    this._cookieAuth = opts.account
      ? new CookieAuth({
          platform: "meituan",
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
      "parse:meituan-orders",
    ];
    this.extractMode = "web-api";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "meituan:orderId / poiName / dishes / totalPrice / deliveryAddress",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { order: true },
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "meituan",
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
          message: "cookie mode requires account.userId",
        };
      }
      return { ok: true, account: account.userId, mode: "cookie" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "MeituanAdapter.authenticate: needs opts.inputPath (snapshot mode) OR opts.account.cookies (cookie mode)",
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: result.reason,
          error: result.error || result.message,
          lastChecked: Date.now(),
        };
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
      "MeituanAdapter.sync: needs opts.inputPath OR configured account.cookies OR opts.cookie + opts.accountId",
    );
  }

  async *_syncViaSnapshot(opts) {
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["events"],
      allowedEventKinds: VALID_SNAPSHOT_KINDS,
    });
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

    const events = snapshot.events;
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      const kind = ev.kind;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.placedAt) ||
        parseTime(ev.paidAt) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" &&
          Number.isFinite(ev.id) &&
          String(ev.id)) ||
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
      platform: "meituan",
      identityKey: "userId",
    });
    if (!account || !account.userId) {
      throw new Error(
        "MeituanAdapter._syncViaCookie: account.userId or opts.accountId required",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000;
    const defaultPlatforms = ["waimai", "groupbuy"];
    const platforms = opts.platforms || defaultPlatforms;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 10;
    let pagesFetched = 0;
    let allScansComplete = true;

    for (const platform of platforms) {
      if (pagesFetched >= maxPages) {
        allScansComplete = false;
        break;
      }
      let page = 1;
      let sourceItemsSeen = 0;
      let platformComplete = false;
      while (pagesFetched < maxPages) {
        if (typeof opts.beforeSourceRequest === "function") {
          await opts.beforeSourceRequest({ operation: platform, page });
        }
        const resp = await this._fetchFn({
          url: MEITUAN_ORDERS_URL,
          cookies: cookieAuth.toHeader(),
          query: { page, platform },
        });
        pagesFetched += 1;
        if (!resp || !Array.isArray(resp.orders)) break;
        if (resp.orders.length === 0) {
          const pageState = sourcePageState(resp, sourceItemsSeen);
          if (pageState === "more") {
            page += 1;
            continue;
          }
          platformComplete = true;
          break;
        }
        sourceItemsSeen += resp.orders.length;
        const pageState = sourcePageState(resp, sourceItemsSeen);
        let pageHasNew = false;
        let reachedWatermark = false;
        for (const raw of resp.orders) {
          const rec = orderToRecord(raw, platform);
          if (!rec) continue;
          if (rec.placedAt && rec.placedAt < sinceMs) {
            reachedWatermark = true;
            break;
          }
          pageHasNew = true;
          yield {
            adapter: NAME,
            originalId: rec.orderId,
            capturedAt: rec.placedAt || Date.now(),
            payload: { record: rec, platform },
          };
        }
        if (reachedWatermark || (pageHasNew && pageState === "complete")) {
          platformComplete = true;
          break;
        }
        if (!pageHasNew) break;
        page += 1;
      }
      if (!platformComplete) allScansComplete = false;
    }
    const scannedAllPlatforms = defaultPlatforms.every((platform) =>
      platforms.includes(platform),
    );
    if (
      scannedAllPlatforms &&
      allScansComplete &&
      typeof opts.markWatermarkComplete === "function"
    ) {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("MeituanAdapter.normalize: payload missing");
    }
    if (raw.payload.record) {
      return normalizeOrderRecord(raw.payload.record, {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    const rec = snapshotEventToRecord(raw.payload, raw.originalId);
    return normalizeOrderRecord(rec, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!safe) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `meituan:${kind}:${safe}`;
}

function snapshotEventToRecord(ev, originalId) {
  const items = [];
  const rawItems = Array.isArray(ev.items) ? ev.items : [];
  for (const it of rawItems) {
    if (!it) continue;
    items.push({
      name: it.name || it.dishName || it.dealName,
      quantity: parseInt(it.quantity || 1, 10),
      unitPrice: parseFloat(it.unitPrice || 0),
      sku: it.sku || null,
    });
  }
  return {
    vendorId: "meituan",
    orderId: String(ev.orderId || ev.id || originalId),
    placedAt: parseTime(ev.placedAt),
    paidAt: parseTime(ev.paidAt),
    status: ev.status || "placed",
    merchantName: ev.merchantName || "美团",
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
    extras: { platform: ev.platform || "waimai", capturedBy: "snapshot" },
  };
}

function sourcePageState(resp, sourceItemsSeen) {
  const containers = [
    resp,
    resp && resp.data,
    resp && resp.result,
    resp && resp.pagination,
    resp && resp.data && resp.data.pagination,
    resp && resp.result && resp.result.pagination,
  ];
  for (const container of containers) {
    if (!container || typeof container !== "object" || Array.isArray(container))
      continue;
    const hasMore = container.hasMore ?? container.has_more;
    if (hasMore != null) {
      const token = String(hasMore).toLowerCase();
      if (token === "true" || token === "1") return "more";
      if (token === "false" || token === "0") return "complete";
    }
    const total = Number(
      container.total ?? container.totalCount ?? container.total_count,
    );
    if (Number.isFinite(total) && total >= 0)
      return sourceItemsSeen >= total ? "complete" : "more";
    for (const key of [
      "next",
      "nextPage",
      "next_page",
      "nextCursor",
      "next_cursor",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
      const value = container[key];
      return value == null || value === "" || value === false || value === 0
        ? "complete"
        : "more";
    }
  }
  return "unknown";
}

function orderToRecord(o, platform = "waimai") {
  if (!o || typeof o !== "object") return null;
  const orderId = o.orderId || o.viewOrderId || o.id;
  if (!orderId) return null;
  const merchant =
    o.poiName || o.dealName || o.shopName || o.merchantName || "美团";

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
    totalAmount: {
      value: parseFloat(o.totalPrice || o.totalFee || o.payAmount || 0),
      currency: "CNY",
    },
    items,
    recipient: o.recipientName,
    shippingAddress: o.recipientAddress || o.deliveryAddress,
    extras: { platform, rawStatus: o.statusDesc || o.statusText },
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
  if (t.includes("配送中") || t.includes("派送") || t.includes("shipped"))
    return "shipped";
  if (t.includes("已完成") || t.includes("已送达") || t.includes("delivered"))
    return "delivered";
  return "placed";
}

async function defaultFetch(_opts) {
  throw new Error("MeituanAdapter: no fetchFn configured");
}

module.exports = {
  MeituanAdapter,
  orderToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
