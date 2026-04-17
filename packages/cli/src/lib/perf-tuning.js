/**
 * Performance Auto-Tuning — CLI port of Phase 22
 * (docs/design/modules/22_性能自动调优.md).
 *
 * Desktop exposes 25 IPC handlers (12 AutoTuner + 13 PerformanceMonitor)
 * around a 10s ring buffer (8640 samples × 10s = 24h) with 5 built-in rules,
 * hysteresis protection, cooldown windows, and EventEmitter-driven alerts.
 *
 * CLI port ships:
 *
 *   - Real `os` / `process.memoryUsage()` sampling (no simulation)
 *   - SQLite-backed ring buffer (survives across invocations)
 *   - 5 built-in rule templates — `evaluate` returns recommendations,
 *     the CLI NEVER auto-applies actions (explicit `apply-recommendation`)
 *   - Hysteresis (consecutiveRequired + cooldownMs) tracked per rule
 *   - Simple threshold alerts
 *
 * What does NOT port: IPC interceptor, database query wrapper, auto-start
 * timer, per-process electron handle count, disk-io deltas, EventEmitter
 * event bus, auto-vacuum/GC actions (CLI just reports).
 */

import os from "os";
import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const DEFAULT_MAX_SAMPLES = 8640; // 24h @ 10s
export const DEFAULT_SAMPLE_INTERVAL_MS = 10_000;

export const ALERT_LEVELS = Object.freeze({
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
});

export const RECOMMENDATION_STATUS = Object.freeze({
  PENDING: "pending",
  APPLIED: "applied",
  DISMISSED: "dismissed",
});

export const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  cpuPercent: 85,
  memoryPercent: 85,
  heapPercent: 90,
  loadPerCore: 1.5,
});

export const BUILTIN_RULES = Object.freeze([
  Object.freeze({
    id: "memory-pressure",
    name: "内存压力",
    description: "进程堆使用率或系统内存使用率过高",
    condition: { metric: "memoryPercent", op: ">", value: 80 },
    action: "清理缓存 / 触发 GC / 减少并发",
    severity: ALERT_LEVELS.WARNING,
    consecutiveRequired: 3,
    cooldownMs: 2 * 60_000,
  }),
  Object.freeze({
    id: "cpu-saturation",
    name: "CPU 饱和",
    description: "CPU 使用率持续高于阈值",
    condition: { metric: "cpuPercent", op: ">", value: 90 },
    action: "降低采样频率 / 限制并行任务",
    severity: ALERT_LEVELS.WARNING,
    consecutiveRequired: 3,
    cooldownMs: 3 * 60_000,
  }),
  Object.freeze({
    id: "heap-leak",
    name: "堆增长异常",
    description: "进程堆使用率持续接近上限，疑似内存泄漏",
    condition: { metric: "heapPercent", op: ">", value: 90 },
    action: "Dump heap / 重启 worker / 缩小 cache",
    severity: ALERT_LEVELS.CRITICAL,
    consecutiveRequired: 5,
    cooldownMs: 10 * 60_000,
  }),
  Object.freeze({
    id: "load-average",
    name: "负载过高",
    description: "1 分钟系统负载除以核心数超过阈值",
    condition: { metric: "loadPerCore", op: ">", value: 1.5 },
    action: "限流后台任务 / 延迟批处理",
    severity: ALERT_LEVELS.WARNING,
    consecutiveRequired: 3,
    cooldownMs: 5 * 60_000,
  }),
  Object.freeze({
    id: "db-slow-queries",
    name: "慢查询",
    description: "慢查询计数器超过阈值 (需外部 feeder)",
    condition: { metric: "slowQueries", op: ">", value: 5 },
    action: "建索引 / 重写查询 / 切分事务",
    severity: ALERT_LEVELS.WARNING,
    consecutiveRequired: 2,
    cooldownMs: 5 * 60_000,
  }),
]);

/* ── Helpers ────────────────────────────────────────────── */

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

function _parseMaybe(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
}

