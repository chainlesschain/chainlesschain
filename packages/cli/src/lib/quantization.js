/**
 * Model Quantization — CLI port of Phase 20
 * (docs/design/modules/20_模型量化系统.md).
 *
 * Desktop uses QuantizationManager (llama.cpp subprocess + AutoGPTQ),
 * GGUFQuantizer, GPTQQuantizer with real progress tracking.
 * CLI port ships:
 *
 *   - Quantization job recording with status lifecycle
 *   - GGUF 14-level catalog + GPTQ bit-width catalog
 *   - Job CRUD (create/status/cancel/list/delete)
 *   - Simulated progress tracking (no real subprocess)
 *   - Stats aggregation
 *
 * What does NOT port: real llama-quantize subprocess execution,
 * real AutoGPTQ Python subprocess, Ollama import (POST /api/create),
 * real file-size tracking, stdout progress parsing.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const QUANT_TYPE = Object.freeze({
  GGUF: "gguf",
  GPTQ: "gptq",
});

export const GGUF_LEVELS = Object.freeze([
  { level: "Q2_K", bits: 2, description: "最小体积, 最低质量" },
  { level: "Q3_K_S", bits: 3, description: "极小, 低质量" },
  { level: "Q3_K_M", bits: 3, description: "小, 中等质量" },
  { level: "Q3_K_L", bits: 3, description: "小, 较高质量" },
  { level: "Q4_0", bits: 4, description: "旧版4-bit量化" },
  { level: "Q4_K_S", bits: 4, description: "小, 良好质量 (推荐最低)" },
  { level: "Q4_K_M", bits: 4, description: "中等, 体积质量平衡 (推荐)" },
  { level: "Q5_0", bits: 5, description: "旧版5-bit量化" },
  { level: "Q5_K_S", bits: 5, description: "小, 很好质量" },
  { level: "Q5_K_M", bits: 5, description: "中等, 优秀质量" },
  { level: "Q6_K", bits: 6, description: "大, 接近无损" },
  { level: "Q8_0", bits: 8, description: "极大, 几乎无损" },
  { level: "F16", bits: 16, description: "半精度浮点, 无量化损失" },
  { level: "F32", bits: 32, description: "全精度浮点, 最大体积" },
]);

export const GPTQ_BITS = Object.freeze([2, 3, 4, 8]);

/* ── State ──────────────────────────────────────────────── */

let _jobs = new Map();

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

export function ensureQuantizationTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS quantization_jobs (
    id TEXT PRIMARY KEY,
    input_path TEXT NOT NULL,
    output_path TEXT,
    quant_type TEXT NOT NULL,
    quant_level TEXT,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0.0,
    file_size_bytes INTEGER DEFAULT 0,
    error_message TEXT,
    config TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _jobs.clear();
  try {
    for (const row of db.prepare("SELECT * FROM quantization_jobs").all()) {
      const r = _strip(row);
      _jobs.set(r.id, r);
    }
  } catch (_e) {
    /* table may not exist */
  }
}

/* ── Validation helpers ─────────────────────────────────── */

const VALID_STATUSES = new Set(Object.values(JOB_STATUS));
const VALID_GGUF_LEVELS = new Set(GGUF_LEVELS.map((l) => l.level));

function _isValidGgufLevel(level) {
  return VALID_GGUF_LEVELS.has(level);
}

function _isValidGptqBits(bits) {
  return GPTQ_BITS.includes(Number(bits));
}

/* ── Job CRUD ───────────────────────────────────────────── */

