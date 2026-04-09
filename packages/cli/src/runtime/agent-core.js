/**
 * Agent Core — transport-independent agentic logic
 *
 * Canonical location (Phase 6b of the CLI Runtime Convergence roadmap,
 * 2026-04-09). Previously lived at `../lib/agent-core.js`; that path is
 * retained as an `@deprecated` re-export shim for backwards compatibility.
 *
 * Key exports:
 *  - AGENT_TOOLS          — OpenAI function-calling tool definitions
 *  - getBaseSystemPrompt  — system prompt generator
 *  - executeTool          — tool execution with plan-mode + hook pipeline
 *  - chatWithTools        — LLM call with tool definitions injected
 *  - agentLoop            — async generator yielding structured events
 *  - formatToolArgs       — human-readable tool argument formatting
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";
import sharedCodingAgentPolicy from "./coding-agent-policy.cjs";
import sharedShellPolicy from "./coding-agent-shell-policy.cjs";
import { getPlanModeManager } from "../lib/plan-mode.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import { executeHooks, HookEvents } from "../lib/hook-manager.js";
import { detectPython } from "../lib/cli-anything-bridge.js";
import { findProjectRoot, loadProjectConfig } from "../lib/project-detector.js";
import { SubAgentContext } from "../lib/sub-agent-context.js";
import {
  createLegacyAgentToolRegistry,
  getRuntimeToolDescriptorByCommand,
  getRuntimeToolDescriptor,
} from "../tools/legacy-agent-tools.js";
import {
  getCodingAgentFunctionToolDefinitions,
  listCodingAgentToolNames,
} from "./coding-agent-contract.js";
import { createToolContext } from "../tools/tool-context.js";
import { createToolTelemetryRecord } from "../tools/tool-telemetry.js";
import { isAbortError, throwIfAborted } from "../lib/abort-utils.js";
import {
  annotateLines,
  replaceByHash,
  snippetAround,
} from "../lib/hashline.js";
import {
  mountSkillMcpServers,
  unmountSkillMcpServers,
} from "../lib/skill-mcp.js";

const { isReadOnlyGitCommand, normalizeGitCommand } = sharedCodingAgentPolicy;
const { evaluateShellCommandPolicy } = sharedShellPolicy;

// ─── Tool definitions ────────────────────────────────────────────────────

export const AGENT_TOOLS = getCodingAgentFunctionToolDefinitions();

const STATIC_AGENT_TOOL_NAMES = new Set(listCodingAgentToolNames());

export const AGENT_TOOL_REGISTRY = createLegacyAgentToolRegistry(AGENT_TOOLS);

function mergeToolDefinitions(baseTools = [], extraTools = []) {
  const merged = new Map();

  for (const tool of [...baseTools, ...extraTools]) {
    const name = tool?.function?.name;
    if (!name) continue;
    merged.set(name, tool);
  }

  return Array.from(merged.values());
}

export function getAgentToolDefinitions({
  names = null,
  disabledTools = [],
  extraTools = [],
} = {}) {
  const allowedNames =
    Array.isArray(names) && names.length > 0 ? new Set(names) : null;
  const disabledNames = new Set(
    Array.isArray(disabledTools) ? disabledTools : [],
  );
  const extraToolNames = new Set(
    (Array.isArray(extraTools) ? extraTools : [])
      .map((tool) => tool?.function?.name)
      .filter(Boolean),
  );
  const allTools = mergeToolDefinitions(
    AGENT_TOOLS,
    Array.isArray(extraTools) ? extraTools : [],
  );

  return allTools.filter((tool) => {
    const name = tool?.function?.name;
    if (!name) return false;
    if (allowedNames && !allowedNames.has(name) && !extraToolNames.has(name)) {
      return false;
    }
    if (disabledNames.has(name)) return false;
    return true;
  });
}

export function getAgentToolDescriptors(options = {}) {
  const allowedNames = new Set(
    getAgentToolDefinitions(options).map((tool) => tool.function.name),
  );
  return AGENT_TOOL_REGISTRY.list({ enabledOnly: options.enabledOnly }).filter(
    (descriptor) => allowedNames.has(descriptor.name),
  );
}

// ─── Shared skill loader ──────────────────────────────────────────────────

const _defaultSkillLoader = new CLISkillLoader();

// ─── Cached environment detection ────────────────────────────────────────

let _cachedPython = null;
let _cachedEnvInfo = null;

/**
 * Get cached Python interpreter info (reuses cli-anything-bridge detection).
 * @returns {{ found: boolean, command?: string, version?: string }}
 */
export function getCachedPython() {
  if (!_cachedPython) {
    _cachedPython = detectPython();
  }
  return _cachedPython;
}

/**
 * Gather environment info (cached once per process).
 * @returns {{ os: string, arch: string, python: string|null, pip: boolean, node: string|null, git: boolean }}
 */
