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

/* ═════════════════════════════════════════════════════════ *
 *  Phase 84 V2 — Sensor Maturity + Capture Lifecycle
 * ═════════════════════════════════════════════════════════ */

export const SENSOR_MATURITY_V2 = Object.freeze({
  ONBOARDING: "onboarding",
  ACTIVE: "active",
  DEGRADED: "degraded",
  OFFLINE: "offline",
  RETIRED: "retired",
});

export const CAPTURE_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
  DISCARDED: "discarded",
});

const SENSOR_TRANSITIONS_V2 = new Map([
  ["onboarding", new Set(["active", "retired"])],
  ["active", new Set(["degraded", "offline", "retired"])],
  ["degraded", new Set(["active", "offline", "retired"])],
  ["offline", new Set(["active", "retired"])],
]);
const SENSOR_TERMINALS_V2 = new Set(["retired"]);

const CAPTURE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["processing", "discarded", "failed"])],
  ["processing", new Set(["ready", "failed", "discarded"])],
  ["failed", new Set(["pending", "discarded"])],
]);
const CAPTURE_TERMINALS_V2 = new Set(["ready", "discarded"]);

export const PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR = 25;
export const PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR = 50;
export const PCP_DEFAULT_SENSOR_IDLE_MS = 30 * 86400000; // 30d
export const PCP_DEFAULT_CAPTURE_STUCK_MS = 2 * 3600000; // 2h

let _maxActiveSensorsPerOperatorV2 =
  PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR;
let _maxPendingCapturesPerSensorV2 =
  PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR;
let _sensorIdleMsV2 = PCP_DEFAULT_SENSOR_IDLE_MS;
let _captureStuckMsV2 = PCP_DEFAULT_CAPTURE_STUCK_MS;

function _positiveIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getDefaultMaxActiveSensorsPerOperatorV2() {
  return PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR;
}
export function getMaxActiveSensorsPerOperatorV2() {
  return _maxActiveSensorsPerOperatorV2;
}
export function setMaxActiveSensorsPerOperatorV2(n) {
  return (_maxActiveSensorsPerOperatorV2 = _positiveIntV2(
    n,
    "maxActiveSensorsPerOperator",
  ));
}
export function getDefaultMaxPendingCapturesPerSensorV2() {
  return PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR;
}
export function getMaxPendingCapturesPerSensorV2() {
  return _maxPendingCapturesPerSensorV2;
}
export function setMaxPendingCapturesPerSensorV2(n) {
  return (_maxPendingCapturesPerSensorV2 = _positiveIntV2(
    n,
    "maxPendingCapturesPerSensor",
  ));
}
export function getDefaultSensorIdleMsV2() {
  return PCP_DEFAULT_SENSOR_IDLE_MS;
}
export function getSensorIdleMsV2() {
  return _sensorIdleMsV2;
}
export function setSensorIdleMsV2(ms) {
  return (_sensorIdleMsV2 = _positiveIntV2(ms, "sensorIdleMs"));
}
export function getDefaultCaptureStuckMsV2() {
  return PCP_DEFAULT_CAPTURE_STUCK_MS;
}
export function getCaptureStuckMsV2() {
  return _captureStuckMsV2;
}
export function setCaptureStuckMsV2(ms) {
  return (_captureStuckMsV2 = _positiveIntV2(ms, "captureStuckMs"));
}

const _sensorsV2 = new Map();
const _capturesV2 = new Map();

