/**
 * A2A (Agent-to-Agent) Protocol for CLI
 *
 * Implements Google A2A protocol concepts: agent cards, task lifecycle,
 * capability negotiation, and peer discovery.
 */

// ─── Task statuses ───────────────────────────────────────────────
export const TASK_STATUS = {
  SUBMITTED: "submitted",
  WORKING: "working",
  COMPLETED: "completed",
  FAILED: "failed",
  INPUT_REQUIRED: "input-required",
};

// ─── In-memory task subscriptions ────────────────────────────────
// Map<taskId, Set<callback>>
const _subscriptions = new Map();

// ─── Helpers ─────────────────────────────────────────────────────
function generateId(prefix = "a2a") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ─── Table setup ─────────────────────────────────────────────────

/**
 * Create A2A protocol tables
 */
export function ensureA2ATables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS a2a_agent_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      skills TEXT DEFAULT '[]',
      auth_type TEXT DEFAULT 'none',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'submitted',
      input TEXT DEFAULT '',
      output TEXT DEFAULT '',
      artifacts TEXT DEFAULT '[]',
      error TEXT DEFAULT '',
      history TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ─── Agent Cards ─────────────────────────────────────────────────

/**
 * Register an agent card
 */
export function registerCard(db, card) {
  ensureA2ATables(db);

  if (!card || !card.name) {
    throw new Error("Agent card must have a name");
  }

  const id = generateId("agent");
  const now = nowISO();
  const capabilities = JSON.stringify(card.capabilities || []);
  const skills = JSON.stringify(card.skills || []);

  db.prepare(
    `INSERT INTO a2a_agent_cards (id, name, description, url, capabilities, skills, auth_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    card.name,
    card.description || "",
    card.url || "",
    capabilities,
    skills,
    card.auth_type || "none",
    now,
    now,
  );

  return { id, name: card.name, status: "active" };
}

/**
 * Update an existing agent card
 */
export function updateCard(db, id, updates) {
  ensureA2ATables(db);

  if (!id) throw new Error("Card ID is required");

  const fields = [];
  const values = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.url !== undefined) {
    fields.push("url = ?");
    values.push(updates.url);
  }
  if (updates.capabilities !== undefined) {
    fields.push("capabilities = ?");
    values.push(JSON.stringify(updates.capabilities));
  }
  if (updates.skills !== undefined) {
    fields.push("skills = ?");
    values.push(JSON.stringify(updates.skills));
  }
  if (updates.auth_type !== undefined) {
    fields.push("auth_type = ?");
    values.push(updates.auth_type);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }

  if (fields.length === 0) return { id, updated: false };

  fields.push("updated_at = ?");
  values.push(nowISO());
  values.push(id);

  const result = db
    .prepare(`UPDATE a2a_agent_cards SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);

  return { id, updated: result.changes > 0 };
}

/**
 * Discover agents matching a filter
 */
export function discoverAgents(db, filter = {}) {
  ensureA2ATables(db);

  let rows = db
    .prepare(`SELECT * FROM a2a_agent_cards WHERE status = 'active'`)
    .all();

  // Parse JSON fields
  rows = rows.map((r) => ({
    ...r,
    capabilities: JSON.parse(r.capabilities || "[]"),
    skills: JSON.parse(r.skills || "[]"),
  }));

  if (filter.capability) {
    rows = rows.filter((r) => r.capabilities.includes(filter.capability));
  }
  if (filter.skill) {
    rows = rows.filter((r) => r.skills.includes(filter.skill));
  }
  if (filter.name) {
    const pattern = filter.name.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(pattern));
  }

  return rows;
}

// ─── Task Lifecycle ──────────────────────────────────────────────

/**
 * Send a task to an agent (creates with status: submitted)
 */
