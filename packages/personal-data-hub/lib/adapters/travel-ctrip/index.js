/**
 * Phase 9.3 — Ctrip (携程) order adapter.
 *
 * Ctrip has no official user export. Two input paths:
 *   1. JSON dump from a 3rd-party scraper or user-curated file
 *   2. Email order-confirmation events from Phase 5 (vault-side derive)
 *
 * Ctrip orders cover 4 sub-types: flight / hotel / train / cruise.
 * We map each to the appropriate `vehicleType` in TravelRecord:
 *   flight → "flight", hotel → "hotel", train → "train", cruise → "cruise"
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-ctrip";
const VERSION = "0.6.0"; // §9.3b — account.email OPTIONAL + inputPath snapshot alias

class CtripAdapter {
  constructor(opts = {}) {
    // §9.3b 2026-05-25 — account.email OPTIONAL (mirror shopping-jd/taobao
    // dual-mode). file-import mode is stateless; bookkeeping account.email
    // is informational, not gating. Earlier strict ctor blocked
    // auto-register at boot → Android collector ship JSON staging path
    // failed with silent "no adapter travel-ctrip".
    this.account = opts.account || null;
    this._dataPath = opts.dataPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["import:json", "sync:snapshot", "parse:ctrip-orders"];
    this.extractMode = "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "ctrip:orderId / type / fromCity / toCity / dates / passengerName / price / carrier",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate(ctx = {}) {
    // Snapshot / file-import path: validate file readable when an inputPath
    // / dataPath is provided. Otherwise return ok with whatever account
    // bookkeeping we have (file path can be supplied later via sync(opts)).
    const filePath = (ctx && ctx.inputPath) || ctx.dataPath || this._dataPath;
    if (filePath) {
      try { fs.accessSync(filePath, fs.constants.R_OK); }
      catch (err) {
        return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `not readable at ${filePath}: ${err.message}` };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    return { ok: true, account: this.account ? this.account.email : null, mode: "ready" };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    // Snapshot mode aliases dataPath → inputPath so Android in-APK cc can
    // call syncAdapter("travel-ctrip", path) with the same shape it uses
    // for the other snapshot-mode adapters (shopping-jd / travel-12306).
    const dataPath = opts.inputPath || opts.dataPath || this._dataPath;
    if (!dataPath || !fs.existsSync(dataPath)) return;
    const text = fs.readFileSync(dataPath, "utf-8");
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

function orderToRecord(o) {
  if (!o || typeof o !== "object") return null;
  const recordId = o.orderId || o.id || o.order_no;
  if (!recordId) return null;
  const type = (o.type || o.orderType || "").toLowerCase();
  const vehicleType = TYPE_MAP[type] || "trip";

  return {
    vendorId: "ctrip",
    recordId: String(recordId),
    vehicleType,
    from: o.fromCity || o.from_city || o.depCity
      ? { city: o.fromCity || o.from_city || o.depCity }
      : null,
    to: o.toCity || o.to_city || o.arrCity || o.hotelCity
      ? { city: o.toCity || o.to_city || o.arrCity || o.hotelCity }
      : null,
    departureMs: numberOrParse(o.departureTime || o.dep_time || o.checkIn || o.check_in),
    arrivalMs: numberOrParse(o.arrivalTime || o.arr_time || o.checkOut || o.check_out),
    carrier: o.carrier || o.airline || o.hotelName || o.hotel_name || "携程",
    vehicleNumber: o.flightNumber || o.flight_no || o.trainNumber || o.train_no,
    totalCost: o.price != null
      ? { value: parseFloat(o.price), currency: o.currency || "CNY" }
      : null,
    traveler: o.passengerName || o.passenger || o.guestName || o.guest_name,
    confirmationCode: o.confirmationCode || o.pnr || o.confirmation_no,
    bookedAt: numberOrParse(o.bookedAt || o.order_time),
    extras: {
      type,
      ...(o.hotel ? { hotel: o.hotel } : {}),
      ...(o.nights != null ? { nights: o.nights } : {}),
    },
  };
}

function numberOrParse(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v) && v.length >= 10) return parseInt(v, 10);
    return parseChineseDateTime(v);
  }
  return null;
}

module.exports = { CtripAdapter, parseRecords, TYPE_MAP, NAME, VERSION };
