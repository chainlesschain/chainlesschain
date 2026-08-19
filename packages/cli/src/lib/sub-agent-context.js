/**
 * Sub-Agent Context — isolated execution context for child agents.
 *
 * Provides message isolation, independent context engineering, tool whitelisting,
 * iteration limits, and result summarization. Sub-agents run in their own
 * context and only return a summary to the parent agent.
 *
 * @module sub-agent-context
 */

import crypto from "crypto";
import { CLIContextEngineering } from "./cli-context-engineering.js";
import { agentLoop, buildSystemPrompt, AGENT_TOOLS } from "./agent-core.js";
import { feature } from "./feature-flags.js";
import {
  createWorktree,
  removeWorktree,
  isolateTask,
  diffWorktree,
  mergeWorktree,
  worktreeLog,
} from "./worktree-isolator.js";
import { isGitRepo } from "./git-integration.js";
import { markRuntimeLedgerPersistenceError } from "./runtime-usage-ledger.js";
import { IterationBudget } from "./iteration-budget.js";
import {
  beginSessionBudgetUsage,
  markSessionBudgetUsageUnknown,
  recordSessionBudgetUsage,
  rejectSessionBudgetUsageUnknown,
} from "./session-budget-usage.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 8;
const SUMMARY_DIRECT_THRESHOLD = 500; // chars — below this, use result as-is
const SUMMARY_SECTION_PATTERN =
  /^##\s*(Summary|Result|Output|Conclusion|Answer)/im;
const TRUNCATE_LENGTH = 500;
const PROVIDER_CLIENT_REQUEST_ID_RE = /^ccwf_[a-f0-9]{64}$/;
const PROVIDER_CALL_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
const PROVIDER_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WORKFLOW_EFFECT_ID_RE = /^sha256:[a-f0-9]{64}$/;
const WORKFLOW_CHILD_EFFECT_PROTOCOL = "cc-workflow-child-effect/v1";
const WORKFLOW_TOOL_CALL_ID_RE = /^[\x21-\x7e]{1,512}$/;
const WORKFLOW_TOOL_NAME_RE = /^[A-Za-z0-9._:-]{1,256}$/;

function ownDataValue(value, property) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function runtimeUsageObserverFailure(error, code, message) {
  const failure =
    error && (typeof error === "object" || typeof error === "function")
      ? markRuntimeLedgerPersistenceError(error)
      : markRuntimeLedgerPersistenceError(new Error(message));
  try {
    if (!failure.code) failure.code = code;
  } catch {
    // A frozen error was already wrapped by markRuntimeLedgerPersistenceError.
  }
  return failure;
}

function assertSyncUsageObserver(observer, phase) {
  if (typeof observer === "function") return;
  const upper = phase.toUpperCase();
  throw runtimeUsageObserverFailure(
    null,
    `CC_USAGE_${upper}_OBSERVER_REQUIRED`,
    `Strict child usage telemetry requires a synchronous ${phase} observer`,
  );
}

function requireSyncUsageObserver(observer, event, phase) {
  const upper = phase.toUpperCase();
  assertSyncUsageObserver(observer, phase);
  let observation;
  try {
    observation = observer(event);
  } catch (error) {
    throw runtimeUsageObserverFailure(
      error,
      `CC_USAGE_${upper}_PERSISTENCE_FAILED`,
      `Child usage ${phase} persistence failed`,
    );
  }
  let isThenable = false;
  try {
    isThenable = Boolean(observation && typeof observation.then === "function");
  } catch (error) {
    throw runtimeUsageObserverFailure(
      error,
      `CC_USAGE_${upper}_OBSERVER_ASYNC`,
      `Child usage ${phase} observer must be synchronous`,
    );
  }
  if (isThenable) {
    void Promise.resolve(observation).catch(() => {});
    throw runtimeUsageObserverFailure(
      null,
      `CC_USAGE_${upper}_OBSERVER_ASYNC`,
      `Child usage ${phase} observer must be synchronous`,
    );
  }
}

function requireUsageCallId(event, phase) {
  if (typeof event?.callId === "string" && event.callId.trim()) {
    return event.callId;
  }
  const upper = phase.toUpperCase();
  throw runtimeUsageObserverFailure(
    null,
    `CC_USAGE_${upper}_CALL_ID_REQUIRED`,
    `Strict child usage ${phase} requires a real callId`,
  );
}

function requireToolCallId(event, phase) {
  const value = event?.tool_use_id ?? event?.callId ?? event?.id;
  if (typeof value === "string" && value.trim()) return value;
  const upper = phase.toUpperCase();
  throw runtimeUsageObserverFailure(
    null,
    `CC_TOOL_${upper}_CALL_ID_REQUIRED`,
    `Strict child tool ${phase} requires a real provider call id`,
  );
}

// ─── SubAgentContext ────────────────────────────────────────────────────────

export class SubAgentContext {
  /**
   * Factory method — creates an isolated sub-agent context.
   *
   * @param {object} options
   * @param {string} options.role - Sub-agent role (e.g. "code-review", "summarizer")
   * @param {string} options.task - Task description for the sub-agent
   * @param {string} [options.parentId] - Parent context ID (null for root)
   * @param {string|null} [options.inheritedContext] - Condensed context from parent
   * @param {string[]} [options.allowedTools] - Tool whitelist (null = all tools)
   * @param {number} [options.maxIterations] - Iteration limit (fallback if no budget)
   * @param {import('./iteration-budget.js').IterationBudget} [options.iterationBudget] - Shared iteration budget (takes priority over maxIterations)
   * @param {import('./session-resource-budget.js').SessionResourceBudget} [options.sessionBudget] - Shared session-wide resource authority
   * @param {number} [options.tokenBudget] - Optional token budget
   * @param {object} [options.db] - Database instance (memory recall source)
   * @param {object} [options.permanentMemory] - Permanent memory instance
   * @param {boolean} [options.memoryEnabled=true] - When false, the child's
   *   context engine suppresses hierarchical-memory recall (contract memory:false)
   * @param {object} [options.llmOptions] - LLM provider/model/key options
   * @param {string} [options.workflowEffectId] - Durable workflow effect bound
   *   to provider request identities for this child run
   * @param {string} [options.cwd] - Working directory
   * @param {boolean} [options.useWorktree] - Force worktree isolation (overrides flag)
   * @param {function} [options.onUsageBoundary] - Synchronous observer for
   *   real child model-usage-started events. A failure is terminal so provider
   *   work cannot begin without a durable parent boundary.
   * @param {function} [options.onUsageSettlement] - Synchronous observer for
   *   real child token-usage/model-usage-unknown settlements.
   * @param {function} [options.onProviderReceipt] - Synchronous observer for
   *   a provider-returned receipt before the matching usage settlement.
   * @param {function} [options.onToolCallBoundary] - Synchronous observer for
   *   real child tool-executing boundaries.
   * @param {function} [options.onToolCallSettlement] - Synchronous observer for
   *   matching child tool-result settlements.
   * @returns {SubAgentContext}
   */
  static create(options = {}) {
    return new SubAgentContext(options);
  }

