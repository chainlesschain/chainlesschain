/**
 * Privacy Computing — CLI port of Phase 91 隐私计算框架
 * (docs/design/modules/56_隐私计算框架.md).
 *
 * Desktop uses real FedAvg, Shamir MPC, Laplace DP, and Paillier HE
 * with Pinia store + PrivacyComputingPage.vue. CLI port ships:
 *
 *   - Federated learning model lifecycle (init → train → aggregate → complete)
 *   - MPC computation tracking (Shamir/Beaver/GMW protocols)
 *   - Differential privacy publish with Laplace/Gaussian noise
 *   - Homomorphic encryption query simulation
 *   - Privacy budget tracking + report
 *
 * What does NOT port: real cryptographic primitives (Shamir polynomials,
 * Paillier key gen), PrivacyComputingPage.vue, Pinia store.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const FL_STATUS = Object.freeze({
  INITIALIZING: "initializing",
  TRAINING: "training",
  AGGREGATING: "aggregating",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const MPC_PROTOCOL = Object.freeze({
  SHAMIR: Object.freeze({
    id: "shamir",
    name: "Shamir Secret Sharing",
    description: "Shamir (t,n) 秘密共享",
  }),
  BEAVER: Object.freeze({
    id: "beaver",
    name: "Beaver Triples",
    description: "Beaver 三元组乘法",
  }),
  GMW: Object.freeze({
    id: "gmw",
    name: "GMW Protocol",
    description: "Goldreich-Micali-Wigderson",
  }),
});

export const DP_MECHANISM = Object.freeze({
  LAPLACE: Object.freeze({
    id: "laplace",
    name: "Laplace",
    description: "Laplace 噪声",
  }),
  GAUSSIAN: Object.freeze({
    id: "gaussian",
    name: "Gaussian",
    description: "高斯噪声",
  }),
  EXPONENTIAL: Object.freeze({
    id: "exponential",
    name: "Exponential",
    description: "指数机制",
  }),
});

export const HE_SCHEME = Object.freeze({
  PAILLIER: Object.freeze({
    id: "paillier",
    name: "Paillier",
    description: "加法同态",
  }),
  BFV: Object.freeze({ id: "bfv", name: "BFV", description: "全同态 (整数)" }),
  CKKS: Object.freeze({
    id: "ckks",
    name: "CKKS",
    description: "全同态 (浮点)",
  }),
});

export const DEFAULT_CONFIG = Object.freeze({
  maxRounds: 100,
  minParticipants: 3,
  aggregationStrategy: "fedavg",
  defaultEpsilon: 1.0,
  defaultDelta: 1e-5,
  maxBudget: 10.0,
  mpcTimeoutMs: 30000,
});

/* ── State ─────────────────────────────────────────────── */

let _models = new Map();
let _computations = new Map();
let _privacyBudget = { spent: 0, limit: DEFAULT_CONFIG.maxBudget };

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

/* ── Schema ────────────────────────────────────────────── */