export function createJob(
  db,
  { inputPath, outputPath, quantType, quantLevel, config } = {},
) {
  if (!inputPath) return { created: false, reason: "missing_input_path" };
  if (!quantType || !Object.values(QUANT_TYPE).includes(quantType))
    return { created: false, reason: "invalid_quant_type" };

  if (quantType === "gguf") {
    if (!quantLevel) return { created: false, reason: "missing_quant_level" };
    if (!_isValidGgufLevel(quantLevel))
      return { created: false, reason: "invalid_gguf_level" };
  }

  if (quantType === "gptq") {
    const bits = config?.bits ?? 4;
    if (!_isValidGptqBits(bits))
      return { created: false, reason: "invalid_gptq_bits" };
  }

  const id = _id();
  const now = _now();
  const configJson = config
    ? typeof config === "string"
      ? config
      : JSON.stringify(config)
    : null;

  const entry = {
    id,
    input_path: inputPath,
    output_path: outputPath || null,
    quant_type: quantType,
    quant_level: quantLevel || null,
    status: "pending",
    progress: 0,
    file_size_bytes: 0,
    error_message: null,
    config: configJson,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO quantization_jobs (id, input_path, output_path, quant_type, quant_level, status, progress, file_size_bytes, error_message, config, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.input_path,
    entry.output_path,
    entry.quant_type,
    entry.quant_level,
    "pending",
    0,
    0,
    null,
    configJson,
    null,
    null,
    now,
    now,
  );

  _jobs.set(id, entry);
  return { created: true, jobId: id };
}

export function getJob(db, id) {
  const j = _jobs.get(id);
  return j ? { ...j } : null;
}

export function listJobs(db, { status, quantType, limit = 50 } = {}) {
  let results = [..._jobs.values()];
  if (status) results = results.filter((j) => j.status === status);
  if (quantType) results = results.filter((j) => j.quant_type === quantType);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((j) => ({ ...j }));
}

export function startJob(db, id) {
  const j = _jobs.get(id);
  if (!j) return { started: false, reason: "not_found" };
  if (j.status !== "pending") return { started: false, reason: "not_pending" };

  const now = _now();
  j.status = "running";
  j.started_at = now;
  j.updated_at = now;

  db.prepare(
    "UPDATE quantization_jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?",
  ).run(now, now, id);

  return { started: true, jobId: id };
}

export function updateProgress(db, id, progress) {
  const j = _jobs.get(id);
  if (!j) return { updated: false, reason: "not_found" };
  if (j.status !== "running") return { updated: false, reason: "not_running" };

  const clamped = Math.max(0, Math.min(100, Number(progress) || 0));
  const now = _now();
  j.progress = clamped;
  j.updated_at = now;

  db.prepare(
    "UPDATE quantization_jobs SET progress = ?, updated_at = ? WHERE id = ?",
  ).run(clamped, now, id);

  return { updated: true, progress: clamped };
}

export function completeJob(db, id, { outputPath, fileSizeBytes } = {}) {
  const j = _jobs.get(id);
  if (!j) return { completed: false, reason: "not_found" };
  if (j.status !== "running")
    return { completed: false, reason: "not_running" };

  const now = _now();
  j.status = "completed";
  j.progress = 100;
  j.completed_at = now;
  j.updated_at = now;
  if (outputPath) j.output_path = outputPath;
  if (fileSizeBytes != null) j.file_size_bytes = fileSizeBytes;

  db.prepare(
    "UPDATE quantization_jobs SET status = 'completed', progress = 100, output_path = ?, file_size_bytes = ?, completed_at = ?, updated_at = ? WHERE id = ?",
  ).run(j.output_path, j.file_size_bytes, now, now, id);

  return { completed: true, jobId: id };
}

export function failJob(db, id, errorMessage) {
  const j = _jobs.get(id);
  if (!j) return { failed: false, reason: "not_found" };
  if (j.status !== "running" && j.status !== "pending")
    return { failed: false, reason: "not_active" };

  const now = _now();
  j.status = "failed";
  j.error_message = errorMessage || null;
  j.updated_at = now;
  if (!j.completed_at) j.completed_at = now;

  db.prepare(
    "UPDATE quantization_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
  ).run(j.error_message, j.completed_at, now, id);

  return { failed: true, jobId: id };
}

export function cancelJob(db, id) {
  const j = _jobs.get(id);
  if (!j) return { cancelled: false, reason: "not_found" };
  if (j.status === "completed" || j.status === "cancelled")
    return { cancelled: false, reason: "already_terminal" };

  const now = _now();
  j.status = "cancelled";
  j.updated_at = now;
  if (!j.completed_at) j.completed_at = now;

  db.prepare(
    "UPDATE quantization_jobs SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?",
  ).run(j.completed_at, now, id);

  return { cancelled: true, jobId: id };
}

export function deleteJob(db, id) {
  const j = _jobs.get(id);
  if (!j) return { deleted: false, reason: "not_found" };
  if (j.status === "running")
    return { deleted: false, reason: "still_running" };

  _jobs.delete(id);
  db.prepare("DELETE FROM quantization_jobs WHERE id = ?").run(id);

  return { deleted: true };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getQuantizationStats(db) {
  const jobs = [..._jobs.values()];

  const byStatus = {};
  for (const s of Object.values(JOB_STATUS)) byStatus[s] = 0;
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;

  const byType = {};
  for (const t of Object.values(QUANT_TYPE)) byType[t] = 0;
  for (const j of jobs) byType[j.quant_type] = (byType[j.quant_type] || 0) + 1;

  const byLevel = {};
  for (const j of jobs) {
    if (j.quant_level)
      byLevel[j.quant_level] = (byLevel[j.quant_level] || 0) + 1;
  }

  const completed = jobs.filter((j) => j.status === "completed");
  const totalSizeBytes = completed.reduce(
    (s, j) => s + (j.file_size_bytes || 0),
    0,
  );

  const durations = completed
    .filter((j) => j.started_at && j.completed_at)
    .map((j) => j.completed_at - j.started_at);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : 0;

  return {
    total: jobs.length,
    byStatus,
    byType,
    byLevel,
    completed: completed.length,
    totalSizeBytes,
    avgDurationMs,
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _jobs.clear();
}

/* ═════════════════════════════════════════════════════════ *
 *  Phase 20 V2 — Model Maturity + Job Ticket Lifecycle
 * ═════════════════════════════════════════════════════════ */

export const MODEL_MATURITY_V2 = Object.freeze({
  ONBOARDING: "onboarding",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const JOB_TICKET_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
});

const MODEL_TRANSITIONS_V2 = new Map([
  ["onboarding", new Set(["active", "retired"])],
  ["active", new Set(["deprecated", "retired"])],
  ["deprecated", new Set(["active", "retired"])],
]);
const MODEL_TERMINALS_V2 = new Set(["retired"]);

const JOB_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "canceled", "failed"])],
  ["running", new Set(["completed", "failed", "canceled"])],
]);
const JOB_TERMINALS_V2 = new Set(["completed", "failed", "canceled"]);