export function getEnvironmentInfo() {
  if (_cachedEnvInfo) return _cachedEnvInfo;

  const py = getCachedPython();

  let pipAvailable = false;
  if (py.found) {
    try {
      execSync(`${py.command} -m pip --version`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      pipAvailable = true;
    } catch {
      // pip not available
    }
  }

  let nodeVersion = null;
  try {
    nodeVersion = execSync("node --version", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    // Node not available (unlikely since we're running in Node)
  }

  let gitAvailable = false;
  try {
    execSync("git --version", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitAvailable = true;
  } catch {
    // git not available
  }

  _cachedEnvInfo = {
    os: process.platform,
    arch: process.arch,
    python: py.found ? `${py.command} (${py.version})` : null,
    pip: pipAvailable,
    node: nodeVersion,
    git: gitAvailable,
  };
  return _cachedEnvInfo;
}

// ─── System prompt ────────────────────────────────────────────────────────

export function getBaseSystemPrompt(cwd) {
  const env = getEnvironmentInfo();
  const envLines = [
    `OS: ${env.os} (${env.arch})`,
    env.python
      ? `Python: ${env.python}${env.pip ? " + pip" : ""}`
      : "Python: not found",
    env.node ? `Node.js: ${env.node}` : "Node.js: not found",
    `Git: ${env.git ? "available" : "not found"}`,
  ];

  return `You are ChainlessChain AI Assistant, a powerful agentic coding assistant running in the terminal.

You have access to tools that let you read files, write files, edit files, run shell commands, and search the codebase. When the user asks you to do something, USE THE TOOLS to actually do it — don't just describe what should be done.

Key behaviors:
- When asked to modify code, read the file first, then edit it
- When asked to create something, use write_file to create it
- When asked to run/test something, use run_shell to execute it
- When asked about git status, diff, log, or other repository operations, use the git tool instead of run_shell
- When asked about files or code, use read_file and search_files to find information
- You have multi-layer skills (built-in, marketplace, global, project-level) — use list_skills to discover them and run_skill to execute them
- Always explain what you're doing and show results
- Be concise but thorough

When the user's problem involves data processing, calculations, file operations, text parsing, API calls, web scraping, or any task that can be solved programmatically:
- Proactively write and execute code using run_code tool
- Choose the best language: Python for data/math/scraping, Node.js for JSON/API, Bash for system tasks
- Missing Python packages are auto-installed via pip when import errors are detected
- Scripts are persisted in .chainlesschain/agent-scripts/ for reference
- Show the results and explain them clearly
- If the first attempt fails, debug and retry with a different approach

You are not just a chatbot — you are a capable coding agent. Think step by step, write code when needed, and deliver real results.

## Sub-Agent Isolation
When a task involves multiple distinct roles (e.g. code review + code generation), or when you need
focused analysis without polluting your current context, use the spawn_sub_agent tool. Examples:
- Code review as a separate perspective while you're implementing
- Summarizing a large file before incorporating it into your response
- Running a focused analysis (security, performance) on specific code
- Translating or reformatting content independently
The sub-agent has its own message history and only returns a summary — your context stays clean.
Do NOT spawn sub-agents for trivial tasks that you can handle directly.

## Environment
${envLines.join("\n")}

Current working directory: ${cwd || process.cwd()}`;
}

// ─── Persona support ─────────────────────────────────────────────────────

/**
 * Load persona configuration from project config.json
 * @param {string} cwd - working directory
 * @returns {object|null} persona object or null
 */
function _loadProjectPersona(cwd) {
  try {
    const projectRoot = findProjectRoot(cwd || process.cwd());
    if (!projectRoot) return null;
    const config = loadProjectConfig(projectRoot);
    return config?.persona || null;
  } catch {
    return null;
  }
}

/**
 * Build a persona-specific system prompt
 * @param {object} persona - persona configuration
 * @param {string[]} envLines - environment info lines
 * @param {string} cwd - working directory
 * @returns {string}
 */
function _buildPersonaPrompt(persona, envLines, cwd) {
  const lines = [];
  lines.push(`You are ${persona.name || "AI Assistant"}.`);
  if (persona.role) {
    lines.push("");
    lines.push(persona.role);
  }
  if (persona.behaviors?.length > 0) {
    lines.push("");
    lines.push("Key behaviors:");
    for (const b of persona.behaviors) {
      lines.push(`- ${b}`);
    }
  }
  lines.push("");
  lines.push(
    "You have access to tools that let you read files, write files, edit files, run shell commands, and search the codebase. When the user asks you to do something, USE THE TOOLS to actually do it.",
  );
  if (persona.toolsPriority?.length > 0) {
    lines.push(`\nPreferred tools: ${persona.toolsPriority.join(", ")}`);
  }
  lines.push(`\n## Environment\n${envLines.join("\n")}`);
  lines.push(`\nCurrent working directory: ${cwd || process.cwd()}`);
  return lines.join("\n");
}

/**
 * Build the full system prompt with persona, rules.md, and auto-activated persona skills.
 * Single entry point used by both agent-repl and ws-session-manager.
 *
 * Priority order:
 *  1. config.json persona → replaces base system prompt
 *  2. Auto-activated persona skills → appended
 *  3. rules.md → appended
 *  4. Default hardcoded prompt → fallback when no persona
 *
 * @param {string} [cwd] - working directory
 * @returns {string} complete system prompt
 */
export function buildSystemPrompt(cwd) {
  const dir = cwd || process.cwd();

  // Check for project persona
  const persona = _loadProjectPersona(dir);
  let prompt;
  if (persona) {
    const env = getEnvironmentInfo();
    const envLines = [
      `OS: ${env.os} (${env.arch})`,
      env.python
        ? `Python: ${env.python}${env.pip ? " + pip" : ""}`
        : "Python: not found",
      env.node ? `Node.js: ${env.node}` : "Node.js: not found",
      `Git: ${env.git ? "available" : "not found"}`,
    ];
    prompt = _buildPersonaPrompt(persona, envLines, dir);
  } else {
    prompt = getBaseSystemPrompt(dir);
  }

  // Append auto-activated persona skills
  try {
    const loader = new CLISkillLoader();
    const allSkills = loader.getResolvedSkills();
    const personaSkills = allSkills.filter(
      (s) => s.category === "persona" && s.activation === "auto",
    );
    for (const p of personaSkills) {
      if (p.body?.trim()) {
        prompt += `\n\n## Persona: ${p.displayName}\n${p.body}`;
      }
    }
  } catch {
    // Non-critical — skill loader may not be available
  }

  // Append rules.md
  try {
    const projectRoot = findProjectRoot(dir);
    if (projectRoot) {
      const rulesPath = path.join(projectRoot, ".chainlesschain", "rules.md");
      if (fs.existsSync(rulesPath)) {
        const content = fs.readFileSync(rulesPath, "utf-8");
        if (content.trim()) {
          prompt += `\n\n## Project Rules\n${content}`;
        }
      }
    }
  } catch {
    // Non-critical
  }

  return prompt;
}

// ─── Tool execution ──────────────────────────────────────────────────────

/**
 * Execute a single tool call with plan-mode filtering and hook pipeline.
 *
 * @param {string} name - tool name
 * @param {object} args - tool arguments
 * @param {object} [context] - optional context
 * @param {object} [context.hookDb] - DB for hooks
 * @param {CLISkillLoader} [context.skillLoader] - skill loader instance
 * @param {string} [context.cwd] - working directory override
 * @returns {Promise<object>} tool result
 */
export async function executeTool(name, args, context = {}) {
  const hookDb = context.hookDb || null;
  const skillLoader = context.skillLoader || _defaultSkillLoader;
  const cwd = context.cwd || process.cwd();
  const planManager = context.planManager || getPlanModeManager();
  const localToolDescriptor =
    context.externalToolDescriptors &&
    typeof context.externalToolDescriptors === "object"
      ? context.externalToolDescriptors[name] || null
      : null;
  const runtimeDescriptor =
    getRuntimeToolDescriptor(name) || localToolDescriptor;
  const toolContext = createToolContext({
    toolName: runtimeDescriptor?.name || name,
    cwd,
    metadata: { descriptor: runtimeDescriptor },
  });

  // Persona toolsDisabled guard
  const persona = _loadProjectPersona(cwd);
  if (persona?.toolsDisabled?.includes(name)) {
    return {
      error: `Tool "${name}" is disabled by project persona configuration.`,
    };
  }

  const toolPolicies =
    context.hostManagedToolPolicy?.tools ||
    context.hostManagedToolPolicy?.toolPolicies ||
    null;
  const hostToolPolicy =
    toolPolicies && typeof toolPolicies === "object"
      ? toolPolicies[name]
      : null;
  const isExternalHostTool =
    hostToolPolicy && !STATIC_AGENT_TOOL_NAMES.has(name);
  const isExternalLocalTool =
    localToolDescriptor && !STATIC_AGENT_TOOL_NAMES.has(name);
  const hostPolicyAllowsReadOnlyGit =
    name === "git" &&
    hostToolPolicy?.planModeBehavior === "readonly-conditional" &&
    isReadOnlyGitCommand(args.command);
  const localReadOnlyAllowedInPlanMode =
    isExternalLocalTool &&
    planManager.isActive() &&
    localToolDescriptor?.isReadOnly === true;
  if (
    hostToolPolicy &&
    hostToolPolicy.allowed === false &&
    !hostPolicyAllowsReadOnlyGit
  ) {
    return {
      error: `[Host Policy] Tool "${name}" is blocked by desktop host policy. ${hostToolPolicy.reason || "Desktop approval has not been synchronized yet."}`,
      policy: {
        decision: hostToolPolicy.decision || "blocked",
        requiresPlanApproval: hostToolPolicy.requiresPlanApproval === true,
        requiresConfirmation: hostToolPolicy.requiresConfirmation === true,
        riskLevel: hostToolPolicy.riskLevel || null,
      },
    };
  }

  // Plan mode: check if tool is allowed
  if (
    planManager.isActive() &&
    !(name === "git" && isReadOnlyGitCommand(args.command)) &&
    !planManager.isToolAllowed(name) &&
    !(isExternalHostTool && hostToolPolicy?.allowed === true) &&
    !localReadOnlyAllowedInPlanMode
  ) {
    planManager.addPlanItem({
      title: `${name}: ${formatToolArgs(name, args)}`,
      tool: name,
      params: args,
      estimatedImpact:
        name === "run_shell" ||
        name === "run_code" ||
        name === "git" ||
        localToolDescriptor?.riskLevel === "high"
          ? "high"
          : name === "write_file" || localToolDescriptor?.riskLevel === "medium"
            ? "medium"
            : "low",
    });
    return {
      error: `[Plan Mode] Tool "${name}" is blocked during planning. It has been added to the plan. Use /plan approve to execute.`,
    };
  }

  // PreToolUse hook
  if (hookDb) {
    try {
      await executeHooks(hookDb, HookEvents.PreToolUse, {
        tool: name,
        args,
        timestamp: new Date().toISOString(),
        descriptor: runtimeDescriptor,
        context: toolContext,
      });
    } catch (_err) {
      // Hook failure should not block tool execution
    }
  }

  const startTime = Date.now();
  let toolResult;
  try {
    toolResult = await executeToolInner(name, args, {
      skillLoader,
      cwd,
      parentMessages: context.parentMessages,
      interaction: context.interaction,
      sessionId: context.sessionId || null,
      hostManagedToolPolicy: context.hostManagedToolPolicy || null,
      externalToolDescriptors: context.externalToolDescriptors || null,
      externalToolExecutors: context.externalToolExecutors || null,
      mcpClient: context.mcpClient || null,
    });
  } catch (err) {
    if (hookDb) {
      try {
        await executeHooks(hookDb, HookEvents.ToolError, {
          tool: name,
          args,
          error: err.message,
        });
      } catch (_err) {
        // Non-critical
      }
    }
    throw err;
  }

  const durationMs = Date.now() - startTime;
  const status = toolResult?.error ? "error" : "completed";
  const telemetryRecord = createToolTelemetryRecord({
    descriptor: runtimeDescriptor,
    status,
    durationMs,
    sessionId: context.sessionId || null,
    metadata: { args },
  });
  if (toolResult && typeof toolResult === "object") {
    toolResult.toolTelemetryRecord = telemetryRecord;
  }

  // PostToolUse hook
  if (hookDb) {
    try {
      await executeHooks(hookDb, HookEvents.PostToolUse, {
        tool: name,
        args,
        result:
          typeof toolResult === "object"
            ? JSON.stringify(toolResult).substring(0, 500)
            : String(toolResult).substring(0, 500),
        descriptor: runtimeDescriptor,
        context: toolContext,
      });
    } catch (_err) {
      // Non-critical
    }
  }

  return toolResult;
}

/**
 * Inner tool execution — no hooks, no plan-mode checks.
 */
async function executeToolInner(
  name,
  args,
  {
    skillLoader,
    cwd,
    parentMessages,
    interaction,
    sessionId,
    hostManagedToolPolicy,
    externalToolDescriptors,
    externalToolExecutors,
    mcpClient,
  },
) {
  const localToolDescriptor =
    externalToolDescriptors && typeof externalToolDescriptors === "object"
      ? externalToolDescriptors[name] || null
      : null;
  const runtimeDescriptor =
    getRuntimeToolDescriptor(name) || localToolDescriptor;
  const hostToolPolicies =
    hostManagedToolPolicy?.tools || hostManagedToolPolicy?.toolPolicies || null;
  const hostToolPolicy =
    hostToolPolicies && typeof hostToolPolicies === "object"
      ? hostToolPolicies[name]
      : null;
  const hostToolDefinition = Array.isArray(
    hostManagedToolPolicy?.toolDefinitions,
  )
    ? hostManagedToolPolicy.toolDefinitions.find(
        (tool) => tool?.function?.name === name,
      ) || null
    : null;
  const buildPayload = (descriptor) =>
    descriptor
      ? {
          name: descriptor.name,
          kind: descriptor.kind || descriptor.category || descriptor.source,
          category: descriptor.category,
        }
      : null;
  const descriptorPayload = buildPayload(runtimeDescriptor);
  const attachDescriptor = (payload, overrideDescriptor = null) => {
    const descriptor = buildPayload(overrideDescriptor || runtimeDescriptor);
    return descriptor ? { ...payload, toolDescriptor: descriptor } : payload;
  };
  const localToolExecutor =
    externalToolExecutors && typeof externalToolExecutors === "object"
      ? externalToolExecutors[name] || null
      : null;
  switch (name) {
    case "read_file": {
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `File not found: ${filePath}` });
      }
      const content = fs.readFileSync(filePath, "utf8");
      // Hashline mode: prefix each line with a 6-char content hash tag
      // so downstream edit_file_hashed calls can anchor by hash.
      const rendered = args.hashed === true ? annotateLines(content) : content;
      if (rendered.length > 50000) {
        return attachDescriptor({
          content: rendered.substring(0, 50000) + "\n...(truncated)",
          size: rendered.length,
          hashed: args.hashed === true,
        });
      }
      return attachDescriptor({
        content: rendered,
        hashed: args.hashed === true,
      });
    }

    case "write_file": {
      const filePath = path.resolve(cwd, args.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, args.content, "utf8");
      return attachDescriptor({
        success: true,
        path: filePath,
        size: args.content.length,
      });
    }

    case "edit_file": {
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `File not found: ${filePath}` });
      }
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes(args.old_string)) {
        return attachDescriptor({ error: "old_string not found in file" });
      }
      const newContent = content.replace(args.old_string, args.new_string);
      fs.writeFileSync(filePath, newContent, "utf8");
      return attachDescriptor({ success: true, path: filePath });
    }

    case "edit_file_hashed": {
      // Hash-anchored edit (v5.0.2.9, inspired by oh-my-openagent).
      // Reference a line by its content hash rather than line number or
      // exact string — robust against whitespace drift and concurrent edits.
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `File not found: ${filePath}` });
      }
      if (!args.anchor_hash || typeof args.anchor_hash !== "string") {
        return attachDescriptor({
          error: "anchor_hash is required",
          hint: "Read the file with hashed:true to get line hashes",
        });
      }
      if (typeof args.new_line !== "string") {
        return attachDescriptor({ error: "new_line must be a string" });
      }
      const original = fs.readFileSync(filePath, "utf8");
      const result = replaceByHash(original, {
        anchorHash: args.anchor_hash,
        expectedLine: args.expected_line,
        newLine: args.new_line,
      });
      if (!result.success) {
        // Self-healing hint: include a fresh annotated snippet when possible
        const snippet =
          result.error === "ambiguous_anchor" && result.matches?.[0]
            ? snippetAround(original, result.matches[0].lineNumber - 1)
            : null;
        return attachDescriptor({
          error: result.error,
          message: result.message,
          hint: result.hint,
          ...(result.matches && { matches: result.matches }),
          ...(result.current && { current: result.current }),
          ...(result.expected && { expected: result.expected }),
          ...(snippet && { current_snippet: snippet }),
        });
      }
      fs.writeFileSync(filePath, result.content, "utf8");
      return attachDescriptor({
        success: true,
        path: filePath,
        lineNumber: result.lineNumber,
        previousContent: result.previousContent,
      });
    }

    case "run_shell": {
      const shellPolicy = evaluateShellCommandPolicy(args.command);
      const override = getRuntimeToolDescriptorByCommand(args.command);
      if (!shellPolicy.allowed) {
        return attachDescriptor(
          {
            error: `[Shell Policy] ${shellPolicy.reason}`,
            shellCommandPolicy: shellPolicy,
          },
          override || runtimeDescriptor,
        );
      }

      try {
        const output = execSync(args.command, {
          cwd: args.cwd || cwd,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        return attachDescriptor(
          {
            stdout: output.substring(0, 30000),
            shellCommandPolicy: shellPolicy,
          },
          override || runtimeDescriptor,
        );
      } catch (err) {
        return attachDescriptor(
          {
            error: err.message.substring(0, 2000),
            stderr: (err.stderr || "").substring(0, 2000),
            exitCode: err.status,
            shellCommandPolicy: shellPolicy,
          },
          override || runtimeDescriptor,
        );
      }
    }

    case "git": {
      const normalizedCommand = normalizeGitCommand(args.command);
      if (!normalizedCommand) {
        return attachDescriptor({
          error: "Git command is required.",
        });
      }

      try {
        const output = execSync(`git ${normalizedCommand}`, {
          cwd: args.cwd || cwd,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        return attachDescriptor({
          stdout: output.substring(0, 30000),
          command: normalizedCommand,
          readOnly: isReadOnlyGitCommand(normalizedCommand),
        });
      } catch (err) {
        return attachDescriptor({
          error: err.message.substring(0, 2000),
          stderr: (err.stderr || "").substring(0, 2000),
          exitCode: err.status,
          command: normalizedCommand,
          readOnly: isReadOnlyGitCommand(normalizedCommand),
        });
      }
    }

    case "run_code": {
      return attachDescriptor(await _executeRunCode(args, cwd));
    }

    case "spawn_sub_agent": {
      return attachDescriptor(
        await _executeSpawnSubAgent(args, {
          skillLoader,
          cwd,
          parentMessages,
          interaction,
          sessionId,
        }),
      );
    }

    case "search_files": {
      const dir = args.directory ? path.resolve(cwd, args.directory) : cwd;
      try {
        if (args.content_search) {
          const cmd =
            process.platform === "win32"
              ? `findstr /s /i /n "${args.pattern}" *`
              : `grep -r -l -i "${args.pattern}" . --include="*" 2>/dev/null | head -20`;
          const output = execSync(cmd, {
            cwd: dir,
            encoding: "utf8",
            timeout: 10000,
          });
          return attachDescriptor({
            matches: output.trim().split("\n").slice(0, 20),
          });
        } else {
          const cmd =
            process.platform === "win32"
              ? `dir /s /b *${args.pattern}* 2>NUL`
              : `find . -name "*${args.pattern}*" -type f 2>/dev/null | head -20`;
          const output = execSync(cmd, {
            cwd: dir,
            encoding: "utf8",
            timeout: 10000,
          });
          return attachDescriptor({
            files: output.trim().split("\n").filter(Boolean).slice(0, 20),
          });
        }
      } catch {
        return attachDescriptor({
          files: [],
          message: "No matches found",
        });
      }
    }

    case "list_dir": {
      const dirPath = args.path ? path.resolve(cwd, args.path) : cwd;
      if (!fs.existsSync(dirPath)) {
        return attachDescriptor({ error: `Directory not found: ${dirPath}` });
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return attachDescriptor({
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        })),
      });
    }

    case "run_skill": {
      const allSkills = skillLoader.getResolvedSkills();
      if (allSkills.length === 0) {
        return attachDescriptor({
          error:
            "No skills found. Make sure you're in the ChainlessChain project root or have skills installed.",
        });
      }
      const match = allSkills.find(
        (s) => s.id === args.skill_name || s.dirName === args.skill_name,
      );
      if (!match || !match.hasHandler) {
        return attachDescriptor({
          error: `Skill "${args.skill_name}" not found or has no handler. Use list_skills to see available skills.`,
        });
      }

      // Check if skill requests isolation (via SKILL.md frontmatter)
      const skillIsolation = match.isolation === true;
      if (skillIsolation) {
        // Run skill through isolated sub-agent context
        const subCtx = SubAgentContext.create({
          role: `skill-${args.skill_name}`,
          task: `Execute the "${args.skill_name}" skill with input: ${(args.input || "").substring(0, 200)}`,
          allowedTools: ["read_file", "search_files", "list_dir"],
          cwd,
        });
        try {
          const result = await subCtx.run(args.input);
          return attachDescriptor({
            success: true,
            isolated: true,
            skill: args.skill_name,
            summary: result.summary,
            toolsUsed: result.toolsUsed,
          });
        } catch (err) {
          return attachDescriptor({
            error: `Isolated skill execution failed: ${err.message}`,
          });
        }
      }

      // Skill-Embedded MCP: mount the skill's declared MCP servers for
      // the duration of handler.execute, then unmount in finally. The
      // handler may use them via taskContext.mcpClient. If mcpClient is
      // null (no MCP set up for this session), skip silently.
      let mountedMcpServers = [];
      const hasSkillMcps =
        Array.isArray(match.mcpServers) && match.mcpServers.length > 0;
      if (hasSkillMcps && mcpClient) {
        try {
          const mountResult = await mountSkillMcpServers(mcpClient, match, {
            onWarn: (msg) => {
              // Non-fatal — logged as warning, skipped servers captured
              // in mountResult.skipped.
              // eslint-disable-next-line no-console
              console.warn(msg);
            },
          });
          mountedMcpServers = mountResult.mounted;
        } catch (err) {
          return attachDescriptor({
            error: `Skill MCP mount failed: ${err.message}`,
          });
        }
      }

      try {
        const handlerPath = path.join(match.skillDir, "handler.js");
        const imported = await import(
          `file://${handlerPath.replace(/\\/g, "/")}`
        );
        const handler = imported.default || imported;
        if (handler.init) await handler.init(match);
        const task = {
          params: { input: args.input },
          input: args.input,
          action: args.input,
        };
        const taskContext = {
          projectRoot: cwd,
          workspacePath: cwd,
          // Expose the MCP client + mounted servers so the skill handler
          // can call MCP tools directly without going through the agent
          // loop. Handlers that don't need MCP can ignore these.
          mcpClient: mcpClient || null,
          mountedMcpServers,
        };
        const result = await handler.execute(task, taskContext, match);
        return attachDescriptor(result);
      } catch (err) {
        return attachDescriptor({
          error: `Skill execution failed: ${err.message}`,
        });
      } finally {
        if (mountedMcpServers.length > 0 && mcpClient) {
          try {
            await unmountSkillMcpServers(mcpClient, mountedMcpServers);
          } catch (_err) {
            // Non-critical — mount/unmount errors don't fail the skill
          }
        }
      }
    }

    case "list_skills": {
      let skills = skillLoader.getResolvedSkills();
      if (skills.length === 0) {
        return attachDescriptor({ error: "No skills found." });
      }
      if (args.category) {
        skills = skills.filter(
          (s) => s.category.toLowerCase() === args.category.toLowerCase(),
        );
      }
      if (args.query) {
        const q = args.query.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.id.includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q),
        );
      }
      return attachDescriptor({
        count: skills.length,
        skills: skills.map((s) => ({
          id: s.id,
          category: s.category,
          source: s.source,
          hasHandler: s.hasHandler,
          description: (s.description || "").substring(0, 80),
        })),
      });
    }

    default:
      if (localToolExecutor?.kind === "mcp") {
        if (!mcpClient || typeof mcpClient.callTool !== "function") {
          return attachDescriptor({
            error: `MCP client is unavailable for tool: ${name}`,
          });
        }

        try {
          const result = await mcpClient.callTool(
            localToolExecutor.serverName,
            localToolExecutor.toolName,
            args || {},
          );
          if (result && typeof result === "object") {
            return attachDescriptor(result);
          }
          return attachDescriptor({ result });
        } catch (err) {
          return attachDescriptor({
            error: `MCP tool execution failed: ${err.message}`,
          });
        }
      }

      if (
        hostToolDefinition &&
        interaction &&
        typeof interaction.requestHostTool === "function"
      ) {
        const hostedResult = await interaction.requestHostTool(name, args);
        if (hostedResult?.success === false) {
          return attachDescriptor({
            error:
              hostedResult.error || `Hosted tool execution failed: ${name}`,
            policy: hostToolPolicy || null,
          });
        }

        if (hostedResult?.result && typeof hostedResult.result === "object") {
          return hostedResult.result;
        }

        return attachDescriptor({
          result:
            hostedResult &&
            Object.prototype.hasOwnProperty.call(hostedResult, "result")
              ? hostedResult.result
              : hostedResult,
        });
      }

      return attachDescriptor({ error: `Unknown tool: ${name}` });
  }
}

