/**
 * Phase 9.4 — Amap (高德地图) location history adapter.
 *
 * Source: Amap stores recent navigation / search history in app-local
 * SQLite DBs. Per sjqz/parsers/amap.py, the relevant tables are:
 *   - history_search  (search queries)
 *   - history_route   (planned routes)
 *   - favourites      (saved locations like 公司 / 家)
 *
 * Adapter extractMode is "device-pull" — relies on Phase 7.5
 * AndroidExtractor to pull the .db files from Amap's app-private
 * directory. For v0.5 we accept a pre-pulled local path (file-import
 * fallback) so users without root can hand-extract via adb backup.
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-amap";
const VERSION = "0.7.0";

class AmapAdapter {
  constructor(opts = {}) {
    // 2026-05-25 — account.deviceId OPTIONAL (mirror Taobao/Ctrip/Telegram).
    // sqlite-mode adapter still requires user to provide a pulled amap.db
    // (`/data/data/com.autonavi.minimap/databases/amap.db`). Earlier strict
    // ctor blocked auto-register at boot → silent "no adapter travel-amap"
    // when Android collector ships extracted db.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || opts.inputPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "sync:snapshot",
      "import:sqlite",
      "parse:amap-history",
      "parse:amap-favourites",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "amap:search_history (query / time / location)",
        "amap:route_history (from / to / mode / time)",
        "amap:favourites (name / address / coords)",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate(ctx = {}) {
    const dbPath = (ctx && (ctx.inputPath || ctx.dbPath)) || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return { ok: true, account: this.account ? this.account.deviceId : null, mode: "ready" };
    }
    return { ok: true, account: this.account ? this.account.deviceId : null, mode: "snapshot-file" };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath = opts.inputPath || opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Database = this._dbDriverFactory || (() => require("better-sqlite3-multiple-ciphers"));
    const Driver = typeof Database === "function" ? Database() : Database;
    const db = new Driver(dbPath, { readonly: true });

    try {
      // History routes (most analytically valuable)
      const routes = trySelect(db, "SELECT * FROM history_route LIMIT 5000")
        || trySelect(db, "SELECT * FROM ROUTE_HISTORY LIMIT 5000")
        || [];
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
      // History search (queries — produce trip events of type "visit")
      const searches = trySelect(db, "SELECT * FROM history_search LIMIT 5000") || [];
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
      const favourites =
        trySelect(db, "SELECT * FROM favourites LIMIT 5000") ||
        trySelect(db, "SELECT * FROM favorite LIMIT 5000") ||
        trySelect(db, "SELECT * FROM favorite_poi LIMIT 5000") ||
        [];
      for (const row of favourites) {
        const rec = favouriteRowToRecord(row);
        if (rec) {
          yield {
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.bookedAt || Date.now(),
            payload: { record: rec, kind: "favourite" },
          };
        }
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.record) {
      throw new Error("AmapAdapter.normalize: raw.payload.record missing");
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
  const id = row.id || row._id || row.uid || row.guid;
  if (!id) return null;
  return {
    vendorId: "amap",
    recordId: `route-${id}`,
    vehicleType: row.mode === "drive" ? "car" : (row.mode || "trip"),
    from: { name: row.from_name || row.fromName || row.start, lat: row.from_lat || null, lng: row.from_lng || null },
    to: { name: row.to_name || row.toName || row.dest, lat: row.to_lat || null, lng: row.to_lng || null },
    departureMs: numberOrParse(row.time || row.create_time || row.start_time),
    carrier: "高德地图",
    extras: { mode: row.mode },
  };
}

function searchRowToRecord(row) {
  if (!row) return null;
  const id = row.id || row._id || row.guid;
  if (!id) return null;
  // Search = a "visit" intent
  return {
    vendorId: "amap",
    recordId: `search-${id}`,
    vehicleType: "visit",
    to: { name: row.keyword || row.query || row.poiname, lat: row.lat || null, lng: row.lng || null, city: row.city },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "高德地图",
    extras: { query: row.keyword || row.query },
  };
}

function favouriteRowToRecord(row) {
  if (!row) return null;
  const id = row.id || row._id || row.guid || row.poi_id || row.poiid;
  if (!id) return null;
  const name = row.name || row.title || row.poiname || row.poi_name || row.address;
  if (!name) return null;
  return {
    vendorId: "amap",
    recordId: `favourite-${id}`,
    vehicleType: "visit",
    to: {
      name,
      lat: numberOrNull(row.lat || row.latitude || row.y),
      lng: numberOrNull(row.lng || row.lon || row.longitude || row.x),
      city: row.city || row.city_name || row.cityname || null,
    },
    departureMs: numberOrParse(
      row.time || row.create_time || row.created_at || row.update_time,
    ),
    carrier: "高德地图",
    extras: {
      kind: "favourite",
      category: row.category || row.type || row.poi_type || null,
      address: row.address || row.addr || null,
    },
  };
}

function numberOrNull(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
    return Number.parseFloat(v);
  }
  return null;
}

function numberOrParse(v) {
  if (Number.isFinite(v)) {
    // Amap timestamps are sometimes seconds — heuristic upgrade to ms
    return v > 1e12 ? v : (v > 1e10 ? v : v * 1000);
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : (n > 1e10 ? n : n * 1000);
    }
    return parseChineseDateTime(v);
  }
  return null;
}

module.exports = { AmapAdapter, favouriteRowToRecord, NAME, VERSION };