  constructor(options = {}) {
    this.id = `sub-${crypto.randomUUID().slice(0, 12)}`;
    this.parentId = options.parentId || null;
    this.role = options.role || "general";
    this.task = options.task || "";
    // Declarative profile (Phase 3) — explorer/executor/design, etc.
    // Provides systemPrompt + maxIterations + modelHint defaults that
    // explicit options can still override.
    this._profile = options.profile || null;
    this.maxIterations =
      options.maxIterations ||
      this._profile?.maxIterations ||
      DEFAULT_MAX_ITERATIONS;
    this.iterationBudget = options.iterationBudget || null; // shared budget from parent
    this.sessionBudget = options.sessionBudget || null;
    this.tokenBudget = options.tokenBudget || null;
    this.inheritedContext = options.inheritedContext || null;
    this.allowedTools = options.allowedTools ?? null; // null = all; [] = none
    this.depth = options.depth || 1; // nesting level (parent main loop = 0)
    // Shared run-wide TOTAL-sub-agent counter (one object across the whole tree)
    // so this sub-agent's own spawns draw from the same breadth pool.
    this.subAgentBudget = options.subAgentBudget || null;
    // This context's EFFECTIVE subagent contract — the ceiling handed to its OWN
    // nested spawns (threaded into the loop options so a nested spawn_sub_agent
    // reads it as ctx.subAgentContract).
    this.subAgentContract = options.subAgentContract || null;
    // Optional session-level Extension Tier admission policy. Keep it as an
    // explicit inherited capability so child loops cannot silently bypass the
    // parent's admission decision.
    this.toolAdmission = options.toolAdmission || null;
    // Skill capability INTERSECT: null = unrestricted; a list (possibly empty)
    // restricts run_skill/list_skills in this context's loop to those skills.
    this.skillAllowlist =
      options.skillAllowlist != null ? options.skillAllowlist : null;
    // Hook-envelope tracing: the spawning run's id — this child loop stamps it
    // as parent_id on every settings-hook payload it fires (its own runId
    // becomes the trace_id). null → top-level semantics (no parent).
    this._hookParentTraceId = options.hookParentTraceId || null;
    this.cwd = options.cwd || process.cwd();
    this.status = "active";
    this.result = null;
    this.createdAt = new Date().toISOString();
    this.completedAt = null;

    // Worktree isolation state
    this._useWorktree = options.useWorktree ?? feature("WORKTREE_ISOLATION");
    this._worktreePath = null;
    this._worktreeBranch = null;
    this._repoDir = this.cwd;
    // Optional worktree creation options (large-monorepo): { sparsePaths,
    // symlinkDirectories } — only materialize the needed packages and reuse
    // approved dep dirs. null → full checkout (byte-identical default).
    this._worktreeOptions = options.worktreeOptions || null;
    // Recovery lineage collected from the child agent-loop event stream.
    // These are provider/runtime identifiers, not reconstructed log labels.
    this._runId = null;
    this._checkpointIds = [];
    this._toolUseIds = [];
    this._workflowEffectId = options.workflowEffectId ?? null;
    this._providerRequestAttempts = [];
    this._providerRequestReceipts = [];
    this._nestedEffectAttempts = [];
    this._nestedEffectSettlements = [];

    // ── Isolated state ──────────────────────────────────────────────
    // Independent message history — never shared with parent
    this.messages = [];

    // Independent context engine — does not inherit parent's compaction/errors.
    // Memory recall is gated by the subagent contract: the spawn passes a `db`
    // and memoryEnabled:true only when the resolved contract grants memory
    // (context:fork from a memory-bearing parent, or explicit memory:true).
    // Default (silent-`fresh`→memory:false) → no db + memoryEnabled:false → no
    // recall, which is today's byte-identical behavior for a plain sub-agent.
    this._memoryEnabled = options.memoryEnabled !== false;
    this.contextEngine = new CLIContextEngineering({
      db: options.db || null,
      permanentMemory: options.permanentMemory || null,
      memoryEnabled: this._memoryEnabled,
      scope: {
        taskId: this.id,
        role: this.role,
        parentObjective: this.task,
      },
    });

    // Track tool usage and token consumption
    this._toolsUsed = [];
    this._tokenCount = 0;
    this._iterationCount = 0;

    // LLM options for chatWithTools
    this._llmOptions = options.llmOptions || {};

    // Optional progress callback for streaming events to consumers
    this._onProgress = options.onProgress || null;

    // Usage-attribution seam (用量归因): forwards the child loop's REAL
    // provider-reported token usage to the spawner (the ~4-chars/token
    // estimate kept in _tokenCount below is only a budget heuristic and never
    // leaves this context). Wired by spawn_sub_agent / isolated run_skill so
    // the parent loop can re-yield attributed `token-usage` events.
    this._onUsage =
      typeof options.onUsage === "function" ? options.onUsage : null;
    this._onUsageBoundary =
      typeof options.onUsageBoundary === "function"
        ? options.onUsageBoundary
        : null;
    this._onUsageSettlement =
      typeof options.onUsageSettlement === "function"
        ? options.onUsageSettlement
        : null;
    this._onProviderReceipt =
      typeof options.onProviderReceipt === "function"
        ? options.onProviderReceipt
        : null;
    this._onToolCallBoundary =
      typeof options.onToolCallBoundary === "function"
        ? options.onToolCallBoundary
        : null;
    this._onToolCallSettlement =
      typeof options.onToolCallSettlement === "function"
        ? options.onToolCallSettlement
        : null;
    this._strictUsageTelemetry = options.strictUsageTelemetry === true;

    // Optional EXTERNAL abort signal for cancellation (e.g. a parent-provided
    // AbortSignal). In addition, every context owns an INTERNAL controller so a
    // single sub-agent can be cancelled precisely by id via `abort()` (the
    // registry's `cancel(id)`), independent of any external signal.
    this._signal = options.signal || null;
    this._abortController = new AbortController();
    this._runAbortController = null;
    this._abortLinkCleanup = [];
    this._cancelReason = null;
    this._sessionBudgetLease = null;
    this._unregisterSessionAbortable = null;
    this._running = false;

    // Optional MCP / external tool plumbing. These are forwarded into the
    // agentLoop options so MCP-backed tools (e.g. from a cowork template's
    // `mcpServers`) appear in the LLM's tool list and route through
    // `mcpClient.callTool()` in agent-core's default-case dispatch.
    this._extraToolDefinitions = Array.isArray(options.extraToolDefinitions)
      ? options.extraToolDefinitions
      : [];
    this._externalToolDescriptors =
      options.externalToolDescriptors &&
      typeof options.externalToolDescriptors === "object"
        ? options.externalToolDescriptors
        : {};
    this._externalToolExecutors =
      options.externalToolExecutors &&
      typeof options.externalToolExecutors === "object"
        ? options.externalToolExecutors
        : {};
    this._mcpClient = options.mcpClient || null;
    this._mcpHostClient = options.mcpHostClient || this._mcpClient;
    this._mcpCallLedger = options.mcpCallLedger || null;
    this._mcpConflictScheduler = options.mcpConflictScheduler || null;
    this._mcpDispatchAdmission = options.mcpDispatchAdmission || null;

    // Inherited settings hooks (Pre/PostToolUse) for this child loop. null =
    // no hooks (the spawn default). The spawn path passes the parent's hooks
    // filtered by the contract's `hooks` allow-list; forwarded into agentLoop.
    this._settingsHooks = options.settingsHooks || null;

    // permissionMode confirmer for this child loop. null = no confirmer (the
    // spawn default → the child denies ask/sensitive-file/git gates). The spawn
    // sets this only for the autopilot (bypassPermissions) ALLOW confirmer.
    this._permissionConfirm = options.permissionConfirm || null;

    // permissionMode ApprovalGate for this child loop. null = ungated (the spawn
    // default). The spawn sets a dedicated confirmer-less gate (seeded with the
    // mode's tier) for the strict/trusted tiers so run_shell/browser_act are
    // gated headlessly (CONFIRM→no-confirmer→DENY).
    this._approvalGate = options.approvalGate || null;

    // Parent execution authority. These values are applied AFTER any internal
    // loop options so a child/worktree path can tighten but never replace the
    // parent's policy, Plan lock, workspace sandbox, or unattended boundary.
    this._parentAuthority = Object.freeze({
      permissionRules: options.permissionRules || null,
      permissionRulesProvider: options.permissionRulesProvider || null,
      hostManagedToolPolicy: options.hostManagedToolPolicy || null,
      planManager: options.planManager || null,
      sandbox: options.sandbox || null,
      additionalDirectories: Array.isArray(options.additionalDirectories)
        ? Object.freeze([...options.additionalDirectories])
        : null,
      shellPolicyOverrides: options.shellPolicyOverrides || null,
      classifyAllShell: options.classifyAllShell === true,
      unattendedActionPolicy: options.unattendedActionPolicy || null,
    });

    // Build isolated system prompt
    const basePrompt = buildSystemPrompt(this.cwd);
    const profilePrompt = this._profile?.systemPrompt
      ? `\n\n## Profile: ${this._profile.name}\n${this._profile.systemPrompt}`
      : "";
    const rolePrompt = `\n\n## Sub-Agent Role: ${this.role}\nYou are a focused sub-agent with the role "${this.role}". Your task is:\n${this.task}\n\nStay focused on this specific task. Be concise and return results directly.`;
    const contextSection = this.inheritedContext
      ? `\n\n## Parent Context\n${this.inheritedContext}`
      : "";

    this.messages.push({
      role: "system",
      content: basePrompt + profilePrompt + rolePrompt + contextSection,
    });
  }

