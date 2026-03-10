/**
 * @module security/agent-sandbox-v2
 * Phase 87: WASM isolation, fine-grained permissions, behavior monitoring, resource quotas
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class AgentSandboxV2 extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._sandboxes = new Map();
    this._auditLog = [];
    this._behaviorPatterns = new Map();
    this._quotas = new Map();
    this._config = {
      maxSandboxes: 50,
      defaultQuota: {
        cpu: 100,
        memory: 256 * 1024 * 1024,
        storage: 100 * 1024 * 1024,
        network: 1000,
      },
      auditLogLimit: 10000,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    this.initialized = true;
    logger.info("[AgentSandboxV2] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sandbox_instances (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          status TEXT DEFAULT 'created',
          permissions TEXT,
          quota TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          destroyed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sandbox_audit (
          id TEXT PRIMARY KEY,
          sandbox_id TEXT NOT NULL,
          action TEXT NOT NULL,
          resource TEXT,
          result TEXT DEFAULT 'allowed',
          timestamp TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sandbox_behavior (
          id TEXT PRIMARY KEY,
          sandbox_id TEXT NOT NULL,
          pattern TEXT NOT NULL,
          risk_level TEXT DEFAULT 'low',
          details TEXT,
          detected_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[AgentSandboxV2] Table creation warning:", error.message);
    }
  }

  // Sandbox Lifecycle
  createSandbox(agentId, options = {}) {
    if (this._sandboxes.size >= this._config.maxSandboxes) {
      throw new Error("Maximum sandbox limit reached");
    }

    const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sandbox = {
      id,
      agentId,
      status: "created",
      permissions: {
        fileSystem: options.permissions?.fileSystem || {
          read: [],
          write: [],
          denied: ["system"],
        },
        network: options.permissions?.network || {
          allowedHosts: [],
          deniedHosts: [],
          maxConnections: 10,
        },
        systemCalls: options.permissions?.systemCalls || {
          allowed: ["read", "write", "stat"],
          denied: ["exec", "spawn"],
        },
      },
      quota: { ...this._config.defaultQuota, ...(options.quota || {}) },
      usage: { cpu: 0, memory: 0, storage: 0, network: 0 },
      createdAt: Date.now(),
    };

    this._sandboxes.set(id, sandbox);
    this._persistSandbox(sandbox);
    this.emit("sandbox:created", { id, agentId });
    return {
      id,
      status: sandbox.status,
      permissions: sandbox.permissions,
      quota: sandbox.quota,
    };
  }

  // Execute code in sandbox
  async execute(sandboxId, code, options = {}) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error("Sandbox not found");
    }
    if (sandbox.status === "destroyed") {
      throw new Error("Sandbox already destroyed");
    }

    sandbox.status = "executing";
    const startTime = Date.now();

    try {
      // Permission check
      if (
        options.requiresNetwork &&
        sandbox.permissions.network.allowedHosts.length === 0 &&
        !options.allowAllNetwork
      ) {
        this._logAudit(sandboxId, "network-access", "blocked", "denied");
        throw new Error("Network access denied by sandbox policy");
      }

      // Quota check
      if (sandbox.usage.cpu >= sandbox.quota.cpu) {
        this._logAudit(sandboxId, "cpu-usage", "over-quota", "denied");
        throw new Error("CPU quota exceeded");
      }

      // In production, execute in WASM runtime
      const result = {
        output: null,
        exitCode: 0,
        duration: Date.now() - startTime,
        resourceUsage: { cpu: 1, memory: 1024, network: 0 },
      };

      // Update usage
      sandbox.usage.cpu += result.resourceUsage.cpu;
      sandbox.usage.memory = Math.max(
        sandbox.usage.memory,
        result.resourceUsage.memory,
      );
      sandbox.usage.network += result.resourceUsage.network;

      this._logAudit(sandboxId, "execute", code.substring(0, 100), "allowed");
      sandbox.status = "idle";
      this.emit("sandbox:executed", {
        sandboxId,
        duration: result.duration,
      });
      return result;
    } catch (error) {
      sandbox.status = "idle";
      this._logAudit(sandboxId, "execute-error", error.message, "error");
      throw error;
    }
  }

  // Permissions
  setPermissions(sandboxId, permissions) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      return null;
    }
    Object.assign(sandbox.permissions, permissions);
    this.emit("sandbox:permissions-updated", { sandboxId });
    return sandbox.permissions;
  }

  // Audit Log
  getAuditLog(sandboxId, options = {}) {
    let log = this._auditLog;
    if (sandboxId) {
      log = log.filter((e) => e.sandboxId === sandboxId);
    }
    if (options.action) {
      log = log.filter((e) => e.action === options.action);
    }
    const limit = options.limit || 100;
    return log.slice(-limit);
  }

  _logAudit(sandboxId, action, resource, result) {
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sandboxId,
      action,
      resource,
      result,
      timestamp: Date.now(),
    };
    this._auditLog.push(entry);
    if (this._auditLog.length > this._config.auditLogLimit) {
      this._auditLog.shift();
    }

    try {
      this.db
        .prepare(
          "INSERT INTO sandbox_audit (id, sandbox_id, action, resource, result) VALUES (?, ?, ?, ?, ?)",
        )
        .run(entry.id, sandboxId, action, resource, result);
    } catch (_error) {
      // Non-critical audit persistence failure
    }
  }

  // Quotas
  setQuota(sandboxId, quota) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      return null;
    }
    Object.assign(sandbox.quota, quota);
    return sandbox.quota;
  }

  // Behavior Monitoring
  monitorBehavior(sandboxId) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      return null;
    }

    const patterns = [];
    const log = this._auditLog.filter((e) => e.sandboxId === sandboxId);

    // Detect suspicious patterns
    const deniedCount = log.filter((e) => e.result === "denied").length;
    if (deniedCount > 10) {
      patterns.push({
        type: "excessive-denied-access",
        riskLevel: "high",
        count: deniedCount,
      });
    }

    const errorCount = log.filter((e) => e.result === "error").length;
    if (errorCount > 5) {
      patterns.push({
        type: "frequent-errors",
        riskLevel: "medium",
        count: errorCount,
      });
    }

    this._behaviorPatterns.set(sandboxId, patterns);
    return {
      sandboxId,
      patterns,
      totalEvents: log.length,
      riskScore: patterns.length > 0 ? 0.7 : 0.1,
    };
  }

  destroySandbox(sandboxId) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }
    sandbox.status = "destroyed";
    this._sandboxes.delete(sandboxId);
    this.emit("sandbox:destroyed", { sandboxId });
    return true;
  }

  _persistSandbox(sandbox) {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sandbox_instances (id, agent_id, status, permissions, quota) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          sandbox.id,
          sandbox.agentId,
          sandbox.status,
          JSON.stringify(sandbox.permissions),
          JSON.stringify(sandbox.quota),
        );
    } catch (error) {
      logger.error("[AgentSandboxV2] Persist failed:", error.message);
    }
  }
}

let instance = null;
function getAgentSandboxV2() {
  if (!instance) {
    instance = new AgentSandboxV2();
  }
  return instance;
}

module.exports = { AgentSandboxV2, getAgentSandboxV2 };