export const QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER = 50;
export const QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER = 3;
export const QUANT_DEFAULT_MODEL_IDLE_MS = 120 * 86400000; // 120d
export const QUANT_DEFAULT_JOB_STUCK_MS = 6 * 3600000; // 6h

let _maxActiveModelsPerOwnerV2 = QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER;
let _maxRunningJobsPerOwnerV2 = QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
let _modelIdleMsV2 = QUANT_DEFAULT_MODEL_IDLE_MS;
let _jobStuckMsV2 = QUANT_DEFAULT_JOB_STUCK_MS;

function _positiveIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getDefaultMaxActiveModelsPerOwnerV2() {
  return QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER;
}
export function getMaxActiveModelsPerOwnerV2() {
  return _maxActiveModelsPerOwnerV2;
}
export function setMaxActiveModelsPerOwnerV2(n) {
  return (_maxActiveModelsPerOwnerV2 = _positiveIntV2(
    n,
    "maxActiveModelsPerOwner",
  ));
}
export function getDefaultMaxRunningJobsPerOwnerV2() {
  return QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
}
export function getMaxRunningJobsPerOwnerV2() {
  return _maxRunningJobsPerOwnerV2;
}
export function setMaxRunningJobsPerOwnerV2(n) {
  return (_maxRunningJobsPerOwnerV2 = _positiveIntV2(
    n,
    "maxRunningJobsPerOwner",
  ));
}
export function getDefaultModelIdleMsV2() {
  return QUANT_DEFAULT_MODEL_IDLE_MS;
}
export function getModelIdleMsV2() {
  return _modelIdleMsV2;
}
export function setModelIdleMsV2(ms) {
  return (_modelIdleMsV2 = _positiveIntV2(ms, "modelIdleMs"));
}
export function getDefaultJobStuckMsV2() {
  return QUANT_DEFAULT_JOB_STUCK_MS;
}
export function getJobStuckMsV2() {
  return _jobStuckMsV2;
}
export function setJobStuckMsV2(ms) {
  return (_jobStuckMsV2 = _positiveIntV2(ms, "jobStuckMs"));
}