// ─── run_code implementation ──────────────────────────────────────────────

/**
 * Classify an error from code execution into a structured type with hints.
 * @param {string} stderr - stderr output
 * @param {string} message - error message
 * @param {number|null} exitCode - process exit code
 * @param {string} lang - language (python, node, bash)
 * @returns {{ errorType: string, hint: string }}
 */
export function classifyError(stderr, message, exitCode, lang) {
  const text = stderr || message || "";

  // Import / module errors
  if (/ModuleNotFoundError|ImportError|No module named/i.test(text)) {
    const modMatch = text.match(/No module named ['"]([^'"]+)['"]/);
    return {
      errorType: "import_error",
      hint: modMatch
        ? `Missing Python module "${modMatch[1]}". Will attempt auto-install.`
        : "Missing module. Check your imports.",
    };
  }

  // Syntax errors
  if (/SyntaxError|IndentationError|TabError/i.test(text)) {
    const lineMatch = text.match(/line (\d+)/i);
    return {
      errorType: "syntax_error",
      hint: lineMatch
        ? `Syntax error on line ${lineMatch[1]}. Check for typos, missing colons, or indentation.`
        : "Syntax error in code. Check for typos or missing brackets.",
    };
  }

  // Timeout
  if (/ETIMEDOUT|timed?\s*out/i.test(text) || exitCode === null) {
    return {
      errorType: "timeout",
      hint: "Script timed out. Consider increasing timeout or optimizing the code.",
    };
  }

  // Permission errors
  if (/EACCES|Permission denied|PermissionError/i.test(text)) {
    return {
      errorType: "permission_error",
      hint: "Permission denied. Try a different directory or run with appropriate permissions.",
    };
  }

  // Generic runtime error
  const lineMatch = text.match(/(?:line |:)(\d+)/);
  return {
    errorType: "runtime_error",
    hint: lineMatch
      ? `Runtime error near line ${lineMatch[1]}. Check the traceback above.`
      : "Runtime error. Check stderr for details.",
  };
}

