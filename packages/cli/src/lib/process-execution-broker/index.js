/**
 * Process Execution Broker — P0-1 生产化
 * 对应文档 §2.1 四层架构 Layer 1
 *
 * 统一拦截所有子进程执行：
 * - M1: 所有子进程唯一入口，权限检查
 * - **P0-1**: 三平台原生沙箱 (macOS Seatbelt / Windows Job Object / Linux seccomp)
 * - **P0-1**: 凭据代理 default-on（secrets 永远不裸传给子进程）
 * - M3: 集成W3C trace context自动传播
 * - M4: 自动写入Runtime Provenance Ledger (RPL)
 * - M5: Hooks v2事件发射
 */

// 直接导入原生child_process，避免递归
import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
  exec as nativeExec,
  execSync as nativeExecSync,
  execFile as nativeExecFile,
  execFileSync as nativeExecFileSync,
  fork as nativeFork,
} from "node:child_process";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// P0-1: 平台沙箱 + 凭据代理
// platform-sandbox.js exports: applySandbox, postSpawnSandbox
import {
  applySandbox as _applySandbox,
  postSpawnSandbox as _postSpawnSandbox,
} from "./platform-sandbox.js";
import { credentialAgent } from "./credential-agent.js";

// 延迟导入避免循环依赖
let _traceCtx = null;
let _rpl = null;
let _hooksV2 = null;
const _ipcBus = null;

function getTraceCtx() {
  if (!_traceCtx) {
    try {
      _traceCtx = require("../execution-trace/trace-context.js");
    } catch {
      _traceCtx = null;
    }
  }
  return _traceCtx;
}

function getRpl() {
  if (!_rpl) {
    try {
      _rpl = require("../runtime-provenance-ledger.js");
    } catch {
      _rpl = null;
    }
  }
  return _rpl;
}

function getHooksV2() {
  if (!_hooksV2) {
    try {
      _hooksV2 = require("../hooks-v2-runtime.js");
    } catch {
      _hooksV2 = null;
    }
  }
  return _hooksV2;
}

class ProcessExecutionBroker extends EventEmitter {
  constructor() {
    super();
    this._auditLog = [];
    this._permissionState = new Map();
    this._defaultTimeout = 300000;
    this._blocked = new Set(["rm -rf /", "format c:", "del /f /s /q *"]);
    this._stats = {
      totalSpawned: 0,
      allowed: 0,
      denied: 0,
      byOrigin: {},
      sandboxed: 0,
      credFiltered: 0,
    };
    this._logPath = path.join(
      os.homedir(),
      ".chainlesschain",
      "logs",
      "process-audit.log",
    );

    // P0-1: Platform sandbox functions (applySandbox/postSpawnSandbox imported above)
    // No instance needed — stateless functional API per platform

    // P0-1: Credential filtering is default-on
    this._credentialAgent = credentialAgent;
    this._credentialFilteringEnabled = true;
    this._sandboxEnabled = true;
    // Keep the legacy aliases used by older call sites and make the strict
    // plugin path use the same switches as the general broker path.
    this._credentialAgentEnabled = true;
    this._platformSandboxEnabled = true;

    this._ensureLogDir();
    this._loadPermissions();
  }

  _ensureLogDir() {
    try {
      fs.mkdirSync(path.dirname(this._logPath), { recursive: true });
    } catch {}
  }

  _loadPermissions() {
    this._permissionState.set("shell:default", "prompt");
    this._permissionState.set("background:default", "allow");
    this._permissionState.set("plugin:default", "deny");
    this._permissionState.set("mcp:default", "prompt");
    this._permissionState.set("agent:default", "prompt");
    this._permissionState.set("installer:default", "allow");
    this._permissionState.set("lsp:default", "allow");
  }

  _checkPermission(origin, command) {
    const key = `${origin}:${command}`;
    if (this._permissionState.has(key)) return this._permissionState.get(key);
    const wildcard = `${origin}:default`;
    if (this._permissionState.has(wildcard))
      return this._permissionState.get(wildcard);
    return "prompt";
  }

  _isDangerousCommand(command) {
    if (typeof command !== "string") return false;
    const lower = command.toLowerCase();
    for (const blocked of this._blocked) {
      if (lower.includes(blocked)) return true;
    }
    if (/rm\s+-rf\s+~/.test(lower)) return true;
    if (/del\s+\/[fsq].*windows/i.test(lower)) return true;
    return false;
  }

