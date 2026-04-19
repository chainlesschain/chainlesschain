/**
 * BM25 search engine for CLI
 *
 * Implements Okapi BM25 ranking algorithm for keyword-based search.
 * Lightweight port of desktop-app-vue/src/main/rag/bm25-search.js
 * No external dependencies — uses simple tokenization.
 */

/**
 * Simple tokenizer for text
 * Handles both Chinese and English text
 */
function tokenize(text, language = "auto") {
  if (!text || typeof text !== "string") return [];

  const normalized = text.toLowerCase().trim();

  // Detect language
  const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
  const lang = language === "auto" ? (hasChinese ? "zh" : "en") : language;

  if (lang === "zh") {
    // Chinese: character-level + word-level bigrams
    const chars = normalized.match(/[\u4e00-\u9fff]/g) || [];
    const words = normalized.match(/[a-z0-9]+/g) || [];
    const bigrams = [];
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1]);
    }
    return [...chars, ...bigrams, ...words];
  }

  // English: word tokenization with stop word removal
  const STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "but",
    "and",
    "or",
    "not",
    "no",
    "nor",
    "so",
    "if",
    "then",
    "than",
    "too",
    "very",
    "just",
    "about",
    "up",
    "out",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "they",
    "them",
    "their",
    "what",
    "which",
  ]);

  return normalized
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * BM25 Search Engine
 */
export class BM25Search {
  /**
   * @param {object} options
   * @param {number} [options.k1=1.5] - Term frequency saturation parameter
   * @param {number} [options.b=0.75] - Length normalization parameter
   * @param {string} [options.language="auto"] - Language for tokenization
   */
  constructor(options = {}) {
    this.k1 = options.k1 || 1.5;
    this.b = options.b || 0.75;
    this.language = options.language || "auto";

    // Index state
    this.documents = []; // Array of { id, tokens, originalDoc }
    this.df = new Map(); // document frequency per term
    this.avgDl = 0; // average document length
    this.totalDocs = 0;
  }

  /**
   * Index a batch of documents
   * @param {Array<{id: string, title?: string, content?: string}>} documents
   */
  indexDocuments(documents) {
    this.documents = [];
    this.df = new Map();

    for (const doc of documents) {
      const text = [doc.title || "", doc.content || ""].join(" ");
      const tokens = tokenize(text, this.language);

      this.documents.push({
        id: doc.id,
        tokens,
        originalDoc: doc,
      });

      // Count document frequency
      const seen = new Set();
      for (const token of tokens) {
        if (!seen.has(token)) {
          seen.add(token);
          this.df.set(token, (this.df.get(token) || 0) + 1);
        }
      }
    }

    this.totalDocs = this.documents.length;
    this.avgDl =
      this.totalDocs > 0
        ? this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
          this.totalDocs
        : 0;
  }

