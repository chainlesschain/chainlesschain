/**
 * Threat Intelligence Store — SQLite-backed IoC (indicator of
 * compromise) catalog. Imports STIX 2.1 bundles, deduplicates
 * indicators by (type, value), and supports fast O(1) matching of
 * an arbitrary observable against the stored feed.
 *
 * Designed to pair with `compliance-manager.js`: a compliance scan
 * can call `matchObservable` to flag blocklisted artefacts during
 * evidence ingestion.
 */

import crypto from "crypto";
import fs from "fs";
import {
  extractIndicatorsFromBundle,
  classifyObservable,
  IOC_TYPES,
} from "./stix-parser.js";

/* ── Schema ────────────────────────────────────────────────── */

export function ensureThreatIntelTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threat_intel_indicators (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      labels TEXT,
      confidence INTEGER,
      source_id TEXT,
      source_name TEXT,
      valid_from TEXT,
      valid_until TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      UNIQUE(type, value)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threat_intel_type ON threat_intel_indicators(type)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threat_intel_value ON threat_intel_indicators(value)`,
  );
}

/* ── Import ────────────────────────────────────────────────── */

/**
 * Import a parsed STIX bundle (or a loose array of STIX objects) into
 * the store. Returns `{imported, updated, skipped, total}`.
 *
 * - `imported`: new (type,value) pairs inserted.
 * - `updated`:  existing pairs whose metadata was refreshed.
 * - `skipped`:  objects that yielded no usable indicator (unknown
 *   observable type, non-stix pattern_type, malformed pattern, etc.).
 */
export function importStixBundle(db, bundle) {
  if (!db) throw new Error("Database is required");
  const iocs = extractIndicatorsFromBundle(bundle);
  const total = Array.isArray(bundle?.objects)
    ? bundle.objects.filter((o) => o?.type === "indicator").length
    : Array.isArray(bundle)
      ? bundle.filter((o) => o?.type === "indicator").length
      : 0;

  let imported = 0;
  let updated = 0;

  const insert = db.prepare(
    `INSERT INTO threat_intel_indicators
       (id, type, value, labels, confidence, source_id, source_name,
        valid_from, valid_until, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  );
  const update = db.prepare(
    `UPDATE threat_intel_indicators
        SET labels       = ?,
            confidence   = ?,
            source_id    = ?,
            source_name  = ?,
            valid_from   = ?,
            valid_until  = ?,
            last_seen_at = datetime('now')
      WHERE type = ? AND value = ?`,
  );
  const selectExisting = db.prepare(
    `SELECT id FROM threat_intel_indicators WHERE type = ? AND value = ?`,
  );

  for (const rawIoc of iocs) {
    // File hashes are case-insensitive — normalize on write so that
    // equality lookups in `matchObservable` don't depend on SQLite's
    // COLLATE NOCASE (which the mock-db used in tests doesn't emulate).
    const ioc = rawIoc.type.startsWith("file-")
      ? { ...rawIoc, value: String(rawIoc.value).toLowerCase() }
      : rawIoc;
    const prior = selectExisting.get(ioc.type, ioc.value);
    const labels = JSON.stringify(ioc.source?.labels || []);
    const confidence = ioc.source?.confidence ?? null;
    const sourceId = ioc.source?.indicatorId || null;
    const sourceName = ioc.source?.name || null;
    const validFrom = ioc.source?.validFrom || null;
    const validUntil = ioc.source?.validUntil || null;

    if (prior) {
      update.run(
        labels,
        confidence,
        sourceId,
        sourceName,
        validFrom,
        validUntil,
        ioc.type,
        ioc.value,
      );
      updated += 1;
    } else {
      insert.run(
        crypto.randomUUID(),
        ioc.type,
        ioc.value,
        labels,
        confidence,
        sourceId,
        sourceName,
        validFrom,
        validUntil,
      );
      imported += 1;
    }
  }
  const skipped = Math.max(total - iocs.length, 0);
  return { imported, updated, skipped, total };
}

/**
 * Import a STIX bundle from a file path. Convenience wrapper over
 * `importStixBundle` — reads the JSON, parses it, defers to the
 * core importer.
 */
export function importStixFile(db, filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
  return importStixBundle(db, bundle);
}

/* ── Query ─────────────────────────────────────────────────── */

