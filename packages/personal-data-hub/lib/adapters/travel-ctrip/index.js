/**
 * Phase 9.3 — Ctrip (携程) order adapter, tri-mode.
 *
 * Ctrip orders cover 4 sub-types: flight / hotel / train / cruise.
 * We map each to the appropriate `vehicleType` in TravelRecord:
 *   flight → "flight", hotel → "hotel", train → "train", cruise → "cruise".
 *
 *   1. snapshot / file-import mode (opts.inputPath | opts.dataPath): ingest a
 *      JSON dump from a 3rd-party scraper, a user-curated file, or an on-device
 *      Android collector. account is OPTIONAL (file-import is stateless).
 *
 *   2. cookie-api mode (opts.account.cookies, v0.7): fetch the Ctrip order
 *      centre directly from the hub, so collection no longer requires a manual
 *      export. After login on accounts.ctrip.com the order list is reachable
 *      under the `.ctrip.com` cookie domain (confirmed by the Android
 *      TravelVendor.kt CTRIP entry — "cookie scrape 完整链路 (有 web API)").
 *      As with the shopping adapters the actual HTTP call is delegated to an
 *      injected `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron
 *      WebView net request) so this module stays a pure-Node parser +
 *      orchestrator. account OPTIONAL — the cookie carries identity.
 *
 *      ── sign seam ──────────────────────────────────────────────────────────
 *      Ctrip's SOA order endpoints usually require a request `sign` token
 *      computed by client-side JS (analogous to 拼多多 anti_token / 抖音
 *      X-Bogus). No pure-Node implementation survives the rotation, so signing
 *      is injected via `opts.signProvider` (or constructor `signProvider`).
 *      When absent the request is still issued unsigned — best-effort, the
 *      endpoint may reject it, which surfaces as zero events rather than a
 *      crash. The endpoint constant is best-effort and overridable via
 *      `opts.ordersUrl`; Ctrip rotates SOA service numbers, so adjust the
 *      constant / pass opts.ordersUrl if it drifts (same playbook as the
 *      FAMILY-23 live fetchers — endpoints are not field-verified here).
 *
 *   3. (legacy) Email order-confirmation events from Phase 5 (vault-side derive).
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
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "travel-ctrip";
const VERSION = "0.7.0"; // §9.3c — cookie-api live fetch path (signProvider seam)

// Best-effort Ctrip order-centre list endpoint. Overridable via opts.ordersUrl
// (Ctrip rotates SOA service numbers; the injected fetchFn host may also point
// at whichever order API the captured cookie is currently scoped to).
const CTRIP_ORDERS_URL = "https://m.ctrip.com/restapi/soa2/24690/getOrderList";
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;

class CtripAdapter {
  constructor(opts = {}) {
    // §9.3b 2026-05-25 — account.email OPTIONAL (mirror shopping-jd/taobao
    // dual-mode). file-import mode is stateless; bookkeeping account.email
    // is informational, not gating. Earlier strict ctor blocked
    // auto-register at boot → Android collector ship JSON staging path
    // failed with silent "no adapter travel-ctrip".
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "email",
    ]);
    this._dataPath = opts.dataPath || null;

    // §9.3c cookie-api mode — activates when account.cookies is supplied.
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "ctrip", cookies: opts.account.cookies })
        : null;
    // The actual HTTP call is delegated to an injected fetchFn so this module
    // stays a pure-Node parser/orchestrator (same seam as the shopping +
    // travel-12306 adapters). fetchFn({ url, cookies, query, sign }) → JSON.
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    // sign seam — async fn({ url, query, cookies }) → string|null. When absent,
    // requests carry sign: null (best-effort, the endpoint may reject).
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : CTRIP_ORDERS_URL;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "userId";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      "sync:cookie-api",
      "parse:ctrip-orders",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perMinute: 8, perDay: 200 };
    this.dataDisclosure = {
      fields: [
        "ctrip:orderId / type / fromCity / toCity / dates / passengerName / price / carrier",
      ],
      sensitivity: "medium",
      legalGate: false,
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require
    // (see .claude/rules/testing.md).
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    // Snapshot / file-import path: validate file readable when an inputPath
    // / dataPath is provided. Takes priority over cookie mode when both given.
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
          "travel-ctrip cookie mode requires opts.accountId for an isolated watermark scope",
      };
    }
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts: ctx,
      platform: "ctrip",
      identityKey: "userId",
    });
    if (cookieAuth) {
      const ok = await cookieAuth.validate();
      if (!ok) {
        return {
          ok: false,
          reason: "INVALID_COOKIE",
          error: "cookies missing",
        };
      }
      if (this._fetchFn === defaultFetch) {
        return {
          ok: false,
          reason: "CUSTOM_FETCH_REQUIRED",
          message:
            "travel-ctrip cookie mode requires an explicitly configured fetchFn for an authorized session",
        };
      }
      // account is OPTIONAL in cookie mode — the .ctrip.com cookie carries identity.
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
        "travel-ctrip.authenticate: needs opts.inputPath/dataPath (snapshot mode) OR configured account.cookies + fetchFn (custom cookie-api mode)",
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
    // Snapshot mode aliases dataPath → inputPath so Android in-APK cc can
    // call syncAdapter("travel-ctrip", path) with the same shape it uses
    // for the other snapshot-mode adapters (shopping-jd / travel-12306).
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (dataPath) {
      const text = readBoundedSnapshot(this._deps.fs, dataPath, {
        maxBytes: opts.maxSnapshotBytes,
      });
      let records;
      try {
        records = parseRecords(text);
      } catch (err) {
        throw new Error(`CtripAdapter: parse failed: ${err.message}`);
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
      "travel-ctrip.sync: needs opts.inputPath/dataPath OR configured account.cookies + fetchFn",
    );
  }

  /**
   * §9.3c — cookie-api live fetch. Hits the Ctrip order-centre list endpoint
   * via the injected fetchFn, paginates with a pageIndex cursor, stops at the
   * sinceWatermark / maxPages, maps each order through orderToRecord (so the
   * existing normalize path applies unchanged) and yields it.
   */
  async *_syncViaCookie(opts = {}) {
    if (hasRuntimeCookie(opts) && !hasRuntimeAccountId(opts)) {
      throw new Error(
        "travel-ctrip._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    const { cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "ctrip",
      identityKey: "userId",
    });
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
    const sinceMs =
      opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || 0
        : Date.now() - 365 * 24 * 3600_000; // default last year
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
      // sign seam — best-effort. null when no signProvider.
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
      const orders = extractOrders(resp);
      const recognizedPage = hasOrderList(resp);
      if (!orders.length) {
        const pageState = sourcePageState(resp, sourceItemsSeen);
        if (recognizedPage && pageState === "more") {
          pageIndex += 1;
          continue;
        }
        scanComplete = recognizedPage;
        break;
      }
      sourceItemsSeen += orders.length;
      const pageState = sourcePageState(resp, sourceItemsSeen);

      let pageHasNew = false;
      let reachedWatermark = false;
      for (const raw of orders) {
        const rec = orderToRecord(raw, { capturedVia: "cookie-api" });
        if (!rec) continue;
        const ts = rec.bookedAt || rec.departureMs || null;
        if (ts && ts < sinceMs) {
          reachedWatermark = true; // remaining orders are older
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
      throw new Error("CtripAdapter.normalize: raw.payload.record missing");
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

const TYPE_MAP = {
  flight: "flight",
  airline: "flight",
  hotel: "hotel",
  train: "train",
  cruise: "cruise",
  bus: "bus",
  car: "car",
};

function parseRecords(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_e) {
    // Try JSONL
    raw = text
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l));
  }
  const orders = Array.isArray(raw) ? raw : raw.orders || [];
  return orders.map(orderToRecord).filter(Boolean);
}