export function ensurePrivacyTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS fl_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model_type TEXT,
    architecture TEXT,
    status TEXT DEFAULT 'initializing',
    current_round INTEGER DEFAULT 0,
    total_rounds INTEGER,
    participant_count INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0.0,
    loss REAL,
    learning_rate REAL DEFAULT 0.01,
    aggregation_strategy TEXT DEFAULT 'fedavg',
    privacy_budget_spent REAL DEFAULT 0.0,
    created_at INTEGER,
    updated_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_flm_status ON fl_models(status)");

  db.exec(`CREATE TABLE IF NOT EXISTS mpc_computations (
    id TEXT PRIMARY KEY,
    computation_type TEXT NOT NULL,
    protocol TEXT DEFAULT 'shamir',
    participant_count INTEGER,
    participant_ids TEXT,
    result_hash TEXT,
    status TEXT DEFAULT 'pending',
    shares_received INTEGER DEFAULT 0,
    shares_required INTEGER,
    computation_time_ms REAL,
    error_message TEXT,
    created_at INTEGER,
    completed_at INTEGER
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mpc_status ON mpc_computations(status)",
  );

  _loadAll(db);
}

function _loadAll(db) {
  _models.clear();
  _computations.clear();
  _privacyBudget = { spent: 0, limit: DEFAULT_CONFIG.maxBudget };

  try {
    for (const row of db.prepare("SELECT * FROM fl_models").all()) {
      const m = _strip(row);
      _models.set(m.id, m);
      _privacyBudget.spent += m.privacy_budget_spent || 0;
    }
  } catch (_e) {
    /* table may not exist */
  }
  try {
    for (const row of db.prepare("SELECT * FROM mpc_computations").all()) {
      const c = _strip(row);
      c.participant_ids = _parseJson(c.participant_ids, []);
      _computations.set(c.id, c);
    }
  } catch (_e) {
    /* table may not exist */
  }
}

function _parseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (_e) {
    return fallback;
  }
}

/* ── Federated Learning ────────────────────────────────── */

export function createModel(
  db,
  name,
  { modelType, architecture, totalRounds, learningRate, participants } = {},
) {
  const id = _id();
  const now = _now();
  const rounds = totalRounds || 10;
  const lr = learningRate || 0.01;
  const participantCount = participants || 0;

  const model = {
    id,
    name,
    model_type: modelType || "neural_network",
    architecture: architecture || "mlp",
    status: "initializing",
    current_round: 0,
    total_rounds: rounds,
    participant_count: participantCount,
    accuracy: 0,
    loss: null,
    learning_rate: lr,
    aggregation_strategy: DEFAULT_CONFIG.aggregationStrategy,
    privacy_budget_spent: 0,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO fl_models (id, name, model_type, architecture, status, current_round, total_rounds,
     participant_count, accuracy, loss, learning_rate, aggregation_strategy, privacy_budget_spent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    model.model_type,
    model.architecture,
    "initializing",
    0,
    rounds,
    participantCount,
    0,
    null,
    lr,
    model.aggregation_strategy,
    0,
    now,
    now,
  );

  _models.set(id, model);
  return { modelId: id };
}

export function trainRound(db, modelId) {
  const m = _models.get(modelId);
  if (!m) return { trained: false, reason: "not_found" };
  if (m.status === "completed")
    return { trained: false, reason: "already_completed" };
  if (m.status === "failed") return { trained: false, reason: "model_failed" };

  if (m.status === "initializing") m.status = "training";

  m.current_round += 1;
  // Simulated accuracy improvement
  const baseAcc = 0.5;
  const progress = m.current_round / m.total_rounds;
  m.accuracy = Math.round((baseAcc + progress * 0.45) * 1000) / 1000;
  m.loss = Math.round((1 - m.accuracy) * 0.5 * 1000) / 1000;
  m.privacy_budget_spent += DEFAULT_CONFIG.defaultEpsilon * 0.1;
  m.updated_at = _now();

  if (m.current_round >= m.total_rounds) {
    m.status = "completed";
  }

  db.prepare(
    `UPDATE fl_models SET status = ?, current_round = ?, accuracy = ?, loss = ?,
     privacy_budget_spent = ?, updated_at = ? WHERE id = ?`,
  ).run(
    m.status,
    m.current_round,
    m.accuracy,
    m.loss,
    m.privacy_budget_spent,
    m.updated_at,
    modelId,
  );

  return {
    trained: true,
    round: m.current_round,
    accuracy: m.accuracy,
    status: m.status,
  };
}

export function failModel(db, modelId, reason) {
  const m = _models.get(modelId);
  if (!m) return { failed: false, reason: "not_found" };
  m.status = "failed";
  m.updated_at = _now();
  db.prepare(
    "UPDATE fl_models SET status = ?, updated_at = ? WHERE id = ?",
  ).run("failed", m.updated_at, modelId);
  return { failed: true };
}

export function getModel(db, modelId) {
  const m = _models.get(modelId);
  return m ? { ...m } : null;
}

export function listModels(db, { status, limit = 50 } = {}) {
  let models = [..._models.values()];
  if (status) models = models.filter((m) => m.status === status);
  return models
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

/* ── MPC Computation ───────────────────────────────────── */

const VALID_PROTOCOLS = new Set(Object.values(MPC_PROTOCOL).map((p) => p.id));

export function createComputation(
  db,
  computationType,
  { protocol, participantIds, sharesRequired } = {},
) {
  const proto = protocol || "shamir";
  if (!VALID_PROTOCOLS.has(proto))
    return { computationId: null, reason: "invalid_protocol" };

  const ids = participantIds || [];
  const required = sharesRequired || Math.ceil(ids.length / 2) || 2;

  const id = _id();
  const now = _now();
  const comp = {
    id,
    computation_type: computationType,
    protocol: proto,
    participant_count: ids.length,
    participant_ids: ids,
    result_hash: null,
    status: "pending",
    shares_received: 0,
    shares_required: required,
    computation_time_ms: null,
    error_message: null,
    created_at: now,
    completed_at: null,
  };

  db.prepare(
    `INSERT INTO mpc_computations (id, computation_type, protocol, participant_count, participant_ids,
     result_hash, status, shares_received, shares_required, computation_time_ms, error_message, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    computationType,
    proto,
    ids.length,
    JSON.stringify(ids),
    null,
    "pending",
    0,
    required,
    null,
    null,
    now,
    null,
  );

  _computations.set(id, comp);
  return { computationId: id };
}