  _recordAudit(entry) {
    this._auditLog.push(entry);
    if (this._auditLog.length > 10000) this._auditLog.shift();
    this._stats.totalSpawned++;
    if (
      entry.permissionDecision === "allow" ||
      entry.permissionDecision === "elevated"
    ) {
      this._stats.allowed++;
    } else {
      this._stats.denied++;
    }
    this._stats.byOrigin[entry.origin] =
      (this._stats.byOrigin[entry.origin] || 0) + 1;
    try {
      fs.appendFileSync(this._logPath, JSON.stringify(entry) + "\n");
    } catch {}
    this.emit("spawn", entry);
  }

  _sanitizeOptions(options) {
    if (!options) return {};
    const safe = { ...options };
    if (process.platform === "win32" && safe.shell === true) {
      safe.windowsHide = true;
    }
    return safe;
  }

  _credentialBoundaryEnabled() {
    return (
      this._credentialFilteringEnabled !== false &&
      this._credentialAgentEnabled !== false
    );
  }

  _sanitizeAuditArgs(args) {
    const values = Array.isArray(args) ? args : [];
    try {
      return this._credentialAgent.sanitizeArgs(values).sanitizedArgs;
    } catch {
      return values.map(() => "***REDACTION_FAILED***");
    }
  }

  _applyCredentialBoundary(command, args, spawnOptions, origin) {
    const originalArgs = Array.isArray(args) ? [...args] : [];
    const originalEnv = spawnOptions.env || process.env;
    const input = {
      ...spawnOptions,
      env: originalEnv,
      args: originalArgs,
      file: command,
      origin,
    };
    let filtered;
    let report = null;
    if (typeof this._credentialAgent.applyWithReport === "function") {
      const result = this._credentialAgent.applyWithReport(input);
      filtered = result.spawnOptions;
      report = result.report;
    } else {
      filtered = this._credentialAgent.apply(input);
    }
    const filteredArgs = Array.isArray(filtered?.args)
      ? filtered.args
      : originalArgs;
    const filteredEnv = filtered?.env || {};
    const inferredEnvCount = Object.keys(originalEnv).filter(
      (key) =>
        this._credentialAgent.isSensitiveKey?.(key) &&
        !Object.prototype.hasOwnProperty.call(filteredEnv, key),
    ).length;
    const inferredArgCount = originalArgs.reduce(
      (count, value, index) =>
        count + (String(value) === String(filteredArgs[index]) ? 0 : 1),
      0,
    );
    const credentialReport = report || {
      envCount: inferredEnvCount,
      argCount: inferredArgCount,
      filtered: inferredEnvCount > 0 || inferredArgCount > 0,
    };
    return {
      args: filteredArgs,
      env: filteredEnv,
      report: credentialReport,
    };
  }

  _recordCredentialReport(auditEntry, report) {
    const filtered = report?.filtered === true;
    auditEntry.credentialFiltered = filtered;
    auditEntry.credentialEnvCount = Number(report?.envCount || 0);
    auditEntry.credentialArgCount = Number(report?.argCount || 0);
    if (filtered) this._stats.credFiltered++;
  }

  _getTraceContext() {
    const traceCtx = getTraceCtx();
    if (traceCtx && traceCtx.activeContext) {
      return traceCtx.activeContext.value || null;
    }
    return null;
  }

  _writeRplEntry(auditEntry, status = "started", error = null) {
    const rpl = getRpl();
    if (!rpl || !rpl.default) return;
    try {
      const traceCtx = this._getTraceContext();
      rpl.default.append(
        {
          kind: "process.execution",
          component: auditEntry.origin,
          action: "spawn",
          artifactId: auditEntry.executionId,
          artifactType: "subprocess",
          inputs: {
            command: auditEntry.command,
            args: auditEntry.args,
            cwd: auditEntry.cwd,
          },
          outputs:
            status === "completed"
              ? { exitCode: auditEntry.exitCode || 0 }
              : error
                ? { error: error.message }
                : {},
          permissions: {
            decision: auditEntry.permissionDecision,
            policy: auditEntry.policy,
            scope: auditEntry.scope,
          },
          traceId:
            traceCtx?.traceId || auditEntry.traceId || `trace-${Date.now()}`,
          parentSpanId: traceCtx?.spanId || null,
          trustLevel:
            auditEntry.permissionDecision === "deny" ? "untrusted" : "trusted",
        },
        auditEntry.origin,
      );
    } catch (e) {}
  }

