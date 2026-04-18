/**
 * Hook Manager — Lifecycle hook registration, execution, and statistics for CLI.
 * Manages hooks that trigger on system events (IPC, tools, sessions, git, etc.).
 */

import crypto from "crypto";

/**
 * Hook priority levels — lower values run first.
 */
export const HookPriority = {
  SYSTEM: 0,
  HIGH: 100,
  NORMAL: 500,
  LOW: 900,
  MONITOR: 1000,
};

/**
 * Hook execution types.
 */
export const HookType = {
  SYNC: "sync",
  ASYNC: "async",
  COMMAND: "command",
  SCRIPT: "script",
};

/**
 * All supported hook event names.
 */
export const HookEvents = {
  PreIPCCall: "PreIPCCall",
  PostIPCCall: "PostIPCCall",
  IPCError: "IPCError",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  ToolError: "ToolError",
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
  PreCompact: "PreCompact",
  PostCompact: "PostCompact",
  UserPromptSubmit: "UserPromptSubmit",
  AssistantResponse: "AssistantResponse",
  AgentStart: "AgentStart",
  AgentStop: "AgentStop",
  TaskAssigned: "TaskAssigned",
  TaskCompleted: "TaskCompleted",
  PreFileAccess: "PreFileAccess",
  PostFileAccess: "PostFileAccess",
  FileModified: "FileModified",
  MemorySave: "MemorySave",
  MemoryLoad: "MemoryLoad",
  AuditLog: "AuditLog",
  ComplianceCheck: "ComplianceCheck",
  DataSubjectRequest: "DataSubjectRequest",
  PreGitCommit: "PreGitCommit",
  PostGitCommit: "PostGitCommit",
  PreGitPush: "PreGitPush",
  CIFailure: "CIFailure",
  IterationWarning: "IterationWarning",
  IterationBudgetExhausted: "IterationBudgetExhausted",
};

/**
 * Ensure hooks table exists in the database.
 */
export function ensureHookTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'sync',
      priority INTEGER NOT NULL DEFAULT 500,
      handler TEXT,
      matcher TEXT,
      timeout INTEGER DEFAULT 5000,
      enabled INTEGER DEFAULT 1,
      description TEXT,
      execution_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      total_execution_time REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Register a new hook.
 */
