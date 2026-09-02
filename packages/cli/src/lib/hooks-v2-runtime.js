/**
 * Hooks v2 System — 40-event schema + 5 public executor types
 * (plus trusted programmatic `js` compatibility handlers).
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
import hookEnvironment from "./hook-environment.cjs";
import hookShellCommand from "./hook-shell-command.cjs";
import permissionRules from "./permission-rules.cjs";
import { EventRuntimeStore } from "./event-runtime-store.js";
import { getDefaultEventRuntimeHost } from "./event-runtime-host.js";
import {
  currentHostHooksV2WorkspaceBinding,
  currentHostHooksV2WorkspaceRoot,
  registerHostHooksV2Workspace,
  resolveRegisteredHostHooksV2Workspace,
  runWithHostHooksV2Workspace,
} from "./hooks-v2-workspace-context.js";
import canonicalHookContract from "./hook-runtime-contract.js";
import { assessHookTrust, computeHookDefinitionDigest } from "./hook-trust.js";
import { getDefaultHookAuditStore } from "./hook-audit-store.js";

const { globToRegExp } = permissionRules;
const { buildManagedHookEnvironment } = hookEnvironment;
const {
  HOOK_EXECUTION_MODE,
  HOOK_PRIORITY,
  normalizeHookExecutionMode,
  normalizeHookPriority,
  normalizeHookTimeoutMs,
  validateHookEvent,
} = canonicalHookContract;
const {
  buildExplicitHookShellInvocation,
  issueTrustedHookSandboxContract,
  isPathInside,
  requireTrustedHookRoot,
  requiresExplicitHookShell,
  sandboxBoundaryError,
} = hookShellCommand;

const VALID_HOOK_EVENTS = new Set(
  Object.values(canonicalHookContract.HOOK_EVENT_TYPES),
);

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

export const HOOK_EVENT_SCHEMA_VERSION =
  canonicalHookContract.HOOK_EVENT_SCHEMA_VERSION;
export const HOOK_EVENT_CONTRACTS = canonicalHookContract.HOOK_EVENT_CONTRACTS;

const DECISION_RANK = Object.freeze({
  continue: 0,
  allow: 1,
  ask: 2,
  block: 3,
});

function normalizeDecision(value) {
  const decision = String(value || "continue").toLowerCase();
  if (["deny", "denied", "reject", "rejected"].includes(decision)) {
    return "block";
  }
  if (["approve", "approved", "accept"].includes(decision)) return "allow";
  if (["prompt", "confirm"].includes(decision)) return "ask";
  return Object.hasOwn(DECISION_RANK, decision) ? decision : "continue";
}

function decisionFromHookResult(result) {
  return normalizeDecision(
    result?.decision ||
      result?.permissionDecision ||
      result?.hookSpecificOutput?.permissionDecision ||
      result?.hookSpecificOutput?.decision,
  );
}

function normalizeHookDefinition(def, authority = null) {
  if (!def || typeof def !== "object") {
    throw new TypeError("Hook definition must be an object");
  }
  if (!VALID_HOOK_EVENTS.has(def.event)) {
    throw new Error(`Invalid event: ${def.event}`);
  }
  if (!VALID_EXECUTOR_TYPES.has(def.type)) {
    throw new Error(`Invalid executor type: ${def.type}`);
  }
  const contract = HOOK_EVENT_CONTRACTS[def.event];
  if (!contract.allowedExecutors.includes(def.type)) {
    throw new Error(
      `Executor ${def.type} is not allowed for event ${def.event}`,
    );
  }
  const normalized = {
    blocking: false,
    ...def,
    id: def.id || crypto.randomUUID(),
    priority: normalizeHookPriority(def.priority, HOOK_PRIORITY.NORMAL),
    timeoutMs: normalizeHookTimeoutMs(def.timeoutMs),
    executionMode: normalizeHookExecutionMode(def.executionMode ?? def.async),
    authority: def.authority ||
      authority || {
        kind: "programmatic",
        scope: "explicit",
        requiresConsent: false,
      },
  };
  normalized.definitionDigest =
    def.definitionDigest || computeHookDefinitionDigest(normalized);
  return normalized;
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
  const rule = String(pattern || "")
    .trim()
    .toLowerCase();
  if (!host || !rule) return false;
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === rule;
}

function managedListAllows(value, configured) {
  if (!Array.isArray(configured)) return true;
  const candidate = String(value || "");
  return configured.some((entry) => {
    const pattern = String(entry || "").trim();
    if (!pattern) return false;
    if (pattern === "*") return true;
    const expression = globToRegExp(
      process.platform === "win32" ? pattern.toLowerCase() : pattern,
    );
    return expression.test(
      process.platform === "win32" ? candidate.toLowerCase() : candidate,
    );
  });
}

function isInsideManagedRoot(candidate, roots) {
  if (!Array.isArray(roots)) return true;
  const resolved = path.resolve(candidate);
  return roots.some((root) => {
    const managedRoot = path.resolve(String(root));
    const relative = path.relative(managedRoot, resolved);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}

function managedPolicyError(message) {
  const error = new Error(message);
  error.code = "CC_HOOK_MANAGED_POLICY_DENIED";
  return error;
}

/**
 * Merge the administrator policy with a hook's own requested sandbox. Managed
 * settings may strengthen a hook but a hook cannot remove managed boundaries.
 * Boundary identifiers are intentionally left for ProcessExecutionBroker to
 * validate so every external-process caller gets the same stable contract.
 */