function _rowToIndicator(r) {
  if (!r) return null;
  let labels = [];
  try {
    labels = r.labels ? JSON.parse(r.labels) : [];
  } catch {
    labels = [];
  }
  return {
    id: r.id,
    type: r.type,
    value: r.value,
    labels,
    confidence: r.confidence ?? null,
    sourceId: r.source_id || null,
    sourceName: r.source_name || null,
    validFrom: r.valid_from || null,
    validUntil: r.valid_until || null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/**
 * List indicators, optionally filtered by type. `limit` caps result
 * size (default 100, 0 = unlimited).
 */
export function listIndicators(db, options = {}) {
  const { type, limit = 100 } = options;
  if (type && !IOC_TYPES.includes(type)) {
    throw new Error(
      `Unknown IOC type: ${type}. Valid: ${IOC_TYPES.join(", ")}`,
    );
  }
  let sql = `SELECT * FROM threat_intel_indicators`;
  const params = [];
  if (type) {
    sql += ` WHERE type = ?`;
    params.push(type);
  }
  sql += ` ORDER BY last_seen_at DESC`;
  if (limit && limit > 0) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToIndicator);
}

/**
 * Match an arbitrary observable against the stored feed. Returns:
 *   {matched:true, type, indicator} on hit
 *   {matched:false, type}            on miss (type still classified)
 *   {matched:false, type:"unknown"}  if we can't classify the input
 */
export function matchObservable(db, value) {
  const type = classifyObservable(value);
  if (type === "unknown") return { matched: false, type: "unknown" };

  const trimmed = String(value).trim();
  const normalized = type.startsWith("file-") ? trimmed.toLowerCase() : trimmed;

  const row = db
    .prepare(
      `SELECT * FROM threat_intel_indicators
         WHERE type = ? AND value = ?
         LIMIT 1`,
    )
    .get(type, normalized);

  if (!row) return { matched: false, type };
  return { matched: true, type, indicator: _rowToIndicator(row) };
}

/**
 * Aggregate stats — total indicators + counts per type.
 */
export function getStats(db) {
  const total =
    db.prepare(`SELECT COUNT(*) AS n FROM threat_intel_indicators`).get()?.n ??
    0;
  const rows = db
    .prepare(
      `SELECT type, COUNT(*) AS n
         FROM threat_intel_indicators
         GROUP BY type
         ORDER BY n DESC`,
    )
    .all();
  const byType = {};
  for (const r of rows) byType[r.type] = r.n;
  return { total, byType };
}

/**
 * Remove a single indicator by (type, value). Returns true if a row
 * was deleted.
 */
export function removeIndicator(db, type, value) {
  const info = db
    .prepare(`DELETE FROM threat_intel_indicators WHERE type = ? AND value = ?`)
    .run(type, value);
  return info.changes > 0;
}

/**
 * Drop every stored indicator. Returns the number of rows removed.
 */
export function clearAll(db) {
  const info = db.prepare(`DELETE FROM threat_intel_indicators`).run();
  return info.changes;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — In-memory feed-maturity + indicator-lifecycle layer.
 * Independent of the SQLite IoC catalog above; tracks feed sources
 * and indicator lifecycle transitions with caps and auto-flip.
 * ═══════════════════════════════════════════════════════════════ */

export const FEED_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  TRUSTED: "trusted",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const INDICATOR_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  SUPERSEDED: "superseded",
});

const FEED_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["trusted", "retired"])],
  ["trusted", new Set(["deprecated", "retired"])],
  ["deprecated", new Set(["trusted", "retired"])],
  ["retired", new Set()],
]);
const FEED_TERMINALS_V2 = new Set(["retired"]);

const INDICATOR_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "revoked", "superseded"])],
  ["active", new Set(["expired", "revoked", "superseded"])],
  ["expired", new Set()],
  ["revoked", new Set()],
  ["superseded", new Set()],
]);
const INDICATOR_TERMINALS_V2 = new Set(["expired", "revoked", "superseded"]);

export const TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER = 15;
export const TI_DEFAULT_MAX_ACTIVE_INDICATORS_PER_FEED = 500;
export const TI_DEFAULT_FEED_IDLE_MS = 1000 * 60 * 60 * 24 * 60; // 60 days
export const TI_DEFAULT_INDICATOR_STALE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

const _feedsV2 = new Map();
const _indicatorsV2 = new Map();
let _maxActiveFeedsPerOwnerV2 = TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER;
let _maxActiveIndicatorsPerFeedV2 = TI_DEFAULT_MAX_ACTIVE_INDICATORS_PER_FEED;
let _feedIdleMsV2 = TI_DEFAULT_FEED_IDLE_MS;
let _indicatorStaleMsV2 = TI_DEFAULT_INDICATOR_STALE_MS;