export function registerHook(db, hookConfig) {
  ensureHookTables(db);

  const {
    event,
    name,
    type = HookType.SYNC,
    priority = HookPriority.NORMAL,
    handler,
    matcher,
    timeout = 5000,
    enabled = true,
    description,
  } = hookConfig;

  if (!event) {
    throw new Error("Hook event is required");
  }
  if (!name) {
    throw new Error("Hook name is required");
  }

  // Validate event name
  if (!Object.values(HookEvents).includes(event)) {
    throw new Error(
      `Invalid hook event: ${event}. Use one of: ${Object.values(HookEvents).join(", ")}`,
    );
  }

  // Validate type
  if (!Object.values(HookType).includes(type)) {
    throw new Error(
      `Invalid hook type: ${type}. Use one of: ${Object.values(HookType).join(", ")}`,
    );
  }

  const id = `hook-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO hooks (id, event, name, type, priority, handler, matcher, timeout, enabled, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event,
    name,
    type,
    priority,
    handler || null,
    matcher || null,
    timeout,
    enabled ? 1 : 0,
    description || null,
  );

  return {
    id,
    event,
    name,
    type,
    priority,
    handler,
    matcher,
    timeout,
    enabled: !!enabled,
    description,
  };
}

/**
 * Unregister (remove) a hook by ID.
 */
export function unregisterHook(db, hookId) {
  ensureHookTables(db);
  const result = db.prepare("DELETE FROM hooks WHERE id = ?").run(hookId);
  return result.changes > 0;
}

/**
 * List hooks with optional filters.
 */
export function listHooks(db, options = {}) {
  ensureHookTables(db);
  const { event, enabledOnly = false } = options;

  if (event && enabledOnly) {
    return db
      .prepare(
        "SELECT * FROM hooks WHERE event = ? AND enabled = 1 ORDER BY priority ASC",
      )
      .all(event);
  }
  if (event) {
    return db
      .prepare("SELECT * FROM hooks WHERE event = ? ORDER BY priority ASC")
      .all(event);
  }
  if (enabledOnly) {
    return db
      .prepare("SELECT * FROM hooks WHERE enabled = 1 ORDER BY priority ASC")
      .all();
  }
  return db.prepare("SELECT * FROM hooks ORDER BY priority ASC").all();
}

/**
 * Get a single hook by ID.
 */
export function getHook(db, hookId) {
  ensureHookTables(db);
  return db.prepare("SELECT * FROM hooks WHERE id = ?").get(hookId);
}

/**
 * Compile a matcher pattern into a test function.
 * Supports:
 *   - null/undefined → matches everything
 *   - Pipe-separated patterns: "Edit|Write" matches "Edit" or "Write"
 *   - Wildcards: "*" matches any chars, "?" matches one char
 *   - Regex strings starting with "/": "/^Pre/" matches "PreIPCCall"
 */
export function compileMatcher(pattern) {
  if (!pattern) {
    return () => true;
  }

  // Regex pattern (starts and ends with /)
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const lastSlash = pattern.lastIndexOf("/");
    const regexBody = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    try {
      const re = new RegExp(regexBody, flags);
      return (value) => re.test(value);
    } catch (_err) {
      // Invalid regex — fall through to wildcard matching
    }
  }

  // Pipe-separated patterns (e.g. "Edit|Write")
  if (pattern.includes("|")) {
    const parts = pattern.split("|").map((p) => p.trim());
    const matchers = parts.map((p) => compileMatcher(p));
    return (value) => matchers.some((m) => m(value));
  }

  // Wildcard pattern (* and ?)
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const re = new RegExp(`^${escaped}$`);
  return (value) => re.test(value);
}

/**
 * Execute a single hook with context.
 * Returns { success, result, error, executionTime }.
 */
export async function executeHook(hook, context = {}) {
  const start = Date.now();

  try {
    const type = hook.type || HookType.SYNC;

    if (type === HookType.COMMAND || type === HookType.SCRIPT) {
      // Command/script hooks execute a shell command
      const { execSync } = await import("child_process");
      const cmd = hook.handler || "";
      if (!cmd) {
        return {
          success: false,
          result: null,
          error: "No handler command specified",
          executionTime: 0,
        };
      }
      const env = {
        ...process.env,
        HOOK_EVENT: hook.event,
        HOOK_CONTEXT: JSON.stringify(context),
      };
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: hook.timeout || 5000,
        env,
      });
      const executionTime = Date.now() - start;
      return {
        success: true,
        result: output.trim(),
        error: null,
        executionTime,
      };
    }

    // For sync/async hooks with a handler function string
    if (hook.handlerFn && typeof hook.handlerFn === "function") {
      const result = await Promise.resolve(hook.handlerFn(context));
      const executionTime = Date.now() - start;
      return { success: true, result, error: null, executionTime };
    }

    // No executable handler
    const executionTime = Date.now() - start;
    return { success: true, result: null, error: null, executionTime };
  } catch (err) {
    const executionTime = Date.now() - start;
    return { success: false, result: null, error: err.message, executionTime };
  }
}

/**
 * Execute all hooks for a given event, in priority order.
 * Returns array of { hookId, hookName, success, result, error, executionTime }.
 */
export async function executeHooks(db, eventName, context = {}) {
  const hooks = listHooks(db, { event: eventName, enabledOnly: true });
  const results = [];

  for (const hook of hooks) {
    // Check matcher against context
    if (hook.matcher) {
      const matchFn = compileMatcher(hook.matcher);
      const target =
        context.target ||
        context.channel ||
        context.tool ||
        context.file ||
        eventName;
      if (!matchFn(target)) {
        continue;
      }
    }

    const outcome = await executeHook(hook, context);
    results.push({
      hookId: hook.id,
      hookName: hook.name,
      ...outcome,
    });

    // Update stats
    updateHookStats(db, hook.id, {
      executionTime: outcome.executionTime,
      success: outcome.success,
    });
  }

  return results;
}

/**
 * Get hook execution statistics.
 */
export function getHookStats(db) {
  ensureHookTables(db);
  const hooks = db
    .prepare(
      "SELECT id, event, name, execution_count, error_count, total_execution_time FROM hooks ORDER BY execution_count DESC",
    )
    .all();

  return hooks.map((h) => ({
    id: h.id,
    event: h.event,
    name: h.name,
    executionCount: h.execution_count || 0,
    errorCount: h.error_count || 0,
    avgExecutionTime:
      h.execution_count > 0
        ? Math.round((h.total_execution_time / h.execution_count) * 100) / 100
        : 0,
    totalExecutionTime: h.total_execution_time || 0,
  }));
}

/**
 * Update hook statistics after execution.
 */
export function updateHookStats(
  db,
  hookId,
  { executionTime = 0, success = true } = {},
) {
  ensureHookTables(db);

  const hook = getHook(db, hookId);
  if (!hook) return;

  const newCount = (hook.execution_count || 0) + 1;
  const newErrorCount = (hook.error_count || 0) + (success ? 0 : 1);
  const newTotalTime = (hook.total_execution_time || 0) + executionTime;

  db.prepare(
    "UPDATE hooks SET execution_count = ?, error_count = ?, total_execution_time = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(newCount, newErrorCount, newTotalTime, hookId);
}

// ===== V2 Surface: Hook Manager governance overlay (CLI v0.132.0) =====
// In-memory governance for hook profiles + execution lifecycle, independent of
// the legacy registerHook/executeHooks SQLite-backed path above.

export const HOOK_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DISABLED: "disabled",
  RETIRED: "retired",
});

export const HOOK_EXEC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _hookProfileTransitionsV2 = new Map([
  [
    HOOK_PROFILE_MATURITY_V2.PENDING,
    new Set([
      HOOK_PROFILE_MATURITY_V2.ACTIVE,
      HOOK_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    HOOK_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      HOOK_PROFILE_MATURITY_V2.DISABLED,
      HOOK_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    HOOK_PROFILE_MATURITY_V2.DISABLED,
    new Set([
      HOOK_PROFILE_MATURITY_V2.ACTIVE,
      HOOK_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [HOOK_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _hookProfileTerminalV2 = new Set([HOOK_PROFILE_MATURITY_V2.RETIRED]);

const _hookExecTransitionsV2 = new Map([
  [
    HOOK_EXEC_LIFECYCLE_V2.QUEUED,
    new Set([HOOK_EXEC_LIFECYCLE_V2.RUNNING, HOOK_EXEC_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    HOOK_EXEC_LIFECYCLE_V2.RUNNING,
    new Set([
      HOOK_EXEC_LIFECYCLE_V2.COMPLETED,
      HOOK_EXEC_LIFECYCLE_V2.FAILED,
      HOOK_EXEC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [HOOK_EXEC_LIFECYCLE_V2.COMPLETED, new Set()],
  [HOOK_EXEC_LIFECYCLE_V2.FAILED, new Set()],
  [HOOK_EXEC_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _hookExecTerminalV2 = new Set([
  HOOK_EXEC_LIFECYCLE_V2.COMPLETED,
  HOOK_EXEC_LIFECYCLE_V2.FAILED,
  HOOK_EXEC_LIFECYCLE_V2.CANCELLED,
]);

const _hookProfilesV2 = new Map();
const _hookExecsV2 = new Map();
let _maxActiveHooksPerOwnerV2 = 20;
let _maxPendingExecsPerHookV2 = 32;
let _hookIdleMsV2 = 24 * 60 * 60 * 1000;
let _hookExecStuckMsV2 = 60 * 1000;

function _hookPosIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}

export function setMaxActiveHooksPerOwnerV2(n) {
  _maxActiveHooksPerOwnerV2 = _hookPosIntV2(n, "maxActiveHooksPerOwner");
}
export function getMaxActiveHooksPerOwnerV2() {
  return _maxActiveHooksPerOwnerV2;
}
export function setMaxPendingExecsPerHookV2(n) {
  _maxPendingExecsPerHookV2 = _hookPosIntV2(n, "maxPendingExecsPerHook");
}
export function getMaxPendingExecsPerHookV2() {
  return _maxPendingExecsPerHookV2;
}
export function setHookIdleMsV2(n) {
  _hookIdleMsV2 = _hookPosIntV2(n, "hookIdleMs");
}
export function getHookIdleMsV2() {
  return _hookIdleMsV2;
}
export function setHookExecStuckMsV2(n) {
  _hookExecStuckMsV2 = _hookPosIntV2(n, "hookExecStuckMs");
}
export function getHookExecStuckMsV2() {
  return _hookExecStuckMsV2;
}

export function _resetStateHookManagerV2() {
  _hookProfilesV2.clear();
  _hookExecsV2.clear();
  _maxActiveHooksPerOwnerV2 = 20;
  _maxPendingExecsPerHookV2 = 32;
  _hookIdleMsV2 = 24 * 60 * 60 * 1000;
  _hookExecStuckMsV2 = 60 * 1000;
}

export function registerHookProfileV2({ id, owner, event, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_hookProfilesV2.has(id))
    throw new Error(`hook profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    event: event || "*",
    status: HOOK_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _hookProfilesV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}