const _modelsV2 = new Map();
const _jobTicketsV2 = new Map();

export function registerModelV2(
  _db,
  { modelId, ownerId, family, initialStatus, metadata } = {},
) {
  if (!modelId) throw new Error("modelId is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (_modelsV2.has(modelId))
    throw new Error(`Model ${modelId} already exists`);
  const status = initialStatus || MODEL_MATURITY_V2.ONBOARDING;
  if (!Object.values(MODEL_MATURITY_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (MODEL_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === MODEL_MATURITY_V2.ACTIVE) {
    if (getActiveModelCount(ownerId) >= _maxActiveModelsPerOwnerV2)
      throw new Error(
        `Owner ${ownerId} reached active-model cap (${_maxActiveModelsPerOwnerV2})`,
      );
  }
  const now = Date.now();
  const record = {
    modelId,
    ownerId,
    family: family || "",
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };
  _modelsV2.set(modelId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getModelV2(modelId) {
  const r = _modelsV2.get(modelId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setModelMaturityV2(_db, modelId, newStatus, patch = {}) {
  const record = _modelsV2.get(modelId);
  if (!record) throw new Error(`Unknown model: ${modelId}`);
  if (!Object.values(MODEL_MATURITY_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = MODEL_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === MODEL_MATURITY_V2.ACTIVE) {
    if (getActiveModelCount(record.ownerId) >= _maxActiveModelsPerOwnerV2)
      throw new Error(
        `Owner ${record.ownerId} reached active-model cap (${_maxActiveModelsPerOwnerV2})`,
      );
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function activateModel(db, id, reason) {
  return setModelMaturityV2(db, id, MODEL_MATURITY_V2.ACTIVE, { reason });
}
export function deprecateModel(db, id, reason) {
  return setModelMaturityV2(db, id, MODEL_MATURITY_V2.DEPRECATED, { reason });
}
export function retireModel(db, id, reason) {
  return setModelMaturityV2(db, id, MODEL_MATURITY_V2.RETIRED, { reason });
}

export function touchModelUsage(modelId) {
  const record = _modelsV2.get(modelId);
  if (!record) throw new Error(`Unknown model: ${modelId}`);
  record.lastUsedAt = Date.now();
  record.updatedAt = record.lastUsedAt;
  return { ...record, metadata: { ...record.metadata } };
}

export function enqueueJobTicketV2(
  _db,
  { ticketId, ownerId, modelId, quantType, level, metadata } = {},
) {
  if (!ticketId) throw new Error("ticketId is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!modelId) throw new Error("modelId is required");
  if (!quantType) throw new Error("quantType is required");
  if (_jobTicketsV2.has(ticketId))
    throw new Error(`Ticket ${ticketId} already exists`);
  const now = Date.now();
  const record = {
    ticketId,
    ownerId,
    modelId,
    quantType,
    level: level || null,
    status: JOB_TICKET_V2.QUEUED,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  _jobTicketsV2.set(ticketId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getJobTicketV2(ticketId) {
  const r = _jobTicketsV2.get(ticketId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setJobTicketStatusV2(_db, ticketId, newStatus, patch = {}) {
  const record = _jobTicketsV2.get(ticketId);
  if (!record) throw new Error(`Unknown ticket: ${ticketId}`);
  if (!Object.values(JOB_TICKET_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = JOB_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === JOB_TICKET_V2.RUNNING) {
    if (getRunningJobCount(record.ownerId) >= _maxRunningJobsPerOwnerV2)
      throw new Error(
        `Owner ${record.ownerId} reached running-job cap (${_maxRunningJobsPerOwnerV2})`,
      );
    record.startedAt = Date.now();
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function startJobTicket(db, id, reason) {
  return setJobTicketStatusV2(db, id, JOB_TICKET_V2.RUNNING, { reason });
}
export function completeJobTicket(db, id, reason) {
  return setJobTicketStatusV2(db, id, JOB_TICKET_V2.COMPLETED, { reason });
}
export function failJobTicket(db, id, reason) {
  return setJobTicketStatusV2(db, id, JOB_TICKET_V2.FAILED, { reason });
}
export function cancelJobTicket(db, id, reason) {
  return setJobTicketStatusV2(db, id, JOB_TICKET_V2.CANCELED, { reason });
}

export function getActiveModelCount(ownerId) {
  let n = 0;
  for (const r of _modelsV2.values()) {
    if (r.status !== MODEL_MATURITY_V2.ACTIVE) continue;
    if (ownerId && r.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function getRunningJobCount(ownerId) {
  let n = 0;
  for (const r of _jobTicketsV2.values()) {
    if (r.status !== JOB_TICKET_V2.RUNNING) continue;
    if (ownerId && r.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function autoRetireIdleModels(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _modelsV2.values()) {
    if (
      r.status === MODEL_MATURITY_V2.ACTIVE ||
      r.status === MODEL_MATURITY_V2.DEPRECATED
    ) {
      if (now - r.lastUsedAt > _modelIdleMsV2) {
        r.status = MODEL_MATURITY_V2.RETIRED;
        r.updatedAt = now;
        r.lastReason = "idle";
        flipped.push(r.modelId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckJobTickets(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _jobTicketsV2.values()) {
    if (r.status === JOB_TICKET_V2.RUNNING) {
      const anchor = r.startedAt || r.createdAt;
      if (now - anchor > _jobStuckMsV2) {
        r.status = JOB_TICKET_V2.FAILED;
        r.updatedAt = now;
        r.lastReason = "stuck_timeout";
        flipped.push(r.ticketId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function getQuantizationStatsV2() {
  const modelsByStatus = {};
  for (const s of Object.values(MODEL_MATURITY_V2)) modelsByStatus[s] = 0;
  const ticketsByStatus = {};
  for (const s of Object.values(JOB_TICKET_V2)) ticketsByStatus[s] = 0;
  for (const r of _modelsV2.values()) modelsByStatus[r.status]++;
  for (const r of _jobTicketsV2.values()) ticketsByStatus[r.status]++;
  return {
    totalModelsV2: _modelsV2.size,
    totalTicketsV2: _jobTicketsV2.size,
    maxActiveModelsPerOwner: _maxActiveModelsPerOwnerV2,
    maxRunningJobsPerOwner: _maxRunningJobsPerOwnerV2,
    modelIdleMs: _modelIdleMsV2,
    jobStuckMs: _jobStuckMsV2,
    modelsByStatus,
    ticketsByStatus,
  };
}

export function _resetStateV2() {
  _maxActiveModelsPerOwnerV2 = QUANT_DEFAULT_MAX_ACTIVE_MODELS_PER_OWNER;
  _maxRunningJobsPerOwnerV2 = QUANT_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
  _modelIdleMsV2 = QUANT_DEFAULT_MODEL_IDLE_MS;
  _jobStuckMsV2 = QUANT_DEFAULT_JOB_STUCK_MS;
  _modelsV2.clear();
  _jobTicketsV2.clear();
}

// =====================================================================
// quantization V2 governance overlay (iter18)
// =====================================================================
export const QNTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const QNTGOV_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  QUANTIZING: "quantizing",
  QUANTIZED: "quantized",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _qntgovPTrans = new Map([
  [
    QNTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      QNTGOV_PROFILE_MATURITY_V2.ACTIVE,
      QNTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    QNTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      QNTGOV_PROFILE_MATURITY_V2.STALE,
      QNTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    QNTGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      QNTGOV_PROFILE_MATURITY_V2.ACTIVE,
      QNTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [QNTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _qntgovPTerminal = new Set([QNTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _qntgovJTrans = new Map([
  [
    QNTGOV_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING,
      QNTGOV_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING,
    new Set([
      QNTGOV_JOB_LIFECYCLE_V2.QUANTIZED,
      QNTGOV_JOB_LIFECYCLE_V2.FAILED,
      QNTGOV_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [QNTGOV_JOB_LIFECYCLE_V2.QUANTIZED, new Set()],
  [QNTGOV_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [QNTGOV_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _qntgovPsV2 = new Map();
const _qntgovJsV2 = new Map();
let _qntgovMaxActive = 6,
  _qntgovMaxPending = 12,
  _qntgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _qntgovStuckMs = 60 * 1000;
function _qntgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _qntgovCheckP(from, to) {
  const a = _qntgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid qntgov profile transition ${from} → ${to}`);
}
function _qntgovCheckJ(from, to) {
  const a = _qntgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid qntgov job transition ${from} → ${to}`);
}
function _qntgovCountActive(owner) {
  let c = 0;
  for (const p of _qntgovPsV2.values())
    if (p.owner === owner && p.status === QNTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _qntgovCountPending(profileId) {
  let c = 0;
  for (const j of _qntgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === QNTGOV_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING)
    )
      c++;
  return c;
}
export function setMaxActiveQntgovProfilesPerOwnerV2(n) {
  _qntgovMaxActive = _qntgovPos(n, "maxActiveQntgovProfilesPerOwner");
}
export function getMaxActiveQntgovProfilesPerOwnerV2() {
  return _qntgovMaxActive;
}
export function setMaxPendingQntgovJobsPerProfileV2(n) {
  _qntgovMaxPending = _qntgovPos(n, "maxPendingQntgovJobsPerProfile");
}
export function getMaxPendingQntgovJobsPerProfileV2() {
  return _qntgovMaxPending;
}
export function setQntgovProfileIdleMsV2(n) {
  _qntgovIdleMs = _qntgovPos(n, "qntgovProfileIdleMs");
}
export function getQntgovProfileIdleMsV2() {
  return _qntgovIdleMs;
}
export function setQntgovJobStuckMsV2(n) {
  _qntgovStuckMs = _qntgovPos(n, "qntgovJobStuckMs");
}
export function getQntgovJobStuckMsV2() {
  return _qntgovStuckMs;
}
export function _resetStateQuantizationGovV2() {
  _qntgovPsV2.clear();
  _qntgovJsV2.clear();
  _qntgovMaxActive = 6;
  _qntgovMaxPending = 12;
  _qntgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _qntgovStuckMs = 60 * 1000;
}
export function registerQntgovProfileV2({
  id,
  owner,
  precision,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_qntgovPsV2.has(id))
    throw new Error(`qntgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    precision: precision || "int8",
    status: QNTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _qntgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateQntgovProfileV2(id) {
  const p = _qntgovPsV2.get(id);
  if (!p) throw new Error(`qntgov profile ${id} not found`);
  const isInitial = p.status === QNTGOV_PROFILE_MATURITY_V2.PENDING;
  _qntgovCheckP(p.status, QNTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _qntgovCountActive(p.owner) >= _qntgovMaxActive)
    throw new Error(`max active qntgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = QNTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleQntgovProfileV2(id) {
  const p = _qntgovPsV2.get(id);
  if (!p) throw new Error(`qntgov profile ${id} not found`);
  _qntgovCheckP(p.status, QNTGOV_PROFILE_MATURITY_V2.STALE);
  p.status = QNTGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveQntgovProfileV2(id) {
  const p = _qntgovPsV2.get(id);
  if (!p) throw new Error(`qntgov profile ${id} not found`);
  _qntgovCheckP(p.status, QNTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = QNTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchQntgovProfileV2(id) {
  const p = _qntgovPsV2.get(id);
  if (!p) throw new Error(`qntgov profile ${id} not found`);
  if (_qntgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal qntgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getQntgovProfileV2(id) {
  const p = _qntgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listQntgovProfilesV2() {
  return [..._qntgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createQntgovJobV2({ id, profileId, model, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_qntgovJsV2.has(id)) throw new Error(`qntgov job ${id} already exists`);
  if (!_qntgovPsV2.has(profileId))
    throw new Error(`qntgov profile ${profileId} not found`);
  if (_qntgovCountPending(profileId) >= _qntgovMaxPending)
    throw new Error(`max pending qntgov jobs for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    model: model || "",
    status: QNTGOV_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _qntgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function quantizingQntgovJobV2(id) {
  const j = _qntgovJsV2.get(id);
  if (!j) throw new Error(`qntgov job ${id} not found`);
  _qntgovCheckJ(j.status, QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING);
  const now = Date.now();
  j.status = QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeJobQntgovV2(id) {
  const j = _qntgovJsV2.get(id);
  if (!j) throw new Error(`qntgov job ${id} not found`);
  _qntgovCheckJ(j.status, QNTGOV_JOB_LIFECYCLE_V2.QUANTIZED);
  const now = Date.now();
  j.status = QNTGOV_JOB_LIFECYCLE_V2.QUANTIZED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failQntgovJobV2(id, reason) {
  const j = _qntgovJsV2.get(id);
  if (!j) throw new Error(`qntgov job ${id} not found`);
  _qntgovCheckJ(j.status, QNTGOV_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = QNTGOV_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelQntgovJobV2(id, reason) {
  const j = _qntgovJsV2.get(id);
  if (!j) throw new Error(`qntgov job ${id} not found`);
  _qntgovCheckJ(j.status, QNTGOV_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = QNTGOV_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getQntgovJobV2(id) {
  const j = _qntgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listQntgovJobsV2() {
  return [..._qntgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleQntgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _qntgovPsV2.values())
    if (
      p.status === QNTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _qntgovIdleMs
    ) {
      p.status = QNTGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckQntgovJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _qntgovJsV2.values())
    if (
      j.status === QNTGOV_JOB_LIFECYCLE_V2.QUANTIZING &&
      j.startedAt != null &&
      t - j.startedAt >= _qntgovStuckMs
    ) {
      j.status = QNTGOV_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getQuantizationGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(QNTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _qntgovPsV2.values()) profilesByStatus[p.status]++;
  const jobsByStatus = {};
  for (const v of Object.values(QNTGOV_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _qntgovJsV2.values()) jobsByStatus[j.status]++;
  return {
    totalQntgovProfilesV2: _qntgovPsV2.size,
    totalQntgovJobsV2: _qntgovJsV2.size,
    maxActiveQntgovProfilesPerOwner: _qntgovMaxActive,
    maxPendingQntgovJobsPerProfile: _qntgovMaxPending,
    qntgovProfileIdleMs: _qntgovIdleMs,
    qntgovJobStuckMs: _qntgovStuckMs,
    profilesByStatus,
    jobsByStatus,
  };
}
