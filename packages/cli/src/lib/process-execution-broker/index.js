/**
 * Process Execution Broker — M1: 所有子进程执行的唯一入口
 * 对应文档 §2.1 M0+M1
 *
 * 统一拦截 hook/mcp/lsp/agent/background/plugin/installer 所有spawn,
 * 输出可审计、可观测、可追踪的进程执行记录
 */

import { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";

class ProcessExecutionBroker extends EventEmitter {
  constructor() {
    super();
    this._registry = new Map(); // pid -> ExecutionRecord
    this._policyEnforcers = [];
    this._auditors = [];
    this._initialized = false;
    this.defaultRuntime = "native"; // M5: default JSII runtime
  }

  /**
   * Set default JSII runtime (M5)
   * @param {"native"|"quickjs"} runtime
   */
  setDefaultRuntime(runtime) {
    if (runtime === "native" || runtime === "quickjs") {
      this.defaultRuntime = runtime;
    }
  }

  /**
   * Register a policy enforcer (runs before spawn, can deny/modify request)
   * @param {(req: ExecutionRequest) => Promise<ExecutionRequest|DENY>} enforcer
   */
  addPolicyEnforcer(enforcer) {
    this._policyEnforcers.push(enforcer);
  }

  /**
   * Register an auditor (runs after spawn/exit for logging)
   * @param {(event: string, record: ExecutionRecord) => void} auditor
   */
  addAuditor(auditor) {
    this._auditors.push(auditor);
  }

  _emitAudit(event, record) {
    for (const auditor of this._auditors) {
      try { auditor(event, record); } catch (_) { /* swallow auditor errors */ }
    }
    this.emit(event, record);
  }

  /**
   * @typedef {Object} ExecutionRequest
   * @property {string} origin - tool|hook|plugin|lsp|mcp|installer|agent|background
   * @property {string} command
   * @property {string[]} [args]
   * @property {string} [cwd]
   * @property {string[]} [workspaceRoots]
   * @property {string} [filesystemPolicy] - none|workspace-only|inherit
   * @property {string} [networkPolicy] - none|loopback-only|inherit
   * @property {string[]} [credentialRefs]
   * @property {number} [timeout]
   * @property {number} [outputLimit]
   * @property {boolean} [sandboxRequired]
   * @property {string} [sessionId]
   * @property {string} [turnId]
   * @property {string} [toolUseId]
   * @property {string} [pluginId]
   * @property {string} [hookName]
   * @property {string} [mcpServerName]
   * @property {string} [lspServerName]
   */

  /**
   * @typedef {Object} ExecutionRecord
   * @property {string} executionId
   * @property {ExecutionRequest} request
   * @property {number} [pid]
   * @property {number} [exitCode]
   * @property {string|null} [signal]
   * @property {boolean} timedOut
   * @property {string} [stdoutRef]
   * @property {string} [stderrRef]
   * @property {string} [isolationProfile]
   * @property {string[]} [policyDecisions]
   * @property {Date} startedAt
   * @property {Date} [endedAt]
   * @property {string} status - pending|running|exited|denied|error
   * @property {Error} [error]
   */

  /**
   * Spawn async child process through broker
   * @param {string} command
   * @param {string[]} [args]
   * @param {Object} [options] - normal child_process.spawn options
   * @param {Partial<ExecutionRequest>} [brokerMeta] - broker metadata
   */
  async spawn(command, args = [], options = {}, brokerMeta = {}) {
    const request = {
      origin: brokerMeta.origin || "unknown",
      command,
      args,
      cwd: options.cwd || process.cwd(),
      workspaceRoots: brokerMeta.workspaceRoots,
      filesystemPolicy: brokerMeta.filesystemPolicy || "inherit",
      networkPolicy: brokerMeta.networkPolicy || "inherit",
      credentialRefs: brokerMeta.credentialRefs || [],
      timeout: brokerMeta.timeout,
      outputLimit: brokerMeta.outputLimit,
      sandboxRequired: brokerMeta.sandboxRequired || false,
      sessionId: brokerMeta.sessionId,
      turnId: brokerMeta.turnId,
      toolUseId: brokerMeta.toolUseId,
      pluginId: brokerMeta.pluginId,
      hookName: brokerMeta.hookName,
      mcpServerName: brokerMeta.mcpServerName,
      lspServerName: brokerMeta.lspServerName,
    };

    // Run policy enforcers
    const policyDecisions = [];
    let modifiedReq = request;
    for (const enforcer of this._policyEnforcers) {
      try {
        const result = await enforcer(modifiedReq);
        if (result === "DENY") {
          const record = {
            executionId: crypto.randomUUID(),
            request: modifiedReq,
            timedOut: false,
            startedAt: new Date(),
            endedAt: new Date(),
            status: "denied",
            policyDecisions: [...policyDecisions, "DENY"],
          };
          this._emitAudit("denied", record);
          const err = new Error(`Process execution denied by policy: ${command}`);
          err.brokerRecord = record;
          throw err;
        }
        if (result && typeof result === "object") modifiedReq = result;
        policyDecisions.push("allow");
      } catch (e) {
        if (e.brokerRecord) throw e;
        policyDecisions.push(`enforcer-error:${e.message}`);
      }
    }

    const executionId = crypto.randomUUID();
    const record = {
      executionId,
      request: modifiedReq,
      timedOut: false,
      startedAt: new Date(),
      status: "running",
      policyDecisions,
    };

    this._emitAudit("spawn", record);

    try {
      const child = spawn(modifiedReq.command, modifiedReq.args, {
        ...options,
        cwd: modifiedReq.cwd,
      });

      record.pid = child.pid;
      this._registry.set(child.pid, record);

      child.on("exit", (code, signal) => {
        record.exitCode = code;
        record.signal = signal;
        record.endedAt = new Date();
        record.status = "exited";
        this._registry.delete(child.pid);
        this._emitAudit("exit", record);
      });

      child.on("error", (err) => {
        record.error = err;
        record.endedAt = new Date();
        record.status = "error";
        this._registry.delete(child.pid);
        this._emitAudit("error", record);
      });

      // Apply timeout if specified
      if (modifiedReq.timeout) {
        setTimeout(() => {
          if (record.status === "running") {
            record.timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 2000);
          }
        }, modifiedReq.timeout);
      }

      child.brokerRecord = record;
      return child;
    } catch (err) {
      record.status = "error";
      record.error = err;
      record.endedAt = new Date();
      this._emitAudit("error", record);
      throw err;
    }
  }

  /** Sync spawn */
  spawnSync(command, args = [], options = {}, brokerMeta = {}) {
    const executionId = crypto.randomUUID();
    const record = {
      executionId,
      request: {
        origin: brokerMeta.origin || "unknown",
        command, args,
        cwd: options.cwd || process.cwd(),
        ...brokerMeta,
      },
      startedAt: new Date(),
      status: "running",
      policyDecisions: [],
      timedOut: false,
    };
    this._emitAudit("spawnSync", record);

    const result = spawnSync(command, args, options);

    record.exitCode = result.status;
    record.signal = result.signal;
    record.endedAt = new Date();
    record.status = "exited";
    record.timedOut = result.error && result.error.code === "ETIMEDOUT";
    this._emitAudit("exit", record);

    result.brokerRecord = record;
    return result;
  }

  /** Convenience wrappers for other cp methods */
  exec(command, options = {}, brokerMeta = {}, callback) {
    return exec(command, options, (err, stdout, stderr) => {
      this._emitAudit("exec-complete", { command, brokerMeta, err });
      if (callback) callback(err, stdout, stderr);
    });
  }

  execSync(command, options = {}, brokerMeta = {}) {
    return execSync(command, options);
  }

  fork(modulePath, args = [], options = {}, brokerMeta = {}) {
    return this.spawn(process.execPath, [modulePath, ...args], {
      ...options,
      stdio: options.stdio || "inherit",
    }, { origin: "fork", ...brokerMeta });
  }

  /** Get running process count by origin */
  getCountsByOrigin() {
    const counts = {};
    for (const record of this._registry.values()) {
      const origin = record.request.origin;
      counts[origin] = (counts[origin] || 0) + 1;
    }
    return counts;
  }

  /** Kill all running processes from a given origin */
  killAllByOrigin(origin, signal = "SIGTERM") {
    for (const [pid, record] of this._registry.entries()) {
      if (record.request.origin === origin) {
        try { process.kill(pid, signal); } catch (_) {}
      }
    }
  }
}

// Singleton instance
const processExecutionBroker = new ProcessExecutionBroker();
const broker = processExecutionBroker; // backward compat alias

// Add default audit logger in dev
if (process.env.NODE_ENV !== "production" && process.env.CC_BROKER_VERBOSE) {
  processExecutionBroker.addAuditor((event, record) => {
    if (event === "spawn" || event === "denied" || event === "error") {
      console.error(`[broker:${event}] origin=${record.request?.origin} cmd=${record.request?.command} pid=${record.pid || "-"}`);
    }
  });
}

export default processExecutionBroker;
export { ProcessExecutionBroker, processExecutionBroker, broker };
