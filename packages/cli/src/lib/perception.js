/**
 * Multimodal Perception Engine — CLI port of Phase 84
 * (docs/design/modules/49_多模态感知层.md).
 *
 * Desktop uses real-time screen capture, ASR/TTS voice sessions,
 * document parsers (PDF/Word/Excel), video keyframe extraction,
 * and cross-modal vector search.
 * CLI port ships:
 *
 *   - Perception result recording (screen/voice/document/video)
 *   - Voice session lifecycle (idle → listening → processing → speaking)
 *   - Multimodal index entries with content summaries and tags
 *   - Cross-modal query simulation (keyword matching on summaries)
 *   - Stats and context aggregation
 *
 * What does NOT port: real screen capture (Sharp/Tesseract), ASR/TTS
 * streaming, document binary parsing, video keyframe extraction,
 * vector embeddings, real-time VAD.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const MODALITY = Object.freeze({
  SCREEN: "screen",
  VOICE: "voice",
  DOCUMENT: "document",
  VIDEO: "video",
});

export const VOICE_STATUS = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  PROCESSING: "processing",
  SPEAKING: "speaking",
});

export const ANALYSIS_TYPE = Object.freeze({
  OCR: "ocr",
  OBJECT_DETECTION: "object_detection",
  SCENE_RECOGNITION: "scene_recognition",
  ACTION_DETECTION: "action_detection",
});

/* ── State ──────────────────────────────────────────────── */

let _results = new Map();
let _voiceSessions = new Map();
let _indexEntries = new Map();

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

/* ── Schema ─────────────────────────────────────────────── */

