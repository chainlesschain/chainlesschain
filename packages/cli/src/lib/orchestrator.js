/**
 * Orchestrator — ChainlessChain's task orchestration engine.
 *
 * Implements the OpenClaw pattern:
 *   Input Sources → ChainlessChain (orchestrator) → Multi-path Agents
 *   → CI/CD Verification → Multi-channel Notification
 *
 * Flow:
 *   1. Accept task from any input source (CLI, Sentry, GitHub Issues, IM platforms)
 *   2. Decompose into subtasks via LLM
 *   3. Dispatch to AgentRouter (claude/codex/gemini/gpt in parallel)
 *   4. Run CI/CD checks after agents complete
 *   5. On CI pass  → notify via all configured channels (Telegram/WeCom/DingTalk/Feishu/WS)
 *   6. On CI fail  → re-dispatch with error context (up to maxRetries)
 *
 * Usage:
 *   const orch = new Orchestrator({ cwd: "/path/to/project" });
 *   await orch.addTask("Fix the auth null pointer in login.ts");
 *
 *   // With WebSocket channel (when triggered from WS interface):
 *   orch.notifier.addWebSocketChannel({ send: (d) => _send(ws, d), requestId });
 */

import { EventEmitter } from "events";
import { execSync } from "child_process";
import crypto from "crypto";
import { AgentRouter } from "./agent-router.js";
import { NotificationManager } from "./notifiers/index.js";
import { createChatFn } from "./cowork-adapter.js";

/* ---------- _deps injection (Vitest CJS mock pattern) ---------- */
export const _deps = { execSync };

// ─── Task statuses ────────────────────────────────────────────────
export const TASK_STATUS = {
  PENDING: "pending",
  DECOMPOSING: "decomposing",
  DISPATCHED: "dispatched",
  CI_CHECKING: "ci-checking",
  CI_PASSED: "ci-passed",
  CI_FAILED: "ci-failed",
  RETRYING: "retrying",
  COMPLETED: "completed",
  FAILED: "failed",
};

// ─── Task source labels ───────────────────────────────────────────
export const TASK_SOURCE = {
  CLI: "cli",
  SENTRY: "sentry",
  GITHUB: "github",
  FILE: "file",
  CRON: "cron",
};

function generateId(prefix = "task") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

// ─── Orchestrator ─────────────────────────────────────────────────

export class Orchestrator extends EventEmitter {
  /**
   * @param {object} options
   * @param {string}  options.cwd            - Default project root
   * @param {number}  options.maxParallel     - Max parallel agents (default 3)
   * @param {number}  options.maxRetries      - Max CI retry cycles (default 3)
   * @param {string}  options.ciCommand       - CI command (default "npm test")
   * @param {object}  options.agents          - AgentRouter config: { backends, strategy }
   *                                           or pass agentRouter directly
   * @param {object}  options.notify          - Notification channels config:
   *                                           { telegram, wecom, dingtalk, feishu }
   * @param {object}  options.llm             - { provider, model, apiKey } for decomposition
   * @param {boolean} options.verbose
   */
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.maxParallel = options.maxParallel || 3;
    this.maxRetries = options.maxRetries || 3;
    this.ciCommand = options.ciCommand || "npm test";
    this.verbose = options.verbose || false;

    /** @type {Map<string, object>} taskId → task */
    this._tasks = new Map();

    // Multi-path agent router
    this._router =
      options.agentRouter ||
      (options.agents
        ? new AgentRouter({
            backends: options.agents.backends || [],
            strategy: options.agents.strategy || "round-robin",
            maxParallel: this.maxParallel,
          })
        : AgentRouter.autoDetect({ maxParallel: this.maxParallel }));

    // Multi-channel notification manager
    this.notifier =
      options.notifier || NotificationManager.fromEnv(options.notify || {});

    this._chat = createChatFn(options.llm || {});
    this._cronTimer = null;

