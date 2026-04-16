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
}
