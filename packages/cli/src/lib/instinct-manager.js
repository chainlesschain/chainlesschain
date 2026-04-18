/**
 * Instinct Manager — learns user preferences from agent interactions.
 * Tracks patterns like preferred tools, coding style, response format, etc.
 */

/**
 * Ensure instincts table exists.
 */
export function ensureInstinctsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instincts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      pattern TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      occurrences INTEGER DEFAULT 1,
      last_seen TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function generateId() {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Instinct categories.
 */
export const INSTINCT_CATEGORIES = {
  TOOL_PREFERENCE: "tool_preference",
  CODING_STYLE: "coding_style",
  RESPONSE_FORMAT: "response_format",
  LANGUAGE: "language",
  WORKFLOW: "workflow",
  BEHAVIOR: "behavior",
};

/**
 * Record an instinct observation.
 * If an instinct with the same category+pattern exists, increment its confidence and occurrences.
 */
export function recordInstinct(db, category, pattern) {
  ensureInstinctsTable(db);

  // Check if exists
  const existing = db
    .prepare("SELECT * FROM instincts WHERE category = ? AND pattern = ?")
    .get(category, pattern);

  if (existing) {
    // Boost confidence (asymptotic approach to 1.0)
    const newConfidence = Math.min(
      0.99,
      existing.confidence + (1 - existing.confidence) * 0.1,
    );
    db.prepare(
      "UPDATE instincts SET confidence = ?, occurrences = occurrences + 1, last_seen = datetime('now') WHERE id = ?",
    ).run(newConfidence, existing.id);

    return {
      id: existing.id,
      category,
      pattern,
      confidence: newConfidence,
      occurrences: (existing.occurrences || 1) + 1,
      isNew: false,
    };
  }

  // Create new instinct
  const id = generateId();
  db.prepare(
    "INSERT INTO instincts (id, category, pattern, confidence, occurrences) VALUES (?, ?, ?, ?, ?)",
  ).run(id, category, pattern, 0.5, 1);

  return {
    id,
    category,
    pattern,
    confidence: 0.5,
    occurrences: 1,
    isNew: true,
  };
}

/**
 * Get all instincts, optionally filtered by category.
 */
export function getInstincts(db, options = {}) {
  ensureInstinctsTable(db);

  let sql = "SELECT * FROM instincts";
  const params = [];

  if (options.category) {
    sql += " WHERE category = ?";
    params.push(options.category);
  }

  sql += " ORDER BY confidence DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params);
}

/**
 * Get top instincts (confidence >= threshold).
 */
export function getStrongInstincts(db, threshold = 0.7) {
  ensureInstinctsTable(db);
  return db
    .prepare(
      "SELECT * FROM instincts WHERE confidence >= ? ORDER BY confidence DESC",
    )
    .all(threshold);
}

/**
 * Delete an instinct by ID or prefix.
 */
export function deleteInstinct(db, id) {
  ensureInstinctsTable(db);
  const result = db
    .prepare("DELETE FROM instincts WHERE id LIKE ?")
    .run(`${id}%`);
  return result.changes > 0;
}

/**
 * Reset all instincts (clear the table).
 */
export function resetInstincts(db) {
  ensureInstinctsTable(db);
  const result = db.prepare("DELETE FROM instincts WHERE 1=1").run();
  return result.changes;
}

/**
 * Decay instincts that haven't been seen recently.
 * Reduces confidence of old instincts over time.
 */
export function decayInstincts(db, daysThreshold = 30) {
  ensureInstinctsTable(db);
  // Simple decay: multiply confidence by 0.9 for old instincts
  const rows = db.prepare("SELECT * FROM instincts").all();
  let decayed = 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);
  const cutoffStr = cutoff.toISOString().replace("T", " ").slice(0, 19);

  for (const row of rows) {
    if (row.last_seen && row.last_seen < cutoffStr) {
      const newConfidence = Math.max(0.1, (row.confidence || 0.5) * 0.9);
      db.prepare("UPDATE instincts SET confidence = ? WHERE id = ?").run(
        newConfidence,
        row.id,
      );
      decayed++;
    }
  }

  return decayed;
}

/**
 * Generate a system prompt fragment from strong instincts.
 */
export function generateInstinctPrompt(db) {
  const strong = getStrongInstincts(db, 0.6);
  if (strong.length === 0) return "";

  const lines = ["Based on learned preferences:"];
  for (const inst of strong) {
    lines.push(
      `- [${inst.category}] ${inst.pattern} (confidence: ${(inst.confidence * 100).toFixed(0)}%)`,
    );
  }

  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Instinct governance layer.
 * Tracks per-user instinct profile maturity + observation lifecycle
 * independent of legacy SQLite instincts table.
 * ═══════════════════════════════════════════════════════════════ */

export const PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DORMANT: "dormant",
  ARCHIVED: "archived",
});

export const OBSERVATION_LIFECYCLE_V2 = Object.freeze({
  CAPTURED: "captured",
  REVIEWED: "reviewed",
  REINFORCED: "reinforced",
  DISCARDED: "discarded",
  PROMOTED: "promoted",
});

