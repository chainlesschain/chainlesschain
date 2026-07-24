/**
 * §9.3d — Tongcheng (同程旅行) order adapter, dual-mode (snapshot + cookie-api).
 *
 * 同程 (com.tongcheng.android) is a Phase 9 travel platform (ROI ⭐⭐⭐ in
 * docs/design/Personal_Data_Hub_Architecture.md §12.1, "与携程互补") that was
 * skipped when the travel 四件套 (amap/baidu/ctrip/12306) shipped. It is an OTA
 * like 携程, so this adapter mirrors travel-ctrip: orders span flight / hotel /
 * train / bus / scenery (门票) / cruise / car, each mapped to the appropriate
 * `vehicleType` in the vendor-neutral TravelRecord.
 *
 *   1. snapshot / file-import mode (opts.inputPath | opts.dataPath): ingest a
 *      JSON dump from an Android in-APK collector / browser extension / curated
 *      file. account OPTIONAL (file-import is stateless).
 *
 *   2. cookie-api mode (opts.account.cookies, v0.1): fetch the Tongcheng order
 *      centre directly from the hub. After login on the ly.com domain the order
 *      list is reachable under the `.ly.com` cookie. As with the other travel /
 *      shopping adapters the actual HTTP call is delegated to an injected
 *      `fetchFn` (Android in-APK cc → OkHttp; desktop hub → Electron WebView net
 *      request) so this module stays a pure-Node parser + orchestrator. account
 *      OPTIONAL — the cookie carries identity.
 *
 *      ── sign seam ──────────────────────────────────────────────────────────
 *      Tongcheng's H5 / m-API requests carry an anti-bot signature computed by
 *      client-side JS (analogous to 携程 mtgsig / 拼多多 anti_token). No pure-Node
 *      implementation survives the rotation, so signing is injected via
 *      `opts.signProvider` (or constructor `signProvider`). When absent the
 *      request is still issued unsigned — best-effort, the endpoint may reject
 *      it, which surfaces as zero events rather than a crash. The endpoint
 *      constant is best-effort and overridable via `opts.ordersUrl`; Tongcheng
 *      rotates H5 paths, so adjust / pass opts.ordersUrl if it drifts
 *      (FAMILY-23 playbook — endpoints are not field-verified here).
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
const { CookieAuth } = require("../shopping-base");

const NAME = "travel-tongcheng";
const VERSION = "0.1.0";

// Best-effort Tongcheng order-centre list endpoint. Overridable via
// opts.ordersUrl (Tongcheng rotates H5 paths; the injected fetchFn host may
// also point at whichever order API the captured cookie is currently scoped to).
const TONGCHENG_ORDERS_URL = "https://m.ly.com/order/orderList";
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;

const TYPE_MAP = {
  flight: "flight",
  airline: "flight",
  jipiao: "flight",
  机票: "flight",
  hotel: "hotel",
  jiudian: "hotel",
  酒店: "hotel",
  train: "train",
  huoche: "train",
  火车: "train",
  火车票: "train",
  bus: "bus",
  qiche: "bus",
  汽车: "bus",
  汽车票: "bus",
  coach: "bus",
  scenery: "attraction",
  jingdian: "attraction",
  景点: "attraction",
  门票: "attraction",
  ticket: "attraction",
  cruise: "cruise",
  youlun: "cruise",
  邮轮: "cruise",
  car: "car",
  yongche: "car",
  用车: "car",
};

class TongchengAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "email",
    ]);
    this._dataPath = opts.dataPath || null;

    // cookie-api mode — activates when account.cookies is supplied.
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({
            platform: "tongcheng",
            cookies: opts.account.cookies,
          })
        : null;
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;
    this._signProvider =
      typeof opts.signProvider === "function" ? opts.signProvider : null;
    this._ordersUrl =
      typeof opts.ordersUrl === "string" && opts.ordersUrl.length > 0
        ? opts.ordersUrl
        : TONGCHENG_ORDERS_URL;

    this.name = NAME;
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "import:json",
      "sync:snapshot",
      "sync:cookie-api",
      "parse:tongcheng-orders",
    ];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "tongcheng:orderId / type / fromCity / toCity / dates / passengerName / price / carrier",
      ],
      sensitivity: "medium",
      legalGate: false,
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require.
    this._deps = { fs };
  }

  async authenticate(ctx = {}) {
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      return probeSnapshotFile(this._deps.fs, filePath, {
        maxBytes: ctx.maxSnapshotBytes,
      });
    }
    if (this._cookieAuth) {
      const ok = await this._cookieAuth.validate();
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
            "travel-tongcheng cookie mode requires an explicitly configured fetchFn for an authorized session",
        };
      }
      // account is OPTIONAL in cookie mode — the .ly.com cookie carries identity.
      return {
        ok: true,
        account: (this.account && this.account.email) || null,
        mode: "cookie",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-tongcheng.authenticate: needs opts.inputPath/dataPath (snapshot mode) OR configured account.cookies + fetchFn (custom cookie-api mode)",
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
        throw new Error(`TongchengAdapter: parse failed: ${err.message}`);
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
      return;
    }
    throw new Error(
      "travel-tongcheng.sync: needs opts.inputPath/dataPath OR configured account.cookies + fetchFn",
    );
  }

  /**
   * §9.3d — cookie-api live fetch. Hits the Tongcheng order-centre list
   * endpoint via the injected fetchFn, paginates with a pageIndex cursor, stops
   * at the sinceWatermark / maxPages, maps each order through orderToRecord (so
   * the existing normalize path applies unchanged) and yields it.
   */
  async *_syncViaCookie(opts = {}) {
    if (!(await this._cookieAuth.validate())) return;
    const cookies = this._cookieAuth.toHeader();
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
        });
      }
      const resp = await this._fetchFn({
        url: this._ordersUrl,
        cookies,
        query,
        sign,
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
      throw new Error("TongchengAdapter.normalize: raw.payload.record missing");
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
    // Try JSONL
    raw = text
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l));
  }
  const orders = Array.isArray(raw) ? raw : raw.orders || [];
  return orders.map((o) => orderToRecord(o)).filter(Boolean);
}