    // Forward router events
    this._router.on("agent:output", (ev) => this.emit("agent:output", ev));
    this._router.on("agent:complete", (ev) => this.emit("agent:complete", ev));
    this._router.on("agent:start", (ev) => this.emit("agent:start", ev));
  }

  /**
   * Expose the router's backend summary for status display.
   */
  get agentBackends() {
    return this._router.summary();
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Add a task and immediately start orchestrating it.
   *
   * @param {string} description - Natural language task
   * @param {object} opts
   * @param {string}   opts.source      - Where the task came from (TASK_SOURCE.*)
   * @param {number}   opts.priority    - 1 (high) – 3 (low)
   * @param {string}   opts.cwd        - Override project dir for this task
   * @param {string}   opts.context    - Extra context (e.g. stack trace from Sentry)
   * @param {boolean}  opts.runCI      - Whether to run CI after agents complete
   * @param {boolean}  opts.notify     - Whether to send Telegram notification
   * @returns {Promise<object>} Final task record
   */
  async addTask(description, opts = {}) {
    const task = {
      id: generateId("task"),
      description,
      source: opts.source || TASK_SOURCE.CLI,
      priority: opts.priority || 2,
      cwd: opts.cwd || this.cwd,
      context: opts.context || "",
      runCI: opts.runCI !== false,
      notify: opts.notify !== false,
      status: TASK_STATUS.PENDING,
      subtasks: [],
      agentResults: [],
      retries: 0,
      ciErrors: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this._tasks.set(task.id, task);
    this.emit("task:added", task);

    if (this.notifier.isConfigured && task.notify) {
      // Fire-and-forget start notification
      this.notifier
        .notifyStart({
          taskId: task.id,
          description: task.description.slice(0, 100),
          subtaskCount: 1, // will update after decomposition
        })
        .catch(() => {});
    }

    await this._orchestrate(task);
    return task;
  }

  /**
   * Get current status of all tasks.
   */
  status() {
    const tasks = [...this._tasks.values()].map((t) => ({
      id: t.id,
      description: t.description.slice(0, 80),
      status: t.status,
      source: t.source,
      retries: t.retries,
      createdAt: t.createdAt,
    }));
    return {
      tasks,
      pool: this._router.summary(),
      cliCommand: this.cliCommand,
      cronActive: this._cronTimer !== null,
    };
  }

  /**
   * Start a cron watch that periodically polls for new tasks from input sources.
   * @param {number} intervalMs - Poll interval (default 600_000 = 10 min)
   */
  startCronWatch(intervalMs = 600_000) {
    if (this._cronTimer) return;
    this._log(`Cron watch started (every ${Math.round(intervalMs / 60_000)}m)`);
    this._cronTimer = setInterval(() => this._cronTick(), intervalMs);
  }

  stopCronWatch() {
    if (this._cronTimer) {
      clearInterval(this._cronTimer);
      this._cronTimer = null;
    }
  }

  // ─── Orchestration pipeline ──────────────────────────────────────

  async _orchestrate(task) {
    try {
      // Step 1: Decompose
      task.subtasks = await this._decompose(task);
      task.status = TASK_STATUS.DISPATCHED;

      // Step 2: Dispatch to Claude Code agents
      task.agentResults = await this._dispatch(task);

      // Step 3: CI/CD check
      if (task.runCI) {
        await this._ciLoop(task);
      } else {
        task.status = TASK_STATUS.COMPLETED;
        task.completedAt = new Date().toISOString();
        this.emit("task:complete", task);
      }
    } catch (err) {
      task.status = TASK_STATUS.FAILED;
      task.error = err.message;
      this.emit("task:failed", { task, error: err });
      this._log(`Task ${task.id} failed: ${err.message}`);
    }
  }

  /** LLM-driven task decomposition into coding subtasks. */
  async _decompose(task) {
    task.status = TASK_STATUS.DECOMPOSING;
    this.emit("task:decomposing", task);

    const systemPrompt =
      "You are a senior software architect. Given a coding task, break it into 1-4 " +
      "concrete, independently executable subtasks. Each subtask should be completable " +
      "by a single AI coding agent. Return ONLY a JSON array of objects with keys: " +
      '"id" (string), "description" (string), "context" (string, optional extra detail). ' +
      "No markdown, no explanation.";

    const userMsg =
      `Task: ${task.description}\n` +
      (task.context ? `\nAdditional context:\n${task.context}` : "");

    try {
      const raw = await this._chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        { maxTokens: 1024 },
      );

      const subtasks = JSON.parse(_extractJson(raw));
      if (!Array.isArray(subtasks) || subtasks.length === 0)
        throw new Error("empty");

      this.emit("task:decomposed", { task, subtasks });
      this._log(`Decomposed into ${subtasks.length} subtask(s)`);
      return subtasks;
    } catch (_err) {
      // Fallback: treat whole task as single subtask
      const fallback = [
        { id: "sub-1", description: task.description, context: task.context },
      ];
      this.emit("task:decomposed", { task, subtasks: fallback });
      return fallback;
    }
  }

  /** Dispatch subtasks to the Claude Code pool. */
  async _dispatch(task) {
    this.emit("agents:dispatched", { task, count: task.subtasks.length });
    this._log(
      `Dispatching ${task.subtasks.length} subtask(s) to ${this.cliCommand} agents`,
    );

    const results = await this._router.dispatch(task.subtasks, {
      cwd: task.cwd,
    });
    this.emit("agents:complete", { task, results });
    return results;
  }

  /** Run CI command and retry loop. */
  async _ciLoop(task) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      task.status = TASK_STATUS.CI_CHECKING;
      this.emit("ci:checking", { task, attempt });
      this._log(
        `Running CI (attempt ${attempt + 1}/${this.maxRetries + 1}): ${this.ciCommand}`,
      );

      const ciResult = this._runCI(task.cwd);

      if (ciResult.pass) {
        task.status = TASK_STATUS.CI_PASSED;
        task.completedAt = new Date().toISOString();
        this.emit("ci:pass", { task });
        this._log(`CI passed for task ${task.id}`);

        if (this.notifier.isConfigured && task.notify) {
          await this.notifier.notifySuccess({
            taskId: task.id,
            description: task.description.slice(0, 100),
            agentCount: task.subtasks.length,
            duration: Date.now() - new Date(task.createdAt).getTime(),
            filesChanged: ciResult.filesChanged || [],
          });
        }

        task.status = TASK_STATUS.COMPLETED;
        this.emit("task:complete", task);
        return;
      }

      // CI failed
      task.status = TASK_STATUS.CI_FAILED;
      task.ciErrors = ciResult.errors;
      this.emit("ci:fail", { task, errors: ciResult.errors, attempt });
      this._log(
        `CI failed (attempt ${attempt + 1}): ${ciResult.errors.slice(0, 3).join("; ")}`,
      );

      if (this.notifier.isConfigured && task.notify) {
        await this.notifier.notifyFailure({
          taskId: task.id,
          description: task.description.slice(0, 100),
          errors: ciResult.errors,
          retryNumber: attempt + 1,
        });
      }

      if (attempt >= this.maxRetries) break;

      // Re-dispatch with error context
      task.status = TASK_STATUS.RETRYING;
      task.retries = attempt + 1;
      this.emit("task:retrying", { task, attempt: attempt + 1 });

      const fixSubtasks = task.subtasks.map((st) => ({
        ...st,
        id: `${st.id}-retry${attempt + 1}`,
        context:
          `Previous attempt failed CI. Fix the following errors:\n${ciResult.errors.slice(0, 5).join("\n")}\n\n` +
          `Original task: ${st.description}`,
      }));

      task.agentResults = await this._router.dispatch(fixSubtasks, {
        cwd: task.cwd,
      });
      this.emit("agents:complete", { task, results: task.agentResults });
    }

    // Exhausted retries
    task.status = TASK_STATUS.FAILED;
    task.completedAt = new Date().toISOString();
    task.error = `CI failed after ${this.maxRetries} retries`;
    this.emit("task:failed", { task, error: task.error });
  }

  /** Execute CI command and parse results. */
  _runCI(cwd) {
    try {
      const output = _deps.execSync(this.ciCommand, {
        cwd,
        encoding: "utf-8",
        timeout: 180_000,
        stdio: "pipe",
      });
      return {
        pass: true,
        output,
        errors: [],
        filesChanged: _extractChangedFiles(output),
      };
    } catch (err) {
      const output = (err.stdout || "") + (err.stderr || "");
      const errors = _parseErrors(output);
      return { pass: false, output, errors };
    }
  }

  async _cronTick() {
    this.emit("cron:tick", { at: new Date().toISOString() });
    // Override this method or listen to the event to add input source polling
  }

  _log(msg) {
    if (this.verbose) {
      console.log(`[Orchestrator] ${msg}`);
    }
    this.emit("log", msg);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Extract the first JSON array from an LLM response string. */
function _extractJson(text) {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : "[]";
}

/** Parse error lines from CI output (test failures, lint errors). */
function _parseErrors(output) {
  const lines = output.split("\n");
  const errors = [];
  const errorPatterns = [
    /error:/i,
    /FAIL\s/,
    /✕/,
    /✗/,
    /× /,
    /FAILED/,
    /AssertionError/,
  ];

  for (const line of lines) {
    if (errorPatterns.some((re) => re.test(line)) && line.trim().length > 5) {
      errors.push(line.trim().slice(0, 200));
    }
    if (errors.length >= 20) break;
  }

  return errors.length > 0 ? errors : [output.slice(-500)];
}

/** Extract git-changed files from CI output (best-effort). */
function _extractChangedFiles(output) {
  const matches = output.match(/(?:modified|created|deleted):\s+(\S+)/g) || [];
  return matches.map((m) => m.split(/:\s+/)[1]).filter(Boolean);
}