const PROFILE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "archived"])],
  ["active", new Set(["dormant", "archived"])],
  ["dormant", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const PROFILE_TERMINALS_V2 = new Set(["archived"]);

const OBS_TRANSITIONS_V2 = new Map([
  ["captured", new Set(["reviewed", "discarded"])],
  ["reviewed", new Set(["reinforced", "discarded", "promoted"])],
  ["reinforced", new Set(["promoted", "discarded"])],
  ["discarded", new Set()],
  ["promoted", new Set()],
]);
const OBS_TERMINALS_V2 = new Set(["discarded", "promoted"]);

export const INSTINCT_DEFAULT_MAX_ACTIVE_PROFILES_PER_USER = 5;
export const INSTINCT_DEFAULT_MAX_PENDING_OBS_PER_PROFILE = 100;
export const INSTINCT_DEFAULT_PROFILE_IDLE_MS = 1000 * 60 * 60 * 24 * 60; // 60 days
export const INSTINCT_DEFAULT_OBS_STUCK_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const _profilesV2 = new Map();
const _observationsV2 = new Map();
let _maxActiveProfilesPerUserV2 = INSTINCT_DEFAULT_MAX_ACTIVE_PROFILES_PER_USER;
let _maxPendingObsPerProfileV2 = INSTINCT_DEFAULT_MAX_PENDING_OBS_PER_PROFILE;
let _profileIdleMsV2 = INSTINCT_DEFAULT_PROFILE_IDLE_MS;
let _obsStuckMsV2 = INSTINCT_DEFAULT_OBS_STUCK_MS;

function _posIntInstinctV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveProfilesPerUserV2() {
  return _maxActiveProfilesPerUserV2;
}
export function setMaxActiveProfilesPerUserV2(n) {
  _maxActiveProfilesPerUserV2 = _posIntInstinctV2(
    n,
    "maxActiveProfilesPerUser",
  );
}
export function getMaxPendingObsPerProfileV2() {
  return _maxPendingObsPerProfileV2;
}
export function setMaxPendingObsPerProfileV2(n) {
  _maxPendingObsPerProfileV2 = _posIntInstinctV2(n, "maxPendingObsPerProfile");
}
export function getProfileIdleMsV2() {
  return _profileIdleMsV2;
}
export function setProfileIdleMsV2(n) {
  _profileIdleMsV2 = _posIntInstinctV2(n, "profileIdleMs");
}
export function getObsStuckMsV2() {
  return _obsStuckMsV2;
}
export function setObsStuckMsV2(n) {
  _obsStuckMsV2 = _posIntInstinctV2(n, "obsStuckMs");
}

export function getActiveProfileCountV2(userId) {
  let n = 0;
  for (const p of _profilesV2.values()) {
    if (p.userId === userId && p.status === "active") n += 1;
  }
  return n;
}

export function getPendingObsCountV2(profileId) {
  let n = 0;
  for (const o of _observationsV2.values()) {
    if (
      o.profileId === profileId &&
      (o.status === "captured" || o.status === "reviewed")
    )
      n += 1;
  }
  return n;
}

function _copyProfileV2(p) {
  return { ...p, metadata: { ...p.metadata } };
}
function _copyObsV2(o) {
  return { ...o, metadata: { ...o.metadata } };
}

export function registerProfileV2(
  id,
  { userId, category, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!userId || typeof userId !== "string")
    throw new Error("userId must be a string");
  if (!category || typeof category !== "string")
    throw new Error("category must be a string");
  if (_profilesV2.has(id)) throw new Error(`profile ${id} already exists`);
  const p = {
    id,
    userId,
    category,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _profilesV2.set(id, p);
  return _copyProfileV2(p);
}

export function getProfileV2(id) {
  const p = _profilesV2.get(id);
  return p ? _copyProfileV2(p) : null;
}

export function listProfilesV2({ userId, category, status } = {}) {
  const out = [];
  for (const p of _profilesV2.values()) {
    if (userId && p.userId !== userId) continue;
    if (category && p.category !== category) continue;
    if (status && p.status !== status) continue;
    out.push(_copyProfileV2(p));
  }
  return out;
}

export function setProfileStatusV2(id, next, { now = Date.now() } = {}) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  if (!PROFILE_TRANSITIONS_V2.has(next))
    throw new Error(`unknown profile status: ${next}`);
  if (PROFILE_TERMINALS_V2.has(p.status))
    throw new Error(`profile ${id} is in terminal state ${p.status}`);
  const allowed = PROFILE_TRANSITIONS_V2.get(p.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition profile from ${p.status} to ${next}`);
  if (next === "active") {
    if (p.status === "pending") {
      const count = getActiveProfileCountV2(p.userId);
      if (count >= _maxActiveProfilesPerUserV2)
        throw new Error(
          `user ${p.userId} already at active-profile cap (${_maxActiveProfilesPerUserV2})`,
        );
    }
    if (!p.activatedAt) p.activatedAt = now;
  }
  if (next === "archived" && !p.archivedAt) p.archivedAt = now;
  p.status = next;
  p.lastSeenAt = now;
  return _copyProfileV2(p);
}

export function activateProfileV2(id, opts) {
  return setProfileStatusV2(id, "active", opts);
}
export function dormantProfileV2(id, opts) {
  return setProfileStatusV2(id, "dormant", opts);
}
export function archiveProfileV2(id, opts) {
  return setProfileStatusV2(id, "archived", opts);
}

export function touchProfileV2(id, { now = Date.now() } = {}) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  p.lastSeenAt = now;
  return _copyProfileV2(p);
}

export function createObservationV2(
  id,
  { profileId, signal, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId must be a string");
  if (!signal || typeof signal !== "string")
    throw new Error("signal must be a string");
  if (_observationsV2.has(id))
    throw new Error(`observation ${id} already exists`);
  const count = getPendingObsCountV2(profileId);
  if (count >= _maxPendingObsPerProfileV2)
    throw new Error(
      `profile ${profileId} already at pending-obs cap (${_maxPendingObsPerProfileV2})`,
    );
  const o = {
    id,
    profileId,
    signal,
    status: "captured",
    createdAt: now,
    lastSeenAt: now,
    reviewedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _observationsV2.set(id, o);
  return _copyObsV2(o);
}

export function getObservationV2(id) {
  const o = _observationsV2.get(id);
  return o ? _copyObsV2(o) : null;
}

export function listObservationsV2({ profileId, status } = {}) {
  const out = [];
  for (const o of _observationsV2.values()) {
    if (profileId && o.profileId !== profileId) continue;
    if (status && o.status !== status) continue;
    out.push(_copyObsV2(o));
  }
  return out;
}

export function setObservationStatusV2(id, next, { now = Date.now() } = {}) {
  const o = _observationsV2.get(id);
  if (!o) throw new Error(`observation ${id} not found`);
  if (!OBS_TRANSITIONS_V2.has(next))
    throw new Error(`unknown observation status: ${next}`);
  if (OBS_TERMINALS_V2.has(o.status))
    throw new Error(`observation ${id} is in terminal state ${o.status}`);
  const allowed = OBS_TRANSITIONS_V2.get(o.status);
  if (!allowed.has(next))
    throw new Error(
      `cannot transition observation from ${o.status} to ${next}`,
    );
  if (next === "reviewed" && !o.reviewedAt) o.reviewedAt = now;
  if (OBS_TERMINALS_V2.has(next) && !o.settledAt) o.settledAt = now;
  o.status = next;
  o.lastSeenAt = now;
  return _copyObsV2(o);
}

export function reviewObservationV2(id, opts) {
  return setObservationStatusV2(id, "reviewed", opts);
}
export function reinforceObservationV2(id, opts) {
  return setObservationStatusV2(id, "reinforced", opts);
}
export function promoteObservationV2(id, opts) {
  return setObservationStatusV2(id, "promoted", opts);
}
export function discardObservationV2(id, opts) {
  return setObservationStatusV2(id, "discarded", opts);
}

export function autoDormantIdleProfilesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _profilesV2.values()) {
    if (p.status !== "active") continue;
    if (now - p.lastSeenAt > _profileIdleMsV2) {
      p.status = "dormant";
      p.lastSeenAt = now;
      flipped.push(_copyProfileV2(p));
    }
  }
  return flipped;
}

export function autoDiscardStaleObservationsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const o of _observationsV2.values()) {
    if (o.status !== "captured" && o.status !== "reviewed") continue;
    if (now - o.lastSeenAt > _obsStuckMsV2) {
      o.status = "discarded";
      o.lastSeenAt = now;
      if (!o.settledAt) o.settledAt = now;
      flipped.push(_copyObsV2(o));
    }
  }
  return flipped;
}

export function getInstinctManagerStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PROFILE_MATURITY_V2)) profilesByStatus[v] = 0;
  for (const p of _profilesV2.values()) profilesByStatus[p.status] += 1;

  const observationsByStatus = {};
  for (const v of Object.values(OBSERVATION_LIFECYCLE_V2))
    observationsByStatus[v] = 0;
  for (const o of _observationsV2.values()) observationsByStatus[o.status] += 1;

  return {
    totalProfilesV2: _profilesV2.size,
    totalObservationsV2: _observationsV2.size,
    maxActiveProfilesPerUser: _maxActiveProfilesPerUserV2,
    maxPendingObsPerProfile: _maxPendingObsPerProfileV2,
    profileIdleMs: _profileIdleMsV2,
    obsStuckMs: _obsStuckMsV2,
    profilesByStatus,
    observationsByStatus,
  };
}

export function _resetStateInstinctManagerV2() {
  _profilesV2.clear();
  _observationsV2.clear();
  _maxActiveProfilesPerUserV2 = INSTINCT_DEFAULT_MAX_ACTIVE_PROFILES_PER_USER;
  _maxPendingObsPerProfileV2 = INSTINCT_DEFAULT_MAX_PENDING_OBS_PER_PROFILE;
  _profileIdleMsV2 = INSTINCT_DEFAULT_PROFILE_IDLE_MS;
  _obsStuckMsV2 = INSTINCT_DEFAULT_OBS_STUCK_MS;
}