/**
 * Map one Tongcheng order object → vendor-neutral TravelRecord. Field names are
 * best-effort across H5 versions (camelCase + snake_case + Chinese fallbacks).
 */
function orderToRecord(o, opts = {}) {
  if (!o || typeof o !== "object") return null;
  const recordId =
    o.orderId ||
    o.orderSerialId ||
    o.serialId ||
    o.id ||
    o.order_no ||
    o.orderNo;
  if (!recordId) return null;
  const type = (
    o.type ||
    o.orderType ||
    o.projectType ||
    o.projectTag ||
    o.bizType ||
    o.businessType ||
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
            : o.payAmount != null
              ? o.payAmount
              : o.totalPrice != null
                ? o.totalPrice
                : null;

  return {
    vendorId: "tongcheng",
    recordId: String(recordId),
    vehicleType,
    from:
      o.fromCity || o.from_city || o.depCity || o.departureCity
        ? { city: o.fromCity || o.from_city || o.depCity || o.departureCity }
        : null,
    to:
      o.toCity ||
      o.to_city ||
      o.arrCity ||
      o.arrivalCity ||
      o.hotelCity ||
      o.sceneryName
        ? {
            city:
              o.toCity ||
              o.to_city ||
              o.arrCity ||
              o.arrivalCity ||
              o.hotelCity ||
              o.sceneryName,
          }
        : null,
    departureMs: numberOrParse(
      o.departureTime ||
        o.dep_time ||
        o.departureDate ||
        o.useDate ||
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
      o.airlineName ||
      o.hotelName ||
      o.hotel_name ||
      o.sceneryName ||
      o.title ||
      "同程",
    vehicleNumber:
      o.flightNumber || o.flight_no || o.trainNumber || o.train_no || o.trainNo,
    totalCost:
      priceRaw != null
        ? { value: parseFloat(priceRaw), currency: o.currency || "CNY" }
        : null,
    traveler:
      o.passengerName ||
      o.passenger ||
      o.guestName ||
      o.guest_name ||
      o.linkName ||
      o.contactName,
    confirmationCode:
      o.confirmationCode || o.pnr || o.confirmation_no || o.serialId,
    bookedAt: numberOrParse(
      o.bookedAt || o.order_time || o.orderDate || o.createDate || o.createTime,
    ),
    extras: {
      type,
      ...(o.nights != null ? { nights: o.nights } : {}),
      ...(opts.capturedVia ? { capturedVia: opts.capturedVia } : {}),
    },
  };
}

/**
 * Pull the order array out of a Tongcheng order-centre response. Tongcheng
 * nests the list under different keys across H5 versions; the injected fetchFn
 * may also pre-flatten to `{ orders }`. Tolerant of all common shapes.
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
    if (Array.isArray(data.records)) return data.records;
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
  return !!(
    data &&
    (Array.isArray(data.orders) ||
      Array.isArray(data.orderList) ||
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

function numberOrParse(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v) && v.length >= 10) return parseInt(v, 10);
    return parseChineseDateTime(v);
  }
  return null;
}

async function defaultFetch(_opts) {
  // Pure-Node has no HTTP layer; the host (Android cc → OkHttp; desktop hub →
  // Electron WebView net) injects a real fetchFn. A missing fetchFn is a wiring
  // bug, not a runtime data condition, so it throws loudly (mirrors travel-ctrip).
  throw new Error(
    "travel-tongcheng: no fetchFn configured for cookie-api mode",
  );
}

module.exports = {
  TongchengAdapter,
  parseRecords,
  orderToRecord,
  extractOrders,
  TYPE_MAP,
  NAME,
  VERSION,
};