export function submitShare(db, computationId) {
  const c = _computations.get(computationId);
  if (!c) return { submitted: false, reason: "not_found" };
  if (c.status === "completed")
    return { submitted: false, reason: "already_completed" };

  c.shares_received += 1;
  if (c.status === "pending") c.status = "computing";

  if (c.shares_received >= c.shares_required) {
    c.status = "completed";
    c.completed_at = _now();
    c.computation_time_ms = c.completed_at - c.created_at;
    c.result_hash = crypto
      .createHash("sha256")
      .update(`result-${c.id}`)
      .digest("hex")
      .slice(0, 16);
  }

  db.prepare(
    `UPDATE mpc_computations SET shares_received = ?, status = ?, completed_at = ?,
     computation_time_ms = ?, result_hash = ? WHERE id = ?`,
  ).run(
    c.shares_received,
    c.status,
    c.completed_at,
    c.computation_time_ms,
    c.result_hash,
    computationId,
  );

  return {
    submitted: true,
    sharesReceived: c.shares_received,
    status: c.status,
  };
}

export function getComputation(db, computationId) {
  const c = _computations.get(computationId);
  return c ? { ...c } : null;
}

export function listComputations(db, { protocol, status, limit = 50 } = {}) {
  let comps = [..._computations.values()];
  if (protocol) comps = comps.filter((c) => c.protocol === protocol);
  if (status) comps = comps.filter((c) => c.status === status);
  return comps
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((c) => ({ ...c }));
}

/* ── Differential Privacy ──────────────────────────────── */

export function dpPublish(
  db,
  { data, epsilon, delta, mechanism, sensitivity } = {},
) {
  const eps = epsilon || DEFAULT_CONFIG.defaultEpsilon;
  const del = delta || DEFAULT_CONFIG.defaultDelta;
  const mech = mechanism || "laplace";
  const sens = sensitivity || 1.0;

  // Check budget
  if (_privacyBudget.spent + eps > _privacyBudget.limit) {
    return {
      published: false,
      reason: "budget_exceeded",
      remaining: _privacyBudget.limit - _privacyBudget.spent,
    };
  }

  // Simulate noise addition
  let noisyData;
  if (Array.isArray(data)) {
    noisyData = data.map((v) => {
      const noise = _generateNoise(mech, sens / eps);
      return typeof v === "number" ? Math.round((v + noise) * 1000) / 1000 : v;
    });
  } else if (typeof data === "number") {
    const noise = _generateNoise(mech, sens / eps);
    noisyData = Math.round((data + noise) * 1000) / 1000;
  } else {
    noisyData = data;
  }

  _privacyBudget.spent += eps;

  return {
    published: true,
    data: noisyData,
    epsilon: eps,
    delta: del,
    mechanism: mech,
    budgetSpent: Math.round(_privacyBudget.spent * 1000) / 1000,
    budgetRemaining:
      Math.round((_privacyBudget.limit - _privacyBudget.spent) * 1000) / 1000,
  };
}

