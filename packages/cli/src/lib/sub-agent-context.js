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
    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
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

    // Build isolated system prompt
    const basePrompt = buildSystemPrompt(this.cwd);
    const rolePrompt = `\n\n## Sub-Agent Role: ${this.role}\nYou are a focused sub-agent with the role "${this.role}". Your task is:\n${this.task}\n\nStay focused on this specific task. Be concise and return results directly.`;
    const contextSection = this.inheritedContext
      ? `\n\n## Parent Context\n${this.inheritedContext}`
      : "";

    this.messages.push({
      role: "system",
      content: basePrompt + rolePrompt + contextSection,
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
