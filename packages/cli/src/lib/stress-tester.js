/**
 * Stress Tester — federation stress test orchestration.
 *
 * CLI-first simulation: we don't drive real peer RPCs here (no federation
 * fixture in the CLI boot path). Instead we generate deterministic synthetic
 * metrics from the load profile so operators can sanity-check capacity planning
 * wiring, bottleneck heuristics, and report shapes before running the real
 * Desktop stress harness.
 */

import crypto from "crypto";

/* ── Load levels ──────────────────────────────────────────── */

export const LOAD_LEVELS = Object.freeze({
  LIGHT: {
    name: "light",
    concurrency: 10,
    requestsPerSecond: 50,
    duration: 300000,
  },
  MEDIUM: {
    name: "medium",
    concurrency: 50,
    requestsPerSecond: 200,
    duration: 600000,
  },
  HEAVY: {
    name: "heavy",
    concurrency: 100,
    requestsPerSecond: 500,
    duration: 900000,
  },
  EXTREME: {
    name: "extreme",
    concurrency: 200,
    requestsPerSecond: 1000,
    duration: 1800000,
  },
});

const LEVEL_INDEX = new Map(Object.values(LOAD_LEVELS).map((l) => [l.name, l]));

export function resolveLevel(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  return LEVEL_INDEX.get(key) || null;
}

export function listLoadLevels() {
  return Object.values(LOAD_LEVELS).map((l) => ({ ...l }));
}

const RUN_STATUS = {
  RUNNING: "running",
  COMPLETE: "complete",
  STOPPED: "stopped",
  FAILED: "failed",
};

