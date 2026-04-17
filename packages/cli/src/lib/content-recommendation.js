/**
 * Content Recommendation — CLI port of Phase 48 智能内容推荐系统
 * (docs/design/modules/22_智能内容推荐系统.md).
 *
 * Desktop uses LocalRecommender + InterestProfiler with Pinia store,
 * RecommendationsPage.vue tag-cloud, and IPC channels. CLI port ships:
 *
 *   - Interest profile CRUD (topic weights + interaction weights + time decay)
 *   - Content scoring (topic overlap × weight)
 *   - Recommendation generation from content pool
 *   - Feedback collection (like / dislike / later)
 *   - Recommendation stats per user
 *
 * What does NOT port: Pinia store, RecommendationsPage.vue tag-cloud,
 * real-time refresh, IPC channels.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const CONTENT_TYPES = Object.freeze({
  NOTE: Object.freeze({ id: "note", name: "Note", description: "笔记" }),
  POST: Object.freeze({ id: "post", name: "Post", description: "帖子" }),
  ARTICLE: Object.freeze({
    id: "article",
    name: "Article",
    description: "文章",
  }),
  DOCUMENT: Object.freeze({
    id: "document",
    name: "Document",
    description: "文档",
  }),
});

export const RECOMMENDATION_STATUS = Object.freeze({
  PENDING: "pending",
  VIEWED: "viewed",
  DISMISSED: "dismissed",
});

export const FEEDBACK_VALUES = Object.freeze({
  LIKE: "like",
  DISLIKE: "dislike",
  LATER: "later",
});

export const DEFAULT_CONFIG = Object.freeze({
  minScore: 0.3,
  maxBatchSize: 50,
  decayFactor: 0.9,
  defaultLimit: 20,
});

/* ── State ─────────────────────────────────────────────── */

let _profiles = new Map();
let _recommendations = new Map();
let _userRecs = new Map(); // userId → Set<recId>
let _seq = 0;

function _id() {
  return crypto.randomUUID();
}

function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ────────────────────────────────────────────── */

export function ensureRecommendationTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_interest_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,
    topics TEXT,
    interaction_weights TEXT,
    decay_factor REAL DEFAULT 0.9,
    last_updated INTEGER,
    update_count INTEGER DEFAULT 0
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_uip_user ON user_interest_profiles(user_id)",
  );

  db.exec(`CREATE TABLE IF NOT EXISTS content_recommendations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    content_id TEXT,
    content_type TEXT,
    title TEXT,
    score REAL,
    reason TEXT,
    source TEXT DEFAULT 'heuristic',
    status TEXT DEFAULT 'pending',
    feedback TEXT,
    created_at INTEGER,
    viewed_at INTEGER
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_cr_user ON content_recommendations(user_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_cr_score ON content_recommendations(score DESC)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_cr_status ON content_recommendations(status)",
  );

  _loadAll(db);
}

function _loadAll(db) {
  _profiles.clear();
  _recommendations.clear();
  _userRecs.clear();
  _seq = 0;

  try {
    const profiles = db.prepare("SELECT * FROM user_interest_profiles").all();
    for (const row of profiles) {
      const p = _strip(row);
      p.topics = _parseJson(p.topics, {});
      p.interaction_weights = _parseJson(p.interaction_weights, {});
      _profiles.set(p.user_id, p);
    }
  } catch (_e) {
    /* table may not exist yet */
  }

  try {
    const recs = db.prepare("SELECT * FROM content_recommendations").all();
    for (const row of recs) {
      const r = _strip(row);
      _recommendations.set(r.id, r);
      if (!_userRecs.has(r.user_id)) _userRecs.set(r.user_id, new Set());
      _userRecs.get(r.user_id).add(r.id);
    }
  } catch (_e) {
    /* table may not exist yet */
  }
}

function _parseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (_e) {
    return fallback;
  }
}

/* ── Interest Profile ──────────────────────────────────── */

export function getProfile(db, userId) {
  const p = _profiles.get(userId);
  if (!p) return null;
  return { ...p };
}

export function createProfile(
  db,
  userId,
  { topics = {}, interactionWeights = {} } = {},
) {
  if (_profiles.has(userId)) {
    return { profileId: null, reason: "profile_exists" };
  }
  const id = _id();
  const now = _now();
  const profile = {
    id,
    user_id: userId,
    topics,
    interaction_weights: interactionWeights,
    decay_factor: DEFAULT_CONFIG.decayFactor,
    last_updated: now,
    update_count: 0,
  };

  db.prepare(
    `INSERT INTO user_interest_profiles (id, user_id, topics, interaction_weights, decay_factor, last_updated, update_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    JSON.stringify(topics),
    JSON.stringify(interactionWeights),
    profile.decay_factor,
    now,
    0,
  );

  _profiles.set(userId, profile);
  return { profileId: id };
}

