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

const NAME = "travel-tencent-map";
const VERSION = "0.4.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_FAVOURITE = "favourite";
const KIND_SEARCH = "search";
const KIND_ROUTE = "route";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_FAVOURITE,
  KIND_SEARCH,
  KIND_ROUTE,
]);

class TencentMapAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;
    this._sqliteTables = normalizeSqliteTables(opts.sqliteTables);
    this._sqliteConfigured = Boolean(
      this._sqliteTables.route.length || this._sqliteTables.search.length,
    );

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["deviceId", "uid", "userId", "accountId"],
    );
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      ...(this._sqliteConfigured ? ["sync:custom-sqlite"] : []),
      "parse:tencent-map-favourite",
      "parse:tencent-map-history",
    ];
    this.extractMode = this._sqliteConfigured ? "device-pull" : "file-import";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
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
    return scopeForLocalFile(this._deps.fs, inputPath, {
      accountScope: this.defaultScope,
      maxBytes: hasInputPath ? options.maxSnapshotBytes : null,
      mode: hasInputPath ? "snapshot" : "sqlite",
    });
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (this._dbPath || (ctx && typeof ctx.dbPath === "string")) {
      if (
        !this._sqliteTables.route.length &&
        !this._sqliteTables.search.length
      ) {
        return {
          ok: false,
          reason: "EXPLICIT_SCHEMA_REQUIRED",
          message:
            "travel-tencent-map: sqlite import requires an app-version-confirmed sqliteTables profile; JSON import is ready",
        };
      }
      return {
        ok: true,
        account: this.account && this.account.deviceId,
        mode: "custom-sqlite",
      };
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
      if (
        !this._sqliteTables.route.length &&
        !this._sqliteTables.search.length
      ) {
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
      const routeSelection = selectFirstTable(db, this._sqliteTables.route);
      for (const r of routeSelection.rows) {
        const rec = routeRowToRecord(r);
        if (rec) {
          entries.push({
            row: r,
            tableName: routeSelection.tableName,
            raw: {
              adapter: NAME,
              originalId: rec.recordId,
              capturedAt: rec.departureMs || fallbackCapturedAt,
              payload: { record: rec, kind: KIND_ROUTE },
            },
          });
        }
      }
      const searchSelection = selectFirstTable(db, this._sqliteTables.search);
      for (const r of searchSelection.rows) {
        const rec = searchRowToRecord(r);
        if (rec) {
          entries.push({
            row: r,
            tableName: searchSelection.tableName,
            raw: {
              adapter: NAME,
              originalId: rec.recordId,
              capturedAt: rec.departureMs || fallbackCapturedAt,
              payload: { record: rec, kind: KIND_SEARCH },
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
        config: collectionConfig("sqlite", include, this._sqliteTables),
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

function collectionConfig(mode, include, sqliteTables = null) {
  const kinds =
    mode === "sqlite" ? [KIND_ROUTE, KIND_SEARCH] : VALID_SNAPSHOT_KINDS;
  return digest(
    Buffer.from(
      JSON.stringify({
        include: Object.fromEntries(
          kinds.map((kind) => [kind, include[kind] !== false]),
        ),
        mode,
        sqliteTables:
          mode === "sqlite"
            ? {
                route: [...sqliteTables.route],
                search: [...sqliteTables.search],
              }
            : null,
      }),
      "utf8",
    ),
  );
}

function collectionSource(entries) {
  return digest(
    Buffer.from(
      stableStringify(
        entries.map(({ raw, row, tableName }) => ({
          kind: raw.payload.kind,
          originalId: raw.originalId,
          record: raw.payload.record,
          row,
          tableName,
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
  const kinds = [KIND_ROUTE, KIND_SEARCH];
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
    (Array.isArray(input) ? input : []).filter(
      (name) => typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name),
    );
  return {
    route: safeList(value && value.route),
    search: safeList(value && value.search),
  };
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return null;
  }
}

function selectFirstTable(db, tableNames) {
  for (const tableName of tableNames) {
    const rows = trySelect(db, `SELECT * FROM "${tableName}"`);
    if (rows) return { rows, tableName };
  }
  return { rows: [], tableName: null };
}

function routeRowToRecord(row) {
  if (!row) return null;
  const id = row._id || row.id || row.uid;
  if (!id) return null;
  return {
    vendorId: "tencentmap",
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
    to: {
      name: row.key || row.query || row.keyword,
      lat: row.lat || null,
      lng: row.lng || null,
      city: row.city,
    },
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
