/**
 * Hooks v2 System — M3-1: 完整18事件schema + 5种executor类型
 * 对应文档 §2.3
 *
 * 支持的18种生命周期事件:
 *   Session: PreToolUse, PostToolUse, Notification, Stop, SubagentStop
 *   Auth: PreCommit, PostCommit
 *   Skill: UserPromptSubmit, SessionStart, SessionEnd
 *   Model: PreCompact, ModelSelection
 *   Config: ConfigChange, PermissionAllow, PermissionDeny
 *   Timeline: TimelineEntry
 *   MCP: McpRequest, McpResponse
 *
 * 支持的executor类型:
 *   1. command (shell command, current hooks.json only supports this)
 *   2. http (webhook)
 *   3. prompt (inline prompt template)
 *   4. agent (dispatch to cc agent/skill)
 *   5. js (inline JS function via vm sandbox)
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import broker from "./process-execution-broker/index.js";
import { EventRuntimeStore } from "./event-runtime-store.js";
import { getDefaultEventRuntimeHost } from "./event-runtime-host.js";

const VALID_HOOK_EVENTS = new Set([
  "Setup",
  // Session
  "PreToolUse", "PostToolUse", "Notification", "Stop", "SubagentStart", "SubagentStop",
  "SessionResume", "SessionPause", "PostCompact", "StopFailure",
  // Auth
  "PreCommit", "PostCommit",
  // Skill
  "UserPromptSubmit", "UserPromptExpansion", "SessionStart", "SessionEnd",
  // Model
  "PreCompact", "ModelSelection",
  // Config
  "ConfigChange", "PermissionAllow", "PermissionDeny", "PermissionRequest", "PermissionDenied",
  // Timeline
  "TimelineEntry",
  // MCP
  "McpRequest", "McpResponse", "MCPElicitation", "Elicitation", "ElicitationResult",
  // Task / workspace lifecycle
  "TaskCreated", "TaskCompleted", "InstructionsLoaded", "CwdChanged",
  "WorktreeCreate", "WorktreeRemove", "TeammateIdle",
  // Tool aggregate / failure / filesystem lifecycle
  "PostToolUseFailure", "PostToolBatch", "FileChanged",
]);

const VALID_EXECUTOR_TYPES = new Set([
  "command",
  "http",
  "mcp_tool",
  "prompt",
  "agent",
  // Trusted programmatic compatibility executor. Config-loaded source text is
  // not executed in-process.
  "js",
]);

export const HOOK_EVENT_SCHEMA_VERSION = 1;
const DECISION_EVENTS = new Set([
  "Setup",
  "PreToolUse",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PermissionRequest",
  "ModelSelection",
  "PreCompact",
]);
const CONTEXT_EVENTS = new Set([
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "SessionStart",
  "PostCompact",
]);
const DEFAULT_ALLOWED_EXECUTORS = Object.freeze([
  "command",
  "http",
  "mcp_tool",
  "prompt",
  "agent",
  "js",
]);

export const HOOK_EVENT_CONTRACTS = Object.freeze(
  Object.fromEntries(
    [...VALID_HOOK_EVENTS].map((event) => [
      event,
      Object.freeze({
        schemaVersion: HOOK_EVENT_SCHEMA_VERSION,
        event,
        allowedExecutors: DEFAULT_ALLOWED_EXECUTORS,
        decisionCapable: DECISION_EVENTS.has(event),
        contextCapable: CONTEXT_EVENTS.has(event),
        blockingSemantics: DECISION_EVENTS.has(event)
          ? "strictest:block>ask>allow>continue"
          : "observe-only",
      }),
    ]),
  ),
);

const SAFE_ENV_KEYS = Object.freeze([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "HOME",
  "USERPROFILE",
]);
const DECISION_RANK = Object.freeze({
  continue: 0,
  allow: 1,
  ask: 2,
  block: 3,
});

function normalizeDecision(value) {
  const decision = String(value || "continue").toLowerCase();
  return Object.hasOwn(DECISION_RANK, decision) ? decision : "continue";
}

function strictestDecision(results) {
  let decision = "continue";
  for (const record of results) {
    const candidate = normalizeDecision(record?.decision);
    if (DECISION_RANK[candidate] > DECISION_RANK[decision]) {
      decision = candidate;
    }
  }
  return decision;
}

function hostnameMatches(hostname, pattern) {
  const host = String(hostname || "").toLowerCase();
  const rule = String(pattern || "").trim().toLowerCase();
  if (!host || !rule) return false;
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === rule;
}

function buildHookEnvironment(hook, policy) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  const managed = new Set(
    (policy.environmentAllowlist || []).map((key) => String(key)),
  );
  const requested = new Set(
    (hook.environmentAllowlist || hook.envAllowlist || []).map((key) =>
      String(key),
    ),
  );
  for (const key of requested) {
    if (!managed.has(key) || process.env[key] == null) continue;
    env[key] = process.env[key];
  }
  env.CC_HOOK_EVENT = hook.event;
  env.CC_HOOK_SCHEMA_VERSION = String(HOOK_EVENT_SCHEMA_VERSION);
  return env;
}

function hookBudget(hook) {
  return Object.freeze({
    maxTurns: Math.min(10, Math.max(1, Number(hook.maxTurns) || 1)),
    maxTokens: Math.min(
      32768,
      Math.max(1, Number(hook.maxTokens || hook.tokenBudget) || 4096),
    ),
    timeoutMs: Math.min(
      10 * 60 * 1000,
      Math.max(1, Number(hook.timeoutMs) || 30000),
    ),
  });
}

class HooksV2Runtime extends EventEmitter {
  constructor(configDir, options = {}) {
    super();
    this.configDir = configDir;
    this.durableStore = options.durableStore || null;
    this.durableOwner =
      options.durableOwner ||
      `hooks-inline:${process.pid}:${crypto.randomUUID()}`;
    this.durableRecoveryBufferMs = Math.max(
      1000,
      Number(options.durableRecoveryBufferMs) || 5000,
    );
    this.executionBroker = options.broker || broker;
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.executors = {
      ...(options.executors || {}),
      ...(options.mcpExecutor ? { mcp_tool: options.mcpExecutor } : {}),
      ...(options.promptExecutor ? { prompt: options.promptExecutor } : {}),
      ...(options.agentExecutor ? { agent: options.agentExecutor } : {}),
    };
    this.managedPolicy = {
      httpAllowlist: [],
      environmentAllowlist: [],
      ...(options.managedPolicy || {}),
    };
    this.hooks = new Map(); // eventName -> HookDefinition[]
    this.executionLog = [];
    this._loaded = false;
  }

  setDurableStore(store) {
    this.durableStore = store || null;
    return this.durableStore;
  }

  /**
   * @typedef {Object} HookDefinition
   * @property {string} id
   * @property {string} event
   * @property {'command'|'http'|'prompt'|'agent'|'js'} type
   * @property {string} [command] - for type=command
   * @property {string[]} [args]
   * @property {string} [url] - for type=http
   * @property {string} [method] - GET/POST
   * @property {Object} [headers]
   * @property {string} [template] - for type=prompt
   * @property {string} [agentName] - for type=agent
   * @property {string} [skillName] - for type=agent
   * @property {string} [code] - for type=js
   * @property {number} [timeoutMs]
   * @property {boolean} [blocking] - default false
   * @property {string[]} [if] - conditional matchers
   * @property {string} [description]
   */

  async loadHooks(hooksPath) {
    try {
      const content = await fs.readFile(hooksPath, "utf8");
      const config = JSON.parse(content);
      this.hooks.clear();

      const hookDefs = Array.isArray(config) ? config : (config.hooks || []);
      for (const def of hookDefs) {
        if (!VALID_HOOK_EVENTS.has(def.event)) {
          process.emitWarning(`[hooks-v2] Unknown event type: ${def.event}, skipping`);
          continue;
        }
        if (!VALID_EXECUTOR_TYPES.has(def.type)) {
          process.emitWarning(`[hooks-v2] Unknown executor type: ${def.type} for ${def.event}, skipping`);
          continue;
        }
        const id = def.id || crypto.randomUUID();
        if (!this.hooks.has(def.event)) this.hooks.set(def.event, []);
        this.hooks.get(def.event).push({ id, ...def });
      }
      this._loaded = true;
      this.emit("loaded", { count: hookDefs.length, events: Array.from(this.hooks.keys()) });
    } catch (e) {
      if (e.code !== "ENOENT") {
        this.emit("load:error", e);
      }
    }
  }

  /**
   * Register a hook programmatically
   */
  registerHook(def) {
    if (!VALID_HOOK_EVENTS.has(def.event)) throw new Error(`Invalid event: ${def.event}`);
    if (!VALID_EXECUTOR_TYPES.has(def.type)) throw new Error(`Invalid executor type: ${def.type}`);
    const contract = HOOK_EVENT_CONTRACTS[def.event];
    if (!contract.allowedExecutors.includes(def.type)) {
      throw new Error(
        `Executor ${def.type} is not allowed for event ${def.event}`,
      );
    }
    const id = def.id || crypto.randomUUID();
    const full = { id, blocking: false, timeoutMs: 30000, ...def };
    if (!this.hooks.has(def.event)) this.hooks.set(def.event, []);
    this.hooks.get(def.event).push(full);
    return id;
  }

  unregisterHook(id) {
    for (const [event, hooks] of this.hooks.entries()) {
      const idx = hooks.findIndex(h => h.id === id);
      if (idx >= 0) {
        hooks.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Fire an event - executes all registered hooks
   * @param {string} eventName
   * @param {Object} context - event context (tool_name, tool_input, session_id, etc.)
   * @returns {Promise<{results: Array, blocked: boolean, blockingResult?: any}>}
   */
  async emitEvent(eventName, context = {}, options = {}) {
    if (!VALID_HOOK_EVENTS.has(eventName)) {
      throw new Error(`Invalid hook event: ${eventName}`);
    }

    const hooks = this.hooks.get(eventName) || [];
    // Reserve the durable record for the inline producer before executing any
    // hook. A process-level EventRuntimeHost may observe the same store, but it
    // cannot reclaim this record until the longest declared hook timeout plus
    // a recovery buffer has elapsed. If this process dies, the expired lease
    // becomes claimable and the host replays the event exactly once.
    const longestHookTimeout = hooks.reduce(
      (max, hook) => Math.max(max, Number(hook?.timeoutMs) || 30000),
      0,
    );
    const durableRecord =
      this.durableStore && options.skipDurable !== true
      ? this.durableStore.enqueueInbox(
          {
            runtime_type: "hooks.v2",
            requiresHandler: true,
            event: eventName,
            context,
          },
          {
            id: context.event_id || context.eventId || null,
            claimOwner: this.durableOwner,
            leaseMs: longestHookTimeout + this.durableRecoveryBufferMs,
          },
        )
      : null;
    if (durableRecord?.duplicate) {
      if (durableRecord.status === "done" && durableRecord.result) {
        return { ...durableRecord.result, duplicate: true };
      }
      return {
        success: false,
        results: [],
        blocked: true,
        blockingResult: null,
        decision: "block",
        duplicate: true,
        pending: true,
      };
    }
    // Hooks are parallel by default. De-duplicate by id so a reload or layered
    // config cannot execute the same handler twice. `parallel:false` remains a
    // deterministic compatibility mode for callers that require ordering.
    const uniqueHooks = [];
    const seen = new Set();
    for (const hook of hooks) {
      if (seen.has(hook.id)) continue;
      seen.add(hook.id);
      uniqueHooks.push(hook);
    }
    const runOne = async (hook) => {
      const execId = crypto.randomUUID();
      const start = Date.now();
      const record = { execId, hookId: hook.id, event: eventName, type: hook.type, startedAt: new Date() };

      try {
        let result;
        switch (hook.type) {
          case "command":
            result = await this._execCommand(hook, context);
            break;
          case "http":
            result = await this._execHttp(hook, context);
            break;
          case "mcp_tool":
            result = await this._execMcpTool(hook, context);
            break;
          case "prompt":
            result = await this._execPrompt(hook, context);
            break;
          case "agent":
            result = await this._execAgent(hook, context);
            break;
          case "js":
            result = await this._execJs(hook, context);
            break;
        }

        record.durationMs = Date.now() - start;
        record.status = "success";
        record.result = result;
        record.decision = normalizeDecision(result?.decision);

        this.emit("hook:success", record);
      } catch (err) {
        record.durationMs = Date.now() - start;
        record.status = "error";
        record.error = err.message;
        record.decision =
          HOOK_EVENT_CONTRACTS[eventName].decisionCapable &&
          hook.failureMode !== "ignore"
            ? "block"
            : "continue";
        this.emit("hook:error", record);
      }

      this.executionLog.push(record);
      return record;
    };
    const results = options.parallel === false
      ? []
      : await Promise.all(uniqueHooks.map(runOne));
    if (options.parallel === false) {
      for (const hook of uniqueHooks) results.push(await runOne(hook));
    }
    const contract = HOOK_EVENT_CONTRACTS[eventName];
    const decision = contract.decisionCapable
      ? strictestDecision(results)
      : "continue";
    const blocking = results.filter((record) => record.decision === "block");
    const blocked = decision === "block";
    const blockingResult = blocking[0]?.result || null;
    const outcome = {
      success:
        !blocked && results.every((record) => record.status !== "error"),
      results,
      blocked,
      requiresApproval: decision === "ask",
      decision,
      blockingResult,
      schemaVersion: HOOK_EVENT_SCHEMA_VERSION,
    };
    if (durableRecord) {
      const settled = this.durableStore.acknowledgeInbox(
        durableRecord.id,
        outcome,
        {
          owner: durableRecord.lease?.owner,
          fence: durableRecord.lease?.fence,
        },
      );
      if (settled == null) {
        return {
          success: false,
          results,
          blocked: true,
          blockingResult: null,
          decision: "block",
          leaseLost: true,
        };
      }
      this.durableStore.enqueueOutbox(
        { event: eventName, outcome },
        { id: `${durableRecord.id}:result` },
      );
    }
    return outcome;
  }

  /** Compatibility/public name used by runtime parity and SDK callers. */
  async executeHooks(eventName, context = {}, options = {}) {
    return this.emitEvent(eventName, context, options);
  }

  async _execCommand(hook, context) {
    if (!hook.command || typeof hook.command !== "string") {
      throw new Error("command hook requires a command");
    }
    const budget = hookBudget(hook);
    const child = await this.executionBroker.spawn(
      hook.command,
      hook.args || [],
      {
        cwd: hook.cwd || this.configDir || process.cwd(),
        env: buildHookEnvironment(hook, this.managedPolicy),
        stdio: ["pipe", "pipe", "pipe"],
        timeout: budget.timeoutMs,
        shell: hook.shell === true,
        origin: "hook",
        scope: "hook",
        policy: "allow",
        hookName: hook.id,
      },
    );
    const payload = JSON.stringify({
      schema_version: HOOK_EVENT_SCHEMA_VERSION,
      hook_event_name: hook.event,
      context,
    });
    child.stdin?.end(payload);
    return new Promise((resolve, reject) => {
      let stdout = "", stderr = "";
      child.stdout?.on("data", d => stdout += d);
      child.stderr?.on("data", d => stderr += d);
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          let parsed = {};
          try { parsed = JSON.parse(stdout); } catch { parsed = { raw: stdout }; }
          resolve({ ...parsed, exitCode: code, stderr });
        } else {
          reject(new Error(`Hook command failed with exit ${code}: ${stderr}`));
        }
      });
    });
  }

  async _execHttp(hook, context) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("HTTP hook executor is unavailable");
    }
    const target = new URL(hook.url);
    const allowlist = this.managedPolicy.httpAllowlist || [];
    if (
      target.protocol !== "https:" ||
      !allowlist.some((pattern) => hostnameMatches(target.hostname, pattern))
    ) {
      const error = new Error(
        `HTTP hook target is outside the managed HTTPS allowlist: ${target.hostname}`,
      );
      error.code = "CC_HOOK_HTTP_TARGET_DENIED";
      throw error;
    }
    const method = hook.method || "POST";
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      hookBudget(hook).timeoutMs,
    );
    const headers = { "Content-Type": "application/json" };
    for (const [key, value] of Object.entries(hook.headers || {})) {
      if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) continue;
      headers[key] = String(value);
    }
    try {
      const res = await this.fetchImpl(target, {
        method,
        headers,
        body: method !== "GET" ? JSON.stringify({ event: hook.event, context }) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { status: res.status, body: await res.text().catch(() => "") };
    } finally {
      clearTimeout(timer);
    }
  }

  async _execPrompt(hook, context) {
    const vars = { ...context };
    let expanded = hook.template || "";
    expanded = expanded.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    const executor = this.executors.prompt;
    if (typeof executor !== "function") {
      throw new Error("prompt hook executor is not configured");
    }
    return executor({
      hook,
      prompt: expanded,
      context,
      budget: hookBudget(hook),
    });
  }

  async _execAgent(hook, context) {
    const executor = this.executors.agent;
    if (typeof executor !== "function") {
      throw new Error("agent hook executor is not configured");
    }
    return executor({
      hook,
      agentName: hook.agentName || null,
      skillName: hook.skillName || null,
      context,
      budget: hookBudget(hook),
    });
  }

  async _execMcpTool(hook, context) {
    const executor = this.executors.mcp_tool;
    if (typeof executor !== "function") {
      throw new Error("MCP hook executor is not configured");
    }
    if (!hook.server || !hook.tool) {
      throw new Error("mcp_tool hook requires server and tool");
    }
    return executor({
      server: hook.server,
      tool: hook.tool,
      arguments: hook.arguments || context,
      context,
      hook,
      budget: hookBudget(hook),
    });
  }

  async _execJs(hook, context) {
    if (typeof hook.handler === "function") return hook.handler(context);
    throw new Error(
      "Config-loaded JavaScript is disabled; register a trusted function handler",
    );
  }

  /** Get all registered hooks */
  getHookRegistry() {
    const registry = {};
    for (const [event, hooks] of this.hooks.entries()) {
      registry[event] = hooks.map(h => ({ id: h.id, type: h.type, description: h.description, blocking: h.blocking }));
    }
    return registry;
  }

  /** Get recent execution log */
  getExecutionLog(limit = 50) {
    return this.executionLog.slice(-limit);
  }
}

// Singleton instance
const defaultEventRuntimeHost =
  process.env.CC_EVENT_RUNTIME_DURABLE === "1"
    ? getDefaultEventRuntimeHost()
    : null;
const hooksRuntime = new HooksV2Runtime(undefined, {
  durableStore:
    defaultEventRuntimeHost?.store ||
    (process.env.CC_EVENT_RUNTIME_DURABLE === "1"
      ? new EventRuntimeStore()
      : null),
});
defaultEventRuntimeHost?.registerHandler(
  (event) =>
    hooksRuntime.executeHooks(event.event, event.context || {}, {
      skipDurable: true,
      recovered: true,
    }),
  { queue: "inbox", type: "hooks.v2" },
);
export default hooksRuntime;
export { HooksV2Runtime, VALID_HOOK_EVENTS, VALID_EXECUTOR_TYPES };
