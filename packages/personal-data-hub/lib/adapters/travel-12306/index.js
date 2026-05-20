/**
 * Phase 9.2 — 12306 (China Railway) ticket adapter.
 *
 * Source format: 12306 doesn't have an official user export. We accept
 * two file formats:
 *   1. order-confirmation emails (already adapter-parsed by Phase 5 +
 *      Phase 5.4 travel template). Phase 9.2 reads those events back
 *      out of the vault and **re-normalizes** them into the
 *      adapter-neutral travel schema. This is the "rich vault →
 *      enrich" pattern.
 *   2. user-uploaded JSON dump (e.g. exported from a 3rd-party 12306
 *      scraper, or hand-curated). Optional.
 *
 * For v0.5 we focus on (2) since (1) is purely vault-side derivation
 * the AnalysisEngine can do at query time.
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-12306";
const VERSION = "0.5.0";

class Train12306Adapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.username) {
      throw new Error("Train12306Adapter: opts.account.username required (12306 user id)");
    }
    this.account = opts.account;
    this._dataPath = opts.dataPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["import:json", "parse:12306-orders"];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "12306:orderId / passengerName / trainNumber / fromStation / toStation / departureTime / arrivalTime / seat / price",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate() {
    return { ok: true, account: this.account.username };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dataPath = opts.dataPath || this._dataPath;
    if (!dataPath || !fs.existsSync(dataPath)) return;
    const buf = fs.readFileSync(dataPath, "utf-8");
    let records;
    try {
      records = parseRecords(buf);
    } catch (err) {
      throw new Error(`Train12306Adapter: parse failed: ${err.message}`);
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
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("Train12306Adapter.normalize: raw.payload.record missing");
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

/**
 * Parse a 12306 dump file. Accepts either:
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
      idCardLast6: o.idLast6 || undefined, // for cross-source EntityResolver linking
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

module.exports = { Train12306Adapter, parseRecords, NAME, VERSION };