function _hookProfileCheck(from, to) {
  const allowed = _hookProfileTransitionsV2.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid hook profile transition ${from} → ${to}`);
}

function _countActiveHooksByOwner(owner) {
  let n = 0;
  for (const p of _hookProfilesV2.values()) {
    if (p.owner === owner && p.status === HOOK_PROFILE_MATURITY_V2.ACTIVE) n++;
  }
  return n;
}

export function activateHookProfileV2(id) {
  const p = _hookProfilesV2.get(id);
  if (!p) throw new Error(`hook profile ${id} not found`);
  _hookProfileCheck(p.status, HOOK_PROFILE_MATURITY_V2.ACTIVE);
  const isRecovery = p.status === HOOK_PROFILE_MATURITY_V2.DISABLED;
  if (!isRecovery) {
    const active = _countActiveHooksByOwner(p.owner);
    if (active >= _maxActiveHooksPerOwnerV2) {
      throw new Error(
        `max active hooks per owner (${_maxActiveHooksPerOwnerV2}) reached for ${p.owner}`,
      );
    }
  }
  const now = Date.now();
  p.status = HOOK_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function disableHookProfileV2(id) {
  const p = _hookProfilesV2.get(id);
  if (!p) throw new Error(`hook profile ${id} not found`);
  _hookProfileCheck(p.status, HOOK_PROFILE_MATURITY_V2.DISABLED);
  const now = Date.now();
  p.status = HOOK_PROFILE_MATURITY_V2.DISABLED;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function retireHookProfileV2(id) {
  const p = _hookProfilesV2.get(id);
  if (!p) throw new Error(`hook profile ${id} not found`);
  _hookProfileCheck(p.status, HOOK_PROFILE_MATURITY_V2.RETIRED);
  const now = Date.now();
  p.status = HOOK_PROFILE_MATURITY_V2.RETIRED;
  p.updatedAt = now;
  if (!p.retiredAt) p.retiredAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function touchHookProfileV2(id) {
  const p = _hookProfilesV2.get(id);
  if (!p) throw new Error(`hook profile ${id} not found`);
  if (_hookProfileTerminalV2.has(p.status))
    throw new Error(`cannot touch terminal hook profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function getHookProfileV2(id) {
  const p = _hookProfilesV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}

export function listHookProfilesV2() {
  return [..._hookProfilesV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _countPendingExecsByHook(hookId) {
  let n = 0;
  for (const e of _hookExecsV2.values()) {
    if (
      e.hookId === hookId &&
      (e.status === HOOK_EXEC_LIFECYCLE_V2.QUEUED ||
        e.status === HOOK_EXEC_LIFECYCLE_V2.RUNNING)
    )
      n++;
  }
  return n;
}

export function createHookExecV2({ id, hookId, payload, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!hookId || typeof hookId !== "string")
    throw new Error("hookId is required");
  if (_hookExecsV2.has(id)) throw new Error(`hook exec ${id} already exists`);
  const hook = _hookProfilesV2.get(hookId);
  if (!hook) throw new Error(`hook profile ${hookId} not found`);
  const pending = _countPendingExecsByHook(hookId);
  if (pending >= _maxPendingExecsPerHookV2) {
    throw new Error(
      `max pending execs per hook (${_maxPendingExecsPerHookV2}) reached for ${hookId}`,
    );
  }
  const now = Date.now();
  const e = {
    id,
    hookId,
    payload: payload || null,
    status: HOOK_EXEC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _hookExecsV2.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}

function _hookExecCheck(from, to) {
  const allowed = _hookExecTransitionsV2.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid hook exec transition ${from} → ${to}`);
}

export function startHookExecV2(id) {
  const e = _hookExecsV2.get(id);
  if (!e) throw new Error(`hook exec ${id} not found`);
  _hookExecCheck(e.status, HOOK_EXEC_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  e.status = HOOK_EXEC_LIFECYCLE_V2.RUNNING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}

export function completeHookExecV2(id) {
  const e = _hookExecsV2.get(id);
  if (!e) throw new Error(`hook exec ${id} not found`);
  _hookExecCheck(e.status, HOOK_EXEC_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  e.status = HOOK_EXEC_LIFECYCLE_V2.COMPLETED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}

export function failHookExecV2(id, reason) {
  const e = _hookExecsV2.get(id);
  if (!e) throw new Error(`hook exec ${id} not found`);
  _hookExecCheck(e.status, HOOK_EXEC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = HOOK_EXEC_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}

export function cancelHookExecV2(id, reason) {
  const e = _hookExecsV2.get(id);
  if (!e) throw new Error(`hook exec ${id} not found`);
  _hookExecCheck(e.status, HOOK_EXEC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = HOOK_EXEC_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}

export function getHookExecV2(id) {
  const e = _hookExecsV2.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}

export function listHookExecsV2() {
  return [..._hookExecsV2.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}

export function autoDisableIdleHooksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _hookProfilesV2.values()) {
    if (
      p.status === HOOK_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _hookIdleMsV2
    ) {
      p.status = HOOK_PROFILE_MATURITY_V2.DISABLED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckHookExecsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _hookExecsV2.values()) {
    if (
      e.status === HOOK_EXEC_LIFECYCLE_V2.RUNNING &&
      e.startedAt != null &&
      t - e.startedAt >= _hookExecStuckMsV2
    ) {
      e.status = HOOK_EXEC_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function getHookManagerStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(HOOK_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _hookProfilesV2.values()) profilesByStatus[p.status]++;
  const execsByStatus = {};
  for (const s of Object.values(HOOK_EXEC_LIFECYCLE_V2)) execsByStatus[s] = 0;
  for (const e of _hookExecsV2.values()) execsByStatus[e.status]++;
  return {
    totalProfilesV2: _hookProfilesV2.size,
    totalExecsV2: _hookExecsV2.size,
    maxActiveHooksPerOwner: _maxActiveHooksPerOwnerV2,
    maxPendingExecsPerHook: _maxPendingExecsPerHookV2,
    hookIdleMs: _hookIdleMsV2,
    hookExecStuckMs: _hookExecStuckMsV2,
    profilesByStatus,
    execsByStatus,
  };
}
