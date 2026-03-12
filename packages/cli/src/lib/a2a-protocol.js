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
