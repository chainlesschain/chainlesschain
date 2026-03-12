/**
 * Sandbox v2 — Security sandbox with permissions, quotas, and behavior monitoring.
 * Provides isolated execution environments for agent code with fine-grained access control.
 */

import crypto from "crypto";

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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
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

  const sandbox = {
    id,
    agentId,
    status: "active",
    permissions,
    quota,
    resourceUsage,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO sandbox_instances (id, agent_id, status, permissions, quota, resource_usage)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    agentId,
    "active",
    JSON.stringify(permissions),
    JSON.stringify(quota),
    JSON.stringify(resourceUsage),
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
 * Clear in-memory state (for testing).
 */
export function _resetState() {
  activeSandboxes.clear();
  auditLog.length = 0;
}
