/**
 * Sandbox v2 — Security sandbox with permissions, quotas, and behavior monitoring.
 * Provides isolated execution environments for agent code with fine-grained access control.
 */

import crypto from "crypto";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);

// Phase 4: shared sandbox-policy from session-core (lazy, fallback stubs).
let _sandboxPolicy = null;
function getSandboxPolicy() {
  if (_sandboxPolicy) return _sandboxPolicy;
  try {
    _sandboxPolicy = _require("@chainlesschain/session-core/sandbox-policy");
  } catch (_e) {
    _sandboxPolicy = {
      mergeSandboxPolicy: (_b, o) => ({ scope: "thread", ...(o || {}) }),
      resolveBundleSandboxPolicy: () => ({ scope: "thread" }),
      shouldReuseSandbox: () => false,
      isSandboxExpired: () => false,
      isSandboxIdleExpired: () => false,
    };
  }
  return _sandboxPolicy;
}

function resolvePolicy(options = {}) {
  const { mergeSandboxPolicy, resolveBundleSandboxPolicy } = getSandboxPolicy();
  if (options.bundle) {
    const base = resolveBundleSandboxPolicy(options.bundle);
    return mergeSandboxPolicy(base, options.policy || {});
  }
  return mergeSandboxPolicy({}, options.policy || {});
}

// ─── Constants ────────────────────────────────────────────────

export const DEFAULT_QUOTA = {
  cpu: 100,
  memory: 256 * 1024 * 1024,
  storage: 100 * 1024 * 1024,
  network: 1000,
};

export const DEFAULT_PERMISSIONS = {
  fileSystem: {
    read: ["/tmp"],
    write: ["/tmp"],
    denied: ["/etc", "/usr", "/sys"],
  },
  network: {
    allowed: ["localhost"],
    denied: [],
    maxConnections: 10,
  },
  systemCalls: {
    allowed: ["read", "write", "open", "close", "stat"],
    denied: ["exec", "fork", "kill", "mount"],
  },
};

// ─── In-memory stores ─────────────────────────────────────────

const activeSandboxes = new Map();
const auditLog = [];

// Phase 4: sync persisted rows for sandboxes this process hasn't seen yet so
// reuse/prune decisions honor createdAt/lastUsedAt across CLI restarts.
// Idempotent and cheap — a single indexed SELECT per call.
function _syncFromDb(db) {
  if (!db) return;
  try {
    const rows = db
      .prepare(`SELECT id FROM sandbox_instances WHERE status = 'active'`)
      .all();
    const missing = rows.some((r) => !activeSandboxes.has(r.id));
    if (missing) restoreFromDb(db);
  } catch (_e) {
    // best-effort — callers continue with fresh in-memory state
  }
}

// ─── Database helpers ─────────────────────────────────────────

/**
 * Create sandbox-related tables.
 */
