/**
 * Cowork Task Runner — executes daily tasks using SubAgentContext.
 *
 * Creates an isolated sub-agent with a template-specific system prompt,
 * runs the agent loop, and yields progress events for WS consumers.
 *
 * @module cowork-task-runner
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { SubAgentContext } from "./sub-agent-context.js";
import { getTemplate } from "./cowork-task-templates.js";

// ─── Dependencies (overridable for testing) ──────────────────────────────────

export const _deps = { existsSync, mkdirSync, appendFileSync };

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
