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

const VALID_HOOK_EVENTS = new Set([
  // Session
  "PreToolUse", "PostToolUse", "Notification", "Stop", "SubagentStop",
  // Auth
  "PreCommit", "PostCommit",
  // Skill
  "UserPromptSubmit", "SessionStart", "SessionEnd",
  // Model
  "PreCompact", "ModelSelection",
  // Config
  "ConfigChange", "PermissionAllow", "PermissionDeny",
  // Timeline
  "TimelineEntry",
  // MCP
  "McpRequest", "McpResponse",
]);

const VALID_EXECUTOR_TYPES = new Set(["command", "http", "prompt", "agent", "js"]);

class HooksV2Runtime extends EventEmitter {
  constructor(configDir) {
    super();
    this.configDir = configDir;
    this.hooks = new Map(); // eventName -> HookDefinition[]
    this.executionLog = [];
    this._loaded = false;
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
  async emitEvent(eventName, context = {}) {
    if (!VALID_HOOK_EVENTS.has(eventName)) {
      throw new Error(`Invalid hook event: ${eventName}`);
    }

    const hooks = this.hooks.get(eventName) || [];
    const results = [];
    let blocked = false;
    let blockingResult = null;

    for (const hook of hooks) {
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
        results.push(record);

        // Check for blocking decision
        if (hook.blocking && result && result.decision === "block") {
          blocked = true;
          blockingResult = result;
          record.blocked = true;
        }

        this.emit("hook:success", record);
      } catch (err) {
        record.durationMs = Date.now() - start;
        record.status = "error";
        record.error = err.message;
        results.push(record);
        this.emit("hook:error", record);
      }

      this.executionLog.push(record);
    }

    return { results, blocked, blockingResult };
  }

  async _execCommand(hook, context) {
    const child = await broker.spawn(
      hook.command, hook.args || [],
      {
        env: { ...process.env, CC_HOOK_EVENT: hook.event, CC_HOOK_CONTEXT: JSON.stringify(context) },
        stdio: "pipe",
        timeout: hook.timeoutMs,
      },
      { origin: "hook", hookName: hook.id, timeout: hook.timeoutMs },
    );
    return new Promise((resolve, reject) => {
      let stdout = "", stderr = "";
      child.stdout.on("data", d => stdout += d);
      child.stderr.on("data", d => stderr += d);
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
    // Simple HTTP webhook executor
    const method = hook.method || "POST";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hook.timeoutMs || 30000);
    try {
      const res = await fetch(hook.url, {
        method,
        headers: { "Content-Type": "application/json", ...(hook.headers || {}) },
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
    // Prompt template execution - returns expanded prompt for agent prepend
    const vars = { ...context };
    let expanded = hook.template || "";
    expanded = expanded.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    return { decision: "augment", prompt: expanded };
  }

  async _execAgent(hook, context) {
    // Dispatch to agent/skill - stub for full integration
    return { decision: "delegate", agentName: hook.agentName, skillName: hook.skillName, context };
  }

  async _execJs(hook, context) {
    // In-process JS execution via vm (sandboxed) - stub for full vm2/isolated-vm integration
    return { decision: "noop", note: "JS executor stub - context received", contextKeys: Object.keys(context) };
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
const hooksRuntime = new HooksV2Runtime();
export default hooksRuntime;
export { HooksV2Runtime, VALID_HOOK_EVENTS, VALID_EXECUTOR_TYPES };