export function updateProfile(
  db,
  userId,
  { topics, interactionWeights, decayFactor } = {},
) {
  const p = _profiles.get(userId);
  if (!p) return { updated: false, reason: "not_found" };

  if (topics !== undefined) p.topics = topics;
  if (interactionWeights !== undefined)
    p.interaction_weights = interactionWeights;
  if (decayFactor !== undefined) p.decay_factor = decayFactor;
  p.last_updated = _now();
  p.update_count += 1;

  db.prepare(
    `UPDATE user_interest_profiles SET topics = ?, interaction_weights = ?, decay_factor = ?, last_updated = ?, update_count = ?
     WHERE user_id = ?`,
  ).run(
    JSON.stringify(p.topics),
    JSON.stringify(p.interaction_weights),
    p.decay_factor,
    p.last_updated,
    p.update_count,
    userId,
  );

  return { updated: true };
}

export function deleteProfile(db, userId) {
  const p = _profiles.get(userId);
  if (!p) return { deleted: false, reason: "not_found" };

  db.prepare("DELETE FROM user_interest_profiles WHERE user_id = ?").run(
    userId,
  );
  _profiles.delete(userId);
  return { deleted: true };
}

export function listProfiles(db, { limit = 50 } = {}) {
  return [..._profiles.values()]
    .sort((a, b) => b.last_updated - a.last_updated)
    .slice(0, limit)
    .map((p) => ({ ...p }));
}

/* ── Topic Decay ───────────────────────────────────────── */

export function applyDecay(db, userId) {
  const p = _profiles.get(userId);
  if (!p) return { applied: false, reason: "not_found" };

  const factor = p.decay_factor;
  const decayed = {};
  for (const [topic, weight] of Object.entries(p.topics)) {
    const newWeight = weight * factor;
    if (newWeight >= 0.01) decayed[topic] = Math.round(newWeight * 1000) / 1000;
  }
  p.topics = decayed;
  p.last_updated = _now();

  db.prepare(
    "UPDATE user_interest_profiles SET topics = ?, last_updated = ? WHERE user_id = ?",
  ).run(JSON.stringify(decayed), p.last_updated, userId);

  return { applied: true, topicCount: Object.keys(decayed).length };
}

/* ── Content Scoring ───────────────────────────────────── */

export function scoreContent(profile, content) {
  if (!profile || !profile.topics || Object.keys(profile.topics).length === 0) {
    return 0;
  }

  const contentTopics = content.topics || [];
  const contentText = (
    (content.title || "") +
    " " +
    (content.description || "")
  ).toLowerCase();

  let score = 0;
  let maxWeight = 0;

  for (const [topic, weight] of Object.entries(profile.topics)) {
    if (weight > maxWeight) maxWeight = weight;
    const topicLower = topic.toLowerCase();
    if (
      contentTopics.includes(topicLower) ||
      contentText.includes(topicLower)
    ) {
      score += weight;
    }
  }

  if (maxWeight === 0) return 0;

  // Interaction weight boost
  const iw = profile.interaction_weights || {};
  const typeBoost = iw[content.content_type] || 0;
  score += typeBoost * 0.2;

  // Normalize to [0, 1]
  const topicCount = Object.keys(profile.topics).length;
  const normalized = Math.min(1, score / (maxWeight * Math.min(topicCount, 3)));

  return Math.round(normalized * 1000) / 1000;
}

/* ── Recommendation Generation ─────────────────────────── */

