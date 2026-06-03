/**
 * CLI Content Recommender — tool similarity, chain detection, and skill matching.
 *
 * Uses TF-IDF for tool feature extraction and cosine similarity,
 * plus sequential chain frequency for next-tool prediction.
 * BM25 for skill recommendation.
 */

import { BM25Search } from "./bm25-search.js";

// Exported for test injection
export const _deps = {
  BM25Search,
};

export class CLIContentRecommender {
  constructor() {
    this._toolFeatures = new Map(); // tool → feature vector
    this._toolUsageLog = []; // sequential tool usage log
    this._chainFrequency = new Map(); // "toolA→toolB" → count
    this._skillIndex = null;
    this._vocabulary = new Set();
  }

  /**
   * Build TF-IDF feature vectors for tools.
   * @param {Array<{ name: string, description: string }>} tools
   */
  buildToolFeatures(tools) {
    if (!tools || tools.length === 0) return;

    this._vocabulary = new Set();
    const docTokens = [];

    // Tokenize each tool description
    for (const tool of tools) {
      const text = `${tool.name} ${tool.description || ""}`.toLowerCase();
      const tokens = text.split(/\W+/).filter((t) => t.length > 2);
      docTokens.push({ name: tool.name, tokens });
      for (const t of tokens) this._vocabulary.add(t);
    }

    // Calculate TF-IDF
    const N = docTokens.length;
    const df = new Map(); // term → doc frequency

    for (const { tokens } of docTokens) {
      const unique = new Set(tokens);
      for (const t of unique) {
        df.set(t, (df.get(t) || 0) + 1);
      }
    }

    for (const { name, tokens } of docTokens) {
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      const vector = new Map();
      for (const [term, count] of tf) {
        const idf = Math.log(N / (df.get(term) || 1));
        vector.set(term, (count / tokens.length) * idf);
      }

      this._toolFeatures.set(name, vector);
    }
  }