  /**
   * Run the sub-agent loop with the given user prompt.
   * Collects events, enforces iteration limit, and returns a structured result.
   *
   * @param {string} userPrompt - The task prompt for this sub-agent
   * @param {object} [loopOptions] - Additional options for agentLoop
   * @returns {Promise<{ summary: string, artifacts: Array, tokenCount: number, toolsUsed: string[], iterationCount: number }>}
   */
  async run(userPrompt, loopOptions = {}) {
    if (this.status !== "active") {
      throw new Error(
        `SubAgentContext ${this.id} is not active (status: ${this.status})`,
      );
    }

    const admission = this._acquireSessionBudget();
    if (!admission.ok) {
      this.status = "failed";
      this.completedAt = new Date().toISOString();
      this.result = {
        summary: `Sub-agent blocked by session budget: ${admission.reason}`,
        artifacts: [],
        tokenCount: this._tokenCount,
        toolsUsed: [...new Set(this._toolsUsed)],
        iterationCount: this._iterationCount,
        budgetReason: admission.reason,
      };
      return this.result;
    }

    this._running = true;
    try {
      this._activateAbortLinks(loopOptions.signal || null);

      // If worktree isolation is enabled, wrap execution in isolated worktree.
      if (this._useWorktree) {
        if (isGitRepo(this._repoDir)) {
          return await this._runInWorktree(userPrompt, loopOptions);
        }
        // FAIL CLOSED: isolation was explicitly requested but this is not a git
        // repo. Never silently fall back to the parent checkout — refuse.
        this.status = "failed";
        this.completedAt = new Date().toISOString();
        this.result = {
          summary:
            "Worktree isolation was requested but the working directory is not a git repository — refusing to run in the parent checkout.",
          artifacts: [],
          tokenCount: this._tokenCount,
          toolsUsed: [...new Set(this._toolsUsed)],
          iterationCount: this._iterationCount,
          isolationError: true,
        };
        return this.result;
      }

      return await this._runCore(userPrompt, loopOptions);
    } finally {
      this._running = false;
      this._deactivateAbortLinks();
      this._releaseSessionBudget();
    }
  }

  _acquireSessionBudget() {
    if (!this.sessionBudget?.acquireWork) return { ok: true };
    const lease = this.sessionBudget.acquireWork({
      id: this.id,
      kind: "sub-agent",
      depth: this.depth,
    });
    if (!lease.ok) return lease;
    this._sessionBudgetLease = lease;
    try {
      this._unregisterSessionAbortable =
        this.sessionBudget.registerAbortable?.(
          `sub-agent:${this.id}`,
          (reason) =>
            this.abort(
              reason?.budgetReason || reason?.message || "session-budget",
            ),
        ) || null;
    } catch (error) {
      lease.release();
      this._sessionBudgetLease = null;
      throw error;
    }
    return lease;
  }

  _releaseSessionBudget() {
    try {
      this._unregisterSessionAbortable?.();
    } catch {
      // Session cancellation remains authoritative if observer cleanup fails.
    }
    this._unregisterSessionAbortable = null;
    try {
      this._sessionBudgetLease?.release?.();
    } catch {
      // A released/aborted budget lease is idempotent.
    }
    this._sessionBudgetLease = null;
  }

  _activateAbortLinks(extraSignal = null) {
    this._deactivateAbortLinks();
    this._runAbortController = new AbortController();
    const signals = [
      this._signal,
      this._abortController.signal,
      this.sessionBudget?.signal || null,
      extraSignal,
    ].filter(Boolean);
    for (const source of signals) {
      const propagate = () => {
        if (!this._cancelReason) {
          this._cancelReason =
            source.reason?.budgetReason ||
            source.reason?.message ||
            "cancelled";
        }
        if (!this._runAbortController.signal.aborted) {
          try {
            this._runAbortController.abort(source.reason);
          } catch {
            this._runAbortController.abort();
          }
        }
      };
      if (source.aborted) propagate();
      else {
        source.addEventListener?.("abort", propagate, { once: true });
        this._abortLinkCleanup.push(() =>
          source.removeEventListener?.("abort", propagate),
        );
      }
    }
  }

  _deactivateAbortLinks() {
    for (const cleanup of this._abortLinkCleanup.splice(0)) {
      try {
        cleanup();
      } catch {
        // Abort-listener removal is best-effort cleanup only.
      }
    }
    this._runAbortController = null;
  }

  /**
   * Run in an isolated git worktree. Creates worktree → runs → cleans up.
   */
  async _runInWorktree(userPrompt, loopOptions = {}) {
    const taskId = `${this.role}-${this.id.slice(4)}`;
    try {
      const { result, branch, worktreePath, hasChanges } = await isolateTask(
        this._repoDir,
        taskId,
        async (wtPath) => {
          this._worktreePath = wtPath;
          this._worktreeBranch = `agent/${taskId}`;
          // Override cwd to worktree for tool execution
          this.cwd = wtPath;
          return this._runCore(userPrompt, loopOptions);
        },
        this._worktreeOptions || {},
      );

      // Annotate result with worktree info + diff preview
      if (result) {
        let diffInfo = null;
        let commits = [];
        if (
          hasChanges ||
          worktreeLog(this._repoDir, `agent/${taskId}`).length > 0
        ) {
          try {
            diffInfo = diffWorktree(this._repoDir, `agent/${taskId}`);
            commits = worktreeLog(this._repoDir, `agent/${taskId}`);
          } catch (_e) {
            // Non-critical — diff preview is optional
          }
        }
        result.worktree = {
          branch,
          path: worktreePath,
          hasChanges,
          diff: diffInfo,
          commits,
          merge: (options = {}) =>
            mergeWorktree(this._repoDir, branch, options),
        };
      }
      return result;
    } catch (err) {
      if (err?.runtimeLedgerPersistence === true || this._workflowEffectId) {
        throw err;
      }
      // If worktree creation fails (e.g. not a git repo), fall back to direct
      this.status = "failed";
      this.completedAt = new Date().toISOString();
      this.result = {
        summary: `Worktree isolation failed: ${err.message}`,
        artifacts: [],
        tokenCount: this._tokenCount,
        toolsUsed: [...new Set(this._toolsUsed)],
        iterationCount: this._iterationCount,
      };
      return this.result;
    }
  }

