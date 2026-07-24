/**
 * Process Execution Broker — P0-1 生产化
 * 对应文档 §2.1 四层架构 Layer 1
 *
 * 统一拦截所有子进程执行：
 * - M1: 所有子进程唯一入口，权限检查
 * - **P0-1**: 可审计的平台执行计划（macOS Seatbelt / Linux prlimit；
 *   Windows 原生 Job Object 未实现时明确报告 unavailable）
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
    this._sandboxAdapter = {
      applySandbox: _applySandbox,
      postSpawnSandbox: _postSpawnSandbox,
    };

    this._ensureLogDir();
    this._loadPermissions();
  }

  _ensureLogDir() {
    try {
      fs.mkdirSync(path.dirname(this._logPath), { recursive: true });
    } catch {
      // Audit persistence is best-effort; in-memory audit remains available.
    }
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
    } catch {
      // Audit persistence is best-effort; the in-memory entry is retained.
    }
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

  _sandboxStrictEnabled() {
    return process.env.CC_SANDBOX_STRICT === "1";
  }

  _sandboxDisabledByEnvironment() {
    return process.env.CC_SANDBOX_DISABLE === "1";
  }

  _sandboxUnavailablePlan(command, args, options, reason) {
    return {
      contractVersion: 1,
      applied: false,
      platform: process.platform,
      profile: "default",
      command,
      args: [...(args || [])],
      options: { ...options },
      enforcement: null,
      reason,
      postSpawn: { required: false, mode: "none" },
    };
  }

  _sandboxError(reason, message = reason) {
    const error = new Error(message);
    error.code = "ERR_PROCESS_SANDBOX";
    error.sandboxReason = reason;
    return error;
  }

  _validateSandboxPlan(plan) {
    if (!plan || typeof plan !== "object") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox adapter returned no spawn plan",
      );
    }
    if (plan.contractVersion !== 1) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan contractVersion must be 1",
      );
    }
    if (typeof plan.applied !== "boolean") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan is missing applied:boolean",
      );
    }
    if (typeof plan.command !== "string" || !Array.isArray(plan.args)) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan must provide command and args",
      );
    }
    if (!plan.options || typeof plan.options !== "object") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan must provide options",
      );
    }
    if (plan.applied && typeof plan.enforcement !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Applied sandbox spawn plan must name its enforcement",
      );
    }
    if (!plan.applied && typeof plan.reason !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Unavailable sandbox spawn plan must provide a reason",
      );
    }
    const postSpawn = plan.postSpawn || { required: false, mode: "none" };
    if (
      postSpawn.required &&
      postSpawn.mode !== "sync" &&
      postSpawn.mode !== "async"
    ) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Required post-spawn enforcement must declare sync or async mode",
      );
    }
    return {
      ...plan,
      args: [...plan.args],
      options: { ...plan.options },
      postSpawn: { ...postSpawn },
    };
  }

  _prepareSandboxPlan(command, args, options, { sync = false } = {}) {
    const strict = this._sandboxStrictEnabled();
    let disabledReason = null;
    if (this._sandboxDisabledByEnvironment()) {
      disabledReason = "disabled_by_environment";
    } else if (
      this._sandboxEnabled === false ||
      this._platformSandboxEnabled === false
    ) {
      disabledReason = "disabled_by_broker";
    }

    if (disabledReason) {
      if (strict) {
        throw this._sandboxError(
          disabledReason,
          `Sandbox is unavailable in strict mode: ${disabledReason}`,
        );
      }
      return this._sandboxUnavailablePlan(
        command,
        args,
        options,
        disabledReason,
      );
    }

    const plan = this._validateSandboxPlan(
      this._sandboxAdapter.applySandbox(
        command,
        args || [],
        options,
        "default",
      ),
    );

    if (!plan.applied && strict) {
      throw this._sandboxError(
        plan.reason || "sandbox_unavailable",
        `Sandbox is unavailable in strict mode: ${
          plan.reason || "unknown reason"
        }`,
      );
    }

    if (plan.applied && plan.postSpawn.required) {
      if (typeof this._sandboxAdapter.postSpawnSandbox !== "function") {
        throw this._sandboxError(
          "post_spawn_adapter_unavailable",
          "Required post-spawn sandbox adapter is unavailable",
        );
      }
      if (sync) {
        throw this._sandboxError(
          "post_spawn_unavailable_for_sync",
          "spawnSync cannot satisfy required post-spawn sandbox enforcement",
        );
      }
      if (strict && plan.postSpawn.mode !== "sync") {
        throw this._sandboxError(
          "async_post_spawn_disallowed_in_strict_mode",
          "Strict sandbox mode requires synchronous post-spawn enforcement",
        );
      }
    }
    return plan;
  }

  _applySandboxAudit(auditEntry, plan, applied) {
    auditEntry.sandboxed = applied;
    auditEntry.sandboxProfile = plan?.profile || null;
    auditEntry.sandboxEnforcement = applied
      ? plan?.enforcement || "platform"
      : null;
    auditEntry.sandboxReason = applied ? null : plan?.reason || null;
    auditEntry.sandboxState = applied ? "ready" : "unavailable";
  }

  _recordSandboxDenial(auditEntry, error, startTime) {
    auditEntry.permissionDecision = "deny";
    auditEntry.sandboxed = false;
    auditEntry.sandboxState = "denied";
    auditEntry.sandboxReason =
      error.sandboxReason || "sandbox_initialization_failed";
    auditEntry.deniedReason = `sandbox-init-failed: ${error.message}`;
    auditEntry.endTime = Date.now();
    auditEntry.durationMs = auditEntry.endTime - startTime;
    this._recordAudit(auditEntry);
    this._writeRplEntry(auditEntry, "denied", error);
  }

  _scheduleSandboxCleanup(proc, cleanup) {
    if (typeof cleanup !== "function") return () => {};
    let cleaned = false;
    const run = () => {
      if (cleaned) return;
      cleaned = true;
      cleanup();
    };
    if (proc && typeof proc.once === "function") {
      proc.once("error", run);
      proc.once("exit", run);
    }
    return run;
  }

  _runPostSpawnSandbox(proc, plan, auditEntry) {
    if (!plan.applied || !plan.postSpawn.required) {
      this._applySandboxAudit(auditEntry, plan, plan.applied);
      if (plan.applied) this._stats.sandboxed++;
      const ready = Promise.resolve({ applied: plan.applied });
      proc.sandboxReady = ready;
      return;
    }

    let postSpawnResult;
    try {
      postSpawnResult = this._sandboxAdapter.postSpawnSandbox(proc, plan);
    } catch (error) {
      this._applySandboxAudit(auditEntry, plan, false);
      auditEntry.sandboxState = "failed";
      auditEntry.sandboxReason = `post_spawn_failed: ${error.message}`;
      if (this._sandboxStrictEnabled()) {
        if (typeof proc.once === "function") proc.once("error", () => {});
        try {
          proc.kill?.();
        } catch {
          // The sandbox failure remains fatal even if the child already exited.
        }
        throw this._sandboxError(
          "post_spawn_failed",
          `Post-spawn sandbox setup failed: ${error.message}`,
        );
      }
      process.emitWarning(
        `Post-spawn sandbox setup failed (continuing without): ${error.message}`,
      );
      proc.sandboxReady = Promise.resolve({ applied: false, error });
      return;
    }

    if (
      postSpawnResult &&
      typeof postSpawnResult.then === "function"
    ) {
      if (this._sandboxStrictEnabled()) {
        Promise.resolve(postSpawnResult).catch(() => {});
        if (typeof proc.once === "function") proc.once("error", () => {});
        try {
          proc.kill?.();
        } catch {
          // The sandbox failure remains fatal even if the child already exited.
        }
        throw this._sandboxError(
          "async_post_spawn_contract_violation",
          "Strict sandbox adapter returned an asynchronous post-spawn result",
        );
      }
      auditEntry.sandboxed = false;
      auditEntry.sandboxState = "pending";
      const ready = Promise.resolve(postSpawnResult).then(
        () => {
          this._applySandboxAudit(auditEntry, plan, true);
          this._stats.sandboxed++;
          return { applied: true };
        },
        (error) => {
          this._applySandboxAudit(auditEntry, plan, false);
          auditEntry.sandboxState = "failed";
          auditEntry.sandboxReason = `post_spawn_failed: ${error.message}`;
          process.emitWarning(
            `Post-spawn sandbox setup failed (continuing without): ${error.message}`,
          );
          throw error;
        },
      );
      // Keep failures observable to callers without creating an unhandled
      // rejection when a legacy caller does not inspect sandboxReady.
      ready.catch(() => {});
      proc.sandboxReady = ready;
      return;
    }

    this._applySandboxAudit(auditEntry, plan, true);
    this._stats.sandboxed++;
    proc.sandboxReady = Promise.resolve({ applied: true });
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
    } catch {
      // Provenance reporting must not hide the process execution result.
    }
  }

  _emitHooksEvent(event, data) {
    const hooks = getHooksV2();
    if (!hooks || !hooks.hooksV2) return;
    try {
      hooks.hooksV2.emit(event, data);
    } catch {
      // Hook reporting must not hide the process execution result.
    }
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
    let sandboxPlan;
    try {
      sandboxPlan = this._prepareSandboxPlan(command, args || [], spawnOpts);
    } catch (sandboxErr) {
      if (this._sandboxStrictEnabled()) {
        this._recordSandboxDenial(auditEntry, sandboxErr, startTime);
        sandboxErr.auditEntry = auditEntry;
        throw sandboxErr;
      }
      process.emitWarning(
        `Sandbox init failed (continuing without): ${sandboxErr.message}`,
      );
      sandboxPlan = this._sandboxUnavailablePlan(
        command,
        args || [],
        spawnOpts,
        `sandbox_init_failed: ${sandboxErr.message}`,
      );
    }
    command = sandboxPlan.command;
    args = [...sandboxPlan.args];
    const optsForSpawn = { ...sandboxPlan.options };
    this._applySandboxAudit(
      auditEntry,
      sandboxPlan,
      sandboxPlan.applied && !sandboxPlan.postSpawn.required,
    );

    // Use native spawn from _native (set by patch-child-process.js)
    const nativeSpawnFn = this._native?.spawn || nativeSpawn;
    let proc;
    try {
      proc = nativeSpawnFn(command, args, optsForSpawn);
    } catch (spawnError) {
      sandboxPlan.cleanup?.();
      throw spawnError;
    }
    auditEntry.pid = proc.pid;
    const cleanupSandbox = this._scheduleSandboxCleanup(
      proc,
      sandboxPlan.cleanup,
    );
    try {
      this._runPostSpawnSandbox(proc, sandboxPlan, auditEntry);
    } catch (postSpawnError) {
      cleanupSandbox();
      this._recordSandboxDenial(auditEntry, postSpawnError, startTime);
      postSpawnError.auditEntry = auditEntry;
      throw postSpawnError;
    }

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
      // EventEmitter treats an unhandled `error` event as an exception. A
      // process ENOENT must reach the child-process listener/callback instead
      // of crashing callers that did not subscribe to broker diagnostics.
      if (this.listenerCount("error") > 0) this.emit("error", auditEntry);
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
    let sandboxPlan;
    try {
      sandboxPlan = this._prepareSandboxPlan(
        command,
        args || [],
        spawnOpts,
        { sync: true },
      );
    } catch (sandboxErr) {
      if (this._sandboxStrictEnabled()) {
        this._recordSandboxDenial(auditEntry, sandboxErr, startTime);
        sandboxErr.auditEntry = auditEntry;
        throw sandboxErr;
      }
      process.emitWarning(
        `Sandbox init failed (sync, continuing without): ${sandboxErr.message}`,
      );
      sandboxPlan = this._sandboxUnavailablePlan(
        command,
        args || [],
        spawnOpts,
        `sandbox_init_failed: ${sandboxErr.message}`,
      );
    }
    command = sandboxPlan.command;
    args = [...sandboxPlan.args];
    const optsForSync = { ...sandboxPlan.options };
    this._applySandboxAudit(
      auditEntry,
      sandboxPlan,
      sandboxPlan.applied,
    );

    const nativeSpawnSyncFn = this._native?.spawnSync || nativeSpawnSync;
    try {
      const result = nativeSpawnSyncFn(command, args, optsForSync);
      if (sandboxPlan.applied) this._stats.sandboxed++;
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
    } finally {
      sandboxPlan.cleanup?.();
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
    if (typeof args === "function") {
      callback = args;
      args = [];
      options = {};
    } else if (!Array.isArray(args)) {
      callback = typeof options === "function" ? options : callback;
      options = args || {};
      args = [];
    } else if (typeof options === "function") {
      callback = options;
      options = {};
    }

    options = options || {};
    const proc = this.spawn(file, args, options);
    if (typeof callback !== "function") return proc;

    const stdoutChunks = [];
    const stderrChunks = [];
    const outputEncoding = options.encoding ?? "utf8";
    const returnBuffers =
      outputEncoding === "buffer" || outputEncoding === null;
    const configuredMaxBuffer = options.maxBuffer;
    const maxBuffer =
      configuredMaxBuffer === Infinity
        ? Infinity
        : Number.isFinite(configuredMaxBuffer) && configuredMaxBuffer >= 0
          ? configuredMaxBuffer
          : 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let completionError = null;
    let completed = false;

    const asBuffer = (chunk) =>
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const render = (chunks) => {
      const value = Buffer.concat(chunks);
      return returnBuffers ? value : value.toString(outputEncoding);
    };
    const finish = (error, code = null, signal = null) => {
      if (completed) return;
      completed = true;
      const stdout = render(stdoutChunks);
      const stderr = render(stderrChunks);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        if (error.status === undefined) error.status = code;
        if (error.signal === undefined) error.signal = signal;
      }
      callback(error, stdout, stderr);
    };
    const collect = (stream, chunks, streamName) => {
      if (!stream || typeof stream.on !== "function") return;
      stream.on("data", (chunk) => {
        const value = asBuffer(chunk);
        chunks.push(value);
        if (streamName === "stdout") stdoutBytes += value.length;
        else stderrBytes += value.length;
        const streamBytes = streamName === "stdout" ? stdoutBytes : stderrBytes;
        if (!completionError && streamBytes > maxBuffer) {
          completionError = new Error(`${streamName} maxBuffer exceeded`);
          completionError.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          completionError.stream = streamName;
          try {
            proc.kill(options.killSignal || "SIGTERM");
          } catch {
            // The maxBuffer error remains authoritative if the child exited.
          }
        }
      });
    };

    collect(proc.stdout, stdoutChunks, "stdout");
    collect(proc.stderr, stderrChunks, "stderr");
    proc.once("error", (error) => finish(error));
    proc.once("close", (code, signal) => {
      if (completionError) return finish(completionError, code, signal);
      if (code === 0) return finish(null, code, signal);
      const error = new Error(
        `Command failed (exit ${code ?? "unknown"}): ${file}`,
      );
      error.code = code;
      error.killed = Boolean(proc.killed);
      error.signal = signal;
      error.status = code;
      return finish(error, code, signal);
    });
    return proc;
  }

  execFileSync(file, args, options = {}) {
    if (!Array.isArray(args)) {
      options = args || {};
      args = [];
    }
    const result = this.spawnSync(file, args, options);
    if (result?.error) throw result.error;
    if (result?.status !== 0) {
      const error = new Error(
        `Command failed (exit ${result?.status ?? "unknown"}): ${file}`,
      );
      error.status = result?.status ?? null;
      error.signal = result?.signal ?? null;
      error.stdout = result?.stdout;
      error.stderr = result?.stderr;
      throw error;
    }
    return result?.stdout ?? "";
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
