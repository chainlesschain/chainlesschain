/**
 * @module security/agent-sandbox-v2
 * Phase 87: WASM isolation, fine-grained permissions, behavior monitoring, resource quotas
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

// Phase 4 (Sandbox Policy): shared policy schema from session-core.
let _sandboxPolicy = null;
function getSandboxPolicy() {
  if (_sandboxPolicy) {
    return _sandboxPolicy;
  }
  try {
    _sandboxPolicy = require("@chainlesschain/session-core/sandbox-policy");
  } catch (_e) {
    // Tolerate missing dep so the rest of the manager keeps working.
    _sandboxPolicy = {
      DEFAULT_SANDBOX_POLICY: {
        scope: "thread",
        ttlMs: null,
        idleTtlMs: null,
        cleanupOnExit: true,
        reuseAcrossRuns: false,
      },
      mergeSandboxPolicy: (_b, o) => ({ scope: "thread", ...(o || {}) }),
      resolveBundleSandboxPolicy: () => ({ scope: "thread" }),
      shouldReuseSandbox: () => false,
      isSandboxExpired: () => false,
      isSandboxIdleExpired: () => false,
    };
  }
  return _sandboxPolicy;
}

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
    // Phase 4: rehydrate live sandbox rows from the DB so idleTtl math and
    // reuse decisions work across process restart. Opt-out via autoRestore:false
    // (tests that want a pristine in-memory state).
    if (deps.autoRestore !== false) {
      try {
        const n = this.restoreFromDb();
        if (n > 0) {
          logger.info(`[AgentSandboxV2] Restored ${n} sandbox(es) from DB`);
        }
      } catch (error) {
        logger.warn("[AgentSandboxV2] auto-restore failed:", error.message);
      }
    }
    logger.info("[AgentSandboxV2] Initialized");
    if (deps.autoPrune !== false) {
      this.startPruneTimer(deps.pruneIntervalMs || 60_000);
    }
  }

  startPruneTimer(intervalMs = 60_000) {
    this.stopPruneTimer();
    this._pruneTimer = setInterval(() => {
      try {
        const out = this.pruneExpired();
        if (out.length > 0) {
          logger.info(
            `[AgentSandboxV2] pruned ${out.length} expired sandbox(es)`,
          );
        }
      } catch (error) {
        logger.warn("[AgentSandboxV2] prune timer error:", error.message);
      }
    }, intervalMs);
    if (this._pruneTimer.unref) {
      this._pruneTimer.unref();
    }
  }

  stopPruneTimer() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
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
          policy TEXT,
          created_at_ms INTEGER,
          last_used_at_ms INTEGER,
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
      // Phase 4: add policy/timestamp columns to legacy DBs. ALTER is a no-op
      // if the column already exists, so swallow "duplicate column" errors.
      for (const ddl of [
        "ALTER TABLE sandbox_instances ADD COLUMN policy TEXT",
        "ALTER TABLE sandbox_instances ADD COLUMN created_at_ms INTEGER",
        "ALTER TABLE sandbox_instances ADD COLUMN last_used_at_ms INTEGER",
      ]) {
        try {
          this.db.exec(ddl);
        } catch (_e) {
          // column already present
        }
      }
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
      lastUsedAt: Date.now(),
      // Phase 4: lifecycle policy attached to the sandbox instance.
      policy: this._resolvePolicy(options),
    };

    this._sandboxes.set(id, sandbox);
    this._persistSandbox(sandbox);
    this.emit("sandbox:created", {
      id,
      agentId,
      scope: sandbox.policy?.scope || "thread",
    });
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
    try {
      this.db
        .prepare(
          "UPDATE sandbox_instances SET status = 'destroyed', destroyed_at = datetime('now') WHERE id = ?",
        )
        .run(sandboxId);
    } catch (_e) {
      // non-critical persistence failure
    }
    this.emit("sandbox:destroyed", { sandboxId });
    return true;
  }

  // ---- Phase 4: bundle-aware lifecycle ----

  _resolvePolicy(options = {}) {
    const { mergeSandboxPolicy, resolveBundleSandboxPolicy } =
      getSandboxPolicy();
    if (options.bundle) {
      const base = resolveBundleSandboxPolicy(options.bundle);
      return mergeSandboxPolicy(base, options.policy || {});
    }
    return mergeSandboxPolicy({}, options.policy || {});
  }

  /**
   * Touch a sandbox so idle TTL doesn't expire it.
   */
  touchSandbox(sandboxId) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }
    sandbox.lastUsedAt = Date.now();
    try {
      this.db
        .prepare(
          "UPDATE sandbox_instances SET last_used_at_ms = ? WHERE id = ?",
        )
        .run(sandbox.lastUsedAt, sandboxId);
    } catch (_e) {
      // non-critical persistence failure
    }
    return true;
  }

  /**
   * Acquire a sandbox for an agent: reuse an existing live one if the bundle's
   * sandbox policy permits it, otherwise create a fresh sandbox.
   *
   * Returns `{ id, reused: boolean, scope }`.
   */
  acquireSandbox(agentId, options = {}) {
    const { shouldReuseSandbox } = getSandboxPolicy();
    const policy = this._resolvePolicy(options);
    const now = Date.now();

    if (policy.reuseAcrossRuns) {
      for (const sandbox of this._sandboxes.values()) {
        if (sandbox.agentId !== agentId) {
          continue;
        }
        if (sandbox.status === "destroyed") {
          continue;
        }
        if (
          shouldReuseSandbox(
            sandbox.policy || policy,
            { createdAt: sandbox.createdAt, lastUsedAt: sandbox.lastUsedAt },
            now,
          )
        ) {
          sandbox.lastUsedAt = now;
          this.emit("sandbox:reused", {
            id: sandbox.id,
            agentId,
            scope: sandbox.policy?.scope || policy.scope,
          });
          return {
            id: sandbox.id,
            reused: true,
            scope: sandbox.policy?.scope || policy.scope,
          };
        }
      }
    }

    const created = this.createSandbox(agentId, { ...options, policy });
    return { id: created.id, reused: false, scope: policy.scope };
  }

  /**
   * Sweep sandboxes whose ttl or idle ttl expired. Destroys them and returns
   * the destroyed ids. Safe to call from a periodic timer.
   */
  pruneExpired(now = Date.now()) {
    const { isSandboxExpired, isSandboxIdleExpired } = getSandboxPolicy();
    const destroyed = [];
    for (const sandbox of Array.from(this._sandboxes.values())) {
      const policy = sandbox.policy;
      if (!policy) {
        continue;
      }
      const ttlExpired = isSandboxExpired(policy, sandbox.createdAt, now);
      const idleExpired = isSandboxIdleExpired(policy, sandbox.lastUsedAt, now);
      if (ttlExpired || idleExpired) {
        if (this.destroySandbox(sandbox.id)) {
          destroyed.push({
            id: sandbox.id,
            reason: ttlExpired ? "ttl" : "idle",
          });
        }
      }
    }
    return destroyed;
  }

  _persistSandbox(sandbox) {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sandbox_instances (id, agent_id, status, permissions, quota, policy, created_at_ms, last_used_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          sandbox.id,
          sandbox.agentId,
          sandbox.status,
          JSON.stringify(sandbox.permissions),
          JSON.stringify(sandbox.quota),
          sandbox.policy ? JSON.stringify(sandbox.policy) : null,
          sandbox.createdAt ?? null,
          sandbox.lastUsedAt ?? null,
        );
    } catch (error) {
      logger.error("[AgentSandboxV2] Persist failed:", error.message);
    }
  }

  /**
   * Phase 4: restore live sandboxes from sqlite on startup so idleTtl math
   * survives process restart. Rows with `status='destroyed'` are skipped.
   * Returns the count of restored sandboxes.
   */
  restoreFromDb() {
    let restored = 0;
    try {
      const rows = this.db
        .prepare(
          "SELECT id, agent_id, status, permissions, quota, policy, created_at_ms, last_used_at_ms FROM sandbox_instances WHERE status != 'destroyed'",
        )
        .all();
      const now = Date.now();
      for (const row of rows) {
        if (!row || !row.id) {
          continue;
        }
        const policy = row.policy ? JSON.parse(row.policy) : null;
        this._sandboxes.set(row.id, {
          id: row.id,
          agentId: row.agent_id,
          status: row.status || "idle",
          permissions: row.permissions ? JSON.parse(row.permissions) : {},
          quota: row.quota
            ? JSON.parse(row.quota)
            : { ...this._config.defaultQuota },
          usage: { cpu: 0, memory: 0, storage: 0, network: 0 },
          createdAt: row.created_at_ms || now,
          lastUsedAt: row.last_used_at_ms || now,
          policy,
        });
        restored += 1;
      }
    } catch (error) {
      logger.warn("[AgentSandboxV2] restoreFromDb failed:", error.message);
    }
    if (restored > 0) {
      logger.info(`[AgentSandboxV2] restored ${restored} sandbox(es) from db`);
    }
    return restored;
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