  /**
   * Add a single document to the index
   */
  addDocument(doc) {
    const text = [doc.title || "", doc.content || ""].join(" ");
    const tokens = tokenize(text, this.language);

    this.documents.push({
      id: doc.id,
      tokens,
      originalDoc: doc,
    });

    const seen = new Set();
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        this.df.set(token, (this.df.get(token) || 0) + 1);
      }
    }

    this.totalDocs = this.documents.length;
    this.avgDl =
      this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
      this.totalDocs;
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId) {
    const idx = this.documents.findIndex((d) => d.id === docId);
    if (idx === -1) return false;

    const doc = this.documents[idx];
    const seen = new Set();
    for (const token of doc.tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        const count = this.df.get(token) || 0;
        if (count <= 1) {
          this.df.delete(token);
        } else {
          this.df.set(token, count - 1);
        }
      }
    }

    this.documents.splice(idx, 1);
    this.totalDocs = this.documents.length;
    this.avgDl =
      this.totalDocs > 0
        ? this.documents.reduce((sum, d) => sum + d.tokens.length, 0) /
          this.totalDocs
        : 0;

    return true;
  }

  /**
   * Search for documents matching a query
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.topK=10]
   * @param {number} [options.threshold=0]
   * @returns {Array<{id: string, score: number, doc: object}>}
   */
  search(query, options = {}) {
    const topK = options.topK || 10;
    const threshold = options.threshold || 0;

    if (this.totalDocs === 0) return [];

    const queryTokens = tokenize(query, this.language);
    if (queryTokens.length === 0) return [];

    const scores = [];

    for (let i = 0; i < this.documents.length; i++) {
      const score = this._calculateBM25(queryTokens, i);
      if (score > threshold) {
        scores.push({
          id: this.documents[i].id,
          score,
          doc: this.documents[i].originalDoc,
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * Calculate BM25 score for a document
   */
  _calculateBM25(queryTokens, docIdx) {
    const doc = this.documents[docIdx];
    const dl = doc.tokens.length;
    let score = 0;

    // Build term frequency map for this document
    const tf = new Map();
    for (const token of doc.tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    for (const term of queryTokens) {
      const termFreq = tf.get(term) || 0;
      if (termFreq === 0) continue;

      const docFreq = this.df.get(term) || 0;
      if (docFreq === 0) continue;

      // IDF component
      const idf = Math.log(
        (this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1,
      );

      // TF component with length normalization
      const avgDl = this.avgDl || 1;
      const tfNorm =
        (termFreq * (this.k1 + 1)) /
        (termFreq + this.k1 * (1 - this.b + this.b * (dl / avgDl)));

      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      totalDocuments: this.totalDocs,
      uniqueTerms: this.df.size,
      avgDocumentLength: Math.round(this.avgDl),
    };
  }
}


// =====================================================================
// BM25 Search V2 governance overlay
// =====================================================================
export const BM25_PROFILE_MATURITY_V2 = Object.freeze({ PENDING: "pending", ACTIVE: "active", STALE: "stale", ARCHIVED: "archived" });
export const BM25_QUERY_LIFECYCLE_V2 = Object.freeze({ QUEUED: "queued", SEARCHING: "searching", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled" });
const _bm25PTrans = new Map([
  [BM25_PROFILE_MATURITY_V2.PENDING, new Set([BM25_PROFILE_MATURITY_V2.ACTIVE, BM25_PROFILE_MATURITY_V2.ARCHIVED])],
  [BM25_PROFILE_MATURITY_V2.ACTIVE, new Set([BM25_PROFILE_MATURITY_V2.STALE, BM25_PROFILE_MATURITY_V2.ARCHIVED])],
  [BM25_PROFILE_MATURITY_V2.STALE, new Set([BM25_PROFILE_MATURITY_V2.ACTIVE, BM25_PROFILE_MATURITY_V2.ARCHIVED])],
  [BM25_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _bm25PTerminal = new Set([BM25_PROFILE_MATURITY_V2.ARCHIVED]);
const _bm25JTrans = new Map([
  [BM25_QUERY_LIFECYCLE_V2.QUEUED, new Set([BM25_QUERY_LIFECYCLE_V2.SEARCHING, BM25_QUERY_LIFECYCLE_V2.CANCELLED])],
  [BM25_QUERY_LIFECYCLE_V2.SEARCHING, new Set([BM25_QUERY_LIFECYCLE_V2.COMPLETED, BM25_QUERY_LIFECYCLE_V2.FAILED, BM25_QUERY_LIFECYCLE_V2.CANCELLED])],
  [BM25_QUERY_LIFECYCLE_V2.COMPLETED, new Set()],
  [BM25_QUERY_LIFECYCLE_V2.FAILED, new Set()],
  [BM25_QUERY_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _bm25PsV2 = new Map();
const _bm25JsV2 = new Map();
let _bm25MaxActive = 8, _bm25MaxPending = 20, _bm25IdleMs = 30 * 24 * 60 * 60 * 1000, _bm25StuckMs = 30 * 1000;
function _bm25Pos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _bm25CheckP(from, to) { const a = _bm25PTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid bm25 profile transition ${from} → ${to}`); }
function _bm25CheckJ(from, to) { const a = _bm25JTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid bm25 query transition ${from} → ${to}`); }
function _bm25CountActive(owner) { let c = 0; for (const p of _bm25PsV2.values()) if (p.owner === owner && p.status === BM25_PROFILE_MATURITY_V2.ACTIVE) c++; return c; }
function _bm25CountPending(profileId) { let c = 0; for (const j of _bm25JsV2.values()) if (j.profileId === profileId && (j.status === BM25_QUERY_LIFECYCLE_V2.QUEUED || j.status === BM25_QUERY_LIFECYCLE_V2.SEARCHING)) c++; return c; }
export function setMaxActiveBm25ProfilesPerOwnerV2(n) { _bm25MaxActive = _bm25Pos(n, "maxActiveBm25ProfilesPerOwner"); }
export function getMaxActiveBm25ProfilesPerOwnerV2() { return _bm25MaxActive; }
export function setMaxPendingBm25QueriesPerProfileV2(n) { _bm25MaxPending = _bm25Pos(n, "maxPendingBm25QueriesPerProfile"); }
export function getMaxPendingBm25QueriesPerProfileV2() { return _bm25MaxPending; }
export function setBm25ProfileIdleMsV2(n) { _bm25IdleMs = _bm25Pos(n, "bm25ProfileIdleMs"); }
export function getBm25ProfileIdleMsV2() { return _bm25IdleMs; }
export function setBm25QueryStuckMsV2(n) { _bm25StuckMs = _bm25Pos(n, "bm25QueryStuckMs"); }
export function getBm25QueryStuckMsV2() { return _bm25StuckMs; }
export function _resetStateBm25SearchV2() { _bm25PsV2.clear(); _bm25JsV2.clear(); _bm25MaxActive = 8; _bm25MaxPending = 20; _bm25IdleMs = 30 * 24 * 60 * 60 * 1000; _bm25StuckMs = 30 * 1000; }
export function registerBm25ProfileV2({ id, owner, field, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_bm25PsV2.has(id)) throw new Error(`bm25 profile ${id} already exists`);
  const now = Date.now();
  const p = { id, owner, field: field || "content", status: BM25_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, lastTouchedAt: now, activatedAt: null, archivedAt: null, metadata: { ...(metadata || {}) } };
  _bm25PsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
export function activateBm25ProfileV2(id) {
  const p = _bm25PsV2.get(id); if (!p) throw new Error(`bm25 profile ${id} not found`);
  const isInitial = p.status === BM25_PROFILE_MATURITY_V2.PENDING;
  _bm25CheckP(p.status, BM25_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _bm25CountActive(p.owner) >= _bm25MaxActive) throw new Error(`max active bm25 profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = BM25_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleBm25ProfileV2(id) { const p = _bm25PsV2.get(id); if (!p) throw new Error(`bm25 profile ${id} not found`); _bm25CheckP(p.status, BM25_PROFILE_MATURITY_V2.STALE); p.status = BM25_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveBm25ProfileV2(id) { const p = _bm25PsV2.get(id); if (!p) throw new Error(`bm25 profile ${id} not found`); _bm25CheckP(p.status, BM25_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = BM25_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchBm25ProfileV2(id) { const p = _bm25PsV2.get(id); if (!p) throw new Error(`bm25 profile ${id} not found`); if (_bm25PTerminal.has(p.status)) throw new Error(`cannot touch terminal bm25 profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getBm25ProfileV2(id) { const p = _bm25PsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listBm25ProfilesV2() { return [..._bm25PsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
export function createBm25QueryV2({ id, profileId, q, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_bm25JsV2.has(id)) throw new Error(`bm25 query ${id} already exists`);
  if (!_bm25PsV2.has(profileId)) throw new Error(`bm25 profile ${profileId} not found`);
  if (_bm25CountPending(profileId) >= _bm25MaxPending) throw new Error(`max pending bm25 queries for profile ${profileId} reached`);
  const now = Date.now();
  const j = { id, profileId, q: q || "", status: BM25_QUERY_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _bm25JsV2.set(id, j); return { ...j, metadata: { ...j.metadata } };
}
export function searchingBm25QueryV2(id) { const j = _bm25JsV2.get(id); if (!j) throw new Error(`bm25 query ${id} not found`); _bm25CheckJ(j.status, BM25_QUERY_LIFECYCLE_V2.SEARCHING); const now = Date.now(); j.status = BM25_QUERY_LIFECYCLE_V2.SEARCHING; j.updatedAt = now; if (!j.startedAt) j.startedAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function completeBm25QueryV2(id) { const j = _bm25JsV2.get(id); if (!j) throw new Error(`bm25 query ${id} not found`); _bm25CheckJ(j.status, BM25_QUERY_LIFECYCLE_V2.COMPLETED); const now = Date.now(); j.status = BM25_QUERY_LIFECYCLE_V2.COMPLETED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function failBm25QueryV2(id, reason) { const j = _bm25JsV2.get(id); if (!j) throw new Error(`bm25 query ${id} not found`); _bm25CheckJ(j.status, BM25_QUERY_LIFECYCLE_V2.FAILED); const now = Date.now(); j.status = BM25_QUERY_LIFECYCLE_V2.FAILED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.failReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function cancelBm25QueryV2(id, reason) { const j = _bm25JsV2.get(id); if (!j) throw new Error(`bm25 query ${id} not found`); _bm25CheckJ(j.status, BM25_QUERY_LIFECYCLE_V2.CANCELLED); const now = Date.now(); j.status = BM25_QUERY_LIFECYCLE_V2.CANCELLED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.cancelReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function getBm25QueryV2(id) { const j = _bm25JsV2.get(id); if (!j) return null; return { ...j, metadata: { ...j.metadata } }; }
export function listBm25QueriesV2() { return [..._bm25JsV2.values()].map((j) => ({ ...j, metadata: { ...j.metadata } })); }
export function autoStaleIdleBm25ProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _bm25PsV2.values()) if (p.status === BM25_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _bm25IdleMs) { p.status = BM25_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckBm25QueriesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const j of _bm25JsV2.values()) if (j.status === BM25_QUERY_LIFECYCLE_V2.SEARCHING && j.startedAt != null && (t - j.startedAt) >= _bm25StuckMs) { j.status = BM25_QUERY_LIFECYCLE_V2.FAILED; j.updatedAt = t; if (!j.settledAt) j.settledAt = t; j.metadata.failReason = "auto-fail-stuck"; flipped.push(j.id); } return { flipped, count: flipped.length }; }
export function getBm25SearchGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(BM25_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _bm25PsV2.values()) profilesByStatus[p.status]++;
  const queriesByStatus = {}; for (const v of Object.values(BM25_QUERY_LIFECYCLE_V2)) queriesByStatus[v] = 0; for (const j of _bm25JsV2.values()) queriesByStatus[j.status]++;
  return { totalBm25ProfilesV2: _bm25PsV2.size, totalBm25QueriesV2: _bm25JsV2.size, maxActiveBm25ProfilesPerOwner: _bm25MaxActive, maxPendingBm25QueriesPerProfile: _bm25MaxPending, bm25ProfileIdleMs: _bm25IdleMs, bm25QueryStuckMs: _bm25StuckMs, profilesByStatus, queriesByStatus };
}
