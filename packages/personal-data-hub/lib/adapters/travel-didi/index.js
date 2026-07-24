/**
 * §9.3e — Didi 企业版 (滴滴企业版 / 滴滴出差, com.didi.es.psngr) ride adapter,
 * dual-mode (snapshot + cookie-api). Phase 9 travel ⭐⭐ "出差打车" — the last
 * Phase-9 roadmap entry (§12.1), completing 完成阶段 travel coverage.
 *
 * A ride-hailing trip maps cleanly onto the vendor-neutral TravelRecord: each
 * ride is a `car` trip with start/end address, board/alight time, and fare. So
 * this adapter mirrors travel-ctrip / travel-tongcheng's two-mode shape.
 *
 *   1. snapshot / file-import mode (opts.inputPath | opts.dataPath): JSON/JSONL
 *      dump from an Android in-APK collector / curated file. account OPTIONAL.
 *
 *   2. cookie-api mode (opts.account.cookies): fetch the user's ride history
 *      from the 滴滴企业版 order centre (es.xiaojukeji.com) via the injected
 *      `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron WebView net
 *      request), paginate, map each ride → a car TravelRecord. A sign seam
 *      (opts.signProvider) covers Didi's anti-bot signature; best-effort unsigned
 *      when absent. Endpoint overridable via opts.ordersUrl (best-effort, not
 *      field-verified — FAMILY-23 playbook).
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  normalizeTravelRecord,
  parseChineseDateTime,
} = require("../travel-base");
const { CookieAuth } = require("../shopping-base");

const NAME = "travel-didi";
const VERSION = "0.1.0";

// Best-effort 滴滴企业版 ride-order list endpoint. Overridable via opts.ordersUrl.
const DIDI_ORDERS_URL = "https://es.xiaojukeji.com/river/Order/list";
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;

// Didi car-product codes/names → keep all as "car" (vehicleType), but record the
// finer product label in extras.productType.
function rideProductLabel(o) {
  return (
    o.productName ||
    o.product_name ||
    o.carLevel ||
    o.requireLevelName ||
    o.product ||
    null
  );
}

class DidiAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "email",
    ]);
    this._dataPath = opts.dataPath || null;

    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "didi", cookies: opts.account.cookies })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : DIDI_ORDERS_URL;

    this.name = NAME;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      "sync:cookie-api",
      "parse:didi-rides",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "didi:orderId / fromAddress / toAddress / departTime / arriveTime / fare / carType",
      ],
      sensitivity: "medium",
      legalGate: false,
    };

    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      try {
        this._deps.fs.accessSync(filePath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `not readable at ${filePath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
      if (!ok)
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      return {
        ok: true,
        account: (this.account && this.account.email) || null,
        mode: "cookie",
      };
    }
    return {
      ok: true,
      account: this.account ? this.account.email : null,
      mode: "ready",
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
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      if (!this._deps.fs.existsSync(dataPath)) return;
      const text = this._deps.fs.readFileSync(dataPath, "utf-8");
      let records;
      try {
        records = parseRecords(text);
      } catch (err) {
        throw new Error(`DidiAdapter: parse failed: ${err.message}`);
      }
      for (const r of records) {
        yield {
          adapter: NAME,
          originalId: r.recordId,
          capturedAt: r.bookedAt || r.departureMs || Date.now(),
          payload: { record: r },
        };
      }
      return;
    }
    if (this._cookieAuth) {
      yield* this._syncViaCookie(opts);
    }
  }

  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000;
    const pageSize = Number.isFinite(opts.pageSize)
      ? opts.pageSize
      : DEFAULT_PAGE_SIZE;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0
        ? opts.maxPages
        : DEFAULT_MAX_PAGES;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    let emitted = 0;
    let pageIndex = 1;
    let scanComplete = false;
    while (pageIndex <= maxPages) {
      const query = { pageIndex, pageSize, ts: Date.now() };
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({
          url: this._ordersUrl,
          query,
          cookies,
        });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies,
        query,
        sign,
      });
      const rides = extractOrders(resp);
      if (!rides.length) break;

      let pageHasNew = false;
      let reachedWatermark = false;
      for (const raw of rides) {
        const rec = orderToRecord(raw, { capturedVia: "cookie-api" });
        if (!rec) continue;
        const ts = rec.departureMs || rec.bookedAt || null;
        if (ts && ts < sinceMs) {
          reachedWatermark = true;
          break;
        }
        pageHasNew = true;
        if (emitted >= limit) return;
        yield {
          adapter: NAME,
          originalId: rec.recordId,
          capturedAt: ts || Date.now(),
          payload: { record: rec },
        };
        emitted += 1;
      }
      if (reachedWatermark || rides.length < pageSize) {
        scanComplete = true;
        break;
      }
      if (!pageHasNew) break;
      pageIndex += 1;
    }
    if (scanComplete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("DidiAdapter.normalize: raw.payload.record missing");
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function parseRecords(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_e) {
    raw = text
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l));
  }
  const rides = Array.isArray(raw) ? raw : raw.orders || raw.rides || [];
  return rides.map((o) => orderToRecord(o)).filter(Boolean);
}

/**
 * Map one Didi ride object → vendor-neutral car TravelRecord. Field names are
 * best-effort across endpoint versions (camelCase + snake_case + Chinese).
 */