  _emitHooksEvent(event, data) {
    const hooks = getHooksV2();
    if (!hooks || !hooks.hooksV2) return;
    try {
      hooks.hooksV2.emit(event, data);
    } catch {}
  }

  spawn(command, args, options = {}) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "unknown";
    const cwd = options.cwd || process.cwd();
    const scope = options.scope || "default";
    const policy = options.policy || this._checkPermission(origin, command);
    const isDangerous = this._isDangerousCommand(
      typeof command === "string" ? command : command?.toString?.() || "",
    );
    let decision = policy;
    if (isDangerous && policy !== "deny") decision = "deny";
    if (options.forceAllow) decision = "elevated";

    const traceCtx = this._getTraceContext();
    const auditEntry = {
      executionId,
      traceId: traceCtx?.traceId || null,
      origin,
      scope,
      command,
      args: this._sanitizeAuditArgs(args),
      cwd,
      startTime,
      permissionDecision: decision,
      policy,
      isDangerous,
      shell: !!options.shell,
      pid: null,
      exitCode: null,
      endTime: null,
      durationMs: null,
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
    };

    if (decision === "deny" || decision === "prompt") {
      auditEntry.deniedReason = isDangerous
        ? "dangerous_command"
        : `policy_${decision}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      this._emitHooksEvent("tool:end", {
        executionId,
        success: false,
        error: auditEntry.deniedReason,
        component: origin,
      });
      const err = new Error(
        `Process spawn denied: ${auditEntry.deniedReason} (origin=${origin}, command=${command})`,
      );
      err.auditEntry = auditEntry;
      throw err;
    }

    // 传播traceparent环境变量
    const spawnOpts = this._sanitizeOptions(options);
    if (traceCtx) {
      spawnOpts.env = { ...(spawnOpts.env || process.env) };
      spawnOpts.env.TRACEPARENT = traceCtx.traceparent;
    }

    // P0-1: Credential filtering (default-on) — strip secrets from env/args
    if (this._credentialBoundaryEnabled()) {
      const credentialBoundary = this._applyCredentialBoundary(
        command,
        args,
        spawnOpts,
        origin,
      );
      spawnOpts.env = credentialBoundary.env;
      args = credentialBoundary.args;
      auditEntry.args = [...args];
      this._recordCredentialReport(auditEntry, credentialBoundary.report);
    }

    // P0-1: Platform sandbox wrapping — apply macOS/Windows/Linux sandbox
    const optsForSpawn = { ...spawnOpts };
    let sandboxApplied = false;
    let sandboxProfile = null;
    if (this._platformSandboxEnabled) {
      try {
        const result = _applySandbox(
          command,
          args || [],
          optsForSpawn,
          "default",
        );
        if (result && result.applied) {
          Object.assign(optsForSpawn, result.options || {});
          if (result.command) command = result.command;
          if (result.args) args = result.args;
          sandboxApplied = true;
          sandboxProfile = result.profile || null;
          this._stats.sandboxed++;
        }
        auditEntry.sandboxed = sandboxApplied;
        auditEntry.sandboxProfile = sandboxProfile;
      } catch (sandboxErr) {
        // Fail closed: if sandbox setup fails on strict, deny spawn
        if (process.env.CC_SANDBOX_STRICT === "1") {
          auditEntry.deniedReason = `sandbox-init-failed: ${sandboxErr.message}`;
          this._auditLog.push(auditEntry);
          const err = new Error(`Sandbox init failed: ${sandboxErr.message}`);
          err.auditEntry = auditEntry;
          throw err;
        }
        // Non-strict: warn but allow (development mode)
        process.emitWarning(
          `Sandbox init failed (continuing without): ${sandboxErr.message}`,
        );
      }
    }

    // Use native spawn from _native (set by patch-child-process.js)
    const nativeSpawnFn = this._native?.spawn || nativeSpawn;
    const proc = nativeSpawnFn(command, args, optsForSpawn);

    // P0-1: Post-spawn sandbox setup (Windows Job Object association, etc.)
    if (sandboxApplied && proc.pid) {
      try {
        _postSpawnSandbox(proc, sandboxProfile);
      } catch (postErr) {
        process.emitWarning(
          `Post-spawn sandbox setup failed: ${postErr.message}`,
        );
      }
    }

    auditEntry.pid = proc.pid;
    this._recordAudit(auditEntry);
    this._writeRplEntry(auditEntry, "started");
    this._emitHooksEvent("tool:start", {
      executionId,
      toolName: origin,
      command,
      args,
      cwd,
      pid: proc.pid,
      component: origin,
    });

    proc.on("exit", (code, signal) => {
      const endTime = Date.now();
      auditEntry.exitCode = code;
      auditEntry.signal = signal;
      auditEntry.endTime = endTime;
      auditEntry.durationMs = endTime - startTime;
      this._writeRplEntry(auditEntry, "completed");
      this._emitHooksEvent("tool:end", {
        executionId,
        success: code === 0,
        exitCode: code,
        signal,
        durationMs: auditEntry.durationMs,
        component: origin,
      });
      this.emit("exit", auditEntry);
    });
    proc.on("error", (err) => {
      auditEntry.error = err.message;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._writeRplEntry(auditEntry, "error", err);
      this._emitHooksEvent("tool:end", {
        executionId,
        success: false,
        error: err.message,
        component: origin,
      });
      this.emit("error", auditEntry);
    });
    return proc;
  }

  spawnSync(command, args, options = {}) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "unknown";
    const cwd = options.cwd || process.cwd();
    const scope = options.scope || "default";
    const policy = options.policy || this._checkPermission(origin, command);
    const isDangerous = this._isDangerousCommand(
      typeof command === "string" ? command : command?.toString?.() || "",
    );
    let decision = policy;
    if (isDangerous && policy !== "deny") decision = "deny";
    if (options.forceAllow) decision = "elevated";

    const traceCtx = this._getTraceContext();
    const auditEntry = {
      executionId,
      traceId: traceCtx?.traceId || null,
      origin,
      scope,
      command,
      args: this._sanitizeAuditArgs(args),
      cwd,
      startTime,
      permissionDecision: decision,
      policy,
      isDangerous,
      shell: !!options.shell,
      sync: true,
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
    };

    if (decision === "deny" || decision === "prompt") {
      auditEntry.deniedReason = isDangerous
        ? "dangerous_command"
        : `policy_${decision}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      const err = new Error(
        `Process spawnSync denied: ${auditEntry.deniedReason}`,
      );
      err.auditEntry = auditEntry;
      throw err;
    }