export function ensurePerceptionTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS perception_results (
    id TEXT PRIMARY KEY,
    modality TEXT NOT NULL,
    analysis_type TEXT,
    input_source TEXT,
    result_data TEXT,
    confidence REAL DEFAULT 0.0,
    metadata TEXT,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS voice_sessions (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'idle',
    language TEXT DEFAULT 'zh-CN',
    transcript TEXT,
    duration_ms INTEGER DEFAULT 0,
    model TEXT,
    started_at INTEGER,
    ended_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS multimodal_index (
    id TEXT PRIMARY KEY,
    modality TEXT NOT NULL,
    source_id TEXT NOT NULL,
    embedding TEXT,
    content_summary TEXT,
    tags TEXT,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _results.clear();
  _voiceSessions.clear();
  _indexEntries.clear();

  const tables = [
    ["perception_results", _results, "id"],
    ["voice_sessions", _voiceSessions, "id"],
    ["multimodal_index", _indexEntries, "id"],
  ];
  for (const [table, map, key] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r[key], r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Perception Results ─────────────────────────────────── */

const VALID_MODALITIES = new Set(Object.values(MODALITY));
const VALID_ANALYSIS_TYPES = new Set(Object.values(ANALYSIS_TYPE));

export function recordPerception(
  db,
  {
    modality,
    analysisType,
    inputSource,
    resultData,
    confidence,
    metadata,
  } = {},
) {
  if (!modality || !VALID_MODALITIES.has(modality))
    return { recorded: false, reason: "invalid_modality" };

  const id = _id();
  const now = _now();

  const entry = {
    id,
    modality,
    analysis_type:
      analysisType && VALID_ANALYSIS_TYPES.has(analysisType)
        ? analysisType
        : null,
    input_source: inputSource || null,
    result_data: resultData || null,
    confidence: confidence != null ? Math.max(0, Math.min(1, confidence)) : 0,
    metadata: metadata || null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO perception_results (id, modality, analysis_type, input_source, result_data, confidence, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.modality,
    entry.analysis_type,
    entry.input_source,
    entry.result_data,
    entry.confidence,
    entry.metadata,
    now,
  );

  _results.set(id, entry);
  return { recorded: true, resultId: id };
}

export function getPerception(db, id) {
  const r = _results.get(id);
  return r ? { ...r } : null;
}

export function listPerceptions(
  db,
  { modality, analysisType, limit = 50 } = {},
) {
  let results = [..._results.values()];
  if (modality) results = results.filter((r) => r.modality === modality);
  if (analysisType)
    results = results.filter((r) => r.analysis_type === analysisType);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

/* ── Voice Sessions ─────────────────────────────────────── */

export function startVoice(db, { language, model } = {}) {
  const id = _id();
  const now = _now();

  const entry = {
    id,
    status: "listening",
    language: language || "zh-CN",
    transcript: null,
    duration_ms: 0,
    model: model || null,
    started_at: now,
    ended_at: null,
  };

  db.prepare(
    `INSERT INTO voice_sessions (id, status, language, transcript, duration_ms, model, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "listening", entry.language, null, 0, entry.model, now, null);

  _voiceSessions.set(id, entry);
  return { sessionId: id, status: "listening" };
}

export function updateVoiceStatus(db, id, status) {
  const s = _voiceSessions.get(id);
  if (!s) return { updated: false, reason: "not_found" };

  const validTransitions = {
    listening: ["processing", "idle"],
    processing: ["speaking", "idle"],
    speaking: ["idle", "listening"],
    idle: ["listening"],
  };

  const allowed = validTransitions[s.status] || [];
  if (!allowed.includes(status))
    return {
      updated: false,
      reason: "invalid_transition",
      from: s.status,
      to: status,
    };

  s.status = status;
  if (status === "idle") {
    s.ended_at = _now();
    s.duration_ms = s.ended_at - s.started_at;
  }

  db.prepare(
    "UPDATE voice_sessions SET status = ?, ended_at = ?, duration_ms = ? WHERE id = ?",
  ).run(s.status, s.ended_at, s.duration_ms, id);

  return { updated: true, status: s.status };
}

export function setTranscript(db, id, transcript) {
  const s = _voiceSessions.get(id);
  if (!s) return { updated: false, reason: "not_found" };
  if (!transcript) return { updated: false, reason: "empty_transcript" };

  s.transcript = transcript;
  db.prepare("UPDATE voice_sessions SET transcript = ? WHERE id = ?").run(
    transcript,
    id,
  );

  return { updated: true };
}

export function getVoiceSession(db, id) {
  const s = _voiceSessions.get(id);
  return s ? { ...s } : null;
}

export function listVoiceSessions(db, { status, language, limit = 50 } = {}) {
  let sessions = [..._voiceSessions.values()];
  if (status) sessions = sessions.filter((s) => s.status === status);
  if (language) sessions = sessions.filter((s) => s.language === language);
  return sessions
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, limit)
    .map((s) => ({ ...s }));
}

/* ── Multimodal Index ───────────────────────────────────── */

export function addIndexEntry(
  db,
  { modality, sourceId, contentSummary, tags, embedding } = {},
) {
  if (!modality || !VALID_MODALITIES.has(modality))
    return { added: false, reason: "invalid_modality" };
  if (!sourceId) return { added: false, reason: "missing_source_id" };

  const id = _id();
  const now = _now();
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : tags || null;

  const entry = {
    id,
    modality,
    source_id: sourceId,
    embedding: embedding || null,
    content_summary: contentSummary || null,
    tags: tagsJson,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO multimodal_index (id, modality, source_id, embedding, content_summary, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    modality,
    sourceId,
    entry.embedding,
    entry.content_summary,
    tagsJson,
    now,
  );

  _indexEntries.set(id, entry);
  return { added: true, indexId: id };
}

export function getIndexEntry(db, id) {
  const e = _indexEntries.get(id);
  return e ? { ...e } : null;
}

export function listIndexEntries(db, { modality, limit = 50 } = {}) {
  let entries = [..._indexEntries.values()];
  if (modality) entries = entries.filter((e) => e.modality === modality);
  return entries
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((e) => ({ ...e }));
}

export function removeIndexEntry(db, id) {
  const e = _indexEntries.get(id);
  if (!e) return { removed: false, reason: "not_found" };

  _indexEntries.delete(id);
  db.prepare("DELETE FROM multimodal_index WHERE id = ?").run(id);

  return { removed: true };
}

/* ── Cross-Modal Query ──────────────────────────────────── */

export function crossModalQuery(db, { query, modalities, limit = 20 } = {}) {
  if (!query) return { results: [], reason: "missing_query" };

  let entries = [..._indexEntries.values()];

  // Filter by modalities if specified
  if (modalities && modalities.length > 0) {
    entries = entries.filter((e) => modalities.includes(e.modality));
  }

  // Keyword matching on content_summary and tags (simulated semantic search)
  const queryLower = query.toLowerCase();
  const scored = entries
    .map((e) => {
      let score = 0;
      const summary = (e.content_summary || "").toLowerCase();
      const tagStr = (e.tags || "").toLowerCase();

      // Check summary match
      if (summary.includes(queryLower)) {
        score += 0.8;
      } else {
        // Partial word matching
        const words = queryLower.split(/\s+/);
        const matches = words.filter(
          (w) => summary.includes(w) || tagStr.includes(w),
        );
        score += (matches.length / words.length) * 0.6;
      }

      // Check tag match
      if (tagStr.includes(queryLower)) {
        score += 0.2;
      }

      return { ...e, score: Math.round(score * 1000) / 1000 };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { results: scored, total: scored.length };
}

/* ── Context ────────────────────────────────────────────── */

export function getPerceptionContext(db) {
  const results = [..._results.values()];
  const sessions = [..._voiceSessions.values()];
  const entries = [..._indexEntries.values()];

  const activeSessions = sessions.filter((s) => s.status !== "idle");
  const recentResults = results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5)
    .map((r) => ({
      modality: r.modality,
      analysisType: r.analysis_type,
      confidence: r.confidence,
    }));

  return {
    activeSessions: activeSessions.length,
    activeSessionIds: activeSessions.map((s) => s.id),
    totalResults: results.length,
    totalIndexEntries: entries.length,
    recentResults,
    modalityCoverage: {
      screen: results.filter((r) => r.modality === "screen").length,
      voice: results.filter((r) => r.modality === "voice").length,
      document: results.filter((r) => r.modality === "document").length,
      video: results.filter((r) => r.modality === "video").length,
    },
  };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getPerceptionStats(db) {
  const results = [..._results.values()];
  const sessions = [..._voiceSessions.values()];
  const entries = [..._indexEntries.values()];

  const byModality = {};
  for (const mod of Object.values(MODALITY)) byModality[mod] = 0;
  for (const r of results)
    byModality[r.modality] = (byModality[r.modality] || 0) + 1;

  const byAnalysisType = {};
  for (const r of results) {
    if (r.analysis_type) {
      byAnalysisType[r.analysis_type] =
        (byAnalysisType[r.analysis_type] || 0) + 1;
    }
  }

  const completedSessions = sessions.filter(
    (s) => s.status === "idle" && s.ended_at,
  );
  const avgSessionDuration =
    completedSessions.length > 0
      ? Math.round(
          completedSessions.reduce((s, v) => s + v.duration_ms, 0) /
            completedSessions.length,
        )
      : 0;

  const avgConfidence =
    results.length > 0
      ? Math.round(
          (results.reduce((s, r) => s + r.confidence, 0) / results.length) *
            1000,
        ) / 1000
      : 0;

  return {
    results: {
      total: results.length,
      byModality,
      byAnalysisType,
      avgConfidence,
    },
    voiceSessions: {
      total: sessions.length,
      active: sessions.filter((s) => s.status !== "idle").length,
      completed: completedSessions.length,
      avgDurationMs: avgSessionDuration,
    },
    index: {
      total: entries.length,
      byModality: entries.reduce((acc, e) => {
        acc[e.modality] = (acc[e.modality] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _results.clear();
  _voiceSessions.clear();
  _indexEntries.clear();
}
