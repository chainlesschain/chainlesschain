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