    const spawnOpts = this._sanitizeOptions(options);
    if (traceCtx) {
      spawnOpts.env = { ...(spawnOpts.env || process.env) };
      spawnOpts.env.TRACEPARENT = traceCtx.traceparent;
    }

    // P0-1: Credential filtering agent — strip secrets from env/args before spawn
    if (this._credentialBoundaryEnabled()) {
      const credentialBoundary = this._applyCredentialBoundary(
        command,
        args,
        spawnOpts,
        origin,
      );
      spawnOpts.env = credentialBoundary.env;
      args = credentialBoundary.args;
      auditEntry.args = [...args];
      this._recordCredentialReport(auditEntry, credentialBoundary.report);
    }

    // P0-1: Platform sandbox wrapping (sync path)
    const optsForSync = { ...spawnOpts };
    let sandboxApplied = false;
    let sandboxProfile = null;
    if (this._platformSandboxEnabled) {
      try {
        const result = _applySandbox(
          command,
          args || [],
          optsForSync,
          "default",
        );
        if (result && result.applied) {
          Object.assign(optsForSync, result.options || {});
          if (result.command) command = result.command;
          if (result.args) args = result.args;
          sandboxApplied = true;
          sandboxProfile = result.profile || null;
          this._stats.sandboxed++;
        }
        auditEntry.sandboxed = sandboxApplied;
        auditEntry.sandboxProfile = sandboxProfile;
      } catch (sandboxErr) {
        if (process.env.CC_SANDBOX_STRICT === "1") {
          auditEntry.deniedReason = `sandbox-init-failed: ${sandboxErr.message}`;
          this._recordAudit(auditEntry);
          const err = new Error(`Sandbox init failed: ${sandboxErr.message}`);
          err.auditEntry = auditEntry;
          throw err;
        }
        process.emitWarning(
          `Sandbox init failed (sync): ${sandboxErr.message}`,
        );
      }
    }

