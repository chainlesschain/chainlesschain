/**
 * §2.5b 地图三联 v0.2 — Baidu Map (百度地图) adapter, dual-mode.
 *
 * Mirror of social-weibo / social-bilibili two-mode pattern:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by BaiduMapLocalCollector (WebView cookie scrape).
 *      Desktop-independent path. Adapter is stateless in this mode —
 *      account.deviceId is OPTIONAL at construction; account meta carried
 *      in payload.
 *
 *   2. sqlite mode (opts.dbPath, legacy Phase 9.4b): device-pull path —
 *      reads Baidu Map Android app's SQLite (search_history / route_history /
 *      my_favourite). Preserved for backward compat. account.deviceId
 *      REQUIRED in this mode (checked at sync, not construction).
 *
 * Snapshot schema (mirrors BaiduMapLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "vendor": "baidu-map",
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
 *
 * Per sjqz/parsers/baidumap.py the key SQLite tables (sqlite mode) are:
 *   - search_history (queries)
 *   - route_history  (planned routes)
 *   - my_favourite   (saved places)
 */

"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  readBoundedSnapshotBuffer,
  validateJsonSnapshot,
} = require("../../snapshot-file");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
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

const NAME = "travel-baidu-map";
const VERSION = "0.8.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_FAVOURITE = "favourite";
const KIND_SEARCH = "search";
const KIND_ROUTE = "route";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_FAVOURITE,
  KIND_SEARCH,
  KIND_ROUTE,
]);

class BaiduMapAdapter {
  constructor(opts = {}) {
    // §2.5b v0.2: account.deviceId now OPTIONAL — snapshot mode is stateless
    // and pulls account from the JSON file. Sqlite mode still requires it;
    // checked at sync time, not construction.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["deviceId", "uid", "userId", "accountId"],
    );
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "import:sqlite",
      "parse:baidu-map-favourite",
      "parse:baidu-map-history",
    ];
    // Existing desktop wiring may key off this — sqlite mode is the desktop-
    // side, snapshot mode is in-APK Android. Reported value stays compatible.
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "baidu:account (uid / displayName, cookie scrape)",
        "baidu:my_favourite (saved places — home / company / other)",
        "baidu:search_history (queries, legacy sqlite mode)",
        "baidu:route_history (planned routes, legacy sqlite mode)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        favourite: true,
        search: true,
        route: true,
      },
    };

    // _deps injection seam — vi.mock fs doesn't intercept inlined CJS require
    // (see .claude/rules/testing.md).
    this._deps = {
      fs,
      dbDriverFactory: opts.dbDriverFactory || null,
    };
  }

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    const hasInputPath =
      typeof options.inputPath === "string" && options.inputPath.length > 0;
    const inputPath = hasInputPath
      ? options.inputPath
      : typeof options.dbPath === "string" && options.dbPath.length > 0
        ? options.dbPath
        : this._dbPath;
    if (!inputPath) return this.defaultScope;
    const mode =
      hasInputPath && !isSqliteFile(this._deps.fs, inputPath)
        ? "snapshot"
        : "sqlite";
    return scopeForLocalFile(this._deps.fs, inputPath, {
      accountScope: this.defaultScope,
      maxBytes: mode === "snapshot" ? options.maxSnapshotBytes : null,
      mode,
    });
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      if (isSqliteFile(this._deps.fs, ctx.inputPath)) {
        return { ok: true, mode: "sqlite-file" };
      }
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (this._dbPath || (ctx && typeof ctx.dbPath === "string")) {
      return {
        ok: true,
        account: this.account ? this.account.deviceId || null : null,
        mode: "sqlite",
      };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "travel-baidu-map.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      if (isSqliteFile(this._deps.fs, opts.inputPath)) {
        yield* this._syncViaSqlite({ ...opts, dbPath: opts.inputPath });
      } else {
        yield* this._syncViaSnapshot(opts);
      }
      return;
    }
    const dbPath = opts.dbPath || this._dbPath;
    if (dbPath) {
      yield* this._syncViaSqlite({ ...opts, dbPath });
      return;
    }
    throw new Error(
      "travel-baidu-map.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const { snapshot, source } = readSnapshotSource(
      this._deps.fs,
      opts.inputPath,
      opts.maxSnapshotBytes,
    );
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();
    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const records = snapshot.events.map((ev) => {
      const kind = ev.kind;
      const capturedAt =
        parseTime(ev.capturedAt) || parseTime(ev.time) || fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" &&
          Number.isFinite(ev.id) &&
          String(ev.id)) ||
        ev.rid ||
        null;
      return {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
    });
    yield* this._yieldCollection(opts, {
      config: collectionConfig("snapshot", include),
      mode: "snapshot",
      records: records.filter((record) => include[record.kind] !== false),
      source,
    });
  }

  async *_syncViaSqlite(opts) {
    // Legacy Phase 9.4b path. The database itself is sufficient input;
    // deviceId was never used for decryption or normalization.
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const inspected = inspectSqliteFile(this._deps.fs, dbPath);
    const fallbackCapturedAt = fileCapturedAt(inspected.stat);
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const entries = [];
      const routes =
        trySelect(db, "SELECT * FROM route_history") ||
        trySelect(db, "SELECT * FROM bd_route_history") ||
        [];
      for (const r of routes) {
        const rec = routeRowToRecord(r);
        if (rec) {
          entries.push({
            row: r,
            raw: {
              adapter: NAME,
              originalId: rec.recordId,
              capturedAt: rec.departureMs || fallbackCapturedAt,
              payload: { record: rec, kind: KIND_ROUTE },
            },
          });
        }
      }
      const searches = trySelect(db, "SELECT * FROM search_history") || [];
      for (const r of searches) {
        const rec = searchRowToRecord(r);
        if (rec) {
          entries.push({
            row: r,
            raw: {
              adapter: NAME,
              originalId: rec.recordId,
              capturedAt: rec.departureMs || fallbackCapturedAt,
              payload: { record: rec, kind: KIND_SEARCH },
            },
          });
        }
      }
      const favourites =
        trySelect(db, "SELECT * FROM my_favourite") ||
        trySelect(db, "SELECT * FROM favorite") ||
        [];
      for (const row of favourites) {
        const rec = favouriteRowToRecord(row);
        if (rec) {
          entries.push({
            row,
            raw: {
              adapter: NAME,
              originalId: rec.recordId,
              capturedAt: rec.departureMs || fallbackCapturedAt,
              payload: { record: rec, kind: KIND_FAVOURITE },
            },
          });
        }
      }
      entries.sort((left, right) =>
        compareCollectionRecords(left.raw, right.raw),
      );
      const include = opts.include || {};
      const selected = entries.filter(
        (entry) => include[entry.raw.payload.kind] !== false,
      );
      yield* this._yieldCollection(opts, {
        config: collectionConfig("sqlite", include),
        mode: "sqlite",
        records: selected.map((entry) => entry.raw),
        source: collectionSource(selected),
      });
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  async *_yieldCollection(opts, { config, mode, records, source }) {
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode,
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
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

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("BaiduMapAdapter.normalize: payload missing");
    }
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    // Sqlite-mode payload carries `record`; snapshot-mode payload carries fields
    // directly (favourite / search / route).
    if (p.record) {
      return normalizeTravelRecord(p.record, {
        adapterName: NAME,
        adapterVersion: VERSION,
      });
    }
    // Snapshot-mode normalize: build a TravelRecord on-the-fly so we share
    // the travel-base normalizer (1 event + place(s) + carrier merchant).
    const rec = snapshotEventToRecord(kind, p, raw.originalId);
    return normalizeTravelRecord(rec, {
      adapterName: NAME,
      adapterVersion: VERSION,
    });
  }
}