export function resolveHookSandboxPolicy(hook = {}, managedPolicy = {}) {
  const hookPolicy = hook.sandboxPolicy;
  const administratorPolicy = managedPolicy.sandboxPolicy;
  for (const [label, value] of [
    ["hook sandboxPolicy", hookPolicy],
    ["managed hook sandboxPolicy", administratorPolicy],
  ]) {
    if (
      value !== undefined &&
      (value === null || typeof value !== "object" || Array.isArray(value))
    ) {
      throw managedPolicyError(`${label} must be an object`);
    }
  }

  const requiredBoundaries = [];
  for (const [label, value] of [
    ["managed requiredBoundaries", managedPolicy.requiredBoundaries],
    [
      "managed sandboxPolicy.requiredBoundaries",
      administratorPolicy?.requiredBoundaries,
    ],
    ["hook requiredBoundaries", hook.requiredBoundaries],
    ["hook sandboxPolicy.requiredBoundaries", hookPolicy?.requiredBoundaries],
  ]) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw managedPolicyError(`${label} must be an array`);
    }
    for (const boundary of value) {
      if (!requiredBoundaries.includes(boundary)) {
        requiredBoundaries.push(boundary);
      }
    }
  }

  const configured =
    hookPolicy !== undefined ||
    administratorPolicy !== undefined ||
    hook.requiredBoundaries !== undefined ||
    managedPolicy.requiredBoundaries !== undefined;
  if (!configured) return null;
  const resolved = {
    ...(hookPolicy || {}),
    ...(administratorPolicy || {}),
  };
  delete resolved.requiredBoundaries;
  if (requiredBoundaries.length > 0) {
    resolved.requiredBoundaries = requiredBoundaries;
  }
  return resolved;
}

function hooksRequireWorkspaceBinding(hooks, managedPolicy) {
  return hooks.some((hook) => {
    if (hook.type !== "command") return false;
    try {
      return requiresExplicitHookShell(
        resolveHookSandboxPolicy(hook, managedPolicy),
      );
    } catch {
      // Invalid policy is fail-closed during execution and must remain so after
      // a crash instead of recovering without workspace authority.
      return true;
    }
  });
}

export function assertManagedHookPolicy(
  hook,
  context = {},
  policy = {},
  configDir = null,
  workspaceRoot = null,
) {
  // Retained for API compatibility and non-command policy growth, but never
  // consulted as filesystem authority.
  void context;
  if (!managedListAllows(hook.type, policy.allowedExecutors)) {
    throw managedPolicyError(
      `Hook executor is outside the managed allowlist: ${hook.type}`,
    );
  }

  if (hook.type === "command") {
    if (
      hook.shell === true &&
      policy.allowShell !== true &&
      hook.legacyAdapter !== true
    ) {
      throw managedPolicyError(
        "Shell-mode command hooks are disabled by managed policy",
      );
    }
    const executable = String(hook.command || "");
    const commandCandidates = new Set([executable, path.basename(executable)]);
    if (
      Array.isArray(policy.commandAllowlist) &&
      ![...commandCandidates].some((value) =>
        managedListAllows(value, policy.commandAllowlist),
      )
    ) {
      throw managedPolicyError(
        `Hook command is outside the managed allowlist: ${executable}`,
      );
    }
    // The event context is payload, not workspace authority. Keep this
    // selection identical to _execCommand so a forged context.cwd cannot make
    // the managed-root check approve a different directory than the one the
    // Broker will actually execute in.
    const cwd = hook.cwd || configDir || workspaceRoot || process.cwd();
    if (!isInsideManagedRoot(cwd, policy.workspaceRoots)) {
      throw managedPolicyError(
        `Hook working directory is outside managed workspace roots: ${cwd}`,
      );
    }
  }

  if (hook.type === "mcp_tool") {
    const target = `${hook.server || ""}/${hook.tool || ""}`;
    if (!managedListAllows(target, policy.mcpToolAllowlist)) {
      throw managedPolicyError(
        `MCP hook target is outside the managed allowlist: ${target}`,
      );
    }
  }

  if (
    hook.type === "agent" &&
    hook.agentName &&
    !managedListAllows(hook.agentName, policy.agentAllowlist)
  ) {
    throw managedPolicyError(
      `Hook agent is outside the managed allowlist: ${hook.agentName}`,
    );
  }
  if (
    hook.type === "agent" &&
    hook.skillName &&
    !managedListAllows(hook.skillName, policy.skillAllowlist)
  ) {
    throw managedPolicyError(
      `Hook skill is outside the managed allowlist: ${hook.skillName}`,
    );
  }
}