function orderToRecord(o, opts = {}) {
  if (!o || typeof o !== "object") return null;
  const recordId = o.orderId || o.oid || o.id || o.order_id || o.travelId;
  if (!recordId) return null;
  const product = rideProductLabel(o);

  const fareRaw = firstNonNull([
    o.fare,
    o.totalFee,
    o.total_fee,
    o.payAmount,
    o.pay_amount,
    o.amount,
    o.price,
    o.totalPrice,
    o.total_price,
  ]);

  const fromAddr =
    o.fromAddress ||
    o.from_address ||
    o.startName ||
    o.startAddress ||
    o.fromName;
  const toAddr =
    o.toAddress || o.to_address || o.endName || o.endAddress || o.toName;

  return {
    vendorId: "didi",
    recordId: String(recordId),
    vehicleType: "car",
    from: fromAddr ? { name: fromAddr } : null,
    to: toAddr ? { name: toAddr } : null,
    departureMs: numberOrParse(
      o.departTime ||
        o.depart_time ||
        o.boardTime ||
        o.startTime ||
        o.beginChargeTime ||
        o.setupTime,
    ),
    arrivalMs: numberOrParse(
      o.arriveTime || o.arrive_time || o.endTime || o.finishTime,
    ),
    carrier: "滴滴",
    vehicleNumber: o.carNo || o.plateNo || o.car_plate || null,
    totalCost:
      fareRaw != null
        ? { value: parseFareYuan(fareRaw), currency: "CNY" }
        : null,
    traveler: o.passengerName || o.passenger || o.riderName || o.userName,
    confirmationCode: null,
    bookedAt: numberOrParse(
      o.createTime || o.create_time || o.orderTime || o.bookedAt,
    ),
    extras: {
      type: "car",
      ...(product ? { productType: product } : {}),
      ...(o.driverName ? { driver: o.driverName } : {}),
      ...(opts.capturedVia ? { capturedVia: opts.capturedVia } : {}),
    },
  };
}

/** Didi fares are sometimes 分 (integer cents), sometimes 元 (decimal). */
function parseFareYuan(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  // Heuristic: large integers (>= 1000 with no decimal) are very likely 分.
  if (Number.isInteger(n) && n >= 1000) return Math.round(n) / 100;
  return n;
}

function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.rides)) return resp.rides;
  if (Array.isArray(resp.list)) return resp.list;
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  if (data) {
    if (Array.isArray(data.orders)) return data.orders;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.records)) return data.records;
  }
  return [];
}

function firstNonNull(arr) {
  for (const v of arr) if (v != null) return v;
  return null;
}

// 13-digit epoch (>= 1e12) is already ms; 10-digit (1e9..<1e12) is seconds → ms.
function toMs(n) {
  return n >= 1e12 ? n : n >= 1e9 ? n * 1000 : n;
}

function numberOrParse(v) {
  if (Number.isFinite(v)) return toMs(v);
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return toMs(parseInt(v, 10));
    return parseChineseDateTime(v);
  }
  return null;
}

async function defaultFetch(_opts) {
  throw new Error("travel-didi: no fetchFn configured for cookie-api mode");
}

module.exports = {
  DidiAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  parseFareYuan,
  NAME,
  VERSION,
};