function _posIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveFeedsPerOwnerV2() {
  return _maxActiveFeedsPerOwnerV2;
}
export function setMaxActiveFeedsPerOwnerV2(n) {
  _maxActiveFeedsPerOwnerV2 = _posIntV2(n, "maxActiveFeedsPerOwner");
}
export function getMaxActiveIndicatorsPerFeedV2() {
  return _maxActiveIndicatorsPerFeedV2;
}
export function setMaxActiveIndicatorsPerFeedV2(n) {
  _maxActiveIndicatorsPerFeedV2 = _posIntV2(n, "maxActiveIndicatorsPerFeed");
}
export function getFeedIdleMsV2() {
  return _feedIdleMsV2;
}
export function setFeedIdleMsV2(n) {
  _feedIdleMsV2 = _posIntV2(n, "feedIdleMs");
}
export function getIndicatorStaleMsV2() {
  return _indicatorStaleMsV2;
}
export function setIndicatorStaleMsV2(n) {
  _indicatorStaleMsV2 = _posIntV2(n, "indicatorStaleMs");
}

export function getActiveFeedCountV2(owner) {
  let n = 0;
  for (const f of _feedsV2.values()) {
    if (f.owner === owner && f.maturity === "trusted") n += 1;
  }
  return n;
}

export function getActiveIndicatorCountV2(feedId) {
  let n = 0;
  for (const i of _indicatorsV2.values()) {
    if (i.feedId === feedId && i.status === "active") n += 1;
  }
  return n;
}

function _copyFeedV2(f) {
  return { ...f, metadata: { ...f.metadata } };
}
function _copyIndicatorV2(i) {
  return { ...i, metadata: { ...i.metadata } };
}

export function registerFeedV2(id, { owner, name, metadata = {} } = {}) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!owner || typeof owner !== "string")
    throw new Error("owner must be a string");
  if (!name || typeof name !== "string")
    throw new Error("name must be a string");
  if (_feedsV2.has(id)) throw new Error(`feed ${id} already exists`);
  const now = Date.now();
  const feed = {
    id,
    owner,
    name,
    maturity: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    metadata: { ...metadata },
  };
  _feedsV2.set(id, feed);
  return _copyFeedV2(feed);
}

export function getFeedV2(id) {
  const f = _feedsV2.get(id);
  return f ? _copyFeedV2(f) : null;
}

export function listFeedsV2({ owner, maturity } = {}) {
  const out = [];
  for (const f of _feedsV2.values()) {
    if (owner && f.owner !== owner) continue;
    if (maturity && f.maturity !== maturity) continue;
    out.push(_copyFeedV2(f));
  }
  return out;
}

export function setFeedMaturityV2(id, next, { now = Date.now() } = {}) {
  const f = _feedsV2.get(id);
  if (!f) throw new Error(`feed ${id} not found`);
  if (!FEED_TRANSITIONS_V2.has(next))
    throw new Error(`unknown feed maturity: ${next}`);
  if (FEED_TERMINALS_V2.has(f.maturity))
    throw new Error(`feed ${id} is in terminal state ${f.maturity}`);
  const allowed = FEED_TRANSITIONS_V2.get(f.maturity);
  if (!allowed.has(next))
    throw new Error(`cannot transition feed from ${f.maturity} to ${next}`);
  if (next === "trusted") {
    if (f.maturity === "pending") {
      const count = getActiveFeedCountV2(f.owner);
      if (count >= _maxActiveFeedsPerOwnerV2)
        throw new Error(
          `owner ${f.owner} already at active-feed cap (${_maxActiveFeedsPerOwnerV2})`,
        );
    }
    if (!f.activatedAt) f.activatedAt = now;
  }
  f.maturity = next;
  f.lastSeenAt = now;
  return _copyFeedV2(f);
}

export function trustFeedV2(id, opts) {
  return setFeedMaturityV2(id, "trusted", opts);
}
export function deprecateFeedV2(id, opts) {
  return setFeedMaturityV2(id, "deprecated", opts);
}
export function retireFeedV2(id, opts) {
  return setFeedMaturityV2(id, "retired", opts);
}

export function touchFeedV2(id, { now = Date.now() } = {}) {
  const f = _feedsV2.get(id);
  if (!f) throw new Error(`feed ${id} not found`);
  f.lastSeenAt = now;
  return _copyFeedV2(f);
}