function orderToRecord(o, opts = {}) {
  if (!o || typeof o !== "object") return null;
  // Web-API order objects (cookie-api mode) use additional id/field names;
  // file-import / snapshot rows keep priority so existing parsing is unchanged.
  const recordId = o.orderId || o.id || o.order_no || o.orderID || o.orderId_;
  if (!recordId) return null;
  const type = (
    o.type ||
    o.orderType ||
    o.bizType ||
    o.businessType ||
    o.productType ||
    ""
  )
    .toString()
    .toLowerCase();
  const vehicleType = TYPE_MAP[type] || "trip";

  const priceRaw =
    o.price != null
      ? o.price
      : o.amount != null
        ? o.amount
        : o.orderAmount != null
          ? o.orderAmount
          : o.totalAmount != null
            ? o.totalAmount
            : o.totalPrice != null
              ? o.totalPrice
              : null;

  return {
    vendorId: "ctrip",
    recordId: String(recordId),
    vehicleType,
    from:
      o.fromCity || o.from_city || o.depCity || o.departCity
        ? { city: o.fromCity || o.from_city || o.depCity || o.departCity }
        : null,
    to:
      o.toCity || o.to_city || o.arrCity || o.arriveCity || o.hotelCity
        ? {
            city:
              o.toCity || o.to_city || o.arrCity || o.arriveCity || o.hotelCity,
          }
        : null,
    departureMs: numberOrParse(
      o.departureTime ||
        o.dep_time ||
        o.departureDate ||
        o.checkIn ||
        o.check_in ||
        o.startDate,
    ),
    arrivalMs: numberOrParse(
      o.arrivalTime ||
        o.arr_time ||
        o.arrivalDate ||
        o.checkOut ||
        o.check_out ||
        o.endDate,
    ),
    carrier:
      o.carrier ||
      o.airline ||
      o.hotelName ||
      o.hotel_name ||
      o.orderTitle ||
      o.title ||
      "携程",
    vehicleNumber: o.flightNumber || o.flight_no || o.trainNumber || o.train_no,
    totalCost:
      priceRaw != null
        ? { value: parseFloat(priceRaw), currency: o.currency || "CNY" }
        : null,
    traveler:
      o.passengerName ||
      o.passenger ||
      o.guestName ||
      o.guest_name ||
      o.contactName,
    confirmationCode: o.confirmationCode || o.pnr || o.confirmation_no,
    bookedAt: numberOrParse(
      o.bookedAt || o.order_time || o.orderDate || o.createTime || o.orderTime,
    ),
    extras: {
      type,
      ...(o.hotel ? { hotel: o.hotel } : {}),
      ...(o.nights != null ? { nights: o.nights } : {}),
      ...(opts.capturedVia ? { capturedVia: opts.capturedVia } : {}),
    },
  };
}