export function fileChangedHookMatches(hook, context = {}) {
  const configured =
    hook?.globs ?? hook?.paths ?? hook?.glob ?? hook?.if ?? null;
  if (configured == null) return true;
  const patterns = (Array.isArray(configured) ? configured : [configured])
    .map((value) =>
      String(value || "")
        .trim()
        .replace(/\\/g, "/"),
    )
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const rawPath = String(context.path || "").replace(/\\/g, "/");
  if (!rawPath) return false;
  const candidates = new Set([rawPath.replace(/^\.\//, "")]);
  if (path.isAbsolute(rawPath)) {
    const relative = path
      .relative(context.cwd || process.cwd(), rawPath)
      .replace(/\\/g, "/");
    if (relative && !relative.startsWith("../")) candidates.add(relative);
  }
  const caseInsensitive = process.platform === "win32";
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/^\.\//, "");
    const expression = globToRegExp(
      caseInsensitive ? normalizedPattern.toLowerCase() : normalizedPattern,
    );
    return [...candidates].some((candidate) =>
      expression.test(caseInsensitive ? candidate.toLowerCase() : candidate),
    );
  });
}

function buildHookEnvironment(hook, policy) {
  return buildManagedHookEnvironment({
    managedAllowlist: policy.environmentAllowlist,
    requestedAllowlist: hook.environmentAllowlist || hook.envAllowlist,
    values: {
      CC_HOOK_EVENT: hook.event,
      CC_HOOK_SCHEMA_VERSION: HOOK_EVENT_SCHEMA_VERSION,
    },
  });
}

function hookBudget(hook) {
  return Object.freeze({
    maxTurns: Math.min(10, Math.max(1, Number(hook.maxTurns) || 1)),
    maxTokens: Math.min(
      32768,
      Math.max(1, Number(hook.maxTokens || hook.tokenBudget) || 4096),
    ),
    timeoutMs: normalizeHookTimeoutMs(hook.timeoutMs),
  });
}

async function executeWithHookTimeout(label, budget, executor) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(
        `${label} hook exceeded its ${budget.timeoutMs}ms budget`,
      );
      error.code = "CC_HOOK_BUDGET_EXCEEDED";
      reject(error);
    }, budget.timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => executor(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class HooksV2Runtime extends EventEmitter {
  constructor(configDir, options = {}) {
    super();
    this.configDir = configDir;
    // Both values are host constructor inputs. Hook definitions may select a
    // cwd inside this root, but can never replace the writable root used to
    // issue a Linux one-shot execution contract.
    const configuredWorkspaceRoot = options.workspaceRoot || configDir || null;
    this.workspaceBinding =
      typeof configuredWorkspaceRoot === "string" &&
      path.isAbsolute(configuredWorkspaceRoot)
        ? registerHostHooksV2Workspace(configuredWorkspaceRoot)
        : null;
    this.workspaceRoot =
      this.workspaceBinding?.workspaceRoot || configuredWorkspaceRoot;
    this.durableStore = options.durableStore || null;
    const productionAuditRequired = process.env.NODE_ENV !== "test";
    this.auditStore =
      options.auditStore ||
      (productionAuditRequired ? getDefaultHookAuditStore() : null);
    this.requireAudit =
      productionAuditRequired || options.requireAudit === true;
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
    this.mcpAuthorizer =
      typeof options.mcpAuthorizer === "function"
        ? options.mcpAuthorizer
        : null;
    this.managedPolicy = {
      httpAllowlist: [],
      environmentAllowlist: [],
      allowShell: false,
      requireMcpAuthorization: true,
      ...(options.managedPolicy || {}),
    };
    this.hooks = new Map(); // eventName -> HookDefinition[]
    this.executionLog = [];
    this._loaded = false;
  }

  _appendAudit(record, { required = this.requireAudit } = {}) {
    if (!this.auditStore) {
      if (required) {
        const error = new Error("Canonical Hook audit store is unavailable");
        error.code = "CC_HOOK_AUDIT_UNAVAILABLE";
        throw error;
      }
      return null;
    }
    try {
      return this.auditStore.append(record);
    } catch (error) {
      this.emit("audit:error", error);
      if (required) throw error;
      return null;
    }
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
   * @property {{profile?:string, requiredBoundaries?:string[]}} [sandboxPolicy]
   * @property {string[]} [requiredBoundaries]
   */

  async loadHooks(hooksPath) {
    try {
      const content = await fs.readFile(hooksPath, "utf8");
      const config = JSON.parse(content);
      this.hooks.clear();
      const sourceFile = path.resolve(hooksPath);
      const sourceDigest = crypto
        .createHash("sha256")
        .update(content, "utf8")
        .digest("hex");

      const hookDefs = Array.isArray(config) ? config : config.hooks || [];
      for (const def of hookDefs) {
        if (!VALID_HOOK_EVENTS.has(def.event)) {
          process.emitWarning(
            `[hooks-v2] Unknown event type: ${def.event}, skipping`,
          );
          continue;
        }
        if (!VALID_EXECUTOR_TYPES.has(def.type)) {
          process.emitWarning(
            `[hooks-v2] Unknown executor type: ${def.type} for ${def.event}, skipping`,
          );
          continue;
        }
        const normalized = normalizeHookDefinition(
          { ...def, id: def.id || crypto.randomUUID() },
          {
            kind: "config",
            scope: "project",
            sourceFile,
            digest: sourceDigest,
            requiresConsent: true,
          },
        );
        if (!this.hooks.has(def.event)) this.hooks.set(def.event, []);
        this.hooks.get(def.event).push(normalized);
      }
      this._loaded = true;
      this.emit("loaded", {
        count: hookDefs.length,
        events: Array.from(this.hooks.keys()),
      });
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
    const full = normalizeHookDefinition(def);
    const id = full.id;
    if (!this.hooks.has(def.event)) this.hooks.set(def.event, []);
    this.hooks.get(def.event).push(full);
    return id;
  }

  unregisterHook(id) {
    for (const hooks of this.hooks.values()) {
      const idx = hooks.findIndex((h) => h.id === id);
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
    const contract = validateHookEvent(eventName, context);
    const eventId = context.event_id || context.eventId || crypto.randomUUID();
    const auditRequired = options.auditRequired === true || this.requireAudit;
    this._appendAudit(
      {
        phase: "dispatch",
        event: eventName,
        eventId,
        status: "accepted",
        decision: "continue",
      },
      { required: auditRequired && contract.decisionCapable },
    );
    const suppliedHooks = Array.isArray(options.additionalHooks)
      ? options.additionalHooks.map((hook) => normalizeHookDefinition(hook))
      : [];
    const hooks = [
      ...(this.hooks.get(eventName) || []),
      ...suppliedHooks,
    ].filter(
      (hook) =>
        eventName !== "FileChanged" || fileChangedHookMatches(hook, context),
    );
    // Reserve the durable record for the inline producer before executing any
    // hook. A process-level EventRuntimeHost may observe the same store, but it
    // cannot reclaim this record until the longest declared hook timeout plus
    // a recovery buffer has elapsed. If this process dies, the expired lease
    // becomes claimable and the host replays the event exactly once.
    const longestHookTimeout = hooks.reduce(
      (max, hook) => Math.max(max, Number(hook?.timeoutMs) || 30000),
      0,
    );
    const durableWorkspaceBinding =
      this.workspaceBinding || currentHostHooksV2WorkspaceBinding();
    const durableWorkspaceBindingRequired = hooksRequireWorkspaceBinding(
      hooks,
      this.managedPolicy,
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
              id: eventId,
              metadata: {
                hooksV2WorkspaceBindingId:
                  durableWorkspaceBinding?.bindingId || null,
                hooksV2WorkspaceBindingRequired:
                  durableWorkspaceBindingRequired,
              },
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
    uniqueHooks.sort(
      (left, right) =>
        normalizeHookPriority(left.priority) -
          normalizeHookPriority(right.priority) ||
        String(left.id).localeCompare(String(right.id)),
    );
    const runOne = async (
      hook,
      { forceObserveOnly = false, dispatcher = null } = {},
    ) => {
      const execId = crypto.randomUUID();
      const start = Date.now();
      const authorityRoot =
        this.workspaceRoot || currentHostHooksV2WorkspaceRoot();
      const trust = assessHookTrust(hook, { workspaceRoot: authorityRoot });
      const record = {
        execId,
        hookId: hook.id,
        sourceHookId: hook.databaseHookId || hook.id,
        hookName: hook.databaseHookName || hook.description || hook.id,
        event: eventName,
        type: hook.type,
        priority: normalizeHookPriority(hook.priority),
        executionMode: normalizeHookExecutionMode(hook.executionMode),
        definitionDigest: hook.definitionDigest,
        trustStatus: trust.status,
        startedAt: new Date(),
      };

      try {
        this._appendAudit(
          {
            phase: "hook-start",
            event: eventName,
            eventId,
            executionId: execId,
            hookId: hook.id,
            hookDigest: hook.definitionDigest,
            sourceKind: trust.authority.kind,
            sourceDigest: trust.authority.sourceDigest,
            trustStatus: trust.status,
            priority: record.priority,
            executionMode: record.executionMode,
            status: trust.trusted ? "running" : "untrusted",
            decision: "continue",
          },
          { required: auditRequired && contract.decisionCapable },
        );
        if (!trust.trusted) {
          const error = new Error(
            `Hook source requires explicit approval or reapproval: ${trust.status}`,
          );
          error.code = "CC_HOOK_REAPPROVAL_REQUIRED";
          throw error;
        }
        assertManagedHookPolicy(
          hook,
          context,
          this.managedPolicy,
          this.configDir,
          authorityRoot,
        );
        let result;
        if (typeof dispatcher === "function") {
          result = await dispatcher(hook, context);
        } else {
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
        }

        record.durationMs = Date.now() - start;
        record.status = "success";
        record.result = result;
        record.decision =
          forceObserveOnly || hook.observeOnly === true
            ? "continue"
            : decisionFromHookResult(result);

        this.emit("hook:success", record);
      } catch (err) {
        record.durationMs = Date.now() - start;
        record.status = "error";
        record.error = err.message;
        record.errorCode = err.code || null;
        record.nonBlockingError = hook.failureMode === "ignore";
        record.decision =
          contract.decisionCapable &&
          !forceObserveOnly &&
          hook.observeOnly !== true &&
          hook.failureMode !== "ignore"
            ? "block"
            : "continue";
        this.emit("hook:error", record);
      }

      try {
        this._appendAudit(
          {
            phase: "hook-result",
            event: eventName,
            eventId,
            executionId: execId,
            hookId: hook.id,
            hookDigest: hook.definitionDigest,
            sourceKind: trust.authority.kind,
            sourceDigest: trust.authority.sourceDigest,
            trustStatus: trust.status,
            priority: record.priority,
            executionMode: record.executionMode,
            status: record.status,
            decision: record.decision,
            durationMs: record.durationMs,
            errorCode: record.errorCode,
          },
          { required: auditRequired && contract.decisionCapable },
        );
      } catch (error) {
        record.status = "error";
        record.error = error.message;
        record.errorCode = error.code || "CC_HOOK_AUDIT_UNAVAILABLE";
        if (contract.decisionCapable && !forceObserveOnly) {
          record.decision = "block";
        }
      }
      this.executionLog.push(record);
      if (typeof hook.recordResult === "function") {
        try {
          hook.recordResult(record);
        } catch (error) {
          record.statsError = error?.message || String(error);
        }
      }
      return record;
    };
    const blockingHooks = uniqueHooks.filter(
      (hook) =>
        normalizeHookExecutionMode(hook.executionMode) !==
        HOOK_EXECUTION_MODE.ASYNC,
    );
    const asyncHooks = uniqueHooks.filter(
      (hook) =>
        normalizeHookExecutionMode(hook.executionMode) ===
        HOOK_EXECUTION_MODE.ASYNC,
    );
    const results = [];
    if (options.parallel === false) {
      for (const hook of blockingHooks) results.push(await runOne(hook));
    } else {
      for (let index = 0; index < blockingHooks.length;) {
        const priority = normalizeHookPriority(blockingHooks[index].priority);
        const group = [];
        while (
          index < blockingHooks.length &&
          normalizeHookPriority(blockingHooks[index].priority) === priority
        ) {
          group.push(blockingHooks[index]);
          index += 1;
        }
        results.push(...(await Promise.all(group.map((hook) => runOne(hook)))));
      }
    }
    for (const hook of asyncHooks) {
      if (
        options.skipAsyncWithoutDispatcher === true &&
        typeof options.asyncDispatcher !== "function"
      ) {
        results.push({
          execId: crypto.randomUUID(),
          hookId: hook.id,
          sourceHookId: hook.databaseHookId || hook.id,
          hookName: hook.databaseHookName || hook.description || hook.id,
          event: eventName,
          type: hook.type,
          priority: normalizeHookPriority(hook.priority),
          executionMode: HOOK_EXECUTION_MODE.ASYNC,
          status: "skipped",
          decision: "continue",
          deferred: false,
          skipReason: "async_dispatcher_unavailable",
        });
        continue;
      }
      const queued = {
        execId: crypto.randomUUID(),
        hookId: hook.id,
        sourceHookId: hook.databaseHookId || hook.id,
        hookName: hook.databaseHookName || hook.description || hook.id,
        event: eventName,
        type: hook.type,
        priority: normalizeHookPriority(hook.priority),
        executionMode: HOOK_EXECUTION_MODE.ASYNC,
        status: "queued",
        decision: "continue",
        deferred: true,
      };
      results.push(queued);
      void runOne(hook, {
        forceObserveOnly: true,
        dispatcher:
          typeof options.asyncDispatcher === "function"
            ? options.asyncDispatcher
            : null,
      }).then((record) => {
        this.emit("hook:async-settled", record);
      });
    }
    const decision = contract.decisionCapable
      ? strictestDecision(results)
      : "continue";
    const blocking = results.filter((record) => record.decision === "block");
    const blocked = decision === "block";
    const blockingResult = blocking[0]
      ? blocking[0].result || {
          reason: blocking[0].error || null,
          code: blocking[0].errorCode || null,
        }
      : null;
    const outcome = {
      success: !blocked && results.every((record) => record.status !== "error"),
      results,
      blocked,
      requiresApproval: decision === "ask",
      decision,
      blockingResult,
      schemaVersion: HOOK_EVENT_SCHEMA_VERSION,
    };
    try {
      this._appendAudit(
        {
          phase: "outcome",
          event: eventName,
          eventId,
          status: outcome.success ? "success" : "error",
          decision,
        },
        { required: auditRequired && contract.decisionCapable },
      );
    } catch (error) {
      outcome.success = false;
      outcome.blocked = contract.decisionCapable;
      outcome.decision = contract.decisionCapable ? "block" : "continue";
      outcome.auditError = error.code || "CC_HOOK_AUDIT_UNAVAILABLE";
      outcome.blockingResult = contract.decisionCapable
        ? { reason: error.message, code: outcome.auditError }
        : outcome.blockingResult;
    }
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
    const sandboxPolicy = resolveHookSandboxPolicy(hook, this.managedPolicy);
    const requiresContract = requiresExplicitHookShell(sandboxPolicy);
    const trustedRootSource =
      this.workspaceRoot || currentHostHooksV2WorkspaceRoot();
    const trustedRoot = requiresContract
      ? requireTrustedHookRoot(
          trustedRootSource,
          "Hooks v2 trusted workspace root",
        )
      : null;
    const commandCwd =
      hook.cwd || this.configDir || trustedRoot || process.cwd();
    if (requiresContract) {
      requireTrustedHookRoot(commandCwd, "Hooks v2 hook working directory");
      if (!isPathInside(trustedRoot, commandCwd)) {
        throw sandboxBoundaryError(
          "Hooks v2 hook working directory escapes the trusted workspace root",
        );
      }
    }
    const invocation =
      requiresContract && hook.shell === true
        ? buildExplicitHookShellInvocation(hook.command, {
            args: hook.args || [],
          })
        : {
            file: hook.command,
            argv: hook.args || [],
          };
    const commandOptions = {
      cwd: commandCwd,
      env: buildHookEnvironment(hook, this.managedPolicy),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: budget.timeoutMs,
      shell: requiresContract ? false : hook.shell === true,
      origin: "hook",
      scope: "hook",
      policy: "allow",
      hookName: hook.id,
      ...(sandboxPolicy ? { sandboxPolicy } : {}),
    };
    const sandboxExecutionContract = requiresContract
      ? issueTrustedHookSandboxContract({
          issuer:
            this.executionBroker.issueLinuxWorkspaceSandboxExecutionContract,
          receiver: this.executionBroker,
          file: invocation.file,
          args: invocation.argv,
          options: commandOptions,
          trustedRoot,
          label: "trusted Hooks v2 sandbox contract issuance failed",
        })
      : null;
    if (
      process.platform === "linux" &&
      requiresContract &&
      !sandboxExecutionContract
    ) {
      throw sandboxBoundaryError(
        "trusted Linux Hooks v2 sandbox contract could not be issued",
      );
    }
    const payload = JSON.stringify(
      hook.legacyPayload === true
        ? {
            ...context,
            schema_version: HOOK_EVENT_SCHEMA_VERSION,
            hook_event_name: hook.event,
          }
        : {
            schema_version: HOOK_EVENT_SCHEMA_VERSION,
            hook_event_name: hook.event,
            context,
          },
    );
    return executeWithHookTimeout("command", budget, async (signal) => {
      // `spawn()` returns a ChildProcess synchronously. Do not await it: an
      // immediately failing command can emit `error`/`exit` in the microtask
      // gap before listeners are attached, leaving the hook pending until its
      // full timeout budget expires.
      const child = this.executionBroker.spawn(
        invocation.file,
        invocation.argv,
        {
          ...commandOptions,
          ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
        },
      );
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const appendBounded = (current, chunk) =>
          `${current}${String(chunk)}`.slice(-(1024 * 1024));
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          callback(value);
        };
        const onStdinError = (error) => {
          // Fast hooks such as `echo` can exit before Node flushes the JSON
          // payload. The resulting EPIPE belongs to the stdin stream (not the
          // ChildProcess), so without a listener it becomes an uncaught process
          // exception even though the hook has a valid exit status. Keep the
          // listener attached for any late write completion; the exit event
          // remains authoritative for an already-closed stdin pipe.
          if (
            error?.code === "EPIPE" ||
            error?.code === "ERR_STREAM_DESTROYED"
          ) {
            return;
          }
          settle(reject, error);
        };
        const onAbort = () => {
          try {
            child.kill?.();
          } catch {
            // The timeout decision is already fail-closed.
          }
          const error = new Error(
            `command hook exceeded its ${budget.timeoutMs}ms budget`,
          );
          error.code = "CC_HOOK_BUDGET_EXCEEDED";
          settle(reject, error);
        };
        child.stdout?.on(
          "data",
          (chunk) => (stdout = appendBounded(stdout, chunk)),
        );
        child.stderr?.on(
          "data",
          (chunk) => (stderr = appendBounded(stderr, chunk)),
        );
        child.stdin?.on?.("error", onStdinError);
        child.on("error", (error) => settle(reject, error));
        // `exit` can fire before stdout/stderr have drained (observed with
        // fast command hooks on macOS). `close` is the child-process event
        // that guarantees the stdio streams are closed, so parse output only
        // after it arrives.
        child.on("close", (code) => {
          if (code === 0 || code === 2) {
            let parsed = {};
            try {
              parsed = JSON.parse(stdout);
              if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
              ) {
                parsed = { raw: stdout };
              }
            } catch {
              parsed = { raw: stdout };
            }
            if (code === 2 && decisionFromHookResult(parsed) === "continue") {
              parsed.decision = "block";
              parsed.reason =
                parsed.reason || stderr || stdout || "Hook blocked";
            }
            settle(resolve, { ...parsed, exitCode: code, stderr });
          } else {
            settle(
              reject,
              new Error(`Hook command failed with exit ${code}: ${stderr}`),
            );
          }
        });
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        try {
          child.stdin?.end(payload);
        } catch (error) {
          onStdinError(error);
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
        body:
          method !== "GET"
            ? JSON.stringify({ event: hook.event, context })
            : undefined,
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
    const budget = hookBudget(hook);
    const sandboxPolicy = resolveHookSandboxPolicy(hook, this.managedPolicy);
    return executeWithHookTimeout("prompt", budget, (signal) =>
      executor({
        hook,
        prompt: expanded,
        context,
        budget,
        signal,
        managedPolicy: this.managedPolicy,
        ...(sandboxPolicy ? { sandboxPolicy } : {}),
      }),
    );
  }

  async _execAgent(hook, context) {
    const executor = this.executors.agent;
    if (typeof executor !== "function") {
      throw new Error("agent hook executor is not configured");
    }
    const budget = hookBudget(hook);
    const sandboxPolicy = resolveHookSandboxPolicy(hook, this.managedPolicy);
    return executeWithHookTimeout("agent", budget, (signal) =>
      executor({
        hook,
        agentName: hook.agentName || null,
        skillName: hook.skillName || null,
        context,
        budget,
        signal,
        managedPolicy: this.managedPolicy,
        ...(sandboxPolicy ? { sandboxPolicy } : {}),
      }),
    );
  }

  async _execMcpTool(hook, context) {
    const executor = this.executors.mcp_tool;
    if (typeof executor !== "function") {
      throw new Error("MCP hook executor is not configured");
    }
    if (!hook.server || !hook.tool) {
      throw new Error("mcp_tool hook requires server and tool");
    }
    let permission = null;
    if (this.managedPolicy.requireMcpAuthorization !== false) {
      if (!this.mcpAuthorizer) {
        throw managedPolicyError(
          "MCP hook requires the shared MCP permission authorizer",
        );
      }
      permission = await this.mcpAuthorizer({
        server: hook.server,
        tool: hook.tool,
        arguments: hook.arguments || context,
        context,
        hook,
      });
      const decision = String(permission?.decision || "").toLowerCase();
      if (
        permission !== true &&
        permission?.allowed !== true &&
        decision !== "allow" &&
        decision !== "approve"
      ) {
        throw managedPolicyError(
          `MCP hook permission denied: ${hook.server}/${hook.tool}`,
        );
      }
    }
    const budget = hookBudget(hook);
    const sandboxPolicy = resolveHookSandboxPolicy(hook, this.managedPolicy);
    return executeWithHookTimeout("mcp_tool", budget, (signal) =>
      executor({
        server: hook.server,
        tool: hook.tool,
        arguments: hook.arguments || context,
        context,
        hook,
        budget,
        signal,
        permission,
        managedPolicy: this.managedPolicy,
        ...(sandboxPolicy ? { sandboxPolicy } : {}),
      }),
    );
  }

  async _execJs(hook, context) {
    if (typeof hook.handler === "function") {
      const budget = hookBudget(hook);
      return executeWithHookTimeout("js", budget, (signal) =>
        hook.handler(context, { signal, budget }),
      );
    }
    throw new Error(
      "Config-loaded JavaScript is disabled; register a trusted function handler",
    );
  }

  /** Get all registered hooks */
  getHookRegistry() {
    const registry = {};
    for (const [event, hooks] of this.hooks.entries()) {
      registry[event] = hooks.map((h) => ({
        id: h.id,
        type: h.type,
        description: h.description,
        blocking: h.blocking,
      }));
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
const requireCanonicalAudit = process.env.NODE_ENV !== "test";
const hooksRuntime = new HooksV2Runtime(undefined, {
  durableStore:
    defaultEventRuntimeHost?.store ||
    (process.env.CC_EVENT_RUNTIME_DURABLE === "1"
      ? new EventRuntimeStore()
      : null),
  auditStore: requireCanonicalAudit ? getDefaultHookAuditStore() : null,
  requireAudit: requireCanonicalAudit,
});
broker._setHooksEventSink(hooksRuntime);

export async function executeRecoveredHooksV2Event(
  runtime,
  event,
  record = {},
) {
  const bindingId = record?.metadata?.hooksV2WorkspaceBindingId || null;
  const bindingRequired =
    record?.metadata?.hooksV2WorkspaceBindingRequired === true ||
    hooksRequireWorkspaceBinding(
      runtime?.hooks?.get?.(event?.event) || [],
      runtime?.managedPolicy || {},
    );
  if (!bindingId) {
    if (bindingRequired) {
      throw sandboxBoundaryError(
        "durable Hooks v2 recovery requires a trusted host workspace binding",
      );
    }
    return runtime.executeHooks(event.event, event.context || {}, {
      skipDurable: true,
      recovered: true,
    });
  }

  const binding = resolveRegisteredHostHooksV2Workspace(bindingId);
  if (!binding) {
    throw sandboxBoundaryError(
      "durable Hooks v2 workspace binding is not registered by this host",
    );
  }
  return runWithHostHooksV2Workspace(binding.workspaceRoot, () =>
    runtime.executeHooks(event.event, event.context || {}, {
      skipDurable: true,
      recovered: true,
    }),
  );
}

defaultEventRuntimeHost?.registerHandler(
  (event, record) => executeRecoveredHooksV2Event(hooksRuntime, event, record),
  { queue: "inbox", type: "hooks.v2" },
);
export default hooksRuntime;
export { HooksV2Runtime, VALID_HOOK_EVENTS, VALID_EXECUTOR_TYPES };
