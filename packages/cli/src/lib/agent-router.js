/**
 * AgentRouter — multi-path agent dispatch.
 *
 * Routes coding subtasks across multiple agent backends in parallel:
 *   - claude     (Claude Code CLI — best for complex reasoning)
 *   - codex      (GitHub Copilot CLI — good for repo context)
 *   - gemini     (Google Gemini via ChainlessChain LLM provider)
 *   - openai     (GPT-4o via ChainlessChain LLM provider)
 *   - ollama     (Local LLM — offline / private)
 *
 * Routing strategies:
 *   round-robin  — distribute evenly across available backends
 *   by-type      — route based on task type keywords
 *   parallel-all — every subtask runs on ALL backends; pick best result
 *   primary      — use first available backend, others as fallback
 *
 * Usage:
 *   const router = new AgentRouter({
 *     backends: [
 *       { type: "claude", weight: 2 },
 *       { type: "gemini", apiKey: "...", model: "gemini-1.5-pro", weight: 1 },
 *     ],
 *     strategy: "round-robin",
 *   });
 *   const results = await router.dispatch(subtasks, { cwd: "/my/project" });
 */

import { EventEmitter } from "events";
import {
  ClaudeCodePool,
  detectClaudeCode,
  detectCodex,
} from "./claude-code-bridge.js";
import { createChatFn } from "./cowork-adapter.js";

// ─── Backend type constants ───────────────────────────────────────
export const BACKEND_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini",
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  OLLAMA: "ollama",
};

// ─── Task type → preferred backend mapping ────────────────────────
const TASK_TYPE_ROUTING = {
  "code-generation": BACKEND_TYPE.CLAUDE,
  "code-review": BACKEND_TYPE.CLAUDE,
  testing: BACKEND_TYPE.CLAUDE,
  documentation: BACKEND_TYPE.OPENAI,
  "data-analysis": BACKEND_TYPE.GEMINI,
  research: BACKEND_TYPE.GEMINI,
};

// Keywords for auto-detecting task type
const TYPE_KEYWORDS = {
  "code-generation": [
    "implement",
    "create",
    "build",
    "add feature",
    "fix",
    "refactor",
  ],
  "code-review": ["review", "audit", "check", "inspect", "analyze"],
  testing: ["test", "spec", "unit test", "e2e", "coverage"],
  documentation: ["document", "readme", "comment", "docstring", "explain"],
  "data-analysis": ["data", "analyze", "statistics", "report", "chart"],
  research: ["research", "investigate", "explore", "compare"],
};

function detectTaskType(description) {
  const lower = description.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return "code-generation";
}

// ─── API-based agent executor ─────────────────────────────────────

/**
 * Execute a task using an LLM API backend (Gemini, GPT, Ollama, etc.)
 * through ChainlessChain's existing llm-providers infrastructure.
 */
async function executeViaAPI(task, options) {
  const { provider, model, apiKey, baseUrl, cwd, timeout = 120_000 } = options;

  const chat = createChatFn({ provider, model, apiKey, baseUrl });

  const systemPrompt =
    "You are an expert software engineer. Implement the requested changes precisely. " +
    "Respond with the complete implementation, file paths, and explanations. " +
    `Working directory: ${cwd}`;

  const startTime = Date.now();
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("LLM API timeout")), timeout),
    );
    const output = await Promise.race([
      chat(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: task.context
              ? `Context:\n${task.context}\n\nTask:\n${task.description}`
              : task.description,
          },
        ],
        { maxTokens: 4096 },
      ),
      timeoutPromise,
    ]);

    return {
      success: true,
      output,
      exitCode: 0,
      duration: Date.now() - startTime,
      agentId: `api-${provider}`,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      exitCode: -1,
      duration: Date.now() - startTime,
      agentId: `api-${provider}`,
      error: err.message,
    };
  }
}

// ─── AgentRouter ──────────────────────────────────────────────────