function _round(v, digits = 2) {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensurePerfTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS perf_samples (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    cpu_percent REAL,
    memory_percent REAL,
    heap_used INTEGER,
    heap_total INTEGER,
    heap_percent REAL,
    rss INTEGER,
    load1 REAL,
    load_per_core REAL,
    free_mem INTEGER,
    total_mem INTEGER,
    extra TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS perf_rule_state (
    rule_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    consecutive_count INTEGER DEFAULT 0,
    last_triggered_at INTEGER,
    total_triggered INTEGER DEFAULT 0,
    overrides TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS perf_recommendations (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    severity TEXT,
    description TEXT,
    metric TEXT,
    metric_value REAL,
    threshold REAL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    note TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS perf_tuning_history (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    action TEXT,
    result TEXT,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS perf_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
}

/* ── Config ─────────────────────────────────────────────── */

export function getPerfConfig(db) {
  const rows = db.prepare("SELECT key, value FROM perf_config").all();
  const out = {
    maxSamples: DEFAULT_MAX_SAMPLES,
    sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
    thresholds: { ...DEFAULT_ALERT_THRESHOLDS },
  };
  for (const r of rows) {
    const v = _parseMaybe(r.value);
    if (r.key === "maxSamples" && typeof v === "number") out.maxSamples = v;
    else if (r.key === "sampleIntervalMs" && typeof v === "number")
      out.sampleIntervalMs = v;
    else if (r.key === "thresholds" && v && typeof v === "object")
      out.thresholds = { ...out.thresholds, ...v };
  }
  return out;
}

export function setPerfConfig(db, patch = {}) {
  const merged = { ...getPerfConfig(db), ...patch };
  if (patch.thresholds) {
    merged.thresholds = {
      ...getPerfConfig(db).thresholds,
      ...patch.thresholds,
    };
  }
  const upsert = (k, v) =>
    db
      .prepare(
        "INSERT INTO perf_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(k, JSON.stringify(v));
  upsert("maxSamples", merged.maxSamples);
  upsert("sampleIntervalMs", merged.sampleIntervalMs);
  upsert("thresholds", merged.thresholds);
  return merged;
}

/* ── Sampling ───────────────────────────────────────────── */

export function collectSampleRaw({ slowQueries } = {}) {
  const cpus = os.cpus() || [];
  const totalCpu = cpus.reduce((acc, c) => {
    for (const [k, v] of Object.entries(c.times)) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
  const cpuBusy =
    (totalCpu.user || 0) + (totalCpu.sys || 0) + (totalCpu.irq || 0);
  const cpuTotal = Object.values(totalCpu).reduce((a, b) => a + b, 0) || 1;
  const cpuPercent = _round((cpuBusy / cpuTotal) * 100);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryPercent = _round(((totalMem - freeMem) / totalMem) * 100);

  const mem = process.memoryUsage?.() || {
    heapUsed: 0,
    heapTotal: 1,
    rss: 0,
  };
  const heapPercent = _round((mem.heapUsed / (mem.heapTotal || 1)) * 100);

  const load = os.loadavg?.() || [0, 0, 0];
  const cores = cpus.length || 1;
  const loadPerCore = _round((load[0] || 0) / cores, 3);

  return {
    ts: _now(),
    cpuPercent,
    memoryPercent,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    heapPercent,
    rss: mem.rss,
    load1: _round(load[0] || 0, 3),
    loadPerCore,
    freeMem,
    totalMem,
    extra: { slowQueries: slowQueries ?? 0, cores },
  };
}

export function collectSample(db, input = {}) {
  const s = collectSampleRaw(input);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO perf_samples (id, ts, cpu_percent, memory_percent, heap_used, heap_total, heap_percent, rss, load1, load_per_core, free_mem, total_mem, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    s.ts,
    s.cpuPercent,
    s.memoryPercent,
    s.heapUsed,
    s.heapTotal,
    s.heapPercent,
    s.rss,
    s.load1,
    s.loadPerCore,
    s.freeMem,
    s.totalMem,
    JSON.stringify(s.extra),
  );
  _trimRingBuffer(db);
  return { id, ...s };
}

function _trimRingBuffer(db) {
  const cfg = getPerfConfig(db);
  const all = db
    .prepare("SELECT id, ts FROM perf_samples")
    .all()
    .sort((a, b) => b.ts - a.ts);
  if (all.length <= cfg.maxSamples) return 0;
  const toDelete = all.slice(cfg.maxSamples);
  for (const r of toDelete) {
    db.prepare("DELETE FROM perf_samples WHERE id = ?").run(r.id);
  }
  return toDelete.length;
}

export function listSamples(db, { limit = 100, sinceMs } = {}) {
  let rows = db.prepare("SELECT * FROM perf_samples").all();
  rows = rows.map(_strip);
  if (sinceMs) {
    const cutoff = _now() - sinceMs;
    rows = rows.filter((r) => r.ts >= cutoff);
  }
  return rows
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map(_toSampleOut)
    .reverse();
}

function _toSampleOut(r) {
  return {
    id: r.id,
    ts: r.ts,
    cpuPercent: r.cpu_percent,
    memoryPercent: r.memory_percent,
    heapUsed: r.heap_used,
    heapTotal: r.heap_total,
    heapPercent: r.heap_percent,
    rss: r.rss,
    load1: r.load1,
    loadPerCore: r.load_per_core,
    freeMem: r.free_mem,
    totalMem: r.total_mem,
    extra: _parseMaybe(r.extra) || {},
  };
}

export function getLatestSample(db) {
  const rows = listSamples(db, { limit: 1 });
  return rows[rows.length - 1] || null;
}

export function clearHistory(db) {
  const rows = db.prepare("SELECT id FROM perf_samples").all();
  for (const r of rows)
    db.prepare("DELETE FROM perf_samples WHERE id = ?").run(r.id);
  return { cleared: rows.length };
}

/* ── Rules ──────────────────────────────────────────────── */

export function listRules(db) {
  const states = db.prepare("SELECT * FROM perf_rule_state").all().map(_strip);
  const byId = new Map(states.map((s) => [s.rule_id, s]));
  return BUILTIN_RULES.map((r) => {
    const st = byId.get(r.id);
    return {
      ...r,
      enabled: st ? !!st.enabled : true,
      consecutiveCount: st?.consecutive_count || 0,
      lastTriggeredAt: st?.last_triggered_at || null,
      totalTriggered: st?.total_triggered || 0,
    };
  });
}

export function getRule(db, ruleId) {
  return listRules(db).find((r) => r.id === ruleId) || null;
}

function _ensureRuleState(db, ruleId) {
  const existing = db
    .prepare("SELECT * FROM perf_rule_state WHERE rule_id = ?")
    .get(ruleId);
  if (existing) return _strip(existing);
  db.prepare(
    `INSERT INTO perf_rule_state (rule_id, enabled, consecutive_count, last_triggered_at, total_triggered)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(ruleId, 1, 0, null, 0);
  return {
    rule_id: ruleId,
    enabled: 1,
    consecutive_count: 0,
    last_triggered_at: null,
    total_triggered: 0,
  };
}

export function setRuleEnabled(db, ruleId, enabled) {
  if (!BUILTIN_RULES.find((r) => r.id === ruleId))
    return { updated: false, reason: "unknown_rule" };
  _ensureRuleState(db, ruleId);
  db.prepare("UPDATE perf_rule_state SET enabled = ? WHERE rule_id = ?").run(
    enabled ? 1 : 0,
    ruleId,
  );
  return { updated: true, ruleId, enabled: !!enabled };
}

/* ── Evaluation ─────────────────────────────────────────── */

function _pickMetric(sample, name) {
  if (!sample) return null;
  if (name === "cpuPercent") return sample.cpuPercent;
  if (name === "memoryPercent") return sample.memoryPercent;
  if (name === "heapPercent") return sample.heapPercent;
  if (name === "loadPerCore") return sample.loadPerCore;
  if (name === "slowQueries") return sample.extra?.slowQueries ?? 0;
  return sample[name] ?? null;
}

function _testCondition(value, op, threshold) {
  if (value == null) return false;
  switch (op) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    default:
      return false;
  }
}

export function evaluateRules(db, { sample } = {}) {
  const s = sample || getLatestSample(db) || collectSampleRaw();
  const rules = listRules(db);
  const now = _now();
  const triggered = [];
  const skipped = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      skipped.push({ ruleId: rule.id, reason: "disabled" });
      continue;
    }
    const val = _pickMetric(s, rule.condition.metric);
    const conditionMet = _testCondition(
      val,
      rule.condition.op,
      rule.condition.value,
    );

    const st = _ensureRuleState(db, rule.id);
    if (!conditionMet) {
      if (st.consecutive_count > 0) {
        db.prepare(
          "UPDATE perf_rule_state SET consecutive_count = ? WHERE rule_id = ?",
        ).run(0, rule.id);
      }
      skipped.push({
        ruleId: rule.id,
        reason: "condition_unmet",
        metric: rule.condition.metric,
        value: val,
      });
      continue;
    }

    const newConsecutive = (st.consecutive_count || 0) + 1;
    if (newConsecutive < rule.consecutiveRequired) {
      db.prepare(
        "UPDATE perf_rule_state SET consecutive_count = ? WHERE rule_id = ?",
      ).run(newConsecutive, rule.id);
      skipped.push({
        ruleId: rule.id,
        reason: "hysteresis",
        consecutive: newConsecutive,
        required: rule.consecutiveRequired,
      });
      continue;
    }

    const cooldownRemaining =
      st.last_triggered_at != null
        ? rule.cooldownMs - (now - st.last_triggered_at)
        : 0;
    if (cooldownRemaining > 0) {
      skipped.push({
        ruleId: rule.id,
        reason: "cooldown",
        remainingMs: cooldownRemaining,
      });
      continue;
    }

    const nextTotal = (st.total_triggered || 0) + 1;
    db.prepare(
      `UPDATE perf_rule_state SET consecutive_count = ?, last_triggered_at = ?, total_triggered = ? WHERE rule_id = ?`,
    ).run(0, now, nextTotal, rule.id);

    const recId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO perf_recommendations (id, rule_id, severity, description, metric, metric_value, threshold, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      recId,
      rule.id,
      rule.severity,
      rule.action,
      rule.condition.metric,
      val,
      rule.condition.value,
      RECOMMENDATION_STATUS.PENDING,
      now,
    );

    db.prepare(
      `INSERT INTO perf_tuning_history (id, rule_id, action, result, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      rule.id,
      "trigger",
      JSON.stringify({
        metric: rule.condition.metric,
        value: val,
        threshold: rule.condition.value,
      }),
      now,
    );

    triggered.push({
      ruleId: rule.id,
      severity: rule.severity,
      metric: rule.condition.metric,
      value: val,
      threshold: rule.condition.value,
      action: rule.action,
      recommendationId: recId,
    });
  }

  return { triggered, skipped, sample: s, evaluatedAt: now };
}

/* ── Recommendations ────────────────────────────────────── */

export function listRecommendations(db, { status, limit = 100 } = {}) {
  let rows = db.prepare("SELECT * FROM perf_recommendations").all();
  rows = rows.map(_strip);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map(_toRecOut);
}

function _toRecOut(r) {
  return {
    id: r.id,
    ruleId: r.rule_id,
    severity: r.severity,
    description: r.description,
    metric: r.metric,
    metricValue: r.metric_value,
    threshold: r.threshold,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    note: r.note,
  };
}

export function applyRecommendation(db, id, { note } = {}) {
  const row = _strip(
    db.prepare("SELECT * FROM perf_recommendations WHERE id = ?").get(id),
  );
  if (!row) return { applied: false, reason: "not_found" };
  if (row.status !== RECOMMENDATION_STATUS.PENDING)
    return { applied: false, reason: "not_pending", status: row.status };
  const now = _now();
  db.prepare(
    "UPDATE perf_recommendations SET status = ?, resolved_at = ?, note = ? WHERE id = ?",
  ).run(RECOMMENDATION_STATUS.APPLIED, now, note || null, id);
  db.prepare(
    `INSERT INTO perf_tuning_history (id, rule_id, action, result, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    row.rule_id,
    "apply",
    JSON.stringify({ recommendationId: id, note: note || null }),
    now,
  );
  return { applied: true, id, appliedAt: now };
}

export function dismissRecommendation(db, id, { note } = {}) {
  const row = _strip(
    db.prepare("SELECT * FROM perf_recommendations WHERE id = ?").get(id),
  );
  if (!row) return { dismissed: false, reason: "not_found" };
  if (row.status !== RECOMMENDATION_STATUS.PENDING)
    return { dismissed: false, reason: "not_pending", status: row.status };
  const now = _now();
  db.prepare(
    "UPDATE perf_recommendations SET status = ?, resolved_at = ?, note = ? WHERE id = ?",
  ).run(RECOMMENDATION_STATUS.DISMISSED, now, note || null, id);
  return { dismissed: true, id, dismissedAt: now };
}

/* ── History & Stats ────────────────────────────────────── */

export function listHistory(db, { ruleId, limit = 100 } = {}) {
  let rows = db.prepare("SELECT * FROM perf_tuning_history").all();
  rows = rows.map(_strip);
  if (ruleId) rows = rows.filter((r) => r.rule_id === ruleId);
  return rows
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      ruleId: r.rule_id,
      action: r.action,
      result: _parseMaybe(r.result),
      createdAt: r.created_at,
    }));
}

export function getAlerts(db, { sample } = {}) {
  const s = sample || getLatestSample(db);
  if (!s) return [];
  const cfg = getPerfConfig(db);
  const alerts = [];
  const push = (metric, value, threshold, level) => {
    if (value > threshold) alerts.push({ metric, value, threshold, level });
  };
  push(
    "cpuPercent",
    s.cpuPercent,
    cfg.thresholds.cpuPercent,
    ALERT_LEVELS.WARNING,
  );
  push(
    "memoryPercent",
    s.memoryPercent,
    cfg.thresholds.memoryPercent,
    ALERT_LEVELS.WARNING,
  );
  push(
    "heapPercent",
    s.heapPercent,
    cfg.thresholds.heapPercent,
    ALERT_LEVELS.CRITICAL,
  );
  push(
    "loadPerCore",
    s.loadPerCore,
    cfg.thresholds.loadPerCore,
    ALERT_LEVELS.WARNING,
  );
  return alerts;
}

export function getPerfStats(db) {
  const samples = db.prepare("SELECT * FROM perf_samples").all().map(_strip);
  const recs = db
    .prepare("SELECT status FROM perf_recommendations")
    .all()
    .map(_strip);
  const history = db.prepare("SELECT * FROM perf_tuning_history").all().length;
  const rules = listRules(db);

  const byStatus = { pending: 0, applied: 0, dismissed: 0 };
  for (const r of recs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  let avgCpu = null;
  let avgMem = null;
  let avgHeap = null;
  if (samples.length) {
    avgCpu = _round(
      samples.reduce((s, r) => s + (r.cpu_percent || 0), 0) / samples.length,
    );
    avgMem = _round(
      samples.reduce((s, r) => s + (r.memory_percent || 0), 0) / samples.length,
    );
    avgHeap = _round(
      samples.reduce((s, r) => s + (r.heap_percent || 0), 0) / samples.length,
    );
  }

  return {
    samples: samples.length,
    rules: {
      total: rules.length,
      enabled: rules.filter((r) => r.enabled).length,
      triggered: rules.reduce((s, r) => s + (r.totalTriggered || 0), 0),
    },
    recommendations: { ...byStatus, total: recs.length },
    historyEntries: history,
    averages: {
      cpuPercent: avgCpu,
      memoryPercent: avgMem,
      heapPercent: avgHeap,
    },
  };
}

export function getPerformanceReport(db) {
  const latest = getLatestSample(db);
  const alerts = getAlerts(db, { sample: latest });
  const stats = getPerfStats(db);
  const recentHistory = listHistory(db, { limit: 10 });
  const pending = listRecommendations(db, {
    status: RECOMMENDATION_STATUS.PENDING,
    limit: 10,
  });
  return {
    generatedAt: _now(),
    sample: latest,
    alerts,
    stats,
    pendingRecommendations: pending,
    recentHistory,
  };
}

/* ── Reset (for tests) ──────────────────────────────────── */

export function _resetState() {
  /* CLI is stateless; helper exists for parity with other libs */
}