function _generateNoise(mechanism, scale) {
  // Simplified noise generation for CLI simulation
  if (mechanism === "laplace") {
    // Laplace noise: double exponential
    const u = Math.random() - 0.5;
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  }
  if (mechanism === "gaussian") {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return scale * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  // Exponential fallback
  return scale * -Math.log(Math.random());
}

/* ── Homomorphic Encryption ────────────────────────────── */

const VALID_SCHEMES = new Set(Object.values(HE_SCHEME).map((s) => s.id));

export function heQuery({ data, operation, scheme } = {}) {
  const sch = scheme || "paillier";
  if (!VALID_SCHEMES.has(sch))
    return { result: null, reason: "unsupported_scheme" };

  const validOps = ["sum", "product", "mean", "count"];
  if (!validOps.includes(operation))
    return { result: null, reason: "unsupported_operation" };

  if (!Array.isArray(data) || data.length === 0)
    return { result: null, reason: "invalid_data" };

  // Simulate encrypted computation
  let result;
  if (operation === "sum") result = data.reduce((a, b) => a + b, 0);
  else if (operation === "product") result = data.reduce((a, b) => a * b, 1);
  else if (operation === "mean")
    result = data.reduce((a, b) => a + b, 0) / data.length;
  else if (operation === "count") result = data.length;

  return {
    result: Math.round(result * 1000) / 1000,
    operation,
    scheme: sch,
    inputCount: data.length,
    encrypted: true, // Simulated — in real impl this would be ciphertext
  };
}

/* ── Privacy Report ────────────────────────────────────── */

export function getPrivacyReport(db) {
  const models = [..._models.values()];
  const comps = [..._computations.values()];

  const flStats = {
    totalModels: models.length,
    completed: models.filter((m) => m.status === "completed").length,
    training: models.filter((m) => m.status === "training").length,
    avgAccuracy:
      models.length > 0
        ? Math.round(
            (models.reduce((s, m) => s + m.accuracy, 0) / models.length) * 1000,
          ) / 1000
        : 0,
  };

  const mpcStats = {
    totalComputations: comps.length,
    completed: comps.filter((c) => c.status === "completed").length,
    pending: comps.filter(
      (c) => c.status === "pending" || c.status === "computing",
    ).length,
    byProtocol: {},
  };
  for (const c of comps) {
    mpcStats.byProtocol[c.protocol] =
      (mpcStats.byProtocol[c.protocol] || 0) + 1;
  }

  return {
    privacyBudget: {
      spent: Math.round(_privacyBudget.spent * 1000) / 1000,
      limit: _privacyBudget.limit,
      remaining:
        Math.round((_privacyBudget.limit - _privacyBudget.spent) * 1000) / 1000,
      exhausted: _privacyBudget.spent >= _privacyBudget.limit,
    },
    federatedLearning: flStats,
    mpc: mpcStats,
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _models.clear();
  _computations.clear();
  _privacyBudget = { spent: 0, limit: DEFAULT_CONFIG.maxBudget };
  _maxActiveMpcComputations = PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS;
}

/* ──────────────────────────────────────────────────────────
 *  V2 — Phase 91 surface (strictly additive)
 * ────────────────────────────────────────────────────────── */

export const FL_STATUS_V2 = FL_STATUS;

export const MPC_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  COMPUTING: "computing",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const DP_MECHANISM_V2 = Object.freeze({
  LAPLACE: "laplace",
  GAUSSIAN: "gaussian",
  EXPONENTIAL: "exponential",
});

export const HE_SCHEME_V2 = Object.freeze({
  PAILLIER: "paillier",
  BFV: "bfv",
  CKKS: "ckks",
});

export const MPC_PROTOCOL_V2 = Object.freeze({
  SHAMIR: "shamir",
  BEAVER: "beaver",
  GMW: "gmw",
});

export const PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS = 20;

let _maxActiveMpcComputations = PRIVACY_DEFAULT_MAX_ACTIVE_MPC_COMPUTATIONS;

const FL_TRANSITIONS_V2 = new Map([
  ["initializing", new Set(["training", "failed"])],
  ["training", new Set(["aggregating", "failed"])],
  ["aggregating", new Set(["training", "completed", "failed"])],
]);
const FL_TERMINALS_V2 = new Set(["completed", "failed"]);

const MPC_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["computing", "failed"])],
  ["computing", new Set(["completed", "failed"])],
]);
const MPC_TERMINALS_V2 = new Set(["completed", "failed"]);