  /**
   * Core agent loop execution (shared by direct and worktree paths).
   */
  async _runCore(userPrompt, loopOptions = {}) {
    // Add user message
    this.messages.push({ role: "user", content: userPrompt });

    const artifacts = [];
    let lastContent = "";

    // Merge LLM options — pass shared iteration budget if available
    const options = {
      ...this._llmOptions,
      // Tool allowlist (fixed 2026-07-11): the filtered list used to be
      // computed via _getFilteredTools() but never handed to agentLoop, so a
      // sub-agent's `tools`/frontmatter allowlist was silently ignored at the
      // LLM surface. agentLoop consumes NAMES via enabledToolNames.
      ...(Array.isArray(this.allowedTools)
        ? { enabledToolNames: this.allowedTools }
        : {}),
      contextEngine: this.contextEngine,
      cwd: this.cwd,
      // Nesting level: lets a nested spawn_sub_agent see — and cap — its depth.
      subAgentDepth: this.depth,
      // Shared total-sub-agent counter so a nested spawn_sub_agent draws from
      // (and is bounded by) the run's single breadth pool.
      subAgentBudget: this.subAgentBudget,
      sessionBudget: this.sessionBudget,
      // This context's effective contract = the ceiling for its nested spawns.
      subAgentContract: this.subAgentContract,
      toolAdmission: this.toolAdmission,
      // Skill allow-list restricting run_skill/list_skills in this loop.
      skillAllowlist: this.skillAllowlist,
      // Parent trace for hook envelopes (absent → key omitted, no parent_id).
      ...(this._hookParentTraceId
        ? { hookParentTraceId: this._hookParentTraceId }
        : {}),
      ...loopOptions,
    };
    // Re-apply tighten-only capability fields after loopOptions. In particular,
    // [] must survive as deny-all and cannot be replaced by a worktree/direct
    // runner override.
    if (Array.isArray(this.allowedTools)) {
      options.enabledToolNames = [...this.allowedTools];
      options.exactToolNames = true;
    }
    options.subAgentContract = this.subAgentContract;
    options.sessionBudget = this.sessionBudget;
    if (this._runAbortController) {
      options.signal = this._runAbortController.signal;
    }
    options.toolAdmission = this.toolAdmission;
    options.skillAllowlist = this.skillAllowlist;
    // A caller cannot replace the durable outer effect through loopOptions.
    // agentLoop validates the canonical sha256 form before any provider call.
    if (this._workflowEffectId) {
      options.workflowEffectId = this._workflowEffectId;
      options.onProviderRequestBoundary = (event) => {
        this._recordProviderRequestAttempt(event);
      };
    } else {
      delete options.workflowEffectId;
      delete options.onProviderRequestBoundary;
    }
    const authority = this._parentAuthority;
    if (authority.permissionRules) {
      options.permissionRules = authority.permissionRules;
    }
    if (authority.permissionRulesProvider) {
      options.permissionRulesProvider = authority.permissionRulesProvider;
    }
    if (authority.hostManagedToolPolicy) {
      options.hostManagedToolPolicy = authority.hostManagedToolPolicy;
    }
    if (authority.planManager) options.planManager = authority.planManager;
    if (authority.sandbox) options.sandbox = authority.sandbox;
    if (authority.additionalDirectories) {
      options.additionalDirectories = [...authority.additionalDirectories];
    }
    if (authority.shellPolicyOverrides) {
      options.shellPolicyOverrides = authority.shellPolicyOverrides;
    }
    if (authority.classifyAllShell) options.classifyAllShell = true;
    if (authority.unattendedActionPolicy) {
      options.unattendedActionPolicy = authority.unattendedActionPolicy;
    }
    // Let agentLoop enforce model-turn admission at its real provider boundary.
    // The former event-count guard could stop immediately after a yielded
    // model/tool `started` event and strand it without a settlement.
    options.iterationBudget =
      this.iterationBudget ||
      new IterationBudget({ limit: this.maxIterations, owner: this.id });
    const strictUsageTelemetry =
      this._strictUsageTelemetry || options.strictUsageTelemetry === true;
    const pendingUsageCalls = new Set();
    const pendingToolCalls = new Map();
    let observeUsageBoundary = null;
    let observeUsageSettlement = null;
    let observeProviderReceipt = null;
    let observeToolBoundary = null;
    let observeToolSettlement = null;
    const providerReceiptForSettlement = (event) => {
      for (
        let index = this._providerRequestReceipts.length - 1;
        index >= 0;
        index -= 1
      ) {
        const receipt = this._providerRequestReceipts[index];
        if (
          receipt.callId === event?.callId &&
          (!event?.provider || receipt.provider === event.provider)
        ) {
          return { ...receipt };
        }
      }
      return null;
    };
    if (strictUsageTelemetry) {
      // Presence is checked without invoking either observer. In particular,
      // do not manufacture a null "validation event" that a durable writer
      // could mistake for a real provider-call boundary.
      assertSyncUsageObserver(this._onUsageBoundary, "boundary");
      assertSyncUsageObserver(this._onUsageSettlement, "settlement");

      observeUsageBoundary = (event) => {
        const callId = requireUsageCallId(event, "boundary");
        if (pendingUsageCalls.has(callId)) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_USAGE_BOUNDARY_CALL_ID_DUPLICATE",
            `Duplicate child usage boundary callId: ${callId}`,
          );
        }
        requireSyncUsageObserver(this._onUsageBoundary, event, "boundary");
        pendingUsageCalls.add(callId);
      };
      observeUsageSettlement = (event) => {
        const callId = requireUsageCallId(event, "settlement");
        if (!pendingUsageCalls.has(callId)) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_USAGE_SETTLEMENT_BOUNDARY_MISSING",
            `Child usage settlement has no matching boundary: ${callId}`,
          );
        }
        requireSyncUsageObserver(this._onUsageSettlement, event, "settlement");
        pendingUsageCalls.delete(callId);
      };
      observeProviderReceipt = (event) => {
        const callId = requireUsageCallId(event, "receipt");
        if (!pendingUsageCalls.has(callId)) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_USAGE_RECEIPT_BOUNDARY_MISSING",
            `Child provider receipt has no matching boundary: ${callId}`,
          );
        }
        requireSyncUsageObserver(this._onProviderReceipt, event, "receipt");
      };

      // agentLoop yields model-usage-started before provider work. Its consumer
      // runs synchronously before requesting the next event, so a durable host
      // write failure prevents the child provider call from starting.
      // Automatic semantic compaction invokes this same wrapped boundary seam
      // directly, before its provider query, rather than yielding a start event.
      options.onUsageBoundary = observeUsageBoundary;
      options.onUsageSettlement = observeUsageSettlement;
      if (this._onProviderReceipt) {
        options.onProviderReceipt = observeProviderReceipt;
      }
      options.strictUsageTelemetry = true;

      observeToolBoundary = (event) => {
        const callId = requireToolCallId(event, "boundary");
        if (pendingToolCalls.has(callId)) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_TOOL_BOUNDARY_CALL_ID_DUPLICATE",
            `Duplicate child tool boundary callId: ${callId}`,
          );
        }
        requireSyncUsageObserver(
          this._onToolCallBoundary,
          event,
          "tool_boundary",
        );
        pendingToolCalls.set(callId, event.tool || null);
      };
      observeToolSettlement = (event) => {
        const callId = requireToolCallId(event, "settlement");
        if (!pendingToolCalls.has(callId)) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_TOOL_SETTLEMENT_BOUNDARY_MISSING",
            `Child tool settlement has no matching boundary: ${callId}`,
          );
        }
        const startedTool = pendingToolCalls.get(callId);
        if (startedTool && event.tool && startedTool !== event.tool) {
          throw runtimeUsageObserverFailure(
            null,
            "CC_TOOL_SETTLEMENT_IDENTITY_CHANGED",
            `Child tool settlement changed tool identity for ${callId}`,
          );
        }
        requireSyncUsageObserver(
          this._onToolCallSettlement,
          event,
          "tool_settlement",
        );
        pendingToolCalls.delete(callId);
      };
      options.onToolCallBoundary = observeToolBoundary;
      options.onToolCallSettlement = observeToolSettlement;
    }

    // Forward MCP / external tool plumbing into the agent loop
    if (this._extraToolDefinitions.length > 0) {
      options.extraToolDefinitions = [
        ...(options.extraToolDefinitions || []),
        ...this._extraToolDefinitions,
      ];
    }
    if (Object.keys(this._externalToolDescriptors).length > 0) {
      options.externalToolDescriptors = {
        ...(options.externalToolDescriptors || {}),
        ...this._externalToolDescriptors,
      };
    }
    if (Object.keys(this._externalToolExecutors).length > 0) {
      options.externalToolExecutors = {
        ...(options.externalToolExecutors || {}),
        ...this._externalToolExecutors,
      };
    }
    if (this._mcpClient) {
      options.mcpClient = this._mcpClient;
    }
    if (this._mcpHostClient) {
      options.mcpHostClient = this._mcpHostClient;
    }
    if (this._mcpCallLedger) {
      options.mcpCallLedger = this._mcpCallLedger;
    }
    if (this._mcpConflictScheduler) {
      options.mcpConflictScheduler = this._mcpConflictScheduler;
    }
    if (this._mcpDispatchAdmission) {
      options.mcpDispatchAdmission = this._mcpDispatchAdmission;
    }
    // Inherited Pre/PostToolUse hooks (spawn passes the parent's, filtered by
    // the contract's `hooks` allow-list). Only set when non-null so a plain
    // sub-agent keeps its no-hooks default.
    if (this._settingsHooks) {
      options.settingsHooks = this._settingsHooks;
    }
    // permissionMode confirmer (spawn sets it only for bypassPermissions). Only
    // forward when present so a plain sub-agent keeps its implicit-deny default.
    if (this._permissionConfirm) {
      options.permissionConfirm = this._permissionConfirm;
    }
    // permissionMode ApprovalGate (spawn sets it for strict/trusted tiers). Only
    // forward when present so a plain sub-agent stays ungated (byte-identical).
    if (this._approvalGate) {
      options.approvalGate = this._approvalGate;
    }

    try {
      // Use a separate messages array for the agent loop
      // The agentLoop will append to this.messages directly
      const gen = agentLoop(this.messages, options);

      for await (const event of gen) {
        this._iterationCount++;

        if (event.type === "run-started" && event.runId) {
          this._runId = String(event.runId);
        }
        if (event.type === "checkpoint" && event.id) {
          const checkpointId = String(event.id);
          if (!this._checkpointIds.includes(checkpointId)) {
            this._checkpointIds.push(checkpointId);
          }
        }
        if (event.type === "tool-executing" && event.tool_use_id) {
          this._recordNestedEffectAttempt(event);
          const toolUseId = String(event.tool_use_id);
          if (!this._toolUseIds.includes(toolUseId)) {
            this._toolUseIds.push(toolUseId);
          }
        }
        if (event.type === "provider-request-receipt") {
          const receipt = Object.freeze({
            protocol: event.protocol,
            provider: event.provider,
            workflowEffectId: event.workflowEffectId,
            callId: event.callId,
            callSequence: event.callSequence,
            source: event.source,
            clientRequestId: event.clientRequestId,
            requestId: event.requestId || null,
            responseId: event.responseId || null,
            requestIdentitySemantics: event.requestIdentitySemantics,
            independentlyReadable: event.independentlyReadable,
          });
          this._providerRequestReceipts.push(receipt);
          if (strictUsageTelemetry && this._onProviderReceipt) {
            observeProviderReceipt({
              type: "provider-request-receipt",
              ...receipt,
              workflowRequestSource: receipt.source,
              providerReceipt: { ...receipt },
            });
          }
        }

        if (event.type === "token-usage") {
          const forwardedUsage = {
            type: "token-usage",
            ...(event.callId ? { callId: event.callId } : {}),
            provider: event.provider || null,
            model: event.model || null,
            usage: event.usage || null,
            ...(event.source ? { source: event.source } : {}),
            providerReceipt: providerReceiptForSettlement(event),
            attribution: event.attribution || null,
            ...(event.boundaryNotified === true ||
            event.ledgerPersisted === true
              ? { boundaryNotified: true }
              : {}),
            ...(event.ledgerPersisted === true
              ? { ledgerPersisted: true }
              : {}),
          };
          if (strictUsageTelemetry && event.ledgerPersisted !== true) {
            forwardedUsage.boundaryNotified = true;
            observeUsageSettlement(forwardedUsage);
            forwardedUsage.ledgerPersisted = true;
          }
          // Close the durable provider-call row before any secondary budget
          // projection can fail. A budget writer error must never turn a paid
          // call into a permanently open `started` row.
          // Attributed usage was already charged by the nested child sharing
          // this same authority, so only direct usage is folded here.
          recordSessionBudgetUsage(
            this.sessionBudget,
            event,
            "sub-agent usage settlement",
          );
          if (this._onUsage) {
            // Forward real usage to the spawner. A nested child's event already
            // carries its own attribution frame — preserve it (deepest wins).
            if (strictUsageTelemetry) {
              requireSyncUsageObserver(
                this._onUsage,
                forwardedUsage,
                "forwarding",
              );
            } else {
              try {
                this._onUsage(forwardedUsage);
              } catch {
                // Legacy attribution forwarding remains best-effort.
              }
            }
          }
        }

        if (event.type === "model-usage-started") {
          if (event.providerRequestId) {
            this._recordProviderRequestAttempt(event);
          }
          if (strictUsageTelemetry) {
            if (
              event.boundaryNotified === true ||
              event.ledgerPersisted === true
            ) {
              pendingUsageCalls.add(requireUsageCallId(event, "boundary"));
            } else {
              observeUsageBoundary(event);
            }
          }
          beginSessionBudgetUsage(
            this.sessionBudget,
            event,
            "sub-agent provider call",
          );
        }

        if (event.type === "tool-executing" && strictUsageTelemetry) {
          observeToolBoundary(event);
        }

        if (
          event.type === "model-usage-unknown" ||
          event.type === "compaction-usage-unknown"
        ) {
          const forwardedUnknown = {
            type: "model-usage-unknown",
            callId: event.callId,
            provider: event.provider || null,
            model: event.model || null,
            source:
              event.source ||
              (event.type === "compaction-usage-unknown"
                ? "semantic-compaction"
                : "model"),
            code: event.code || "provider_transport_outcome_unknown",
            providerReceipt: providerReceiptForSettlement(event),
            attribution: event.attribution || null,
            ...(event.boundaryNotified === true ||
            event.ledgerPersisted === true
              ? { boundaryNotified: true }
              : {}),
            ...(event.ledgerPersisted === true
              ? { ledgerPersisted: true }
              : {}),
          };
          if (strictUsageTelemetry && event.ledgerPersisted !== true) {
            forwardedUnknown.boundaryNotified = true;
            observeUsageSettlement(forwardedUnknown);
            forwardedUnknown.ledgerPersisted = true;
          }
          const budgetUsageUnknown = markSessionBudgetUsageUnknown(
            this.sessionBudget,
            event,
          );
          if (this._onUsage) {
            if (strictUsageTelemetry) {
              requireSyncUsageObserver(
                this._onUsage,
                forwardedUnknown,
                "forwarding",
              );
            } else {
              try {
                this._onUsage(forwardedUnknown);
              } catch {
                // Legacy attribution forwarding remains best-effort.
              }
            }
          }
          if (budgetUsageUnknown) {
            rejectSessionBudgetUsageUnknown(
              event,
              "sub-agent provider call",
            );
          }
        }

        if (event.type === "tool-executing") {
          this._toolsUsed.push(event.tool);
        }

        if (event.type === "tool-result") {
          const nestedEffectSettlement =
            this._recordNestedEffectSettlement(event);
          if (strictUsageTelemetry && event.tool_use_id) {
            observeToolSettlement(event);
          }
          // A consumer may stop the async generator after this yielded result
          // because of cancellation or a local token budget. Fence the unknown
          // here, after the strict settlement observer closes its boundary, so
          // generator.return() cannot suppress the outer reconciliation signal.
          if (nestedEffectSettlement?.outcomeUnknown === true) {
            const error = new Error(
              `Workflow-bound nested tool ${nestedEffectSettlement.tool} has an unknown outcome and requires reconciliation`,
            );
            error.code = "CC_WORKFLOW_NESTED_TOOL_OUTCOME_UNKNOWN";
            error.workflowEffectOutcomeUnknown = true;
            error.workflowEffectId = nestedEffectSettlement.workflowEffectId;
            error.workflowChildEffectId =
              nestedEffectSettlement.childEffectId;
            throw error;
          }
          // Store large tool results as artifacts
          const resultStr = JSON.stringify(event.result);
          // Estimate token count from tool result (~4 chars per token)
          this._tokenCount += Math.ceil(resultStr.length / 4);
          if (resultStr.length > 2000) {
            artifacts.push({
              type: "tool-output",
              tool: event.tool,
              content: resultStr,
              truncated: resultStr.length > 10000,
            });
          }
        }

        if (event.type === "response-complete") {
          lastContent = event.content || "";
          // Estimate token count from response content (~4 chars per token)
          this._tokenCount += Math.ceil((lastContent.length || 0) / 4);
        }

        // Emit progress to consumer if callback provided
        if (this._onProgress) {
          try {
            this._onProgress({
              type: event.type,
              tool: event.tool || null,
              iterationCount: this._iterationCount,
              tokenCount: this._tokenCount,
            });
          } catch (_e) {
            // Never let progress callback failures break the agent loop
          }
        }

        // Check abort signal (external OR this context's own `abort()`)
        const providerOrToolBoundaryPending =
          event.type === "model-usage-started" ||
          event.type === "tool-executing";
        if (this.isAborted() && !providerOrToolBoundaryPending) {
          this.forceComplete(this._cancelReason || "cancelled", {
            partialContent: lastContent,
            artifacts,
          });
          break;
        }

        // Enforce token budget
        if (
          this.tokenBudget &&
          this._tokenCount >= this.tokenBudget &&
          !providerOrToolBoundaryPending
        ) {
          this.forceComplete("token-budget-exceeded", {
            partialContent: lastContent,
            artifacts,
          });
          break;
        }
      }
      if (
        strictUsageTelemetry &&
        (pendingUsageCalls.size > 0 || pendingToolCalls.size > 0)
      ) {
        throw runtimeUsageObserverFailure(
          null,
          "CC_CHILD_CALL_SETTLEMENT_INCOMPLETE",
          "Strict child execution ended with an unsettled provider or tool call",
        );
      }
      if (
        this._workflowEffectId &&
        this._nestedEffectAttempts.length !==
          this._nestedEffectSettlements.length
      ) {
        const error = new Error(
          "Workflow-bound child execution ended with an unsettled nested effect",
        );
        error.code = "CC_WORKFLOW_CHILD_EFFECT_SETTLEMENT_INCOMPLETE";
        error.workflowEffectOutcomeUnknown = true;
        throw error;
      }
    } catch (err) {
      if (err?.runtimeLedgerPersistence === true || this._workflowEffectId) {
        throw err;
      }
      if (this.isAborted()) {
        this.forceComplete(this._cancelReason || "cancelled", {
          partialContent: lastContent,
          artifacts,
        });
        return this.result;
      }
      this.status = "failed";
      this.completedAt = new Date().toISOString();
      // Return partial work to the parent instead of discarding it: the
      // summary is the only channel the parent model sees, so a mid-run API
      // error (rate limit, network drop) must not erase what was already
      // produced. Artifacts collected before the failure are kept as-is.
      const partial =
        lastContent && lastContent.length > 0
          ? `\n\nPartial output before failure:\n${this.summarize(lastContent)}`
          : "";
      this.result = {
        summary: `Sub-agent failed: ${err.message}${partial}`,
        artifacts,
        tokenCount: this._tokenCount,
        toolsUsed: [...new Set(this._toolsUsed)],
        iterationCount: this._iterationCount,
      };
      return this.result;
    }

    // If the loop already force-completed (abort signal or token budget),
    // preserve that result. The normal completion below would otherwise
    // overwrite the cancellation / budget marker with a plain summary of
    // whatever was streamed so far — the parent agent would then mistake a
    // truncated/cancelled run for a clean one.
    if (this.status !== "active") {
      return this.result;
    }
    if (this.isAborted()) {
      this.forceComplete(this._cancelReason || "cancelled", {
        partialContent: lastContent,
        artifacts,
      });
      return this.result;
    }

    // Summarize the result
    const summary = this.summarize(lastContent);

    this.status = "completed";
    this.completedAt = new Date().toISOString();
    this.result = {
      summary,
      artifacts,
      tokenCount: this._tokenCount,
      toolsUsed: [...new Set(this._toolsUsed)],
      iterationCount: this._iterationCount,
    };

    return this.result;
  }

  /**
   * Three-level summarization strategy.
   *
   * 1. Direct use — result ≤ 500 chars → return as-is
   * 2. Section extraction — if result contains ## Summary/Result → extract that section
   * 3. Truncate + artifact — take first 500 chars, store full output as artifact
   *
   * @param {string} content - Raw result content
   * @returns {string} Summarized content
   */
  summarize(content) {
    if (!content || content.length === 0) {
      return "(No output from sub-agent)";
    }

    // Strategy 1: Direct use for short content
    if (content.length <= SUMMARY_DIRECT_THRESHOLD) {
      return content;
    }

    // Strategy 2: Extract structured section
    const match = content.match(SUMMARY_SECTION_PATTERN);
    if (match) {
      const sectionStart = match.index;
      // Find end of section (next ## heading or end of string)
      const rest = content.slice(sectionStart + match[0].length);
      const nextHeading = rest.search(/^##\s/m);
      const section =
        nextHeading >= 0 ? rest.slice(0, nextHeading).trim() : rest.trim();
      if (section.length > 0 && section.length <= 1000) {
        return section;
      }
    }

    // Strategy 3: Truncate + note
    return (
      content.substring(0, TRUNCATE_LENGTH) +
      `\n...[truncated, full output: ${content.length} chars]`
    );
  }

  /**
   * Get filtered tools based on allowedTools whitelist.
   * @returns {Array} Filtered AGENT_TOOLS
   */
  _getFilteredTools() {
    if (this.allowedTools === null) {
      return AGENT_TOOLS;
    }
    return AGENT_TOOLS.filter((t) =>
      this.allowedTools.includes(t.function.name),
    );
  }

  /**
   * Force-complete this sub-agent (e.g. on timeout or parent cancellation).
   * @param {string} [reason] - Reason for force-completion
   * @param {{partialContent?: string, artifacts?: Array}} [partial] - Work
   *   produced before the cutoff; returned to the parent instead of being
   *   discarded (a truncated run should still hand over what it has).
   */
  forceComplete(reason = "forced", partial = {}) {
    if (this.status === "active") {
      this.status = "completed";
      this.completedAt = new Date().toISOString();
      if (!this.result) {
        const partialText =
          partial.partialContent && partial.partialContent.length > 0
            ? `\n\nPartial output before cutoff:\n${this.summarize(partial.partialContent)}`
            : "";
        this.result = {
          summary: `(Sub-agent force-completed: ${reason})${partialText}`,
          artifacts: Array.isArray(partial.artifacts) ? partial.artifacts : [],
          tokenCount: this._tokenCount,
          toolsUsed: [...new Set(this._toolsUsed)],
          iterationCount: this._iterationCount,
        };
      }
    }
  }

  /**
   * Serializable child→parent recovery lineage. Worktree paths are included
   * for local restore UX; executable merge callbacks and tool payloads are not.
   */
  recoveryBinding(result = this.result) {
    const worktree = result?.worktree || null;
    return {
      childAgentId: this.id,
      parentAgentId: this.parentId || null,
      traceId: this._runId,
      parentTraceId: this._hookParentTraceId || null,
      checkpointIds: [...this._checkpointIds],
      toolUseIds: [...this._toolUseIds],
      ...(this._workflowEffectId
        ? {
            providerRequestAttempts: this.providerRequestAttempts(),
            providerRequestReceipts: this.providerRequestReceipts(),
            nestedEffectAttempts: this.nestedEffectAttempts(),
            nestedEffectSettlements: this.nestedEffectSettlements(),
          }
        : {}),
      worktreeId: worktree?.branch || this._worktreeBranch || null,
      worktreePath: worktree?.path || this._worktreePath || null,
    };
  }

  /**
   * Effect-bound provider calls admitted before transport dispatch.
   */
  providerRequestAttempts() {
    return this._providerRequestAttempts.map((attempt) => ({ ...attempt }));
  }

  /**
   * Provider-returned request identifiers observed during this child run.
   * Values are copied so callers cannot mutate recovery evidence in place.
   */
  providerRequestReceipts() {
    return this._providerRequestReceipts.map((receipt) => ({ ...receipt }));
  }

  nestedEffectAttempts() {
    return this._nestedEffectAttempts.map((attempt) => ({ ...attempt }));
  }

  nestedEffectSettlements() {
    return this._nestedEffectSettlements.map((settlement) => ({
      ...settlement,
    }));
  }

  _recordNestedEffectAttempt(event) {
    if (!this._workflowEffectId) return;
    const attempt = {
      protocol: event?.workflowEffectProtocol,
      workflowEffectId: event?.workflowEffectId,
      childEffectId: event?.workflowChildEffectId,
      childSequence: event?.workflowChildSequence,
      kind: "tool",
      tool: event?.tool,
      toolUseId: event?.tool_use_id,
      identitySemantics: "runtime-derived",
    };
    if (
      attempt.protocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
      attempt.workflowEffectId !== this._workflowEffectId ||
      !WORKFLOW_EFFECT_ID_RE.test(attempt.childEffectId || "") ||
      !Number.isSafeInteger(attempt.childSequence) ||
      attempt.childSequence < 1 ||
      !WORKFLOW_TOOL_NAME_RE.test(attempt.tool || "") ||
      !WORKFLOW_TOOL_CALL_ID_RE.test(attempt.toolUseId || "") ||
      this._nestedEffectAttempts.some(
        (existing) =>
          existing.childEffectId === attempt.childEffectId ||
          existing.childSequence === attempt.childSequence,
      )
    ) {
      const error = new TypeError(
        "workflow nested-effect boundary is malformed or duplicated",
      );
      error.code = "CC_WORKFLOW_CHILD_EFFECT_BOUNDARY_INVALID";
      throw error;
    }
    this._nestedEffectAttempts.push(Object.freeze(attempt));
  }

  _recordNestedEffectSettlement(event) {
    if (!this._workflowEffectId || !event?.workflowChildEffectId) return null;
    const attempt = this._nestedEffectAttempts.find(
      (candidate) =>
        candidate.childEffectId === event.workflowChildEffectId,
    );
    const outcomeUnknown = ownDataValue(event.result, "outcomeUnknown") === true;
    const resultError = ownDataValue(event.result, "error");
    const mcpLedgerId = ownDataValue(event.result, "mcpLedgerId") ?? null;
    const settlement = {
      protocol: event?.workflowEffectProtocol,
      workflowEffectId: event?.workflowEffectId,
      childEffectId: event?.workflowChildEffectId,
      childSequence: event?.workflowChildSequence,
      kind: "tool",
      tool: event?.tool,
      toolUseId: event?.tool_use_id,
      status: outcomeUnknown
        ? "outcome_unknown"
        : event?.error || resultError
          ? "failed"
          : "completed",
      outcomeUnknown,
      mcpLedgerId,
      mcpLedgerPrewritePersisted:
        ownDataValue(event.result, "mcpLedgerPrewritePersisted") === true,
      mcpLedgerSettlementPersisted:
        ownDataValue(event.result, "mcpLedgerSettlementPersisted") === true,
    };
    if (
      !attempt ||
      settlement.protocol !== WORKFLOW_CHILD_EFFECT_PROTOCOL ||
      settlement.workflowEffectId !== this._workflowEffectId ||
      settlement.childSequence !== attempt.childSequence ||
      settlement.tool !== attempt.tool ||
      settlement.toolUseId !== attempt.toolUseId ||
      (mcpLedgerId !== null &&
        !PROVIDER_CALL_ID_RE.test(String(mcpLedgerId))) ||
      this._nestedEffectSettlements.some(
        (existing) => existing.childEffectId === settlement.childEffectId,
      )
    ) {
      const error = new TypeError(
        "workflow nested-effect settlement is malformed or duplicated",
      );
      error.code = "CC_WORKFLOW_CHILD_EFFECT_SETTLEMENT_INVALID";
      error.workflowEffectOutcomeUnknown = true;
      throw error;
    }
    this._nestedEffectSettlements.push(Object.freeze(settlement));
    return settlement;
  }

  _recordProviderRequestAttempt(event) {
    if (!this._workflowEffectId) return;
    const attempt = {
      protocol: "cc-provider-request-attempt/v1",
      provider: event?.provider,
      workflowEffectId: event?.workflowEffectId,
      callId: event?.callId,
      callSequence: event?.callSequence,
      source: event?.source,
      clientRequestId: event?.providerRequestId,
      requestIdentitySemantics: event?.requestIdentitySemantics,
    };
    if (
      !PROVIDER_NAME_RE.test(attempt.provider || "") ||
      attempt.workflowEffectId !== this._workflowEffectId ||
      !PROVIDER_CALL_ID_RE.test(attempt.callId || "") ||
      !Number.isSafeInteger(attempt.callSequence) ||
      attempt.callSequence < 1 ||
      !["model", "semantic-compaction"].includes(attempt.source) ||
      !PROVIDER_CLIENT_REQUEST_ID_RE.test(attempt.clientRequestId || "") ||
      attempt.requestIdentitySemantics !== "trace-only" ||
      this._providerRequestAttempts.some(
        (existing) => existing.callId === attempt.callId,
      )
    ) {
      const error = new TypeError(
        "workflow provider request boundary is malformed or duplicated",
      );
      error.code = "CC_WORKFLOW_PROVIDER_REQUEST_BOUNDARY_INVALID";
      throw error;
    }
    this._providerRequestAttempts.push(Object.freeze(attempt));
  }

  /**
   * True when this sub-agent has been asked to stop — either via an external
   * abort signal or via this context's own `abort()` (precise single-agent
   * cancel). The agent loop checks this each iteration and winds down
   * cooperatively (force-completes with the partial work it has).
   */
  isAborted() {
    return Boolean(
      this._signal?.aborted ||
      this._abortController.signal.aborted ||
      this._runAbortController?.signal.aborted ||
      this.sessionBudget?.signal?.aborted,
    );
  }

  /**
   * Precisely cancel THIS sub-agent: trip its internal abort signal so the loop
   * stops at its next iteration and hands back partial work. Idempotent. The
   * `reason` surfaces in the force-completed summary. Returns true if the abort
   * was newly requested, false if it was already aborted / not active.
   */
  abort(reason = "cancelled") {
    if (this.status !== "active" || this._abortController.signal.aborted) {
      return false;
    }
    this._cancelReason = reason;
    try {
      this._abortController.abort(reason);
    } catch {
      this._abortController.abort();
    }
    return true;
  }

  /**
   * Get a serializable snapshot of this context (for debugging/logging).
   */
  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      role: this.role,
      task: this.task,
      status: this.status,
      messageCount: this.messages.length,
      toolsUsed: [...new Set(this._toolsUsed)],
      tokenCount: this._tokenCount,
      iterationCount: this._iterationCount,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      recoveryBinding: this.recoveryBinding(),
      worktree: this._worktreePath
        ? { path: this._worktreePath, branch: this._worktreeBranch }
        : null,
    };
  }
}

