/**
 * Inference Network — CLI port of Phase 67 去中心化推理网络
 * (docs/design/modules/38_去中心化推理网络系统.md).
 *
 * Desktop uses InferenceNodeRegistry + InferenceScheduler with real
 * P2P node discovery, GPU-aware scheduling, and privacy-mode routing.
 * CLI port ships:
 *
 *   - Node registration / heartbeat / status management
 *   - Task submission with priority + privacy mode
 *   - Simulated scheduling (round-robin to online nodes)
 *   - Scheduler stats (queue/completed/avg latency)
 *
 * What does NOT port: real P2P node discovery, GPU probe, encrypted/
 * federated inference, InferenceNetworkPage.vue, Pinia store.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const NODE_STATUS = Object.freeze({
  ONLINE: "online",
  OFFLINE: "offline",
  BUSY: "busy",
  DEGRADED: "degraded",
});

export const TASK_STATUS = Object.freeze({
  QUEUED: "queued",
  DISPATCHED: "dispatched",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
});

export const PRIVACY_MODE = Object.freeze({
  STANDARD: "standard",
  ENCRYPTED: "encrypted",
  FEDERATED: "federated",
});

export const DEFAULT_CONFIG = Object.freeze({
  maxNodes: 100,
  heartbeatIntervalMs: 30000,
  defaultPrivacyMode: "standard",
  maxPriority: 10,
});

/* ── State ─────────────────────────────────────────────── */

let _nodes = new Map();
let _tasks = new Map();

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

function _parseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (_e) {
    return fallback;
  }
}

/* ── Schema ────────────────────────────────────────────── */