/* ── In-memory stores ─────────────────────────────────────── */
const _runs = new Map();
const _results = new Map();
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureStressTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stress_test_runs (
      test_id TEXT PRIMARY KEY,
      load_level TEXT NOT NULL,
      concurrency INTEGER NOT NULL,
      requests_per_second INTEGER,
      duration INTEGER NOT NULL,
      status TEXT DEFAULT 'running',
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stress_test_results (
      result_id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      tps REAL,
      avg_response_time REAL,
      p50_response_time REAL,
      p95_response_time REAL,
      p99_response_time REAL,
      error_rate REAL,
      bottlenecks TEXT,
      capacity_recommendations TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

/* ── Synthetic metrics ─────────────────────────────────────── */

// Deterministic quasi-random: stable across runs for the same inputs. Tests
// assert shape + monotonicity, not exact floats, so this is plenty.
function _mix(seed, offset) {
  const v = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function _synthesizeMetrics(config, seed) {
  const concurrency = config.concurrency;
  const targetRps = config.requestsPerSecond;

  // Model: realized TPS decays as concurrency pushes past optimal; latency
  // grows super-linearly. Error rate stays near zero until EXTREME territory.
  const saturation = Math.min(1, concurrency / 150);
  const jitter = 0.85 + _mix(seed, 1) * 0.3; // 0.85..1.15
  const tps = targetRps * (1 - saturation * 0.25) * jitter;

  const baseLatency = 8 + concurrency * 0.8;
  const p50 = baseLatency * (0.7 + _mix(seed, 2) * 0.2);
  const p95 = baseLatency * (1.8 + _mix(seed, 3) * 0.5);
  const p99 = baseLatency * (3.2 + _mix(seed, 4) * 1.2);
  const avg = p50 * 0.6 + p95 * 0.3 + p99 * 0.1;

  const errorRate = Math.min(
    0.5,
    Math.max(0, (saturation - 0.5) * 0.18 + _mix(seed, 5) * 0.02),
  );

  return {
    tps: Number(tps.toFixed(2)),
    avgResponseTime: Number(avg.toFixed(2)),
    p50ResponseTime: Number(p50.toFixed(2)),
    p95ResponseTime: Number(p95.toFixed(2)),
    p99ResponseTime: Number(p99.toFixed(2)),
    errorRate: Number(errorRate.toFixed(4)),
  };
}

/* ── Bottleneck heuristics ─────────────────────────────────── */

function _deriveBottlenecks(metrics, config) {
  const bottlenecks = [];
  if (metrics.errorRate > 0.05) {
    bottlenecks.push({
      kind: "error-rate",
      severity: "high",
      detail: `Error rate ${(metrics.errorRate * 100).toFixed(2)}% exceeds 5%`,
    });
  }
  if (metrics.p99ResponseTime > 1500) {
    bottlenecks.push({
      kind: "tail-latency",
      severity: "high",
      detail: `p99 ${metrics.p99ResponseTime.toFixed(0)}ms above 1500ms tail`,
    });
  } else if (metrics.p95ResponseTime > 500) {
    bottlenecks.push({
      kind: "response-time",
      severity: "medium",
      detail: `p95 ${metrics.p95ResponseTime.toFixed(0)}ms above 500ms target`,
    });
  }
  const targetRps = config.requestsPerSecond;
  if (metrics.tps < targetRps * 0.85) {
    bottlenecks.push({
      kind: "throughput",
      severity: "medium",
      detail: `Realized TPS ${metrics.tps.toFixed(0)} below 85% of target ${targetRps}`,
    });
  }
  return bottlenecks;
}

function _capacityRecommendations(metrics, config, bottlenecks) {
  const recs = [];
  for (const b of bottlenecks) {
    if (b.kind === "error-rate") {
      recs.push("Reduce concurrency or add retry/backoff on failing RPCs");
    }
    if (b.kind === "tail-latency") {
      recs.push(
        "Investigate slow-path outliers (DB lock / GC pause / cold peer)",
      );
    }
    if (b.kind === "response-time") {
      recs.push("Profile hot handlers; consider caching or connection pooling");
    }
    if (b.kind === "throughput") {
      recs.push(
        `Scale horizontally: estimated ${Math.ceil(config.requestsPerSecond / Math.max(1, metrics.tps))}× current capacity needed for target`,
      );
    }
  }
  if (recs.length === 0) {
    recs.push("System is within targets at this load level");
  }
  return recs;
}

/* ── Test lifecycle ────────────────────────────────────────── */

export function startStressTest(db, config = {}) {
  const levelName = config.level || "medium";
  const level = resolveLevel(levelName);
  if (!level) {
    throw new Error(
      `Unknown load level: ${levelName} (known: ${[...LEVEL_INDEX.keys()].join("/")})`,
    );
  }

  const concurrency = Number(config.concurrency ?? level.concurrency);
  const requestsPerSecond = Number(
    config.requestsPerSecond ?? level.requestsPerSecond,
  );
  const duration = Number(config.duration ?? level.duration);
  if (concurrency <= 0 || duration <= 0 || requestsPerSecond <= 0) {
    throw new Error("concurrency/duration/requestsPerSecond must all be > 0");
  }

  const testId = crypto.randomUUID();
  const now = Date.now();

  const run = {
    testId,
    loadLevel: level.name,
    concurrency,
    requestsPerSecond,
    duration,
    status: RUN_STATUS.RUNNING,
    startedAt: now,
    completedAt: null,
    _seq: ++_seq,
  };

  db.prepare(
    `INSERT INTO stress_test_runs (test_id, load_level, concurrency, requests_per_second, duration, status, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    testId,
    level.name,
    concurrency,
    requestsPerSecond,
    duration,
    run.status,
    now,
    null,
  );

  const seed = _hashSeed(testId);
  const metrics = _synthesizeMetrics(
    { concurrency, requestsPerSecond, duration },
    seed,
  );
  const bottlenecks = _deriveBottlenecks(metrics, { requestsPerSecond });
  const recommendations = _capacityRecommendations(
    metrics,
    { requestsPerSecond },
    bottlenecks,
  );

  const resultId = crypto.randomUUID();
  const result = {
    resultId,
    testId,
    ...metrics,
    bottlenecks,
    capacityRecommendations: recommendations,
    createdAt: now,
  };
  _results.set(testId, result);

  db.prepare(
    `INSERT INTO stress_test_results (result_id, test_id, tps, avg_response_time, p50_response_time, p95_response_time, p99_response_time, error_rate, bottlenecks, capacity_recommendations, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    resultId,
    testId,
    metrics.tps,
    metrics.avgResponseTime,
    metrics.p50ResponseTime,
    metrics.p95ResponseTime,
    metrics.p99ResponseTime,
    metrics.errorRate,
    JSON.stringify(bottlenecks),
    JSON.stringify(recommendations),
    now,
  );

  run.status = RUN_STATUS.COMPLETE;
  run.completedAt = now;
  _runs.set(testId, run);

  db.prepare(
    `UPDATE stress_test_runs SET status = ?, completed_at = ? WHERE test_id = ?`,
  ).run(RUN_STATUS.COMPLETE, now, testId);

  return { ...run, result };
}

export function stopStressTest(testId) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);
  if (run.status === RUN_STATUS.RUNNING) {
    run.status = RUN_STATUS.STOPPED;
    run.completedAt = Date.now();
  }
  return { ...run };
}

export function getTestResults(testId) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);
  const result = _results.get(testId) || null;
  return { ...run, result };
}

