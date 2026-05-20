/**
 * Phase 9.4b — Baidu Map (百度地图) location history adapter.
 *
 * Parallels travel-amap but uses Baidu's table names. Per
 * sjqz/parsers/baidumap.py the key tables are:
 *   - search_history (queries)
 *   - route_history  (planned routes)
 *   - my_favourite   (saved places)
 *   - offline_map    (downloaded offline maps; v2)
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-baidu-map";
const VERSION = "0.5.0";

class BaiduMapAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.deviceId) {
      throw new Error("BaiduMapAdapter: opts.account.deviceId required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:baidu-map-history"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "baidu:search_history",
        "baidu:route_history",
        "baidu:my_favourite",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate() {
    return { ok: true, account: this.account.deviceId };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Database = this._dbDriverFactory || (() => require("better-sqlite3-multiple-ciphers"));
    const Driver = typeof Database === "function" ? Database() : Database;
    const db = new Driver(dbPath, { readonly: true });

    try {
      const routes = trySelect(db, "SELECT * FROM route_history LIMIT 5000")
        || trySelect(db, "SELECT * FROM bd_route_history LIMIT 5000") || [];
      for (const r of routes) {
        const rec = routeRowToRecord(r);
        if (rec) {
          yield {
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.bookedAt || Date.now(),
            payload: { record: rec, kind: "route" },
          };
        }
      }
      const searches = trySelect(db, "SELECT * FROM search_history LIMIT 5000") || [];
      for (const r of searches) {
        const rec = searchRowToRecord(r);
        if (rec) {
          yield {
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.bookedAt || Date.now(),
            payload: { record: rec, kind: "search" },
          };
        }
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("BaiduMapAdapter.normalize: raw.payload.record missing");
    }
    return normalizeTravelRecord(raw.payload.record, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
}

function routeRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id || row.uid;
  if (!id) return null;
  return {
    vendorId: "baidumap",
    recordId: `route-${id}`,
    vehicleType: detectVehicle(row.type || row.mode),
    from: { name: row.start_name || row.from_name, lat: row.start_lat || null, lng: row.start_lng || null },
    to: { name: row.end_name || row.to_name, lat: row.end_lat || null, lng: row.end_lng || null },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "百度地图",
    extras: { mode: row.type || row.mode },
  };
}

function searchRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id;
  if (!id) return null;
  return {
    vendorId: "baidumap",
    recordId: `search-${id}`,
    vehicleType: "visit",
    to: { name: row.key || row.query, lat: row.lat || null, lng: row.lng || null, city: row.city },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "百度地图",
    extras: { query: row.key || row.query },
  };
}

function detectVehicle(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("drive") || s.includes("car")) return "car";
  if (s.includes("walk")) return "walk";
  if (s.includes("bike") || s.includes("cycle")) return "bike";
  if (s.includes("bus") || s.includes("transit")) return "bus";
  return "trip";
}

function numberOrParse(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    return parseChineseDateTime(v);
  }
  return null;
}

module.exports = { BaiduMapAdapter, NAME, VERSION };