export function ensureInferenceTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS inference_nodes (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    endpoint TEXT,
    capabilities TEXT,
    gpu_memory_mb INTEGER DEFAULT 0,
    status TEXT DEFAULT 'online',
    last_heartbeat INTEGER,
    task_count INTEGER DEFAULT 0,
    created_at INTEGER
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_infn_status ON inference_nodes(status)",
  );

  db.exec(`CREATE TABLE IF NOT EXISTS inference_tasks (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    input TEXT,
    output TEXT,
    privacy_mode TEXT DEFAULT 'standard',
    priority INTEGER DEFAULT 5,
    assigned_node TEXT,
    status TEXT DEFAULT 'queued',
    duration_ms INTEGER,
    created_at INTEGER,
    completed_at INTEGER
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inft_status ON inference_tasks(status)",
  );

  _loadAll(db);
}

function _loadAll(db) {
  _nodes.clear();
  _tasks.clear();
  try {
    for (const row of db.prepare("SELECT * FROM inference_nodes").all()) {
      const n = _strip(row);
      n.capabilities = _parseJson(n.capabilities, []);
      _nodes.set(n.id, n);
    }
  } catch (_e) {
    /* table may not exist */
  }
  try {
    for (const row of db.prepare("SELECT * FROM inference_tasks").all()) {
      _tasks.set(row.id, _strip(row));
    }
  } catch (_e) {
    /* table may not exist */
  }
}

/* ── Node Registry ─────────────────────────────────────── */

const VALID_NODE_STATUSES = new Set(Object.values(NODE_STATUS));

export function registerNode(
  db,
  nodeId,
  { endpoint, capabilities, gpuMemory } = {},
) {
  if (!nodeId) return { nodeId: null, reason: "missing_node_id" };

  // Check for existing node with same nodeId
  for (const n of _nodes.values()) {
    if (n.node_id === nodeId) return { nodeId: null, reason: "duplicate_node" };
  }

  if (_nodes.size >= DEFAULT_CONFIG.maxNodes) {
    return { nodeId: null, reason: "max_nodes_reached" };
  }

  const id = _id();
  const now = _now();
  const caps = capabilities || [];
  const gpu = gpuMemory || 0;

  const node = {
    id,
    node_id: nodeId,
    endpoint: endpoint || null,
    capabilities: caps,
    gpu_memory_mb: gpu,
    status: "online",
    last_heartbeat: now,
    task_count: 0,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO inference_nodes (id, node_id, endpoint, capabilities, gpu_memory_mb,
     status, last_heartbeat, task_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    nodeId,
    node.endpoint,
    JSON.stringify(caps),
    gpu,
    "online",
    now,
    0,
    now,
  );

  _nodes.set(id, node);
  return { nodeId: id };
}

export function unregisterNode(db, id) {
  const n = _nodes.get(id);
  if (!n) return { removed: false, reason: "not_found" };
  db.prepare("DELETE FROM inference_nodes WHERE id = ?").run(id);
  _nodes.delete(id);
  return { removed: true };
}

export function heartbeat(db, id) {
  const n = _nodes.get(id);
  if (!n) return { updated: false, reason: "not_found" };
  n.last_heartbeat = _now();
  if (n.status === "offline") n.status = "online";
  db.prepare(
    "UPDATE inference_nodes SET last_heartbeat = ?, status = ? WHERE id = ?",
  ).run(n.last_heartbeat, n.status, id);
  return { updated: true, status: n.status };
}

export function updateNodeStatus(db, id, status) {
  if (!VALID_NODE_STATUSES.has(status))
    return { updated: false, reason: "invalid_status" };
  const n = _nodes.get(id);
  if (!n) return { updated: false, reason: "not_found" };
  n.status = status;
  db.prepare("UPDATE inference_nodes SET status = ? WHERE id = ?").run(
    status,
    id,
  );
  return { updated: true };
}

export function getNode(db, id) {
  const n = _nodes.get(id);
  return n ? { ...n } : null;
}

export function listNodes(db, { status, capability, limit = 50 } = {}) {
  let nodes = [..._nodes.values()];
  if (status) nodes = nodes.filter((n) => n.status === status);
  if (capability)
    nodes = nodes.filter(
      (n) =>
        Array.isArray(n.capabilities) && n.capabilities.includes(capability),
    );
  return nodes
    .sort((a, b) => b.last_heartbeat - a.last_heartbeat)
    .slice(0, limit)
    .map((n) => ({ ...n }));
}

/* ── Task Scheduler ────────────────────────────────────── */

const VALID_PRIVACY_MODES = new Set(Object.values(PRIVACY_MODE));

export function submitTask(db, model, { input, privacyMode, priority } = {}) {
  if (!model) return { taskId: null, reason: "missing_model" };

  const mode = privacyMode || DEFAULT_CONFIG.defaultPrivacyMode;
  if (!VALID_PRIVACY_MODES.has(mode))
    return { taskId: null, reason: "invalid_privacy_mode" };

  const prio = Math.min(Math.max(priority || 5, 1), DEFAULT_CONFIG.maxPriority);

  const id = _id();
  const now = _now();

  // Simulated scheduling: pick first online node with lowest task_count
  let assignedNode = null;
  const onlineNodes = [..._nodes.values()]
    .filter((n) => n.status === "online")
    .sort((a, b) => a.task_count - b.task_count);
  if (onlineNodes.length > 0) {
    assignedNode = onlineNodes[0].id;
    onlineNodes[0].task_count += 1;
    db.prepare("UPDATE inference_nodes SET task_count = ? WHERE id = ?").run(
      onlineNodes[0].task_count,
      assignedNode,
    );
  }

  const status = assignedNode ? "dispatched" : "queued";
  const task = {
    id,
    model,
    input: input || null,
    output: null,
    privacy_mode: mode,
    priority: prio,
    assigned_node: assignedNode,
    status,
    duration_ms: null,
    created_at: now,
    completed_at: null,
  };

  db.prepare(
    `INSERT INTO inference_tasks (id, model, input, output, privacy_mode, priority,
     assigned_node, status, duration_ms, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    model,
    task.input,
    null,
    mode,
    prio,
    assignedNode,
    status,
    null,
    now,
    null,
  );

  _tasks.set(id, task);
  return { taskId: id, status, assignedNode };
}

export function completeTask(db, taskId, { output, durationMs } = {}) {
  const t = _tasks.get(taskId);
  if (!t) return { completed: false, reason: "not_found" };
  if (t.status === "complete")
    return { completed: false, reason: "already_complete" };
  if (t.status === "failed") return { completed: false, reason: "task_failed" };

  t.status = "complete";
  t.output = output || null;
  t.completed_at = _now();
  t.duration_ms = durationMs || t.completed_at - t.created_at;

  db.prepare(
    `UPDATE inference_tasks SET status = ?, output = ?, completed_at = ?,
     duration_ms = ? WHERE id = ?`,
  ).run("complete", t.output, t.completed_at, t.duration_ms, taskId);

  return { completed: true, durationMs: t.duration_ms };
}

