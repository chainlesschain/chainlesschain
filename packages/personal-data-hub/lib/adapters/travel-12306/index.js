/**
 * §2.5 v0.2 — 12306 (China Railway) ticket adapter, dual-mode.
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's Kyfw12306LocalCollector. The collector
 *      uses captured login cookie to hit kyfw.12306.cn `/otn/queryOrder/
 *      queryMyOrder` + `/otn/queryOrder/queryMyOrderNoComplete` (cookie-only,
 *      no signing), parses each ticket into a structured event, writes JSON.
 *      Desktop-independent. account is OPTIONAL at construction.
 *
 *   2. file-import mode (opts.dataPath, legacy v0.5): user-uploaded JSON
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
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-12306";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_TICKET = "ticket";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_TICKET]);

class Train12306Adapter {
  constructor(opts = {}) {
    // §2.5 v0.2: account.username OPTIONAL — snapshot mode is stateless and
    // doesn't need a pre-known username. file-import mode still requires it,
    // checked at sync time, not construction.
    this.account = opts.account || null;
    this._dataPath = opts.dataPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "import:json",
      "parse:12306-orders",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
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
    if (this._dataPath || (ctx && typeof ctx.dataPath === "string")) {
      if (!this.account || !this.account.username) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_USERNAME",
          message: "travel-12306.authenticate: file-import mode requires account.username",
        };
      }
      return { ok: true, account: this.account.username, mode: "file-import" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-12306.authenticate: needs opts.inputPath (snapshot mode) OR opts.dataPath (file-import mode)",
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
    const dataPath = opts.dataPath || this._dataPath;
    if (dataPath) {
      yield* this._syncViaFileImport({ ...opts, dataPath });
      return;
    }
    throw new Error(
      "travel-12306.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dataPath (file-import mode, user-uploaded JSON)",
    );
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
      throw new Error(`travel-12306._syncViaFileImport: parse failed: ${err.message}`);
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
      throw new Error("Train12306Adapter.normalize: raw.payload.record missing");
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
    departureMs: numberOrParse(o.departureTime || o.departure_time || o.start_time),
    arrivalMs: numberOrParse(o.arrivalTime || o.arrival_time || o.end_time),
    carrier: "12306",
    vehicleNumber: o.trainNumber || o.train_no || o.trainNo,
    totalCost: o.price != null
      ? { value: parseFloat(o.price), currency: "CNY" }
      : null,
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

module.exports = {
  Train12306Adapter,
  parseRecords,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
