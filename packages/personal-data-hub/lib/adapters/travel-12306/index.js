/**
 * §2.5 v0.3 — 12306 (China Railway) ticket adapter, tri-mode.
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's Kyfw12306LocalCollector. The collector
 *      uses captured login cookie to hit kyfw.12306.cn `/otn/queryOrder/
 *      queryMyOrder` + `/otn/queryOrder/queryMyOrderNoComplete` (cookie-only,
 *      no signing), parses each ticket into a structured event, writes JSON.
 *      Desktop-independent. account is OPTIONAL at construction.
 *
 *   2. cookie-api mode (opts.account.cookies, v0.3): fetch the SAME two
 *      kyfw.12306.cn endpoints directly from the hub, so collection no longer
 *      requires a phone. 12306's order endpoints are **cookie-only, no signing**
 *      (no _signature / X-Bogus / anti-content SDK — unlike 抖音/拼多多), so no
 *      signProvider is needed. The actual HTTP call is delegated to an injected
 *      `fetchFn` (Android in-APK cc → OkHttp / Kyfw12306ApiClient; desktop hub →
 *      Electron WebView net request) so this module stays a pure-Node parser +
 *      orchestrator. Completed orders paginate via `pageIndex` (≤50/page, last
 *      90 days by default); pending orders are a single call. account OPTIONAL —
 *      the cookie carries identity. Cookie expires after ~30min idle → the
 *      endpoint returns an HTML login redirect. The host transport rejects
 *      HTTP/non-JSON responses explicitly so a login page cannot be mistaken
 *      for a valid empty order list or advance the watermark.
 *
 *   3. file-import mode (opts.dataPath, legacy v0.5): user-uploaded JSON
 *      dump from a 3rd-party 12306 scraper or hand-curated. Preserved for
 *      backward compat. account.username REQUIRED.
 *
 * Snapshot schema (mirrors Kyfw12306LocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "12306",
 *     "events": [
 *       { "kind": "ticket", "id": "ticket-<seqNo>:<n>",  "capturedAt": <ms>,
 *         "orderSequenceNo": "...", "ticketNumber": "...",
 *         "passengerName": "张三", "passengerIdLast6": "123456",
 *         "trainNumber": "G123",
 *         "fromStation": "上海虹桥", "toStation": "北京南",
 *         "departureMs": <ms>, "arrivalMs": <ms>,
 *         "seatTypeName": "二等座", "coachNo": "05", "seatNo": "12A",
 *         "ticketPrice": 553.5, "orderDateMs": <ms>, "orderTotalPrice": 553.5,
 *         "isCompleted": true }
 *     ]
 *   }
 *
 * Sensitivity: medium — ticket history reveals travel patterns + 6 trailing
 * digits of national ID (used for cross-source EntityResolver linking, never
 * exposed in vault search). Snapshot file is purged after sync.
 */

"use strict";

const fs = require("node:fs");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  normalizeTravelRecord,
  parseChineseDateTime,
} = require("../travel-base");
const {
  CookieAuth,
  hasRuntimeCookie,
  resolveCookieContext,
} = require("../shopping-base");

const NAME = "travel-12306";
const VERSION = "0.7.0"; // §2.5 v0.3 — cookie-api live fetch path
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_TICKET = "ticket";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_TICKET]);

const KYFW_COMPLETED_URL = "https://kyfw.12306.cn/otn/queryOrder/queryMyOrder";
const KYFW_PENDING_URL =
  "https://kyfw.12306.cn/otn/queryOrder/queryMyOrderNoComplete";
const KYFW_REQUEST_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  referer: "https://kyfw.12306.cn/otn/view/index.html",
  "if-modified-since": "0",
  "cache-control": "no-cache",
  accept: "application/json, text/plain, */*",
  "x-requested-with": "XMLHttpRequest",
});
const DAYS_90_MS = 90 * 24 * 3600_000;
const PAGE_SIZE = 50; // 12306 returns ≤50 completed orders per page

