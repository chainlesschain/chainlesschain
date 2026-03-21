/**
 * Claude Code Bridge — spawns Claude Code CLI processes as execution agents.
 *
 * ChainlessChain (orchestrator) dispatches coding tasks to one or more
 * `claude` CLI sub-processes that run non-interactively, capturing their
 * output and returning structured results.
 *
 * Usage:
 *   const pool = new ClaudeCodePool({ maxParallel: 3 });
 *   const results = await pool.dispatch([
 *     { id: "t1", description: "Fix the null check in auth.js" },
 *     { id: "t2", description: "Add unit tests for login flow" },
 *   ], { cwd: "/path/to/project" });
 */

import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";

/* ---------- _deps injection (Vitest CJS mock pattern) ---------- */
export const _deps = { spawn, execSync };

// ─── Agent status constants ───────────────────────────────────────

export const AGENT_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

// ─── Detection ───────────────────────────────────────────────────

/**
 * Check if the `claude` CLI is installed and return version info.
 * Returns { found: boolean, version?: string, path?: string }.
 */
export function detectClaudeCode() {
  try {
    const version = _deps
      .execSync("claude --version", { encoding: "utf-8", timeout: 5000 })
      .trim();
    return { found: true, version };
  } catch (_err) {
    return { found: false };
  }
}

/**
 * Check if the `codex` CLI (GitHub Copilot Coding Agent) is installed.
 * Returns { found: boolean, version?: string }.
 */
export function detectCodex() {
  try {
    const version = _deps
      .execSync("codex --version", { encoding: "utf-8", timeout: 5000 })
      .trim();
    return { found: true, version };
  } catch (_err) {
    return { found: false };
  }
}

// ─── Single Agent ─────────────────────────────────────────────────

/**
 * A single Claude Code CLI execution agent.
 * Wraps `claude -p "<task>" --output-format stream-json` as a child process.
 */