export function listTestHistory(filter = {}) {
  let runs = [..._runs.values()];
  if (filter.level) runs = runs.filter((r) => r.loadLevel === filter.level);
  if (filter.status) runs = runs.filter((r) => r.status === filter.status);
  runs.sort((a, b) => b.startedAt - a.startedAt || b._seq - a._seq);
  const limit = filter.limit || 10;
  return runs.slice(0, limit).map((r) => {
    const { _seq: _omit, ...rest } = r;
    void _omit;
    return rest;
  });
}

export function analyzeBottlenecks(testId) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);
  const result = _results.get(testId);
  if (!result) {
    return { testId, bottlenecks: [], summary: "No results recorded" };
  }
  return {
    testId,
    bottlenecks: result.bottlenecks,
    summary: result.bottlenecks.length
      ? `${result.bottlenecks.length} bottleneck(s) detected`
      : "No bottlenecks detected",
  };
}

export function generateCapacityPlan(testId) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);
  const result = _results.get(testId);
  if (!result) {
    return { testId, recommendations: [], scale: 1 };
  }
  const targetRps = run.requestsPerSecond;
  const realizedTps = result.tps || 0;
  const scale = realizedTps > 0 ? Math.max(1, targetRps / realizedTps) : 1;
  return {
    testId,
    loadLevel: run.loadLevel,
    targetRps,
    realizedTps,
    recommendations: result.capacityRecommendations,
    scale: Number(scale.toFixed(2)),
    headroom:
      realizedTps >= targetRps
        ? "sufficient"
        : realizedTps >= targetRps * 0.85
          ? "marginal"
          : "insufficient",
  };
}

function _hashSeed(testId) {
  let h = 0;
  for (let i = 0; i < testId.length; i++) {
    h = (h * 31 + testId.charCodeAt(i)) >>> 0;
  }
  return (h % 100000) / 100000;
}

export function _resetState() {
  _runs.clear();
  _results.clear();
  _seq = 0;
  _maxConcurrentTests = DEFAULT_MAX_CONCURRENT_TESTS;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Canonical Surface (Phase 59 — Federation Stress Test)
 *   Strictly additive; legacy exports above remain unchanged.
 * ═══════════════════════════════════════════════════════════════ */

export const RUN_STATUS_V2 = Object.freeze({
  RUNNING: "running",
  COMPLETE: "complete",
  STOPPED: "stopped",
  FAILED: "failed",
});

export const LEVEL_NAME_V2 = Object.freeze({
  LIGHT: "light",
  MEDIUM: "medium",
  HEAVY: "heavy",
  EXTREME: "extreme",
});

export const BOTTLENECK_KIND_V2 = Object.freeze({
  ERROR_RATE: "error-rate",
  TAIL_LATENCY: "tail-latency",
  RESPONSE_TIME: "response-time",
  THROUGHPUT: "throughput",
});

export const BOTTLENECK_SEVERITY_V2 = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const DEFAULT_MAX_CONCURRENT_TESTS = 3;
let _maxConcurrentTests = DEFAULT_MAX_CONCURRENT_TESTS;

export const STRESS_DEFAULT_MAX_CONCURRENT = DEFAULT_MAX_CONCURRENT_TESTS;

export function setMaxConcurrentTests(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("maxConcurrentTests must be a positive integer");
  }
  _maxConcurrentTests = Math.floor(n);
  return _maxConcurrentTests;
}