class Train12306Adapter {
  constructor(opts = {}) {
    // §2.5 v0.2: account.username OPTIONAL — snapshot mode is stateless and
    // doesn't need a pre-known username. file-import mode still requires it,
    // checked at sync time, not construction.
    this.account = opts.account || null;
    this.defaultScope = createAccountScopeFromAccount(NAME, this.account, [
      "username",
    ]);
    this._dataPath = opts.dataPath || null;

    // §2.5 v0.3 cookie-api mode — activates when account.cookies is supplied.
    // 12306 order endpoints are cookie-only (no signing), so no signProvider.
    this._cookieAuth =
      opts.account && opts.account.cookies
        ? new CookieAuth({ platform: "12306", cookies: opts.account.cookies })
        : null;
    // The actual HTTP call is delegated to an injected fetchFn so this module
    // stays a pure-Node parser/orchestrator (same seam as the shopping
    // adapters). fetchFn({ url, cookies, form }) → parsed JSON response object.
    this._fetchFn =
      typeof opts.fetchFn === "function" ? opts.fetchFn : defaultFetch;

    this.name = NAME;
    this.runtimeScopeIdentityKey = "username";
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:cookie-api",
      "import:json",
      "parse:12306-orders",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = { perMinute: 6, perDay: 100 };
    this.dataDisclosure = {
      fields: [
        "12306:orderSequenceNo / ticketNumber / passengerName / trainNumber / fromStation / toStation / departureMs / arrivalMs / seat / price",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        ticket: true,
      },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require.
    this._deps = {
      fs,
    };
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
      platform: "12306",
      identityKey: "username",
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
      // account is OPTIONAL in cookie mode — the 12306 cookie carries identity.
      if (hasRuntimeCookie(ctx) && (!account || !account.username)) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USERNAME",
          message:
            "travel-12306 cookie-api mode requires opts.accountId for an isolated watermark scope",
        };
      }
      return {
        ok: true,
        account: (account && account.username) || null,
        mode: "cookie",
      };
    }
    if (this._dataPath || (ctx && typeof ctx.dataPath === "string")) {
      if (!this.account || !this.account.username) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USERNAME",
          message:
            "travel-12306.authenticate: file-import mode requires account.username",
        };
      }
      return { ok: true, account: this.account.username, mode: "file-import" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-12306.authenticate: needs opts.inputPath (snapshot mode) OR configured account.cookies OR opts.cookie + opts.accountId (cookie-api mode) OR opts.dataPath (file-import mode)",
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
    const dataPath = opts.dataPath || this._dataPath;
    if (dataPath) {
      yield* this._syncViaFileImport({ ...opts, dataPath });
      return;
    }
    throw new Error(
      "travel-12306.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR configured account.cookies OR opts.cookie + opts.accountId (cookie-api mode, kyfw.12306.cn live fetch) OR opts.dataPath (file-import mode, user-uploaded JSON)",
    );
  }

  /**
   * §2.5 v0.3 — cookie-api live fetch. Hits the same two kyfw.12306.cn order
   * endpoints the on-device collector uses (cookie-only, no signing). The
   * injected fetchFn performs the HTTP; this method paginates, flattens each
   * order's tickets into snapshot-shaped ticket events, and yields them so the
   * existing snapshot normalize path applies unchanged.
   */
  async *_syncViaCookie(opts = {}) {
    const { account, cookieAuth } = resolveCookieContext({
      account: this.account,
      cookieAuth: this._cookieAuth,
      opts,
      platform: "12306",
      identityKey: "username",
    });
    if (hasRuntimeCookie(opts) && (!account || !account.username)) {
      throw new Error(
        "travel-12306._syncViaCookie: opts.accountId required for transient cookie collection",
      );
    }
    if (!cookieAuth || !(await cookieAuth.validate())) return;
    const cookies = cookieAuth.toHeader();
    const include = opts.include || {};
    if (include[KIND_TICKET] === false) return;

    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const maxPages =
      Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : 4;
    const endDateMs = Number.isFinite(opts.endDateMs)
      ? opts.endDateMs
      : Date.now();
    // queryMyOrder caps the range at 90 days; honour an explicit start /
    // sinceWatermark but never reach back further than 90d in one query.
    const requestedStart = Number.isFinite(opts.startDateMs)
      ? opts.startDateMs
      : opts.sinceWatermark != null
        ? parseInt(String(opts.sinceWatermark), 10) || endDateMs - DAYS_90_MS
        : endDateMs - DAYS_90_MS;
    const startDateMs = Math.max(requestedStart, endDateMs - DAYS_90_MS);
    const queryStartDate = fmtDateShanghai(startDateMs);
    const queryEndDate = fmtDateShanghai(endDateMs);

    let emitted = 0;
    let sourceRequests = 0;

    // ── completed orders (paginated) ──────────────────────────────────────
    let page = 1;
    let completedScanComplete = false;
    while (sourceRequests < maxPages) {
      const form = {
        come_from_flag: "my_order",
        queryStartDate,
        queryEndDate,
        queryType: "1",
        sequeue_train_name: "",
        pageSize: String(PAGE_SIZE),
        pageIndex: String(page),
        query_where: "G",
      };
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "completed-orders",
          page,
        });
      }
      sourceRequests += 1;
      const resp = await this._fetchFn({
        url: KYFW_COMPLETED_URL,
        cookies,
        headers: KYFW_REQUEST_HEADERS,
        form,
      });
      const orders = extractCompletedOrders(resp);
      if (!hasCompletedOrderList(resp)) break;
      if (orders.length === 0) {
        completedScanComplete = true;
        break;
      }
      for (const order of orders) {
        for (const ev of ticketsFromOrder(order, true)) {
          if (emitted >= limit) return;
          yield cookieEventToRecord(ev);
          emitted += 1;
        }
      }
      if (orders.length < PAGE_SIZE) {
        completedScanComplete = true;
        break; // last page
      }
      page += 1;
    }

    // ── pending orders (single call, usually empty) ───────────────────────
    let pendingScanComplete = false;
    if (emitted < limit && sourceRequests < maxPages) {
      if (typeof opts.beforeSourceRequest === "function") {
        await opts.beforeSourceRequest({
          operation: "pending-orders",
          page: 1,
        });
      }
      sourceRequests += 1;
      const resp = await this._fetchFn({
        url: KYFW_PENDING_URL,
        cookies,
        headers: KYFW_REQUEST_HEADERS,
        form: {},
      });
      pendingScanComplete = hasPendingOrderList(resp);
      for (const order of extractPendingOrders(resp)) {
        for (const ev of ticketsFromOrder(order, false)) {
          if (emitted >= limit) return;
          yield cookieEventToRecord(ev);
          emitted += 1;
        }
      }
    }
    if (
      completedScanComplete &&
      pendingScanComplete &&
      typeof opts.markWatermarkComplete === "function"
    ) {
      opts.markWatermarkComplete();
    }
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `travel-12306.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
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
        (Number.isFinite(ev.capturedAt) && ev.capturedAt) ||
        (Number.isFinite(ev.departureMs) && ev.departureMs) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.orderSequenceNo ||
        null;

      yield {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(id || `unknown-${emitted}`),
        capturedAt,
        payload: { ...ev, snapshot: true },
      };
      emitted += 1;
    }
  }

  async *_syncViaFileImport(opts) {
    if (!this.account || !this.account.username) {
      throw new Error(
        "travel-12306._syncViaFileImport: account.username required (set via new Train12306Adapter({ account: { username } }))",
      );
    }
    const dataPath = opts.dataPath;
    if (!dataPath || !this._deps.fs.existsSync(dataPath)) return;
    const buf = this._deps.fs.readFileSync(dataPath, "utf-8");
    let records;
    try {
      records = parseRecords(buf);
    } catch (err) {
      throw new Error(
        `travel-12306._syncViaFileImport: parse failed: ${err.message}`,
      );
    }
    for (const r of records) {
      yield {
        adapter: NAME,
        originalId: String(r.recordId || r.orderId || r.ticketNumber),
        capturedAt: r.bookedAt || r.departureMs || Date.now(),
        payload: { record: r },
      };
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("Train12306Adapter.normalize: payload missing");
    }
    // Snapshot-mode payload is the parsed event directly; legacy file-import
    // payload has `.record` (already normalized shape).
    if (raw.payload.snapshot) {
      return normalizeTravelRecord(snapshotEventToRecord(raw.payload), {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    if (!raw.payload.record) {
      throw new Error(
        "Train12306Adapter.normalize: raw.payload.record missing",
      );
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function stableOriginalId(id) {
  return `12306:ticket:${id}`;
}

/** Convert a v0.2 snapshot event into the adapter-neutral travel record
 *  shape that [normalizeTravelRecord] expects. */
function snapshotEventToRecord(ev) {
  return {
    vendorId: "12306",
    recordId: String(ev.id || ev.orderSequenceNo || ev.ticketNumber),
    vehicleType: "train",
    from: { station: ev.fromStation },
    to: { station: ev.toStation },
    departureMs: ev.departureMs || null,
    arrivalMs: ev.arrivalMs || null,
    carrier: "12306",
    vehicleNumber: ev.trainNumber,
    totalCost:
      Number.isFinite(ev.ticketPrice) && ev.ticketPrice > 0
        ? { value: ev.ticketPrice, currency: "CNY" }
        : null,
    traveler: ev.passengerName,
    confirmationCode: ev.ticketNumber || ev.orderSequenceNo,
    bookedAt: ev.orderDateMs || null,
    extras: {
      seat: ev.seatTypeName,
      coachNo: ev.coachNo,
      seatNumber: ev.seatNo,
      isCompleted: ev.isCompleted,
      idLast6: ev.passengerIdLast6 || undefined,
      orderTotalPrice: ev.orderTotalPrice || undefined,
      capturedVia: ev.capturedVia || undefined,
    },
  };
}

/**
 * Parse a 12306 dump file (legacy v0.5 file-import mode). Accepts either:
 *   - JSON array of order objects
 *   - JSON object { orders: [...] }
 *   - JSONL (one order per line)
 */
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

function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const recordId = o.orderId || o.ticketNumber || o.id || o.order_no;
  if (!recordId) return null;
  return {
    vendorId: "12306",
    recordId: String(recordId),
    vehicleType: "train",
    from: {
      station: o.fromStation || o.from_station || o.from,
      city: o.fromCity || o.from_city,
    },
    to: {
      station: o.toStation || o.to_station || o.to,
      city: o.toCity || o.to_city,
    },
    departureMs: numberOrParse(
      o.departureTime || o.departure_time || o.start_time,
    ),
    arrivalMs: numberOrParse(o.arrivalTime || o.arrival_time || o.end_time),
    carrier: "12306",
    vehicleNumber: o.trainNumber || o.train_no || o.trainNo,
    totalCost:
      o.price != null ? { value: parseFloat(o.price), currency: "CNY" } : null,
    traveler: o.passengerName || o.passenger || o.name,
    confirmationCode: o.ticketNumber || o.ticket_no || recordId,
    bookedAt: numberOrParse(o.bookedAt || o.order_time),
    extras: {
      seat: o.seat || o.seatType,
      seatNumber: o.seatNumber || o.seat_number,
      idCardLast6: o.idLast6 || undefined,
    },
  };
}

function numberOrParse(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    return parseChineseDateTime(v);
  }
  return null;
}

// ─── cookie-api (v0.3) helpers ──────────────────────────────────────────────

/** Wrap a cookie-mode ticket event into the same yield shape the snapshot path
 *  produces, so normalize() routes it through snapshotEventToRecord unchanged. */
function cookieEventToRecord(ev) {
  const capturedAt =
    (Number.isFinite(ev.departureMs) && ev.departureMs) ||
    (Number.isFinite(ev.orderDateMs) && ev.orderDateMs) ||
    Date.now();
  return {
    adapter: NAME,
    kind: KIND_TICKET,
    originalId: stableOriginalId(ev.id || ev.orderSequenceNo),
    capturedAt,
    payload: { ...ev, snapshot: true },
  };
}

/** Pull the completed-order array out of a queryMyOrder response. */
function extractCompletedOrders(resp) {
  const data = resp && typeof resp === "object" ? resp.data : null;
  if (!data || typeof data !== "object") return [];
  const list = data.OrderDTODataList || data.orderDTODataList;
  return Array.isArray(list) ? list : [];
}

function hasCompletedOrderList(resp) {
  const data = resp && typeof resp === "object" ? resp.data : null;
  return !!(
    data &&
    typeof data === "object" &&
    (Array.isArray(data.OrderDTODataList) ||
      Array.isArray(data.orderDTODataList))
  );
}

/** Pull the pending-order array out of a queryMyOrderNoComplete response. */
function extractPendingOrders(resp) {
  const data = resp && typeof resp === "object" ? resp.data : null;
  if (!data || typeof data !== "object") return [];
  const list = data.orderDBList || data.orderDbList;
  return Array.isArray(list) ? list : [];
}

function hasPendingOrderList(resp) {
  const data = resp && typeof resp === "object" ? resp.data : null;
  return !!(
    data &&
    typeof data === "object" &&
    (Array.isArray(data.orderDBList) || Array.isArray(data.orderDbList))
  );
}

/**
 * Flatten one 12306 order JSON object into per-ticket snapshot events. Mirrors
 * Kyfw12306ApiClient.parseOrderTickets — one order carries 1..N tickets, each
 * flattened so the vault maps 1:1 to "I rode train G123 on date D". Field names
 * are best-effort across endpoint versions (snake_case + camelCase fallbacks).
 */
function ticketsFromOrder(order, isCompleted) {
  if (!order || typeof order !== "object") return [];
  const sequenceNo = pickStr(order.sequence_no) || pickStr(order.sequenceNo);
  if (!sequenceNo) return [];
  const orderDateMs = parseYyyymmdd(
    pickStr(order.order_date) || pickStr(order.orderDate),
  );
  const orderTotalPrice = toNum(
    order.ticket_total_price || order.ticketTotalPrice,
  );
  const tickets = Array.isArray(order.tickets) ? order.tickets : [];
  const out = [];
  tickets.forEach((t, i) => {
    if (!t || typeof t !== "object") return;
    const passengerName = pickStr(t.passenger_name) || pickStr(t.passengerName);
    if (!passengerName) return;
    const trainNumber = pickStr(t.train_code) || pickStr(t.stationTrainCode);
    if (!trainNumber) return;
    const fromStation =
      pickStr(t.from_station_name) || pickStr(t.from_station_name_page);
    const toStation =
      pickStr(t.to_station_name) || pickStr(t.to_station_name_page);
    if (!fromStation || !toStation) return;
    const idNo = pickStr(t.passenger_id_no) || pickStr(t.passengerIdNo);
    const idLast6 = idNo && idNo.length >= 6 ? idNo.slice(-6) : null;
    out.push({
      kind: KIND_TICKET,
      id: `ticket-${sequenceNo}:${i}`,
      orderSequenceNo: sequenceNo,
      ticketNumber: pickStr(t.ticket_no) || pickStr(t.ticketNo) || null,
      passengerName,
      passengerIdLast6: idLast6 || undefined,
      trainNumber,
      fromStation,
      toStation,
      departureMs: parse12306DateTime(
        pickStr(t.start_train_date_page) || pickStr(t.start_train_date),
      ),
      arrivalMs: parse12306DateTime(pickStr(t.arrive_train_date_page)),
      seatTypeName:
        pickStr(t.seat_type_name) || pickStr(t.seatTypeName) || null,
      coachNo: pickStr(t.coach_no) || pickStr(t.coachNo) || null,
      seatNo: pickStr(t.seat_no) || pickStr(t.seatNo) || null,
      ticketPrice: toNum(t.ticket_price) || toNum(t.ticketPrice) || 0,
      orderDateMs,
      orderTotalPrice,
      isCompleted,
      capturedVia: "cookie-api",
    });
  });
  return out;
}

/** Format epoch-ms as a 12306 `yyyy-MM-dd` query date in Asia/Shanghai. */
function fmtDateShanghai(ms) {
  const d = new Date(ms + 8 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse the date shapes 12306 returns into epoch-ms (Asia/Shanghai):
 *   "2024-03-20" / "2024-03-20 09:00" / "2024年03月20日 09:00".
 * Returns null on blank/unparseable so capturedAt can fall back.
 */
function parse12306DateTime(s) {
  if (!s || typeof s !== "string") return null;
  const str = s.trim();
  if (!str) return null;
  if (str.includes("年")) return parseChineseDateTime(str);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(str);
  if (m) {
    const [, y, mo, d, hh, mm] = m;
    // Shanghai is UTC+8 → subtract 8h from the wall-clock to get UTC ms.
    return Date.UTC(+y, +mo - 1, +d, (hh ? +hh : 0) - 8, mm ? +mm : 0);
  }
  const t = Date.parse(str);
  return Number.isFinite(t) ? t : null;
}

/** Parse a `yyyyMMdd` order date into epoch-ms (Asia/Shanghai). */
function parseYyyymmdd(s) {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), -8, 0);
}

function pickStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toNum(v) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

async function defaultFetch(_opts) {
  // Pure-Node has no HTTP layer; the host (Android cc → Kyfw12306ApiClient /
  // desktop hub → Electron WebView net) injects a real fetchFn. Mirrors the
  // shopping adapters' defaultFetch — a missing fetchFn is a wiring bug, not a
  // runtime data condition, so it throws loudly rather than silently emitting 0.
  throw new Error("travel-12306: no fetchFn configured for cookie-api mode");
}

module.exports = {
  Train12306Adapter,
  parseRecords,
  ticketsFromOrder,
  extractCompletedOrders,
  extractPendingOrders,
  parse12306DateTime,
  parseYyyymmdd,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