/**
 * Pull the order array out of a Ctrip order-centre response. Ctrip nests the
 * list under different keys across SOA versions; the injected fetchFn may also
 * pre-flatten to `{ orders }`. Tolerant of all common shapes.
 */
function extractOrders(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.orders)) return resp.orders;
  if (Array.isArray(resp.orderList)) return resp.orderList;
  if (Array.isArray(resp.list)) return resp.list;
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  if (data) {
    if (Array.isArray(data.orders)) return data.orders;
    if (Array.isArray(data.orderList)) return data.orderList;
    if (Array.isArray(data.list)) return data.list;
  }
  const result =
    resp.result && typeof resp.result === "object" ? resp.result : null;
  if (result) {
    if (Array.isArray(result.orderList)) return result.orderList;
    if (Array.isArray(result.list)) return result.list;
  }
  return [];
}

function hasOrderList(resp) {
  if (!resp || typeof resp !== "object") return false;
  if (
    Array.isArray(resp.orders) ||
    Array.isArray(resp.orderList) ||
    Array.isArray(resp.list)
  ) {
    return true;
  }
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  if (
    data &&
    (Array.isArray(data.orders) ||
      Array.isArray(data.orderList) ||
      Array.isArray(data.list))
  ) {
    return true;
  }
  const result =
    resp.result && typeof resp.result === "object" ? resp.result : null;
  return !!(
    result &&
    (Array.isArray(result.orderList) || Array.isArray(result.list))
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

async function defaultFetch(_opts) {
  // Pure-Node has no HTTP layer; the host (Android cc → OkHttp; desktop hub →
  // Electron WebView net) injects a real fetchFn. A missing fetchFn is a wiring
  // bug, not a runtime data condition, so it throws loudly rather than silently
  // emitting 0 (mirrors travel-12306 / the shopping adapters).
  throw new Error("travel-ctrip: no fetchFn configured for cookie-api mode");
}

function numberOrParse(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v) && v.length >= 10) return parseInt(v, 10);
    return parseChineseDateTime(v);
  }
  return null;
}

module.exports = {
  CtripAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  TYPE_MAP,
  NAME,
  VERSION,
};