export function getMaxConcurrentTests() {
  return _maxConcurrentTests;
}

const _terminalRunStatuses = new Set([
  RUN_STATUS_V2.COMPLETE,
  RUN_STATUS_V2.STOPPED,
  RUN_STATUS_V2.FAILED,
]);

// Run state machine: running → { complete, stopped, failed }
const _allowedRunTransitions = new Map([
  [
    RUN_STATUS_V2.RUNNING,
    new Set([
      RUN_STATUS_V2.COMPLETE,
      RUN_STATUS_V2.STOPPED,
      RUN_STATUS_V2.FAILED,
    ]),
  ],
  [RUN_STATUS_V2.COMPLETE, new Set([])],
  [RUN_STATUS_V2.STOPPED, new Set([])],
  [RUN_STATUS_V2.FAILED, new Set([])],
]);

export function getActiveTestCount() {
  let count = 0;
  for (const r of _runs.values()) {
    if (r.status === RUN_STATUS_V2.RUNNING) count++;
  }
  return count;
}

/**
 * startStressTestV2 — asynchronous lifecycle variant. Creates the run row in
 * RUNNING state without computing metrics; caller is expected to call
 * completeStressTest, stopStressTestV2, or failStressTest afterwards.
 */
export function startStressTestV2(db, config = {}) {
  const levelName = config.level || LEVEL_NAME_V2.MEDIUM;
  const level = resolveLevel(levelName);
  if (!level) {
    throw new Error(
      `Unknown load level: ${levelName} (known: ${Object.values(LEVEL_NAME_V2).join("/")})`,
    );
  }

  const concurrency = Number(config.concurrency ?? level.concurrency);
  const requestsPerSecond = Number(
    config.requestsPerSecond ?? level.requestsPerSecond,
  );
  const duration = Number(config.duration ?? level.duration);
  if (concurrency <= 0 || duration <= 0 || requestsPerSecond <= 0) {
    throw new Error("concurrency/duration/requestsPerSecond must all be > 0");
  }

  const activeCount = getActiveTestCount();
  if (activeCount >= _maxConcurrentTests) {
    throw new Error(
      `Max concurrent stress tests reached: ${activeCount}/${_maxConcurrentTests}`,
    );
  }

  const testId = crypto.randomUUID();
  const now = Date.now();

  const run = {
    testId,
    loadLevel: level.name,
    concurrency,
    requestsPerSecond,
    duration,
    status: RUN_STATUS_V2.RUNNING,
    startedAt: now,
    completedAt: null,
    errorMessage: null,
    _seq: ++_seq,
  };

  _runs.set(testId, run);
  db.prepare(
    `INSERT INTO stress_test_runs (test_id, load_level, concurrency, requests_per_second, duration, status, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    testId,
    level.name,
    concurrency,
    requestsPerSecond,
    duration,
    run.status,
    now,
    null,
  );

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return rest;
}

export function completeStressTest(db, testId) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);

  const allowed = _allowedRunTransitions.get(run.status);
  if (!allowed || !allowed.has(RUN_STATUS_V2.COMPLETE)) {
    throw new Error(`Invalid run status transition: ${run.status} → complete`);
  }

  const seed = _hashSeed(testId);
  const metrics = _synthesizeMetrics(
    {
      concurrency: run.concurrency,
      requestsPerSecond: run.requestsPerSecond,
      duration: run.duration,
    },
    seed,
  );
  const bottlenecks = _deriveBottlenecks(metrics, {
    requestsPerSecond: run.requestsPerSecond,
  });
  const recommendations = _capacityRecommendations(
    metrics,
    { requestsPerSecond: run.requestsPerSecond },
    bottlenecks,
  );

  const now = Date.now();
  const resultId = crypto.randomUUID();
  const result = {
    resultId,
    testId,
    ...metrics,
    bottlenecks,
    capacityRecommendations: recommendations,
    createdAt: now,
  };
  _results.set(testId, result);

  db.prepare(
    `INSERT INTO stress_test_results (result_id, test_id, tps, avg_response_time, p50_response_time, p95_response_time, p99_response_time, error_rate, bottlenecks, capacity_recommendations, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    resultId,
    testId,
    metrics.tps,
    metrics.avgResponseTime,
    metrics.p50ResponseTime,
    metrics.p95ResponseTime,
    metrics.p99ResponseTime,
    metrics.errorRate,
    JSON.stringify(bottlenecks),
    JSON.stringify(recommendations),
    now,
  );

  run.status = RUN_STATUS_V2.COMPLETE;
  run.completedAt = now;
  db.prepare(
    `UPDATE stress_test_runs SET status = ?, completed_at = ? WHERE test_id = ?`,
  ).run(RUN_STATUS_V2.COMPLETE, now, testId);

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return { ...rest, result };
}

export function stopStressTestV2(db, testId) {
  return setRunStatus(db, testId, RUN_STATUS_V2.STOPPED);
}

export function failStressTest(db, testId, errorMessage) {
  return setRunStatus(db, testId, RUN_STATUS_V2.FAILED, { errorMessage });
}

export function setRunStatus(db, testId, newStatus, patch = {}) {
  const run = _runs.get(testId);
  if (!run) throw new Error(`Stress test not found: ${testId}`);

  const validStatuses = Object.values(RUN_STATUS_V2);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown run status: ${newStatus}`);
  }

  const allowed = _allowedRunTransitions.get(run.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid run status transition: ${run.status} → ${newStatus}`,
    );
  }

  run.status = newStatus;
  if (typeof patch.errorMessage === "string") {
    run.errorMessage = patch.errorMessage;
  }
  if (_terminalRunStatuses.has(newStatus)) {
    run.completedAt = Date.now();
  }

  db.prepare(
    `UPDATE stress_test_runs SET status = ?, completed_at = ? WHERE test_id = ?`,
  ).run(newStatus, run.completedAt, testId);

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return rest;
}