export function sendTask(db, agentId, input) {
  ensureA2ATables(db);

  if (!agentId) throw new Error("Agent ID is required");
  if (!input) throw new Error("Task input is required");

  const taskId = generateId("task");
  const now = nowISO();
  const history = JSON.stringify([
    { status: TASK_STATUS.SUBMITTED, timestamp: now },
  ]);

  db.prepare(
    `INSERT INTO a2a_tasks (id, agent_id, status, input, history, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(taskId, agentId, TASK_STATUS.SUBMITTED, input, history, now, now);

  _notifySubscribers(taskId, TASK_STATUS.SUBMITTED);

  return { taskId, status: TASK_STATUS.SUBMITTED };
}

/**
 * Mark a task as completed
 */
export function completeTask(db, taskId, output, artifacts = []) {
  ensureA2ATables(db);

  if (!taskId) throw new Error("Task ID is required");

  const now = nowISO();
  const task = _getTask(db, taskId);
  const history = JSON.parse(task.history || "[]");
  history.push({ status: TASK_STATUS.COMPLETED, timestamp: now });

  db.prepare(
    `UPDATE a2a_tasks SET status = ?, output = ?, artifacts = ?, history = ?, updated_at = ? WHERE id = ?`,
  ).run(
    TASK_STATUS.COMPLETED,
    output || "",
    JSON.stringify(artifacts),
    JSON.stringify(history),
    now,
    taskId,
  );

  _notifySubscribers(taskId, TASK_STATUS.COMPLETED);

  return { taskId, status: TASK_STATUS.COMPLETED };
}

/**
 * Mark a task as failed
 */
export function failTask(db, taskId, error) {
  ensureA2ATables(db);

  if (!taskId) throw new Error("Task ID is required");

  const now = nowISO();
  const task = _getTask(db, taskId);
  const history = JSON.parse(task.history || "[]");
  history.push({ status: TASK_STATUS.FAILED, timestamp: now });

  db.prepare(
    `UPDATE a2a_tasks SET status = ?, error = ?, history = ?, updated_at = ? WHERE id = ?`,
  ).run(
    TASK_STATUS.FAILED,
    error || "Unknown error",
    JSON.stringify(history),
    now,
    taskId,
  );

  _notifySubscribers(taskId, TASK_STATUS.FAILED);

  return { taskId, status: TASK_STATUS.FAILED };
}

/**
 * Get task status with full history
 */
export function getTaskStatus(db, taskId) {
  ensureA2ATables(db);

  const task = _getTask(db, taskId);
  return {
    ...task,
    history: JSON.parse(task.history || "[]"),
    artifacts: JSON.parse(task.artifacts || "[]"),
  };
}

function _getTask(db, taskId) {
  const task = db.prepare(`SELECT * FROM a2a_tasks WHERE id = ?`).get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

// ─── Capability Negotiation ──────────────────────────────────────

/**
 * Check if an agent supports the required capabilities
 */
export function negotiateCapability(db, agentId, requiredCapabilities) {
  ensureA2ATables(db);

  if (!agentId) throw new Error("Agent ID is required");
  if (!Array.isArray(requiredCapabilities)) {
    throw new Error("requiredCapabilities must be an array");
  }

  const card = db
    .prepare(`SELECT * FROM a2a_agent_cards WHERE id = ?`)
    .get(agentId);
  if (!card) throw new Error(`Agent not found: ${agentId}`);

  const agentCaps = JSON.parse(card.capabilities || "[]");
  const supported = requiredCapabilities.filter((c) => agentCaps.includes(c));
  const missing = requiredCapabilities.filter((c) => !agentCaps.includes(c));

  return {
    compatible: missing.length === 0,
    supported,
    missing,
  };
}

// ─── Peers ───────────────────────────────────────────────────────

/**
 * List all registered agents
 */
export function listPeers(db) {
  ensureA2ATables(db);

  const rows = db
    .prepare(`SELECT * FROM a2a_agent_cards ORDER BY created_at DESC`)
    .all();
  return rows.map((r) => ({
    ...r,
    capabilities: JSON.parse(r.capabilities || "[]"),
    skills: JSON.parse(r.skills || "[]"),
  }));
}

// ─── Subscriptions ───────────────────────────────────────────────

/**
 * Subscribe to task status changes (in-memory)
 */
export function subscribeToTask(taskId, callback) {
  if (!_subscriptions.has(taskId)) {
    _subscriptions.set(taskId, new Set());
  }
  _subscriptions.get(taskId).add(callback);

  return () => {
    const subs = _subscriptions.get(taskId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) _subscriptions.delete(taskId);
    }
  };
}

function _notifySubscribers(taskId, status) {
  const subs = _subscriptions.get(taskId);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(taskId, status);
      } catch (_err) {
        // Subscriber error should not break task lifecycle
      }
    }
  }
}

// Export for testing
export { _subscriptions };

// ─── V2 Canonical Surface (Phase 81) ─────────────────────────────

/**
 * Frozen task status enum (Phase 81 — adds INPUT_REQUIRED and CANCELED)
 */
export const TASK_STATUS_V2 = Object.freeze({
  SUBMITTED: "submitted",
  WORKING: "working",
  INPUT_REQUIRED: "input-required",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
});

/**
 * Frozen agent card status enum (Phase 81)
 */
export const CARD_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
});

/**
 * Frozen subscription type enum (Phase 81)
 */
export const SUBSCRIPTION_TYPE = Object.freeze({
  TASK_UPDATE: "task_update",
  AGENT_STATUS: "agent_status",
  CAPABILITY_CHANGE: "capability_change",
});

/**
 * Frozen capability-negotiation outcome enum (Phase 81)
 */
export const NEGOTIATION_RESULT = Object.freeze({
  COMPATIBLE: "compatible",
  PARTIAL: "partial",
  INCOMPATIBLE: "incompatible",
});

/**
 * Task state machine — only allow documented transitions.
 * Terminal: completed, failed, canceled.
 */
const _allowedTaskTransitions = Object.freeze({
  submitted: new Set(["working", "canceled", "failed"]),
  working: new Set(["input-required", "completed", "failed", "canceled"]),
  "input-required": new Set(["working", "canceled", "failed"]),
  completed: new Set(),
  failed: new Set(),
  canceled: new Set(),
});

/**
 * Agent card status transitions.
 */
const _allowedCardTransitions = Object.freeze({
  active: new Set(["inactive", "expired"]),
  inactive: new Set(["active", "expired"]),
  expired: new Set(["active"]),
});

// In-memory V2 state (parallel to existing DB-backed surface)
const _v2Tasks = new Map(); // taskId → { agentId, status, input, output, error, history[], deadline, inputPrompt, cancelReason, createdAt, updatedAt }
const _v2Cards = new Map(); // cardId → { cardId, status, updatedAt }
const _v2TypedSubs = new Map(); // key `${type}:${resourceId}` → Set<callback>

// ─── Card status & validation ────────────────────────────────────

/**
 * Validate an A2A agent card against the Phase 81 schema.
 * Returns { valid, errors[] } — does not throw.
 */
export function validateAgentCard(card) {
  const errors = [];
  if (!card || typeof card !== "object") {
    return { valid: false, errors: ["card must be an object"] };
  }
  if (!card.name || typeof card.name !== "string") {
    errors.push("name is required and must be a string");
  }
  if (card.capabilities !== undefined && !Array.isArray(card.capabilities)) {
    errors.push("capabilities must be an array");
  }
  if (card.skills !== undefined && !Array.isArray(card.skills)) {
    errors.push("skills must be an array");
  }
  if (card.url !== undefined && typeof card.url !== "string") {
    errors.push("url must be a string");
  }
  if (card.version !== undefined && !/^\d+\.\d+\.\d+$/.test(card.version)) {
    errors.push("version must follow semver major.minor.patch");
  }
  if (
    card.auth_type !== undefined &&
    !["none", "bearer", "basic", "oauth2"].includes(card.auth_type)
  ) {
    errors.push("auth_type must be one of none|bearer|basic|oauth2");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Transition an agent card between active/inactive/expired.
 */
export function setCardStatus(db, cardId, status) {
  if (!cardId) throw new Error("Card ID is required");
  if (!Object.values(CARD_STATUS_V2).includes(status)) {
    throw new Error(`Invalid card status: ${status}`);
  }
  const prev = _v2Cards.get(cardId)?.status || "active";
  const allowed = _allowedCardTransitions[prev] || new Set();
  if (prev !== status && !allowed.has(status)) {
    throw new Error(`Invalid card transition: ${prev} → ${status}`);
  }
  const now = nowISO();
  _v2Cards.set(cardId, { cardId, status, updatedAt: now });
  if (db) {
    try {
      ensureA2ATables(db);
      db.prepare(
        `UPDATE a2a_agent_cards SET status = ?, updated_at = ? WHERE id = ?`,
      ).run(status, now, cardId);
    } catch (_err) {
      // DB may not support UPDATE in mock — in-memory state is authoritative
    }
  }
  return { cardId, status, updatedAt: now };
}

/**
 * Get a card's V2 status (falls back to 'active' if no V2 entry exists).
 */
export function getCardStatusV2(cardId) {
  return _v2Cards.get(cardId)?.status || "active";
}

// ─── Task lifecycle V2 ───────────────────────────────────────────

/**
 * Submit a task with optional timeout tracking.
 */
export function sendTaskV2(db, { agentId, input, timeoutMs }) {
  if (!agentId) throw new Error("Agent ID is required");
  if (!input) throw new Error("Task input is required");
  const taskId = generateId("task");
  const now = nowISO();
  const deadline =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? Date.now() + timeoutMs
      : null;
  const task = {
    taskId,
    agentId,
    status: TASK_STATUS_V2.SUBMITTED,
    input,
    output: "",
    error: "",
    history: [{ status: TASK_STATUS_V2.SUBMITTED, timestamp: now }],
    deadline,
    inputPrompt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
  _v2Tasks.set(taskId, task);
  _notifyTyped(SUBSCRIPTION_TYPE.TASK_UPDATE, taskId, {
    taskId,
    status: task.status,
  });
  return { taskId, status: task.status, deadline };
}

function _transitionTask(taskId, nextStatus, patch = {}) {
  const task = _v2Tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const allowed = _allowedTaskTransitions[task.status] || new Set();
  if (!allowed.has(nextStatus)) {
    throw new Error(`Invalid task transition: ${task.status} → ${nextStatus}`);
  }
  const now = nowISO();
  task.status = nextStatus;
  task.updatedAt = now;
  task.history.push({
    status: nextStatus,
    timestamp: now,
    ...patch.historyExtra,
  });
  if (patch.output !== undefined) task.output = patch.output;
  if (patch.error !== undefined) task.error = patch.error;
  if (patch.inputPrompt !== undefined) task.inputPrompt = patch.inputPrompt;
  if (patch.cancelReason !== undefined) task.cancelReason = patch.cancelReason;
  _notifyTyped(SUBSCRIPTION_TYPE.TASK_UPDATE, taskId, {
    taskId,
    status: nextStatus,
  });
  return { taskId, status: nextStatus };
}

/**
 * Move a task from submitted → working (or input-required → working).
 */
export function startWorking(_db, taskId) {
  return _transitionTask(taskId, TASK_STATUS_V2.WORKING);
}

/**
 * Request user input while working → input-required.
 */
export function requestInput(_db, taskId, prompt) {
  if (!prompt) throw new Error("Prompt is required");
  return _transitionTask(taskId, TASK_STATUS_V2.INPUT_REQUIRED, {
    inputPrompt: prompt,
  });
}

/**
 * Provide requested input; input-required → working (clears prompt).
 */
export function provideInput(_db, taskId, responseInput) {
  const task = _v2Tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== TASK_STATUS_V2.INPUT_REQUIRED) {
    throw new Error(
      `provideInput requires status input-required, got ${task.status}`,
    );
  }
  const result = _transitionTask(taskId, TASK_STATUS_V2.WORKING, {
    inputPrompt: null,
    historyExtra: { response: responseInput },
  });
  task.input = `${task.input}\n${responseInput}`;
  return result;
}

/**
 * Mark task complete (from working only).
 */
export function completeTaskV2(_db, taskId, output, artifacts = []) {
  const task = _v2Tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const res = _transitionTask(taskId, TASK_STATUS_V2.COMPLETED, {
    output: output || "",
  });
  task.artifacts = artifacts;
  return res;
}

/**
 * Mark task failed.
 */
export function failTaskV2(_db, taskId, error) {
  return _transitionTask(taskId, TASK_STATUS_V2.FAILED, {
    error: error || "Unknown error",
  });
}

/**
 * Cancel a non-terminal task.
 */
export function cancelTask(_db, taskId, reason) {
  return _transitionTask(taskId, TASK_STATUS_V2.CANCELED, {
    cancelReason: reason || "user_requested",
  });
}

/**
 * Check task timeout — if past deadline and not terminal, auto-fails.
 * Returns { timedOut: boolean, status }.
 */
export function checkTaskTimeout(_db, taskId, now = Date.now()) {
  const task = _v2Tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const terminal = [
    TASK_STATUS_V2.COMPLETED,
    TASK_STATUS_V2.FAILED,
    TASK_STATUS_V2.CANCELED,
  ];
  if (terminal.includes(task.status)) {
    return { timedOut: false, status: task.status };
  }
  if (task.deadline && now >= task.deadline) {
    _transitionTask(taskId, TASK_STATUS_V2.FAILED, { error: "timeout" });
    return { timedOut: true, status: TASK_STATUS_V2.FAILED };
  }
  return { timedOut: false, status: task.status };
}

/**
 * Get V2 task snapshot.
 */
export function getTaskV2(taskId) {
  const task = _v2Tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return { ...task, history: [...task.history] };
}

/**
 * List V2 tasks (optional filter by agentId / status).
 */
export function listTasksV2({ agentId, status } = {}) {
  const out = [];
  for (const task of _v2Tasks.values()) {
    if (agentId && task.agentId !== agentId) continue;
    if (status && task.status !== status) continue;
    out.push({ ...task, history: [...task.history] });
  }
  return out;
}

// ─── Typed subscriptions ─────────────────────────────────────────

function _notifyTyped(type, resourceId, payload) {
  const key = `${type}:${resourceId}`;
  const subs = _v2TypedSubs.get(key);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(payload);
      } catch (_err) {
        // Subscriber error should not break lifecycle
      }
    }
  }
}

/**
 * Subscribe with typed filter.
 */
export function subscribeTyped(type, resourceId, callback) {
  if (!Object.values(SUBSCRIPTION_TYPE).includes(type)) {
    throw new Error(`Invalid subscription type: ${type}`);
  }
  if (!resourceId) throw new Error("resourceId is required");
  const key = `${type}:${resourceId}`;
  if (!_v2TypedSubs.has(key)) _v2TypedSubs.set(key, new Set());
  _v2TypedSubs.get(key).add(callback);
  return () => {
    const subs = _v2TypedSubs.get(key);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) _v2TypedSubs.delete(key);
    }
  };
}

// ─── Capability negotiation V2 ───────────────────────────────────

function _parseVersion(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function _semverCompatible(clientVer, serverVer) {
  const c = _parseVersion(clientVer);
  const s = _parseVersion(serverVer);
  if (!c || !s) return true; // Unknown versions → assume compatible
  if (c.major !== s.major) return false;
  // Minor: client can be ≤ server minor
  if (c.minor > s.minor) return false;
  return true;
}

/**
 * Negotiate capabilities against an agent's declared skills.
 * @param {object} opts — { required: string[], preferred?: string[], version?: string }
 * @param {object} agentCard — { capabilities: string[], version?: string }
 */
export function negotiateCapabilityV2(
  agentCard,
  { required = [], preferred = [], version },
) {
  if (!agentCard || typeof agentCard !== "object") {
    throw new Error("agentCard is required");
  }
  const caps = Array.isArray(agentCard.capabilities)
    ? agentCard.capabilities
    : [];
  const missingRequired = required.filter((c) => !caps.includes(c));
  const supportedPreferred = preferred.filter((c) => caps.includes(c));
  const missingPreferred = preferred.filter((c) => !caps.includes(c));
  const versionOk = version
    ? _semverCompatible(version, agentCard.version)
    : true;

  let result;
  if (!versionOk || missingRequired.length > 0) {
    result = NEGOTIATION_RESULT.INCOMPATIBLE;
  } else if (missingPreferred.length > 0) {
    result = NEGOTIATION_RESULT.PARTIAL;
  } else {
    result = NEGOTIATION_RESULT.COMPATIBLE;
  }
  return {
    result,
    missingRequired,
    supportedPreferred,
    missingPreferred,
    versionOk,
  };
}

// ─── Stats V2 ────────────────────────────────────────────────────

export function getA2AStatsV2() {
  const byStatus = {};
  for (const v of Object.values(TASK_STATUS_V2)) byStatus[v] = 0;
  let withDeadline = 0;
  let canceled = 0;
  for (const task of _v2Tasks.values()) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    if (task.deadline) withDeadline += 1;
    if (task.cancelReason) canceled += 1;
  }
  const cardsByStatus = {};
  for (const v of Object.values(CARD_STATUS_V2)) cardsByStatus[v] = 0;
  for (const c of _v2Cards.values()) {
    cardsByStatus[c.status] = (cardsByStatus[c.status] || 0) + 1;
  }
  return {
    tasks: {
      total: _v2Tasks.size,
      byStatus,
      withDeadline,
      canceledWithReason: canceled,
    },
    cards: {
      tracked: _v2Cards.size,
      byStatus: cardsByStatus,
    },
    subscriptions: {
      legacy: _subscriptions.size,
      typed: _v2TypedSubs.size,
    },
  };
}

/**
 * Reset V2-only in-memory state (for tests).
 */
export function _resetV2State() {
  _v2Tasks.clear();
  _v2Cards.clear();
  _v2TypedSubs.clear();
}

export { _v2Tasks, _v2Cards, _v2TypedSubs };