export function generateRecommendations(
  db,
  userId,
  contentPool,
  { limit, minScore } = {},
) {
  const effectiveLimit = limit || DEFAULT_CONFIG.defaultLimit;
  const effectiveMinScore = minScore ?? DEFAULT_CONFIG.minScore;

  const profile = _profiles.get(userId);
  if (!profile) return { generated: 0, reason: "no_profile" };

  const scored = [];
  for (const content of contentPool) {
    const s = scoreContent(profile, content);
    if (s >= effectiveMinScore) {
      scored.push({ content, score: s });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(
    0,
    Math.min(effectiveLimit, DEFAULT_CONFIG.maxBatchSize),
  );

  const now = _now();
  const ids = [];

  for (const { content, score } of topN) {
    const id = _id();
    const reason = _buildReason(profile, content);
    const rec = {
      id,
      user_id: userId,
      content_id: content.id || content.content_id,
      content_type: content.content_type || "note",
      title: content.title || "",
      score,
      reason,
      source: "heuristic",
      status: "pending",
      feedback: null,
      created_at: now,
      viewed_at: null,
    };

    db.prepare(
      `INSERT OR REPLACE INTO content_recommendations
       (id, user_id, content_id, content_type, title, score, reason, source, status, feedback, created_at, viewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      rec.content_id,
      rec.content_type,
      rec.title,
      score,
      reason,
      "heuristic",
      "pending",
      null,
      now,
      null,
    );

    _recommendations.set(id, rec);
    if (!_userRecs.has(userId)) _userRecs.set(userId, new Set());
    _userRecs.get(userId).add(id);
    ids.push(id);
  }

  return { generated: ids.length, ids };
}

function _buildReason(profile, content) {
  const matched = [];
  const contentTopics = content.topics || [];
  const contentText = (
    (content.title || "") +
    " " +
    (content.description || "")
  ).toLowerCase();

  for (const topic of Object.keys(profile.topics)) {
    if (
      contentTopics.includes(topic.toLowerCase()) ||
      contentText.includes(topic.toLowerCase())
    ) {
      matched.push(topic);
    }
  }

  if (matched.length > 0)
    return `Matches interests: ${matched.slice(0, 3).join(", ")}`;
  return "General recommendation";
}

/* ── Recommendation CRUD ──────────────────────────────── */

export function getRecommendation(db, recId) {
  const r = _recommendations.get(recId);
  return r ? { ...r } : null;
}

export function listRecommendations(
  db,
  userId,
  { status, contentType, limit = 50, minScore } = {},
) {
  const recIds = _userRecs.get(userId);
  if (!recIds) return [];

  let recs = [...recIds].map((id) => _recommendations.get(id)).filter(Boolean);

  if (status) recs = recs.filter((r) => r.status === status);
  if (contentType) recs = recs.filter((r) => r.content_type === contentType);
  if (minScore !== undefined) recs = recs.filter((r) => r.score >= minScore);

  return recs
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

export function markViewed(db, recId) {
  const r = _recommendations.get(recId);
  if (!r) return { marked: false, reason: "not_found" };
  if (r.status === "viewed") return { marked: false, reason: "already_viewed" };

  r.status = "viewed";
  r.viewed_at = _now();

  db.prepare(
    "UPDATE content_recommendations SET status = ?, viewed_at = ? WHERE id = ?",
  ).run("viewed", r.viewed_at, recId);

  return { marked: true };
}

export function provideFeedback(db, recId, feedback) {
  const validFeedback = Object.values(FEEDBACK_VALUES);
  if (!validFeedback.includes(feedback)) {
    return { recorded: false, reason: "invalid_feedback" };
  }

  const r = _recommendations.get(recId);
  if (!r) return { recorded: false, reason: "not_found" };

  r.feedback = feedback;
  if (feedback === "dislike") r.status = "dismissed";
  if (r.status === "pending") {
    r.status = "viewed";
    r.viewed_at = r.viewed_at || _now();
  }

  db.prepare(
    "UPDATE content_recommendations SET feedback = ?, status = ?, viewed_at = ? WHERE id = ?",
  ).run(r.feedback, r.status, r.viewed_at, recId);

  return { recorded: true };
}

export function dismissRecommendation(db, recId) {
  const r = _recommendations.get(recId);
  if (!r) return { dismissed: false, reason: "not_found" };

  r.status = "dismissed";
  db.prepare("UPDATE content_recommendations SET status = ? WHERE id = ?").run(
    "dismissed",
    recId,
  );
  return { dismissed: true };
}

/* ── Stats ─────────────────────────────────────────────── */

export function getRecommendationStats(db, userId) {
  const recIds = _userRecs.get(userId);
  if (!recIds || recIds.size === 0) {
    return {
      total: 0,
      pending: 0,
      viewed: 0,
      dismissed: 0,
      feedbackCount: 0,
      feedbackRate: 0,
      avgScore: 0,
    };
  }

  let total = 0;
  let pending = 0;
  let viewed = 0;
  let dismissed = 0;
  let feedbackCount = 0;
  let scoreSum = 0;

  for (const id of recIds) {
    const r = _recommendations.get(id);
    if (!r) continue;
    total++;
    scoreSum += r.score;
    if (r.status === "pending") pending++;
    else if (r.status === "viewed") viewed++;
    else if (r.status === "dismissed") dismissed++;
    if (r.feedback) feedbackCount++;
  }

  return {
    total,
    pending,
    viewed,
    dismissed,
    feedbackCount,
    feedbackRate:
      total > 0 ? Math.round((feedbackCount / total) * 1000) / 1000 : 0,
    avgScore: total > 0 ? Math.round((scoreSum / total) * 1000) / 1000 : 0,
  };
}

/* ── Profile-Based Insights ────────────────────────────── */

export function getTopInterests(db, userId, { limit = 10 } = {}) {
  const p = _profiles.get(userId);
  if (!p) return [];

  return Object.entries(p.topics)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([topic, weight]) => ({ topic, weight }));
}

export function suggestTopics(db, userId) {
  const p = _profiles.get(userId);
  if (!p) return [];

  const recIds = _userRecs.get(userId) || new Set();
  const feedbackTopics = {};

  for (const id of recIds) {
    const r = _recommendations.get(id);
    if (!r || !r.feedback) continue;
    const reason = r.reason || "";
    const matches = reason.match(/Matches interests: (.+)/);
    if (matches) {
      for (const t of matches[1].split(", ")) {
        if (!feedbackTopics[t]) feedbackTopics[t] = { like: 0, dislike: 0 };
        if (r.feedback === "like") feedbackTopics[t].like++;
        if (r.feedback === "dislike") feedbackTopics[t].dislike++;
      }
    }
  }

  const suggestions = [];
  for (const [topic, counts] of Object.entries(feedbackTopics)) {
    if (counts.like > counts.dislike) {
      const boost = (counts.like - counts.dislike) * 0.1;
      suggestions.push({
        topic,
        action: "boost",
        amount: Math.round(boost * 1000) / 1000,
      });
    } else if (counts.dislike > counts.like) {
      suggestions.push({ topic, action: "reduce", amount: 0.1 });
    }
  }

  return suggestions;
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _profiles.clear();
  _recommendations.clear();
  _userRecs.clear();
  _seq = 0;
}

/* ═══════════════════════════════════════════════════════════════
 * Phase 48 V2 — Profile Maturity + Feed Channel Lifecycle
 * Strictly additive. Legacy surface above is preserved.
 * ═════════════════════════════════════════════════════════════ */

export const PROFILE_MATURITY_V2 = Object.freeze({
  ONBOARDING: "onboarding",
  ACTIVE: "active",
  DORMANT: "dormant",
  RETIRED: "retired",
});

export const FEED_LIFECYCLE_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

const PROFILE_TRANSITIONS_V2 = new Map([
  ["onboarding", new Set(["active", "retired"])],
  ["active", new Set(["dormant", "retired"])],
  ["dormant", new Set(["active", "retired"])],
]);
const PROFILE_TERMINALS_V2 = new Set(["retired"]);

const FEED_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "archived"])],
  ["active", new Set(["paused", "archived"])],
  ["paused", new Set(["active", "archived"])],
]);
const FEED_TERMINALS_V2 = new Set(["archived"]);

export const REC_DEFAULT_MAX_ACTIVE_PROFILES_PER_SEGMENT = 10000;
export const REC_DEFAULT_MAX_ACTIVE_FEEDS_PER_CURATOR = 20;
export const REC_DEFAULT_PROFILE_IDLE_MS = 90 * 86400000; // 90 days
export const REC_DEFAULT_FEED_STALE_MS = 30 * 86400000; // 30 days

let _maxActiveProfilesPerSegmentV2 =
  REC_DEFAULT_MAX_ACTIVE_PROFILES_PER_SEGMENT;
let _maxActiveFeedsPerCuratorV2 = REC_DEFAULT_MAX_ACTIVE_FEEDS_PER_CURATOR;
let _profileIdleMsV2 = REC_DEFAULT_PROFILE_IDLE_MS;
let _feedStaleMsV2 = REC_DEFAULT_FEED_STALE_MS;

const _profileStatesV2 = new Map(); // profileId → V2 record
const _feedStatesV2 = new Map(); // feedId → V2 record

function _positiveIntV2(n, label) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(num);
}

function _validProfileStatusV2(s) {
  return (
    s === "onboarding" || s === "active" || s === "dormant" || s === "retired"
  );
}

function _validFeedStatusV2(s) {
  return s === "draft" || s === "active" || s === "paused" || s === "archived";
}

export function getDefaultMaxActiveProfilesPerSegmentV2() {
  return REC_DEFAULT_MAX_ACTIVE_PROFILES_PER_SEGMENT;
}
export function getMaxActiveProfilesPerSegmentV2() {
  return _maxActiveProfilesPerSegmentV2;
}
export function setMaxActiveProfilesPerSegmentV2(n) {
  _maxActiveProfilesPerSegmentV2 = _positiveIntV2(
    n,
    "maxActiveProfilesPerSegment",
  );
  return _maxActiveProfilesPerSegmentV2;
}

export function getDefaultMaxActiveFeedsPerCuratorV2() {
  return REC_DEFAULT_MAX_ACTIVE_FEEDS_PER_CURATOR;
}
export function getMaxActiveFeedsPerCuratorV2() {
  return _maxActiveFeedsPerCuratorV2;
}
export function setMaxActiveFeedsPerCuratorV2(n) {
  _maxActiveFeedsPerCuratorV2 = _positiveIntV2(n, "maxActiveFeedsPerCurator");
  return _maxActiveFeedsPerCuratorV2;
}

export function getDefaultProfileIdleMsV2() {
  return REC_DEFAULT_PROFILE_IDLE_MS;
}
export function getProfileIdleMsV2() {
  return _profileIdleMsV2;
}
export function setProfileIdleMsV2(ms) {
  _profileIdleMsV2 = _positiveIntV2(ms, "profileIdleMs");
  return _profileIdleMsV2;
}

export function getDefaultFeedStaleMsV2() {
  return REC_DEFAULT_FEED_STALE_MS;
}
export function getFeedStaleMsV2() {
  return _feedStaleMsV2;
}
export function setFeedStaleMsV2(ms) {
  _feedStaleMsV2 = _positiveIntV2(ms, "feedStaleMs");
  return _feedStaleMsV2;
}

/* ── Profile V2 ─────────────────────────────────────────────── */

export function registerProfileV2(db, config = {}) {
  void db;
  const profileId = String(config.profileId || "").trim();
  if (!profileId) throw new Error("profileId is required");
  const segment = String(config.segment || "").trim();
  if (!segment) throw new Error("segment is required");
  if (_profileStatesV2.has(profileId)) {
    throw new Error(`Profile already registered in V2: ${profileId}`);
  }

  const now = Number(config.now ?? Date.now());
  const initialStatus = config.initialStatus || "onboarding";
  if (!_validProfileStatusV2(initialStatus)) {
    throw new Error(`Invalid initial status: ${initialStatus}`);
  }
  if (PROFILE_TERMINALS_V2.has(initialStatus)) {
    throw new Error(
      `Cannot register profile in terminal status '${initialStatus}'`,
    );
  }

  if (initialStatus === "active") {
    let activeCount = 0;
    for (const rec of _profileStatesV2.values()) {
      if (rec.segment === segment && rec.status === "active") {
        activeCount += 1;
      }
    }
    if (activeCount >= _maxActiveProfilesPerSegmentV2) {
      throw new Error(
        `Max active profiles per segment reached (${_maxActiveProfilesPerSegmentV2})`,
      );
    }
  }

  const record = {
    profileId,
    segment,
    ownerId: config.ownerId ? String(config.ownerId) : null,
    status: initialStatus,
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    reason: null,
  };
  _profileStatesV2.set(profileId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getProfileV2(profileId) {
  const rec = _profileStatesV2.get(String(profileId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setProfileMaturityV2(db, profileId, newStatus, patch = {}) {
  void db;
  const id = String(profileId || "");
  const record = _profileStatesV2.get(id);
  if (!record) throw new Error(`Profile not registered in V2: ${id}`);
  if (!_validProfileStatusV2(newStatus)) {
    throw new Error(`Invalid profile status: ${newStatus}`);
  }
  if (PROFILE_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Profile is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = PROFILE_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }

  if (newStatus === "active" && record.status !== "active") {
    let activeCount = 0;
    for (const rec of _profileStatesV2.values()) {
      if (rec.segment === record.segment && rec.status === "active") {
        activeCount += 1;
      }
    }
    if (activeCount >= _maxActiveProfilesPerSegmentV2) {
      throw new Error(
        `Max active profiles per segment reached (${_maxActiveProfilesPerSegmentV2})`,
      );
    }
  }

  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function activateProfile(db, profileId, reason) {
  return setProfileMaturityV2(db, profileId, "active", { reason });
}
export function dormantProfile(db, profileId, reason) {
  return setProfileMaturityV2(db, profileId, "dormant", { reason });
}
export function retireProfile(db, profileId, reason) {
  return setProfileMaturityV2(db, profileId, "retired", { reason });
}

export function touchProfileActivity(profileId) {
  const rec = _profileStatesV2.get(String(profileId || ""));
  if (!rec) throw new Error(`Profile not registered in V2: ${profileId}`);
  rec.lastActivityAt = Date.now();
  return { ...rec, metadata: { ...rec.metadata } };
}

/* ── Feed V2 ────────────────────────────────────────────────── */

export function registerFeedV2(db, config = {}) {
  void db;
  const feedId = String(config.feedId || "").trim();
  if (!feedId) throw new Error("feedId is required");
  const curatorId = String(config.curatorId || "").trim();
  if (!curatorId) throw new Error("curatorId is required");
  const name = String(config.name || "").trim();
  if (!name) throw new Error("name is required");
  if (_feedStatesV2.has(feedId)) {
    throw new Error(`Feed already registered in V2: ${feedId}`);
  }

  const now = Number(config.now ?? Date.now());
  const initialStatus = config.initialStatus || "draft";
  if (!_validFeedStatusV2(initialStatus)) {
    throw new Error(`Invalid initial status: ${initialStatus}`);
  }
  if (FEED_TERMINALS_V2.has(initialStatus)) {
    throw new Error(
      `Cannot register feed in terminal status '${initialStatus}'`,
    );
  }

  if (initialStatus === "active") {
    let activeCount = 0;
    for (const rec of _feedStatesV2.values()) {
      if (rec.curatorId === curatorId && rec.status === "active") {
        activeCount += 1;
      }
    }
    if (activeCount >= _maxActiveFeedsPerCuratorV2) {
      throw new Error(
        `Max active feeds per curator reached (${_maxActiveFeedsPerCuratorV2})`,
      );
    }
  }

  const record = {
    feedId,
    curatorId,
    name,
    topics: Array.isArray(config.topics) ? [...config.topics] : [],
    status: initialStatus,
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastPublishedAt: now,
    reason: null,
  };
  _feedStatesV2.set(feedId, record);
  return {
    ...record,
    topics: [...record.topics],
    metadata: { ...record.metadata },
  };
}

export function getFeedV2(feedId) {
  const rec = _feedStatesV2.get(String(feedId || ""));
  if (!rec) return null;
  return {
    ...rec,
    topics: [...rec.topics],
    metadata: { ...rec.metadata },
  };
}

export function setFeedStatusV2(db, feedId, newStatus, patch = {}) {
  void db;
  const id = String(feedId || "");
  const record = _feedStatesV2.get(id);
  if (!record) throw new Error(`Feed not registered in V2: ${id}`);
  if (!_validFeedStatusV2(newStatus)) {
    throw new Error(`Invalid feed status: ${newStatus}`);
  }
  if (FEED_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Feed is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = FEED_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }

  if (newStatus === "active" && record.status !== "active") {
    let activeCount = 0;
    for (const rec of _feedStatesV2.values()) {
      if (rec.curatorId === record.curatorId && rec.status === "active") {
        activeCount += 1;
      }
    }
    if (activeCount >= _maxActiveFeedsPerCuratorV2) {
      throw new Error(
        `Max active feeds per curator reached (${_maxActiveFeedsPerCuratorV2})`,
      );
    }
  }

  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return {
    ...record,
    topics: [...record.topics],
    metadata: { ...record.metadata },
  };
}

export function activateFeed(db, feedId, reason) {
  return setFeedStatusV2(db, feedId, "active", { reason });
}
export function pauseFeed(db, feedId, reason) {
  return setFeedStatusV2(db, feedId, "paused", { reason });
}
export function archiveFeed(db, feedId, reason) {
  return setFeedStatusV2(db, feedId, "archived", { reason });
}

export function touchFeedPublish(feedId) {
  const rec = _feedStatesV2.get(String(feedId || ""));
  if (!rec) throw new Error(`Feed not registered in V2: ${feedId}`);
  rec.lastPublishedAt = Date.now();
  return {
    ...rec,
    topics: [...rec.topics],
    metadata: { ...rec.metadata },
  };
}

/* ── Counts ─────────────────────────────────────────────────── */

export function getActiveProfileCount(segment) {
  let n = 0;
  for (const rec of _profileStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (segment !== undefined && rec.segment !== String(segment)) continue;
    n += 1;
  }
  return n;
}

export function getActiveFeedCount(curatorId) {
  let n = 0;
  for (const rec of _feedStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (curatorId !== undefined && rec.curatorId !== String(curatorId)) {
      continue;
    }
    n += 1;
  }
  return n;
}

/* ── Auto-flip Bulk Ops ─────────────────────────────────────── */

export function autoDormantIdleProfiles(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _profileStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (now - rec.lastActivityAt > _profileIdleMsV2) {
      rec.status = "dormant";
      rec.updatedAt = now;
      rec.reason = "idle";
      flipped.push(rec.profileId);
    }
  }
  return flipped;
}

export function autoArchiveStaleFeeds(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _feedStatesV2.values()) {
    if (rec.status !== "active" && rec.status !== "paused") continue;
    if (now - rec.lastPublishedAt > _feedStaleMsV2) {
      rec.status = "archived";
      rec.updatedAt = now;
      rec.reason = "stale";
      flipped.push(rec.feedId);
    }
  }
  return flipped;
}

/* ── Stats V2 ───────────────────────────────────────────────── */

export function getRecommendationStatsV2() {
  const profilesByStatus = {
    onboarding: 0,
    active: 0,
    dormant: 0,
    retired: 0,
  };
  const feedsByStatus = {
    draft: 0,
    active: 0,
    paused: 0,
    archived: 0,
  };
  for (const rec of _profileStatesV2.values()) {
    if (profilesByStatus[rec.status] !== undefined) {
      profilesByStatus[rec.status] += 1;
    }
  }
  for (const rec of _feedStatesV2.values()) {
    if (feedsByStatus[rec.status] !== undefined) {
      feedsByStatus[rec.status] += 1;
    }
  }
  return {
    totalProfilesV2: _profileStatesV2.size,
    totalFeedsV2: _feedStatesV2.size,
    maxActiveProfilesPerSegment: _maxActiveProfilesPerSegmentV2,
    maxActiveFeedsPerCurator: _maxActiveFeedsPerCuratorV2,
    profileIdleMs: _profileIdleMsV2,
    feedStaleMs: _feedStaleMsV2,
    profilesByStatus,
    feedsByStatus,
  };
}

/* ── Reset V2 (tests) ───────────────────────────────────────── */

export function _resetStateV2() {
  _profileStatesV2.clear();
  _feedStatesV2.clear();
  _maxActiveProfilesPerSegmentV2 = REC_DEFAULT_MAX_ACTIVE_PROFILES_PER_SEGMENT;
  _maxActiveFeedsPerCuratorV2 = REC_DEFAULT_MAX_ACTIVE_FEEDS_PER_CURATOR;
  _profileIdleMsV2 = REC_DEFAULT_PROFILE_IDLE_MS;
  _feedStaleMsV2 = REC_DEFAULT_FEED_STALE_MS;
}