function readSnapshotSource(fsMod, inputPath, maxBytes) {
  const buffer = readBoundedSnapshotBuffer(fsMod, inputPath, { maxBytes });
  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_JSON_INVALID",
      "snapshot file must contain valid JSON",
      { cause: error },
    );
  }
  validateJsonSnapshot(snapshot, {
    expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    requiredArrayFields: ["events"],
    allowedEventKinds: VALID_SNAPSHOT_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, include) {
  return digest(
    Buffer.from(
      JSON.stringify({
        include: Object.fromEntries(
          VALID_SNAPSHOT_KINDS.map((kind) => [kind, include[kind] !== false]),
        ),
        mode,
      }),
      "utf8",
    ),
  );
}

function collectionSource(entries) {
  return digest(
    Buffer.from(
      stableStringify(
        entries.map(({ raw, row }) => ({
          kind: raw.payload.kind,
          originalId: raw.originalId,
          record: raw.payload.record,
          row,
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
  const kinds = [KIND_ROUTE, KIND_SEARCH, KIND_FAVOURITE];
  const leftKind = left.kind || left.payload.kind;
  const rightKind = right.kind || right.payload.kind;
  const kindOrder = kinds.indexOf(leftKind) - kinds.indexOf(rightKind);
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

function publishCursor(opts, cursor) {
  if (typeof opts.updateWatermark === "function") {
    opts.updateWatermark(serializeCursor(cursor));
  }
}

function scopeForLocalFile(fsMod, inputPath, { accountScope, maxBytes, mode }) {
  const inspected =
    mode === "snapshot"
      ? inspectSnapshotFile(fsMod, inputPath, { maxBytes })
      : inspectSqliteFile(fsMod, inputPath);
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
      mode,
      inspected.realPath,
      String(inspected.size),
      String(revision),
    ].join("\0"),
  );
}

function inspectSqliteFile(fsMod, inputPath) {
  let linkStat;
  let stat;
  let realPath;
  try {
    linkStat = fsMod.lstatSync(inputPath, { bigint: true });
    if (
      typeof linkStat.isSymbolicLink === "function" &&
      linkStat.isSymbolicLink()
    ) {
      throw new SnapshotFileError(
        "SNAPSHOT_SYMBOLIC_LINK",
        "SQLite source must not be a symbolic link",
      );
    }
    stat = fsMod.statSync(inputPath, { bigint: true });
    realPath = fsMod.realpathSync(inputPath);
  } catch (error) {
    if (error instanceof SnapshotFileError) throw error;
    throw new SnapshotFileError(
      "INPUT_PATH_UNREADABLE",
      "SQLite source is unavailable or unreadable",
      { cause: error },
    );
  }
  if (typeof stat.isFile !== "function" || !stat.isFile()) {
    throw new SnapshotFileError(
      "SNAPSHOT_NOT_REGULAR_FILE",
      "SQLite source must be a regular file",
    );
  }
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new SnapshotFileError(
      "SNAPSHOT_SIZE_INVALID",
      "SQLite source size is invalid",
    );
  }
  return { linkStat, realPath, size, stat };
}

function fileCapturedAt(stat) {
  const value = Number(stat && stat.mtimeMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
}

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!safe) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `baidu-map:${kind}:${safe}`;
}

function snapshotEventToRecord(kind, p, originalId) {
  if (kind === KIND_FAVOURITE) {
    return {
      vendorId: "baidumap",
      recordId: originalId,
      vehicleType: "visit",
      to: {
        name: p.name || p.address || null,
        lat: numberOrNull(p.lat),
        lng: numberOrNull(p.lng),
        city: p.city || null,
      },
      departureMs: parseTime(p.capturedAt),
      carrier: "百度地图",
      extras: { category: p.category || null, kind: KIND_FAVOURITE },
    };
  }
  if (kind === KIND_SEARCH) {
    return {
      vendorId: "baidumap",
      recordId: originalId,
      vehicleType: "visit",
      to: {
        name: p.query || null,
        lat: numberOrNull(p.lat),
        lng: numberOrNull(p.lng),
        city: p.city || null,
      },
      departureMs: parseTime(p.capturedAt),
      carrier: "百度地图",
      extras: { query: p.query || null, kind: KIND_SEARCH },
    };
  }
  if (kind === KIND_ROUTE) {
    return {
      vendorId: "baidumap",
      recordId: originalId,
      vehicleType: detectVehicle(p.mode),
      from: p.from
        ? {
            name: p.from.name || null,
            lat: numberOrNull(p.from.lat),
            lng: numberOrNull(p.from.lng),
          }
        : undefined,
      to: p.to
        ? {
            name: p.to.name || null,
            lat: numberOrNull(p.to.lat),
            lng: numberOrNull(p.to.lng),
          }
        : undefined,
      departureMs: parseTime(p.capturedAt),
      carrier: "百度地图",
      extras: { mode: p.mode || null, kind: KIND_ROUTE },
    };
  }
  // Fallback (shouldn't reach — VALID_SNAPSHOT_KINDS filters earlier)
  return {
    vendorId: "baidumap",
    recordId: originalId,
    vehicleType: "visit",
    carrier: "百度地图",
    extras: { kind, raw: p },
  };
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return null;
  }
}

function isSqliteFile(fsImpl, filePath) {
  let fd;
  try {
    fd = fsImpl.openSync(filePath, "r");
    const header = Buffer.alloc(16);
    const bytesRead = fsImpl.readSync(fd, header, 0, header.length, 0);
    return (
      bytesRead === header.length &&
      header.toString("binary") === "SQLite format 3\u0000"
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // best-effort close
      }
    }
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
    from: {
      name: row.start_name || row.from_name,
      lat: row.start_lat || null,
      lng: row.start_lng || null,
    },
    to: {
      name: row.end_name || row.to_name,
      lat: row.end_lat || null,
      lng: row.end_lng || null,
    },
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
    to: {
      name: row.key || row.query,
      lat: row.lat || null,
      lng: row.lng || null,
      city: row.city,
    },
    departureMs: numberOrParse(row.time || row.create_time),
    carrier: "百度地图",
    extras: { query: row.key || row.query },
  };
}

function favouriteRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id || row.uid || row.poi_id;
  if (!id) return null;
  const name = row.name || row.title || row.poi_name || row.address;
  if (!name) return null;
  return {
    vendorId: "baidumap",
    recordId: `favourite-${id}`,
    vehicleType: "visit",
    to: {
      name,
      lat: numberOrNull(row.lat || row.latitude || row.y),
      lng: numberOrNull(row.lng || row.lon || row.longitude || row.x),
      city: row.city || row.city_name || null,
    },
    departureMs: numberOrParse(
      row.time || row.create_time || row.created_at || row.update_time,
    ),
    carrier: "百度地图",
    extras: {
      kind: KIND_FAVOURITE,
      category: row.category || row.type || null,
      address: row.address || row.addr || null,
    },
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

module.exports = {
  BaiduMapAdapter,
  favouriteRowToRecord,
  isSqliteFile,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