  /**
   * Calculate cosine similarity between two tools.
   */
  calculateSimilarity(tool1, tool2) {
    const v1 = this._toolFeatures.get(tool1);
    const v2 = this._toolFeatures.get(tool2);
    if (!v1 || !v2) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const [term, val] of v1) {
      norm1 += val * val;
      if (v2.has(term)) {
        dotProduct += val * v2.get(term);
      }
    }
    for (const [, val] of v2) {
      norm2 += val * val;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Record a tool usage for chain detection.
   */
  recordToolUse(toolName, context = {}) {
    const entry = {
      tool: toolName,
      timestamp: Date.now(),
      context: context.query || "",
    };
    this._toolUsageLog.push(entry);

    // Update chain frequency (look at previous tool)
    if (this._toolUsageLog.length >= 2) {
      const prev = this._toolUsageLog[this._toolUsageLog.length - 2];
      const key = `${prev.tool}→${toolName}`;
      this._chainFrequency.set(key, (this._chainFrequency.get(key) || 0) + 1);
    }

    // Keep log bounded
    if (this._toolUsageLog.length > 1000) {
      this._toolUsageLog = this._toolUsageLog.slice(-500);
    }
  }

  /**
   * Recommend next tool based on usage chains.
   * @returns {Array<{ tool: string, confidence: number }>}
   */
  recommendNextTool(currentTool, _context = {}) {
    const candidates = [];
    let totalFromCurrent = 0;

    for (const [key, count] of this._chainFrequency) {
      if (key.startsWith(`${currentTool}→`)) {
        const nextTool = key.split("→")[1];
        candidates.push({ tool: nextTool, count });
        totalFromCurrent += count;
      }
    }

    if (totalFromCurrent === 0) return [];

    return candidates
      .map((c) => ({
        tool: c.tool,
        confidence: Math.round((c.count / totalFromCurrent) * 100) / 100,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * Recommend a skill based on user query using BM25.
   * @param {string} userQuery
   * @param {Array<{ id: string, description: string, category: string }>} skills
   */
  recommendSkill(userQuery, skills) {
    if (!userQuery || !skills || skills.length === 0) return [];

    // Build BM25 index
    const bm25 = new _deps.BM25Search();
    const docs = skills.map((s) => ({
      id: s.id,
      title: s.id,
      content: `${s.id} ${s.description || ""} ${s.category || ""}`,
    }));
    bm25.indexDocuments(docs);

    const results = bm25.search(userQuery, { topK: 5, threshold: 0.1 });
    return results.map((r) => ({
      skillId: r.doc.id,
      score: r.score,
    }));
  }

  /**
   * Get chain statistics.
   */
  getChainStats() {
    const chains = [...this._chainFrequency.entries()]
      .map(([key, count]) => ({ chain: key, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalUsages: this._toolUsageLog.length,
      uniqueChains: chains.length,
      topChains: chains.slice(0, 10),
    };
  }

  /**
   * Get tool similarity matrix.
   */
  getSimilarityMatrix() {
    const tools = [...this._toolFeatures.keys()];
    const matrix = {};

    for (const t1 of tools) {
      matrix[t1] = {};
      for (const t2 of tools) {
        if (t1 !== t2) {
          matrix[t1][t2] =
            Math.round(this.calculateSimilarity(t1, t2) * 1000) / 1000;
        }
      }
    }

    return matrix;
  }
}

// ===== V2 Surface: Content Recommender governance overlay (CLI v0.139.0) =====
export const RECOMMENDER_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const RECOMMENDATION_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _crpTrans = new Map([
  [
    RECOMMENDER_PROFILE_MATURITY_V2.PENDING,
    new Set([
      RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE,
      RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      RECOMMENDER_PROFILE_MATURITY_V2.STALE,
      RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    RECOMMENDER_PROFILE_MATURITY_V2.STALE,
    new Set([
      RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE,
      RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _crpTerminal = new Set([RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED]);
const _crjTrans = new Map([
  [
    RECOMMENDATION_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING,
      RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      RECOMMENDATION_JOB_LIFECYCLE_V2.COMPLETED,
      RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED,
      RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [RECOMMENDATION_JOB_LIFECYCLE_V2.COMPLETED, new Set()],
  [RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _crpsV2 = new Map();
const _crjsV2 = new Map();
let _crpMaxActivePerOwner = 8;
let _crpMaxPendingJobsPerProfile = 10;
let _crpIdleMs = 7 * 24 * 60 * 60 * 1000;
let _crjStuckMs = 5 * 60 * 1000;

function _crpPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveRecommenderProfilesPerOwnerV2(n) {
  _crpMaxActivePerOwner = _crpPos(n, "maxActiveRecommenderProfilesPerOwner");
}
export function getMaxActiveRecommenderProfilesPerOwnerV2() {
  return _crpMaxActivePerOwner;
}
export function setMaxPendingRecommendationJobsPerProfileV2(n) {
  _crpMaxPendingJobsPerProfile = _crpPos(
    n,
    "maxPendingRecommendationJobsPerProfile",
  );
}
export function getMaxPendingRecommendationJobsPerProfileV2() {
  return _crpMaxPendingJobsPerProfile;
}
export function setRecommenderProfileIdleMsV2(n) {
  _crpIdleMs = _crpPos(n, "recommenderProfileIdleMs");
}
export function getRecommenderProfileIdleMsV2() {
  return _crpIdleMs;
}
export function setRecommendationJobStuckMsV2(n) {
  _crjStuckMs = _crpPos(n, "recommendationJobStuckMs");
}
export function getRecommendationJobStuckMsV2() {
  return _crjStuckMs;
}

export function _resetStateContentRecommenderV2() {
  _crpsV2.clear();
  _crjsV2.clear();
  _crpMaxActivePerOwner = 8;
  _crpMaxPendingJobsPerProfile = 10;
  _crpIdleMs = 7 * 24 * 60 * 60 * 1000;
  _crjStuckMs = 5 * 60 * 1000;
}

export function registerRecommenderProfileV2({
  id,
  owner,
  strategy,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_crpsV2.has(id))
    throw new Error(`recommender profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    strategy: strategy || "tfidf",
    status: RECOMMENDER_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _crpsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _crpCheckP(from, to) {
  const a = _crpTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid recommender profile transition ${from} → ${to}`);
}
function _crpCountActive(owner) {
  let n = 0;
  for (const p of _crpsV2.values())
    if (
      p.owner === owner &&
      p.status === RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE
    )
      n++;
  return n;
}

export function activateRecommenderProfileV2(id) {
  const p = _crpsV2.get(id);
  if (!p) throw new Error(`recommender profile ${id} not found`);
  _crpCheckP(p.status, RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === RECOMMENDER_PROFILE_MATURITY_V2.STALE;
  if (!recovery) {
    const c = _crpCountActive(p.owner);
    if (c >= _crpMaxActivePerOwner)
      throw new Error(
        `max active recommender profiles per owner (${_crpMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleRecommenderProfileV2(id) {
  const p = _crpsV2.get(id);
  if (!p) throw new Error(`recommender profile ${id} not found`);
  _crpCheckP(p.status, RECOMMENDER_PROFILE_MATURITY_V2.STALE);
  p.status = RECOMMENDER_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveRecommenderProfileV2(id) {
  const p = _crpsV2.get(id);
  if (!p) throw new Error(`recommender profile ${id} not found`);
  _crpCheckP(p.status, RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = RECOMMENDER_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchRecommenderProfileV2(id) {
  const p = _crpsV2.get(id);
  if (!p) throw new Error(`recommender profile ${id} not found`);
  if (_crpTerminal.has(p.status))
    throw new Error(`cannot touch terminal recommender profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getRecommenderProfileV2(id) {
  const p = _crpsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listRecommenderProfilesV2() {
  return [..._crpsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _crjCountPending(profileId) {
  let n = 0;
  for (const j of _crjsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === RECOMMENDATION_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createRecommendationJobV2({
  id,
  profileId,
  query,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_crjsV2.has(id))
    throw new Error(`recommendation job ${id} already exists`);
  if (!_crpsV2.has(profileId))
    throw new Error(`recommender profile ${profileId} not found`);
  const pending = _crjCountPending(profileId);
  if (pending >= _crpMaxPendingJobsPerProfile)
    throw new Error(
      `max pending recommendation jobs per profile (${_crpMaxPendingJobsPerProfile}) reached for ${profileId}`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    query: query || "",
    status: RECOMMENDATION_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _crjsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
function _crjCheckJ(from, to) {
  const a = _crjTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid recommendation job transition ${from} → ${to}`);
}
export function startRecommendationJobV2(id) {
  const j = _crjsV2.get(id);
  if (!j) throw new Error(`recommendation job ${id} not found`);
  _crjCheckJ(j.status, RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRecommendationJobV2(id) {
  const j = _crjsV2.get(id);
  if (!j) throw new Error(`recommendation job ${id} not found`);
  _crjCheckJ(j.status, RECOMMENDATION_JOB_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = RECOMMENDATION_JOB_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failRecommendationJobV2(id, reason) {
  const j = _crjsV2.get(id);
  if (!j) throw new Error(`recommendation job ${id} not found`);
  _crjCheckJ(j.status, RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelRecommendationJobV2(id, reason) {
  const j = _crjsV2.get(id);
  if (!j) throw new Error(`recommendation job ${id} not found`);
  _crjCheckJ(j.status, RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = RECOMMENDATION_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getRecommendationJobV2(id) {
  const j = _crjsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listRecommendationJobsV2() {
  return [..._crjsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}

export function autoStaleIdleRecommenderProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _crpsV2.values())
    if (
      p.status === RECOMMENDER_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _crpIdleMs
    ) {
      p.status = RECOMMENDER_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckRecommendationJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _crjsV2.values())
    if (
      j.status === RECOMMENDATION_JOB_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _crjStuckMs
    ) {
      j.status = RECOMMENDATION_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}

export function getContentRecommenderGovStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(RECOMMENDER_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _crpsV2.values()) profilesByStatus[p.status]++;
  const jobsByStatus = {};
  for (const s of Object.values(RECOMMENDATION_JOB_LIFECYCLE_V2))
    jobsByStatus[s] = 0;
  for (const j of _crjsV2.values()) jobsByStatus[j.status]++;
  return {
    totalRecommenderProfilesV2: _crpsV2.size,
    totalRecommendationJobsV2: _crjsV2.size,
    maxActiveRecommenderProfilesPerOwner: _crpMaxActivePerOwner,
    maxPendingRecommendationJobsPerProfile: _crpMaxPendingJobsPerProfile,
    recommenderProfileIdleMs: _crpIdleMs,
    recommendationJobStuckMs: _crjStuckMs,
    profilesByStatus,
    jobsByStatus,
  };
}