export function createIndicatorV2(
  id,
  { feedId, iocType, value, metadata = {} } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!feedId || typeof feedId !== "string")
    throw new Error("feedId must be a string");
  if (!iocType || typeof iocType !== "string")
    throw new Error("iocType must be a string");
  if (!value || typeof value !== "string")
    throw new Error("value must be a string");
  if (!_feedsV2.has(feedId)) throw new Error(`feed ${feedId} not found`);
  if (_indicatorsV2.has(id)) throw new Error(`indicator ${id} already exists`);
  const now = Date.now();
  const indicator = {
    id,
    feedId,
    iocType,
    value,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    resolvedAt: null,
    metadata: { ...metadata },
  };
  _indicatorsV2.set(id, indicator);
  return _copyIndicatorV2(indicator);
}

export function getIndicatorV2(id) {
  const i = _indicatorsV2.get(id);
  return i ? _copyIndicatorV2(i) : null;
}

export function listIndicatorsV2({ feedId, status } = {}) {
  const out = [];
  for (const i of _indicatorsV2.values()) {
    if (feedId && i.feedId !== feedId) continue;
    if (status && i.status !== status) continue;
    out.push(_copyIndicatorV2(i));
  }
  return out;
}

export function setIndicatorStatusV2(id, next, { now = Date.now() } = {}) {
  const i = _indicatorsV2.get(id);
  if (!i) throw new Error(`indicator ${id} not found`);
  if (!INDICATOR_TRANSITIONS_V2.has(next))
    throw new Error(`unknown indicator status: ${next}`);
  if (INDICATOR_TERMINALS_V2.has(i.status))
    throw new Error(`indicator ${id} is in terminal state ${i.status}`);
  const allowed = INDICATOR_TRANSITIONS_V2.get(i.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition indicator from ${i.status} to ${next}`);
  if (next === "active" && i.status === "pending") {
    const count = getActiveIndicatorCountV2(i.feedId);
    if (count >= _maxActiveIndicatorsPerFeedV2)
      throw new Error(
        `feed ${i.feedId} already at active-indicator cap (${_maxActiveIndicatorsPerFeedV2})`,
      );
    if (!i.activatedAt) i.activatedAt = now;
  }
  if (INDICATOR_TERMINALS_V2.has(next) && !i.resolvedAt) {
    i.resolvedAt = now;
  }
  i.status = next;
  i.lastSeenAt = now;
  return _copyIndicatorV2(i);
}

export function activateIndicatorV2(id, opts) {
  return setIndicatorStatusV2(id, "active", opts);
}
export function expireIndicatorV2(id, opts) {
  return setIndicatorStatusV2(id, "expired", opts);
}
export function revokeIndicatorV2(id, opts) {
  return setIndicatorStatusV2(id, "revoked", opts);
}
export function supersedeIndicatorV2(id, opts) {
  return setIndicatorStatusV2(id, "superseded", opts);
}

export function refreshIndicatorV2(id, { now = Date.now() } = {}) {
  const i = _indicatorsV2.get(id);
  if (!i) throw new Error(`indicator ${id} not found`);
  if (INDICATOR_TERMINALS_V2.has(i.status))
    throw new Error(`indicator ${id} is in terminal state ${i.status}`);
  i.lastSeenAt = now;
  return _copyIndicatorV2(i);
}

export function autoDeprecateIdleFeedsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const f of _feedsV2.values()) {
    if (f.maturity !== "trusted") continue;
    if (now - f.lastSeenAt > _feedIdleMsV2) {
      f.maturity = "deprecated";
      f.lastSeenAt = now;
      flipped.push(_copyFeedV2(f));
    }
  }
  return flipped;
}

export function autoExpireStaleIndicatorsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const i of _indicatorsV2.values()) {
    if (i.status !== "active") continue;
    if (now - i.lastSeenAt > _indicatorStaleMsV2) {
      i.status = "expired";
      i.lastSeenAt = now;
      if (!i.resolvedAt) i.resolvedAt = now;
      flipped.push(_copyIndicatorV2(i));
    }
  }
  return flipped;
}

export function getThreatIntelStatsV2() {
  const feedsByMaturity = {};
  for (const m of Object.values(FEED_MATURITY_V2)) feedsByMaturity[m] = 0;
  for (const f of _feedsV2.values()) feedsByMaturity[f.maturity] += 1;

  const indicatorsByStatus = {};
  for (const s of Object.values(INDICATOR_LIFECYCLE_V2))
    indicatorsByStatus[s] = 0;
  for (const i of _indicatorsV2.values()) indicatorsByStatus[i.status] += 1;

  return {
    totalFeedsV2: _feedsV2.size,
    totalIndicatorsV2: _indicatorsV2.size,
    maxActiveFeedsPerOwner: _maxActiveFeedsPerOwnerV2,
    maxActiveIndicatorsPerFeed: _maxActiveIndicatorsPerFeedV2,
    feedIdleMs: _feedIdleMsV2,
    indicatorStaleMs: _indicatorStaleMsV2,
    feedsByMaturity,
    indicatorsByStatus,
  };
}

export function _resetStateThreatIntelV2() {
  _feedsV2.clear();
  _indicatorsV2.clear();
  _maxActiveFeedsPerOwnerV2 = TI_DEFAULT_MAX_ACTIVE_FEEDS_PER_OWNER;
  _maxActiveIndicatorsPerFeedV2 = TI_DEFAULT_MAX_ACTIVE_INDICATORS_PER_FEED;
  _feedIdleMsV2 = TI_DEFAULT_FEED_IDLE_MS;
  _indicatorStaleMsV2 = TI_DEFAULT_INDICATOR_STALE_MS;
}

// =====================================================================
// threat-intel V2 governance overlay (iter24)
// =====================================================================
export const TIGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const TIGOV_FEED_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  INGESTING: "ingesting",
  INGESTED: "ingested",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _tigovPTrans = new Map([
  [
    TIGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TIGOV_PROFILE_MATURITY_V2.ACTIVE,
      TIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TIGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TIGOV_PROFILE_MATURITY_V2.STALE,
      TIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TIGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      TIGOV_PROFILE_MATURITY_V2.ACTIVE,
      TIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TIGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _tigovPTerminal = new Set([TIGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _tigovJTrans = new Map([
  [
    TIGOV_FEED_LIFECYCLE_V2.QUEUED,
    new Set([
      TIGOV_FEED_LIFECYCLE_V2.INGESTING,
      TIGOV_FEED_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TIGOV_FEED_LIFECYCLE_V2.INGESTING,
    new Set([
      TIGOV_FEED_LIFECYCLE_V2.INGESTED,
      TIGOV_FEED_LIFECYCLE_V2.FAILED,
      TIGOV_FEED_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TIGOV_FEED_LIFECYCLE_V2.INGESTED, new Set()],
  [TIGOV_FEED_LIFECYCLE_V2.FAILED, new Set()],
  [TIGOV_FEED_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _tigovPsV2 = new Map();
const _tigovJsV2 = new Map();
let _tigovMaxActive = 6,
  _tigovMaxPending = 15,
  _tigovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _tigovStuckMs = 60 * 1000;
function _tigovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _tigovCheckP(from, to) {
  const a = _tigovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid tigov profile transition ${from} → ${to}`);
}
function _tigovCheckJ(from, to) {
  const a = _tigovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid tigov feed transition ${from} → ${to}`);
}
function _tigovCountActive(owner) {
  let c = 0;
  for (const p of _tigovPsV2.values())
    if (p.owner === owner && p.status === TIGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _tigovCountPending(profileId) {
  let c = 0;
  for (const j of _tigovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TIGOV_FEED_LIFECYCLE_V2.QUEUED ||
        j.status === TIGOV_FEED_LIFECYCLE_V2.INGESTING)
    )
      c++;
  return c;
}
export function setMaxActiveTigovProfilesPerOwnerV2(n) {
  _tigovMaxActive = _tigovPos(n, "maxActiveTigovProfilesPerOwner");
}
export function getMaxActiveTigovProfilesPerOwnerV2() {
  return _tigovMaxActive;
}
export function setMaxPendingTigovFeedsPerProfileV2(n) {
  _tigovMaxPending = _tigovPos(n, "maxPendingTigovFeedsPerProfile");
}
export function getMaxPendingTigovFeedsPerProfileV2() {
  return _tigovMaxPending;
}
export function setTigovProfileIdleMsV2(n) {
  _tigovIdleMs = _tigovPos(n, "tigovProfileIdleMs");
}
export function getTigovProfileIdleMsV2() {
  return _tigovIdleMs;
}
export function setTigovFeedStuckMsV2(n) {
  _tigovStuckMs = _tigovPos(n, "tigovFeedStuckMs");
}
export function getTigovFeedStuckMsV2() {
  return _tigovStuckMs;
}
export function _resetStateThreatIntelGovV2() {
  _tigovPsV2.clear();
  _tigovJsV2.clear();
  _tigovMaxActive = 6;
  _tigovMaxPending = 15;
  _tigovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _tigovStuckMs = 60 * 1000;
}
export function registerTigovProfileV2({ id, owner, source, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_tigovPsV2.has(id)) throw new Error(`tigov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    source: source || "otx",
    status: TIGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tigovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateTigovProfileV2(id) {
  const p = _tigovPsV2.get(id);
  if (!p) throw new Error(`tigov profile ${id} not found`);
  const isInitial = p.status === TIGOV_PROFILE_MATURITY_V2.PENDING;
  _tigovCheckP(p.status, TIGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _tigovCountActive(p.owner) >= _tigovMaxActive)
    throw new Error(`max active tigov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = TIGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleTigovProfileV2(id) {
  const p = _tigovPsV2.get(id);
  if (!p) throw new Error(`tigov profile ${id} not found`);
  _tigovCheckP(p.status, TIGOV_PROFILE_MATURITY_V2.STALE);
  p.status = TIGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveTigovProfileV2(id) {
  const p = _tigovPsV2.get(id);
  if (!p) throw new Error(`tigov profile ${id} not found`);
  _tigovCheckP(p.status, TIGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TIGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchTigovProfileV2(id) {
  const p = _tigovPsV2.get(id);
  if (!p) throw new Error(`tigov profile ${id} not found`);
  if (_tigovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal tigov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getTigovProfileV2(id) {
  const p = _tigovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listTigovProfilesV2() {
  return [..._tigovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createTigovFeedV2({ id, profileId, indicator, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_tigovJsV2.has(id)) throw new Error(`tigov feed ${id} already exists`);
  if (!_tigovPsV2.has(profileId))
    throw new Error(`tigov profile ${profileId} not found`);
  if (_tigovCountPending(profileId) >= _tigovMaxPending)
    throw new Error(`max pending tigov feeds for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    indicator: indicator || "",
    status: TIGOV_FEED_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tigovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function ingestingTigovFeedV2(id) {
  const j = _tigovJsV2.get(id);
  if (!j) throw new Error(`tigov feed ${id} not found`);
  _tigovCheckJ(j.status, TIGOV_FEED_LIFECYCLE_V2.INGESTING);
  const now = Date.now();
  j.status = TIGOV_FEED_LIFECYCLE_V2.INGESTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeFeedTigovV2(id) {
  const j = _tigovJsV2.get(id);
  if (!j) throw new Error(`tigov feed ${id} not found`);
  _tigovCheckJ(j.status, TIGOV_FEED_LIFECYCLE_V2.INGESTED);
  const now = Date.now();
  j.status = TIGOV_FEED_LIFECYCLE_V2.INGESTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failTigovFeedV2(id, reason) {
  const j = _tigovJsV2.get(id);
  if (!j) throw new Error(`tigov feed ${id} not found`);
  _tigovCheckJ(j.status, TIGOV_FEED_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TIGOV_FEED_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelTigovFeedV2(id, reason) {
  const j = _tigovJsV2.get(id);
  if (!j) throw new Error(`tigov feed ${id} not found`);
  _tigovCheckJ(j.status, TIGOV_FEED_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TIGOV_FEED_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getTigovFeedV2(id) {
  const j = _tigovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listTigovFeedsV2() {
  return [..._tigovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleTigovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _tigovPsV2.values())
    if (
      p.status === TIGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _tigovIdleMs
    ) {
      p.status = TIGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTigovFeedsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _tigovJsV2.values())
    if (
      j.status === TIGOV_FEED_LIFECYCLE_V2.INGESTING &&
      j.startedAt != null &&
      t - j.startedAt >= _tigovStuckMs
    ) {
      j.status = TIGOV_FEED_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getThreatIntelGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(TIGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _tigovPsV2.values()) profilesByStatus[p.status]++;
  const feedsByStatus = {};
  for (const v of Object.values(TIGOV_FEED_LIFECYCLE_V2)) feedsByStatus[v] = 0;
  for (const j of _tigovJsV2.values()) feedsByStatus[j.status]++;
  return {
    totalTigovProfilesV2: _tigovPsV2.size,
    totalTigovFeedsV2: _tigovJsV2.size,
    maxActiveTigovProfilesPerOwner: _tigovMaxActive,
    maxPendingTigovFeedsPerProfile: _tigovMaxPending,
    tigovProfileIdleMs: _tigovIdleMs,
    tigovFeedStuckMs: _tigovStuckMs,
    profilesByStatus,
    feedsByStatus,
  };
}