export function failTask(db, taskId, { error } = {}) {
  const t = _tasks.get(taskId);
  if (!t) return { failed: false, reason: "not_found" };
  if (t.status === "complete")
    return { failed: false, reason: "already_complete" };

  t.status = "failed";
  t.output = error || null;
  t.completed_at = _now();

  db.prepare(
    "UPDATE inference_tasks SET status = ?, output = ?, completed_at = ? WHERE id = ?",
  ).run("failed", t.output, t.completed_at, taskId);

  return { failed: true };
}

export function getTask(db, taskId) {
  const t = _tasks.get(taskId);
  return t ? { ...t } : null;
}

export function listTasks(db, { status, model, privacyMode, limit = 50 } = {}) {
  let tasks = [..._tasks.values()];
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (model) tasks = tasks.filter((t) => t.model === model);
  if (privacyMode) tasks = tasks.filter((t) => t.privacy_mode === privacyMode);
  return tasks
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((t) => ({ ...t }));
}

/* ── Stats ─────────────────────────────────────────────── */

export function getSchedulerStats(db) {
  const tasks = [..._tasks.values()];
  const nodes = [..._nodes.values()];

  const completed = tasks.filter((t) => t.status === "complete");
  const queued = tasks.filter(
    (t) => t.status === "queued" || t.status === "dispatched",
  );
  const avgDuration =
    completed.length > 0
      ? Math.round(
          completed.reduce((s, t) => s + (t.duration_ms || 0), 0) /
            completed.length,
        )
      : 0;

  return {
    nodes: {
      total: nodes.length,
      online: nodes.filter((n) => n.status === "online").length,
      offline: nodes.filter((n) => n.status === "offline").length,
      busy: nodes.filter((n) => n.status === "busy").length,
    },
    tasks: {
      total: tasks.length,
      queued: queued.length,
      completed: completed.length,
      failed: tasks.filter((t) => t.status === "failed").length,
      avgDurationMs: avgDuration,
    },
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _nodes.clear();
  _tasks.clear();
  _maxConcurrentTasksPerNode = INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE;
  _heartbeatTimeoutMs = INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS;
}

/* ──────────────────────────────────────────────────────────
 *  V2 — Phase 67 surface (strictly additive)
 * ────────────────────────────────────────────────────────── */

export const NODE_STATUS_V2 = NODE_STATUS;
export const TASK_STATUS_V2 = TASK_STATUS;
export const PRIVACY_MODE_V2 = PRIVACY_MODE;

export const INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE = 4;
export const INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000;

let _maxConcurrentTasksPerNode =
  INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE;
let _heartbeatTimeoutMs = INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS;

const TASK_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["dispatched", "failed"])],
  ["dispatched", new Set(["running", "failed"])],
  ["running", new Set(["complete", "failed"])],
]);
const TASK_TERMINALS_V2 = new Set(["complete", "failed"]);

export function setMaxConcurrentTasksPerNode(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n < 1) {
    throw new Error("maxConcurrentTasksPerNode must be a positive integer");
  }
  _maxConcurrentTasksPerNode = Math.floor(n);
}

export function getMaxConcurrentTasksPerNode() {
  return _maxConcurrentTasksPerNode;
}

export function setHeartbeatTimeoutMs(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms) || ms < 1) {
    throw new Error("heartbeatTimeoutMs must be a positive integer");
  }
  _heartbeatTimeoutMs = Math.floor(ms);
}

export function getHeartbeatTimeoutMs() {
  return _heartbeatTimeoutMs;
}

export function getActiveTasksPerNode(nodeId) {
  if (!nodeId) return 0;
  let count = 0;
  for (const t of _tasks.values()) {
    if (
      t.assigned_node === nodeId &&
      (t.status === "dispatched" || t.status === "running")
    ) {
      count += 1;
    }
  }
  return count;
}

