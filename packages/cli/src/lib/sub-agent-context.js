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

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 8;
const SUMMARY_DIRECT_THRESHOLD = 500; // chars — below this, use result as-is
const SUMMARY_SECTION_PATTERN =
  /^##\s*(Summary|Result|Output|Conclusion|Answer)/im;
const TRUNCATE_LENGTH = 500;

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
   * @param {number} [options.tokenBudget] - Optional token budget
   * @param {object} [options.db] - Database instance
   * @param {object} [options.permanentMemory] - Permanent memory instance
   * @param {object} [options.llmOptions] - LLM provider/model/key options
   * @param {string} [options.cwd] - Working directory
   * @param {boolean} [options.useWorktree] - Force worktree isolation (overrides flag)
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
    this.tokenBudget = options.tokenBudget || null;
    this.inheritedContext = options.inheritedContext || null;
    this.allowedTools = options.allowedTools || null; // null = all
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

    // ── Isolated state ──────────────────────────────────────────────
    // Independent message history — never shared with parent
    this.messages = [];

    // Independent context engine — does not inherit parent's compaction/errors
    this.contextEngine = new CLIContextEngineering({
      db: options.db || null,
      permanentMemory: options.permanentMemory || null,
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

    // Optional abort signal for cancellation
    this._signal = options.signal || null;

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

    // If worktree isolation is enabled, wrap execution in isolated worktree
    if (this._useWorktree && isGitRepo(this._repoDir)) {
      return this._runInWorktree(userPrompt, loopOptions);
    }

    return this._runCore(userPrompt, loopOptions);
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

    // Build filtered tool list
    const tools = this._getFilteredTools();

    // Merge LLM options — pass shared iteration budget if available
    const options = {
      ...this._llmOptions,
      contextEngine: this.contextEngine,
      cwd: this.cwd,
      ...loopOptions,
    };
    if (this.iterationBudget) {
      options.iterationBudget = this.iterationBudget;
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

    try {
      // Use a separate messages array for the agent loop
      // The agentLoop will append to this.messages directly
      const gen = agentLoop(this.messages, options);

      for await (const event of gen) {
        this._iterationCount++;

        if (event.type === "tool-executing") {
          this._toolsUsed.push(event.tool);
        }

        if (event.type === "tool-result") {
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

        // Check abort signal
        if (this._signal?.aborted) {
          this.forceComplete("cancelled");
          break;
        }

        // Enforce token budget
        if (this.tokenBudget && this._tokenCount >= this.tokenBudget) {
          this.forceComplete("token-budget-exceeded");
          break;
        }

        // Enforce iteration limit
        if (this._iterationCount >= this.maxIterations * 3) {
          // 3 events per iteration (executing + result + potential response)
          break;
        }
      }
    } catch (err) {
      this.status = "failed";
      this.completedAt = new Date().toISOString();
      this.result = {
        summary: `Sub-agent failed: ${err.message}`,
        artifacts: [],
        tokenCount: this._tokenCount,
        toolsUsed: [...new Set(this._toolsUsed)],
        iterationCount: this._iterationCount,
      };
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
    if (!this.allowedTools || this.allowedTools.length === 0) {
      return AGENT_TOOLS;
    }
    return AGENT_TOOLS.filter((t) =>
      this.allowedTools.includes(t.function.name),
    );
  }

  /**
   * Force-complete this sub-agent (e.g. on timeout or parent cancellation).
   * @param {string} [reason] - Reason for force-completion
   */
  forceComplete(reason = "forced") {
    if (this.status === "active") {
      this.status = "completed";
      this.completedAt = new Date().toISOString();
      if (!this.result) {
        this.result = {
          summary: `(Sub-agent force-completed: ${reason})`,
          artifacts: [],
          tokenCount: this._tokenCount,
          toolsUsed: [...new Set(this._toolsUsed)],
          iterationCount: this._iterationCount,
        };
      }
    }
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