export function ensureSandboxTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_instances (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      permissions TEXT,
      quota TEXT,
      resource_usage TEXT,
      policy TEXT,
      created_at_ms INTEGER,
      last_used_at_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Phase 4: in-place migration for legacy CLI DBs. ALTER is a no-op if the
  // column already exists, so swallow "duplicate column" errors.
  for (const ddl of [
    "ALTER TABLE sandbox_instances ADD COLUMN policy TEXT",
    "ALTER TABLE sandbox_instances ADD COLUMN created_at_ms INTEGER",
    "ALTER TABLE sandbox_instances ADD COLUMN last_used_at_ms INTEGER",
  ]) {
    try {
      db.exec(ddl);
    } catch (_e) {
      // column already present
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_audit (
      id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      result TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_behavior (
      id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ─── Permission checking ──────────────────────────────────────

function checkFilePermission(permissions, filePath, mode) {
  const fs = permissions.fileSystem || {};
  const denied = fs.denied || [];
  for (const d of denied) {
    if (filePath.startsWith(d)) return false;
  }
  if (mode === "read") {
    const allowed = fs.read || [];
    return allowed.some((p) => filePath.startsWith(p));
  }
  if (mode === "write") {
    const allowed = fs.write || [];
    return allowed.some((p) => filePath.startsWith(p));
  }
  return false;
}

function checkNetworkPermission(permissions, host) {
  const net = permissions.network || {};
  const denied = net.denied || [];
  if (denied.includes(host)) return false;
  const allowed = net.allowed || [];
  return allowed.includes(host) || allowed.includes("*");
}

function checkSystemCallPermission(permissions, call) {
  const sys = permissions.systemCalls || {};
  const denied = sys.denied || [];
  if (denied.includes(call)) return false;
  const allowed = sys.allowed || [];
  return allowed.includes(call) || allowed.includes("*");
}

// ─── Core functions ───────────────────────────────────────────

/**
 * Create a new sandbox for an agent.
 */
export function createSandbox(db, agentId, options = {}) {
  ensureSandboxTables(db);

  const id = crypto.randomUUID();
  const permissions = options.permissions || { ...DEFAULT_PERMISSIONS };
  const quota = options.quota || { ...DEFAULT_QUOTA };
  const resourceUsage = { cpu: 0, memory: 0, storage: 0, network: 0 };

  const now = Date.now();
  const sandbox = {
    id,
    agentId,
    status: "active",
    permissions,
    quota,
    resourceUsage,
    createdAt: new Date(now).toISOString(),
    // Phase 4: lifecycle policy + timestamps (ms) for ttl / idleTtl math.
    policy: resolvePolicy(options),
    createdAtMs: now,
    lastUsedAtMs: now,
  };

  db.prepare(
    `INSERT INTO sandbox_instances (id, agent_id, status, permissions, quota, resource_usage, policy, created_at_ms, last_used_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    agentId,
    "active",
    JSON.stringify(permissions),
    JSON.stringify(quota),
    JSON.stringify(resourceUsage),
    JSON.stringify(sandbox.policy || null),
    sandbox.createdAtMs,
    sandbox.lastUsedAtMs,
  );

  activeSandboxes.set(id, sandbox);

  logAudit(db, id, "create", { agentId, permissions, quota });

  return { id, status: "active", permissions, quota };
}

/**
 * Execute code within a sandbox.
 */
export function executeSandbox(db, sandboxId, code, options = {}) {
  ensureSandboxTables(db);

  const sandbox = activeSandboxes.get(sandboxId);
  if (!sandbox || sandbox.status !== "active") {
    throw new Error(`Sandbox ${sandboxId} not found or not active`);
  }

  // Check file permissions if requested
  if (options.filePath) {
    const mode = options.fileMode || "read";
    if (!checkFilePermission(sandbox.permissions, options.filePath, mode)) {
      logAudit(db, sandboxId, "permission-denied", {
        type: "fileSystem",
        path: options.filePath,
        mode,
      });
      logBehavior(db, sandboxId, "denied-access", {
        type: "fileSystem",
        path: options.filePath,
      });
      throw new Error(
        `Permission denied: ${mode} access to ${options.filePath}`,
      );
    }
  }

  // Check network permissions if requested
  if (options.host) {
    if (!checkNetworkPermission(sandbox.permissions, options.host)) {
      logAudit(db, sandboxId, "permission-denied", {
        type: "network",
        host: options.host,
      });
      logBehavior(db, sandboxId, "denied-access", {
        type: "network",
        host: options.host,
      });
      throw new Error(`Permission denied: network access to ${options.host}`);
    }
  }

  // Check system call permissions if requested
  if (options.systemCall) {
    if (!checkSystemCallPermission(sandbox.permissions, options.systemCall)) {
      logAudit(db, sandboxId, "permission-denied", {
        type: "systemCall",
        call: options.systemCall,
      });
      logBehavior(db, sandboxId, "denied-access", {
        type: "systemCall",
        call: options.systemCall,
      });
      throw new Error(`Permission denied: system call ${options.systemCall}`);
    }
  }

  // Check quota
  const usage = sandbox.resourceUsage;
  if (usage.cpu >= sandbox.quota.cpu) {
    logAudit(db, sandboxId, "quota-exceeded", { resource: "cpu" });
    throw new Error("Quota exceeded: CPU limit reached");
  }
  if (usage.memory >= sandbox.quota.memory) {
    logAudit(db, sandboxId, "quota-exceeded", { resource: "memory" });
    throw new Error("Quota exceeded: memory limit reached");
  }

  // Simulate execution
  const startTime = Date.now();
  let output = "";
  let exitCode = 0;

  try {
    // Simulate code evaluation (safe — just record)
    output = `Executed ${code.length} bytes of code`;
    exitCode = 0;
  } catch (err) {
    output = err.message;
    exitCode = 1;
    logBehavior(db, sandboxId, "error", { error: err.message });
  }

  const duration = Date.now() - startTime;

  // Update resource usage
  usage.cpu += 1;
  usage.memory += code.length;
  sandbox.resourceUsage = usage;

  db.prepare(
    `UPDATE sandbox_instances SET resource_usage = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(usage), sandboxId);

  logAudit(db, sandboxId, "execute", {
    codeLength: code.length,
    exitCode,
    duration,
  });

  return {
    output,
    exitCode,
    duration,
    resourceUsage: { ...usage },
  };
}

/**
 * Destroy a sandbox.
 */
export function destroySandbox(db, sandboxId) {
  ensureSandboxTables(db);

  const sandbox = activeSandboxes.get(sandboxId);
  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  sandbox.status = "destroyed";
  activeSandboxes.delete(sandboxId);

  db.prepare(
    `UPDATE sandbox_instances SET status = 'destroyed', updated_at = datetime('now') WHERE id = ?`,
  ).run(sandboxId);

  logAudit(db, sandboxId, "destroy", {});

  return { id: sandboxId, status: "destroyed" };
}

/**
 * Update permissions for a sandbox.
 */
export function setPermissions(db, sandboxId, permissions) {
  ensureSandboxTables(db);

  const sandbox = activeSandboxes.get(sandboxId);
  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  sandbox.permissions = permissions;

  db.prepare(
    `UPDATE sandbox_instances SET permissions = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(permissions), sandboxId);

  logAudit(db, sandboxId, "set-permissions", { permissions });

  return { id: sandboxId, permissions };
}

/**
 * Update quota for a sandbox.
 */
export function setQuota(db, sandboxId, quota) {
  ensureSandboxTables(db);

  const sandbox = activeSandboxes.get(sandboxId);
  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  sandbox.quota = quota;

  db.prepare(
    `UPDATE sandbox_instances SET quota = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(quota), sandboxId);

  logAudit(db, sandboxId, "set-quota", { quota });

  return { id: sandboxId, quota };
}

/**
 * Get sandbox information.
 */
export function getSandbox(db, sandboxId) {
  ensureSandboxTables(db);

  const sandbox = activeSandboxes.get(sandboxId);
  if (sandbox) {
    return {
      id: sandbox.id,
      agentId: sandbox.agentId,
      status: sandbox.status,
      permissions: sandbox.permissions,
      quota: sandbox.quota,
      resourceUsage: sandbox.resourceUsage,
      createdAt: sandbox.createdAt,
    };
  }

  // Fallback to DB
  const row = db
    .prepare(`SELECT * FROM sandbox_instances WHERE id = ?`)
    .get(sandboxId);
  if (!row) return null;

  return {
    id: row.id,
    agentId: row.agent_id,
    status: row.status,
    permissions: JSON.parse(row.permissions || "{}"),
    quota: JSON.parse(row.quota || "{}"),
    resourceUsage: JSON.parse(row.resource_usage || "{}"),
    createdAt: row.created_at,
  };
}

/**
 * List all active sandboxes.
 */
export function listSandboxes(db) {
  ensureSandboxTables(db);

  const results = [];
  for (const [, sandbox] of activeSandboxes) {
    if (sandbox.status === "active") {
      results.push({
        id: sandbox.id,
        agentId: sandbox.agentId,
        status: sandbox.status,
        quota: sandbox.quota,
        resourceUsage: sandbox.resourceUsage,
        createdAt: sandbox.createdAt,
      });
    }
  }
  return results;
}

/**
 * Get audit log entries.
 */
export function getAuditLog(db, sandboxId, options = {}) {
  ensureSandboxTables(db);

  let entries = [...auditLog];

  if (sandboxId) {
    entries = entries.filter((e) => e.sandboxId === sandboxId);
  }
  if (options.action) {
    entries = entries.filter((e) => e.action === options.action);
  }
  if (options.limit) {
    entries = entries.slice(-options.limit);
  }

  return entries;
}

/**
 * Monitor sandbox behavior and detect suspicious patterns.
 */
export function monitorBehavior(db, sandboxId) {
  ensureSandboxTables(db);

  const entries = auditLog.filter((e) => e.sandboxId === sandboxId);
  const patterns = [];
  let riskScore = 0;

  // Check for excessive denied access attempts
  const deniedCount = entries.filter(
    (e) => e.action === "permission-denied",
  ).length;
  if (deniedCount > 10) {
    patterns.push({
      type: "excessive-denied-access",
      count: deniedCount,
      severity: "high",
    });
    riskScore += 40;
  }

  // Check for frequent errors
  const errorEntries = auditLog.filter(
    (e) => e.sandboxId === sandboxId && e.action === "execute",
  );
  const errorCount = errorEntries.filter(
    (e) => e.details && e.details.exitCode !== 0,
  ).length;
  if (errorCount > 5) {
    patterns.push({
      type: "frequent-errors",
      count: errorCount,
      severity: "medium",
    });
    riskScore += 25;
  }

  // Check for quota exceeded attempts
  const quotaExceeded = entries.filter(
    (e) => e.action === "quota-exceeded",
  ).length;
  if (quotaExceeded > 0) {
    patterns.push({
      type: "quota-exceeded-attempts",
      count: quotaExceeded,
      severity: "medium",
    });
    riskScore += 15;
  }

  return {
    patterns,
    totalEvents: entries.length,
    riskScore: Math.min(100, riskScore),
  };
}

// ─── Internal helpers ─────────────────────────────────────────

function logAudit(db, sandboxId, action, details) {
  const entry = {
    id: crypto.randomUUID(),
    sandboxId,
    action,
    details,
    timestamp: new Date().toISOString(),
  };
  auditLog.push(entry);

  db.prepare(
    `INSERT INTO sandbox_audit (id, sandbox_id, action, details, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.id, sandboxId, action, JSON.stringify(details), entry.timestamp);
}

function logBehavior(db, sandboxId, eventType, eventData) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sandbox_behavior (id, sandbox_id, event_type, event_data)
     VALUES (?, ?, ?, ?)`,
  ).run(id, sandboxId, eventType, JSON.stringify(eventData));
}

/**
 * Phase 4: refresh lastUsedAt so idle TTL doesn't expire the sandbox.
 */
export function touchSandbox(sandboxId, db = null) {
  const sandbox = activeSandboxes.get(sandboxId);
  if (!sandbox) return false;
  sandbox.lastUsedAtMs = Date.now();
  if (db) {
    try {
      db.prepare(
        `UPDATE sandbox_instances SET last_used_at_ms = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(sandbox.lastUsedAtMs, sandboxId);
    } catch (_e) {
      // persistence best-effort — in-memory touch already applied
    }
  }
  return true;
}

/**
 * Phase 4: rehydrate live sandbox rows from DB into the in-memory map so
 * idle/ttl math and reuse decisions survive a CLI process restart.
 * Returns the number of restored sandboxes.
 */
export function restoreFromDb(db) {
  ensureSandboxTables(db);
  let restored = 0;
  const rows = db
    .prepare(
      `SELECT id, agent_id, status, permissions, quota, resource_usage, policy, created_at_ms, last_used_at_ms, created_at
       FROM sandbox_instances WHERE status = 'active'`,
    )
    .all();
  const now = Date.now();
  for (const row of rows) {
    let policy = null;
    try {
      policy = row.policy ? JSON.parse(row.policy) : null;
    } catch (_e) {
      policy = null;
    }
    activeSandboxes.set(row.id, {
      id: row.id,
      agentId: row.agent_id,
      status: row.status || "active",
      permissions: JSON.parse(row.permissions || "{}"),
      quota: JSON.parse(row.quota || "{}"),
      resourceUsage: JSON.parse(row.resource_usage || "{}"),
      createdAt: row.created_at || new Date(now).toISOString(),
      policy,
      createdAtMs: row.created_at_ms || now,
      lastUsedAtMs: row.last_used_at_ms || now,
    });
    restored += 1;
  }
  return restored;
}

/**
 * Phase 4: acquire a sandbox for an agent — reuse an existing one if the
 * policy permits, else create fresh. Returns `{ id, reused, scope, ... }`.
 */
export function acquireSandbox(db, agentId, options = {}) {
  const { shouldReuseSandbox } = getSandboxPolicy();
  _syncFromDb(db);
  const policy = resolvePolicy(options);
  const now = Date.now();

  if (policy.reuseAcrossRuns) {
    for (const sandbox of activeSandboxes.values()) {
      if (sandbox.agentId !== agentId) continue;
      if (sandbox.status !== "active") continue;
      if (
        shouldReuseSandbox(
          sandbox.policy || policy,
          { createdAt: sandbox.createdAtMs, lastUsedAt: sandbox.lastUsedAtMs },
          now,
        )
      ) {
        sandbox.lastUsedAtMs = now;
        return {
          id: sandbox.id,
          reused: true,
          scope: sandbox.policy?.scope || policy.scope,
          status: sandbox.status,
          permissions: sandbox.permissions,
          quota: sandbox.quota,
        };
      }
    }
  }

  const created = createSandbox(db, agentId, { ...options, policy });
  return { ...created, reused: false, scope: policy.scope };
}

/**
 * Phase 4: sweep sandboxes whose ttl / idle ttl expired, mark them destroyed,
 * and return `[{ id, reason }]`. Safe to call from a timer.
 */
export function pruneExpired(db, now = Date.now()) {
  const { isSandboxExpired, isSandboxIdleExpired } = getSandboxPolicy();
  _syncFromDb(db);
  const destroyed = [];
  for (const sandbox of Array.from(activeSandboxes.values())) {
    const policy = sandbox.policy;
    if (!policy) continue;
    if (sandbox.status !== "active") continue;
    const ttlExpired = isSandboxExpired(policy, sandbox.createdAtMs, now);
    const idleExpired = isSandboxIdleExpired(policy, sandbox.lastUsedAtMs, now);
    if (ttlExpired || idleExpired) {
      try {
        destroySandbox(db, sandbox.id);
        destroyed.push({
          id: sandbox.id,
          reason: ttlExpired ? "ttl" : "idle",
        });
      } catch (_e) {
        // skip — destroySandbox may throw if already gone
      }
    }
  }
  return destroyed;
}

/**
 * Clear in-memory state (for testing).
 */
export function _resetState() {
  activeSandboxes.clear();
  auditLog.length = 0;
  _v2Isolations.length = 0;
}

// ═════════════════════════════════════════════════════════════════
// Phase 87 — Agent Security Sandbox 2.0 additions (strictly-additive)
// Frozen canonical enums + lifecycle state machine (pause/resume/
// terminate) + per-type quota + explicit enforce/check helpers +
// risk-level classification + auto-isolate + filtered audit/stats.
// ═════════════════════════════════════════════════════════════════

export const SANDBOX_STATUS = Object.freeze({
  CREATING: "creating",
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  TERMINATED: "terminated",
  ERROR: "error",
});

export const PERMISSION_TYPE = Object.freeze({
  FILESYSTEM: "filesystem",
  NETWORK: "network",
  SYSCALL: "syscall",
  IPC: "ipc",
  PROCESS: "process",
});

export const RISK_LEVEL = Object.freeze({
  SAFE: "safe",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

export const QUOTA_TYPE = Object.freeze({
  CPU_PERCENT: "cpu_percent",
  MEMORY_MB: "memory_mb",
  DISK_MB: "disk_mb",
  NETWORK_KBPS: "network_kbps",
  PROCESS_COUNT: "process_count",
});

const _PERM_TYPE_VALUES = new Set(Object.values(PERMISSION_TYPE));
const _QUOTA_TYPE_VALUES = new Set(Object.values(QUOTA_TYPE));

// V2 audit / isolation state
const _v2Isolations = [];

// QUOTA_TYPE → internal quota-field mapping (maps canonical Phase 87 names
// onto the pre-existing sandbox.quota fields).
const _QUOTA_FIELD_MAP = {
  [QUOTA_TYPE.CPU_PERCENT]: "cpu",
  [QUOTA_TYPE.MEMORY_MB]: "memory",
  [QUOTA_TYPE.DISK_MB]: "storage",
  [QUOTA_TYPE.NETWORK_KBPS]: "network",
  [QUOTA_TYPE.PROCESS_COUNT]: "processCount",
};

function _requireSandbox(sandboxId) {
  const s = activeSandboxes.get(sandboxId);
  if (!s) throw new Error(`Sandbox not found: ${sandboxId}`);
  return s;
}

/**
 * Pause a sandbox: active → paused (no execution allowed while paused).
 */
export function pauseSandboxV2(db, sandboxId) {
  ensureSandboxTables(db);
  const sandbox = _requireSandbox(sandboxId);
  if (sandbox.status === SANDBOX_STATUS.PAUSED)
    throw new Error("Sandbox already paused");
  if (sandbox.status === SANDBOX_STATUS.TERMINATED)
    throw new Error("Cannot pause terminated sandbox");
  const prev = sandbox.status;
  sandbox.status = SANDBOX_STATUS.PAUSED;
  db.prepare(
    `UPDATE sandbox_instances SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(SANDBOX_STATUS.PAUSED, sandboxId);
  logAudit(db, sandboxId, "pause", { previousStatus: prev });
  return { id: sandboxId, status: SANDBOX_STATUS.PAUSED, previousStatus: prev };
}

/**
 * Resume a paused sandbox back to active.
 */
export function resumeSandboxV2(db, sandboxId) {
  ensureSandboxTables(db);
  const sandbox = _requireSandbox(sandboxId);
  if (sandbox.status !== SANDBOX_STATUS.PAUSED)
    throw new Error(`Cannot resume: sandbox is ${sandbox.status}, not paused`);
  sandbox.status = "active";
  db.prepare(
    `UPDATE sandbox_instances SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
  ).run(sandboxId);
  logAudit(db, sandboxId, "resume", {});
  return { id: sandboxId, status: "active" };
}

/**
 * Terminate a sandbox (canonical name for destroy; records TERMINATED status).
 */
export function terminateSandboxV2(db, sandboxId, reason = null) {
  ensureSandboxTables(db);
  const sandbox = _requireSandbox(sandboxId);
  const prev = sandbox.status;
  sandbox.status = SANDBOX_STATUS.TERMINATED;
  activeSandboxes.delete(sandboxId);
  db.prepare(
    `UPDATE sandbox_instances SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(SANDBOX_STATUS.TERMINATED, sandboxId);
  logAudit(db, sandboxId, "terminate", { previousStatus: prev, reason });
  return {
    id: sandboxId,
    status: SANDBOX_STATUS.TERMINATED,
    previousStatus: prev,
    reason,
  };
}

/**
 * Set a single quota value keyed by QUOTA_TYPE. Validates type; merges into
 * existing quota object instead of replacing.
 */
export function setQuotaTyped(db, sandboxId, quotaType, limit) {
  ensureSandboxTables(db);
  if (!_QUOTA_TYPE_VALUES.has(quotaType))
    throw new Error(`Invalid quotaType: ${quotaType}`);
  if (!Number.isFinite(limit) || limit < 0)
    throw new Error(`Invalid limit: ${limit}`);
  const sandbox = _requireSandbox(sandboxId);
  const field = _QUOTA_FIELD_MAP[quotaType];
  const nextQuota = { ...sandbox.quota, [field]: limit };
  sandbox.quota = nextQuota;
  db.prepare(
    `UPDATE sandbox_instances SET quota = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(nextQuota), sandboxId);
  logAudit(db, sandboxId, "set-quota-typed", { quotaType, limit, field });
  return { id: sandboxId, quotaType, limit, quota: nextQuota };
}

/**
 * Explicit permission enforcement (boolean result + optional throw on denied).
 * Supports filesystem / network / syscall permission types.
 */
export function enforcePermission(
  sandbox,
  { type, target, mode, throwOnDeny = false } = {},
) {
  if (!_PERM_TYPE_VALUES.has(type))
    throw new Error(`Invalid permission type: ${type}`);
  if (!sandbox || !sandbox.permissions)
    throw new Error("Sandbox or permissions missing");
  let allowed = false;
  if (type === PERMISSION_TYPE.FILESYSTEM) {
    allowed = checkFilePermission(sandbox.permissions, target, mode || "read");
  } else if (type === PERMISSION_TYPE.NETWORK) {
    allowed = checkNetworkPermission(sandbox.permissions, target);
  } else if (type === PERMISSION_TYPE.SYSCALL) {
    allowed = checkSystemCallPermission(sandbox.permissions, target);
  } else {
    // IPC / PROCESS — not implemented in base library; treat as denied-by-default
    allowed = false;
  }
  if (!allowed && throwOnDeny)
    throw new Error(`Permission denied: ${type} ${mode || ""} ${target}`);
  return { allowed, type, target, mode: mode || null };
}

/**
 * Per-type quota check. Returns {ok, current, limit, remaining}.
 */
export function checkQuotaV2(sandbox, quotaType, amount = 0) {
  if (!_QUOTA_TYPE_VALUES.has(quotaType))
    throw new Error(`Invalid quotaType: ${quotaType}`);
  if (!sandbox || !sandbox.quota) throw new Error("Sandbox or quota missing");
  const field = _QUOTA_FIELD_MAP[quotaType];
  const limit = sandbox.quota[field];
  const current = (sandbox.resourceUsage?.[field] || 0) + amount;
  const remaining = limit != null ? Math.max(0, limit - current) : Infinity;
  return {
    quotaType,
    field,
    limit: limit ?? null,
    current,
    remaining,
    ok: limit == null || current <= limit,
  };
}

/**
 * Map a risk score (0..100) to a RISK_LEVEL enum value.
 * safe < 20 ≤ low < 40 ≤ medium < 60 ≤ high < 80 ≤ critical
 */
export function getRiskLevel(score) {
  const n = Number(score) || 0;
  if (n < 20) return RISK_LEVEL.SAFE;
  if (n < 40) return RISK_LEVEL.LOW;
  if (n < 60) return RISK_LEVEL.MEDIUM;
  if (n < 80) return RISK_LEVEL.HIGH;
  return RISK_LEVEL.CRITICAL;
}

/**
 * Calculate risk score via monitorBehavior and classify with RISK_LEVEL.
 */
export function calculateRiskScore(db, sandboxId) {
  const report = monitorBehavior(db, sandboxId);
  const level = getRiskLevel(report.riskScore);
  return {
    sandboxId,
    riskScore: report.riskScore,
    riskLevel: level,
    patterns: report.patterns,
    totalEvents: report.totalEvents,
  };
}

/**
 * Auto-isolate a sandbox: records an isolation entry + terminates.
 * Typical trigger: risk level == CRITICAL or explicit admin call.
 */
export function autoIsolate(db, sandboxId, reason = "high-risk") {
  ensureSandboxTables(db);
  const sandbox = _requireSandbox(sandboxId);
  const entry = {
    id: crypto.randomUUID(),
    sandboxId,
    reason,
    isolatedAt: new Date().toISOString(),
    agentId: sandbox.agentId,
  };
  _v2Isolations.push(entry);
  logAudit(db, sandboxId, "auto-isolate", { reason });
  try {
    terminateSandboxV2(db, sandboxId, reason);
  } catch (_e) {
    // swallow — sandbox may already be terminated
  }
  return entry;
}

export function listIsolations(options = {}) {
  let result = [..._v2Isolations];
  if (options.sandboxId)
    result = result.filter((i) => i.sandboxId === options.sandboxId);
  if (options.reason)
    result = result.filter((i) => i.reason === options.reason);
  return result;
}

/**
 * Filtered audit log — time range + event types + limit.
 */
export function filterAuditLog(db, sandboxId, options = {}) {
  let entries = [...auditLog];
  if (sandboxId) entries = entries.filter((e) => e.sandboxId === sandboxId);
  if (options.eventTypes && options.eventTypes.length > 0) {
    const set = new Set(options.eventTypes);
    entries = entries.filter((e) => set.has(e.action));
  }
  if (options.timeRange) {
    const from = options.timeRange.from
      ? new Date(options.timeRange.from).getTime()
      : null;
    const to = options.timeRange.to
      ? new Date(options.timeRange.to).getTime()
      : null;
    entries = entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      if (from != null && t < from) return false;
      if (to != null && t > to) return false;
      return true;
    });
  }
  if (options.limit) entries = entries.slice(-options.limit);
  return entries;
}

/**
 * Extended V2 stats: per-status sandbox counts + audit summary + isolations.
 */
export function getSandboxStatsV2() {
  const byStatus = {};
  for (const s of activeSandboxes.values()) {
    const st = s.status || "unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  const auditByAction = {};
  for (const e of auditLog) {
    auditByAction[e.action] = (auditByAction[e.action] || 0) + 1;
  }
  return {
    totalSandboxes: activeSandboxes.size,
    byStatus,
    auditEventCount: auditLog.length,
    auditByAction,
    isolations: {
      total: _v2Isolations.length,
      byReason: _v2Isolations.reduce((acc, i) => {
        acc[i.reason] = (acc[i.reason] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}
