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
  probeSnapshotFile,
  readBoundedSnapshot,
} = require("../../snapshot-file");
const {
  normalizeTravelRecord,
  parseChineseDateTime,
} = require("../travel-base");
const {
  CookieAuth,
  extractShoppingOrders,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

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
    this.runtimeScopeIdentityKey = "userId";
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
    this.rateLimits = { perMinute: 8, perDay: 200 };
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
      return probeSnapshotFile(this._deps.fs, filePath, {
        maxBytes: ctx.maxSnapshotBytes,
      });
    }
    if (hasRuntimeCookie(ctx) && !hasRuntimeAccountId(ctx)) {
      return {
        ok: false,
        reason: "NO_ACCOUNT_ID",
        message:
          "travel-didi cookie mode requires opts.accountId for an isolated watermark scope",
      };
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "didi",
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
      if (this._fetchFn === defaultFetch) {
        return {
          ok: false,
          reason: "CUSTOM_FETCH_REQUIRED",
          message:
            "travel-didi cookie mode requires an explicitly configured fetchFn for an authorized session",
        };
      }
      return {
        ok: true,
        account: (account && (account.email || account.userId)) || null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-didi.authenticate: needs opts.inputPath/dataPath (snapshot mode) OR configured account.cookies + fetchFn (custom cookie-api mode)",
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
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      const text = readBoundedSnapshot(this._deps.fs, dataPath, {
        maxBytes: opts.maxSnapshotBytes,
      });
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
    if (this._cookieAuth || hasRuntimeCookie(opts)) {
      yield* this._syncViaCookie(opts);
      return;
    }
    throw new Error(
      "travel-didi.sync: needs opts.inputPath/dataPath OR configured account.cookies + fetchFn",
    );
  }

  async *_syncViaCookie(opts = {}) {
    if (hasRuntimeCookie(opts) && !hasRuntimeAccountId(opts)) {
      throw new Error(
        "travel-didi._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    const { cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "didi",
      identityKey: "userId",
    });
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
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
    let sourceItemsSeen = 0;
    let scanComplete = false;
    while (pageIndex <= maxPages) {
      const query = { pageIndex, pageSize, ts: Date.now() };
      let sign = null;
      if (this._signProvider) {
        sign = await this._signProvider({
          url: this._ordersUrl,
          query,
          cookies,
          signal: opts.signal,
        });
      }
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "orders",
          page: pageIndex - 1,
        });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies,
        query,
        sign,
        signal: opts.signal,
      });
      const rides = extractOrders(resp);
      if (!rides.length) {
        const pageState = sourcePageState(resp, sourceItemsSeen);
        if (pageState === "more") {
          pageIndex += 1;
          continue;
        }
        scanComplete = true;
        break;
      }
      sourceItemsSeen += rides.length;
      const pageState = sourcePageState(resp, sourceItemsSeen);

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
      if (reachedWatermark || (pageHasNew && pageState === "complete")) {
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
  return extractShoppingOrders(resp, { source: NAME });
}

function hasOrderList(resp) {
  if (!resp || typeof resp !== "object") return false;
  if (
    Array.isArray(resp.orders) ||
    Array.isArray(resp.rides) ||
    Array.isArray(resp.list)
  ) {
    return true;
  }
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  return !!(
    data &&
    (Array.isArray(data.orders) ||
      Array.isArray(data.list) ||
      Array.isArray(data.records))
  );
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
    for (const key of ["hasMore", "has_more"]) {
      if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
      const value = container[key];
      if (value === true || value === 1 || value === "1" || value === "true")
        return "more";
      if (value === false || value === 0 || value === "0" || value === "false")
        return "complete";
    }
    const total = Number(
      container.total ?? container.totalCount ?? container.total_count,
    );
    if (Number.isFinite(total) && total >= 0) {
      return sourceItemsSeen >= total ? "complete" : "more";
    }
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

function hasRuntimeAccountId(opts = {}) {
  const value = opts.userId != null ? opts.userId : opts.accountId;
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
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
  hasOrderList,
  sourcePageState,
  parseFareYuan,
  NAME,
  VERSION,
};
