/**
 * Cowork Task Runner — executes daily tasks using SubAgentContext.
 *
 * Creates an isolated sub-agent with a template-specific system prompt,
 * runs the agent loop, and yields progress events for WS consumers.
 *
 * @module cowork-task-runner
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SubAgentContext } from "./sub-agent-context.js";
import { getTemplate } from "./cowork-task-templates.js";
import { mountTemplateMcpTools } from "./cowork-mcp-tools.js";

// ─── Dependencies (overridable for testing) ──────────────────────────────────

export const _deps = { existsSync, mkdirSync, appendFileSync, readFileSync };

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_TOKEN_BUDGET = 100_000;

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run a cowork task using SubAgentContext.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Template ID (null = free mode)
 * @param {string} options.userMessage - User's task description
 * @param {string[]} [options.files] - File paths provided by user
 * @param {string} [options.cwd] - Working directory
 * @param {object} [options.db] - Database instance
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {number} [options.maxIterations] - Override iteration limit
 * @param {number} [options.tokenBudget] - Override token budget
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTask(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    db = null,
    llmOptions = {},
    maxIterations = DEFAULT_MAX_ITERATIONS,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    onProgress = null,
    signal = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  // Validate file paths before starting
  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  // Resolve template
  const template = getTemplate(templateId);

  // Build the task prompt with template context + files
  const taskParts = [template.systemPromptExtension];

  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }

  const task = taskParts.join("\n");

  // Mount template-declared MCP servers (best-effort, failures are tolerated)
  const mcp = await mountTemplateMcpTools(template, {
    onWarn: (msg) => {
      if (onProgress) onProgress({ type: "mcp-warning", message: msg });
    },
  });
  if (onProgress && (mcp.mounted.length > 0 || mcp.skipped.length > 0)) {
    onProgress({
      type: "mcp-mounted",
      mounted: mcp.mounted,
      skipped: mcp.skipped.map((s) => s.name),
      toolCount: mcp.extraToolDefinitions.length,
    });
  }

  // Create isolated sub-agent context
  const subAgent = SubAgentContext.create({
    role: `cowork-${template.id}`,
    task,
    inheritedContext: null,
    maxIterations,
    tokenBudget,
    db,
    llmOptions,
    cwd,
    onProgress,
    signal,
    extraToolDefinitions: mcp.extraToolDefinitions,
    externalToolDescriptors: mcp.externalToolDescriptors,
    externalToolExecutors: mcp.externalToolExecutors,
    mcpClient: mcp.mcpClient,
  });

  const taskId = subAgent.id;

  // Build loop options — pass shell policy overrides if template declares them
  const loopOptions = {};
  if (
    Array.isArray(template.shellPolicyOverrides) &&
    template.shellPolicyOverrides.length
  ) {
    loopOptions.shellPolicyOverrides = template.shellPolicyOverrides;
  }

  // Run the agent with the user's message
  try {
    const result = await subAgent.run(userMessage, loopOptions);
    const entry = {
      taskId,
      status: subAgent.status,
      templateId: template.id,
      templateName: template.name,
      result,
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      result: {
        summary: `Task failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } finally {
    await mcp.cleanup();
  }
}

// ─── Parallel Runner (Orchestrator) ──────────────────────────────────────────

/**
 * Run a cowork task using the Orchestrator for multi-agent parallel execution.
 *
 * @param {object} options - Same as runCoworkTask, plus:
 * @param {number} [options.agents] - Number of parallel agents (default 3, max 10)
 * @param {string} [options.strategy] - Routing strategy (default "round-robin")
 * @param {function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTaskParallel(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    agents = 3,
    strategy,
    onProgress = null,
    signal = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);

  // Build full task description for the orchestrator
  const taskParts = [
    `[Cowork Template: ${template.name}]`,
    template.systemPromptExtension,
    `\n## 用户需求\n${userMessage}`,
  ];
  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }
  const fullTask = taskParts.join("\n");

  try {
    const { Orchestrator, TASK_SOURCE } = await import("./orchestrator.js");

    const orch = new Orchestrator({
      cwd,
      maxParallel: Math.min(parseInt(agents, 10) || 3, 10),
      ciCommand: "echo ok",
      agents: strategy ? { strategy } : undefined,
      verbose: false,
    });

    // Wire progress events
    if (onProgress) {
      orch.on("task:added", (t) =>
        onProgress({
          type: "orchestrator-started",
          taskId: t.id,
          subtaskCount: 0,
        }),
      );
      orch.on("task:decomposed", (t) =>
        onProgress({
          type: "orchestrator-decomposed",
          taskId: t.id,
          subtaskCount: t.subtasks?.length || 0,
        }),
      );
      orch.on("agents:dispatched", (ev) =>
        onProgress({
          type: "agents-dispatched",
          agentCount: ev.agents?.length || 0,
        }),
      );
      orch.on("agent:output", (ev) =>
        onProgress({
          type: "agent-progress",
          agentIndex: ev.agentIndex,
          status: ev.status,
          output: ev.output?.slice(0, 200),
        }),
      );
    }

    // Handle cancellation
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          orch.stopCronWatch();
        },
        { once: true },
      );
    }

    const orchResult = await orch.addTask(fullTask, {
      source: TASK_SOURCE.CLI,
      cwd,
      runCI: false,
      notify: false,
    });

    const entry = {
      taskId: orchResult.id,
      status: orchResult.status === "completed" ? "completed" : "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      agentCount: agents,
      result: {
        summary:
          orchResult.agentResults
            ?.map((r) => r.output?.slice(0, 500))
            .join("\n---\n") || "Parallel execution completed",
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: orchResult.retries || 0,
        subtaskCount: orchResult.subtasks?.length || 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId: `cowork-parallel-${Date.now()}`,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      result: {
        summary: `Parallel task failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
        subtaskCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── Debate Runner (Multi-perspective Review) ───────────────────────────────

/**
 * Run a cowork task in debate mode — multiple reviewer perspectives converge
 * into a final verdict via moderator synthesis.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Should be "code-review" or null
 * @param {string} options.userMessage - Target description / review instructions
 * @param {string[]} [options.files] - File paths to review (concatenated as code body)
 * @param {string[]} [options.perspectives] - Override template perspectives
 * @param {string} [options.cwd] - Working directory for history
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<{ taskId, status, result }>}
 */