/**
 * Validate a package name for pip install (reject shell metacharacters).
 * @param {string} name
 * @returns {boolean}
 */
export function isValidPackageName(name) {
  return /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(name) && name.length <= 100;
}

/**
 * Execute code with auto pip-install, script persistence, and error classification.
 */
async function _executeRunCode(args, cwd) {
  const lang = args.language;
  const code = args.code;
  const timeoutSec = Math.min(Math.max(args.timeout || 60, 1), 300);
  const persist = args.persist !== false; // default true

  const extMap = { python: ".py", node: ".js", bash: ".sh" };
  const ext = extMap[lang];
  if (!ext) {
    return {
      error: `Unsupported language: ${lang}. Use python, node, or bash.`,
    };
  }

  // Determine script path
  let scriptPath;
  if (persist) {
    const scriptsDir = path.join(cwd, ".chainlesschain", "agent-scripts");
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }
    const timestamp = new Date()
      .toISOString()
      .replace(/[T:]/g, "-")
      .replace(/\.\d+Z$/, "");
    scriptPath = path.join(scriptsDir, `${timestamp}-${lang}${ext}`);
  } else {
    scriptPath = path.join(os.tmpdir(), `cc-agent-${Date.now()}${ext}`);
  }

  try {
    fs.writeFileSync(scriptPath, code, "utf8");

    // Determine interpreter
    let interpreter;
    if (lang === "python") {
      const py = getCachedPython();
      interpreter = py.found ? py.command : "python";
    } else if (lang === "node") {
      interpreter = "node";
    } else {
      interpreter = "bash";
    }

    const start = Date.now();
    let output;
    try {
      output = execSync(`${interpreter} "${scriptPath}"`, {
        cwd,
        encoding: "utf8",
        timeout: timeoutSec * 1000,
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (err) {
      const stderr = (err.stderr || "").toString();
      const message = err.message || "";
      const classified = classifyError(stderr, message, err.status, lang);

      // Auto-install missing Python packages
      if (lang === "python" && classified.errorType === "import_error") {
        const modMatch = stderr.match(/No module named ['"]([^'"]+)['"]/);
        if (modMatch) {
          // Use top-level package name (e.g. "foo.bar" → "foo")
          const packageName = modMatch[1].split(".")[0];

          if (!isValidPackageName(packageName)) {
            return {
              error: `Invalid package name: "${packageName}"`,
              ...classified,
              language: lang,
              scriptPath: persist ? scriptPath : undefined,
            };
          }

          // Attempt pip install
          try {
            execSync(`${interpreter} -m pip install ${packageName}`, {
              encoding: "utf-8",
              timeout: 120000,
              maxBuffer: 2 * 1024 * 1024,
              stdio: ["pipe", "pipe", "pipe"],
            });

            // Retry execution
            const retryStart = Date.now();
            const retryOutput = execSync(`${interpreter} "${scriptPath}"`, {
              cwd,
              encoding: "utf8",
              timeout: timeoutSec * 1000,
              maxBuffer: 5 * 1024 * 1024,
            });
            const retryDuration = Date.now() - retryStart;

            return {
              success: true,
              output: retryOutput.substring(0, 50000),
              language: lang,
              duration: `${retryDuration}ms`,
              autoInstalled: [packageName],
              scriptPath: persist ? scriptPath : undefined,
            };
          } catch (pipErr) {
            return {
              error: (stderr || message).substring(0, 5000),
              stderr: stderr.substring(0, 5000),
              exitCode: err.status,
              language: lang,
              ...classified,
              hint: `Failed to auto-install "${packageName}". ${(pipErr.stderr || pipErr.message || "").substring(0, 500)}`,
              scriptPath: persist ? scriptPath : undefined,
            };
          }
        }
      }

      return {
        error: (stderr || message).substring(0, 5000),
        stderr: stderr.substring(0, 5000),
        exitCode: err.status,
        language: lang,
        ...classified,
        scriptPath: persist ? scriptPath : undefined,
      };
    }

    const duration = Date.now() - start;
    return {
      success: true,
      output: output.substring(0, 50000),
      language: lang,
      duration: `${duration}ms`,
      scriptPath: persist ? scriptPath : undefined,
    };
  } finally {
    // Only clean up if not persisting
    if (!persist) {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Cleanup best-effort
      }
    }
  }
}

// ─── spawn_sub_agent implementation ──────────────────────────────────────

/**
 * Execute a spawn_sub_agent tool call.
 * Creates an isolated SubAgentContext, runs it, and returns only the summary.
 *
 * @param {object} args - { role, task, context?, tools? }
 * @param {object} ctx - { skillLoader, cwd, parentMessages, interaction, sessionId }
 * @returns {Promise<object>}
 */
async function _executeSpawnSubAgent(args, ctx) {
  const { role, task, context: inheritedContext, tools: allowedTools } = args;

  if (!role || !task) {
    return { error: "Both 'role' and 'task' are required for spawn_sub_agent" };
  }

  // Auto-condense parent context if caller didn't provide explicit context
  let resolvedContext = inheritedContext || null;
  if (!resolvedContext && Array.isArray(ctx.parentMessages)) {
    const recentMsgs = ctx.parentMessages
      .filter((m) => m.role === "assistant" && typeof m.content === "string")
      .slice(-3)
      .map((m) => m.content.substring(0, 200));
    if (recentMsgs.length > 0) {
      resolvedContext = recentMsgs.join("\n---\n");
    }
  }

  // Link child to parent session so registry-scoped queries and
  // session-close cascade cleanup can find it.
  const parentSessionId = ctx.sessionId || null;
  const interaction = ctx.interaction || null;

  const subCtx = SubAgentContext.create({
    role,
    task,
    parentId: parentSessionId,
    inheritedContext: resolvedContext,
    allowedTools: allowedTools || null,
    cwd: ctx.cwd,
  });

  const emit = (type, payload) => {
    if (!interaction || typeof interaction.emit !== "function") return;
    try {
      interaction.emit(type, {
        sessionId: parentSessionId,
        subAgentId: subCtx.id,
        parentSessionId,
        role: subCtx.role,
        ...payload,
      });
    } catch (_err) {
      // Event emission is best-effort — never break the tool call
    }
  };

  try {
    // Notify registry if available
    const { SubAgentRegistry } =
      await import("../lib/sub-agent-registry.js").catch(() => ({
        SubAgentRegistry: null,
      }));
    if (SubAgentRegistry) {
      try {
        SubAgentRegistry.getInstance().register(subCtx);
      } catch (_err) {
        // Registry not available — non-critical
      }
    }

    emit("sub-agent.started", {
      task: subCtx.task,
      allowedTools: allowedTools || null,
      maxIterations: subCtx.maxIterations,
      createdAt: subCtx.createdAt,
    });

    const result = await subCtx.run(task);

    // Complete in registry
    if (SubAgentRegistry) {
      try {
        SubAgentRegistry.getInstance().complete(subCtx.id, result);
      } catch (_err) {
        // Non-critical
      }
    }

    emit("sub-agent.completed", {
      status: subCtx.status,
      summary: result.summary,
      toolsUsed: result.toolsUsed,
      iterationCount: result.iterationCount,
      tokenCount: result.tokenCount,
      artifactCount: result.artifacts.length,
      completedAt: subCtx.completedAt,
    });

    return {
      success: true,
      subAgentId: subCtx.id,
      role: subCtx.role,
      parentSessionId,
      summary: result.summary,
      toolsUsed: result.toolsUsed,
      iterationCount: result.iterationCount,
      artifactCount: result.artifacts.length,
    };
  } catch (err) {
    subCtx.forceComplete(err.message);

    emit("sub-agent.failed", {
      status: subCtx.status,
      error: err.message,
      completedAt: subCtx.completedAt,
    });

    return {
      error: `Sub-agent failed: ${err.message}`,
      subAgentId: subCtx.id,
      role: subCtx.role,
      parentSessionId,
    };
  }
}

// ─── LLM chat with tools ─────────────────────────────────────────────────

/**
 * Send a chat completion request with tool definitions.
 * Supports 8 providers: ollama, anthropic, openai, deepseek, dashscope, gemini, mistral, volcengine
 *
 * @param {Array} rawMessages
 * @param {object} options
 * @returns {Promise<object>} response with .message
 */
export async function chatWithTools(rawMessages, options) {
  const {
    provider,
    model,
    baseUrl,
    apiKey,
    contextEngine: ce,
    signal,
  } = options;

  const persona = _loadProjectPersona(options.cwd);
  const tools = getAgentToolDefinitions({
    names: options.enabledToolNames,
    disabledTools: persona?.toolsDisabled,
    extraTools: [
      ...(options.hostManagedToolPolicy?.toolDefinitions || []),
      ...(options.extraToolDefinitions || []),
    ],
  });

  const lastUserMsg = [...rawMessages].reverse().find((m) => m.role === "user");
  const messages = ce
    ? ce.buildOptimizedMessages(rawMessages, {
        userQuery: lastUserMsg?.content,
      })
    : rawMessages;

  throwIfAborted(signal);

  if (provider === "ollama") {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages,
        tools,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }
    return await response.json();
  }

  if (provider === "anthropic") {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY required");

    const systemMsgs = messages.filter((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");

    const anthropicTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body = {
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: otherMsgs,
      tools: anthropicTools,
    };
    if (systemMsgs.length > 0) {
      body.system = systemMsgs.map((m) => m.content).join("\n");
    }

    const url =
      baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : "https://api.anthropic.com/v1";

    const response = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    return _normalizeAnthropicResponse(data);
  }

  // OpenAI-compatible providers
  const providerUrls = {
    openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    mistral: "https://api.mistral.ai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  };

  const providerApiKeyEnvs = {
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    dashscope: "DASHSCOPE_API_KEY",
    mistral: "MISTRAL_API_KEY",
    gemini: "GEMINI_API_KEY",
    volcengine: "VOLCENGINE_API_KEY",
  };

  const url =
    baseUrl && baseUrl !== "http://localhost:11434"
      ? baseUrl
      : providerUrls[provider];

  if (!url) {
    throw new Error(
      `Unsupported provider: ${provider}. Supported: ollama, anthropic, openai, deepseek, dashscope, mistral, gemini, volcengine`,
    );
  }

  const envKey = providerApiKeyEnvs[provider] || "OPENAI_API_KEY";
  const key = apiKey || process.env[envKey];
  if (!key) throw new Error(`${envKey} required for provider ${provider}`);

  const defaultModels = {
    openai: "gpt-4o",
    deepseek: "deepseek-chat",
    dashscope: "qwen-turbo",
    mistral: "mistral-large-latest",
    gemini: "gemini-2.0-flash",
    volcengine: "doubao-seed-1-6-251015",
  };

  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    signal,
    body: JSON.stringify({
      model: model || defaultModels[provider] || "gpt-4o-mini",
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider} API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error("Invalid API response: no choices returned");
  }
  const choice = data.choices[0];
  return { message: choice.message };
}

function _normalizeAnthropicResponse(data) {
  const content = data.content || [];
  const textBlocks = content.filter((b) => b.type === "text");
  const toolBlocks = content.filter((b) => b.type === "tool_use");

  const message = {
    role: "assistant",
    content: textBlocks.map((b) => b.text).join("\n") || "",
  };

  if (toolBlocks.length > 0) {
    message.tool_calls = toolBlocks.map((b) => ({
      id: b.id,
      type: "function",
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input),
      },
    }));
  }

  return { message };
}

// ─── Agent loop (async generator) ─────────────────────────────────────────

/**
 * Async generator that drives the agentic tool-use loop.
 *
 * Yields events:
 *   { type: "slot-filling", slot, question }  — when asking user for missing info
 *   { type: "tool-executing", tool, args }
 *   { type: "tool-result", tool, result, error }
 *   { type: "response-complete", content }
 *
 * @param {Array} messages - mutable messages array (will be appended to)
 * @param {object} options - provider, model, baseUrl, apiKey, contextEngine, hookDb, skillLoader, cwd, slotFiller, interaction
 */
export async function* agentLoop(messages, options) {
  const MAX_ITERATIONS = 15;
  const signal = options.signal || null;
  const toolContext = {
    hookDb: options.hookDb || null,
    skillLoader: options.skillLoader || _defaultSkillLoader,
    cwd: options.cwd || process.cwd(),
    planManager: options.planManager || null,
    sessionId: options.sessionId || null,
    hostManagedToolPolicy: options.hostManagedToolPolicy || null,
    externalToolDescriptors: options.externalToolDescriptors || null,
    externalToolExecutors: options.externalToolExecutors || null,
    mcpClient: options.mcpClient || null,
    parentMessages: messages, // pass parent messages for sub-agent auto-condensation
    interaction: options.interaction || null,
  };

  throwIfAborted(signal);

  // ── Slot-filling phase ──────────────────────────────────────────────
  // Before calling the LLM, check if the user's message matches a known
  // intent with missing required parameters. If so, interactively fill them
  // and append the gathered context to the user message.
  if (options.slotFiller && options.interaction) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      try {
        const { CLISlotFiller } = await import("../lib/slot-filler.js");
        const intent = CLISlotFiller.detectIntent(lastUserMsg.content);

        if (intent) {
          const requiredSlots = CLISlotFiller.getSlotDefinitions(
            intent.type,
          ).required;
          const missingSlots = requiredSlots.filter((s) => !intent.entities[s]);

          if (missingSlots.length > 0) {
            const result = await options.slotFiller.fillSlots(intent, {
              cwd: options.cwd || process.cwd(),
            });

            // Yield slot-filling events for each filled slot
            for (const slot of result.filledSlots) {
              yield {
                type: "slot-filling",
                slot,
                question: `Filled "${slot}" = "${result.entities[slot]}"`,
              };
            }

            // Append gathered context to the user message so the LLM has full info
            if (result.filledSlots.length > 0) {
              const contextParts = Object.entries(result.entities)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}: ${v}`);
              lastUserMsg.content += `\n\n[Context — user provided: ${contextParts.join(", ")}]`;
            }
          }
        }
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          throw error;
        }
        // Slot-filling failure is non-critical — proceed to LLM
      }
    }
  }

  // Phase 7 parity harness hook: tests can inject a mock LLM function via
  // `options.chatFn` to drive the loop deterministically without hitting a
  // real provider. Production code path is unchanged — the fallback is the
  // real `chatWithTools`.
  const llmCall = options.chatFn || chatWithTools;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    throwIfAborted(signal);
    const result = await llmCall(messages, options);
    throwIfAborted(signal);
    const msg = result?.message;

    if (!msg) {
      yield { type: "response-complete", content: "(No response from LLM)" };
      return;
    }

    const toolCalls = msg.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      yield { type: "response-complete", content: msg.content || "" };
      return;
    }

    // Add assistant message with tool calls
    messages.push(msg);

    for (const call of toolCalls) {
      throwIfAborted(signal);
      const fn = call.function;
      const toolName = fn.name;
      let toolArgs;

      try {
        toolArgs =
          typeof fn.arguments === "string"
            ? JSON.parse(fn.arguments)
            : fn.arguments;
      } catch {
        toolArgs = {};
      }

      yield { type: "tool-executing", tool: toolName, args: toolArgs };

      let toolResult;
      let toolError = null;
      try {
        toolResult = await executeTool(toolName, toolArgs, toolContext);
      } catch (err) {
        toolResult = { error: err.message };
        toolError = err.message;
      }

      throwIfAborted(signal);

      yield {
        type: "tool-result",
        tool: toolName,
        result: toolResult,
        error: toolError,
      };

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult).substring(0, 5000),
        tool_call_id: call.id,
      });
    }
  }

  yield {
    type: "response-complete",
    content: "(Reached max tool call iterations)",
  };
}

// ─── Format helpers ───────────────────────────────────────────────────────

export function formatToolArgs(name, args) {
  switch (name) {
    case "read_file":
      return args.path;
    case "write_file":
      return `${args.path} (${args.content?.length || 0} chars)`;
    case "edit_file":
      return args.path;
    case "edit_file_hashed":
      return `${args.path} @${args.anchor_hash}`;
    case "run_shell":
      return args.command;
    case "git":
      return args.command;
    case "search_files":
      return args.pattern;
    case "list_dir":
      return args.path || ".";
    case "run_skill":
      return `${args.skill_name}: ${(args.input || "").substring(0, 50)}`;
    case "list_skills":
      return args.category || args.query || "all";
    case "run_code":
      return `${args.language} (${(args.code || "").length} chars)`;
    case "spawn_sub_agent":
      return `[${args.role}] ${(args.task || "").substring(0, 60)}`;
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
