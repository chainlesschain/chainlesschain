/**
 * §2.4c 购物三联 v0.2 — Pinduoduo (拼多多) adapter, snapshot-only.
 *
 * Mirror of shopping-jd / shopping-meituan snapshot-mode pattern, **but
 * without a cookie-mode fallback** because:
 *
 *   1. mobile.yangkeduo.com web endpoint `/proxy/api/galerie/transaction/
 *      transaction_list` requires `anti_token` signing computed by client-side
 *      JS (similar to 抖音 X-Bogus). No pure-Node implementation survives
 *      pinduoduo's monthly anti_token rotation.
 *   2. Pinduoduo Android app has no built-in "export orders" feature, so
 *      there's no SAF source-format to parse directly either.
 *
 * v0.2 deliverable = **scaffold + snapshot-mode JSON ingest**. User-facing
 * paths for producing the snapshot JSON:
 *
 *   a) Browser extension (planned v0.3) that scrapes yangkeduo.com order
 *      pages while logged in and exports JSON matching this schema.
 *   b) Manual hand-roll (rare; for testing).
 *
 * UI surface: pinduoduo card appears alongside alipay/taobao/jd/meituan in
 * 推文 §"支付与购物" 大类, with an explicit "v0.2 待用户导出 — 需 web
 * extension 或手抄" banner so user knows the limitation.
 *
 * Snapshot schema (mirrors PinduoduoLocalCollector.SNAPSHOT_SCHEMA_VERSION
 * once the Kotlin collector lands in v0.3+):
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
 * Future v0.3: HTML parsing (`Save As Webpage` from `mobile.yangkeduo.com/
 * users/orders.html` — pinduoduo's order list endpoint).
 */

"use strict";

const fs = require("node:fs");
const { normalizeOrderRecord } = require("../shopping-base");

const NAME = "shopping-pinduoduo";
const VERSION = "0.1.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_ORDER = "order";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_ORDER]);

class PinduoduoAdapter {
  constructor(opts = {}) {
    // §2.4c v0.2: account is OPTIONAL — snapshot mode is stateless. There's
    // no cookie mode at all (anti_token signing path deferred to v0.3+).
    this.account = opts.account || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:snapshot", "parse:pinduoduo-orders"];
    this.extractMode = "user-export";
    this.rateLimits = {};
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
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "PinduoduoAdapter.authenticate: needs opts.inputPath (snapshot mode — no cookie mode in v0.2)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    throw new Error(
      "PinduoduoAdapter.sync: needs opts.inputPath (snapshot mode; no cookie/api mode in v0.2 because pinduoduo's web API requires anti_token JS-VM signing)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    // v0.2 explicit JSON-only. HTML parsing (SAF-exported webpage from
    // yangkeduo.com order list) is future v0.3 work.
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `shopping-pinduoduo.sync: snapshot must be JSON (v0.3 will add HTML parsing). Got parse error: ${err.message}`,
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

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("PinduoduoAdapter.normalize: payload missing");
    }
    // Snapshot-mode only — payload carries fields directly on the event.
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

module.exports = {
  PinduoduoAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