/**
 * recommendLevelV2 — suggest the largest pre-defined level whose targetRps is
 * still ≤ the caller's target. Returns `light` for any sub-light target,
 * `extreme` for anything ≥ extreme.
 */
export function recommendLevelV2(targetRps) {
  if (
    typeof targetRps !== "number" ||
    !Number.isFinite(targetRps) ||
    targetRps <= 0
  ) {
    throw new Error("targetRps must be a positive number");
  }
  const levels = Object.values(LOAD_LEVELS)
    .slice()
    .sort((a, b) => a.requestsPerSecond - b.requestsPerSecond);
  let chosen = levels[0];
  for (const level of levels) {
    if (targetRps >= level.requestsPerSecond) chosen = level;
  }
  return { ...chosen };
}

export function getStressStatsV2() {
  const runs = [..._runs.values()];
  const results = [..._results.values()];

  const byStatus = {};
  for (const s of Object.values(RUN_STATUS_V2)) byStatus[s] = 0;
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const byLevel = {};
  for (const l of Object.values(LEVEL_NAME_V2)) byLevel[l] = 0;
  for (const r of runs) byLevel[r.loadLevel] = (byLevel[r.loadLevel] || 0) + 1;

  const byKind = {};
  for (const k of Object.values(BOTTLENECK_KIND_V2)) byKind[k] = 0;
  const bySeverity = {};
  for (const s of Object.values(BOTTLENECK_SEVERITY_V2)) bySeverity[s] = 0;

  let totalTps = 0;
  let totalP95 = 0;
  let metricSamples = 0;
  let totalBottlenecks = 0;

  for (const result of results) {
    totalTps += result.tps || 0;
    totalP95 += result.p95ResponseTime || 0;
    metricSamples++;
    for (const b of result.bottlenecks || []) {
      totalBottlenecks++;
      if (byKind[b.kind] !== undefined) byKind[b.kind]++;
      if (bySeverity[b.severity] !== undefined) bySeverity[b.severity]++;
    }
  }

  return {
    totalTests: runs.length,
    activeTests: getActiveTestCount(),
    maxConcurrentTests: _maxConcurrentTests,
    byStatus,
    byLevel,
    bottlenecks: {
      total: totalBottlenecks,
      byKind,
      bySeverity,
    },
    aggregateMetrics: {
      samples: metricSamples,
      avgTps:
        metricSamples > 0 ? Number((totalTps / metricSamples).toFixed(2)) : 0,
      avgP95:
        metricSamples > 0 ? Number((totalP95 / metricSamples).toFixed(2)) : 0,
    },
  };
}

