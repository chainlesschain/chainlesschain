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
const crypto = require("node:crypto");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
const {
  inspectSnapshotFile,
  probeSnapshotFile,
} = require("../../snapshot-file");
const {
  normalizeTravelRecord,
  parseChineseDateTime,
} = require("../travel-base");
const {
  advanceCursor,
  assertScanIdentity,
  beginScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "travel-amap";
const VERSION = "0.8.0";
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");

class AmapAdapter {
  constructor(opts = {}) {
    // 2026-05-25 — account.deviceId OPTIONAL (mirror Taobao/Ctrip/Telegram).
    // sqlite-mode adapter still requires user to provide a pulled amap.db
    // (`/data/data/com.autonavi.minimap/databases/amap.db`). Earlier strict
    // ctor blocked auto-register at boot → silent "no adapter travel-amap"
    // when Android collector ships extracted db.
    this.account = opts.account || null;
    this._dbPath = opts.inputPath || opts.dataPath || opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["deviceId", "uid", "userId", "accountId"],
    );
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
    this.watermarkStrategy = "explicit";
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

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    const inputPath =
      options.inputPath || options.dataPath || options.dbPath || this._dbPath;
    if (typeof inputPath !== "string" || inputPath.length === 0) {
      return this.defaultScope;
    }
    return scopeForSqliteFile(
      fs,
      inputPath,
      options.maxSnapshotBytes,
      this.defaultScope,
    );
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    const dbPath =
      (ctx && (ctx.inputPath || ctx.dataPath || ctx.dbPath)) || this._dbPath;
    if (!dbPath) {
      return {
        ok: false,
        reason: "NO_INPUT",
        message:
          "travel-amap.authenticate: needs opts.inputPath/dataPath (pre-pulled Amap SQLite snapshot)",
      };
    }
    const probe = probeSnapshotFile(fs, dbPath, {
      maxBytes: ctx && ctx.maxSnapshotBytes,
    });
    if (!probe.ok) {
      return probe;
    }
    if (!hasSqliteMagic(fs, dbPath)) {
      return {
        ok: false,
        reason: "SNAPSHOT_SCHEMA_MISMATCH",
        message: "travel-amap snapshot is not a SQLite database",
      };
    }
    return {
      ok: true,
      account: this.account ? this.account.deviceId : null,
      mode: "snapshot-file",
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
    const dbPath =
      opts.inputPath || opts.dataPath || opts.dbPath || this._dbPath;
    if (!dbPath) {
      throw new Error(
        "travel-amap.sync: needs opts.inputPath/dataPath (pre-pulled Amap SQLite snapshot)",
      );
    }
    const probe = probeSnapshotFile(fs, dbPath, {
      maxBytes: opts.maxSnapshotBytes,
    });
    if (!probe.ok) {
      throw new Error(`travel-amap.sync: ${probe.message || probe.reason}`);
    }
    if (!hasSqliteMagic(fs, dbPath)) {
      const error = new Error(
        "travel-amap.sync: snapshot is not a SQLite database",
      );
      error.code = "SNAPSHOT_SCHEMA_MISMATCH";
      throw error;
    }
    const inspected = inspectSnapshotFile(fs, dbPath, {
      maxBytes: opts.maxSnapshotBytes,
    });
    const fallbackCapturedAt = fileCapturedAt(inspected.stat);
    const Database =
      this._dbDriverFactory ||
      (() => require("better-sqlite3-multiple-ciphers"));
    const Driver = typeof Database === "function" ? Database() : Database;
    const db = new Driver(dbPath, { readonly: true });

    try {
      const records = [];
      // History routes (most analytically valuable)
      const routes =
        trySelect(db, "SELECT * FROM history_route") ||
        trySelect(db, "SELECT * FROM ROUTE_HISTORY") ||
        [];
      for (const r of routes) {
        const rec = routeRowToRecord(r);
        if (rec) {
          records.push({
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.departureMs || fallbackCapturedAt,
            payload: { record: rec, kind: "route" },
          });
        }
      }
      // History search (queries — produce trip events of type "visit")
      const searches = trySelect(db, "SELECT * FROM history_search") || [];
      for (const r of searches) {
        const rec = searchRowToRecord(r);
        if (rec) {
          records.push({
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.departureMs || fallbackCapturedAt,
            payload: { record: rec, kind: "search" },
          });
        }
      }
      const favourites =
        trySelect(db, "SELECT * FROM favourites") ||
        trySelect(db, "SELECT * FROM favorite") ||
        trySelect(db, "SELECT * FROM favorite_poi") ||
        [];
      for (const row of favourites) {
        const rec = favouriteRowToRecord(row);
        if (rec) {
          records.push({
            adapter: NAME,
            originalId: rec.recordId,
            capturedAt: rec.departureMs || fallbackCapturedAt,
            payload: { record: rec, kind: "favourite" },
          });
        }
      }
      records.sort(compareCollectionRecords);
      const include = opts.include || {};
      const selected = records.filter(
        (record) => include[record.payload.kind] !== false,
      );
      yield* yieldCollection(opts, {
        config: collectionConfig(include),
        records: selected,
        source: collectionSource(selected),
      });
    } finally {
      try {
        db.close();
      } catch {
        // Best-effort close; preserve the primary sync result or error.
      }
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

function fileCapturedAt(stat) {
  const value = Number(stat && stat.mtimeMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(include) {
  return digest(
    Buffer.from(
      JSON.stringify({
        include: {
          favourite: include.favourite !== false,
          route: include.route !== false,
          search: include.search !== false,
        },
        mode: "sqlite",
      }),
      "utf8",
    ),
  );
}

function collectionSource(records) {
  return digest(
    Buffer.from(
      stableStringify(
        records.map((record) => ({
          kind: record.payload.kind,
          originalId: record.originalId,
          record: record.payload.record,
        })),
      ),
      "utf8",
    ),
  );
}

function stableStringify(value) {
  return JSON.stringify(canonicalDigestValue(value));
}

function canonicalDigestValue(value) {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return { $buffer: value.toString("base64") };
  }
  if (Array.isArray(value)) return value.map(canonicalDigestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalDigestValue(value[key])]),
    );
  }
  return value;
}

function compareCollectionRecords(left, right) {
  const kinds = ["route", "search", "favourite"];
  const kindOrder =
    kinds.indexOf(left.payload.kind) - kinds.indexOf(right.payload.kind);
  if (kindOrder !== 0) return kindOrder;
  const leftTime = Number.isFinite(left.capturedAt)
    ? left.capturedAt
    : Number.NEGATIVE_INFINITY;
  const rightTime = Number.isFinite(right.capturedAt)
    ? right.capturedAt
    : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.originalId.localeCompare(right.originalId, "en");
}

function prepareCursor(sinceWatermark, identity) {
  let cursor = parseCursor(sinceWatermark).cursor;
  cursor =
    cursor.upper === null
      ? beginScan(cursor, identity)
      : assertScanIdentity(cursor, identity);
  return cursor;
}

async function* yieldCollection(opts, { config, records, source }) {
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
  let cursor = prepareCursor(opts.sinceWatermark, {
    mode: "sqlite",
    source,
    config,
    upper: records.length,
  });
  const publish = () => {
    if (typeof opts.updateWatermark === "function") {
      opts.updateWatermark(serializeCursor(cursor));
    }
  };
  let emitted = 0;
  let ordinal = cursor.after ?? 0;
  while (cursor.upper !== null && emitted < limit) {
    ordinal += 1;
    cursor = advanceCursor(cursor, ordinal);
    publish();
    yield records[ordinal - 1];
    emitted += 1;
  }
  publish();
}

function scopeForSqliteFile(fsMod, inputPath, maxBytes, accountScope) {
  const inspected = inspectSnapshotFile(fsMod, inputPath, { maxBytes });
  const revision =
    inspected.stat.mtimeNs ??
    inspected.stat.mtimeMs ??
    inspected.stat.ctimeNs ??
    inspected.stat.ctimeMs ??
    "";
  return createAccountScope(
    NAME,
    [
      accountScope || "unscoped",
      "sqlite",
      inspected.realPath,
      String(inspected.size),
      String(revision),
    ].join("\0"),
  );
}

function hasSqliteMagic(fsImpl, filePath) {
  let descriptor;
  try {
    const readOnly = Number(fsImpl.constants && fsImpl.constants.O_RDONLY) || 0;
    const noFollow =
      Number(fsImpl.constants && fsImpl.constants.O_NOFOLLOW) || 0;
    descriptor = fsImpl.openSync(filePath, readOnly | noFollow);
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    const bytesRead = fsImpl.readSync(descriptor, header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsImpl.closeSync(descriptor);
      } catch {
        // best-effort close
      }
    }
  }
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
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
    vehicleType: row.mode === "drive" ? "car" : row.mode || "trip",
    from: {
      name: row.from_name || row.fromName || row.start,
      lat: row.from_lat || null,
      lng: row.from_lng || null,
    },
    to: {
      name: row.to_name || row.toName || row.dest,
      lat: row.to_lat || null,
      lng: row.to_lng || null,
    },
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
    to: {
      name: row.keyword || row.query || row.poiname,
      lat: row.lat || null,
      lng: row.lng || null,
      city: row.city,
    },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "高德地图",
    extras: { query: row.keyword || row.query },
  };
}

function favouriteRowToRecord(row) {
  if (!row) return null;
  const id = row.id || row._id || row.guid || row.poi_id || row.poiid;
  if (!id) return null;
  const name =
    row.name || row.title || row.poiname || row.poi_name || row.address;
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
    return v > 1e12 ? v : v > 1e10 ? v : v * 1000;
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n > 1e10 ? n : n * 1000;
    }
    return parseChineseDateTime(v);
  }
  return null;
}

module.exports = { AmapAdapter, favouriteRowToRecord, NAME, VERSION };