export async function runCoworkDebate(options = {}) {
  const {
    templateId = "code-review",
    userMessage,
    files = [],
    perspectives,
    cwd = process.cwd(),
    llmOptions = {},
    onProgress = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);
  const reviewPerspectives = perspectives ||
    template.debatePerspectives || [
      "performance",
      "security",
      "maintainability",
    ];

  // Build code body from files (or from userMessage if no files provided)
  let code = "";
  if (files.length > 0) {
    const chunks = files.map((f) => {
      try {
        return `// ===== ${f} =====\n${_deps.readFileSync(f, "utf-8")}`;
      } catch (err) {
        return `// ===== ${f} (read error: ${err.message}) =====`;
      }
    });
    code = chunks.join("\n\n");
  } else {
    code = userMessage;
  }

  const taskId = `cowork-debate-${Date.now()}`;

  if (onProgress) {
    onProgress({ type: "debate-started", perspectives: reviewPerspectives });
  }

  try {
    const { startDebate } = await import("./cowork/debate-review-cli.js");
    const debateResult = await startDebate({
      target: userMessage,
      code,
      perspectives: reviewPerspectives,
      llmOptions,
    });

    if (onProgress) {
      onProgress({ type: "debate-completed", verdict: debateResult.verdict });
    }

    const entry = {
      taskId,
      status: "completed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: debateResult.summary,
        verdict: debateResult.verdict,
        consensusScore: debateResult.consensusScore,
        reviews: debateResult.reviews,
        perspectives: debateResult.perspectives,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: debateResult.reviews.length + 1,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: `Debate failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── History Persistence ─────────────────────────────────────────────────────

function _appendHistory(cwd, entry, userMessage) {
  try {
    const histDir = join(cwd, ".chainlesschain", "cowork");
    _deps.mkdirSync(histDir, { recursive: true });
    const record = {
      ...entry,
      userMessage,
      timestamp: new Date().toISOString(),
    };
    _deps.appendFileSync(
      join(histDir, "history.jsonl"),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch (_e) {
    // Best-effort — don't fail the task for history write errors
  }
}
