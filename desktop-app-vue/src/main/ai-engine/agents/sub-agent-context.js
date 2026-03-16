/**
 * Sub-Agent Context for Desktop (CJS)
 *
 * Desktop-side equivalent of packages/cli/src/lib/sub-agent-context.js.
 * Uses constructor-based dependency injection (database, llmManager) instead
 * of module-level imports, matching the desktop DI pattern.
 *
 * Provides message isolation, tool whitelisting, iteration limits,
 * and result summarization for sub-agents in the desktop Electron app.
 */

const crypto = require("crypto");
const EventEmitter = require("events");

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 8;
const SUMMARY_DIRECT_THRESHOLD = 500;
const SUMMARY_SECTION_PATTERN =
  /^##\s*(Summary|Result|Output|Conclusion|Answer)/im;
const TRUNCATE_LENGTH = 500;

// ─── SubAgentContext ────────────────────────────────────────────────────────

class SubAgentContext extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.role - Sub-agent role
   * @param {string} options.task - Task description
   * @param {string} [options.parentId] - Parent context ID
   * @param {string|null} [options.inheritedContext] - Condensed context from parent
   * @param {string[]} [options.allowedTools] - Tool whitelist
   * @param {number} [options.maxIterations] - Iteration limit
   * @param {object} [options.database] - Desktop database instance
   * @param {object} [options.llmManager] - Desktop LLM manager instance
   */
  constructor(options = {}) {
    super();
    this.id = `sub-${crypto.randomUUID().slice(0, 12)}`;
    this.parentId = options.parentId || null;
    this.role = options.role || "general";
    this.task = options.task || "";
    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.tokenBudget = options.tokenBudget || null;
    this.inheritedContext = options.inheritedContext || null;
    this.allowedTools = options.allowedTools || null;
    this.status = "active";
    this.result = null;
    this.createdAt = new Date().toISOString();
    this.completedAt = null;

    // Desktop DI dependencies
    this.database = options.database || null;
    this.llmManager = options.llmManager || null;

    // Isolated state
    this.messages = [];
    this._toolsUsed = [];
    this._tokenCount = 0;
    this._iterationCount = 0;

    // Build isolated system prompt
    const rolePrompt = `You are a focused sub-agent with the role "${this.role}". Your task is:\n${this.task}\n\nStay focused on this specific task. Be concise and return results directly.`;
    const contextSection = this.inheritedContext
      ? `\n\nParent Context:\n${this.inheritedContext}`
      : "";

    this.messages.push({
      role: "system",
      content: rolePrompt + contextSection,
    });
  }

  /**
   * Run the sub-agent with the given prompt.
   * Uses the desktop llmManager for LLM calls.
   *
   * @param {string} userPrompt
   * @returns {Promise<{ summary: string, artifacts: Array, tokenCount: number, toolsUsed: string[], iterationCount: number }>}
   */
  async run(userPrompt) {
    if (this.status !== "active") {
      throw new Error(
        `SubAgentContext ${this.id} is not active (status: ${this.status})`,
      );
    }

    this.messages.push({ role: "user", content: userPrompt });
    this.emit("started", { id: this.id, role: this.role });

    let lastContent = "";
    const artifacts = [];

    try {
      if (!this.llmManager) {
        // No LLM manager — return task as-is
        lastContent = `(No LLM manager available for sub-agent "${this.role}")`;
      } else {
        // Simple single-shot LLM call for desktop sub-agents
        const response = await this.llmManager.chat(this.messages, {
          maxIterations: this.maxIterations,
        });
        lastContent =
          typeof response === "string"
            ? response
            : response?.content || response?.message?.content || "";
        // Estimate token count (~4 chars per token)
        this._tokenCount += Math.ceil((lastContent.length || 0) / 4);

        // Enforce token budget
        if (this.tokenBudget && this._tokenCount >= this.tokenBudget) {
          this.forceComplete("token-budget-exceeded");
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
      this.emit("failed", { id: this.id, error: err.message });
      return this.result;
    }

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

    this.emit("completed", { id: this.id, result: this.result });
    return this.result;
  }

  /**
   * Three-level summarization.
   */
  summarize(content) {
    if (!content || content.length === 0) {
      return "(No output from sub-agent)";
    }

    if (content.length <= SUMMARY_DIRECT_THRESHOLD) {
      return content;
    }

    const match = content.match(SUMMARY_SECTION_PATTERN);
    if (match) {
      const rest = content.slice(match.index + match[0].length);
      const nextHeading = rest.search(/^##\s/m);
      const section =
        nextHeading >= 0 ? rest.slice(0, nextHeading).trim() : rest.trim();
      if (section.length > 0 && section.length <= 1000) {
        return section;
      }
    }

    return (
      content.substring(0, TRUNCATE_LENGTH) +
      `\n...[truncated, full output: ${content.length} chars]`
    );
  }

  /**
   * Force-complete this sub-agent.
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
      this.emit("force-completed", { id: this.id, reason });
    }
  }

  /**
   * Serializable snapshot.
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
    };
  }
}

module.exports = { SubAgentContext };
