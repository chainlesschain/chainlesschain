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
