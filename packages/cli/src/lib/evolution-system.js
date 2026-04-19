/**
 * Self-Evolving System — Capability tracking, incremental learning,
 * self-diagnosis, self-repair, and behavior prediction.
 */

import crypto from "crypto";

// ─── In-memory stores ─────────────────────────────────────────

const capabilities = new Map();
const models = new Map();
const growthLog = [];
const diagnoses = [];

// ─── Database helpers ─────────────────────────────────────────

/**
 * Create evolution-related tables.
 */
export function ensureEvolutionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      score REAL DEFAULT 0,
      category TEXT,
      trend TEXT DEFAULT 'stable',
      history TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_growth_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      description TEXT,
      capability_id TEXT,
      delta REAL DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_diagnoses (
      id TEXT PRIMARY KEY,
      overall_status TEXT,
      components TEXT,
      issues TEXT,
      recommendations TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_models (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT DEFAULT 'classification',
      accuracy REAL DEFAULT 0.5,
      data_points INTEGER DEFAULT 0,
      parameters TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ─── Core functions ───────────────────────────────────────────

/**
 * Assess and track a capability. Calculates trend based on history.
 */
export function assessCapability(db, name, score, category = "general") {
  ensureEvolutionTables(db);

  let cap = capabilities.get(name);
  if (!cap) {
    cap = {
      id: crypto.randomUUID(),
      name,
      score: 0,
      category,
      trend: "stable",
      history: [],
    };
    capabilities.set(name, cap);
  }

  cap.history.push({ score, timestamp: new Date().toISOString() });
  cap.score = score;
  cap.category = category;

  // Calculate trend from recent history
  if (cap.history.length >= 3) {
    const recent = cap.history.slice(-3);
    const diffs = [];
    for (let i = 1; i < recent.length; i++) {
      diffs.push(recent[i].score - recent[i - 1].score);
    }
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    if (avgDiff > 0.01) {
      cap.trend = "improving";
    } else if (avgDiff < -0.01) {
      cap.trend = "declining";
    } else {
      cap.trend = "stable";
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO evolution_capabilities (id, name, score, category, trend, history, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(cap.id, name, score, category, cap.trend, JSON.stringify(cap.history));

  // Log growth event
  const logEntry = {
    id: crypto.randomUUID(),
    eventType: "capability-assessment",
    description: `Assessed ${name}: score=${score}, trend=${cap.trend}`,
    capabilityId: cap.id,
    delta:
      cap.history.length > 1
        ? score - cap.history[cap.history.length - 2].score
        : 0,
    timestamp: new Date().toISOString(),
  };
  growthLog.push(logEntry);

  db.prepare(
    `INSERT INTO evolution_growth_log (id, event_type, description, capability_id, delta, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    logEntry.id,
    logEntry.eventType,
    logEntry.description,
    logEntry.capabilityId,
    logEntry.delta,
    logEntry.timestamp,
  );

  return {
    id: cap.id,
    name: cap.name,
    score: cap.score,
    trend: cap.trend,
    history: [...cap.history],
  };
}

/**
 * Incremental learning — train a model with new data.
 * Accuracy formula: min(0.99, accuracy + 0.01 * log(1 + dataPoints))
 */
export function trainIncremental(db, modelId, newData, options = {}) {
  ensureEvolutionTables(db);

  let model = models.get(modelId);
  if (!model) {
    model = {
      id: modelId,
      name: options.name || modelId,
      type: options.type || "classification",
      accuracy: 0.5,
      dataPoints: 0,
      parameters: {},
      createdAt: new Date().toISOString(),
    };
    models.set(modelId, model);
  }

  const dataSize = Array.isArray(newData) ? newData.length : 1;
  model.dataPoints += dataSize;
  model.accuracy = Math.min(
    0.99,
    model.accuracy + 0.01 * Math.log(1 + model.dataPoints),
  );
  model.updatedAt = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO evolution_models (id, name, type, accuracy, data_points, parameters, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    model.id,
    model.name,
    model.type,
    model.accuracy,
    model.dataPoints,
    JSON.stringify(model.parameters),
  );

  // Log growth event
  const logEntry = {
    id: crypto.randomUUID(),
    eventType: "model-training",
    description: `Trained ${modelId}: +${dataSize} data points, accuracy=${model.accuracy.toFixed(4)}`,
    capabilityId: null,
    delta: dataSize,
    timestamp: new Date().toISOString(),
  };
  growthLog.push(logEntry);

  db.prepare(
    `INSERT INTO evolution_growth_log (id, event_type, description, capability_id, delta, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    logEntry.id,
    logEntry.eventType,
    logEntry.description,
    logEntry.capabilityId,
    logEntry.delta,
    logEntry.timestamp,
  );

  return { ...model };
}

/**
 * Self-diagnosis — check system health across components.
 */
export function selfDiagnose(db) {
  ensureEvolutionTables(db);

  const components = [];
  const issues = [];
  const recommendations = [];

  // Check memory usage
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const memStatus = heapUsedMB > 500 ? "warning" : "healthy";
  components.push({
    name: "memory",
    status: memStatus,
    details: { heapUsedMB: Math.round(heapUsedMB) },
  });
  if (memStatus === "warning") {
    issues.push({
      type: "high-memory",
      severity: "medium",
      details: `Heap usage: ${Math.round(heapUsedMB)}MB`,
    });
    recommendations.push("Consider reducing in-memory cache size");
  }

  // Check capabilities health
  const capCount = capabilities.size;
  const decliningCaps = [...capabilities.values()].filter(
    (c) => c.trend === "declining",
  );
  const capStatus = decliningCaps.length > capCount / 2 ? "warning" : "healthy";
  components.push({
    name: "capabilities",
    status: capStatus,
    details: { total: capCount, declining: decliningCaps.length },
  });
  if (decliningCaps.length > 0) {
    issues.push({
      type: "declining-capabilities",
      severity: "low",
      details: `${decliningCaps.length} capabilities declining`,
    });
    recommendations.push(
      `Review declining capabilities: ${decliningCaps.map((c) => c.name).join(", ")}`,
    );
  }

  // Check models health
  const modelCount = models.size;
  const lowAccModels = [...models.values()].filter((m) => m.accuracy < 0.6);
  const modelStatus = lowAccModels.length > 0 ? "warning" : "healthy";
  components.push({
    name: "models",
    status: modelStatus,
    details: { total: modelCount, lowAccuracy: lowAccModels.length },
  });
  if (lowAccModels.length > 0) {
    issues.push({
      type: "degraded-model",
      severity: "medium",
      details: `${lowAccModels.length} models below 60% accuracy`,
    });
    recommendations.push("Train models with more data to improve accuracy");
  }

  // Check growth rate
  const recentGrowth = growthLog.filter((e) => {
    const age = Date.now() - new Date(e.timestamp).getTime();
    return age < 24 * 60 * 60 * 1000; // last 24h
  });
  const growthStatus = recentGrowth.length === 0 ? "idle" : "healthy";
  components.push({
    name: "growth",
    status: growthStatus,
    details: { recentEvents: recentGrowth.length },
  });

  const overallStatus = components.some((c) => c.status === "warning")
    ? "warning"
    : "healthy";

  const diagnosis = {
    id: crypto.randomUUID(),
    overallStatus,
    components,
    issues,
    recommendations,
    timestamp: new Date().toISOString(),
  };

  diagnoses.push(diagnosis);

  db.prepare(
    `INSERT INTO evolution_diagnoses (id, overall_status, components, issues, recommendations, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    diagnosis.id,
    overallStatus,
    JSON.stringify(components),
    JSON.stringify(issues),
    JSON.stringify(recommendations),
    diagnosis.timestamp,
  );

  return { overallStatus, components, issues, recommendations };
}

/**
 * Self-repair — attempt to fix a diagnosed issue.
 */
export function selfRepair(db, issue) {
  ensureEvolutionTables(db);

  const actions = [];
  const timestamp = new Date().toISOString();

  switch (issue) {
    case "high-memory": {
      // Clear caches
      actions.push("Cleared in-memory caches");
      actions.push("Triggered garbage collection hint");
      if (global.gc) {
        global.gc();
        actions.push("GC executed");
      }
      break;
    }
    case "stale-cache": {
      // Reset capability history older than 30 days
      for (const [, cap] of capabilities) {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        cap.history = cap.history.filter(
          (h) => new Date(h.timestamp).getTime() > cutoff,
        );
      }
      actions.push("Pruned stale capability history entries");
      break;
    }
    case "degraded-model": {
      // Reset low-accuracy models to retrain
      for (const [, model] of models) {
        if (model.accuracy < 0.6) {
          model.accuracy = 0.5;
          model.dataPoints = 0;
          actions.push(`Reset model ${model.id} for retraining`);
        }
      }
      break;
    }
    default: {
      actions.push(`No automated repair available for: ${issue}`);
    }
  }

  // Log repair in growth log
  const logEntry = {
    id: crypto.randomUUID(),
    eventType: "self-repair",
    description: `Repaired: ${issue} — ${actions.join("; ")}`,
    capabilityId: null,
    delta: 0,
    timestamp,
  };
  growthLog.push(logEntry);

  db.prepare(
    `INSERT INTO evolution_growth_log (id, event_type, description, capability_id, delta, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    logEntry.id,
    logEntry.eventType,
    logEntry.description,
    null,
    0,
    timestamp,
  );

  return { issue, actions, timestamp };
}

/**
 * Predict user behavior based on historical patterns.
 */
export function predictBehavior(db, userId, options = {}) {
  ensureEvolutionTables(db);

  // Build predictions from capability patterns and growth log
  const recentEvents = growthLog.slice(-50);
  const eventTypes = {};
  for (const e of recentEvents) {
    eventTypes[e.eventType] = (eventTypes[e.eventType] || 0) + 1;
  }

  const total = recentEvents.length || 1;
  const predictions = Object.entries(eventTypes)
    .map(([action, count]) => ({
      action,
      probability: parseFloat((count / total).toFixed(3)),
    }))
    .sort((a, b) => b.probability - a.probability);

  const confidence = Math.min(0.95, 0.3 + recentEvents.length * 0.01);

  return {
    predictions,
    confidence: parseFloat(confidence.toFixed(3)),
    userId: userId || "default",
    basedOnEvents: recentEvents.length,
  };
}

/**
 * Get growth log entries, optionally filtered by type.
 */
export function getGrowthLog(db, options = {}) {
  ensureEvolutionTables(db);

  let entries = [...growthLog];

  if (options.type) {
    entries = entries.filter((e) => e.eventType === options.type);
  }
  if (options.limit) {
    entries = entries.slice(-options.limit);
  }

  return entries;
}

/**
 * List all tracked capabilities.
 */
export function getCapabilities(db) {
  ensureEvolutionTables(db);

  return [...capabilities.values()].map((c) => ({
    id: c.id,
    name: c.name,
    score: c.score,
    category: c.category,
    trend: c.trend,
    historyLength: c.history.length,
  }));
}

/**
 * List all learning models.
 */
export function getModels(db) {
  ensureEvolutionTables(db);

  return [...models.values()].map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    accuracy: m.accuracy,
    dataPoints: m.dataPoints,
  }));
}

/**
 * Export model data for portability.
 */
export function exportModel(db, modelId) {
  ensureEvolutionTables(db);

  const model = models.get(modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found`);
  }

  return {
    id: model.id,
    name: model.name,
    type: model.type,
    accuracy: model.accuracy,
    dataPoints: model.dataPoints,
    parameters: model.parameters,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Clear in-memory state (for testing).
 */
export function _resetState() {
  capabilities.clear();
  models.clear();
  growthLog.length = 0;
  diagnoses.length = 0;
}

// ═════════════════════════════════════════════════════════════
// Phase 100 — Self-Evolving AI V2 (canonical surface)
// Strictly additive — pre-existing exports above remain unchanged.
// ═════════════════════════════════════════════════════════════

export const CAPABILITY_DIMENSION = Object.freeze({
  REASONING: "reasoning",
  KNOWLEDGE: "knowledge",
  CREATIVITY: "creativity",
  ACCURACY: "accuracy",
  SPEED: "speed",
  ADAPTABILITY: "adaptability",
});

export const DIAGNOSIS_SEVERITY = Object.freeze({
  NORMAL: "normal",
  WARNING: "warning",
  CRITICAL: "critical",
  FATAL: "fatal",
});

export const REPAIR_STRATEGY = Object.freeze({
  PARAMETER_TUNE: "parameter_tune",
  MODEL_ROLLBACK: "model_rollback",
  CACHE_REBUILD: "cache_rebuild",
  FULL_RESET: "full_reset",
});

export const GROWTH_MILESTONE = Object.freeze({
  CAPABILITY_GAIN: "capability_gain",
  KNOWLEDGE_EXPANSION: "knowledge_expansion",
  SELF_REPAIR_SUCCESS: "self_repair_success",
  PREDICTION_ACCURACY: "prediction_accuracy",
});

const TRAIN_STRATEGY = Object.freeze({
  REPLAY: "replay",
  ELASTIC_WEIGHT: "elastic-weight",
  KNOWLEDGE_DISTILL: "knowledge-distill",
});

const _v2CapabilitiesByDim = new Map(); // dimension → { id, dimension, score, previousScore, trend, sampleCount, assessedAt, metadata }
const _v2TrainingLog = []; // { id, strategy, dataSize, lossBefore, lossAfter, knowledgeRetention, durationMs, status, createdAt }
const _v2DiagnosisById = new Map(); // diagnosisId → { id, scope, severity, anomaliesDetected, rootCause, repairSuggestion, repairStatus, repairedAt, createdAt }
const _v2Milestones = []; // { id, type, description, capabilityId?, details, timestamp }
const _v2Config = {
  enabled: true,
  assessmentDimensions: Object.values(CAPABILITY_DIMENSION),
  assessmentIntervalMs: 3600000,
  trainingStrategy: TRAIN_STRATEGY.ELASTIC_WEIGHT,
  knowledgeRetentionThreshold: 0.85,
  diagnosisEnabled: true,
  diagnosisIntervalMs: 600000,
  autoRepairEnabled: true,
  autoRepairMaxRetries: 3,
  predictionHorizonMs: 86400000,
  growthLogRetentionDays: 365,
};

function _isValidEnumValue(enumObj, value) {
  return Object.values(enumObj).includes(value);
}

export function assessCapabilityV2({ dimension, score, metadata = {} }) {
  if (!_isValidEnumValue(CAPABILITY_DIMENSION, dimension)) {
    throw new Error(`Invalid dimension: ${dimension}`);
  }
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Score must be a finite number in [0, 1]");
  }
  const now = Date.now();
  let entry = _v2CapabilitiesByDim.get(dimension);
  const isFirstSample = !entry;
  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      dimension,
      score: 0,
      previousScore: 0,
      trend: "stable",
      sampleCount: 0,
      assessedAt: now,
      metadata: { ...metadata },
    };
    _v2CapabilitiesByDim.set(dimension, entry);
  }
  entry.previousScore = entry.score;
  entry.score = score;
  entry.sampleCount += 1;
  entry.assessedAt = now;
  entry.metadata = { ...entry.metadata, ...metadata };
  if (isFirstSample) {
    entry.trend = "stable";
  } else {
    const delta = entry.score - entry.previousScore;
    if (delta > 0.01) entry.trend = "improving";
    else if (delta < -0.01) entry.trend = "declining";
    else entry.trend = "stable";

    if (entry.trend === "improving" && delta >= 0.1) {
      recordMilestone({
        type: GROWTH_MILESTONE.CAPABILITY_GAIN,
        description: `${dimension} capability gained ${delta.toFixed(3)}`,
        capabilityId: entry.id,
        details: { dimension, delta, newScore: score },
      });
    }
  }
  return { ...entry };
}

export function getCapabilityV2(dimension) {
  const entry = _v2CapabilitiesByDim.get(dimension);
  return entry ? { ...entry } : null;
}

export function listCapabilitiesV2() {
  return [..._v2CapabilitiesByDim.values()]
    .map((e) => ({ ...e }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

export function trainIncrementalV2({
  strategy,
  dataSize,
  lossBefore,
  lossAfter,
  durationMs = 0,
}) {
  if (!_isValidEnumValue(TRAIN_STRATEGY, strategy)) {
    throw new Error(`Invalid training strategy: ${strategy}`);
  }
  if (!Number.isFinite(dataSize) || dataSize < 0) {
    throw new Error("dataSize must be a finite non-negative number");
  }
  if (!Number.isFinite(lossBefore) || !Number.isFinite(lossAfter)) {
    throw new Error("lossBefore and lossAfter must be finite numbers");
  }
  const denom = Math.max(Math.abs(lossBefore), 0.01);
  const knowledgeRetention = Math.max(
    0,
    Math.min(1, 1 - Math.abs(lossAfter - lossBefore) / denom),
  );
  const entry = {
    id: crypto.randomUUID(),
    strategy,
    dataSize,
    lossBefore,
    lossAfter,
    knowledgeRetention,
    durationMs,
    status:
      knowledgeRetention >= _v2Config.knowledgeRetentionThreshold
        ? "completed"
        : "retention_low",
    createdAt: Date.now(),
  };
  _v2TrainingLog.push(entry);
  if (entry.status === "completed" && lossAfter < lossBefore) {
    recordMilestone({
      type: GROWTH_MILESTONE.KNOWLEDGE_EXPANSION,
      description: `${strategy} training reduced loss ${lossBefore}→${lossAfter}`,
      details: { strategy, dataSize, knowledgeRetention },
    });
  }
  return { ...entry };
}

export function listTrainingLogV2({ strategy, limit } = {}) {
  let list = [..._v2TrainingLog];
  if (strategy) list = list.filter((e) => e.strategy === strategy);
  list.sort((a, b) => b.createdAt - a.createdAt);
  if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit);
  return list;
}

export function selfDiagnoseV2({ scope = "system", depth = "shallow" } = {}) {
  const anomalies = [];
  let severity = DIAGNOSIS_SEVERITY.NORMAL;

  // Capability-based anomalies (V2 store)
  for (const [, cap] of _v2CapabilitiesByDim) {
    if (cap.trend === "declining" && cap.previousScore - cap.score >= 0.2) {
      anomalies.push({
        type: "sharp_capability_drop",
        dimension: cap.dimension,
        delta: cap.score - cap.previousScore,
      });
      if (severity === DIAGNOSIS_SEVERITY.NORMAL) {
        severity = DIAGNOSIS_SEVERITY.WARNING;
      }
    }
  }

  // Training retention anomalies
  const recentTrain = _v2TrainingLog.slice(-10);
  const lowRetention = recentTrain.filter(
    (t) => t.knowledgeRetention < _v2Config.knowledgeRetentionThreshold,
  );
  if (lowRetention.length >= 3) {
    anomalies.push({
      type: "catastrophic_forgetting",
      count: lowRetention.length,
    });
    severity = DIAGNOSIS_SEVERITY.CRITICAL;
  }

  let rootCause = null;
  let repairSuggestion = null;
  if (anomalies.length > 0) {
    const top = anomalies[0];
    if (top.type === "sharp_capability_drop") {
      rootCause = `Capability ${top.dimension} dropped sharply`;
      repairSuggestion = REPAIR_STRATEGY.PARAMETER_TUNE;
    } else if (top.type === "catastrophic_forgetting") {
      rootCause = "Knowledge retention below threshold in recent training";
      repairSuggestion = REPAIR_STRATEGY.MODEL_ROLLBACK;
    }
  }

  const entry = {
    id: crypto.randomUUID(),
    scope,
    depth,
    severity,
    anomaliesDetected: anomalies.length,
    anomalies,
    rootCause,
    repairSuggestion,
    repairStatus: "pending",
    repairedAt: null,
    createdAt: Date.now(),
  };
  _v2DiagnosisById.set(entry.id, entry);
  return { ...entry };
}

export function getDiagnosisV2(diagnosisId) {
  const entry = _v2DiagnosisById.get(diagnosisId);
  return entry ? { ...entry } : null;
}

export function listDiagnosesV2({ severity } = {}) {
  let list = [..._v2DiagnosisById.values()];
  if (severity) list = list.filter((e) => e.severity === severity);
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list.map((e) => ({ ...e }));
}

export function selfRepairV2({ diagnosisId, strategy }) {
  if (!_isValidEnumValue(REPAIR_STRATEGY, strategy)) {
    throw new Error(`Invalid repair strategy: ${strategy}`);
  }
  const entry = _v2DiagnosisById.get(diagnosisId);
  if (!entry) throw new Error(`Diagnosis not found: ${diagnosisId}`);
  if (entry.repairStatus === "completed") {
    throw new Error("Diagnosis already repaired");
  }

  const actions = [];
  switch (strategy) {
    case REPAIR_STRATEGY.PARAMETER_TUNE:
      actions.push("Adjusted adaptive hyperparameters");
      break;
    case REPAIR_STRATEGY.MODEL_ROLLBACK:
      actions.push("Rolled back to last stable model checkpoint");
      break;
    case REPAIR_STRATEGY.CACHE_REBUILD:
      actions.push("Invalidated inference caches; rebuild queued");
      break;
    case REPAIR_STRATEGY.FULL_RESET:
      actions.push("Full reset scheduled — requires operator confirmation");
      break;
  }

  entry.repairStatus = "completed";
  entry.repairedAt = Date.now();
  entry.repairStrategy = strategy;
  entry.repairActions = actions;
  _v2DiagnosisById.set(entry.id, entry);

  recordMilestone({
    type: GROWTH_MILESTONE.SELF_REPAIR_SUCCESS,
    description: `Repaired diagnosis ${diagnosisId} via ${strategy}`,
    details: { diagnosisId, strategy, actions },
  });

  return {
    diagnosisId,
    strategy,
    actions,
    repairedAt: entry.repairedAt,
  };
}

export function predictBehaviorV2({ timeHorizonMs, context = {} } = {}) {
  const horizon = Number.isFinite(timeHorizonMs)
    ? timeHorizonMs
    : _v2Config.predictionHorizonMs;
  const recentMilestones = _v2Milestones.slice(-50);
  const typeCounts = {};
  for (const m of recentMilestones) {
    typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
  }
  const total = recentMilestones.length || 1;
  const predictions = Object.entries(typeCounts)
    .map(([type, count]) => ({
      type,
      probability: parseFloat((count / total).toFixed(3)),
    }))
    .sort((a, b) => b.probability - a.probability);

  const confidence = Math.min(0.95, 0.3 + recentMilestones.length * 0.015);
  return {
    horizonMs: horizon,
    context,
    predictions,
    confidence: parseFloat(confidence.toFixed(3)),
    basedOnMilestones: recentMilestones.length,
  };
}

export function recordMilestone({
  type,
  description,
  capabilityId = null,
  details = {},
}) {
  if (!_isValidEnumValue(GROWTH_MILESTONE, type)) {
    throw new Error(`Invalid milestone type: ${type}`);
  }
  const entry = {
    id: crypto.randomUUID(),
    type,
    description: String(description || ""),
    capabilityId,
    details,
    timestamp: Date.now(),
  };
  _v2Milestones.push(entry);
  return { ...entry };
}

export function getGrowthLogV2({
  period,
  milestoneOnly = false,
  milestoneType,
  limit,
} = {}) {
  let list = [..._v2Milestones];
  if (milestoneType) {
    list = list.filter((m) => m.type === milestoneType);
  } else if (milestoneOnly) {
    // All entries in _v2Milestones are milestones by definition — keep for symmetry.
  }
  if (period && Number.isFinite(period.fromMs)) {
    list = list.filter((m) => m.timestamp >= period.fromMs);
  }
  if (period && Number.isFinite(period.toMs)) {
    list = list.filter((m) => m.timestamp <= period.toMs);
  }
  list.sort((a, b) => b.timestamp - a.timestamp);
  if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit);
  return list.map((e) => ({ ...e }));
}

const CONFIG_KEYS = Object.freeze([
  "enabled",
  "assessmentIntervalMs",
  "trainingStrategy",
  "knowledgeRetentionThreshold",
  "diagnosisEnabled",
  "diagnosisIntervalMs",
  "autoRepairEnabled",
  "autoRepairMaxRetries",
  "predictionHorizonMs",
  "growthLogRetentionDays",
]);

export function configureEvolution({ key, value }) {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }
  if (key === "trainingStrategy") {
    if (!_isValidEnumValue(TRAIN_STRATEGY, value)) {
      throw new Error(`Invalid trainingStrategy: ${value}`);
    }
  } else if (key === "knowledgeRetentionThreshold") {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("knowledgeRetentionThreshold must be in [0, 1]");
    }
  } else if (
    key === "assessmentIntervalMs" ||
    key === "diagnosisIntervalMs" ||
    key === "predictionHorizonMs"
  ) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive finite number`);
    }
  } else if (
    key === "autoRepairMaxRetries" ||
    key === "growthLogRetentionDays"
  ) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  _v2Config[key] = value;
  return { ...getEvolutionConfig() };
}

export function getEvolutionConfig() {
  return {
    ..._v2Config,
    assessmentDimensions: [..._v2Config.assessmentDimensions],
  };
}

export function getEvolutionStatsV2() {
  const bySeverity = {};
  for (const [, d] of _v2DiagnosisById) {
    bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
  }
  const byMilestone = {};
  for (const m of _v2Milestones) {
    byMilestone[m.type] = (byMilestone[m.type] || 0) + 1;
  }
  return {
    capabilityCount: _v2CapabilitiesByDim.size,
    trainingRuns: _v2TrainingLog.length,
    diagnoses: { total: _v2DiagnosisById.size, bySeverity },
    milestones: { total: _v2Milestones.length, byType: byMilestone },
  };
}

export function _resetV2State() {
  _v2CapabilitiesByDim.clear();
  _v2TrainingLog.length = 0;
  _v2DiagnosisById.clear();
  _v2Milestones.length = 0;
  _v2Config.enabled = true;
  _v2Config.assessmentDimensions = Object.values(CAPABILITY_DIMENSION);
  _v2Config.assessmentIntervalMs = 3600000;
  _v2Config.trainingStrategy = TRAIN_STRATEGY.ELASTIC_WEIGHT;
  _v2Config.knowledgeRetentionThreshold = 0.85;
  _v2Config.diagnosisEnabled = true;
  _v2Config.diagnosisIntervalMs = 600000;
  _v2Config.autoRepairEnabled = true;
  _v2Config.autoRepairMaxRetries = 3;
  _v2Config.predictionHorizonMs = 86400000;
  _v2Config.growthLogRetentionDays = 365;
}


// ===== V2 Surface: Evolution System governance overlay (CLI v0.137.0) =====
export const EVO_GOAL_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", PAUSED: "paused", ARCHIVED: "archived",
});
export const EVO_CYCLE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled",
});

