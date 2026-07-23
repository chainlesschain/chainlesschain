/**
 * §2.5b 地图三联 — Tencent Map (腾讯地图) adapter.
 *
 * 新增本 adapter 把地图三联补齐 (amap / baidu-map / tencent-map)。两条路径
 * 与 travel-baidu-map / travel-amap 同 pattern：
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by TencentMapLocalCollector (WebView cookie scrape on
 *      map.qq.com). Desktop-independent. Adapter stateless — account.
 *      deviceId OPTIONAL at construction.
 *
 *   2. custom sqlite mode: requires opts.dbPath plus an explicit
 *      opts.sqliteTables={route:[...],search:[...]} profile confirmed against
 *      the user's app version. No guessed Tencent table is queried by default.
 *
 * Snapshot schema (mirrors TencentMapLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "tencent-map",
 *     "account": { "uid": "...", "displayName": "..." },
 *     "events": [
 *       { "kind": "favourite", "id": "fav-<rid>",  "capturedAt": <ms>,
 *         "name": "...", "address": "...", "lat": .., "lng": .., "category": "home|company|other" },
 *       { "kind": "search",    "id": "search-<sid>","capturedAt": <ms>,
 *         "query": "...", "city": "..." },
 *       { "kind": "route",     "id": "route-<rid>", "capturedAt": <ms>,
 *         "from": {...}, "to": {...}, "mode": "drive|walk|bus|bike|trip" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { normalizeTravelRecord, parseChineseDateTime } = require("../travel-base");

const NAME = "travel-tencent-map";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_FAVOURITE = "favourite";
const KIND_SEARCH = "search";
const KIND_ROUTE = "route";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_FAVOURITE, KIND_SEARCH, KIND_ROUTE]);

class TencentMapAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;
    this._sqliteTables = normalizeSqliteTables(opts.sqliteTables);
    this._sqliteConfigured = Boolean(
      this._sqliteTables.route.length || this._sqliteTables.search.length,
    );

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      ...(this._sqliteConfigured ? ["sync:custom-sqlite"] : []),
      "parse:tencent-map-favourite",
      "parse:tencent-map-history",
    ];
    this.extractMode = this._sqliteConfigured ? "device-pull" : "file-import";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "tencent:account (uid / displayName, cookie scrape)",
        "tencent:favourite (saved places — home / company / other)",
        "tencent:search_history (queries, snapshot or explicit sqlite profile)",
        "tencent:route_history (planned routes, snapshot or explicit sqlite profile)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        favourite: true,
        search: true,
        route: true,
      },
    };

    this._deps = {
      fs,
      dbDriverFactory: opts.dbDriverFactory || null,
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
    if (this._dbPath || (ctx && typeof ctx.dbPath === "string")) {
      if (!this._sqliteTables.route.length && !this._sqliteTables.search.length) {
        return {
          ok: false,
          reason: "EXPLICIT_SCHEMA_REQUIRED",
          message: "travel-tencent-map: sqlite import requires an app-version-confirmed sqliteTables profile; JSON import is ready",
        };
      }
      return { ok: true, account: this.account && this.account.deviceId, mode: "custom-sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-tencent-map.authenticate: needs opts.inputPath; custom sqlite mode also requires dbPath + sqliteTables",
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
    const dbPath = opts.dbPath || this._dbPath;
    if (dbPath) {
      if (!this._sqliteTables.route.length && !this._sqliteTables.search.length) {
        throw new Error(
          "travel-tencent-map.sync: explicit sqliteTables profile required for custom sqlite import",
        );
      }
      yield* this._syncViaSqlite({ ...opts, dbPath });
      return;
    }
    throw new Error(
      "travel-tencent-map.sync: needs opts.inputPath; custom sqlite mode also requires dbPath + sqliteTables",
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
        `travel-tencent-map.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
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
        parseTime(ev.capturedAt) ||
        parseTime(ev.time) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.rid ||
        null;

      yield {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaSqlite(opts) {
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const routes = selectFirstTable(db, this._sqliteTables.route);
      for (const r of routes) {
        const rec = routeRowToRecord(r);
        if (rec) {
          yield {
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.bookedAt || Date.now(),
            payload: { record: rec, kind: KIND_ROUTE },
          };
        }
      }
      const searches = selectFirstTable(db, this._sqliteTables.search);
      for (const r of searches) {
        const rec = searchRowToRecord(r);
        if (rec) {
          yield {
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.bookedAt || Date.now(),
            payload: { record: rec, kind: KIND_SEARCH },
          };
        }
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("TencentMapAdapter.normalize: payload missing");
    }
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (p.record) {
      return normalizeTravelRecord(p.record, {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    const rec = snapshotEventToRecord(kind, p, raw.originalId);
    return normalizeTravelRecord(rec, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `tencent-map:${kind}:${safe}`;
}

function snapshotEventToRecord(kind, p, originalId) {
  if (kind === KIND_FAVOURITE) {
    return {
      vendorId: "tencentmap",
      recordId: originalId,
      vehicleType: "visit",
      to: {
        name: p.name || p.address || null,
        lat: numberOrNull(p.lat),
        lng: numberOrNull(p.lng),
        city: p.city || null,
      },
      departureMs: parseTime(p.capturedAt),
      carrier: "腾讯地图",
      extras: { category: p.category || null, kind: KIND_FAVOURITE },
    };
  }
  if (kind === KIND_SEARCH) {
    return {
      vendorId: "tencentmap",
      recordId: originalId,
      vehicleType: "visit",
      to: {
        name: p.query || null,
        lat: numberOrNull(p.lat),
        lng: numberOrNull(p.lng),
        city: p.city || null,
      },
      departureMs: parseTime(p.capturedAt),
      carrier: "腾讯地图",
      extras: { query: p.query || null, kind: KIND_SEARCH },
    };
  }
  if (kind === KIND_ROUTE) {
    return {
      vendorId: "tencentmap",
      recordId: originalId,
      vehicleType: detectVehicle(p.mode),
      from: p.from
        ? { name: p.from.name || null, lat: numberOrNull(p.from.lat), lng: numberOrNull(p.from.lng) }
        : undefined,
      to: p.to
        ? { name: p.to.name || null, lat: numberOrNull(p.to.lat), lng: numberOrNull(p.to.lng) }
        : undefined,
      departureMs: parseTime(p.capturedAt),
      carrier: "腾讯地图",
      extras: { mode: p.mode || null, kind: KIND_ROUTE },
    };
  }
  return {
    vendorId: "tencentmap",
    recordId: originalId,
    vehicleType: "visit",
    carrier: "腾讯地图",
    extras: { kind, raw: p },
  };
}

function normalizeSqliteTables(value) {
  const safeList = (input) =>
    (Array.isArray(input) ? input : [])
      .filter((name) => typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name));
  return {
    route: safeList(value && value.route),
    search: safeList(value && value.search),
  };
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
}

function selectFirstTable(db, tableNames) {
  for (const tableName of tableNames) {
    const rows = trySelect(db, `SELECT * FROM "${tableName}" LIMIT 5000`);
    if (rows) return rows;
  }
  return [];
}

function routeRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id || row.uid;
  if (!id) return null;
  return {
    vendorId: "tencentmap",
    recordId: `route-${id}`,
    vehicleType: detectVehicle(row.type || row.mode),
    from: { name: row.start_name || row.from_name, lat: row.start_lat || null, lng: row.start_lng || null },
    to: { name: row.end_name || row.to_name, lat: row.end_lat || null, lng: row.end_lng || null },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "腾讯地图",
    extras: { mode: row.type || row.mode },
  };
}

function searchRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id;
  if (!id) return null;
  return {
    vendorId: "tencentmap",
    recordId: `search-${id}`,
    vehicleType: "visit",
    to: { name: row.key || row.query || row.keyword, lat: row.lat || null, lng: row.lng || null, city: row.city },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "腾讯地图",
    extras: { query: row.key || row.query || row.keyword },
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

function numberOrNull(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return null;
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const parsed = parseChineseDateTime(v);
    if (Number.isFinite(parsed)) return parsed;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
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

module.exports = { TencentMapAdapter, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