export function submitTaskV2(db, { model, input, privacyMode, priority } = {}) {
  if (!model) throw new Error("model is required");
  const mode = privacyMode || DEFAULT_CONFIG.defaultPrivacyMode;
  if (!VALID_PRIVACY_MODES.has(mode)) {
    throw new Error(`Invalid privacy mode: ${mode}`);
  }
  const prio = Math.min(Math.max(priority || 5, 1), DEFAULT_CONFIG.maxPriority);

  const id = _id();
  const now = _now();
  const task = {
    id,
    model,
    input: input || null,
    output: null,
    privacy_mode: mode,
    priority: prio,
    assigned_node: null,
    status: "queued",
    duration_ms: null,
    created_at: now,
    completed_at: null,
    started_at: null,
    error_message: null,
  };

  db.prepare(
    `INSERT INTO inference_tasks (id, model, input, output, privacy_mode, priority,
     assigned_node, status, duration_ms, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    model,
    task.input,
    null,
    mode,
    prio,
    null,
    "queued",
    null,
    now,
    null,
  );

  _tasks.set(id, task);
  return { ...task };
}

function _pickLeastLoadedOnline(privacyMode) {
  let best = null;
  let bestLoad = Infinity;
  for (const n of _nodes.values()) {
    if (n.status !== "online") continue;
    const load = getActiveTasksPerNode(n.id);
    if (load >= _maxConcurrentTasksPerNode) continue;
    if (load < bestLoad) {
      best = n;
      bestLoad = load;
    }
  }
  return best;
}

export function dispatchTaskV2(db, taskId, { nodeId } = {}) {
  const t = _tasks.get(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (t.status !== "queued") {
    throw new Error(
      `Invalid transition: ${t.status} → dispatched (must be queued)`,
    );
  }

  let target = null;
  if (nodeId) {
    target = _nodes.get(nodeId);
    if (!target) throw new Error(`Unknown node: ${nodeId}`);
    if (target.status !== "online") {
      throw new Error(`Node ${nodeId} is not online (status=${target.status})`);
    }
    if (getActiveTasksPerNode(nodeId) >= _maxConcurrentTasksPerNode) {
      throw new Error(`Max concurrent tasks reached for node ${nodeId}`);
    }
  } else {
    target = _pickLeastLoadedOnline(t.privacy_mode);
    if (!target) throw new Error("No eligible online nodes available");
  }

  t.status = "dispatched";
  t.assigned_node = target.id;
  target.task_count += 1;

  db.prepare(
    `UPDATE inference_tasks SET status = ?, assigned_node = ? WHERE id = ?`,
  ).run("dispatched", target.id, taskId);
  db.prepare("UPDATE inference_nodes SET task_count = ? WHERE id = ?").run(
    target.task_count,
    target.id,
  );

  return { ...t };
}

export function startTask(db, taskId) {
  const t = _tasks.get(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (t.status !== "dispatched") {
    throw new Error(
      `Invalid transition: ${t.status} → running (must be dispatched)`,
    );
  }
  t.status = "running";
  t.started_at = _now();
  db.prepare("UPDATE inference_tasks SET status = ? WHERE id = ?").run(
    "running",
    taskId,
  );
  return { ...t };
}

export function completeTaskV2(db, taskId, { output, durationMs } = {}) {
  const t = _tasks.get(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (t.status !== "running") {
    throw new Error(
      `Invalid transition: ${t.status} → complete (must be running)`,
    );
  }
  t.status = "complete";
  t.output = output != null ? output : null;
  t.completed_at = _now();
  if (durationMs != null) {
    t.duration_ms = durationMs;
  } else if (t.started_at) {
    t.duration_ms = t.completed_at - t.started_at;
  } else {
    t.duration_ms = t.completed_at - t.created_at;
  }

  db.prepare(
    `UPDATE inference_tasks SET status = ?, output = ?, completed_at = ?,
     duration_ms = ? WHERE id = ?`,
  ).run("complete", t.output, t.completed_at, t.duration_ms, taskId);

  return { ...t };
}

export function failTaskV2(db, taskId, { error } = {}) {
  const t = _tasks.get(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (!TASK_TRANSITIONS_V2.get(t.status)?.has("failed")) {
    throw new Error(`Invalid transition: ${t.status} → failed`);
  }
  t.status = "failed";
  t.error_message = error || null;
  t.output = error || null;
  t.completed_at = _now();

  db.prepare(
    "UPDATE inference_tasks SET status = ?, output = ?, completed_at = ? WHERE id = ?",
  ).run("failed", t.output, t.completed_at, taskId);

  return { ...t };
}

export function setTaskStatus(db, taskId, newStatus, patch = {}) {
  const t = _tasks.get(taskId);
  if (!t) throw new Error(`Unknown task: ${taskId}`);
  if (!Object.values(TASK_STATUS).includes(newStatus)) {
    throw new Error(`Unknown status: ${newStatus}`);
  }
  const allowed = TASK_TRANSITIONS_V2.get(t.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${t.status} → ${newStatus}`);
  }

  t.status = newStatus;
  if (patch.output !== undefined) t.output = patch.output;
  if (patch.errorMessage !== undefined) t.error_message = patch.errorMessage;
  if (patch.durationMs !== undefined) t.duration_ms = patch.durationMs;
  if (patch.startedAt !== undefined) t.started_at = patch.startedAt;
  if (newStatus === "running" && !t.started_at) t.started_at = _now();
  if (TASK_TERMINALS_V2.has(newStatus)) {
    t.completed_at = t.completed_at || _now();
  }

  db.prepare(
    `UPDATE inference_tasks SET status = ?, output = ?, completed_at = ?,
     duration_ms = ? WHERE id = ?`,
  ).run(newStatus, t.output, t.completed_at, t.duration_ms, taskId);

  return { ...t };
}

