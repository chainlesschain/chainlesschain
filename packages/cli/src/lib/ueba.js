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
