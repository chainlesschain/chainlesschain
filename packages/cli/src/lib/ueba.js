/**
 * UEBA — User and Entity Behavior Analytics.
 *
 * Pure analytics over a stream of `{entity, action, resource,
 * timestamp, success?}` events. No DB dependency — callers load
 * events from `audit_log` (or anywhere else) and feed them in.
 *
 * Three primary surfaces:
 *
 *   buildBaseline(events)        — summarize per-entity behaviour
 *   scoreEvent(baseline, event)  — anomaly score 0–1 vs. baseline
 *   detectAnomalies(baseline, candidates, {threshold})
 *   rankEntities(events, {topK}) — highest-risk entities overall
 *
 * Scoring is intentionally simple (frequency-based surprise +
 * failure signal) — enough to surface "this user logged in at 3am
 * from a never-seen resource" without dragging in ML baggage.
 */

/* ── helpers ───────────────────────────────────────────────── */

function _toHour(ts) {
  if (ts == null) return null;
  const d = typeof ts === "number" ? new Date(ts) : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours();
}

function _increment(map, key) {
  if (key == null) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function _toObject(map) {
  const out = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

/* ── buildBaseline ─────────────────────────────────────────── */

/**
 * Build per-entity baselines from an event stream. Returns a Map of
 * entityId → baseline. Each baseline is a frozen object; re-running
 * `buildBaseline` on an extended event set returns new baselines
 * rather than mutating prior results (important for watch loops).
 */
export function buildBaseline(events) {
  if (!Array.isArray(events)) return new Map();

  const perEntity = new Map();

  for (const ev of events) {
    if (!ev || !ev.entity) continue;
    let b = perEntity.get(ev.entity);
    if (!b) {
      b = {
        entity: ev.entity,
        eventCount: 0,
        successCount: 0,
        failureCount: 0,
        actionCounts: new Map(),
        resourceCounts: new Map(),
        hourCounts: new Array(24).fill(0),
        firstSeen: null,
        lastSeen: null,
      };
      perEntity.set(ev.entity, b);
    }

    b.eventCount += 1;
    if (ev.success === false) b.failureCount += 1;
    else b.successCount += 1;

    _increment(b.actionCounts, ev.action);
    _increment(b.resourceCounts, ev.resource);

    const h = _toHour(ev.timestamp);
    if (h != null) b.hourCounts[h] += 1;

    if (ev.timestamp != null) {
      const t =
        typeof ev.timestamp === "number"
          ? ev.timestamp
          : new Date(ev.timestamp).getTime();
      if (!Number.isNaN(t)) {
        if (b.firstSeen == null || t < b.firstSeen) b.firstSeen = t;
        if (b.lastSeen == null || t > b.lastSeen) b.lastSeen = t;
      }
    }
  }

  // Freeze a serializable snapshot. Keep the Map-typed counts
  // internally for O(1) scoring, plus JSON-friendly mirrors on the
  // returned object.
  for (const b of perEntity.values()) {
    b.uniqueActions = b.actionCounts.size;
    b.uniqueResources = b.resourceCounts.size;
    b.failureRate = b.eventCount === 0 ? 0 : b.failureCount / b.eventCount;
    b.actions = _toObject(b.actionCounts);
    b.resources = _toObject(b.resourceCounts);
  }

  return perEntity;
}

/**
 * Serialize a baseline Map to a plain-object dict suitable for
 * `JSON.stringify` / DB persistence. Drops the internal Map copies.
 */
export function serializeBaseline(baselineMap) {
  const out = {};
  for (const [entity, b] of baselineMap) {
    out[entity] = {
      entity: b.entity,
      eventCount: b.eventCount,
      successCount: b.successCount,
      failureCount: b.failureCount,
      failureRate: b.failureRate,
      uniqueActions: b.uniqueActions,
      uniqueResources: b.uniqueResources,
      hourCounts: b.hourCounts.slice(),
      actions: { ...b.actions },
      resources: { ...b.resources },
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
    };
  }
  return out;
}

/**
 * Reverse of `serializeBaseline` — hydrate a persisted dict back
 * into the runtime Map with `actionCounts` / `resourceCounts` Maps
 * restored, so `scoreEvent` can use them directly.
 */
export function deserializeBaseline(dict) {
  const map = new Map();
  if (!dict || typeof dict !== "object") return map;
  for (const [entity, b] of Object.entries(dict)) {
    const rebuilt = {
      entity,
      eventCount: b.eventCount || 0,
      successCount: b.successCount || 0,
      failureCount: b.failureCount || 0,
      failureRate: b.failureRate || 0,
      uniqueActions: b.uniqueActions || 0,
      uniqueResources: b.uniqueResources || 0,
      hourCounts:
        Array.isArray(b.hourCounts) && b.hourCounts.length === 24
          ? b.hourCounts.slice()
          : new Array(24).fill(0),
      actions: { ...(b.actions || {}) },
      resources: { ...(b.resources || {}) },
      actionCounts: new Map(Object.entries(b.actions || {})),
      resourceCounts: new Map(Object.entries(b.resources || {})),
      firstSeen: b.firstSeen ?? null,
      lastSeen: b.lastSeen ?? null,
    };
    map.set(entity, rebuilt);
  }
  return map;
}

/* ── scoreEvent ────────────────────────────────────────────── */

/**
 * Score a single event against an entity's baseline. Returns
 *   { score: 0..1, reasons: string[] }
 *
 * Higher score = more anomalous. A baseline with zero prior events
 * is treated as "fully unseen" — every incoming event scores 1.
 */
export function scoreEvent(baseline, event) {
  if (!event) return { score: 0, reasons: [] };
  if (!baseline || baseline.eventCount === 0) {
    return { score: 1, reasons: ["no prior activity for entity"] };
  }

  const total = baseline.eventCount;
  const reasons = [];

  // Hour surprise
  const h = _toHour(event.timestamp);
  let hourSurprise = 0;
  if (h != null) {
    const hc = baseline.hourCounts[h] || 0;
    hourSurprise = 1 - hc / total;
    if (hc === 0) reasons.push(`unseen hour ${h}:00 UTC`);
    else if (hourSurprise > 0.9) reasons.push(`rare hour ${h}:00 UTC`);
  }

  // Action surprise
  const ac = baseline.actionCounts.get(event.action) || 0;
  const actionSurprise = ac === 0 ? 1 : 1 - ac / total;
  if (ac === 0 && event.action) reasons.push(`unseen action "${event.action}"`);
  else if (actionSurprise > 0.9 && event.action)
    reasons.push(`rare action "${event.action}"`);

  // Resource surprise
  const rc = baseline.resourceCounts.get(event.resource) || 0;
  const resourceSurprise = rc === 0 ? 1 : 1 - rc / total;
  if (rc === 0 && event.resource)
    reasons.push(`unseen resource "${event.resource}"`);
  else if (resourceSurprise > 0.9 && event.resource)
    reasons.push(`rare resource "${event.resource}"`);

  const base = (hourSurprise + actionSurprise + resourceSurprise) / 3;

  // Failure signal — a failure against a mostly-successful baseline
  // is notable even if every other feature looks normal.
  let failureBonus = 0;
  if (event.success === false && baseline.failureRate < 0.1) {
    failureBonus = 0.3;
    reasons.push("failure against low-failure baseline");
  }

  const score = Math.min(1, base + failureBonus);
  return { score, reasons };
}

/* ── detectAnomalies ───────────────────────────────────────── */

/**
 * Score each candidate event against the relevant entity baseline,
 * and return those whose score meets `threshold` (default 0.7).
 * Returns `[{event, score, reasons}]` sorted by descending score.
 *
 * `baselineMap` is the Map returned by `buildBaseline` (or rehydrated
 * via `deserializeBaseline`).
 */
export function detectAnomalies(baselineMap, candidateEvents, options = {}) {
  const { threshold = 0.7 } = options;
  if (!Array.isArray(candidateEvents)) return [];
  if (!(baselineMap instanceof Map)) return [];

  const out = [];
  for (const ev of candidateEvents) {
    if (!ev || !ev.entity) continue;
    const baseline = baselineMap.get(ev.entity);
    const result = scoreEvent(baseline, ev);
    if (result.score >= threshold) {
      out.push({ event: ev, score: result.score, reasons: result.reasons });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ── rankEntities ──────────────────────────────────────────── */

/**
 * Rank entities by composite risk derived directly from an event
 * stream (no prior baseline required). Useful for the "top risky
 * users this week" view.
 *
 *   riskScore (0–100) = 40·failureRate
 *                     + 30·uniqueResourceRatio
 *                     + 30·burstiness
 *
 * where `burstiness` = max-hour / eventCount (1 means "all events
 * fell into a single hour", 0.04 means "evenly spread".)
 */
export function rankEntities(events, options = {}) {
  const { topK = 10 } = options;
  const baseline = buildBaseline(events);
  const rows = [];

  for (const b of baseline.values()) {
    const uniqueResourceRatio =
      b.eventCount === 0 ? 0 : b.uniqueResources / b.eventCount;
    const maxHour = Math.max(...b.hourCounts);
    const burstiness = b.eventCount === 0 ? 0 : maxHour / b.eventCount;
    const riskScore =
      100 *
      (0.4 * b.failureRate + 0.3 * uniqueResourceRatio + 0.3 * burstiness);
    rows.push({
      entity: b.entity,
      eventCount: b.eventCount,
      failureRate: b.failureRate,
      uniqueResources: b.uniqueResources,
      uniqueActions: b.uniqueActions,
      burstiness,
      riskScore: Math.round(riskScore * 100) / 100,
    });
  }

  rows.sort((a, b) => b.riskScore - a.riskScore);
  return topK > 0 ? rows.slice(0, topK) : rows;
}

/* ── persistence helpers ──────────────────────────────────── */

export function ensureUebaTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ueba_baselines (
      entity TEXT PRIMARY KEY,
      event_count INTEGER NOT NULL,
      failure_rate REAL NOT NULL,
      unique_resources INTEGER NOT NULL,
      payload TEXT NOT NULL,
      first_seen INTEGER,
      last_seen INTEGER,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Persist a baseline Map (output of `buildBaseline`) into
 * `ueba_baselines`. Rows are upserted keyed by entity.
 */
export function saveBaselines(db, baselineMap) {
  ensureUebaTables(db);
  const serialized = serializeBaseline(baselineMap);
  const insert = db.prepare(
    `INSERT INTO ueba_baselines
       (entity, event_count, failure_rate, unique_resources, payload,
        first_seen, last_seen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const update = db.prepare(
    `UPDATE ueba_baselines
        SET event_count      = ?,
            failure_rate     = ?,
            unique_resources = ?,
            payload          = ?,
            first_seen       = ?,
            last_seen        = ?,
            updated_at       = datetime('now')
      WHERE entity = ?`,
  );
  const selectExisting = db.prepare(
    `SELECT entity FROM ueba_baselines WHERE entity = ?`,
  );

  let saved = 0;
  for (const [entity, b] of Object.entries(serialized)) {
    const payload = JSON.stringify(b);
    const prior = selectExisting.get(entity);
    if (prior) {
      update.run(
        b.eventCount,
        b.failureRate,
        b.uniqueResources,
        payload,
        b.firstSeen ?? null,
        b.lastSeen ?? null,
        entity,
      );
    } else {
      insert.run(
        entity,
        b.eventCount,
        b.failureRate,
        b.uniqueResources,
        payload,
        b.firstSeen ?? null,
        b.lastSeen ?? null,
      );
    }
    saved += 1;
  }
  return saved;
}

/**
 * Load a previously saved baseline for a single entity. Returns the
 * fully-hydrated baseline object (with Maps restored) or null if no
 * row exists.
 */
export function loadBaseline(db, entity) {
  ensureUebaTables(db);
  const row = db
    .prepare(`SELECT payload FROM ueba_baselines WHERE entity = ?`)
    .get(entity);
  if (!row) return null;
  try {
    const dict = { [entity]: JSON.parse(row.payload) };
    const map = deserializeBaseline(dict);
    return map.get(entity) || null;
  } catch {
    return null;
  }
}

/**
 * Load all saved baselines into a Map<entity, baseline>.
 */
export function loadAllBaselines(db) {
  ensureUebaTables(db);
  const rows = db.prepare(`SELECT entity, payload FROM ueba_baselines`).all();
  const dict = {};
  for (const r of rows) {
    try {
      dict[r.entity] = JSON.parse(r.payload);
    } catch {
      // Skip malformed rows — better to ignore than poison the Map.
    }
  }
  return deserializeBaseline(dict);
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — UEBA V2 (additive)
 * Baseline maturity + investigation lifecycle + caps + auto-flip
 * ═══════════════════════════════════════════════════════════════ */

export const BASELINE_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});

export const INVESTIGATION_V2 = Object.freeze({
  OPEN: "open",
  INVESTIGATING: "investigating",
  CLOSED: "closed",
  DISMISSED: "dismissed",
  ESCALATED: "escalated",
});

const _BASELINE_TRANS_V2 = new Map([
  [
    BASELINE_MATURITY_V2.DRAFT,
    new Set([BASELINE_MATURITY_V2.ACTIVE, BASELINE_MATURITY_V2.ARCHIVED]),
  ],
  [
    BASELINE_MATURITY_V2.ACTIVE,
    new Set([BASELINE_MATURITY_V2.STALE, BASELINE_MATURITY_V2.ARCHIVED]),
  ],
  [
    BASELINE_MATURITY_V2.STALE,
    new Set([BASELINE_MATURITY_V2.ACTIVE, BASELINE_MATURITY_V2.ARCHIVED]),
  ],
  [BASELINE_MATURITY_V2.ARCHIVED, new Set()],
]);

const _INVESTIGATION_TRANS_V2 = new Map([
  [
    INVESTIGATION_V2.OPEN,
    new Set([
      INVESTIGATION_V2.INVESTIGATING,
      INVESTIGATION_V2.DISMISSED,
      INVESTIGATION_V2.ESCALATED,
    ]),
  ],
  [
    INVESTIGATION_V2.INVESTIGATING,
    new Set([
      INVESTIGATION_V2.CLOSED,
      INVESTIGATION_V2.ESCALATED,
      INVESTIGATION_V2.DISMISSED,
    ]),
  ],
  [INVESTIGATION_V2.CLOSED, new Set()],
  [INVESTIGATION_V2.DISMISSED, new Set()],
  [INVESTIGATION_V2.ESCALATED, new Set()],
]);

const _BASELINE_TERMINAL_V2 = new Set([BASELINE_MATURITY_V2.ARCHIVED]);
const _INVESTIGATION_TERMINAL_V2 = new Set([
  INVESTIGATION_V2.CLOSED,
  INVESTIGATION_V2.DISMISSED,
  INVESTIGATION_V2.ESCALATED,
]);

export const UEBA_DEFAULT_MAX_ACTIVE_BASELINES_PER_OWNER = 20;
export const UEBA_DEFAULT_MAX_OPEN_INVESTIGATIONS_PER_ANALYST = 10;
export const UEBA_DEFAULT_BASELINE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
export const UEBA_DEFAULT_INVESTIGATION_STUCK_MS = 14 * 24 * 60 * 60 * 1000;

let _uebaMaxActiveBaselines = UEBA_DEFAULT_MAX_ACTIVE_BASELINES_PER_OWNER;
let _uebaMaxOpenInvestigations =
  UEBA_DEFAULT_MAX_OPEN_INVESTIGATIONS_PER_ANALYST;
let _uebaBaselineStaleMs = UEBA_DEFAULT_BASELINE_STALE_MS;
let _uebaInvestigationStuckMs = UEBA_DEFAULT_INVESTIGATION_STUCK_MS;

const _baselinesV2 = new Map();
const _investigationsV2 = new Map();

function _posIntUebaV2(n, label) {
  const v = Number.isInteger(n) ? n : Math.floor(n);
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveBaselinesPerOwnerV2() {
  return _uebaMaxActiveBaselines;
}
export function setMaxActiveBaselinesPerOwnerV2(n) {
  _uebaMaxActiveBaselines = _posIntUebaV2(n, "maxActiveBaselinesPerOwner");
  return _uebaMaxActiveBaselines;
}
export function getMaxOpenInvestigationsPerAnalystV2() {
  return _uebaMaxOpenInvestigations;
}
export function setMaxOpenInvestigationsPerAnalystV2(n) {
  _uebaMaxOpenInvestigations = _posIntUebaV2(
    n,
    "maxOpenInvestigationsPerAnalyst",
  );
  return _uebaMaxOpenInvestigations;
}
export function getBaselineStaleMsV2() {
  return _uebaBaselineStaleMs;
}
export function setBaselineStaleMsV2(n) {
  _uebaBaselineStaleMs = _posIntUebaV2(n, "baselineStaleMs");
  return _uebaBaselineStaleMs;
}
export function getInvestigationStuckMsV2() {
  return _uebaInvestigationStuckMs;
}
export function setInvestigationStuckMsV2(n) {
  _uebaInvestigationStuckMs = _posIntUebaV2(n, "investigationStuckMs");
  return _uebaInvestigationStuckMs;
}

export function getActiveBaselineCountV2(owner) {
  if (!owner) throw new Error("owner is required");
  let c = 0;
  for (const b of _baselinesV2.values()) {
    if (b.owner !== owner) continue;
    if (b.status === BASELINE_MATURITY_V2.ARCHIVED) continue;
    if (b.status === BASELINE_MATURITY_V2.DRAFT) continue;
    c++;
  }
  return c;
}

export function getOpenInvestigationCountV2(analyst) {
  if (!analyst) throw new Error("analyst is required");
  let c = 0;
  for (const i of _investigationsV2.values()) {
    if (i.analyst !== analyst) continue;
    if (_INVESTIGATION_TERMINAL_V2.has(i.status)) continue;
    c++;
  }
  return c;
}

export function createBaselineV2({ id, owner, entity, metadata }) {
  if (!id) throw new Error("id is required");
  if (!owner) throw new Error("owner is required");
  if (!entity) throw new Error("entity is required");
  if (_baselinesV2.has(id)) throw new Error(`baseline ${id} already exists`);
  const now = Date.now();
  const baseline = {
    id,
    owner,
    entity: String(entity),
    status: BASELINE_MATURITY_V2.DRAFT,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    lastRefreshedAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _baselinesV2.set(id, baseline);
  return { ...baseline, metadata: { ...baseline.metadata } };
}

export function getBaselineV2(id) {
  const b = _baselinesV2.get(id);
  if (!b) return null;
  return { ...b, metadata: { ...b.metadata } };
}

export function listBaselinesV2({ owner, status } = {}) {
  const out = [];
  for (const b of _baselinesV2.values()) {
    if (owner && b.owner !== owner) continue;
    if (status && b.status !== status) continue;
    out.push({ ...b, metadata: { ...b.metadata } });
  }
  return out;
}

export function setBaselineMaturityV2(
  id,
  nextStatus,
  { reason, metadata } = {},
) {
  const b = _baselinesV2.get(id);
  if (!b) throw new Error(`baseline ${id} not found`);
  if (!_BASELINE_TRANS_V2.has(b.status))
    throw new Error(`unknown status ${b.status}`);
  const allowed = _BASELINE_TRANS_V2.get(b.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition baseline ${id} from ${b.status} to ${nextStatus}`,
    );
  }
  if (nextStatus === BASELINE_MATURITY_V2.ACTIVE) {
    const wasActive =
      b.status === BASELINE_MATURITY_V2.ACTIVE ||
      b.status === BASELINE_MATURITY_V2.STALE;
    if (
      !wasActive &&
      getActiveBaselineCountV2(b.owner) >= _uebaMaxActiveBaselines
    ) {
      throw new Error(
        `owner ${b.owner} exceeds max active baseline cap ${_uebaMaxActiveBaselines}`,
      );
    }
  }
  const now = Date.now();
  b.status = nextStatus;
  b.updatedAt = now;
  b.lastRefreshedAt = now;
  if (nextStatus === BASELINE_MATURITY_V2.ACTIVE && !b.activatedAt)
    b.activatedAt = now;
  if (reason) b.reason = reason;
  if (metadata) b.metadata = { ...b.metadata, ...metadata };
  return { ...b, metadata: { ...b.metadata } };
}

export function activateBaselineV2(id, opts) {
  return setBaselineMaturityV2(id, BASELINE_MATURITY_V2.ACTIVE, opts);
}
export function markBaselineStaleV2(id, opts) {
  return setBaselineMaturityV2(id, BASELINE_MATURITY_V2.STALE, opts);
}
export function archiveBaselineV2(id, opts) {
  return setBaselineMaturityV2(id, BASELINE_MATURITY_V2.ARCHIVED, opts);
}

export function refreshBaselineV2(id) {
  const b = _baselinesV2.get(id);
  if (!b) throw new Error(`baseline ${id} not found`);
  if (_BASELINE_TERMINAL_V2.has(b.status))
    throw new Error(`baseline ${id} is terminal`);
  b.lastRefreshedAt = Date.now();
  return { ...b, metadata: { ...b.metadata } };
}

export function openInvestigationV2({
  id,
  analyst,
  baselineId,
  summary,
  metadata,
}) {
  if (!id) throw new Error("id is required");
  if (!analyst) throw new Error("analyst is required");
  if (!baselineId) throw new Error("baselineId is required");
  if (!_baselinesV2.has(baselineId))
    throw new Error(`baseline ${baselineId} not found`);
  if (_investigationsV2.has(id))
    throw new Error(`investigation ${id} already exists`);
  if (getOpenInvestigationCountV2(analyst) >= _uebaMaxOpenInvestigations) {
    throw new Error(
      `analyst ${analyst} exceeds max open investigation cap ${_uebaMaxOpenInvestigations}`,
    );
  }
  const now = Date.now();
  const inv = {
    id,
    analyst,
    baselineId,
    summary: summary ? String(summary) : "",
    status: INVESTIGATION_V2.OPEN,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    closedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _investigationsV2.set(id, inv);
  return { ...inv, metadata: { ...inv.metadata } };
}

export function getInvestigationV2(id) {
  const i = _investigationsV2.get(id);
  if (!i) return null;
  return { ...i, metadata: { ...i.metadata } };
}

export function listInvestigationsV2({ analyst, status, baselineId } = {}) {
  const out = [];
  for (const i of _investigationsV2.values()) {
    if (analyst && i.analyst !== analyst) continue;
    if (status && i.status !== status) continue;
    if (baselineId && i.baselineId !== baselineId) continue;
    out.push({ ...i, metadata: { ...i.metadata } });
  }
  return out;
}

export function setInvestigationStatusV2(
  id,
  nextStatus,
  { reason, metadata } = {},
) {
  const i = _investigationsV2.get(id);
  if (!i) throw new Error(`investigation ${id} not found`);
  if (!_INVESTIGATION_TRANS_V2.has(i.status))
    throw new Error(`unknown status ${i.status}`);
  const allowed = _INVESTIGATION_TRANS_V2.get(i.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition investigation ${id} from ${i.status} to ${nextStatus}`,
    );
  }
  const now = Date.now();
  i.status = nextStatus;
  i.updatedAt = now;
  if (nextStatus === INVESTIGATION_V2.INVESTIGATING && !i.startedAt)
    i.startedAt = now;
  if (_INVESTIGATION_TERMINAL_V2.has(nextStatus)) i.closedAt = now;
  if (reason) i.reason = reason;
  if (metadata) i.metadata = { ...i.metadata, ...metadata };
  return { ...i, metadata: { ...i.metadata } };
}

export function startInvestigationV2(id, opts) {
  return setInvestigationStatusV2(id, INVESTIGATION_V2.INVESTIGATING, opts);
}
export function closeInvestigationV2(id, opts) {
  return setInvestigationStatusV2(id, INVESTIGATION_V2.CLOSED, opts);
}
export function dismissInvestigationV2(id, opts) {
  return setInvestigationStatusV2(id, INVESTIGATION_V2.DISMISSED, opts);
}
export function escalateInvestigationV2(id, opts) {
  return setInvestigationStatusV2(id, INVESTIGATION_V2.ESCALATED, opts);
}

export function autoMarkStaleBaselinesV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const b of _baselinesV2.values()) {
    if (b.status !== BASELINE_MATURITY_V2.ACTIVE) continue;
    if (t - b.lastRefreshedAt > _uebaBaselineStaleMs) {
      b.status = BASELINE_MATURITY_V2.STALE;
      b.updatedAt = t;
      out.push(b.id);
    }
  }
  return out;
}

export function autoEscalateStuckInvestigationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const i of _investigationsV2.values()) {
    if (i.status !== INVESTIGATION_V2.INVESTIGATING) continue;
    if (i.startedAt == null) continue;
    if (t - i.startedAt > _uebaInvestigationStuckMs) {
      i.status = INVESTIGATION_V2.ESCALATED;
      i.closedAt = t;
      i.updatedAt = t;
      i.reason = i.reason || "auto-escalate: stuck investigating";
      out.push(i.id);
    }
  }
  return out;
}

export function getUebaStatsV2() {
  const baselinesByStatus = {};
  for (const v of Object.values(BASELINE_MATURITY_V2)) baselinesByStatus[v] = 0;
  for (const b of _baselinesV2.values()) baselinesByStatus[b.status]++;
  const investigationsByStatus = {};
  for (const v of Object.values(INVESTIGATION_V2))
    investigationsByStatus[v] = 0;
  for (const i of _investigationsV2.values())
    investigationsByStatus[i.status]++;
  return {
    totalBaselinesV2: _baselinesV2.size,
    totalInvestigationsV2: _investigationsV2.size,
    maxActiveBaselinesPerOwner: _uebaMaxActiveBaselines,
    maxOpenInvestigationsPerAnalyst: _uebaMaxOpenInvestigations,
    baselineStaleMs: _uebaBaselineStaleMs,
    investigationStuckMs: _uebaInvestigationStuckMs,
    baselinesByStatus,
    investigationsByStatus,
  };
}

export function _resetStateUebaV2() {
  _baselinesV2.clear();
  _investigationsV2.clear();
  _uebaMaxActiveBaselines = UEBA_DEFAULT_MAX_ACTIVE_BASELINES_PER_OWNER;
  _uebaMaxOpenInvestigations = UEBA_DEFAULT_MAX_OPEN_INVESTIGATIONS_PER_ANALYST;
  _uebaBaselineStaleMs = UEBA_DEFAULT_BASELINE_STALE_MS;
  _uebaInvestigationStuckMs = UEBA_DEFAULT_INVESTIGATION_STUCK_MS;
}

// =====================================================================
// ueba V2 governance overlay (iter24)
// =====================================================================
export const UEBGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUPPRESSED: "suppressed",
  ARCHIVED: "archived",
});
export const UEBGOV_ALERT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ANALYZING: "analyzing",
  TRIAGED: "triaged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _uebgovPTrans = new Map([
  [
    UEBGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      UEBGOV_PROFILE_MATURITY_V2.ACTIVE,
      UEBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    UEBGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      UEBGOV_PROFILE_MATURITY_V2.SUPPRESSED,
      UEBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    UEBGOV_PROFILE_MATURITY_V2.SUPPRESSED,
    new Set([
      UEBGOV_PROFILE_MATURITY_V2.ACTIVE,
      UEBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [UEBGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _uebgovPTerminal = new Set([UEBGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _uebgovJTrans = new Map([
  [
    UEBGOV_ALERT_LIFECYCLE_V2.QUEUED,
    new Set([
      UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING,
      UEBGOV_ALERT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING,
    new Set([
      UEBGOV_ALERT_LIFECYCLE_V2.TRIAGED,
      UEBGOV_ALERT_LIFECYCLE_V2.FAILED,
      UEBGOV_ALERT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [UEBGOV_ALERT_LIFECYCLE_V2.TRIAGED, new Set()],
  [UEBGOV_ALERT_LIFECYCLE_V2.FAILED, new Set()],
  [UEBGOV_ALERT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _uebgovPsV2 = new Map();
const _uebgovJsV2 = new Map();
let _uebgovMaxActive = 8,
  _uebgovMaxPending = 20,
  _uebgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _uebgovStuckMs = 60 * 1000;
function _uebgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _uebgovCheckP(from, to) {
  const a = _uebgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid uebgov profile transition ${from} → ${to}`);
}
function _uebgovCheckJ(from, to) {
  const a = _uebgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid uebgov alert transition ${from} → ${to}`);
}
function _uebgovCountActive(owner) {
  let c = 0;
  for (const p of _uebgovPsV2.values())
    if (p.owner === owner && p.status === UEBGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _uebgovCountPending(profileId) {
  let c = 0;
  for (const j of _uebgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === UEBGOV_ALERT_LIFECYCLE_V2.QUEUED ||
        j.status === UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING)
    )
      c++;
  return c;
}
export function setMaxActiveUebgovProfilesPerOwnerV2(n) {
  _uebgovMaxActive = _uebgovPos(n, "maxActiveUebgovProfilesPerOwner");
}
export function getMaxActiveUebgovProfilesPerOwnerV2() {
  return _uebgovMaxActive;
}
export function setMaxPendingUebgovAlertsPerProfileV2(n) {
  _uebgovMaxPending = _uebgovPos(n, "maxPendingUebgovAlertsPerProfile");
}
export function getMaxPendingUebgovAlertsPerProfileV2() {
  return _uebgovMaxPending;
}
export function setUebgovProfileIdleMsV2(n) {
  _uebgovIdleMs = _uebgovPos(n, "uebgovProfileIdleMs");
}
export function getUebgovProfileIdleMsV2() {
  return _uebgovIdleMs;
}
export function setUebgovAlertStuckMsV2(n) {
  _uebgovStuckMs = _uebgovPos(n, "uebgovAlertStuckMs");
}
export function getUebgovAlertStuckMsV2() {
  return _uebgovStuckMs;
}
export function _resetStateUebaGovV2() {
  _uebgovPsV2.clear();
  _uebgovJsV2.clear();
  _uebgovMaxActive = 8;
  _uebgovMaxPending = 20;
  _uebgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _uebgovStuckMs = 60 * 1000;
}
export function registerUebgovProfileV2({ id, owner, entity, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_uebgovPsV2.has(id))
    throw new Error(`uebgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    entity: entity || "user",
    status: UEBGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _uebgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateUebgovProfileV2(id) {
  const p = _uebgovPsV2.get(id);
  if (!p) throw new Error(`uebgov profile ${id} not found`);
  const isInitial = p.status === UEBGOV_PROFILE_MATURITY_V2.PENDING;
  _uebgovCheckP(p.status, UEBGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _uebgovCountActive(p.owner) >= _uebgovMaxActive)
    throw new Error(`max active uebgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = UEBGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suppressUebgovProfileV2(id) {
  const p = _uebgovPsV2.get(id);
  if (!p) throw new Error(`uebgov profile ${id} not found`);
  _uebgovCheckP(p.status, UEBGOV_PROFILE_MATURITY_V2.SUPPRESSED);
  p.status = UEBGOV_PROFILE_MATURITY_V2.SUPPRESSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveUebgovProfileV2(id) {
  const p = _uebgovPsV2.get(id);
  if (!p) throw new Error(`uebgov profile ${id} not found`);
  _uebgovCheckP(p.status, UEBGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = UEBGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchUebgovProfileV2(id) {
  const p = _uebgovPsV2.get(id);
  if (!p) throw new Error(`uebgov profile ${id} not found`);
  if (_uebgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal uebgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getUebgovProfileV2(id) {
  const p = _uebgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listUebgovProfilesV2() {
  return [..._uebgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createUebgovAlertV2({
  id,
  profileId,
  behavior,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_uebgovJsV2.has(id)) throw new Error(`uebgov alert ${id} already exists`);
  if (!_uebgovPsV2.has(profileId))
    throw new Error(`uebgov profile ${profileId} not found`);
  if (_uebgovCountPending(profileId) >= _uebgovMaxPending)
    throw new Error(
      `max pending uebgov alerts for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    behavior: behavior || "",
    status: UEBGOV_ALERT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _uebgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function analyzingUebgovAlertV2(id) {
  const j = _uebgovJsV2.get(id);
  if (!j) throw new Error(`uebgov alert ${id} not found`);
  _uebgovCheckJ(j.status, UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING);
  const now = Date.now();
  j.status = UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeAlertUebgovV2(id) {
  const j = _uebgovJsV2.get(id);
  if (!j) throw new Error(`uebgov alert ${id} not found`);
  _uebgovCheckJ(j.status, UEBGOV_ALERT_LIFECYCLE_V2.TRIAGED);
  const now = Date.now();
  j.status = UEBGOV_ALERT_LIFECYCLE_V2.TRIAGED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failUebgovAlertV2(id, reason) {
  const j = _uebgovJsV2.get(id);
  if (!j) throw new Error(`uebgov alert ${id} not found`);
  _uebgovCheckJ(j.status, UEBGOV_ALERT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = UEBGOV_ALERT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelUebgovAlertV2(id, reason) {
  const j = _uebgovJsV2.get(id);
  if (!j) throw new Error(`uebgov alert ${id} not found`);
  _uebgovCheckJ(j.status, UEBGOV_ALERT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = UEBGOV_ALERT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getUebgovAlertV2(id) {
  const j = _uebgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listUebgovAlertsV2() {
  return [..._uebgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuppressIdleUebgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _uebgovPsV2.values())
    if (
      p.status === UEBGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _uebgovIdleMs
    ) {
      p.status = UEBGOV_PROFILE_MATURITY_V2.SUPPRESSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckUebgovAlertsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _uebgovJsV2.values())
    if (
      j.status === UEBGOV_ALERT_LIFECYCLE_V2.ANALYZING &&
      j.startedAt != null &&
      t - j.startedAt >= _uebgovStuckMs
    ) {
      j.status = UEBGOV_ALERT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getUebaGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(UEBGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _uebgovPsV2.values()) profilesByStatus[p.status]++;
  const alertsByStatus = {};
  for (const v of Object.values(UEBGOV_ALERT_LIFECYCLE_V2))
    alertsByStatus[v] = 0;
  for (const j of _uebgovJsV2.values()) alertsByStatus[j.status]++;
  return {
    totalUebgovProfilesV2: _uebgovPsV2.size,
    totalUebgovAlertsV2: _uebgovJsV2.size,
    maxActiveUebgovProfilesPerOwner: _uebgovMaxActive,
    maxPendingUebgovAlertsPerProfile: _uebgovMaxPending,
    uebgovProfileIdleMs: _uebgovIdleMs,
    uebgovAlertStuckMs: _uebgovStuckMs,
    profilesByStatus,
    alertsByStatus,
  };
}