export function autoMarkOfflineNodes(db) {
  const cutoff = _now() - _heartbeatTimeoutMs;
  const offlined = [];
  for (const n of _nodes.values()) {
    if (n.status === "offline") continue;
    if (n.last_heartbeat < cutoff) {
      n.status = "offline";
      db.prepare("UPDATE inference_nodes SET status = ? WHERE id = ?").run(
        "offline",
        n.id,
      );
      offlined.push({ ...n });
    }
  }
  return offlined;
}

export function findEligibleNodes({ capability, privacyMode } = {}) {
  const _ = privacyMode; // reserved for future mode-aware routing
  const out = [];
  for (const n of _nodes.values()) {
    if (n.status !== "online") continue;
    if (getActiveTasksPerNode(n.id) >= _maxConcurrentTasksPerNode) continue;
    if (capability) {
      if (
        !Array.isArray(n.capabilities) ||
        !n.capabilities.includes(capability)
      ) {
        continue;
      }
    }
    out.push({ ...n });
  }
  return out.sort(
    (a, b) => getActiveTasksPerNode(a.id) - getActiveTasksPerNode(b.id),
  );
}

export function getInferenceStatsV2() {
  const nodesByStatus = {};
  for (const s of Object.values(NODE_STATUS)) nodesByStatus[s] = 0;
  const tasksByStatus = {};
  for (const s of Object.values(TASK_STATUS)) tasksByStatus[s] = 0;
  const tasksByPrivacyMode = {};
  for (const m of Object.values(PRIVACY_MODE)) tasksByPrivacyMode[m] = 0;

  const loadPerNode = {};
  for (const n of _nodes.values()) {
    nodesByStatus[n.status] = (nodesByStatus[n.status] || 0) + 1;
    loadPerNode[n.id] = getActiveTasksPerNode(n.id);
  }

  let durSum = 0;
  let durCount = 0;
  for (const t of _tasks.values()) {
    tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
    tasksByPrivacyMode[t.privacy_mode] =
      (tasksByPrivacyMode[t.privacy_mode] || 0) + 1;
    if (t.status === "complete" && typeof t.duration_ms === "number") {
      durSum += t.duration_ms;
      durCount += 1;
    }
  }

  return {
    totalNodes: _nodes.size,
    totalTasks: _tasks.size,
    maxConcurrentTasksPerNode: _maxConcurrentTasksPerNode,
    heartbeatTimeoutMs: _heartbeatTimeoutMs,
    nodesByStatus,
    tasksByStatus,
    tasksByPrivacyMode,
    loadPerNode,
    avgDurationMs: durCount > 0 ? Math.round(durSum / durCount) : 0,
  };
}