/* ── Config ────────────────────────────────────────────── */

export function setMaxActiveMpcComputations(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n < 1) {
    throw new Error("maxActiveMpcComputations must be a positive integer");
  }
  _maxActiveMpcComputations = Math.floor(n);
}

export function getMaxActiveMpcComputations() {
  return _maxActiveMpcComputations;
}

export function getActiveMpcCount() {
  let count = 0;
  for (const c of _computations.values()) {
    if (c.status === "pending" || c.status === "computing") count += 1;
  }
  return count;
}

export function setPrivacyBudgetLimit(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) {
    throw new Error("privacyBudgetLimit must be a positive number");
  }
  _privacyBudget.limit = n;
}

export function getPrivacyBudgetLimit() {
  return _privacyBudget.limit;
}

export function getPrivacyBudgetSpent() {
  return _privacyBudget.spent;
}

export function resetPrivacyBudget() {
  _privacyBudget.spent = 0;
}

/* ── Federated Learning V2 ─────────────────────────────── */

export function createModelV2(
  db,
  {
    name,
    modelType,
    architecture,
    totalRounds,
    learningRate,
    participants,
  } = {},
) {
  if (!name) throw new Error("name is required");
  const rounds = totalRounds ?? 10;
  if (typeof rounds !== "number" || Number.isNaN(rounds) || rounds < 1) {
    throw new Error("totalRounds must be a positive integer");
  }
  const legacy = createModel(db, name, {
    modelType,
    architecture,
    totalRounds: rounds,
    learningRate,
    participants,
  });
  const m = _models.get(legacy.modelId);
  return { ...m };
}

