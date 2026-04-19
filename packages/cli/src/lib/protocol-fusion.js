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

/* ── V2 Surface (Phase 72-73) ─────────────────────────────
 * Strictly additive. Two parallel state machines:
 *   - Bridge maturity (5 states, retired terminal)
 *   - Translation run lifecycle (5 states, 3 terminals)
 * Per-operator active-bridge cap + per-bridge running-translation cap.
 * Auto-flip: idle-bridge → retired; stuck-running translation → failed.
 */

export const BRIDGE_MATURITY_V2 = Object.freeze({
  PROVISIONAL: "provisional",
  ACTIVE: "active",
  DEGRADED: "degraded",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const TRANSLATION_RUN_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
});

const _BRIDGE_TRANSITIONS_V2 = new Map([
  [
    BRIDGE_MATURITY_V2.PROVISIONAL,
    new Set([BRIDGE_MATURITY_V2.ACTIVE, BRIDGE_MATURITY_V2.RETIRED]),
  ],
  [
    BRIDGE_MATURITY_V2.ACTIVE,
    new Set([
      BRIDGE_MATURITY_V2.DEGRADED,
      BRIDGE_MATURITY_V2.DEPRECATED,
      BRIDGE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    BRIDGE_MATURITY_V2.DEGRADED,
    new Set([
      BRIDGE_MATURITY_V2.ACTIVE,
      BRIDGE_MATURITY_V2.DEPRECATED,
      BRIDGE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    BRIDGE_MATURITY_V2.DEPRECATED,
    new Set([BRIDGE_MATURITY_V2.ACTIVE, BRIDGE_MATURITY_V2.RETIRED]),
  ],
]);
const _BRIDGE_TERMINAL_V2 = new Set([BRIDGE_MATURITY_V2.RETIRED]);

const _TRANSLATION_TRANSITIONS_V2 = new Map([
  [
    TRANSLATION_RUN_V2.QUEUED,
    new Set([
      TRANSLATION_RUN_V2.RUNNING,
      TRANSLATION_RUN_V2.CANCELED,
      TRANSLATION_RUN_V2.FAILED,
    ]),
  ],
  [
    TRANSLATION_RUN_V2.RUNNING,
    new Set([
      TRANSLATION_RUN_V2.SUCCEEDED,
      TRANSLATION_RUN_V2.FAILED,
      TRANSLATION_RUN_V2.CANCELED,
    ]),
  ],
]);
const _TRANSLATION_TERMINAL_V2 = new Set([
  TRANSLATION_RUN_V2.SUCCEEDED,
  TRANSLATION_RUN_V2.FAILED,
  TRANSLATION_RUN_V2.CANCELED,
]);

export const PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR = 10;
export const PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE = 5;
export const PF_DEFAULT_BRIDGE_IDLE_MS = 14 * 86400000;
export const PF_DEFAULT_TRANSLATION_STUCK_MS = 10 * 60000;

let _pfMaxActiveBridgesPerOperator = PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR;
let _pfMaxRunningTranslationsPerBridge =
  PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE;
let _pfBridgeIdleMs = PF_DEFAULT_BRIDGE_IDLE_MS;
let _pfTranslationStuckMs = PF_DEFAULT_TRANSLATION_STUCK_MS;

const _bridgesV2 = new Map();
const _translationsV2 = new Map();

function _positiveIntV2(n, label) {
  const f = Math.floor(n);
  if (!Number.isFinite(f) || f <= 0)
    throw new Error(`${label} must be a positive integer`);
  return f;
}

export function getMaxActiveBridgesPerOperator() {
  return _pfMaxActiveBridgesPerOperator;
}
export function setMaxActiveBridgesPerOperator(n) {
  _pfMaxActiveBridgesPerOperator = _positiveIntV2(
    n,
    "maxActiveBridgesPerOperator",
  );
  return _pfMaxActiveBridgesPerOperator;
}
export function getMaxRunningTranslationsPerBridge() {
  return _pfMaxRunningTranslationsPerBridge;
}
export function setMaxRunningTranslationsPerBridge(n) {
  _pfMaxRunningTranslationsPerBridge = _positiveIntV2(
    n,
    "maxRunningTranslationsPerBridge",
  );
  return _pfMaxRunningTranslationsPerBridge;
}
export function getBridgeIdleMs() {
  return _pfBridgeIdleMs;
}
export function setBridgeIdleMs(n) {
  _pfBridgeIdleMs = _positiveIntV2(n, "bridgeIdleMs");
  return _pfBridgeIdleMs;
}
export function getTranslationStuckMs() {
  return _pfTranslationStuckMs;
}
export function setTranslationStuckMs(n) {
  _pfTranslationStuckMs = _positiveIntV2(n, "translationStuckMs");
  return _pfTranslationStuckMs;
}

export function getActiveBridgeCount(operator) {
  let c = 0;
  for (const b of _bridgesV2.values()) {
    if (b.status === BRIDGE_MATURITY_V2.RETIRED) continue;
    if (b.status === BRIDGE_MATURITY_V2.PROVISIONAL) continue;
    if (operator !== undefined && b.operator !== operator) continue;
    c++;
  }
  return c;
}

export function getRunningTranslationCount(bridgeId) {
  let c = 0;
  for (const t of _translationsV2.values()) {
    if (t.status !== TRANSLATION_RUN_V2.RUNNING) continue;
    if (bridgeId !== undefined && t.bridgeId !== bridgeId) continue;
    c++;
  }
  return c;
}

export function registerBridgeV2({
  id,
  operator,
  sourceProtocol,
  targetProtocol,
  initialStatus,
  metadata,
} = {}) {
  if (!id) throw new Error("id required");
  if (!operator) throw new Error("operator required");
  if (!sourceProtocol || !VALID_PROTOCOLS.has(sourceProtocol))
    throw new Error("invalid sourceProtocol");
  if (!targetProtocol || !VALID_PROTOCOLS.has(targetProtocol))
    throw new Error("invalid targetProtocol");
  if (_bridgesV2.has(id)) throw new Error(`bridge ${id} already exists`);
  const status = initialStatus ?? BRIDGE_MATURITY_V2.PROVISIONAL;
  if (!Object.values(BRIDGE_MATURITY_V2).includes(status))
    throw new Error(`invalid initial status ${status}`);
  const active =
    status !== BRIDGE_MATURITY_V2.RETIRED &&
    status !== BRIDGE_MATURITY_V2.PROVISIONAL;
  if (
    active &&
    getActiveBridgeCount(operator) >= _pfMaxActiveBridgesPerOperator
  )
    throw new Error(`operator ${operator} active bridge cap reached`);
  const now = _now();
  const bridge = {
    id,
    operator,
    sourceProtocol,
    targetProtocol,
    status,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    activatedAt: status === BRIDGE_MATURITY_V2.ACTIVE ? now : null,
    lastUsedAt: now,
  };
  _bridgesV2.set(id, bridge);
  return { ...bridge, metadata: { ...bridge.metadata } };
}

export function getBridgeV2(id) {
  const b = _bridgesV2.get(id);
  return b ? { ...b, metadata: { ...b.metadata } } : null;
}

export function listBridgesV2({ operator, status } = {}) {
  const out = [];
  for (const b of _bridgesV2.values()) {
    if (operator !== undefined && b.operator !== operator) continue;
    if (status !== undefined && b.status !== status) continue;
    out.push({ ...b, metadata: { ...b.metadata } });
  }
  return out;
}

export function setBridgeMaturityV2(id, nextStatus, { reason, metadata } = {}) {
  const b = _bridgesV2.get(id);
  if (!b) throw new Error(`bridge ${id} not found`);
  if (_BRIDGE_TERMINAL_V2.has(b.status))
    throw new Error(`bridge ${id} is terminal (${b.status})`);
  const allowed = _BRIDGE_TRANSITIONS_V2.get(b.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${b.status} → ${nextStatus}`);
  const wasActive =
    b.status !== BRIDGE_MATURITY_V2.RETIRED &&
    b.status !== BRIDGE_MATURITY_V2.PROVISIONAL;
  const willBeActive =
    nextStatus !== BRIDGE_MATURITY_V2.RETIRED &&
    nextStatus !== BRIDGE_MATURITY_V2.PROVISIONAL;
  if (!wasActive && willBeActive) {
    if (getActiveBridgeCount(b.operator) >= _pfMaxActiveBridgesPerOperator)
      throw new Error(`operator ${b.operator} active bridge cap reached`);
  }
  b.status = nextStatus;
  b.updatedAt = _now();
  if (reason !== undefined) b.reason = reason;
  if (metadata) b.metadata = { ...b.metadata, ...metadata };
  if (nextStatus === BRIDGE_MATURITY_V2.ACTIVE && !b.activatedAt)
    b.activatedAt = b.updatedAt;
  return { ...b, metadata: { ...b.metadata } };
}

export function activateBridge(id, opts) {
  return setBridgeMaturityV2(id, BRIDGE_MATURITY_V2.ACTIVE, opts);
}
export function degradeBridge(id, opts) {
  return setBridgeMaturityV2(id, BRIDGE_MATURITY_V2.DEGRADED, opts);
}
export function deprecateBridge(id, opts) {
  return setBridgeMaturityV2(id, BRIDGE_MATURITY_V2.DEPRECATED, opts);
}
export function retireBridge(id, opts) {
  return setBridgeMaturityV2(id, BRIDGE_MATURITY_V2.RETIRED, opts);
}

export function touchBridgeUsage(id) {
  const b = _bridgesV2.get(id);
  if (!b) throw new Error(`bridge ${id} not found`);
  b.lastUsedAt = _now();
  return { ...b, metadata: { ...b.metadata } };
}

export function enqueueTranslationV2({
  id,
  bridgeId,
  sourceLang,
  targetLang,
  text,
  metadata,
} = {}) {
  if (!id) throw new Error("id required");
  if (!bridgeId) throw new Error("bridgeId required");
  if (!targetLang) throw new Error("targetLang required");
  if (!text) throw new Error("text required");
  const b = _bridgesV2.get(bridgeId);
  if (!b) throw new Error(`bridge ${bridgeId} not found`);
  if (_translationsV2.has(id))
    throw new Error(`translation ${id} already exists`);
  const now = _now();
  const run = {
    id,
    bridgeId,
    sourceLang: sourceLang || "auto",
    targetLang,
    text,
    status: TRANSLATION_RUN_V2.QUEUED,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    result: null,
  };
  _translationsV2.set(id, run);
  return { ...run, metadata: { ...run.metadata } };
}

export function getTranslationV2(id) {
  const t = _translationsV2.get(id);
  return t ? { ...t, metadata: { ...t.metadata } } : null;
}

export function listTranslationsV2({ bridgeId, status } = {}) {
  const out = [];
  for (const t of _translationsV2.values()) {
    if (bridgeId !== undefined && t.bridgeId !== bridgeId) continue;
    if (status !== undefined && t.status !== status) continue;
    out.push({ ...t, metadata: { ...t.metadata } });
  }
  return out;
}

export function setTranslationStatusV2(
  id,
  nextStatus,
  { reason, metadata, result } = {},
) {
  const t = _translationsV2.get(id);
  if (!t) throw new Error(`translation ${id} not found`);
  if (_TRANSLATION_TERMINAL_V2.has(t.status))
    throw new Error(`translation ${id} is terminal (${t.status})`);
  const allowed = _TRANSLATION_TRANSITIONS_V2.get(t.status);
  if (!allowed || !allowed.has(nextStatus))
    throw new Error(`illegal transition ${t.status} → ${nextStatus}`);
  if (nextStatus === TRANSLATION_RUN_V2.RUNNING) {
    if (
      getRunningTranslationCount(t.bridgeId) >=
      _pfMaxRunningTranslationsPerBridge
    )
      throw new Error(`bridge ${t.bridgeId} running translation cap reached`);
  }
  t.status = nextStatus;
  t.updatedAt = _now();
  if (reason !== undefined) t.reason = reason;
  if (metadata) t.metadata = { ...t.metadata, ...metadata };
  if (result !== undefined) t.result = result;
  if (nextStatus === TRANSLATION_RUN_V2.RUNNING && !t.startedAt)
    t.startedAt = t.updatedAt;
  return { ...t, metadata: { ...t.metadata } };
}

export function startTranslation(id, opts) {
  return setTranslationStatusV2(id, TRANSLATION_RUN_V2.RUNNING, opts);
}
export function succeedTranslation(id, opts) {
  return setTranslationStatusV2(id, TRANSLATION_RUN_V2.SUCCEEDED, opts);
}
export function failTranslation(id, opts) {
  return setTranslationStatusV2(id, TRANSLATION_RUN_V2.FAILED, opts);
}
export function cancelTranslation(id, opts) {
  return setTranslationStatusV2(id, TRANSLATION_RUN_V2.CANCELED, opts);
}

export function autoRetireIdleBridges({ now } = {}) {
  const cutoff = (now ?? _now()) - _pfBridgeIdleMs;
  const flipped = [];
  for (const b of _bridgesV2.values()) {
    if (
      b.status !== BRIDGE_MATURITY_V2.ACTIVE &&
      b.status !== BRIDGE_MATURITY_V2.DEGRADED &&
      b.status !== BRIDGE_MATURITY_V2.DEPRECATED
    )
      continue;
    if ((b.lastUsedAt ?? b.createdAt) > cutoff) continue;
    b.status = BRIDGE_MATURITY_V2.RETIRED;
    b.updatedAt = now ?? _now();
    b.reason = "auto_retire_idle";
    flipped.push(b.id);
  }
  return flipped;
}

export function autoFailStuckRunningTranslations({ now } = {}) {
  const cutoff = (now ?? _now()) - _pfTranslationStuckMs;
  const flipped = [];
  for (const t of _translationsV2.values()) {
    if (t.status !== TRANSLATION_RUN_V2.RUNNING) continue;
    if (!t.startedAt || t.startedAt > cutoff) continue;
    t.status = TRANSLATION_RUN_V2.FAILED;
    t.updatedAt = now ?? _now();
    t.reason = "auto_fail_stuck";
    flipped.push(t.id);
  }
  return flipped;
}

function _zeroByEnum(enumObj) {
  const out = {};
  for (const v of Object.values(enumObj)) out[v] = 0;
  return out;
}

export function getProtocolFusionStatsV2() {
  const bridges = [..._bridgesV2.values()];
  const translations = [..._translationsV2.values()];
  const bridgesByStatus = _zeroByEnum(BRIDGE_MATURITY_V2);
  for (const b of bridges) bridgesByStatus[b.status]++;
  const translationsByStatus = _zeroByEnum(TRANSLATION_RUN_V2);
  for (const t of translations) translationsByStatus[t.status]++;
  return {
    totalBridgesV2: bridges.length,
    totalTranslationsV2: translations.length,
    maxActiveBridgesPerOperator: _pfMaxActiveBridgesPerOperator,
    maxRunningTranslationsPerBridge: _pfMaxRunningTranslationsPerBridge,
    bridgeIdleMs: _pfBridgeIdleMs,
    translationStuckMs: _pfTranslationStuckMs,
    bridgesByStatus,
    translationsByStatus,
  };
}

export function _resetStateV2() {
  _bridgesV2.clear();
  _translationsV2.clear();
  _pfMaxActiveBridgesPerOperator = PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR;
  _pfMaxRunningTranslationsPerBridge =
    PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE;
  _pfBridgeIdleMs = PF_DEFAULT_BRIDGE_IDLE_MS;
  _pfTranslationStuckMs = PF_DEFAULT_TRANSLATION_STUCK_MS;
}

// =====================================================================
// protocol-fusion V2 governance overlay (iter23)
// =====================================================================
export const PFGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const PFGOV_ROUTE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ROUTING: "routing",
  ROUTED: "routed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pfgovPTrans = new Map([
  [
    PFGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PFGOV_PROFILE_MATURITY_V2.ACTIVE,
      PFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PFGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PFGOV_PROFILE_MATURITY_V2.DEGRADED,
      PFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PFGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      PFGOV_PROFILE_MATURITY_V2.ACTIVE,
      PFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PFGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pfgovPTerminal = new Set([PFGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pfgovJTrans = new Map([
  [
    PFGOV_ROUTE_LIFECYCLE_V2.QUEUED,
    new Set([
      PFGOV_ROUTE_LIFECYCLE_V2.ROUTING,
      PFGOV_ROUTE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PFGOV_ROUTE_LIFECYCLE_V2.ROUTING,
    new Set([
      PFGOV_ROUTE_LIFECYCLE_V2.ROUTED,
      PFGOV_ROUTE_LIFECYCLE_V2.FAILED,
      PFGOV_ROUTE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PFGOV_ROUTE_LIFECYCLE_V2.ROUTED, new Set()],
  [PFGOV_ROUTE_LIFECYCLE_V2.FAILED, new Set()],
  [PFGOV_ROUTE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pfgovPsV2 = new Map();
const _pfgovJsV2 = new Map();
let _pfgovMaxActive = 6,
  _pfgovMaxPending = 15,
  _pfgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _pfgovStuckMs = 60 * 1000;
function _pfgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pfgovCheckP(from, to) {
  const a = _pfgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pfgov profile transition ${from} → ${to}`);
}
function _pfgovCheckJ(from, to) {
  const a = _pfgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pfgov route transition ${from} → ${to}`);
}
function _pfgovCountActive(owner) {
  let c = 0;
  for (const p of _pfgovPsV2.values())
    if (p.owner === owner && p.status === PFGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _pfgovCountPending(profileId) {
  let c = 0;
  for (const j of _pfgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PFGOV_ROUTE_LIFECYCLE_V2.QUEUED ||
        j.status === PFGOV_ROUTE_LIFECYCLE_V2.ROUTING)
    )
      c++;
  return c;
}
export function setMaxActivePfgovProfilesPerOwnerV2(n) {
  _pfgovMaxActive = _pfgovPos(n, "maxActivePfgovProfilesPerOwner");
}
export function getMaxActivePfgovProfilesPerOwnerV2() {
  return _pfgovMaxActive;
}
export function setMaxPendingPfgovRoutesPerProfileV2(n) {
  _pfgovMaxPending = _pfgovPos(n, "maxPendingPfgovRoutesPerProfile");
}
export function getMaxPendingPfgovRoutesPerProfileV2() {
  return _pfgovMaxPending;
}
export function setPfgovProfileIdleMsV2(n) {
  _pfgovIdleMs = _pfgovPos(n, "pfgovProfileIdleMs");
}
export function getPfgovProfileIdleMsV2() {
  return _pfgovIdleMs;
}
export function setPfgovRouteStuckMsV2(n) {
  _pfgovStuckMs = _pfgovPos(n, "pfgovRouteStuckMs");
}
export function getPfgovRouteStuckMsV2() {
  return _pfgovStuckMs;
}
export function _resetStateProtocolFusionGovV2() {
  _pfgovPsV2.clear();
  _pfgovJsV2.clear();
  _pfgovMaxActive = 6;
  _pfgovMaxPending = 15;
  _pfgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _pfgovStuckMs = 60 * 1000;
}
export function registerPfgovProfileV2({ id, owner, protocol, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pfgovPsV2.has(id)) throw new Error(`pfgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    protocol: protocol || "hybrid",
    status: PFGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pfgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePfgovProfileV2(id) {
  const p = _pfgovPsV2.get(id);
  if (!p) throw new Error(`pfgov profile ${id} not found`);
  const isInitial = p.status === PFGOV_PROFILE_MATURITY_V2.PENDING;
  _pfgovCheckP(p.status, PFGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pfgovCountActive(p.owner) >= _pfgovMaxActive)
    throw new Error(`max active pfgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PFGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradePfgovProfileV2(id) {
  const p = _pfgovPsV2.get(id);
  if (!p) throw new Error(`pfgov profile ${id} not found`);
  _pfgovCheckP(p.status, PFGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = PFGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePfgovProfileV2(id) {
  const p = _pfgovPsV2.get(id);
  if (!p) throw new Error(`pfgov profile ${id} not found`);
  _pfgovCheckP(p.status, PFGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PFGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPfgovProfileV2(id) {
  const p = _pfgovPsV2.get(id);
  if (!p) throw new Error(`pfgov profile ${id} not found`);
  if (_pfgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pfgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPfgovProfileV2(id) {
  const p = _pfgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPfgovProfilesV2() {
  return [..._pfgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPfgovRouteV2({
  id,
  profileId,
  destination,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pfgovJsV2.has(id)) throw new Error(`pfgov route ${id} already exists`);
  if (!_pfgovPsV2.has(profileId))
    throw new Error(`pfgov profile ${profileId} not found`);
  if (_pfgovCountPending(profileId) >= _pfgovMaxPending)
    throw new Error(
      `max pending pfgov routes for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    destination: destination || "",
    status: PFGOV_ROUTE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pfgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function routingPfgovRouteV2(id) {
  const j = _pfgovJsV2.get(id);
  if (!j) throw new Error(`pfgov route ${id} not found`);
  _pfgovCheckJ(j.status, PFGOV_ROUTE_LIFECYCLE_V2.ROUTING);
  const now = Date.now();
  j.status = PFGOV_ROUTE_LIFECYCLE_V2.ROUTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRoutePfgovV2(id) {
  const j = _pfgovJsV2.get(id);
  if (!j) throw new Error(`pfgov route ${id} not found`);
  _pfgovCheckJ(j.status, PFGOV_ROUTE_LIFECYCLE_V2.ROUTED);
  const now = Date.now();
  j.status = PFGOV_ROUTE_LIFECYCLE_V2.ROUTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPfgovRouteV2(id, reason) {
  const j = _pfgovJsV2.get(id);
  if (!j) throw new Error(`pfgov route ${id} not found`);
  _pfgovCheckJ(j.status, PFGOV_ROUTE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PFGOV_ROUTE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPfgovRouteV2(id, reason) {
  const j = _pfgovJsV2.get(id);
  if (!j) throw new Error(`pfgov route ${id} not found`);
  _pfgovCheckJ(j.status, PFGOV_ROUTE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PFGOV_ROUTE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPfgovRouteV2(id) {
  const j = _pfgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPfgovRoutesV2() {
  return [..._pfgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdlePfgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pfgovPsV2.values())
    if (
      p.status === PFGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pfgovIdleMs
    ) {
      p.status = PFGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPfgovRoutesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pfgovJsV2.values())
    if (
      j.status === PFGOV_ROUTE_LIFECYCLE_V2.ROUTING &&
      j.startedAt != null &&
      t - j.startedAt >= _pfgovStuckMs
    ) {
      j.status = PFGOV_ROUTE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getProtocolFusionGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PFGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pfgovPsV2.values()) profilesByStatus[p.status]++;
  const routesByStatus = {};
  for (const v of Object.values(PFGOV_ROUTE_LIFECYCLE_V2))
    routesByStatus[v] = 0;
  for (const j of _pfgovJsV2.values()) routesByStatus[j.status]++;
  return {
    totalPfgovProfilesV2: _pfgovPsV2.size,
    totalPfgovRoutesV2: _pfgovJsV2.size,
    maxActivePfgovProfilesPerOwner: _pfgovMaxActive,
    maxPendingPfgovRoutesPerProfile: _pfgovMaxPending,
    pfgovProfileIdleMs: _pfgovIdleMs,
    pfgovRouteStuckMs: _pfgovStuckMs,
    profilesByStatus,
    routesByStatus,
  };
}