export class AgentRouter extends EventEmitter {
  /**
   * @param {object} options
   * @param {Array}   options.backends   - Backend configs (see examples above)
   * @param {string}  options.strategy   - "round-robin"|"by-type"|"parallel-all"|"primary"
   * @param {number}  options.maxParallel - Max concurrent agent tasks (default 3)
   */
  constructor(options = {}) {
    super();
    this.strategy = options.strategy || "round-robin";
    this.maxParallel = options.maxParallel || 3;
    this._backends = this._resolveBackends(options.backends || []);
    this._rrIndex = 0; // round-robin cursor
  }

  /**
   * Auto-detect available backends from the environment.
   * Includes CLI tools and API providers based on env vars.
   */
  static autoDetect(options = {}) {
    const backends = [];

    if (detectClaudeCode().found) {
      backends.push({ type: BACKEND_TYPE.CLAUDE, weight: 3 });
    }
    if (detectCodex().found) {
      backends.push({ type: BACKEND_TYPE.CODEX, weight: 2 });
    }
    if (process.env.GEMINI_API_KEY) {
      backends.push({ type: BACKEND_TYPE.GEMINI, weight: 2 });
    }
    if (process.env.OPENAI_API_KEY) {
      backends.push({ type: BACKEND_TYPE.OPENAI, weight: 2 });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      backends.push({ type: BACKEND_TYPE.ANTHROPIC, weight: 2 });
    }
    // Always include Ollama as local fallback
    backends.push({ type: BACKEND_TYPE.OLLAMA, weight: 1 });

    return new AgentRouter({ ...options, backends });
  }

  /**
   * Dispatch subtasks to agent backends according to the routing strategy.
   *
   * @param {Array<{id, description, context?, type?}>} subtasks
   * @param {object} options
   * @param {string} options.cwd
   * @returns {Promise<Array<{taskId, agentId, backendType, success, output, duration}>>}
   */
  async dispatch(subtasks, options = {}) {
    const { cwd = process.cwd() } = options;

    if (this._backends.length === 0) {
      throw new Error(
        "No agent backends available. Install Claude Code: npm i -g @anthropic-ai/claude-code",
      );
    }

    switch (this.strategy) {
      case "parallel-all":
        return this._dispatchParallelAll(subtasks, { cwd });
      case "by-type":
        return this._dispatchByType(subtasks, { cwd });
      case "primary":
        return this._dispatchPrimary(subtasks, { cwd });
      default: // round-robin
        return this._dispatchRoundRobin(subtasks, { cwd });
    }
  }

  // ─── Strategies ────────────────────────────────────────────────

  /** Round-robin: distribute tasks evenly across all backends. */
  async _dispatchRoundRobin(subtasks, { cwd }) {
    // Assign each subtask a backend
    const assignments = subtasks.map((task) => {
      const backend = this._weightedNext();
      return { task, backend };
    });

    return this._runAssignments(assignments, { cwd });
  }

  /** By-type: route task to the best backend for its type. */
  async _dispatchByType(subtasks, { cwd }) {
    const assignments = subtasks.map((task) => {
      const taskType = task.type || detectTaskType(task.description);
      const preferredType = TASK_TYPE_ROUTING[taskType];
      const backend = this._findBackend(preferredType) || this._weightedNext();
      return { task, backend };
    });

    return this._runAssignments(assignments, { cwd });
  }