    const nativeSpawnSyncFn = this._native?.spawnSync || nativeSpawnSync;
    try {
      const result = nativeSpawnSyncFn(command, args, optsForSync);
      auditEntry.exitCode = result.status;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "completed");
      return result;
    } catch (err) {
      auditEntry.error = err.message;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "error", err);
      throw err;
    }
  }

  /**
   * Route a node-pty session through the same provenance and credential
   * boundary as child_process execution. node-pty owns the native PTY
   * allocation, so the platform sandbox is reported as unavailable here
   * rather than being falsely marked as applied.
   */
  spawnPty(ptyModule, command, args = [], options = {}) {
    if (!ptyModule || typeof ptyModule.spawn !== "function") {
      throw new TypeError("pty_module_spawn_unavailable");
    }
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "terminal:pty";
    const scope = options.scope || "terminal";
    const policy = options.policy || "allow";
    const auditEntry = {
      executionId,
      traceId: this._getTraceContext()?.traceId || null,
      origin,
      scope,
      command,
      args: this._sanitizeAuditArgs(args),
      cwd: options.cwd || process.cwd(),
      startTime,
      permissionDecision: policy,
      policy,
      operation: "pty.spawn",
      pty: true,
      sandboxed: false,
      sandboxReason: "native_pty_host_boundary",
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
    };
    if (policy === "deny" || policy === "prompt") {
      auditEntry.deniedReason = `policy_${policy}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      const error = new Error(`PTY spawn denied: ${auditEntry.deniedReason}`);
      error.auditEntry = auditEntry;
      throw error;
    }

    const spawnOptions = { ...options, args: [...auditEntry.args] };
    delete spawnOptions.origin;
    delete spawnOptions.policy;
    delete spawnOptions.scope;
    delete spawnOptions.pluginId;
    delete spawnOptions.pluginVersion;
    delete spawnOptions.pluginSource;
    try {
      if (this._credentialBoundaryEnabled()) {
        const credentialBoundary = this._applyCredentialBoundary(
          command,
          args,
          spawnOptions,
          origin,
        );
        spawnOptions.env = credentialBoundary.env;
        spawnOptions.args = credentialBoundary.args;
        auditEntry.args = [...credentialBoundary.args];
        this._recordCredentialReport(auditEntry, credentialBoundary.report);
      }
      const filteredArgs = spawnOptions.args || [];
      delete spawnOptions.args;
      const proc = ptyModule.spawn(command, filteredArgs, spawnOptions);
      auditEntry.pid = proc?.pid ?? null;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "started");
      return proc;
    } catch (error) {
      auditEntry.error = error.message;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "error", error);
      throw error;
    }
  }

  exec(command, options, callback) {
    const opts = typeof options === "function" ? {} : options;
    const cb = typeof options === "function" ? options : callback;
    return this.spawn(command, [], {
      ...opts,
      shell: true,
      origin: opts.origin || "shell:exec",
    });
  }

  execSync(command, options = {}) {
    const spawnOpts = {
      ...options,
      shell: true,
      origin: options.origin || "shell:execSync",
    };
    const result = this.spawnSync(command, [], spawnOpts);
    if (result?.error) throw result.error;
    if (result?.status != null && result.status !== 0) {
      const error = new Error(
        `Command failed (exit ${result.status}): ${command}`,
      );
      error.status = result.status;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }
    return result?.stdout ?? "";
  }

  execFile(file, args, options, callback) {
    return this.spawn(file, args, options || {});
  }

  execFileSync(file, args, options = {}) {
    return this.spawnSync(file, args, options);
  }

  fork(modulePath, args, options = {}) {
    return this.spawn(process.execPath, [modulePath, ...(args || [])], {
      ...options,
      origin: options.origin || "fork",
    });
  }

  setPermission(origin, command, decision) {
    const key = command ? `${origin}:${command}` : `${origin}:default`;
    this._permissionState.set(key, decision);
  }

  getStats() {
    return { ...this._stats };
  }
  getAuditLog(limit = 100) {
    return this._auditLog.slice(-limit);
  }
  flushAuditLog() {
    const log = [...this._auditLog];
    this._auditLog = [];
    return log;
  }
}

const broker = new ProcessExecutionBroker();
export { broker as executionBroker };
export default broker;