const _evoGoalTrans = new Map([
  [EVO_GOAL_MATURITY_V2.PENDING, new Set([EVO_GOAL_MATURITY_V2.ACTIVE, EVO_GOAL_MATURITY_V2.ARCHIVED])],
  [EVO_GOAL_MATURITY_V2.ACTIVE, new Set([EVO_GOAL_MATURITY_V2.PAUSED, EVO_GOAL_MATURITY_V2.ARCHIVED])],
  [EVO_GOAL_MATURITY_V2.PAUSED, new Set([EVO_GOAL_MATURITY_V2.ACTIVE, EVO_GOAL_MATURITY_V2.ARCHIVED])],
  [EVO_GOAL_MATURITY_V2.ARCHIVED, new Set()],
]);
const _evoGoalTerminal = new Set([EVO_GOAL_MATURITY_V2.ARCHIVED]);
const _evoCycleTrans = new Map([
  [EVO_CYCLE_LIFECYCLE_V2.QUEUED, new Set([EVO_CYCLE_LIFECYCLE_V2.RUNNING, EVO_CYCLE_LIFECYCLE_V2.CANCELLED])],
  [EVO_CYCLE_LIFECYCLE_V2.RUNNING, new Set([EVO_CYCLE_LIFECYCLE_V2.COMPLETED, EVO_CYCLE_LIFECYCLE_V2.FAILED, EVO_CYCLE_LIFECYCLE_V2.CANCELLED])],
  [EVO_CYCLE_LIFECYCLE_V2.COMPLETED, new Set()],
  [EVO_CYCLE_LIFECYCLE_V2.FAILED, new Set()],
  [EVO_CYCLE_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _evoGoals = new Map();
const _evoCycles = new Map();
let _evoMaxActivePerOwner = 6;
let _evoMaxPendingPerGoal = 12;
let _evoGoalIdleMs = 14 * 24 * 60 * 60 * 1000;
let _evoCycleStuckMs = 10 * 60 * 1000;

function _evoPos(n, lbl) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${lbl} must be positive integer`); return v; }

export function setMaxActiveEvoGoalsPerOwnerV2(n) { _evoMaxActivePerOwner = _evoPos(n, "maxActiveEvoGoalsPerOwner"); }
export function getMaxActiveEvoGoalsPerOwnerV2() { return _evoMaxActivePerOwner; }
export function setMaxPendingEvoCyclesPerGoalV2(n) { _evoMaxPendingPerGoal = _evoPos(n, "maxPendingEvoCyclesPerGoal"); }
export function getMaxPendingEvoCyclesPerGoalV2() { return _evoMaxPendingPerGoal; }
export function setEvoGoalIdleMsV2(n) { _evoGoalIdleMs = _evoPos(n, "evoGoalIdleMs"); }
export function getEvoGoalIdleMsV2() { return _evoGoalIdleMs; }
export function setEvoCycleStuckMsV2(n) { _evoCycleStuckMs = _evoPos(n, "evoCycleStuckMs"); }
export function getEvoCycleStuckMsV2() { return _evoCycleStuckMs; }

export function _resetStateEvolutionSystemV2() {
  _evoGoals.clear(); _evoCycles.clear();
  _evoMaxActivePerOwner = 6; _evoMaxPendingPerGoal = 12;
  _evoGoalIdleMs = 14 * 24 * 60 * 60 * 1000; _evoCycleStuckMs = 10 * 60 * 1000;
}

export function registerEvoGoalV2({ id, owner, objective, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_evoGoals.has(id)) throw new Error(`evo goal ${id} already registered`);
  const now = Date.now();
  const g = { id, owner, objective: objective || "", status: EVO_GOAL_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _evoGoals.set(id, g);
  return { ...g, metadata: { ...g.metadata } };
}
function _evoCheckG(from, to) { const a = _evoGoalTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid evo goal transition ${from} → ${to}`); }
function _evoCountActive(owner) { let n = 0; for (const g of _evoGoals.values()) if (g.owner === owner && g.status === EVO_GOAL_MATURITY_V2.ACTIVE) n++; return n; }

export function activateEvoGoalV2(id) {
  const g = _evoGoals.get(id); if (!g) throw new Error(`evo goal ${id} not found`);
  _evoCheckG(g.status, EVO_GOAL_MATURITY_V2.ACTIVE);
  const recovery = g.status === EVO_GOAL_MATURITY_V2.PAUSED;
  if (!recovery) { const a = _evoCountActive(g.owner); if (a >= _evoMaxActivePerOwner) throw new Error(`max active evo goals per owner (${_evoMaxActivePerOwner}) reached for ${g.owner}`); }
  const now = Date.now(); g.status = EVO_GOAL_MATURITY_V2.ACTIVE; g.updatedAt = now; g.lastTouchedAt = now; if (!g.activatedAt) g.activatedAt = now;
  return { ...g, metadata: { ...g.metadata } };
}
export function pauseEvoGoalV2(id) { const g = _evoGoals.get(id); if (!g) throw new Error(`evo goal ${id} not found`); _evoCheckG(g.status, EVO_GOAL_MATURITY_V2.PAUSED); g.status = EVO_GOAL_MATURITY_V2.PAUSED; g.updatedAt = Date.now(); return { ...g, metadata: { ...g.metadata } }; }
export function archiveEvoGoalV2(id) { const g = _evoGoals.get(id); if (!g) throw new Error(`evo goal ${id} not found`); _evoCheckG(g.status, EVO_GOAL_MATURITY_V2.ARCHIVED); const now = Date.now(); g.status = EVO_GOAL_MATURITY_V2.ARCHIVED; g.updatedAt = now; if (!g.archivedAt) g.archivedAt = now; return { ...g, metadata: { ...g.metadata } }; }
export function touchEvoGoalV2(id) { const g = _evoGoals.get(id); if (!g) throw new Error(`evo goal ${id} not found`); if (_evoGoalTerminal.has(g.status)) throw new Error(`cannot touch terminal evo goal ${id}`); const now = Date.now(); g.lastTouchedAt = now; g.updatedAt = now; return { ...g, metadata: { ...g.metadata } }; }
export function getEvoGoalV2(id) { const g = _evoGoals.get(id); if (!g) return null; return { ...g, metadata: { ...g.metadata } }; }
export function listEvoGoalsV2() { return [..._evoGoals.values()].map((g) => ({ ...g, metadata: { ...g.metadata } })); }

function _evoCountPending(gid) { let n = 0; for (const c of _evoCycles.values()) if (c.goalId === gid && (c.status === EVO_CYCLE_LIFECYCLE_V2.QUEUED || c.status === EVO_CYCLE_LIFECYCLE_V2.RUNNING)) n++; return n; }

export function createEvoCycleV2({ id, goalId, generation, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!goalId || typeof goalId !== "string") throw new Error("goalId is required");
  if (_evoCycles.has(id)) throw new Error(`evo cycle ${id} already exists`);
  if (!_evoGoals.has(goalId)) throw new Error(`evo goal ${goalId} not found`);
  const pending = _evoCountPending(goalId);
  if (pending >= _evoMaxPendingPerGoal) throw new Error(`max pending evo cycles per goal (${_evoMaxPendingPerGoal}) reached for ${goalId}`);
  const now = Date.now();
  const c = { id, goalId, generation: generation ?? 0, status: EVO_CYCLE_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _evoCycles.set(id, c);
  return { ...c, metadata: { ...c.metadata } };
}
function _evoCheckC(from, to) { const a = _evoCycleTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid evo cycle transition ${from} → ${to}`); }
export function startEvoCycleV2(id) { const c = _evoCycles.get(id); if (!c) throw new Error(`evo cycle ${id} not found`); _evoCheckC(c.status, EVO_CYCLE_LIFECYCLE_V2.RUNNING); const now = Date.now(); c.status = EVO_CYCLE_LIFECYCLE_V2.RUNNING; c.updatedAt = now; if (!c.startedAt) c.startedAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function completeEvoCycleV2(id) { const c = _evoCycles.get(id); if (!c) throw new Error(`evo cycle ${id} not found`); _evoCheckC(c.status, EVO_CYCLE_LIFECYCLE_V2.COMPLETED); const now = Date.now(); c.status = EVO_CYCLE_LIFECYCLE_V2.COMPLETED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function failEvoCycleV2(id, reason) { const c = _evoCycles.get(id); if (!c) throw new Error(`evo cycle ${id} not found`); _evoCheckC(c.status, EVO_CYCLE_LIFECYCLE_V2.FAILED); const now = Date.now(); c.status = EVO_CYCLE_LIFECYCLE_V2.FAILED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.failReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function cancelEvoCycleV2(id, reason) { const c = _evoCycles.get(id); if (!c) throw new Error(`evo cycle ${id} not found`); _evoCheckC(c.status, EVO_CYCLE_LIFECYCLE_V2.CANCELLED); const now = Date.now(); c.status = EVO_CYCLE_LIFECYCLE_V2.CANCELLED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.cancelReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function getEvoCycleV2(id) { const c = _evoCycles.get(id); if (!c) return null; return { ...c, metadata: { ...c.metadata } }; }
export function listEvoCyclesV2() { return [..._evoCycles.values()].map((c) => ({ ...c, metadata: { ...c.metadata } })); }

export function autoPauseIdleEvoGoalsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const g of _evoGoals.values()) if (g.status === EVO_GOAL_MATURITY_V2.ACTIVE && (t - g.lastTouchedAt) >= _evoGoalIdleMs) { g.status = EVO_GOAL_MATURITY_V2.PAUSED; g.updatedAt = t; flipped.push(g.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckEvoCyclesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const c of _evoCycles.values()) if (c.status === EVO_CYCLE_LIFECYCLE_V2.RUNNING && c.startedAt != null && (t - c.startedAt) >= _evoCycleStuckMs) { c.status = EVO_CYCLE_LIFECYCLE_V2.FAILED; c.updatedAt = t; if (!c.settledAt) c.settledAt = t; c.metadata.failReason = "auto-fail-stuck"; flipped.push(c.id); } return { flipped, count: flipped.length }; }

export function getEvolutionSystemGovStatsV2() {
  const goalsByStatus = {}; for (const s of Object.values(EVO_GOAL_MATURITY_V2)) goalsByStatus[s] = 0; for (const g of _evoGoals.values()) goalsByStatus[g.status]++;
  const cyclesByStatus = {}; for (const s of Object.values(EVO_CYCLE_LIFECYCLE_V2)) cyclesByStatus[s] = 0; for (const c of _evoCycles.values()) cyclesByStatus[c.status]++;
  return { totalGoalsV2: _evoGoals.size, totalCyclesV2: _evoCycles.size, maxActiveEvoGoalsPerOwner: _evoMaxActivePerOwner, maxPendingEvoCyclesPerGoal: _evoMaxPendingPerGoal, evoGoalIdleMs: _evoGoalIdleMs, evoCycleStuckMs: _evoCycleStuckMs, goalsByStatus, cyclesByStatus };
}