export class ClaudeCodeAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id =
      options.id ||
      `cc-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.cliCommand = options.cliCommand || "claude"; // "claude" or "codex"
    this.model = options.model || null;
    this.status = AGENT_STATUS.IDLE;
    this.currentTask = null;
    this._proc = null;
  }

  /**
   * Execute a coding task non-interactively.
   *
   * @param {string} taskDescription - Natural language task for Claude Code
   * @param {object} options
   * @param {string} options.cwd         - Project root directory
   * @param {number} options.timeout     - Max ms to wait (default 300_000 = 5 min)
   * @param {string} options.context     - Extra context prepended to task
   * @param {string} options.allowedTools - Comma-separated tool allow-list
   * @returns {Promise<{success, output, exitCode, duration, taskId}>}
   */
  async executeTask(taskDescription, options = {}) {
    const {
      cwd = process.cwd(),
      timeout = 300_000,
      context = "",
      allowedTools = null,
    } = options;

    const fullPrompt = context
      ? `Context:\n${context}\n\nTask:\n${taskDescription}`
      : taskDescription;

    this.status = AGENT_STATUS.RUNNING;
    this.currentTask = taskDescription;
    this.emit("task:start", { agentId: this.id, task: taskDescription });

    const args = ["-p", fullPrompt, "--output-format", "stream-json"];
    if (this.model) {
      args.push("--model", this.model);
    }
    if (allowedTools) {
      args.push("--allowedTools", allowedTools);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const outputChunks = [];
      const errorChunks = [];
      let timedOut = false;

      const proc = _deps.spawn(this.cliCommand, args, {
        cwd,
        env: { ...process.env },
        windowsHide: true,
      });
      this._proc = proc;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 3000);
      }, timeout);

      proc.stdout.on("data", (data) => {
        const chunk = data.toString("utf8");
        outputChunks.push(chunk);
        this.emit("output", { agentId: this.id, chunk });
      });

      proc.stderr.on("data", (data) => {
        errorChunks.push(data.toString("utf8"));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        this._proc = null;
        const duration = Date.now() - startTime;
        const rawOutput = outputChunks.join("");
        const status = timedOut
          ? AGENT_STATUS.TIMEOUT
          : code === 0
            ? AGENT_STATUS.COMPLETED
            : AGENT_STATUS.FAILED;

        this.status = status;
        this.currentTask = null;

        // Parse stream-json output: last assistant message is the result
        const parsedOutput = _parseStreamJson(rawOutput);

        const result = {
          success: code === 0 && !timedOut,
          output: parsedOutput || rawOutput.slice(-4000), // last 4K chars fallback
          rawOutput,
          exitCode: code,
          duration,
          timedOut,
          agentId: this.id,
          stderr: errorChunks.join("").slice(-2000),
        };

        this.emit("task:complete", result);
        resolve(result);
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this._proc = null;
        this.status = AGENT_STATUS.FAILED;
        this.currentTask = null;
        const result = {
          success: false,
          output: "",
          exitCode: -1,
          duration: Date.now() - startTime,
          timedOut: false,
          agentId: this.id,
          error: err.message,
        };
        this.emit("task:complete", result);
        resolve(result);
      });
    });
  }

  /** Abort the currently running task. */
  abort() {
    if (this._proc) {
      this._proc.kill("SIGTERM");
    }
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      cliCommand: this.cliCommand,
      currentTask: this.currentTask,
    };
  }
}

// ─── Agent Pool ───────────────────────────────────────────────────

/**
 * Manages a pool of Claude Code agents for parallel task dispatch.
 */
export class ClaudeCodePool extends EventEmitter {
  /**
   * @param {object} options
   * @param {number}  options.maxParallel    - Max concurrent agents (default 3)
   * @param {string}  options.cliCommand     - CLI to use: "claude" or "codex"
   * @param {string}  options.model          - Model override
   * @param {number}  options.agentTimeout   - Per-agent timeout ms
   */
  constructor(options = {}) {
    super();
    this.maxParallel = options.maxParallel || 3;
    this.cliCommand = options.cliCommand || "claude";
    this.model = options.model || null;
    this.agentTimeout = options.agentTimeout || 300_000;

    /** @type {Map<string, ClaudeCodeAgent>} */
    this._agents = new Map();
    this._completed = [];
  }

  /**
   * Dispatch an array of tasks to agents in parallel batches.
   *
   * @param {Array<{id, description, context?, allowedTools?}>} tasks
   * @param {object} options
   * @param {string} options.cwd - Shared working directory for all tasks
   * @returns {Promise<Array<{taskId, agentId, success, output, duration}>>}
   */
  async dispatch(tasks, options = {}) {
    const { cwd = process.cwd() } = options;
    const results = [];

    // Process in batches of maxParallel
    for (let i = 0; i < tasks.length; i += this.maxParallel) {
      const batch = tasks.slice(i, i + this.maxParallel);
      this.emit("batch:start", {
        batchIndex: i / this.maxParallel,
        count: batch.length,
      });

      const batchResults = await Promise.all(
        batch.map((task) => this._runTask(task, { cwd })),
      );

      results.push(...batchResults);
      this.emit("batch:complete", {
        batchIndex: i / this.maxParallel,
        results: batchResults,
      });
    }

    return results;
  }

  async _runTask(task, { cwd }) {
    const agent = new ClaudeCodeAgent({
      id: `agent-${task.id}`,
      cliCommand: this.cliCommand,
      model: this.model,
    });

    this._agents.set(agent.id, agent);
    agent.on("output", (ev) => this.emit("agent:output", ev));

    const result = await agent.executeTask(task.description, {
      cwd,
      timeout: this.agentTimeout,
      context: task.context || "",
      allowedTools: task.allowedTools || null,
    });

    this._agents.delete(agent.id);
    this._completed.push({ ...result, taskId: task.id });

    this.emit("agent:complete", { taskId: task.id, ...result });
    return { taskId: task.id, ...result };
  }

  /** Current pool status snapshot. */
  status() {
    const active = [...this._agents.values()].map((a) => a.toJSON());
    return {
      active,
      activeCount: active.length,
      maxParallel: this.maxParallel,
      cliCommand: this.cliCommand,
    };
  }

  /** Abort all running agents. */
  abortAll() {
    for (const agent of this._agents.values()) {
      agent.abort();
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse Claude Code stream-json output and extract the last assistant text.
 * Stream-json lines look like:  {"type":"assistant","message":{...}}
 */
function _parseStreamJson(raw) {
  if (!raw) return "";
  const lines = raw.split("\n").filter(Boolean);
  let lastText = "";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // stream-json: result message has type "result"
      if (obj.type === "result" && obj.result) {
        return typeof obj.result === "string"
          ? obj.result
          : JSON.stringify(obj.result);
      }
      // assistant message blocks
      if (obj.type === "assistant" && obj.message?.content) {
        const blocks = obj.message.content;
        const textBlocks = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (textBlocks) lastText = textBlocks;
      }
    } catch (_err) {
      // Non-JSON line (progress text) — ignore
    }
  }

  return lastText;
}