export function registerSensorV2(
  _db,
  { sensorId, operatorId, modality, initialStatus, metadata } = {},
) {
  if (!sensorId) throw new Error("sensorId is required");
  if (!operatorId) throw new Error("operatorId is required");
  if (!modality) throw new Error("modality is required");
  if (!Object.values(MODALITY).includes(modality))
    throw new Error(`Invalid modality: ${modality}`);
  if (_sensorsV2.has(sensorId))
    throw new Error(`Sensor ${sensorId} already exists`);
  const status = initialStatus || SENSOR_MATURITY_V2.ONBOARDING;
  if (!Object.values(SENSOR_MATURITY_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (SENSOR_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === SENSOR_MATURITY_V2.ACTIVE) {
    if (getActiveSensorCount(operatorId) >= _maxActiveSensorsPerOperatorV2)
      throw new Error(
        `Operator ${operatorId} reached active-sensor cap (${_maxActiveSensorsPerOperatorV2})`,
      );
  }
  const now = Date.now();
  const record = {
    sensorId,
    operatorId,
    modality,
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
  };
  _sensorsV2.set(sensorId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getSensorV2(sensorId) {
  const r = _sensorsV2.get(sensorId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setSensorMaturityV2(_db, sensorId, newStatus, patch = {}) {
  const record = _sensorsV2.get(sensorId);
  if (!record) throw new Error(`Unknown sensor: ${sensorId}`);
  if (!Object.values(SENSOR_MATURITY_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = SENSOR_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === SENSOR_MATURITY_V2.ACTIVE) {
    if (
      getActiveSensorCount(record.operatorId) >= _maxActiveSensorsPerOperatorV2
    )
      throw new Error(
        `Operator ${record.operatorId} reached active-sensor cap (${_maxActiveSensorsPerOperatorV2})`,
      );
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function activateSensor(db, id, reason) {
  return setSensorMaturityV2(db, id, SENSOR_MATURITY_V2.ACTIVE, { reason });
}
export function degradeSensor(db, id, reason) {
  return setSensorMaturityV2(db, id, SENSOR_MATURITY_V2.DEGRADED, { reason });
}
export function offlineSensor(db, id, reason) {
  return setSensorMaturityV2(db, id, SENSOR_MATURITY_V2.OFFLINE, { reason });
}
export function retireSensor(db, id, reason) {
  return setSensorMaturityV2(db, id, SENSOR_MATURITY_V2.RETIRED, { reason });
}

export function touchSensorHeartbeat(sensorId) {
  const record = _sensorsV2.get(sensorId);
  if (!record) throw new Error(`Unknown sensor: ${sensorId}`);
  record.lastHeartbeatAt = Date.now();
  record.updatedAt = record.lastHeartbeatAt;
  return { ...record, metadata: { ...record.metadata } };
}

export function registerCaptureV2(
  _db,
  { captureId, sensorId, initialStatus, metadata } = {},
) {
  if (!captureId) throw new Error("captureId is required");
  if (!sensorId) throw new Error("sensorId is required");
  if (!_sensorsV2.has(sensorId)) throw new Error(`Unknown sensor: ${sensorId}`);
  if (_capturesV2.has(captureId))
    throw new Error(`Capture ${captureId} already exists`);
  const status = initialStatus || CAPTURE_LIFECYCLE_V2.PENDING;
  if (!Object.values(CAPTURE_LIFECYCLE_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (CAPTURE_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === CAPTURE_LIFECYCLE_V2.PENDING) {
    if (getPendingCaptureCount(sensorId) >= _maxPendingCapturesPerSensorV2)
      throw new Error(
        `Sensor ${sensorId} reached pending-capture cap (${_maxPendingCapturesPerSensorV2})`,
      );
  }
  const now = Date.now();
  const record = {
    captureId,
    sensorId,
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  _capturesV2.set(captureId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getCaptureV2(captureId) {
  const r = _capturesV2.get(captureId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setCaptureStatusV2(_db, captureId, newStatus, patch = {}) {
  const record = _capturesV2.get(captureId);
  if (!record) throw new Error(`Unknown capture: ${captureId}`);
  if (!Object.values(CAPTURE_LIFECYCLE_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = CAPTURE_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (
    newStatus === CAPTURE_LIFECYCLE_V2.PROCESSING &&
    !record.processingStartedAt
  ) {
    record.processingStartedAt = Date.now();
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function startProcessingCapture(db, id, reason) {
  return setCaptureStatusV2(db, id, CAPTURE_LIFECYCLE_V2.PROCESSING, {
    reason,
  });
}
export function markCaptureReady(db, id, reason) {
  return setCaptureStatusV2(db, id, CAPTURE_LIFECYCLE_V2.READY, { reason });
}
export function failCapture(db, id, reason) {
  return setCaptureStatusV2(db, id, CAPTURE_LIFECYCLE_V2.FAILED, { reason });
}
export function discardCapture(db, id, reason) {
  return setCaptureStatusV2(db, id, CAPTURE_LIFECYCLE_V2.DISCARDED, { reason });
}

export function getActiveSensorCount(operatorId) {
  let n = 0;
  for (const r of _sensorsV2.values()) {
    if (r.status !== SENSOR_MATURITY_V2.ACTIVE) continue;
    if (operatorId && r.operatorId !== operatorId) continue;
    n++;
  }
  return n;
}

export function getPendingCaptureCount(sensorId) {
  let n = 0;
  for (const r of _capturesV2.values()) {
    if (r.status !== CAPTURE_LIFECYCLE_V2.PENDING) continue;
    if (sensorId && r.sensorId !== sensorId) continue;
    n++;
  }
  return n;
}

export function autoOfflineStaleSensors(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _sensorsV2.values()) {
    if (
      r.status === SENSOR_MATURITY_V2.ACTIVE ||
      r.status === SENSOR_MATURITY_V2.DEGRADED
    ) {
      if (now - r.lastHeartbeatAt > _sensorIdleMsV2) {
        r.status = SENSOR_MATURITY_V2.OFFLINE;
        r.updatedAt = now;
        r.lastReason = "heartbeat_timeout";
        flipped.push(r.sensorId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckProcessingCaptures(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _capturesV2.values()) {
    if (r.status === CAPTURE_LIFECYCLE_V2.PROCESSING) {
      const anchor = r.processingStartedAt || r.createdAt;
      if (now - anchor > _captureStuckMsV2) {
        r.status = CAPTURE_LIFECYCLE_V2.FAILED;
        r.updatedAt = now;
        r.lastReason = "processing_timeout";
        flipped.push(r.captureId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function getPerceptionStatsV2() {
  const sensorsByStatus = {};
  for (const s of Object.values(SENSOR_MATURITY_V2)) sensorsByStatus[s] = 0;
  const capturesByStatus = {};
  for (const s of Object.values(CAPTURE_LIFECYCLE_V2)) capturesByStatus[s] = 0;
  for (const r of _sensorsV2.values()) sensorsByStatus[r.status]++;
  for (const r of _capturesV2.values()) capturesByStatus[r.status]++;
  return {
    totalSensorsV2: _sensorsV2.size,
    totalCapturesV2: _capturesV2.size,
    maxActiveSensorsPerOperator: _maxActiveSensorsPerOperatorV2,
    maxPendingCapturesPerSensor: _maxPendingCapturesPerSensorV2,
    sensorIdleMs: _sensorIdleMsV2,
    captureStuckMs: _captureStuckMsV2,
    sensorsByStatus,
    capturesByStatus,
  };
}

export function _resetStateV2() {
  _maxActiveSensorsPerOperatorV2 = PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR;
  _maxPendingCapturesPerSensorV2 = PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR;
  _sensorIdleMsV2 = PCP_DEFAULT_SENSOR_IDLE_MS;
  _captureStuckMsV2 = PCP_DEFAULT_CAPTURE_STUCK_MS;
  _sensorsV2.clear();
  _capturesV2.clear();
}