export function trainRoundV2(db, modelId) {
  const m = _models.get(modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  if (m.status === "initializing") m.status = "training";
  if (m.status !== "training") {
    throw new Error(
      `Invalid transition: ${m.status} (must be training/initializing)`,
    );
  }

  m.current_round += 1;
  const baseAcc = 0.5;
  const progress = m.current_round / m.total_rounds;
  m.accuracy = Math.round((baseAcc + progress * 0.45) * 1000) / 1000;
  m.loss = Math.round((1 - m.accuracy) * 0.5 * 1000) / 1000;
  m.privacy_budget_spent += DEFAULT_CONFIG.defaultEpsilon * 0.1;
  _privacyBudget.spent += DEFAULT_CONFIG.defaultEpsilon * 0.1;
  m.updated_at = _now();

  db.prepare(
    `UPDATE fl_models SET status = ?, current_round = ?, accuracy = ?, loss = ?,
     privacy_budget_spent = ?, updated_at = ? WHERE id = ?`,
  ).run(
    m.status,
    m.current_round,
    m.accuracy,
    m.loss,
    m.privacy_budget_spent,
    m.updated_at,
    modelId,
  );

  return { ...m };
}

export function aggregateRound(db, modelId) {
  const m = _models.get(modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  if (m.status !== "training") {
    throw new Error(
      `Invalid transition: ${m.status} → aggregating (must be training)`,
    );
  }
  m.status = "aggregating";
  m.updated_at = _now();
  db.prepare(
    "UPDATE fl_models SET status = ?, updated_at = ? WHERE id = ?",
  ).run("aggregating", m.updated_at, modelId);

  if (m.current_round >= m.total_rounds) {
    m.status = "completed";
    db.prepare(
      "UPDATE fl_models SET status = ?, updated_at = ? WHERE id = ?",
    ).run("completed", _now(), modelId);
  } else {
    m.status = "training";
    db.prepare(
      "UPDATE fl_models SET status = ?, updated_at = ? WHERE id = ?",
    ).run("training", _now(), modelId);
  }
  return { ...m };
}

export function failModelV2(db, modelId, { error } = {}) {
  const m = _models.get(modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  if (FL_TERMINALS_V2.has(m.status)) {
    throw new Error(`Invalid transition: ${m.status} → failed (terminal)`);
  }
  m.status = "failed";
  m.error_message = error || null;
  m.updated_at = _now();
  db.prepare(
    "UPDATE fl_models SET status = ?, updated_at = ? WHERE id = ?",
  ).run("failed", m.updated_at, modelId);
  return { ...m };
}

export function setFLStatusV2(db, modelId, newStatus, patch = {}) {
  const m = _models.get(modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  if (!Object.values(FL_STATUS).includes(newStatus)) {
    throw new Error(`Unknown FL status: ${newStatus}`);
  }
  const allowed = FL_TRANSITIONS_V2.get(m.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${m.status} → ${newStatus}`);
  }
  m.status = newStatus;
  if (patch.errorMessage !== undefined) m.error_message = patch.errorMessage;
  if (patch.accuracy !== undefined) m.accuracy = patch.accuracy;
  if (patch.loss !== undefined) m.loss = patch.loss;
  m.updated_at = _now();
  db.prepare(
    `UPDATE fl_models SET status = ?, accuracy = ?, loss = ?, updated_at = ? WHERE id = ?`,
  ).run(newStatus, m.accuracy, m.loss, m.updated_at, modelId);
  return { ...m };
}

/* ── MPC V2 ────────────────────────────────────────────── */

export function createComputationV2(
  db,
  { computationType, protocol, participantIds, sharesRequired } = {},
) {
  if (!computationType) throw new Error("computationType is required");
  const proto = protocol || "shamir";
  if (!Object.values(MPC_PROTOCOL_V2).includes(proto)) {
    throw new Error(`Invalid protocol: ${proto}`);
  }
  const ids = participantIds || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("participantIds must be a non-empty array");
  }
  const activeCount = getActiveMpcCount();
  if (activeCount >= _maxActiveMpcComputations) {
    throw new Error(
      `Max active MPC computations reached (${activeCount}/${_maxActiveMpcComputations})`,
    );
  }
  const legacy = createComputation(db, computationType, {
    protocol: proto,
    participantIds: ids,
    sharesRequired,
  });
  const c = _computations.get(legacy.computationId);
  return { ...c };
}

export function submitShareV2(db, computationId) {
  const c = _computations.get(computationId);
  if (!c) throw new Error(`Unknown computation: ${computationId}`);
  if (MPC_TERMINALS_V2.has(c.status)) {
    throw new Error(
      `Invalid transition: cannot submit share to terminal (${c.status})`,
    );
  }
  c.shares_received += 1;
  if (c.status === "pending") c.status = "computing";

  if (c.shares_received >= c.shares_required) {
    c.status = "completed";
    c.completed_at = _now();
    c.computation_time_ms = c.completed_at - c.created_at;
    c.result_hash = crypto
      .createHash("sha256")
      .update(`result-${c.id}`)
      .digest("hex")
      .slice(0, 16);
  }

  db.prepare(
    `UPDATE mpc_computations SET shares_received = ?, status = ?, completed_at = ?,
     computation_time_ms = ?, result_hash = ? WHERE id = ?`,
  ).run(
    c.shares_received,
    c.status,
    c.completed_at,
    c.computation_time_ms,
    c.result_hash,
    computationId,
  );

  return { ...c };
}

export function failComputation(db, computationId, { error } = {}) {
  const c = _computations.get(computationId);
  if (!c) throw new Error(`Unknown computation: ${computationId}`);
  if (MPC_TERMINALS_V2.has(c.status)) {
    throw new Error(`Invalid transition: ${c.status} → failed (terminal)`);
  }
  c.status = "failed";
  c.error_message = error || null;
  c.completed_at = _now();
  db.prepare(
    `UPDATE mpc_computations SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`,
  ).run("failed", c.error_message, c.completed_at, computationId);
  return { ...c };
}

export function setMPCStatusV2(db, computationId, newStatus, patch = {}) {
  const c = _computations.get(computationId);
  if (!c) throw new Error(`Unknown computation: ${computationId}`);
  if (!Object.values(MPC_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown MPC status: ${newStatus}`);
  }
  const allowed = MPC_TRANSITIONS_V2.get(c.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${c.status} → ${newStatus}`);
  }
  c.status = newStatus;
  if (patch.errorMessage !== undefined) c.error_message = patch.errorMessage;
  if (patch.resultHash !== undefined) c.result_hash = patch.resultHash;
  if (MPC_TERMINALS_V2.has(newStatus)) {
    c.completed_at = c.completed_at || _now();
    if (c.computation_time_ms == null) {
      c.computation_time_ms = c.completed_at - c.created_at;
    }
  }
  db.prepare(
    `UPDATE mpc_computations SET status = ?, error_message = ?, result_hash = ?,
     completed_at = ?, computation_time_ms = ? WHERE id = ?`,
  ).run(
    newStatus,
    c.error_message,
    c.result_hash,
    c.completed_at,
    c.computation_time_ms,
    computationId,
  );
  return { ...c };
}

/* ── DP / HE V2 ────────────────────────────────────────── */

export function dpPublishV2(
  db,
  { data, epsilon, delta, mechanism, sensitivity } = {},
) {
  const eps = epsilon ?? DEFAULT_CONFIG.defaultEpsilon;
  const mech = mechanism || "laplace";
  if (!Object.values(DP_MECHANISM_V2).includes(mech)) {
    throw new Error(`Invalid DP mechanism: ${mech}`);
  }
  if (typeof eps !== "number" || Number.isNaN(eps) || eps <= 0) {
    throw new Error("epsilon must be a positive number");
  }
  if (_privacyBudget.spent + eps > _privacyBudget.limit) {
    throw new Error(
      `Privacy budget exceeded (${_privacyBudget.spent + eps} > ${_privacyBudget.limit})`,
    );
  }
  return dpPublish(db, {
    data,
    epsilon: eps,
    delta,
    mechanism: mech,
    sensitivity,
  });
}

export function heQueryV2({ data, operation, scheme } = {}) {
  const sch = scheme || "paillier";
  if (!Object.values(HE_SCHEME_V2).includes(sch)) {
    throw new Error(`Invalid HE scheme: ${sch}`);
  }
  const validOps = ["sum", "product", "mean", "count"];
  if (!validOps.includes(operation)) {
    throw new Error(`Invalid HE operation: ${operation}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("data must be a non-empty array");
  }
  return heQuery({ data, operation, scheme: sch });
}

/* ── V2 Stats ──────────────────────────────────────────── */

export function getPrivacyStatsV2() {
  const flByStatus = {};
  for (const s of Object.values(FL_STATUS)) flByStatus[s] = 0;
  const mpcByStatus = {};
  for (const s of Object.values(MPC_STATUS_V2)) mpcByStatus[s] = 0;
  const mpcByProtocol = {};
  for (const p of Object.values(MPC_PROTOCOL_V2)) mpcByProtocol[p] = 0;

  let accSum = 0;
  let accCount = 0;
  for (const m of _models.values()) {
    flByStatus[m.status] = (flByStatus[m.status] || 0) + 1;
    if (m.status === "completed" && typeof m.accuracy === "number") {
      accSum += m.accuracy;
      accCount += 1;
    }
  }

  let timeSum = 0;
  let timeCount = 0;
  for (const c of _computations.values()) {
    mpcByStatus[c.status] = (mpcByStatus[c.status] || 0) + 1;
    mpcByProtocol[c.protocol] = (mpcByProtocol[c.protocol] || 0) + 1;
    if (c.status === "completed" && typeof c.computation_time_ms === "number") {
      timeSum += c.computation_time_ms;
      timeCount += 1;
    }
  }

  return {
    totalModels: _models.size,
    totalComputations: _computations.size,
    activeMpcCount: getActiveMpcCount(),
    maxActiveMpcComputations: _maxActiveMpcComputations,
    flByStatus,
    mpcByStatus,
    mpcByProtocol,
    budget: {
      spent: Math.round(_privacyBudget.spent * 1000) / 1000,
      limit: _privacyBudget.limit,
      remaining:
        Math.round((_privacyBudget.limit - _privacyBudget.spent) * 1000) / 1000,
      exhausted: _privacyBudget.spent >= _privacyBudget.limit,
    },
    avgAccuracy:
      accCount > 0 ? Math.round((accSum / accCount) * 1000) / 1000 : 0,
    avgComputationTimeMs: timeCount > 0 ? Math.round(timeSum / timeCount) : 0,
  };
}
