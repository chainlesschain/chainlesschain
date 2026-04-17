/**
 * Protocol Fusion & AI Social Enhancement — CLI port of Phase 72-73
 * (docs/design/modules/40_协议融合系统.md).
 *
 * Desktop uses live DID/ActivityPub/Nostr/Matrix bridges, real-time
 * AI translation via LLM, and ML-based content quality assessment.
 * CLI port ships:
 *
 *   - Unified message CRUD (cross-protocol message routing simulation)
 *   - Identity mapping (DID ↔ ActivityPub ↔ Nostr ↔ Matrix)
 *   - Translation cache (simulated AI translation with caching)
 *   - Content quality scoring (heuristic quality assessment)
 *
 * What does NOT port: real protocol bridges, live LLM translation,
 * ML content classifiers, real-time WebSocket feeds.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const PROTOCOL = Object.freeze({
  DID: "did",
  ACTIVITYPUB: "activitypub",
  NOSTR: "nostr",
  MATRIX: "matrix",
});

export const QUALITY_LEVEL = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  HARMFUL: "harmful",
});

/* ── State ─────────────────────────────────────────────── */

let _messages = new Map();
let _identities = new Map();
let _qualityScores = new Map();
let _translationCache = new Map();

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

export function ensureProtocolFusionTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS unified_messages (
    id TEXT PRIMARY KEY,
    source_protocol TEXT NOT NULL,
    target_protocol TEXT,
    sender_id TEXT,
    content TEXT,
    unified_format TEXT,
    converted INTEGER DEFAULT 0,
    routed INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS identity_mappings (
    id TEXT PRIMARY KEY,
    did_id TEXT,
    activitypub_id TEXT,
    nostr_pubkey TEXT,
    matrix_id TEXT,
    verified INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS content_quality_scores (
    id TEXT PRIMARY KEY,
    content_id TEXT,
    content_hash TEXT,
    quality_level TEXT,
    quality_score REAL,
    harmful_detected INTEGER DEFAULT 0,
    categories TEXT,
    reviewer_count INTEGER DEFAULT 0,
    consensus_reached INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS translation_cache (
    id TEXT PRIMARY KEY,
    source_text TEXT,
    source_lang TEXT,
    target_lang TEXT,
    translated_text TEXT,
    model_used TEXT,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _messages.clear();
  _identities.clear();
  _qualityScores.clear();
  _translationCache.clear();

  const tables = [
    ["unified_messages", _messages],
    ["identity_mappings", _identities],
    ["content_quality_scores", _qualityScores],
    ["translation_cache", _translationCache],
  ];
  for (const [table, map] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r.id, r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Phase 72: Protocol Fusion Bridge ────────────────────── */

const VALID_PROTOCOLS = new Set(Object.values(PROTOCOL));

export function sendMessage(
  db,
  { sourceProtocol, targetProtocol, senderId, content } = {},
) {
  if (!sourceProtocol || !VALID_PROTOCOLS.has(sourceProtocol))
    return { messageId: null, reason: "invalid_source_protocol" };
  if (targetProtocol && !VALID_PROTOCOLS.has(targetProtocol))
    return { messageId: null, reason: "invalid_target_protocol" };
  if (!content) return { messageId: null, reason: "missing_content" };

  const id = _id();
  const now = _now();

  // Simulated format conversion
  const unified = JSON.stringify({
    protocol: sourceProtocol,
    sender: senderId,
    body: content,
    ts: now,
  });
  const converted = targetProtocol && targetProtocol !== sourceProtocol ? 1 : 0;
  const routed = targetProtocol ? 1 : 0;

  const msg = {
    id,
    source_protocol: sourceProtocol,
    target_protocol: targetProtocol || null,
    sender_id: senderId || null,
    content,
    unified_format: unified,
    converted,
    routed,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO unified_messages (id, source_protocol, target_protocol, sender_id, content, unified_format, converted, routed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    msg.source_protocol,
    msg.target_protocol,
    msg.sender_id,
    content,
    unified,
    converted,
    routed,
    now,
  );

  _messages.set(id, msg);
  return { messageId: id, converted: !!converted, routed: !!routed };
}

export function getMessage(db, id) {
  const m = _messages.get(id);
  return m ? { ...m } : null;
}

export function listMessages(db, { protocol, limit = 50 } = {}) {
  let msgs = [..._messages.values()];
  if (protocol)
    msgs = msgs.filter(
      (m) => m.source_protocol === protocol || m.target_protocol === protocol,
    );
  return msgs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

/* ── Identity Mapping ────────────────────────────────────── */

export function mapIdentity(
  db,
  { didId, activitypubId, nostrPubkey, matrixId } = {},
) {
  if (!didId && !activitypubId && !nostrPubkey && !matrixId)
    return { mappingId: null, reason: "at_least_one_identity_required" };

  const id = _id();
  const now = _now();

  const mapping = {
    id,
    did_id: didId || null,
    activitypub_id: activitypubId || null,
    nostr_pubkey: nostrPubkey || null,
    matrix_id: matrixId || null,
    verified: 0,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO identity_mappings (id, did_id, activitypub_id, nostr_pubkey, matrix_id, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    mapping.did_id,
    mapping.activitypub_id,
    mapping.nostr_pubkey,
    mapping.matrix_id,
    0,
    now,
  );

  _identities.set(id, mapping);
  return { mappingId: id };
}

export function getIdentityMap(db, didId) {
  for (const m of _identities.values()) {
    if (m.did_id === didId) return { ...m };
  }
  return null;
}

export function getIdentityById(db, id) {
  const m = _identities.get(id);
  return m ? { ...m } : null;
}

export function listIdentities(db, { limit = 50 } = {}) {
  return [..._identities.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

export function verifyIdentity(db, id) {
  const m = _identities.get(id);
  if (!m) return { verified: false, reason: "not_found" };
  m.verified = 1;
  db.prepare("UPDATE identity_mappings SET verified = 1 WHERE id = ?").run(id);
  return { verified: true };
}

/* ── Phase 73: Content Quality Assessment ────────────────── */

const HARMFUL_KEYWORDS = [
  "spam",
  "scam",
  "phishing",
  "malware",
  "exploit",
  "hack",
  "injection",
];

export function assessQuality(db, contentId, content) {
  if (!content) return { scoreId: null, reason: "missing_content" };

  const id = _id();
  const now = _now();
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  // Heuristic quality scoring
  const len = content.length;
  let score = 0.5;

  // Length factor
  if (len > 200) score += 0.2;
  else if (len > 50) score += 0.1;
  else if (len < 10) score -= 0.2;

  // Diversity factor (unique chars ratio)
  const uniqueChars = new Set(content.toLowerCase()).size;
  const diversity = uniqueChars / Math.min(len, 100);
  score += diversity * 0.2;

  // Harmful content detection
  const lower = content.toLowerCase();
  const harmful = HARMFUL_KEYWORDS.some((kw) => lower.includes(kw));
  if (harmful) score = Math.min(score, 0.2);

  score = Math.max(0, Math.min(1, score));

  let level;
  if (harmful) level = "harmful";
  else if (score >= 0.7) level = "high";
  else if (score >= 0.4) level = "medium";
  else level = "low";

  const categories = harmful ? "harmful_content" : "general";

  const entry = {
    id,
    content_id: contentId || hash.slice(0, 16),
    content_hash: hash,
    quality_level: level,
    quality_score: Math.round(score * 100) / 100,
    harmful_detected: harmful ? 1 : 0,
    categories,
    reviewer_count: 1,
    consensus_reached: 1,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO content_quality_scores (id, content_id, content_hash, quality_level, quality_score, harmful_detected, categories, reviewer_count, consensus_reached, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.content_id,
    entry.content_hash,
    entry.quality_level,
    entry.quality_score,
    entry.harmful_detected,
    entry.categories,
    entry.reviewer_count,
    entry.consensus_reached,
    now,
  );

  _qualityScores.set(id, entry);
  return {
    scoreId: id,
    level,
    score: entry.quality_score,
    harmful,
  };
}

export function getQualityScore(db, id) {
  const s = _qualityScores.get(id);
  return s ? { ...s } : null;
}

export function listQualityScores(db, { level, limit = 50 } = {}) {
  let scores = [..._qualityScores.values()];
  if (level) scores = scores.filter((s) => s.quality_level === level);
  return scores
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((s) => ({ ...s }));
}

export function getQualityReport(db) {
  const scores = [..._qualityScores.values()];
  const total = scores.length;
  const byLevel = {};
  for (const l of Object.values(QUALITY_LEVEL)) {
    byLevel[l] = scores.filter((s) => s.quality_level === l).length;
  }
  const avgScore =
    total > 0
      ? Math.round(
          (scores.reduce((s, e) => s + e.quality_score, 0) / total) * 100,
        ) / 100
      : 0;
  const harmful = scores.filter((s) => s.harmful_detected).length;

  return { total, byLevel, avgScore, harmful };
}

/* ── Phase 73: Translation ───────────────────────────────── */

const SUPPORTED_LANGS = [
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "ru",
  "ar",
  "pt",
];

export function translateMessage(db, { text, sourceLang, targetLang } = {}) {
  if (!text) return { translatedText: null, reason: "missing_text" };
  if (!targetLang)
    return { translatedText: null, reason: "missing_target_lang" };

  const src = sourceLang || "auto";

  // Check cache
  for (const c of _translationCache.values()) {
    if (
      c.source_text === text &&
      c.source_lang === src &&
      c.target_lang === targetLang
    ) {
      return { translatedText: c.translated_text, cached: true };
    }
  }

  // Simulated translation (prefix with target lang tag)
  const translated = `[${targetLang}] ${text}`;

  const id = _id();
  const now = _now();
  const entry = {
    id,
    source_text: text,
    source_lang: src,
    target_lang: targetLang,
    translated_text: translated,
    model_used: "simulated",
    created_at: now,
  };

  db.prepare(
    `INSERT INTO translation_cache (id, source_text, source_lang, target_lang, translated_text, model_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, text, src, targetLang, translated, "simulated", now);

  _translationCache.set(id, entry);
  return { translatedText: translated, cached: false };
}

export function detectLanguage(text) {
  if (!text) return { lang: null, reason: "missing_text" };

  // Simple heuristic language detection
  const cjkPattern = /[\u4e00-\u9fff]/;
  const jpPattern = /[\u3040-\u309f\u30a0-\u30ff]/;
  const krPattern = /[\uac00-\ud7af]/;
  const arPattern = /[\u0600-\u06ff]/;
  const cyPattern = /[\u0400-\u04ff]/;

  let lang = "en";
  let confidence = 0.6;

  if (jpPattern.test(text)) {
    lang = "ja";
    confidence = 0.85;
  } else if (cjkPattern.test(text)) {
    lang = "zh";
    confidence = 0.85;
  } else if (krPattern.test(text)) {
    lang = "ko";
    confidence = 0.85;
  } else if (arPattern.test(text)) {
    lang = "ar";
    confidence = 0.85;
  } else if (cyPattern.test(text)) {
    lang = "ru";
    confidence = 0.8;
  } else {
    // Default to English for Latin script
    lang = "en";
    confidence = 0.7;
  }

  return { lang, confidence };
}

export function getTranslationStats(db) {
  const cache = [..._translationCache.values()];
  const langs = new Set();
  for (const c of cache) {
    langs.add(c.source_lang);
    langs.add(c.target_lang);
  }
  return {
    total: cache.length,
    languages: [...langs].sort(),
    cacheSize: cache.length,
  };
}

/* ── Stats ─────────────────────────────────────────────── */

export function getProtocolFusionStats(db) {
  const msgs = [..._messages.values()];
  const ids = [..._identities.values()];
  const scores = [..._qualityScores.values()];
  const cache = [..._translationCache.values()];

  return {
    messages: {
      total: msgs.length,
      converted: msgs.filter((m) => m.converted).length,
      routed: msgs.filter((m) => m.routed).length,
      byProtocol: msgs.reduce((acc, m) => {
        acc[m.source_protocol] = (acc[m.source_protocol] || 0) + 1;
        return acc;
      }, {}),
    },
    identities: {
      total: ids.length,
      verified: ids.filter((i) => i.verified).length,
    },
    quality: getQualityReport(db),
    translations: getTranslationStats(db),
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _messages.clear();
  _identities.clear();
  _qualityScores.clear();
  _translationCache.clear();
}
