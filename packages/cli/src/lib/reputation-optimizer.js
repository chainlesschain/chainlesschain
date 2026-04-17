/**
 * Reputation Optimizer — observation ingestion, decay models,
 * anomaly detection, and simulated parameter optimization for the
 * reputation algorithm (Phase 60 design, CLI port).
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const OPTIMIZATION_OBJECTIVES = Object.freeze({
  ACCURACY: "accuracy",
  FAIRNESS: "fairness",
  RESILIENCE: "resilience",
  CONVERGENCE_SPEED: "convergence_speed",
});

export const ANOMALY_DETECTORS = Object.freeze({
  IQR: "iqr",
  Z_SCORE: "z_score",
});

export const DECAY_MODELS = Object.freeze({
  EXPONENTIAL: "exponential",
  LINEAR: "linear",
  STEP: "step",
  NONE: "none",
});

const DAY_MS = 86400000;

/* ── In-memory stores ─────────────────────────────────────── */
const _observations = new Map(); // did → [{ts, score, kind, weight}]
const _runs = new Map();
const _analytics = new Map();
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureReputationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation_observations (
      observation_id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      score REAL NOT NULL,
      kind TEXT,
      weight REAL DEFAULT 1.0,
      recorded_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation_optimization_runs (
      run_id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      param_space TEXT NOT NULL,
      best_params TEXT,
      best_score REAL,
      status TEXT DEFAULT 'running',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reputation_analytics (
      analytics_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      reputation_distribution TEXT,
      anomalies TEXT,
      recommendations TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

/* ── Observations ──────────────────────────────────────────── */

export function addObservation(db, did, score, opts = {}) {
  if (!did) throw new Error("DID is required");
  const s = Number(score);
  if (!Number.isFinite(s)) throw new Error("score must be a finite number");
  if (s < 0 || s > 1) throw new Error("score must be within [0, 1]");

  const observationId = crypto.randomUUID();
  const kind = opts.kind || "generic";
  const weight = Number(opts.weight ?? 1);
  const recordedAt = Number(opts.recordedAt ?? Date.now());

  const obs = { observationId, did, score: s, kind, weight, recordedAt };

  if (!_observations.has(did)) _observations.set(did, []);
  _observations.get(did).push(obs);

  db.prepare(
    `INSERT INTO reputation_observations (observation_id, did, score, kind, weight, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(observationId, did, s, kind, weight, recordedAt);

  return obs;
}

/* ── Decay ─────────────────────────────────────────────────── */

function _decayFactor(model, ageDays, params) {
  const lambda = params.lambda ?? 0.1;
  const alpha = params.alpha ?? 0.05;
  const steps = params.steps ?? [
    { atDays: 7, factor: 1 },
    { atDays: 30, factor: 0.7 },
    { atDays: 90, factor: 0.4 },
    { atDays: Infinity, factor: 0.1 },
  ];

  if (ageDays < 0) ageDays = 0;
  switch (model) {
    case DECAY_MODELS.NONE:
      return 1;
    case DECAY_MODELS.EXPONENTIAL:
      return Math.exp(-lambda * ageDays);
    case DECAY_MODELS.LINEAR:
      return Math.max(0, 1 - alpha * ageDays);
    case DECAY_MODELS.STEP: {
      for (const step of steps) {
        if (ageDays <= step.atDays) return step.factor;
      }
      return 0;
    }
    default:
      throw new Error(`Unknown decay model: ${model}`);
  }
}

export function computeScore(did, opts = {}) {
  const observations = _observations.get(did) || [];
  if (observations.length === 0) {
    return { did, score: 0, observations: 0, decay: opts.decay || "none" };
  }

  const now = Number(opts.now ?? Date.now());
  const model = opts.decay || DECAY_MODELS.NONE;
  const params = {
    lambda: opts.lambda,
    alpha: opts.alpha,
    steps: opts.steps,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const obs of observations) {
    const ageDays = Math.max(0, (now - obs.recordedAt) / DAY_MS);
    const decay = _decayFactor(model, ageDays, params);
    const effectiveWeight = obs.weight * decay;
    weightedSum += obs.score * effectiveWeight;
    weightTotal += effectiveWeight;
  }

  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return {
    did,
    score: Number(score.toFixed(6)),
    observations: observations.length,
    decay: model,
    weightTotal: Number(weightTotal.toFixed(4)),
  };
}

export function listScores(opts = {}) {
  const dids = [..._observations.keys()];
  const model = opts.decay || DECAY_MODELS.NONE;
  const now = Number(opts.now ?? Date.now());
  const rows = dids.map((did) =>
    computeScore(did, {
      decay: model,
      now,
      lambda: opts.lambda,
      alpha: opts.alpha,
    }),
  );
  rows.sort((a, b) => b.score - a.score);
  const limit = opts.limit || 50;
  return rows.slice(0, limit);
}

/* ── Anomaly detection ─────────────────────────────────────── */

function _mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function _stddev(values, mean) {
  const m = mean ?? _mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function _quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function detectAnomalies(opts = {}) {
  const method = opts.method || ANOMALY_DETECTORS.Z_SCORE;
  const threshold = opts.threshold ?? (method === "iqr" ? 1.5 : 2.5);

  const scores = listScores({ decay: opts.decay });
  if (scores.length < 3) {
    return {
      method,
      threshold,
      totalSamples: scores.length,
      anomalies: [],
      message: "Insufficient samples for anomaly detection (<3)",
    };
  }

  const values = scores.map((s) => s.score);
  const anomalies = [];

  if (method === ANOMALY_DETECTORS.Z_SCORE) {
    const m = _mean(values);
    const sd = _stddev(values, m);
    if (sd === 0) {
      return {
        method,
        threshold,
        totalSamples: scores.length,
        anomalies: [],
        message: "Zero variance — all scores identical",
      };
    }
    for (const s of scores) {
      const z = (s.score - m) / sd;
      if (Math.abs(z) >= threshold) {
        anomalies.push({
          did: s.did,
          score: s.score,
          zScore: Number(z.toFixed(4)),
          reason: z > 0 ? "unusually high" : "unusually low",
        });
      }
    }
  } else if (method === ANOMALY_DETECTORS.IQR) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = _quantile(sorted, 0.25);
    const q3 = _quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - threshold * iqr;
    const upper = q3 + threshold * iqr;
    for (const s of scores) {
      if (s.score < lower || s.score > upper) {
        anomalies.push({
          did: s.did,
          score: s.score,
          reason: s.score > upper ? "above upper fence" : "below lower fence",
          lower: Number(lower.toFixed(4)),
          upper: Number(upper.toFixed(4)),
        });
      }
    }
  } else {
    throw new Error(`Unknown anomaly detector: ${method}`);
  }

  return {
    method,
    threshold,
    totalSamples: scores.length,
    anomalies,
    summary: `${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} detected`,
  };
}

/* ── Optimization (simulated) ──────────────────────────────── */

const OBJECTIVE_VALUES = new Set(Object.values(OPTIMIZATION_OBJECTIVES));

function _seededRand(seed) {
  const v = Math.sin(seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function _evaluateParams(params, objective, iteration) {
  // Simulated objective surfaces. Each returns a score in [0, 1].
  // Same iteration always produces the same score → deterministic tests.
  const jitter = _seededRand(iteration + 1) * 0.1;
  switch (objective) {
    case OPTIMIZATION_OBJECTIVES.ACCURACY: {
      // optimum near kappa=2.5, contamination=0.05
      const d1 = Math.abs(params.kappa - 2.5) / 2.5;
      const d2 = Math.abs(params.contamination - 0.05) / 0.05;
      return Math.max(0, 1 - d1 * 0.4 - d2 * 0.4) * (0.85 + jitter * 0.15);
    }
    case OPTIMIZATION_OBJECTIVES.FAIRNESS: {
      // optimum when lambda is small (low decay) — treats all equally
      return Math.max(0, 1 - params.lambda * 2) * (0.8 + jitter * 0.2);
    }
    case OPTIMIZATION_OBJECTIVES.RESILIENCE: {
      // optimum when contamination high (tolerates more anomalies)
      return Math.min(1, params.contamination * 8) * (0.75 + jitter * 0.25);
    }
    case OPTIMIZATION_OBJECTIVES.CONVERGENCE_SPEED: {
      // optimum when iterations small and kappa high
      return (params.kappa / 3) * (0.7 + jitter * 0.3);
    }
    default:
      throw new Error(`Unknown objective: ${objective}`);
  }
}

function _sampleParams(seed) {
  return {
    lambda: 0.01 + _seededRand(seed) * 0.49,
    kappa: 0.5 + _seededRand(seed + 1) * 2.5,
    contamination: 0.01 + _seededRand(seed + 2) * 0.19,
  };
}

export function startOptimization(db, opts = {}) {
  const objective = opts.objective || OPTIMIZATION_OBJECTIVES.ACCURACY;
  if (!OBJECTIVE_VALUES.has(objective)) {
    throw new Error(`Unknown objective: ${objective}`);
  }
  const rawIter = opts.iterations == null ? 50 : Number(opts.iterations);
  const iterations = Math.max(
    1,
    Math.min(1000, Number.isFinite(rawIter) ? rawIter : 50),
  );
  const runId = crypto.randomUUID();
  const now = Date.now();

  const paramSpace = {
    lambda: [0.01, 0.5],
    kappa: [0.5, 3.0],
    contamination: [0.01, 0.2],
  };

  let bestParams = null;
  let bestScore = -Infinity;
  const history = [];

  for (let i = 0; i < iterations; i++) {
    const params = _sampleParams(_seq * 101 + i * 17 + 1);
    const score = _evaluateParams(params, objective, i);
    history.push({ iteration: i, params, score });
    if (score > bestScore) {
      bestScore = score;
      bestParams = params;
    }
  }

  const run = {
    runId,
    objective,
    iterations,
    paramSpace,
    bestParams,
    bestScore: Number(bestScore.toFixed(6)),
    status: "complete",
    createdAt: now,
    completedAt: now,
    history,
    _seq: ++_seq,
  };

  _runs.set(runId, run);

  db.prepare(
    `INSERT INTO reputation_optimization_runs (run_id, objective, iterations, param_space, best_params, best_score, status, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    objective,
    iterations,
    JSON.stringify(paramSpace),
    JSON.stringify(bestParams),
    run.bestScore,
    "complete",
    now,
    now,
  );

  // Auto-generate analytics
  const distribution = _buildDistribution(listScores({ decay: "none" }));
  const anomalies = detectAnomalies({ method: "z_score" });
  const recommendations = _buildRecommendations(objective, bestParams);
  const analyticsId = crypto.randomUUID();
  const analytics = {
    analyticsId,
    runId,
    reputationDistribution: distribution,
    anomalies,
    recommendations,
    createdAt: now,
  };
  _analytics.set(runId, analytics);

  db.prepare(
    `INSERT INTO reputation_analytics (analytics_id, run_id, reputation_distribution, anomalies, recommendations, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    analyticsId,
    runId,
    JSON.stringify(distribution),
    JSON.stringify(anomalies),
    JSON.stringify(recommendations),
    now,
  );

  return { ...run, analytics };
}

function _buildDistribution(scores) {
  if (scores.length === 0) {
    return { buckets: [], total: 0, mean: 0 };
  }
  const buckets = [
    { label: "low (<0.3)", count: 0 },
    { label: "mid (0.3-0.7)", count: 0 },
    { label: "high (>0.7)", count: 0 },
  ];
  let sum = 0;
  for (const s of scores) {
    if (s.score < 0.3) buckets[0].count++;
    else if (s.score <= 0.7) buckets[1].count++;
    else buckets[2].count++;
    sum += s.score;
  }
  return {
    buckets,
    total: scores.length,
    mean: Number((sum / scores.length).toFixed(4)),
  };
}

function _buildRecommendations(objective, params) {
  const recs = [];
  if (params.lambda > 0.3) {
    recs.push(
      "High lambda — reputation decays quickly; consider if users have enough time to recover",
    );
  }
  if (params.kappa < 1) {
    recs.push("Low kappa — exploration-heavy; more noise in early iterations");
  }
  if (params.contamination > 0.15) {
    recs.push(
      "High contamination — more samples flagged as anomalies; watch for false positives",
    );
  }
  if (
    objective === OPTIMIZATION_OBJECTIVES.RESILIENCE &&
    params.contamination < 0.05
  ) {
    recs.push(
      "Resilience objective but low contamination tolerance — consider raising",
    );
  }
  if (recs.length === 0) {
    recs.push(`Optimized params are within healthy ranges for ${objective}`);
  }
  return recs;
}

export function getOptimizationStatus(runId) {
  const run = _runs.get(runId);
  if (!run) throw new Error(`Optimization run not found: ${runId}`);
  const { _seq: _omit, ...rest } = run;
  void _omit;
  return rest;
}

export function getAnalytics(runId) {
  const analytics = _analytics.get(runId);
  if (!analytics) throw new Error(`Analytics not found for run: ${runId}`);
  return analytics;
}

export function listOptimizationRuns(opts = {}) {
  const runs = [..._runs.values()];
  runs.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 10;
  return runs.slice(0, limit).map((r) => {
    const { _seq: _omit, history: _history, ...rest } = r;
    void _omit;
    void _history;
    return rest;
  });
}

export function applyOptimizedParams(runId) {
  const run = _runs.get(runId);
  if (!run) throw new Error(`Optimization run not found: ${runId}`);
  run.status = "applied";
  return { runId, applied: true, params: run.bestParams };
}

export function _resetState() {
  _observations.clear();
  _runs.clear();
  _analytics.clear();
  _seq = 0;
  _maxConcurrentOptimizations = DEFAULT_MAX_CONCURRENT_OPTIMIZATIONS;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 (Phase 60) — Frozen enums + async optimization lifecycle +
 * concurrency limiter + patch-merged setRunStatus + stats-v2.
 * Strictly additive on top of the legacy surface above.
 * ═══════════════════════════════════════════════════════════════ */

export const RUN_STATUS_V2 = Object.freeze({
  RUNNING: "running",
  COMPLETE: "complete",
  APPLIED: "applied",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const OBJECTIVE_V2 = Object.freeze({
  ACCURACY: "accuracy",
  FAIRNESS: "fairness",
  RESILIENCE: "resilience",
  CONVERGENCE_SPEED: "convergence_speed",
});

export const DECAY_MODEL_V2 = Object.freeze({
  EXPONENTIAL: "exponential",
  LINEAR: "linear",
  STEP: "step",
  NONE: "none",
});

export const ANOMALY_METHOD_V2 = Object.freeze({
  IQR: "iqr",
  Z_SCORE: "z_score",
});

const DEFAULT_MAX_CONCURRENT_OPTIMIZATIONS = 2;
let _maxConcurrentOptimizations = DEFAULT_MAX_CONCURRENT_OPTIMIZATIONS;
export const REPUTATION_DEFAULT_MAX_CONCURRENT =
  DEFAULT_MAX_CONCURRENT_OPTIMIZATIONS;

export function setMaxConcurrentOptimizations(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("maxConcurrentOptimizations must be a positive integer");
  }
  _maxConcurrentOptimizations = Math.floor(n);
  return _maxConcurrentOptimizations;
}

export function getMaxConcurrentOptimizations() {
  return _maxConcurrentOptimizations;
}

// Run state machine:
//   running  → { complete, failed, cancelled }
//   complete → { applied }
//   applied/failed/cancelled are terminal.
const _runTerminal = new Set([
  RUN_STATUS_V2.APPLIED,
  RUN_STATUS_V2.FAILED,
  RUN_STATUS_V2.CANCELLED,
]);
const _runAllowed = new Map([
  [
    RUN_STATUS_V2.RUNNING,
    new Set([
      RUN_STATUS_V2.COMPLETE,
      RUN_STATUS_V2.FAILED,
      RUN_STATUS_V2.CANCELLED,
    ]),
  ],
  [RUN_STATUS_V2.COMPLETE, new Set([RUN_STATUS_V2.APPLIED])],
  [RUN_STATUS_V2.APPLIED, new Set([])],
  [RUN_STATUS_V2.FAILED, new Set([])],
  [RUN_STATUS_V2.CANCELLED, new Set([])],
]);

export function getActiveOptimizationCount() {
  let count = 0;
  for (const r of _runs.values()) {
    if (r.status === RUN_STATUS_V2.RUNNING) count++;
  }
  return count;
}

/**
 * startOptimizationV2 — creates a RUNNING row without computing iterations.
 * Caller drives the transition via completeOptimization or
 * cancelOptimization / failOptimization, or the generic setRunStatus.
 */
export function startOptimizationV2(db, opts = {}) {
  const objective = opts.objective || OBJECTIVE_V2.ACCURACY;
  if (!Object.values(OBJECTIVE_V2).includes(objective)) {
    throw new Error(`Unknown objective: ${objective}`);
  }
  const rawIter = opts.iterations == null ? 50 : Number(opts.iterations);
  const iterations = Math.max(
    1,
    Math.min(1000, Number.isFinite(rawIter) ? rawIter : 50),
  );

  const activeCount = getActiveOptimizationCount();
  if (activeCount >= _maxConcurrentOptimizations) {
    throw new Error(
      `Max concurrent optimizations reached: ${activeCount}/${_maxConcurrentOptimizations}`,
    );
  }

  const runId = crypto.randomUUID();
  const now = Date.now();
  const paramSpace = {
    lambda: [0.01, 0.5],
    kappa: [0.5, 3.0],
    contamination: [0.01, 0.2],
  };

  const run = {
    runId,
    objective,
    iterations,
    paramSpace,
    bestParams: null,
    bestScore: null,
    errorMessage: null,
    status: RUN_STATUS_V2.RUNNING,
    createdAt: now,
    completedAt: null,
    _seq: ++_seq,
  };
  _runs.set(runId, run);

  db.prepare(
    `INSERT INTO reputation_optimization_runs (run_id, objective, iterations, param_space, best_params, best_score, status, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    objective,
    iterations,
    JSON.stringify(paramSpace),
    null,
    null,
    run.status,
    now,
    null,
  );

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return rest;
}

/**
 * completeOptimization — advances RUNNING → COMPLETE, runs the iteration
 * loop, writes analytics, and returns the same { ...run, analytics }
 * shape as legacy startOptimization.
 */
export function completeOptimization(db, runId) {
  const run = _runs.get(runId);
  if (!run) throw new Error(`Optimization run not found: ${runId}`);

  const allowed = _runAllowed.get(run.status);
  if (!allowed || !allowed.has(RUN_STATUS_V2.COMPLETE)) {
    throw new Error(`Invalid run status transition: ${run.status} → complete`);
  }

  let bestParams = null;
  let bestScore = -Infinity;
  const history = [];

  for (let i = 0; i < run.iterations; i++) {
    const params = _sampleParams(run._seq * 101 + i * 17 + 1);
    const score = _evaluateParams(params, run.objective, i);
    history.push({ iteration: i, params, score });
    if (score > bestScore) {
      bestScore = score;
      bestParams = params;
    }
  }

  const now = Date.now();
  run.status = RUN_STATUS_V2.COMPLETE;
  run.bestParams = bestParams;
  run.bestScore = Number(bestScore.toFixed(6));
  run.completedAt = now;
  run.history = history;

  db.prepare(
    `UPDATE reputation_optimization_runs SET status = ?, best_params = ?, best_score = ?, completed_at = ? WHERE run_id = ?`,
  ).run(run.status, JSON.stringify(bestParams), run.bestScore, now, runId);

  const distribution = _buildDistribution(listScores({ decay: "none" }));
  const anomalies = detectAnomalies({ method: "z_score" });
  const recommendations = _buildRecommendations(run.objective, bestParams);
  const analyticsId = crypto.randomUUID();
  const analytics = {
    analyticsId,
    runId,
    reputationDistribution: distribution,
    anomalies,
    recommendations,
    createdAt: now,
  };
  _analytics.set(runId, analytics);
  db.prepare(
    `INSERT INTO reputation_analytics (analytics_id, run_id, reputation_distribution, anomalies, recommendations, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    analyticsId,
    runId,
    JSON.stringify(distribution),
    JSON.stringify(anomalies),
    JSON.stringify(recommendations),
    now,
  );

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return { ...rest, analytics };
}

export function cancelOptimization(db, runId) {
  return setRunStatus(db, runId, RUN_STATUS_V2.CANCELLED);
}

export function failOptimization(db, runId, errorMessage) {
  return setRunStatus(db, runId, RUN_STATUS_V2.FAILED, { errorMessage });
}

export function applyOptimization(db, runId) {
  return setRunStatus(db, runId, RUN_STATUS_V2.APPLIED);
}

export function setRunStatus(db, runId, newStatus, patch = {}) {
  const run = _runs.get(runId);
  if (!run) throw new Error(`Optimization run not found: ${runId}`);

  if (!Object.values(RUN_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown run status: ${newStatus}`);
  }

  const allowed = _runAllowed.get(run.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid run status transition: ${run.status} → ${newStatus}`,
    );
  }

  run.status = newStatus;
  if (typeof patch.errorMessage === "string") {
    run.errorMessage = patch.errorMessage;
  }
  if (_runTerminal.has(newStatus) && run.completedAt == null) {
    run.completedAt = Date.now();
  }

  db.prepare(
    `UPDATE reputation_optimization_runs SET status = ?, completed_at = ? WHERE run_id = ?`,
  ).run(newStatus, run.completedAt, runId);

  const { _seq: _omit, ...rest } = run;
  void _omit;
  return rest;
}

export function getReputationStatsV2() {
  const runs = [..._runs.values()];
  const observations = [];
  for (const arr of _observations.values()) observations.push(...arr);

  const byStatus = {};
  for (const s of Object.values(RUN_STATUS_V2)) byStatus[s] = 0;
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const byObjective = {};
  for (const o of Object.values(OBJECTIVE_V2)) byObjective[o] = 0;
  for (const r of runs)
    byObjective[r.objective] = (byObjective[r.objective] || 0) + 1;

  let totalObservations = observations.length;
  let totalDids = _observations.size;
  let bestScore = null;
  for (const r of runs) {
    if (r.bestScore != null && (bestScore == null || r.bestScore > bestScore)) {
      bestScore = r.bestScore;
    }
  }

  return {
    totalRuns: runs.length,
    activeRuns: getActiveOptimizationCount(),
    maxConcurrentOptimizations: _maxConcurrentOptimizations,
    byStatus,
    byObjective,
    observations: {
      totalDids,
      totalObservations,
    },
    bestScoreEver: bestScore,
  };
}