// =====================================================================
// sub-agent-context V2 governance overlay (iter26)
// =====================================================================
export const SACTXGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const SACTXGOV_HANDOFF_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  TRANSFERRING: "transferring",
  TRANSFERRED: "transferred",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _sactxgovPTrans = new Map([
  [
    SACTXGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SACTXGOV_PROFILE_MATURITY_V2.ACTIVE,
      SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SACTXGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SACTXGOV_PROFILE_MATURITY_V2.STALE,
      SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SACTXGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      SACTXGOV_PROFILE_MATURITY_V2.ACTIVE,
      SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _sactxgovPTerminal = new Set([SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _sactxgovJTrans = new Map([
  [
    SACTXGOV_HANDOFF_LIFECYCLE_V2.QUEUED,
    new Set([
      SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING,
      SACTXGOV_HANDOFF_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING,
    new Set([
      SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRED,
      SACTXGOV_HANDOFF_LIFECYCLE_V2.FAILED,
      SACTXGOV_HANDOFF_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRED, new Set()],
  [SACTXGOV_HANDOFF_LIFECYCLE_V2.FAILED, new Set()],
  [SACTXGOV_HANDOFF_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _sactxgovPsV2 = new Map();
const _sactxgovJsV2 = new Map();
let _sactxgovMaxActive = 8,
  _sactxgovMaxPending = 20,
  _sactxgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _sactxgovStuckMs = 60 * 1000;
function _sactxgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _sactxgovCheckP(from, to) {
  const a = _sactxgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sactxgov profile transition ${from} → ${to}`);
}
function _sactxgovCheckJ(from, to) {
  const a = _sactxgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sactxgov handoff transition ${from} → ${to}`);
}
function _sactxgovCountActive(owner) {
  let c = 0;
  for (const p of _sactxgovPsV2.values())
    if (p.owner === owner && p.status === SACTXGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _sactxgovCountPending(profileId) {
  let c = 0;
  for (const j of _sactxgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SACTXGOV_HANDOFF_LIFECYCLE_V2.QUEUED ||
        j.status === SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING)
    )
      c++;
  return c;
}
export function setMaxActiveSactxgovProfilesPerOwnerV2(n) {
  _sactxgovMaxActive = _sactxgovPos(n, "maxActiveSactxgovProfilesPerOwner");
}
export function getMaxActiveSactxgovProfilesPerOwnerV2() {
  return _sactxgovMaxActive;
}
export function setMaxPendingSactxgovHandoffsPerProfileV2(n) {
  _sactxgovMaxPending = _sactxgovPos(n, "maxPendingSactxgovHandoffsPerProfile");
}
export function getMaxPendingSactxgovHandoffsPerProfileV2() {
  return _sactxgovMaxPending;
}
export function setSactxgovProfileIdleMsV2(n) {
  _sactxgovIdleMs = _sactxgovPos(n, "sactxgovProfileIdleMs");
}
export function getSactxgovProfileIdleMsV2() {
  return _sactxgovIdleMs;
}
export function setSactxgovHandoffStuckMsV2(n) {
  _sactxgovStuckMs = _sactxgovPos(n, "sactxgovHandoffStuckMs");
}
export function getSactxgovHandoffStuckMsV2() {
  return _sactxgovStuckMs;
}
export function _resetStateSubAgentContextGovV2() {
  _sactxgovPsV2.clear();
  _sactxgovJsV2.clear();
  _sactxgovMaxActive = 8;
  _sactxgovMaxPending = 20;
  _sactxgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _sactxgovStuckMs = 60 * 1000;
}
export function registerSactxgovProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_sactxgovPsV2.has(id))
    throw new Error(`sactxgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    scope: scope || "task",
    status: SACTXGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sactxgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSactxgovProfileV2(id) {
  const p = _sactxgovPsV2.get(id);
  if (!p) throw new Error(`sactxgov profile ${id} not found`);
  const isInitial = p.status === SACTXGOV_PROFILE_MATURITY_V2.PENDING;
  _sactxgovCheckP(p.status, SACTXGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _sactxgovCountActive(p.owner) >= _sactxgovMaxActive)
    throw new Error(
      `max active sactxgov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = SACTXGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleSactxgovProfileV2(id) {
  const p = _sactxgovPsV2.get(id);
  if (!p) throw new Error(`sactxgov profile ${id} not found`);
  _sactxgovCheckP(p.status, SACTXGOV_PROFILE_MATURITY_V2.STALE);
  p.status = SACTXGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSactxgovProfileV2(id) {
  const p = _sactxgovPsV2.get(id);
  if (!p) throw new Error(`sactxgov profile ${id} not found`);
  _sactxgovCheckP(p.status, SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SACTXGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSactxgovProfileV2(id) {
  const p = _sactxgovPsV2.get(id);
  if (!p) throw new Error(`sactxgov profile ${id} not found`);
  if (_sactxgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal sactxgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSactxgovProfileV2(id) {
  const p = _sactxgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSactxgovProfilesV2() {
  return [..._sactxgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSactxgovHandoffV2({
  id,
  profileId,
  subAgent,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_sactxgovJsV2.has(id))
    throw new Error(`sactxgov handoff ${id} already exists`);
  if (!_sactxgovPsV2.has(profileId))
    throw new Error(`sactxgov profile ${profileId} not found`);
  if (_sactxgovCountPending(profileId) >= _sactxgovMaxPending)
    throw new Error(
      `max pending sactxgov handoffs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    subAgent: subAgent || "",
    status: SACTXGOV_HANDOFF_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sactxgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function transferringSactxgovHandoffV2(id) {
  const j = _sactxgovJsV2.get(id);
  if (!j) throw new Error(`sactxgov handoff ${id} not found`);
  _sactxgovCheckJ(j.status, SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING);
  const now = Date.now();
  j.status = SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeHandoffSactxgovV2(id) {
  const j = _sactxgovJsV2.get(id);
  if (!j) throw new Error(`sactxgov handoff ${id} not found`);
  _sactxgovCheckJ(j.status, SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRED);
  const now = Date.now();
  j.status = SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSactxgovHandoffV2(id, reason) {
  const j = _sactxgovJsV2.get(id);
  if (!j) throw new Error(`sactxgov handoff ${id} not found`);
  _sactxgovCheckJ(j.status, SACTXGOV_HANDOFF_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SACTXGOV_HANDOFF_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSactxgovHandoffV2(id, reason) {
  const j = _sactxgovJsV2.get(id);
  if (!j) throw new Error(`sactxgov handoff ${id} not found`);
  _sactxgovCheckJ(j.status, SACTXGOV_HANDOFF_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SACTXGOV_HANDOFF_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSactxgovHandoffV2(id) {
  const j = _sactxgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSactxgovHandoffsV2() {
  return [..._sactxgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleSactxgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _sactxgovPsV2.values())
    if (
      p.status === SACTXGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _sactxgovIdleMs
    ) {
      p.status = SACTXGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSactxgovHandoffsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _sactxgovJsV2.values())
    if (
      j.status === SACTXGOV_HANDOFF_LIFECYCLE_V2.TRANSFERRING &&
      j.startedAt != null &&
      t - j.startedAt >= _sactxgovStuckMs
    ) {
      j.status = SACTXGOV_HANDOFF_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSubAgentContextGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SACTXGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _sactxgovPsV2.values()) profilesByStatus[p.status]++;
  const handoffsByStatus = {};
  for (const v of Object.values(SACTXGOV_HANDOFF_LIFECYCLE_V2))
    handoffsByStatus[v] = 0;
  for (const j of _sactxgovJsV2.values()) handoffsByStatus[j.status]++;
  return {
    totalSactxgovProfilesV2: _sactxgovPsV2.size,
    totalSactxgovHandoffsV2: _sactxgovJsV2.size,
    maxActiveSactxgovProfilesPerOwner: _sactxgovMaxActive,
    maxPendingSactxgovHandoffsPerProfile: _sactxgovMaxPending,
    sactxgovProfileIdleMs: _sactxgovIdleMs,
    sactxgovHandoffStuckMs: _sactxgovStuckMs,
    profilesByStatus,
    handoffsByStatus,
  };
}