  /** Primary: all tasks go to first backend; fallback on failure. */
  async _dispatchPrimary(subtasks, { cwd }) {
    const primary = this._backends[0];
    const assignments = subtasks.map((task) => ({ task, backend: primary }));
    const results = await this._runAssignments(assignments, { cwd });

    // Retry failed tasks on next available backend
    const retries = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].success && this._backends.length > 1) {
        const fallback = this._backends[1];
        retries.push(
          this._runSingleTask(subtasks[i], fallback, { cwd }).then((r) => {
            results[i] = r;
          }),
        );
      }
    }
    await Promise.all(retries);
    return results;
  }

  /** Parallel-all: run every task on ALL backends; return best result per task. */
  async _dispatchParallelAll(subtasks, { cwd }) {
    const results = [];
    for (const task of subtasks) {
      const allResults = await Promise.all(
        this._backends.map((backend) =>
          this._runSingleTask(task, backend, { cwd }),
        ),
      );
      // Pick the first successful result; if all fail, pick the first
      const best = allResults.find((r) => r.success) || allResults[0];
      best.allResults = allResults; // attach all results for inspection
      results.push(best);
    }
    return results;
  }

  // ─── Execution ─────────────────────────────────────────────────

  async _runAssignments(assignments, { cwd }) {
    const results = new Array(assignments.length);

    // Process in parallel batches
    for (let i = 0; i < assignments.length; i += this.maxParallel) {
      const batch = assignments.slice(i, i + this.maxParallel);
      const batchResults = await Promise.all(
        batch.map(({ task, backend }) =>
          this._runSingleTask(task, backend, { cwd }),
        ),
      );
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  async _runSingleTask(task, backend, { cwd }) {
    this.emit("agent:start", { taskId: task.id, backend: backend.type });

    let result;
    if (backend.isCLI) {
      // Use ClaudeCodePool for CLI-based backends
      const pool = backend._pool;
      const [r] = await pool.dispatch([task], { cwd });
      result = r;
    } else {
      // Use LLM API for API-based backends
      result = await executeViaAPI(task, {
        provider: backend.provider,
        model: backend.model,
        apiKey: backend.apiKey,
        baseUrl: backend.baseUrl,
        cwd,
        timeout: backend.timeout,
      });
    }

    result.taskId = task.id;
    result.backendType = backend.type;

    this.emit("agent:complete", result);
    return result;
  }

  // ─── Backend resolution ─────────────────────────────────────────

  _resolveBackends(configs) {
    return configs.map((cfg) => {
      const type = cfg.type || BACKEND_TYPE.CLAUDE;

      if (type === BACKEND_TYPE.CLAUDE || type === BACKEND_TYPE.CODEX) {
        const pool = new ClaudeCodePool({
          maxParallel: 1,
          cliCommand: type === BACKEND_TYPE.CODEX ? "codex" : "claude",
          model: cfg.model || null,
        });
        pool.on("agent:output", (ev) => this.emit("agent:output", ev));
        return {
          type,
          isCLI: true,
          weight: cfg.weight || 1,
          _pool: pool,
          timeout: cfg.timeout || 300_000,
        };
      }

      // API-based backend
      const providerMap = {
        [BACKEND_TYPE.GEMINI]: "gemini",
        [BACKEND_TYPE.OPENAI]: "openai",
        [BACKEND_TYPE.ANTHROPIC]: "anthropic",
        [BACKEND_TYPE.OLLAMA]: "ollama",
      };

      return {
        type,
        isCLI: false,
        weight: cfg.weight || 1,
        provider: providerMap[type] || type,
        model: cfg.model || null,
        apiKey: cfg.apiKey || null,
        baseUrl: cfg.baseUrl || null,
        timeout: cfg.timeout || 120_000,
      };
    });
  }

  /** Find the first backend matching a given type. */
  _findBackend(type) {
    return this._backends.find((b) => b.type === type) || null;
  }

  /** Pick next backend using weighted round-robin. */
  _weightedNext() {
    if (this._backends.length === 0) throw new Error("No backends");
    if (this._backends.length === 1) return this._backends[0];

    // Build weighted list
    const weighted = [];
    for (const b of this._backends) {
      for (let i = 0; i < (b.weight || 1); i++) weighted.push(b);
    }

    const backend = weighted[this._rrIndex % weighted.length];
    this._rrIndex++;
    return backend;
  }

  /** Summary of all configured backends. */
  summary() {
    return this._backends.map((b) => ({
      type: b.type,
      kind: b.isCLI ? "cli" : "api",
      provider: b.provider || b.type,
      weight: b.weight,
    }));
  }
}
