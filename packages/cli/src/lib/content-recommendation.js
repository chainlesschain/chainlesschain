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