// =====================================================================
// stress-tester V2 governance overlay (iter16)
// =====================================================================
export const STRGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const STRGOV_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _strgovPTrans = new Map([
  [
    STRGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      STRGOV_PROFILE_MATURITY_V2.ACTIVE,
      STRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    STRGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      STRGOV_PROFILE_MATURITY_V2.STALE,
      STRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    STRGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      STRGOV_PROFILE_MATURITY_V2.ACTIVE,
      STRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [STRGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _strgovPTerminal = new Set([STRGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _strgovJTrans = new Map([
  [
    STRGOV_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      STRGOV_RUN_LIFECYCLE_V2.RUNNING,
      STRGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    STRGOV_RUN_LIFECYCLE_V2.RUNNING,
    new Set([
      STRGOV_RUN_LIFECYCLE_V2.COMPLETED,
      STRGOV_RUN_LIFECYCLE_V2.FAILED,
      STRGOV_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [STRGOV_RUN_LIFECYCLE_V2.COMPLETED, new Set()],
  [STRGOV_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [STRGOV_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _strgovPsV2 = new Map();
const _strgovJsV2 = new Map();
let _strgovMaxActive = 5,
  _strgovMaxPending = 10,
  _strgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _strgovStuckMs = 60 * 1000;
function _strgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _strgovCheckP(from, to) {
  const a = _strgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid strgov profile transition ${from} → ${to}`);
}
function _strgovCheckJ(from, to) {
  const a = _strgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid strgov run transition ${from} → ${to}`);
}
function _strgovCountActive(owner) {
  let c = 0;
  for (const p of _strgovPsV2.values())
    if (p.owner === owner && p.status === STRGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _strgovCountPending(profileId) {
  let c = 0;
  for (const j of _strgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === STRGOV_RUN_LIFECYCLE_V2.QUEUED ||
        j.status === STRGOV_RUN_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveStrgovProfilesPerOwnerV2(n) {
  _strgovMaxActive = _strgovPos(n, "maxActiveStrgovProfilesPerOwner");
}
export function getMaxActiveStrgovProfilesPerOwnerV2() {
  return _strgovMaxActive;
}
export function setMaxPendingStrgovRunsPerProfileV2(n) {
  _strgovMaxPending = _strgovPos(n, "maxPendingStrgovRunsPerProfile");
}
export function getMaxPendingStrgovRunsPerProfileV2() {
  return _strgovMaxPending;
}
export function setStrgovProfileIdleMsV2(n) {
  _strgovIdleMs = _strgovPos(n, "strgovProfileIdleMs");
}
export function getStrgovProfileIdleMsV2() {
  return _strgovIdleMs;
}
export function setStrgovRunStuckMsV2(n) {
  _strgovStuckMs = _strgovPos(n, "strgovRunStuckMs");
}
export function getStrgovRunStuckMsV2() {
  return _strgovStuckMs;
}
export function _resetStateStressTesterV2() {
  _strgovPsV2.clear();
  _strgovJsV2.clear();
  _strgovMaxActive = 5;
  _strgovMaxPending = 10;
  _strgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _strgovStuckMs = 60 * 1000;
}
export function registerStrgovProfileV2({
  id,
  owner,
  scenario,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_strgovPsV2.has(id))
    throw new Error(`strgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    scenario: scenario || "ramp",
    status: STRGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _strgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateStrgovProfileV2(id) {
  const p = _strgovPsV2.get(id);
  if (!p) throw new Error(`strgov profile ${id} not found`);
  const isInitial = p.status === STRGOV_PROFILE_MATURITY_V2.PENDING;
  _strgovCheckP(p.status, STRGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _strgovCountActive(p.owner) >= _strgovMaxActive)
    throw new Error(`max active strgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = STRGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleStrgovProfileV2(id) {
  const p = _strgovPsV2.get(id);
  if (!p) throw new Error(`strgov profile ${id} not found`);
  _strgovCheckP(p.status, STRGOV_PROFILE_MATURITY_V2.STALE);
  p.status = STRGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveStrgovProfileV2(id) {
  const p = _strgovPsV2.get(id);
  if (!p) throw new Error(`strgov profile ${id} not found`);
  _strgovCheckP(p.status, STRGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = STRGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchStrgovProfileV2(id) {
  const p = _strgovPsV2.get(id);
  if (!p) throw new Error(`strgov profile ${id} not found`);
  if (_strgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal strgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getStrgovProfileV2(id) {
  const p = _strgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listStrgovProfilesV2() {
  return [..._strgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createStrgovRunV2({
  id,
  profileId,
  profileRef,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_strgovJsV2.has(id)) throw new Error(`strgov run ${id} already exists`);
  if (!_strgovPsV2.has(profileId))
    throw new Error(`strgov profile ${profileId} not found`);
  if (_strgovCountPending(profileId) >= _strgovMaxPending)
    throw new Error(`max pending strgov runs for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    profileRef: profileRef || "",
    status: STRGOV_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _strgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningStrgovRunV2(id) {
  const j = _strgovJsV2.get(id);
  if (!j) throw new Error(`strgov run ${id} not found`);
  _strgovCheckJ(j.status, STRGOV_RUN_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = STRGOV_RUN_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRunStrgovV2(id) {
  const j = _strgovJsV2.get(id);
  if (!j) throw new Error(`strgov run ${id} not found`);
  _strgovCheckJ(j.status, STRGOV_RUN_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = STRGOV_RUN_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failStrgovRunV2(id, reason) {
  const j = _strgovJsV2.get(id);
  if (!j) throw new Error(`strgov run ${id} not found`);
  _strgovCheckJ(j.status, STRGOV_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = STRGOV_RUN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelStrgovRunV2(id, reason) {
  const j = _strgovJsV2.get(id);
  if (!j) throw new Error(`strgov run ${id} not found`);
  _strgovCheckJ(j.status, STRGOV_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = STRGOV_RUN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getStrgovRunV2(id) {
  const j = _strgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listStrgovRunsV2() {
  return [..._strgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleStrgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _strgovPsV2.values())
    if (
      p.status === STRGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _strgovIdleMs
    ) {
      p.status = STRGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckStrgovRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _strgovJsV2.values())
    if (
      j.status === STRGOV_RUN_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _strgovStuckMs
    ) {
      j.status = STRGOV_RUN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getStressTesterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(STRGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _strgovPsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const v of Object.values(STRGOV_RUN_LIFECYCLE_V2)) runsByStatus[v] = 0;
  for (const j of _strgovJsV2.values()) runsByStatus[j.status]++;
  return {
    totalStrgovProfilesV2: _strgovPsV2.size,
    totalStrgovRunsV2: _strgovJsV2.size,
    maxActiveStrgovProfilesPerOwner: _strgovMaxActive,
    maxPendingStrgovRunsPerProfile: _strgovMaxPending,
    strgovProfileIdleMs: _strgovIdleMs,
    strgovRunStuckMs: _strgovStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}
