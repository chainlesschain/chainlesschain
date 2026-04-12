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
