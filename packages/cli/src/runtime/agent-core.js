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
import { execSync, spawn } from "child_process";
import os from "os";
import sharedCodingAgentPolicy from "./coding-agent-policy.cjs";
import sharedShellPolicy from "./coding-agent-shell-policy.cjs";
import sharedPermissionRules from "../lib/permission-rules.cjs";
import sharedSettingsHooks from "../lib/settings-hooks.cjs";
import sharedHookRunner from "../lib/hook-runner.cjs";
import sharedHookEvents from "../lib/settings-hook-events.cjs";
import { mergeProviderOptions } from "../lib/provider-options.js";
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
  isRetryableStreamError,
  STREAM_RETRY_MAX,
  STREAM_RETRY_BASE_MS,
} from "../lib/stream-retry.js";
import {
  annotateLines,
  replaceByHash,
  snippetAround,
} from "../lib/hashline.js";
import {
  mountSkillMcpServers,
  unmountSkillMcpServers,
} from "../lib/skill-mcp.js";
import {
  hasImageContent,
  toOllamaMessages,
  imageUrlBlockToAnthropic,
} from "../lib/image-input.js";

/**
 * Names of MCP servers currently mounted by an in-flight run_skill call.
 * Populated by run_skill before invoking the handler and cleared in
 * the finally block. Exposed via getActiveMcpServers() so external
 * observers (web panel, future LLM prompt builders) can render only
 * the tools that are actually live for this session.
 */
const _activeMcpServers = new Set();
export function getActiveMcpServers() {
  return new Set(_activeMcpServers);
}

const { isDangerousGitCommand, isReadOnlyGitCommand, normalizeGitCommand } =
  sharedCodingAgentPolicy;
const { evaluateShellCommandPolicy } = sharedShellPolicy;
const { evaluatePermissionRules } = sharedPermissionRules;
const { collectHooks, umbrellaFor } = sharedSettingsHooks;
const { runHooks: runCommandHooks } = sharedHookRunner;
const { runObserveHooks } = sharedHookEvents;

// ─── Background shell tasks ────────────────────────────────────────────────
//
// run_shell is synchronous (execSync) and capped at a foreground timeout, which
// is the right default for quick commands but blocks the whole agent loop on
// long-running ones (builds, full test suites, `npm run dev`). When the model
// passes run_in_background:true the command is spawned instead, returns a
// task_id immediately, and streams its output into this registry. The agent
// then polls completion + incremental output via the check_shell tool — the
// run_in_background + BashOutput pattern from Claude Code.
//
// In-memory, process-lifetime: a task_id is only valid within the agent process
// that spawned it, which is exactly the polling window (one REPL session / one
// headless run). Buffers are bounded (MAX_BG_BUFFER per stream, tail-retained)
// so a chatty long task can't exhaust memory.
const MAX_BG_BUFFER = 1024 * 1024; // 1 MB retained tail per stream
const _backgroundShellTasks = new Map();
let _backgroundTaskSeq = 0;

function _newBgStream() {
  return { buf: "", total: 0, dropped: 0, cursor: 0 };
}

function _appendBgStream(stream, text) {
  stream.buf += text;
  stream.total += text.length;
  if (stream.buf.length > MAX_BG_BUFFER) {
    const over = stream.buf.length - MAX_BG_BUFFER;
    stream.buf = stream.buf.slice(over);
    stream.dropped += over;
  }
}

// Read everything produced since the last read and advance the cursor. When the
// cursor points into a region already dropped from the retained tail, the gap
// is reported so the caller knows output was lost to the buffer cap.
function _readBgStream(stream) {
  const bufStart = stream.total - stream.buf.length;
  let from = stream.cursor;
  let droppedGap = 0;
  if (from < bufStart) {
    droppedGap = bufStart - from;
    from = bufStart;
  }
  const text = stream.buf.slice(from - bufStart);
  stream.cursor = stream.total;
  return { text, droppedGap };
}

/**
 * Snapshot of background shell tasks (for REPL/host status surfaces).
 * @returns {Array<{id:string,status:string,command:string,exitCode:number|null}>}
 */
export function listBackgroundShellTasks() {
  return Array.from(_backgroundShellTasks.values()).map((t) => ({
    id: t.id,
    status: t.status,
    command: t.command,
    exitCode: t.exitCode,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
  }));
}

// Kill a background task's whole process tree. Because tasks are spawned with
// shell:true, the child is a shell whose real command runs as a grandchild — a
// plain child.kill() on POSIX only signals the shell (and often orphans the
// command), so a backgrounded `npm run dev` would survive. POSIX: the task is
// spawned detached (its own process group), so signal the group via the
// negative pid. Windows: `taskkill /T` walks and kills the whole tree.
// Returns true if a running task was signalled.
function _killTask(task) {
  const child = task?.child;
  if (!child || child.killed || task?.status !== "running") return false;
  try {
    if (process.platform === "win32") {
      if (child.pid) {
        const tk = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        // A spawn that fails to launch emits an async 'error' event — with no
        // listener Node rethrows it as an UNCAUGHT exception (the try/catch
        // here can't catch the async emit), crashing the CLI. Handle it and
        // fall back to a direct kill.
        tk.on("error", () => {
          try {
            child.kill();
          } catch {
            /* already dead */
          }
        });
      } else {
        child.kill();
      }
    } else if (child.pid) {
      // Negative pid → signal the whole process group (requires detached spawn).
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (_err) {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Kill one background shell task by id (for the user-facing `/tasks kill <id>`).
 * @returns {boolean} true if a running task with that id was signalled
 */
export function killBackgroundShellTask(id) {
  const task = _backgroundShellTasks.get(id);
  if (!task) return false;
  return _killTask(task);
}

/**
 * Kill every still-running background shell task. Callers (REPL exit, headless
 * shutdown) invoke this so a backgrounded `npm run dev` doesn't outlive the
 * agent. Best-effort: kill failures are swallowed.
 * @returns {number} count of tasks signalled
 */
export function killAllBackgroundShellTasks() {
  let killed = 0;
  for (const task of _backgroundShellTasks.values()) {
    if (_killTask(task)) {
      killed += 1;
    }
  }
  return killed;
}

// Foreground (synchronous) run_shell timeout. Configurable per-call via the
// optional `timeout` arg; defaults to 60s and is hard-capped at 10 min so a
// synchronous call can never wedge the loop indefinitely (use run_in_background
// for genuinely long work).
const DEFAULT_SHELL_TIMEOUT_MS = 60000;
const MAX_SHELL_TIMEOUT_MS = 600000;
function _resolveShellTimeout(raw) {
  if (raw == null) return DEFAULT_SHELL_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SHELL_TIMEOUT_MS;
  return Math.min(Math.floor(n), MAX_SHELL_TIMEOUT_MS);
}

/**
 * Run settings.json `PreToolUse` hooks (decision-capable). DB hooks are handled
 * separately + stay observe-only. A `block` decision stops the tool; an `ask`
 * routes to the confirmer (headless without one falls closed). spawnSync is
 * synchronous but each hook is timeout-capped.
 * @returns {Promise<{blocked:boolean, reason?:string, hook?:string}>}
 */
async function runSettingsPreToolUseHooks(name, args, context, cwd) {
  const matched = collectHooks(context.settingsHooks, "PreToolUse", name);
  if (!matched || matched.length === 0) return { blocked: false };
  const payload = {
    hook_event_name: "PreToolUse",
    tool_name: umbrellaFor(name),
    raw_tool_name: name,
    tool_input: args,
    cwd,
    session_id: context.sessionId || null,
  };
  const outcome = runCommandHooks(matched, payload, {
    cwd,
    event: "PreToolUse",
  });
  if (outcome.decision === "block") {
    return { blocked: true, reason: outcome.reason, hook: outcome.hook };
  }
  if (outcome.decision === "ask") {
    // File edits in an interactive session with an IDE bridge: route the ask
    // through the editor's openDiff review (same machinery as settings ask —
    // accepted means the IDE wrote the file, so the caller must skip
    // execution; see tryIdeDiffApprovalForEdit).
    const ide = await tryIdeDiffApprovalForEdit(name, args, context, cwd, {
      rule: `hook:${outcome.hook}`,
      source: "PreToolUse hook",
    });
    if (ide?.outcome === "accepted") {
      return { blocked: false, ideApplied: ide.result };
    }
    // Both rejected and changes-requested mean "not applied + feed the
    // verdict's message back" — same control flow, different message body.
    if (ide?.outcome === "rejected" || ide?.outcome === "changes-requested") {
      return {
        blocked: true,
        reason: ide.result.error,
        hook: outcome.hook,
        ideResult: ide.result,
      };
    }
    const confirm = context.permissionConfirm || context.shellConfirm || null;
    const ok =
      typeof confirm === "function"
        ? await confirm({
            tool: name,
            args,
            rule: `hook:${outcome.hook}`,
            reason: outcome.reason || "a PreToolUse hook requests confirmation",
          })
        : false;
    return ok
      ? { blocked: false }
      : {
          blocked: true,
          reason: outcome.reason || "PreToolUse hook ask denied",
          hook: outcome.hook,
        };
  }
  return { blocked: false };
}

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

/**
 * Re-scan all skill layers (Claude-Code `/reload-skills` parity): drops the
 * default loader's cache so newly added/edited SKILL.md dirs are picked up
 * without restarting the session. Returns the resolved skill count.
 */
export function reloadSkills() {
  _defaultSkillLoader.clearCache();
  return _defaultSkillLoader.loadAll().length;
}

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
- For long-running commands (builds, full test suites, dev servers) set run_shell { run_in_background: true } to get a task_id back immediately, then poll output and completion with check_shell { task_id }. Kill a backgrounded server with check_shell { task_id, kill: true } when finished
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
 * Load persona configuration from project config.json.
 *
 * Resolution order (highest priority first):
 *   1. CC_PACK_AUTO_PERSONA env var → config.personas[<env>] if present
 *      (set by `cc pack --project` packed exe at boot, per Phase 3f; the
 *      Phase 3d resolver lives here so packaged products actually activate
 *      their bundled persona at runtime)
 *   2. config.activePersonaName → config.personas[<name>] if present
 *      (set by `cc persona activate <name>`)
 *   3. config.persona (the legacy inline single-persona shape; still the
 *      common case for projects created via `cc init`)
 *
 * @param {string} cwd - working directory
 * @returns {object|null} persona object or null
 */
function _loadProjectPersona(cwd) {
  try {
    const projectRoot = findProjectRoot(cwd || process.cwd());
    if (!projectRoot) return null;
    const config = loadProjectConfig(projectRoot);
    if (!config) return null;
    const personas =
      config.personas && typeof config.personas === "object"
        ? config.personas
        : null;
    const envName = process.env.CC_PACK_AUTO_PERSONA;
    if (envName && personas && personas[envName]) {
      return personas[envName];
    }
    const activeName = config.activePersonaName;
    if (activeName && personas && personas[activeName]) {
      return personas[activeName];
    }
    return config.persona || null;
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
 * @param {object} [opts]
 * @param {string[]} [opts.additionalDirectories] - extra workspace roots
 *   (absolute paths) the agent may read/search/edit beyond `cwd`.
 * @returns {string} complete system prompt
 */
export function buildSystemPrompt(cwd, opts = {}) {
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

  // Advertise extra workspace roots (--add-dir) so the model knows it may
  // reach beyond cwd and which absolute paths to use.
  const extraDirs = Array.isArray(opts.additionalDirectories)
    ? opts.additionalDirectories.filter(Boolean)
    : [];
  if (extraDirs.length > 0) {
    prompt +=
      `\n\n## Additional working directories\n` +
      `Beyond the current working directory, you may read, search, and edit ` +
      `files under these absolute roots. Pass absolute paths to access them:\n` +
      extraDirs.map((d) => `- ${d}`).join("\n");
  }

  return prompt;
}

// ─── Tool execution ──────────────────────────────────────────────────────

/** The file-mutating tools whose `ask` can be reviewed as an IDE diff. */
const IDE_DIFF_EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);

/**
 * Compute the content an edit tool WOULD write, without writing it — the
 * left/right sides for an IDE diff review. Mirrors the corresponding
 * executeToolInner cases exactly (write_file / edit_file / edit_file_hashed,
 * the latter via the same pure replaceByHash). Returns
 * `{ filePath, newContent, originalText|null }` or null when the edit cannot
 * be computed (missing file, anchor/old_string miss, bad args) — the caller
 * then falls back to the normal confirmation path so the tool can produce its
 * own diagnostics.
 */
export function computeProposedEdit(name, args = {}, cwd = process.cwd()) {
  try {
    if (!args.path) return null;
    const filePath = path.resolve(cwd, args.path);
    if (name === "write_file") {
      if (typeof args.content !== "string") return null;
      const originalText = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, "utf8")
        : "";
      return { filePath, newContent: args.content, originalText };
    }
    if (name === "edit_file") {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, "utf8");
      if (
        typeof args.old_string !== "string" ||
        !content.includes(args.old_string)
      ) {
        return null;
      }
      return {
        filePath,
        newContent: content.replace(args.old_string, () => args.new_string),
        originalText: content,
      };
    }
    if (name === "edit_file_hashed") {
      if (!fs.existsSync(filePath)) return null;
      if (!args.anchor_hash || typeof args.new_line !== "string") return null;
      const original = fs.readFileSync(filePath, "utf8");
      const result = replaceByHash(original, {
        anchorHash: args.anchor_hash,
        expectedLine: args.expected_line,
        newLine: args.new_line,
      });
      if (!result.success) return null;
      return { filePath, newContent: result.content, originalText: original };
    }
  } catch {
    // unreadable file etc. → no proposal, normal path handles it
  }
  return null;
}

/**
 * Shared IDE-diff approval routing for an `ask` decision about a file edit
 * (used by BOTH the settings-rules ask and the PreToolUse-hook ask). Returns
 *   { outcome:"accepted", result }  — the IDE wrote the file; the caller MUST
 *                                     return `result` and skip execution
 *   { outcome:"rejected", result }  — deny with `result`, file untouched
 *   null                            — not applicable (non-edit tool, headless,
 *                                     no IDE, disabled, no proposal, IDE died)
 *                                     → caller falls back to its own confirm.
 */
async function tryIdeDiffApprovalForEdit(
  name,
  args,
  context,
  cwd,
  { rule, source } = {},
) {
  if (!IDE_DIFF_EDIT_TOOLS.has(name)) return null;
  if (typeof context.permissionConfirm !== "function") return null; // interactive only
  if (!context.mcpClient || !context.externalToolExecutors) return null;
  try {
    const {
      ideDiffApprovalEnabled,
      hasIdeOpenDiff,
      requestIdeDiffApproval,
      formatReviewComments,
    } = await import("../lib/ide-context.js");
    const mcpLike = {
      mcpClient: context.mcpClient,
      externalToolExecutors: context.externalToolExecutors,
    };
    if (!ideDiffApprovalEnabled() || !hasIdeOpenDiff(mcpLike)) return null;
    const proposal = computeProposedEdit(name, args, cwd);
    if (!proposal) return null;
    const verdict = await requestIdeDiffApproval(mcpLike, {
      path: proposal.filePath,
      modifiedText: proposal.newContent,
      originalText: proposal.originalText,
      title: `cc agent: ${name} ${path.basename(proposal.filePath)}`,
    });
    if (verdict?.outcome === "accepted") {
      return {
        outcome: "accepted",
        result: {
          success: true,
          path: proposal.filePath,
          appliedVia: "ide-diff",
          ...(verdict.finalText != null &&
          verdict.finalText !== proposal.newContent
            ? { userEdited: true }
            : {}),
          policy: { decision: "allow", rule, via: "ide-diff" },
        },
      };
    }
    if (verdict?.outcome === "rejected") {
      return {
        outcome: "rejected",
        result: {
          error: `[Permission] "${name}" was rejected in the IDE diff review (${source}: ${rule}).`,
          policy: { decision: "deny", rule, via: "ide-diff" },
        },
      };
    }
    if (verdict?.outcome === "changes-requested") {
      // The reviewer annotated the diff instead of accepting/rejecting: the
      // file is untouched and the notes flow back as the tool result, so the
      // agent revises and re-proposes (Claude-Code inline-review parity).
      const feedback =
        formatReviewComments(verdict.comments, { path: proposal.filePath }) ||
        "The user requested changes in the IDE diff review (no specific notes).";
      return {
        outcome: "changes-requested",
        result: {
          error:
            `[IDE review] "${name}" was NOT applied — the user requested changes:\n` +
            `${feedback}\n` +
            "Revise the edit to address this feedback, then propose it again.",
          policy: { decision: "deny", rule, via: "ide-diff-review" },
          reviewComments: verdict.comments,
        },
      };
    }
  } catch (_err) {
    // diff-approval routing is best-effort — fall back to the normal confirm
  }
  return null;
}

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

  // ── Permission resolution (most-restrictive-wins; denies before prompts) ──
  // Two policy sources gate a tool call: the user's .claude/settings.json rules
  // (deny/ask/allow) and the desktop host's synced policy (hostManagedToolPolicy,
  // usually null in CLI). Precedence, evaluated in this exact order:
  //   1. settings `deny`  → block.
  //   2. host  `deny`     → block. A settings `allow` NEVER relaxes a host deny
  //                         (the desktop runtime authority outranks project
  //                         config); symmetrically a settings `deny` (step 1)
  //                         outranks a host `allow`. Net effect: any deny wins.
  //   3. settings `ask`   → confirm (headless w/o confirmer falls closed).
  //                         Reached only after BOTH denies clear, so a denied
  //                         tool never wastes a confirmation round-trip.
  //   4. settings `allow` → pre-authorize (ruleAllowed): short-circuit the
  //                         plan-mode block + run_shell ApprovalGate. The hard
  //                         shell-policy denylist still applies — allow never
  //                         re-enables an unsafe `rm -rf /`.
  // No matching rule + no host policy → every existing layer runs unchanged
  // (default behaviour is byte-for-byte).
  const settingsVerdict = context.permissionRules
    ? evaluatePermissionRules({
        tool: name,
        args,
        cwd,
        rules: context.permissionRules,
      })
    : { decision: null, rule: null };

  // 1. settings deny
  if (settingsVerdict.decision === "deny") {
    return {
      error: `[Permission] Tool "${name}" denied by settings rule: ${settingsVerdict.rule}`,
      policy: { decision: "deny", rule: settingsVerdict.rule, via: "settings" },
    };
  }

  // Resolve the host policy (needed for the host-deny check + the plan-mode
  // block below). Computed once here so a host deny can short-circuit before
  // any settings `ask` prompt.
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

  // 2. host deny (a settings `allow` does not relax this)
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

  // 3 + 4. settings ask / allow (only reached when neither layer denied)
  let ruleAllowed = false;
  if (settingsVerdict.decision === "ask") {
    // IDE-native diff approval (Claude-Code parity): for file edits in an
    // interactive session with an IDE bridge connected, review the edit in
    // the editor instead of a terminal y/N. Accepted = the IDE wrote the
    // file → return the synthetic result and SKIP execution; rejected =
    // deny; null = fall through to the normal confirm below. Shared with the
    // PreToolUse-hook ask path (tryIdeDiffApprovalForEdit).
    const ide = await tryIdeDiffApprovalForEdit(name, args, context, cwd, {
      rule: settingsVerdict.rule,
      source: "settings rule",
    });
    if (ide) return ide.result;
    const confirm = context.permissionConfirm || context.shellConfirm || null;
    const ok =
      typeof confirm === "function"
        ? await confirm({
            tool: name,
            args,
            rule: settingsVerdict.rule,
            reason: `settings rule ${settingsVerdict.rule} requires confirmation`,
          })
        : false;
    if (!ok) {
      return {
        error: `[Permission] Tool "${name}" requires confirmation (settings rule: ${settingsVerdict.rule}) — denied.`,
        policy: {
          decision: "ask",
          rule: settingsVerdict.rule,
          via: "settings",
        },
      };
    }
    ruleAllowed = true; // confirmed → treat like allow downstream
  } else if (settingsVerdict.decision === "allow") {
    ruleAllowed = true;
  }

  // Sensitive-file write guard (Claude-Code 2.1.160 parity): shell startup
  // files / PowerShell profiles / git+husky hooks execute code on the user's
  // next shell or commit — even otherwise-permitted edit flows confirm first.
  // An explicit settings `allow` rule is the only bypass (exact user
  // pre-authorization); headless without a confirmer fails closed.
  if (
    (name === "write_file" ||
      name === "edit_file" ||
      name === "notebook_edit") &&
    settingsVerdict.decision !== "allow" &&
    args?.path
  ) {
    const { sensitiveFileReason } =
      await import("../lib/sensitive-file-guard.js");
    const sensReason = sensitiveFileReason(args.path);
    if (sensReason) {
      const confirm = context.permissionConfirm || context.shellConfirm || null;
      const ok =
        typeof confirm === "function"
          ? await confirm({
              tool: name,
              args,
              rule: null,
              reason: `sensitive file: ${sensReason}`,
            })
          : false;
      if (!ok) {
        return {
          error: `[Sensitive File] Writing "${args.path}" requires confirmation (${sensReason}) — denied. Add a settings allow rule to pre-authorize.`,
          policy: { decision: "ask", via: "sensitive-file" },
        };
      }
    }
  }

  // Destructive-git guard (Claude-Code 2.1.183 parity: "destructive git
  // commands blocked when unintended"). The `git` tool otherwise runs any
  // command unguarded in auto mode — including `reset --hard`, `clean -fd`,
  // `restore .`, `push --force`, `branch -D`, `rebase`, `reflog expire` —
  // which irrecoverably discard work. An explicit settings `allow`/confirmed
  // `ask` (ruleAllowed) pre-authorizes; headless without a confirmer fails
  // closed. Plan mode already blocks non-read-only git below.
  if (
    name === "git" &&
    !ruleAllowed &&
    !planManager.isActive() &&
    isDangerousGitCommand(args?.command)
  ) {
    const confirm = context.permissionConfirm || context.shellConfirm || null;
    const ok =
      typeof confirm === "function"
        ? await confirm({
            tool: name,
            args,
            rule: null,
            reason: `destructive git command: git ${normalizeGitCommand(args.command)}`,
          })
        : false;
    if (!ok) {
      return {
        error: `[Destructive Git] "git ${normalizeGitCommand(args.command)}" discards work irrecoverably and requires confirmation — denied. Add a settings allow rule to pre-authorize.`,
        policy: { decision: "ask", via: "destructive-git" },
      };
    }
  }

  // Plan mode: check if tool is allowed (a settings `allow` rule pre-authorizes)
  if (
    planManager.isActive() &&
    !ruleAllowed &&
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

  // PreToolUse hooks. DB hooks (cc hook add) stay observe-only — a failure
  // never blocks. settings.json hooks (context.settingsHooks) are decision-
  // capable: a `block` (exit 2 / {decision:block}) stops the tool here, an
  // `ask` routes to the confirmer. Runs after permission resolution so a
  // settings deny / host deny short-circuits before any hook process spawns.
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
  if (context.settingsHooks) {
    const pre = await runSettingsPreToolUseHooks(name, args, context, cwd);
    // A hook `ask` resolved by the IDE diff review: accepted → the IDE
    // already wrote the file, return the synthetic result and skip the tool;
    // rejected → the ide-diff deny shape (via:"ide-diff", not via:"hook").
    if (pre.ideApplied) return pre.ideApplied;
    if (pre.blocked) {
      if (pre.ideResult) return pre.ideResult;
      return {
        error: `[Hook] PreToolUse blocked "${name}"${pre.reason ? ": " + pre.reason : ""}`,
        policy: { decision: "block", via: "hook", hook: pre.hook || null },
      };
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
      shellPolicyOverrides: context.shellPolicyOverrides || null,
      approvalGate: context.approvalGate || null,
      shellConfirm: context.shellConfirm || null,
      additionalDirectories: context.additionalDirectories || null,
      ruleAllowed,
      subAgentDepth: context.subAgentDepth || 0,
      interactiveApproval: context.interactiveApproval || false,
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
  // settings.json PostToolUse hooks: can't un-run the tool, but a `block`
  // reason is attached as `hookFeedback` to be surfaced back to the model.
  if (context.settingsHooks && toolResult && typeof toolResult === "object") {
    try {
      const matched = collectHooks(context.settingsHooks, "PostToolUse", name);
      if (matched && matched.length > 0) {
        const outcome = runCommandHooks(
          matched,
          {
            hook_event_name: "PostToolUse",
            tool_name: umbrellaFor(name),
            raw_tool_name: name,
            tool_input: args,
            tool_response:
              typeof toolResult === "object"
                ? JSON.stringify(toolResult).substring(0, 2000)
                : String(toolResult).substring(0, 2000),
            cwd,
            session_id: context.sessionId || null,
          },
          { cwd, event: "PostToolUse" },
        );
        if (outcome.decision === "block" && outcome.reason) {
          toolResult.hookFeedback = outcome.reason;
        }
      }
    } catch (_err) {
      // PostToolUse hooks are best-effort
    }
  }

  // settings.json SubagentStop hooks: fire when a `spawn_sub_agent` tool call
  // finishes (Claude-Code SubagentStop parity). The subagent has already
  // returned its summary, so this is observe + feedback rather than force-
  // continue: a `block` reason is surfaced to the PARENT agent as hookFeedback
  // so it can react (e.g. re-spawn or adjust), mirroring PostToolUse.
  if (
    name === "spawn_sub_agent" &&
    context.settingsHooks &&
    toolResult &&
    typeof toolResult === "object"
  ) {
    try {
      const outcome = runObserveHooks(
        context.settingsHooks,
        "SubagentStop",
        {
          stop_hook_active: false,
          session_id: context.sessionId || null,
          subagent_response:
            typeof toolResult === "object"
              ? JSON.stringify(toolResult).substring(0, 2000)
              : String(toolResult).substring(0, 2000),
        },
        { cwd },
      );
      if (outcome.decision === "block" && outcome.reason) {
        toolResult.hookFeedback = toolResult.hookFeedback
          ? `${toolResult.hookFeedback}\n${outcome.reason}`
          : outcome.reason;
      }
    } catch (_err) {
      // SubagentStop hooks are best-effort
    }
  }

  // IDE post-edit diagnostics (Claude-Code parity): after a successful file
  // mutation with an IDE bridge connected, pull the editor's fresh
  // error/warning diagnostics for that file into the tool result so the model
  // can fix what it just broke in the same loop. Best-effort, bounded;
  // CC_IDE_CONTEXT=0 disables alongside prompt-time context.
  if (
    (name === "write_file" ||
      name === "edit_file" ||
      name === "edit_file_hashed" ||
      name === "notebook_edit") &&
    toolResult &&
    typeof toolResult === "object" &&
    !toolResult.error &&
    args?.path &&
    context.mcpClient &&
    context.externalToolExecutors
  ) {
    try {
      const { collectIdeDiagnostics, formatIdeDiagnostics } =
        await import("../lib/ide-context.js");
      const diags = await collectIdeDiagnostics(
        {
          mcpClient: context.mcpClient,
          externalToolExecutors: context.externalToolExecutors,
        },
        path.resolve(cwd, args.path),
      );
      const feedback = formatIdeDiagnostics(diags);
      if (feedback) toolResult.ideDiagnostics = feedback;
    } catch (_err) {
      // diagnostics feedback is optional polish — never fail the tool
    }
  }

  return toolResult;
}

/**
 * Write a file then verify the on-disk byte count matches the intended
 * content. Network drives and cloud-synced folders (OneDrive / Dropbox /
 * Google Drive) can silently truncate a write or leave a 0-byte file; without
 * this check the agent reports `success` on a corrupted write and moves on.
 * Parity with Claude-Code 2.1.181 ("Fixed Write/Edit producing 0-byte or
 * truncated files on network drives and cloud-synced folders").
 *
 * Returns `{ size }` (actual on-disk bytes) on success, or `{ error }`
 * describing the truncation so the caller surfaces it as a tool error instead
 * of a false success. `fsImpl` is injectable for unit tests.
 */
export function writeFileVerified(filePath, content, fsImpl = fs) {
  const expected = Buffer.byteLength(content, "utf8");
  fsImpl.writeFileSync(filePath, content, "utf8");
  let actual;
  try {
    actual = fsImpl.statSync(filePath).size;
  } catch (err) {
    return {
      error: `Write verification failed: cannot stat ${filePath} after writing (${err.message}). The file may be on an unreliable network or cloud-synced drive.`,
    };
  }
  if (actual !== expected) {
    return {
      error: `Write truncated: expected ${expected} bytes but only ${actual} reached disk for ${filePath}. A network drive or cloud-sync folder (OneDrive/Dropbox/Google Drive) may have interrupted the write — retry, or write to a local path.`,
    };
  }
  return { size: actual };
}

// Short, stable-ish id for a freshly inserted notebook cell (nbformat 4.5+).
function _newNotebookCellId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Apply a single cell edit to a Jupyter notebook (.ipynb) given its raw text.
 * Pure (no fs) + exported for tests. Returns `{ text, summary, cellId }` on
 * success or `{ error }` on any validation failure — the caller writes `text`.
 *
 * edit_mode:
 *   - "replace" (default): overwrite the target cell's source; a code cell also
 *     gets outputs=[] + execution_count=null (stale output would be misleading).
 *   - "insert": add a new cell of `cell_type` after the target (or at the top
 *     when no target is given).
 *   - "delete": remove the target cell.
 * Target = cell_id (preferred) or 0-based cell_index.
 */
export function editNotebookCell(notebookText, args = {}) {
  let nb;
  try {
    nb = JSON.parse(notebookText);
  } catch {
    return { error: "Notebook is not valid JSON (.ipynb)" };
  }
  if (!nb || !Array.isArray(nb.cells)) {
    return { error: "Not a valid notebook: missing cells[] (need nbformat 4)" };
  }
  const mode = args.edit_mode || "replace";
  if (!["replace", "insert", "delete"].includes(mode)) {
    return { error: `Unknown edit_mode "${mode}" (replace|insert|delete)` };
  }
  // .ipynb stores source as an array of lines that each KEEP their trailing \n.
  const toLines = (s) => {
    const t = String(s ?? "");
    return t === "" ? [] : t.split(/(?<=\n)/);
  };
  // Re-serialize with Jupyter's 1-space indent + trailing newline.
  const out = (summary, cellId) => ({
    text: JSON.stringify(nb, null, 1) + "\n",
    summary,
    cellId,
  });
  const locate = () => {
    if (args.cell_id != null) {
      return nb.cells.findIndex((c) => c && c.id === args.cell_id);
    }
    if (Number.isInteger(args.cell_index)) {
      return args.cell_index >= 0 && args.cell_index < nb.cells.length
        ? args.cell_index
        : -1;
    }
    return -2; // no locator supplied
  };

  if (mode === "insert") {
    if (typeof args.new_source !== "string") {
      return { error: "new_source is required for edit_mode 'insert'" };
    }
    const ct = args.cell_type;
    if (ct !== "code" && ct !== "markdown") {
      return {
        error:
          "cell_type ('code'|'markdown') is required for edit_mode 'insert'",
      };
    }
    const id = _newNotebookCellId();
    const cell =
      ct === "code"
        ? {
            cell_type: "code",
            id,
            metadata: {},
            source: toLines(args.new_source),
            outputs: [],
            execution_count: null,
          }
        : {
            cell_type: "markdown",
            id,
            metadata: {},
            source: toLines(args.new_source),
          };
    let at = 0;
    if (args.cell_id != null || Number.isInteger(args.cell_index)) {
      const idx = locate();
      if (idx < 0) return { error: "Target cell not found for insert" };
      at = idx + 1; // insert AFTER the target
    }
    nb.cells.splice(at, 0, cell);
    return out(`inserted ${ct} cell at index ${at}`, id);
  }

  // replace / delete both need an existing target
  const idx = locate();
  if (idx === -2) {
    return {
      error: "Provide cell_id or cell_index to identify the target cell",
    };
  }
  if (idx < 0) {
    return {
      error: `Target cell not found (${
        args.cell_id != null
          ? "cell_id " + args.cell_id
          : "cell_index " + args.cell_index
      })`,
    };
  }

  if (mode === "delete") {
    const [removed] = nb.cells.splice(idx, 1);
    return out(`deleted cell at index ${idx}`, removed?.id);
  }

  // replace
  if (typeof args.new_source !== "string") {
    return { error: "new_source is required for edit_mode 'replace'" };
  }
  const cell = nb.cells[idx];
  cell.source = toLines(args.new_source);
  if (cell.cell_type === "code") {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return out(`replaced ${cell.cell_type} cell at index ${idx}`, cell.id);
}

/**
 * Render a Jupyter notebook (.ipynb) as a compact, token-cheap cell listing so
 * the model can locate cells (index + id + type + source) to edit with
 * notebook_edit — instead of drowning in raw JSON / base64 output blobs. Cell
 * OUTPUTS are summarized, not dumped. Pure + exported for tests; returns null
 * when the text is not a parseable nbformat-4 notebook (caller falls back to raw).
 */
export function renderNotebook(text) {
  let nb;
  try {
    nb = JSON.parse(text);
  } catch {
    return null;
  }
  if (!nb || !Array.isArray(nb.cells)) return null;
  const srcOf = (c) =>
    Array.isArray(c.source) ? c.source.join("") : String(c.source ?? "");
  const lines = [
    `Jupyter notebook — ${nb.cells.length} cell(s), nbformat ${nb.nbformat ?? "?"}. Edit cells with the notebook_edit tool (target by the id shown below). Pass raw:true to read_file for the underlying JSON.`,
    "",
  ];
  nb.cells.forEach((c, i) => {
    const id = c && c.id != null ? ` id=${c.id}` : "";
    lines.push(`── Cell ${i} [${(c && c.cell_type) || "?"}${id}] ──`);
    const src = srcOf(c || {});
    lines.push(src.length ? src.replace(/\n$/, "") : "(empty)");
    if (
      c &&
      c.cell_type === "code" &&
      Array.isArray(c.outputs) &&
      c.outputs.length
    ) {
      lines.push(`  ⟨${c.outputs.length} output(s) hidden⟩`);
    }
    lines.push("");
  });
  return lines.join("\n");
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
    llmOptions,
    shellPolicyOverrides,
    approvalGate,
    shellConfirm,
    additionalDirectories,
    ruleAllowed = false,
    subAgentDepth = 0,
    interactiveApproval = false,
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
      // Jupyter notebooks: render a compact cell listing (index/id/type/source,
      // outputs summarized) so the model can find cells for notebook_edit
      // without ingesting raw JSON / base64 output blobs. `raw:true` returns the
      // underlying JSON. Non-.ipynb reads are unchanged.
      if (args.raw !== true && /\.ipynb$/i.test(filePath)) {
        const nbView = renderNotebook(content);
        if (nbView) {
          return attachDescriptor(
            nbView.length > 50000
              ? {
                  content: nbView.substring(0, 50000) + "\n...(truncated)",
                  size: nbView.length,
                  notebook: true,
                }
              : { content: nbView, notebook: true },
          );
        }
      }
      // Hashline mode: prefix each line with a 6-char content hash tag
      // so downstream edit_file_hashed calls can anchor by hash.
      let rendered = args.hashed === true ? annotateLines(content) : content;

      // Line-range slice (Claude-Code Read offset/limit parity): `offset` is the
      // 1-based first line, `limit` the max line count — so a file larger than
      // the size cap can be paged through instead of being stuck at its head.
      // Coerces numeric strings the model may emit ("10" → 10).
      const toPos = (v) => {
        const n = typeof v === "number" ? v : parseInt(v, 10);
        return Number.isInteger(n) && n > 0 ? n : null;
      };
      const offset = toPos(args.offset);
      const limit = toPos(args.limit);
      let range = null;
      if (offset || limit) {
        const lines = rendered.split("\n");
        const start = offset ? offset - 1 : 0;
        const end = limit != null ? start + limit : lines.length;
        rendered = lines.slice(start, end).join("\n");
        range = {
          startLine: Math.min(start + 1, lines.length),
          endLine: Math.min(end, lines.length),
          totalLines: lines.length,
        };
      }

      if (rendered.length > 50000) {
        return attachDescriptor({
          content: rendered.substring(0, 50000) + "\n...(truncated)",
          size: rendered.length,
          hashed: args.hashed === true,
          ...(range ? { range } : {}),
        });
      }
      return attachDescriptor({
        content: rendered,
        hashed: args.hashed === true,
        ...(range ? { range } : {}),
      });
    }

    case "write_file": {
      const filePath = path.resolve(cwd, args.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const wrote = writeFileVerified(filePath, args.content);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      return attachDescriptor({
        success: true,
        path: filePath,
        size: wrote.size,
      });
    }

    case "notebook_edit": {
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `Notebook not found: ${filePath}` });
      }
      const original = fs.readFileSync(filePath, "utf8");
      const res = editNotebookCell(original, args);
      if (res.error) return attachDescriptor({ error: res.error });
      const wrote = writeFileVerified(filePath, res.text);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      return attachDescriptor({
        success: true,
        path: filePath,
        size: wrote.size,
        summary: res.summary,
        cellId: res.cellId,
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
      const newContent = content.replace(
        args.old_string,
        () => args.new_string,
      );
      const wrote = writeFileVerified(filePath, newContent);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      return attachDescriptor({
        success: true,
        path: filePath,
        size: wrote.size,
      });
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
      const wrote = writeFileVerified(filePath, result.content);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      return attachDescriptor({
        success: true,
        path: filePath,
        size: wrote.size,
        lineNumber: result.lineNumber,
        previousContent: result.previousContent,
      });
    }

    case "run_shell": {
      const shellPolicyOpts = shellPolicyOverrides
        ? { overrideRuleIds: shellPolicyOverrides }
        : {};
      const override = getRuntimeToolDescriptorByCommand(args.command);
      let shellPolicy;
      let approvalOutcome = null;
      // A settings `allow` rule (ruleAllowed) pre-authorizes: skip the
      // ApprovalGate tier confirm, but still run the hard shell-policy denylist
      // below so an allow rule can never re-enable a blocked unsafe command.
      if (approvalGate && !ruleAllowed) {
        const { evaluateShellCommandWithApproval } =
          await import("../lib/shell-approval.js");
        const gated = await evaluateShellCommandWithApproval({
          command: args.command,
          sessionId,
          approvalGate,
          shellPolicyOptions: shellPolicyOpts,
        });
        shellPolicy = gated.shellPolicy;
        approvalOutcome = {
          decision: gated.decision,
          via: gated.via,
          riskLevel: gated.riskLevel,
          policy: gated.policy,
        };
        if (!gated.allowed) {
          return attachDescriptor(
            {
              error:
                gated.via === "shell-policy"
                  ? `[Shell Policy] ${gated.reason}`
                  : `[ApprovalGate] command denied (${gated.via})`,
              shellCommandPolicy: shellPolicy,
              approval: approvalOutcome,
            },
            override || runtimeDescriptor,
          );
        }
      } else {
        shellPolicy = evaluateShellCommandPolicy(args.command, shellPolicyOpts);
        if (!shellPolicy.allowed) {
          return attachDescriptor(
            {
              error: `[Shell Policy] ${shellPolicy.reason}`,
              shellCommandPolicy: shellPolicy,
            },
            override || runtimeDescriptor,
          );
        }
      }

      // Background: spawn, register, return a task_id immediately. The agent
      // polls output + completion via check_shell. No timeout — that's the whole
      // point of backgrounding (builds, test suites, dev servers).
      if (args.run_in_background === true) {
        const id = `bg_${++_backgroundTaskSeq}`;
        const task = {
          id,
          command: args.command,
          cwd: args.cwd || cwd,
          status: "running",
          exitCode: null,
          signal: null,
          error: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          out: _newBgStream(),
          err: _newBgStream(),
          child: null,
        };
        try {
          const child = spawn(args.command, {
            cwd: task.cwd,
            shell: true,
            windowsHide: true,
            // Same agent-identity env as the foreground path: CLAUDECODE marks
            // "running under the agent"; the session id correlates work to the
            // run (CC_SESSION_ID + CLAUDE_CODE_SESSION_ID for Claude-Code parity).
            env: {
              ...process.env,
              CLAUDECODE: "1",
              ...(sessionId
                ? {
                    CC_SESSION_ID: String(sessionId),
                    CLAUDE_CODE_SESSION_ID: String(sessionId),
                  }
                : {}),
            },
            // POSIX: own process group so check_shell{kill}/teardown can signal
            // the whole tree (shell + its grandchild command). No-op on Windows
            // where the tree is killed via taskkill /T instead.
            detached: process.platform !== "win32",
          });
          task.child = child;
          if (child.stdout) {
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (d) => _appendBgStream(task.out, d));
          }
          if (child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (d) => _appendBgStream(task.err, d));
          }
          child.on("error", (err) => {
            task.status = "error";
            task.error = String(err?.message || err).substring(0, 2000);
            task.endedAt = new Date().toISOString();
          });
          // 'close' (not 'exit') so stdout/stderr are fully drained before the
          // status leaves "running" — otherwise a poll can observe completion
          // with the final output chunk not yet buffered.
          child.on("close", (code, signal) => {
            // 'error' may have already set a terminal state; don't overwrite it.
            if (task.status === "running") {
              task.status = code === 0 ? "exited" : "failed";
            }
            task.exitCode = code;
            task.signal = signal;
            task.endedAt = new Date().toISOString();
          });
        } catch (err) {
          task.status = "error";
          task.error = String(err?.message || err).substring(0, 2000);
          task.endedAt = new Date().toISOString();
        }
        _backgroundShellTasks.set(id, task);
        return attachDescriptor(
          {
            background: true,
            task_id: id,
            status: task.status,
            command: task.command,
            hint: "Poll output and completion with the check_shell tool using this task_id. Kill long-lived servers with check_shell { task_id, kill: true } when done.",
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
          },
          override || runtimeDescriptor,
        );
      }

      try {
        const output = execSync(args.command, {
          cwd: args.cwd || cwd,
          encoding: "utf8",
          timeout: _resolveShellTimeout(args.timeout),
          maxBuffer: 1024 * 1024,
          // Agent-identity env for shell subprocesses (Claude-Code 2.1.132
          // parity): CLAUDECODE=1 marks "running under the agent"; CC_SESSION_ID
          // + its CLAUDE_CODE_SESSION_ID mirror let scripts/hooks correlate work
          // to the agent session (the mirror is what CC-targeting tools expect).
          env: {
            ...process.env,
            CLAUDECODE: "1",
            ...(sessionId
              ? {
                  CC_SESSION_ID: String(sessionId),
                  CLAUDE_CODE_SESSION_ID: String(sessionId),
                }
              : {}),
          },
        });
        return attachDescriptor(
          {
            stdout: output.substring(0, 30000),
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
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
            approval: approvalOutcome,
          },
          override || runtimeDescriptor,
        );
      }
    }

    case "check_shell": {
      const taskId = args.task_id;
      // No task_id → list known background tasks (lightweight status surface).
      if (!taskId) {
        return attachDescriptor({
          tasks: listBackgroundShellTasks(),
        });
      }
      const task = _backgroundShellTasks.get(taskId);
      if (!task) {
        return attachDescriptor({
          error: `No background shell task with id "${taskId}".`,
          tasks: listBackgroundShellTasks(),
        });
      }
      let killed = false;
      if (args.kill === true) {
        // _killTask signals the whole process tree (see its doc); the close
        // handler flips status. Best-effort.
        killed = _killTask(task);
      }
      const out = _readBgStream(task.out);
      const err = _readBgStream(task.err);
      return attachDescriptor({
        task_id: task.id,
        status: task.status,
        running: task.status === "running",
        command: task.command,
        exitCode: task.exitCode,
        signal: task.signal,
        ...(task.error ? { error: task.error } : {}),
        stdout: out.text.substring(0, 30000),
        stderr: err.text.substring(0, 30000),
        ...(out.droppedGap ? { stdout_dropped_bytes: out.droppedGap } : {}),
        ...(err.droppedGap ? { stderr_dropped_bytes: err.droppedGap } : {}),
        ...(killed ? { killed: true } : {}),
        startedAt: task.startedAt,
        endedAt: task.endedAt,
      });
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
      // run_code executes arbitrary python/node/bash — strictly more powerful
      // than run_shell — yet historically ran ungated. In an INTERACTIVE
      // session (interactiveApproval) it now honors the same ApprovalGate tier
      // as run_shell so a strict-tier session prompts before arbitrary code
      // runs (closing the bypass where `run_code` could `rm -rf` / rmtree past
      // the run_shell gate). A settings `allow` rule (ruleAllowed) pre-
      // authorizes; headless leaves interactiveApproval false so its existing
      // per-permission-mode behavior is unchanged.
      if (
        interactiveApproval &&
        approvalGate &&
        !ruleAllowed &&
        typeof approvalGate.decide === "function"
      ) {
        const { APPROVAL_RISK, APPROVAL_DECISION } =
          await import("@chainlesschain/session-core");
        const gate = await approvalGate.decide({
          sessionId,
          riskLevel: APPROVAL_RISK.HIGH,
          tool: "run_code",
          args: { language: args.language },
        });
        if (gate.decision !== APPROVAL_DECISION.ALLOW) {
          return attachDescriptor({
            error: `[ApprovalGate] run_code denied (${gate.via})`,
            approval: {
              decision: gate.decision,
              via: gate.via,
              riskLevel: "high",
            },
          });
        }
      }
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
          llmOptions,
          subAgentDepth,
        }),
      );
    }

    case "web_fetch": {
      try {
        const { webFetch } = await import("../lib/web-fetch.js");
        let webFetchConfig = {};
        try {
          const { loadProjectConfig: _lpc, findProjectRoot: _fpr } =
            await import("../lib/project-detector.js");
          const projectRoot = _fpr(cwd);
          if (projectRoot) {
            const cfg = _lpc(projectRoot);
            webFetchConfig = cfg?.webFetch || {};
          }
        } catch (_err) {
          // Config optional — use defaults
        }
        const result = await webFetch(args.url, {
          format: args.format,
          maxBytes: args.maxBytes,
          timeout: args.timeout,
          config: webFetchConfig,
        });
        return attachDescriptor(result);
      } catch (err) {
        return attachDescriptor({ error: `web_fetch failed: ${err.message}` });
      }
    }

    case "web_search": {
      try {
        const { webSearch } = await import("../lib/web-search.js");
        let webSearchConfig = {};
        try {
          const { loadProjectConfig: _lpc, findProjectRoot: _fpr } =
            await import("../lib/project-detector.js");
          const projectRoot = _fpr(cwd);
          if (projectRoot) {
            const cfg = _lpc(projectRoot);
            webSearchConfig = cfg?.webSearch || {};
          }
        } catch (_err) {
          // Config optional — use defaults (auto provider / keyless fallback)
        }
        const result = await webSearch(args.query, {
          provider: args.provider,
          maxResults: args.maxResults,
          timeout: args.timeout,
          config: webSearchConfig,
        });
        return attachDescriptor(result);
      } catch (err) {
        return attachDescriptor({ error: `web_search failed: ${err.message}` });
      }
    }

    case "todo_write": {
      try {
        const { writeTodos } = await import("../lib/todo-manager.js");
        const result = writeTodos(sessionId, args.todos);
        if (!result.success) {
          return attachDescriptor({ error: result.error });
        }
        return attachDescriptor({
          success: true,
          count: result.count,
          summary: result.summary,
        });
      } catch (err) {
        return attachDescriptor({ error: `todo_write failed: ${err.message}` });
      }
    }

    case "ask_user_question": {
      if (!interaction || typeof interaction.askUser !== "function") {
        return attachDescriptor({
          error: "user_not_reachable",
          hint: "Non-interactive context (headless/gateway). Proceed autonomously using best judgement.",
        });
      }
      try {
        const answer = await interaction.askUser({
          question: args.question,
          options: Array.isArray(args.options) ? args.options : null,
          multiSelect: args.multiSelect === true,
          timeoutMs:
            typeof args.timeoutMs === "number" ? args.timeoutMs : 60000,
          sessionId,
        });
        return attachDescriptor({ answer });
      } catch (err) {
        if (err && err.code === "USER_TIMEOUT") {
          return attachDescriptor({
            error: "user_timeout",
            hint: "User did not respond in time. Proceed with best judgement.",
          });
        }
        return attachDescriptor({
          error: `ask_user_question failed: ${err.message}`,
        });
      }
    }

    case "search_sessions": {
      try {
        const { SessionSearchIndex } = await import("../lib/session-search.js");
        const { bootstrap } = await import("./bootstrap.js");
        const ctx = await bootstrap({ verbose: false });
        if (!ctx.db) {
          return attachDescriptor({
            error: "Database not available for session search",
          });
        }
        const index = new SessionSearchIndex(ctx.db);
        index.ensureTables();
        const results = index.search(args.query, {
          limit: args.limit || 10,
        });
        return attachDescriptor({
          query: args.query,
          results,
          count: results.length,
        });
      } catch (err) {
        return attachDescriptor({
          error: `Session search failed: ${err.message}`,
        });
      }
    }

    case "search_files": {
      // An explicit directory scopes the search to one root; otherwise span
      // cwd plus any --add-dir roots so cross-package searches find matches.
      const extraRoots = Array.isArray(additionalDirectories)
        ? additionalDirectories.filter(Boolean)
        : [];
      const roots = args.directory
        ? [path.resolve(cwd, args.directory)]
        : [cwd, ...extraRoots];
      const isContent = Boolean(args.content_search);
      const cmd = isContent
        ? process.platform === "win32"
          ? `findstr /s /i /n "${args.pattern}" *`
          : `grep -r -l -i "${args.pattern}" . --include="*" 2>/dev/null | head -20`
        : process.platform === "win32"
          ? `dir /s /b *${args.pattern}* 2>NUL`
          : `find . -name "*${args.pattern}*" -type f 2>/dev/null | head -20`;

      const hits = [];
      const seen = new Set();
      for (const root of roots) {
        if (hits.length >= 20) break;
        try {
          if (!fs.existsSync(root)) continue;
          const output = execSync(cmd, {
            cwd: root,
            encoding: "utf8",
            timeout: 10000,
          });
          for (const line of output.trim().split("\n")) {
            const v = line.trim();
            if (!v || seen.has(v)) continue;
            // Qualify with the root so multi-root results stay unambiguous.
            const labeled = roots.length > 1 ? `${root}: ${v}` : v;
            seen.add(v);
            hits.push(labeled);
            if (hits.length >= 20) break;
          }
        } catch {
          // No matches in this root — continue to the next.
        }
      }

      if (hits.length === 0) {
        return attachDescriptor({ files: [], message: "No matches found" });
      }
      return attachDescriptor(isContent ? { matches: hits } : { files: hits });
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
          for (const s of mountedMcpServers) {
            _activeMcpServers.add(typeof s === "string" ? s : s.name);
          }
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
          for (const s of mountedMcpServers) {
            _activeMcpServers.delete(typeof s === "string" ? s : s.name);
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
      if (localToolExecutor?.kind === "mcp-resource") {
        if (!mcpClient) {
          return attachDescriptor({
            error: `MCP client is unavailable for tool: ${name}`,
          });
        }
        try {
          if (localToolExecutor.op === "list") {
            const resources =
              typeof mcpClient.listResources === "function"
                ? mcpClient.listResources(args?.server || undefined)
                : [];
            return attachDescriptor({ count: resources.length, resources });
          }
          // op === "read"
          const uri = args?.uri;
          if (!uri || typeof uri !== "string") {
            return attachDescriptor({
              error: "read_mcp_resource requires a string 'uri' argument.",
            });
          }
          let server = args?.server;
          if (!server && typeof mcpClient.listResources === "function") {
            const match = mcpClient
              .listResources()
              .find((r) => r && r.uri === uri);
            server = match?.server;
          }
          if (!server) {
            return attachDescriptor({
              error: `Could not resolve which MCP server owns resource "${uri}". Pass 'server' explicitly.`,
            });
          }
          const result = await mcpClient.readResource(server, uri);
          return attachDescriptor(
            result && typeof result === "object" ? result : { result },
          );
        } catch (err) {
          return attachDescriptor({
            error: `MCP resource access failed: ${err.message}`,
          });
        }
      }

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
 * Max sub-agent nesting depth (Claude-Code 2.1.172 parity: sub-agents may
 * spawn their own sub-agents, capped at 5 levels so a runaway model cannot
 * recurse forever). Main loop = depth 0, its children = 1, …
 */
export const MAX_SUB_AGENT_DEPTH = 5;

/**
 * Per-tool-result character cap fed back to the model. One giant tool output (a
 * huge file, a verbose command, an MCP blob) must not blow the context window —
 * but the model is TOLD when output is cut, instead of the old silent
 * `substring(0, 5000)` that sliced mid-content with no marker and undercut even
 * read_file's own 50k self-limit. Tools that self-limit (read_file, notebook
 * render) stay below this; it is the final safety net for the ones that don't
 * (run_shell, search_files, run_code, MCP). Override with CC_MAX_TOOL_RESULT_CHARS.
 */
export const MAX_TOOL_RESULT_CHARS = (() => {
  const n = Number(process.env.CC_MAX_TOOL_RESULT_CHARS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50000;
})();

/**
 * Cap a serialized tool result to `max` chars, appending a visible truncation
 * marker (with the original length + how to get the rest) when it overflows —
 * so the model never silently receives a mid-content slice. Pure; exported for
 * tests.
 */
export function capToolResultString(serialized, max = MAX_TOOL_RESULT_CHARS) {
  const s = String(serialized ?? "");
  if (s.length <= max) return s;
  return (
    s.slice(0, max) +
    `\n…[tool output truncated: showing the first ${max} of ${s.length} chars` +
    ` — narrow the request (read a line range, grep, or paginate) to see the rest]`
  );
}

/**
 * Execute a spawn_sub_agent tool call.
 * Creates an isolated SubAgentContext, runs it, and returns only the summary.
 *
 * @param {object} args - { role, task, context?, tools? }
 * @param {object} ctx - { skillLoader, cwd, parentMessages, interaction, sessionId }
 * @returns {Promise<object>}
 */
async function _executeSpawnSubAgent(args, ctx) {
  // Nesting cap: refuse before any context/registry work.
  const currentDepth = ctx.subAgentDepth || 0;
  if (currentDepth >= MAX_SUB_AGENT_DEPTH) {
    return {
      error: `spawn_sub_agent: max nesting depth (${MAX_SUB_AGENT_DEPTH}) reached — complete the task directly instead of delegating further.`,
    };
  }
  let {
    role,
    task,
    context: inheritedContext,
    tools: explicitTools,
    profile: profileName,
  } = args;

  // Named subagent delegation (cc agents / .chainlesschain|.claude/agents/*.md):
  // load the agent's persona (its body = system prompt) + tool allow-list.
  // Explicit role/tools still win over the agent file's values.
  let mdProfile = null;
  let mdModel = null;
  if (args.agent) {
    try {
      const { getAgent } = await import("../lib/agents.js");
      const md = getAgent(args.agent, ctx.cwd);
      if (!md) {
        return {
          error: `Unknown subagent "${args.agent}". List them with: cc agents list`,
        };
      }
      role = role || md.name;
      if (!explicitTools && Array.isArray(md.tools)) explicitTools = md.tools;
      if (md.model) mdModel = md.model;
      if (md.systemPrompt) {
        mdProfile = { name: md.name, systemPrompt: md.systemPrompt };
      }
    } catch (err) {
      return {
        error: `Failed to load subagent "${args.agent}": ${err.message}`,
      };
    }
  }

  if (!task || (!role && !args.agent)) {
    return {
      error: "spawn_sub_agent requires 'task' and either 'role' or 'agent'",
    };
  }

  // Phase 3: resolve declarative profile if requested. Explicit tools/context
  // override profile defaults; missing fields fall back to the profile.
  let profile = null;
  if (profileName) {
    try {
      const { getSubAgentProfile } =
        await import("../lib/sub-agent-profiles.js");
      profile = getSubAgentProfile(profileName);
      if (!profile) {
        return {
          error: `Unknown sub-agent profile: "${profileName}". Valid: explorer|executor|design`,
        };
      }
    } catch (_err) {
      // profile module optional — proceed without
    }
  }

  // A named subagent's body becomes the sub-agent system prompt (via the
  // profile.systemPrompt seam) when no declarative profile was requested.
  if (!profile && mdProfile) profile = mdProfile;

  const allowedTools = Array.isArray(explicitTools)
    ? explicitTools
    : profile?.toolAllowlist || null;

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

  // Inherit the parent's provider / base-url / key; a named subagent's `model:`
  // frontmatter (mdModel) overrides just the model, else keep the parent's.
  const parentLlm = ctx.llmOptions || {};
  const subLlmOptions = {
    ...parentLlm,
    model: mdModel || parentLlm.model || undefined,
  };

  const subCtx = SubAgentContext.create({
    role,
    task,
    parentId: parentSessionId,
    inheritedContext: resolvedContext,
    allowedTools: allowedTools || null,
    cwd: ctx.cwd,
    profile: profile || null,
    llmOptions: subLlmOptions,
    depth: currentDepth + 1, // nested spawns see their own level
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
  // Merge the project-persona deny-list with any caller-supplied deny-list
  // (e.g. headless `--disallowed-tools`). Without this merge the caller's
  // deny-list is silently dropped and the tool stays callable.
  const mergedDisabledTools = [
    ...(Array.isArray(persona?.toolsDisabled) ? persona.toolsDisabled : []),
    ...(Array.isArray(options.disabledTools) ? options.disabledTools : []),
  ];
  const tools = getAgentToolDefinitions({
    names: options.enabledToolNames,
    disabledTools: mergedDisabledTools,
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
    const apiUrl = `${baseUrl}/api/chat`;
    // Multimodal (`cc agent --image`): ollama wants `{content, images:[base64]}`
    // not OpenAI-style `image_url` blocks. Convert only when an image part is
    // present so text-only runs keep the identical request shape.
    const ollamaMessages = hasImageContent(messages)
      ? toOllamaMessages(messages)
      : messages;
    // Real-time token deltas (Claude-Code `--include-partial-messages`): when
    // the caller supplies an onToken hook, stream the response and forward each
    // content chunk as it arrives. Tool calls + usage are accumulated and the
    // same {message, usage} shape is returned, so the agent loop is unchanged.
    // Without onToken we keep the cheaper single-shot non-streaming request.
    if (typeof options.onToken === "function") {
      return await _retryStreamingChat(
        () =>
          _chatOllamaStreaming(
            apiUrl,
            { model, messages: ollamaMessages, tools },
            options.onToken,
            signal,
            options.onStall,
            options.streamStallMs,
            options.streamStallTimeoutMs,
          ),
        { signal, onRetry: options.onStreamRetry },
      );
    }
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        tools,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(formatProviderHttpError("ollama", response.status));
    }
    const data = await response.json();
    if (data.prompt_eval_count || data.eval_count) {
      data.usage = {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0,
      };
    }
    return data;
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

    // Prompt caching (Claude-Code parity, default-on): the system prompt + the
    // ~18 tool schemas are a large, stable prefix re-sent on every agent-loop
    // iteration. Marking the LAST tool and the system block as cache
    // breakpoints lets Anthropic serve that prefix from cache (~10% the input
    // cost, lower latency) across iterations and turns. Anthropic ignores a
    // breakpoint when the prefix is under the model's minimum cacheable size,
    // so it is always safe. Opt out (e.g. a custom gateway that rejects the
    // field) with CC_PROMPT_CACHE=0 or options.promptCaching:false.
    const cacheEnabled =
      options.promptCaching !== false && process.env.CC_PROMPT_CACHE !== "0";
    if (cacheEnabled && anthropicTools.length > 0) {
      const last = anthropicTools.length - 1;
      anthropicTools[last] = {
        ...anthropicTools[last],
        cache_control: { type: "ephemeral" },
      };
    }

    // Model-aware max_tokens (Opus → 16384, Haiku → 4096, else 8192) via
    // provider-options. We read ONLY maxTokens: the module's `temperature`
    // default is never forwarded (400s on Opus 4.7/4.8).
    // Fallback to the CURRENT Sonnet, not a retired snapshot:
    // claude-sonnet-4-20250514 was retired 2026-06-15 and would 404 here.
    const effModel = model || "claude-sonnet-4-6";
    const { maxTokens: anthropicMaxTokens } = mergeProviderOptions(
      "anthropic",
      effModel,
    );
    const body = {
      model: effModel,
      max_tokens: anthropicMaxTokens || 8192,
      // Convert cc's internal OpenAI-shaped history (role:"tool" results,
      // assistant tool_calls[]) into Anthropic content blocks. Without this,
      // multi-turn tool use 400s on turn 2 (Anthropic rejects role:"tool" and
      // assistant `tool_calls`). Also replays preserved thinking blocks.
      messages: _toAnthropicMessages(otherMsgs),
      tools: anthropicTools,
    };
    // Extended thinking — OPT-IN via options.thinking; off by default so the
    // request is byte-identical to before. Model-aware (adaptive+effort on Opus
    // 4.6+/Sonnet 4.6, legacy enabled+budget else; nothing on Haiku). temperature
    // is never sent. RUNTIME-UNVERIFIED: no Anthropic key here to E2E the
    // thinking-block signature replay (see cli_claude_code_parity_landed memory).
    const thinkingParams = _anthropicThinkingParams(
      effModel,
      options,
      body.max_tokens,
    );
    if (thinkingParams) Object.assign(body, thinkingParams);
    if (systemMsgs.length > 0) {
      const systemText = systemMsgs.map((m) => m.content).join("\n");
      // Array-form system with a cache breakpoint when caching is on; plain
      // string otherwise (byte-identical to the prior request shape).
      body.system = cacheEnabled
        ? [
            {
              type: "text",
              text: systemText,
              cache_control: { type: "ephemeral" },
            },
          ]
        : systemText;
    }

    const url =
      baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : "https://api.anthropic.com/v1";

    // Real token streaming (--include-partial-messages): stream the SSE response
    // and forward text deltas live, assembling tool_use blocks back into the
    // same {message, usage} shape the non-streaming path returns.
    if (typeof options.onToken === "function") {
      return await _retryStreamingChat(
        () =>
          _chatAnthropicStreaming(
            `${url}/messages`,
            { ...body, stream: true },
            { "x-api-key": key, "anthropic-version": "2023-06-01" },
            options.onToken,
            signal,
            options.onThinking,
            options.onStall,
            options.streamStallMs,
            options.streamStallTimeoutMs,
          ),
        { signal, onRetry: options.onStreamRetry },
      );
    }

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
      throw new Error(formatProviderHttpError("anthropic", response.status));
    }

    const data = await response.json();
    const normalized = _normalizeAnthropicResponse(data);
    if (data.usage) {
      normalized.usage = {
        // With prompt caching, Anthropic splits input into uncached
        // `input_tokens` + cache read/write — capture all three so cost
        // accounting prices the cached prefix correctly (read ≈ 0.1×,
        // write ≈ 1.25× input). Absent (caching off) → 0, byte-identical.
        input_tokens: data.usage.input_tokens || 0,
        output_tokens: data.usage.output_tokens || 0,
        cache_read_input_tokens: data.usage.cache_read_input_tokens || 0,
        cache_creation_input_tokens:
          data.usage.cache_creation_input_tokens || 0,
      };
    }
    return normalized;
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
    volcengine: "doubao-seed-2-1-pro-260628",
  };

  // Real token streaming (--include-partial-messages) for every OpenAI-compatible
  // provider (openai / deepseek / dashscope / mistral / gemini / volcengine):
  // stream the SSE response, forward content deltas live, and reassemble the
  // delta-fragmented tool_calls into the standard {message, usage} shape.
  if (typeof options.onToken === "function") {
    return await _retryStreamingChat(
      () =>
        _chatOpenAIStreaming(
          `${url}/chat/completions`,
          {
            model: model || defaultModels[provider] || "gpt-4o-mini",
            messages,
            tools,
            stream: true,
            stream_options: { include_usage: true },
          },
          key,
          options.onToken,
          signal,
          provider,
          options.onStall,
          options.streamStallMs,
          options.streamStallTimeoutMs,
        ),
      { signal, onRetry: options.onStreamRetry },
    );
  }

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
    throw new Error(formatProviderHttpError(provider, response.status));
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error("Invalid API response: no choices returned");
  }
  const choice = data.choices[0];
  const out = { message: choice.message };
  if (data.usage) {
    // OpenAI/DeepSeek/volcengine report cached prompt tokens AS PART of
    // prompt_tokens — split them out so cost prices the cached prefix at the
    // provider's cache rate, not full input. 0 (or absent) → input unchanged.
    const cached = _openaiCachedTokens(data.usage);
    out.usage = {
      input_tokens: Math.max(0, (data.usage.prompt_tokens || 0) - cached),
      output_tokens: data.usage.completion_tokens || 0,
      cache_read_input_tokens: cached,
    };
  }
  return out;
}

// ─── Ollama streaming (token deltas for --include-partial-messages) ─────────
//
// Ollama `/api/chat` with `stream:true` returns NDJSON: one JSON object per
// line, each carrying an incremental `message.content` chunk, optional
// `message.tool_calls` (emitted whole, not byte-streamed), and a final line
// with `done:true` + `prompt_eval_count`/`eval_count` token totals. We reduce
// the stream line-by-line so onToken fires live, then finalize into the same
// {message, usage} shape the non-streaming branch returns.

function _ollamaInitState() {
  return {
    role: "assistant",
    content: "",
    toolCalls: null,
    promptEval: 0,
    evalCount: 0,
  };
}

function _ollamaReduceLine(state, line, onToken) {
  const s = (line || "").trim();
  if (!s) return state;
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return state; // tolerate partial/garbage lines mid-stream
  }
  const msg = obj.message;
  if (msg) {
    if (msg.role) state.role = msg.role;
    if (typeof msg.content === "string" && msg.content) {
      state.content += msg.content;
      if (typeof onToken === "function") {
        try {
          onToken(msg.content);
        } catch {
          // A failing UI hook must never break the agent run.
        }
      }
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      state.toolCalls = (state.toolCalls || []).concat(msg.tool_calls);
    }
  }
  if (obj.prompt_eval_count) state.promptEval = obj.prompt_eval_count;
  if (obj.eval_count) state.evalCount = obj.eval_count;
  return state;
}

function _ollamaFinalize(state) {
  const message = { role: state.role, content: state.content };
  if (state.toolCalls && state.toolCalls.length) {
    message.tool_calls = state.toolCalls;
  }
  const data = { message };
  if (state.promptEval || state.evalCount) {
    data.usage = {
      input_tokens: state.promptEval,
      output_tokens: state.evalCount,
    };
  }
  return data;
}

/**
 * Pure reducer over an iterable of Ollama NDJSON lines. Exported for tests so
 * the parse/accumulate logic can be exercised without a live HTTP stream.
 */
export function _accumulateOllamaStream(lines, onToken) {
  const state = _ollamaInitState();
  for (const line of lines) _ollamaReduceLine(state, line, onToken);
  return _ollamaFinalize(state);
}

/**
 * Decide how to handle an error thrown mid-stream while reading an SSE / NDJSON
 * response body. Returns:
 *   - "rethrow"  — the error is a user abort (Esc / AbortController) or no
 *                  partial text was accumulated, so surface it to the caller.
 *   - "preserve" — a genuine connection drop (ECONNRESET / "terminated" /
 *                  server hangup) after some text already streamed to the user;
 *                  finalize and return what we have instead of replacing the
 *                  visible partial answer with a raw network error.
 *
 * Parity with Claude-Code 2.1.179 ("preserving partial responses instead of
 * showing raw errors"). Pure + exported for unit tests.
 */
export function _streamErrorDisposition(err, signal, partialText) {
  if (isAbortError(err)) return "rethrow";
  if (signal && signal.aborted) return "rethrow";
  if (typeof partialText === "string" && partialText.trim()) return "preserve";
  return "rethrow";
}

/**
 * Format a provider HTTP error with an actionable hint. 401/403 almost always
 * means a missing/invalid API key for the ACTIVE provider — and because the
 * provider is resolved from config, a surprise "anthropic 401" usually means
 * the effective provider differs from what the user configured. Name the
 * provider and point at the fix instead of dumping a bare status code. Pure +
 * exported for tests.
 */
export function formatProviderHttpError(provider, status) {
  const base = `${provider} API error: HTTP ${status}`;
  if (status === 401 || status === 403) {
    return (
      `${base} — authentication failed: the API key for provider "${provider}" ` +
      `is missing or invalid. Check "cc config get llm.provider" and ` +
      `"cc config get llm.apiKey" (or run Configure LLM). A surprise "${provider}" ` +
      `here usually means the effective provider differs from the one you configured.`
    );
  }
  if (status === 429) return `${base} — rate limited; please retry shortly.`;
  return base;
}

/**
 * Is this error from a streaming chat request a transient API CONNECTION drop
 * that is safe to retry? True only for genuine network failures (reset /
 * timeout / DNS / refused / socket hangup / undici "terminated" / "fetch
 * failed"). False for user aborts and for HTTP/status errors (a 4xx/auth/5xx is
 * the server's verdict carried in the message, not a dropped pipe — retrying a
 * connection that never dropped won't help and could double-bill).
 *
 * Safe to act on at the dispatch seam because any error that propagates OUT of
 * `_chat*Streaming` is either an abort or a drop with ZERO output already
 * streamed (partial-output drops are preserved internally and never throw) — so
 * a retry can never duplicate visible text. Pure + exported for tests.
 */
// Re-exported from the shared classifier (src/lib/stream-retry.js) so agent-core
// internals and existing test imports keep resolving it from this module, while
// the agent and chat streaming paths share ONE definition (no drift). The retry
// budget constants (STREAM_RETRY_MAX / STREAM_RETRY_BASE_MS) come from there too.
export const _isRetryableStreamError = isRetryableStreamError;
// 2.1.185 parity: when a streaming response goes silent mid-flight (the TCP
// connection is alive but no bytes arrive — a slow/overloaded API), surface a
// "waiting for API response" hint after this many ms instead of leaving the
// user staring at a frozen spinner. Upstream raised this from 10s to 20s.
const STREAM_STALL_MS = 20000;
// Hard inactivity timeout: a stream silent for this long is treated as a dead
// connection — the watchdog cancels the reader and throws a RETRYABLE error so
// `_retryStreamingChat` re-issues the request instead of hanging forever.
// Default 180s mirrors the long-standing `cc chat`/`cc ask` stall guard
// (chat-core.js STREAM_STALL_MS / CC_CHAT_STALL_MS) — generous enough that even
// a slow local model's first token arrives in time, while still recovering from
// a genuinely dead connection by default. Set llm.streamStallTimeoutMs (or pass
// streamStallTimeoutMs: 0) to tune or disable. The 20s hint above still fires
// first. Must exceed STREAM_STALL_MS.
const STREAM_STALL_TIMEOUT_MS = 180000;
const _STREAM_STALL = Symbol("stream-stall");

/**
 * Run a streaming chat attempt with bounded auto-retry on transient API
 * connection drops (Claude-Code 2.1.181: "auto-retry for API connection drops
 * during thinking"). Only connection-level failures are retried (see
 * `_isRetryableStreamError`); user aborts and HTTP/status errors surface
 * immediately. Backoff is exponential and abort-aware. Transparent to the
 * caller: on success returns the attempt's result; on exhaustion rethrows the
 * last error — strictly better than today (one drop → instant error).
 *
 * @param {() => Promise<any>} streamFn  invokes one `_chat*Streaming` attempt
 * @param {object} opts  { signal?, retries?, baseDelayMs?, onRetry?, sleep? }
 */
export async function _retryStreamingChat(streamFn, opts = {}) {
  const retries = opts.retries ?? STREAM_RETRY_MAX;
  const base = opts.baseDelayMs ?? STREAM_RETRY_BASE_MS;
  const signal = opts.signal;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await streamFn();
    } catch (err) {
      if (attempt >= retries || !_isRetryableStreamError(err, signal))
        throw err;
      attempt++;
      if (typeof opts.onRetry === "function") {
        try {
          opts.onRetry(attempt, err);
        } catch {
          /* the retry notice is best-effort; never let it mask the retry */
        }
      }
      await sleep(base * Math.pow(2, attempt - 1));
      if (signal && signal.aborted) throw err; // user bailed during backoff
    }
  }
}

/**
 * Finalize a partial stream into the standard {message, usage} shape after a
 * mid-stream connection drop: marks the message truncated and drops any
 * half-streamed tool_call (its JSON args are incomplete and not safely
 * executable), so the agent loop treats it as a partial text answer and ends
 * the turn showing what the user already saw.
 */
function _finalizeTruncatedStream(finalize, state) {
  const out = finalize(state);
  if (out.message && out.message.tool_calls) delete out.message.tool_calls;
  if (out.message) out.message._truncated = true;
  return out;
}

// Wrap a ReadableStream reader so the read loop yields chunk values while a
// watchdog (a) fires `onStall(elapsedMs, stallTimeoutMs)` at most once per silent
// gap longer than `stallMs` (2.1.185 stream-stall hint; the 2nd arg lets the hint
// surface the auto-retry deadline, 0 when no timeout) and (b) — when `stallTimeoutMs` is
// set — cancels the reader and throws a RETRYABLE ETIMEDOUT after that long a
// silence, so a permanently dead-but-open connection recovers via the retry
// layer instead of hanging forever. The SAME in-flight read() promise is
// re-raced against a fresh timer each tick, so no chunk is ever dropped or
// double-read; `done`, errors, and aborts propagate unchanged. With neither a
// hook nor a timeout this degrades to a plain read loop (zero extra timers).
export async function* _iterateStreamWithStall(reader, opts = {}) {
  const onStall = typeof opts.onStall === "function" ? opts.onStall : null;
  const stallMs = opts.stallMs ?? STREAM_STALL_MS;
  const timeoutMs =
    opts.stallTimeoutMs == null ? STREAM_STALL_TIMEOUT_MS : opts.stallTimeoutMs;
  for (;;) {
    const readP = reader.read();
    // Fast path: nothing to watch for — await the chunk directly.
    if (!onStall && !timeoutMs) {
      const { done, value } = await readP;
      if (done) return;
      yield value;
      continue;
    }
    const start = Date.now();
    let notified = false;
    let result;
    for (;;) {
      const elapsed = Date.now() - start;
      // Hard inactivity timeout reached: cancel the dead stream (release the
      // socket) and throw a retryable error the dispatch seam re-issues.
      if (timeoutMs && elapsed >= timeoutMs) {
        try {
          await reader.cancel();
        } catch {
          /* best-effort release — the throw below is what matters */
        }
        const err = new Error(
          `stream stalled: no data from API for ${Math.round(elapsed / 1000)}s`,
        );
        err.code = "ETIMEDOUT";
        throw err;
      }
      // Wake at whichever fires first: the one-shot stall hint or the timeout.
      const waits = [];
      if (onStall && !notified) waits.push(stallMs - elapsed);
      if (timeoutMs) waits.push(timeoutMs - elapsed);
      const nextWait = waits.length ? Math.max(0, Math.min(...waits)) : null;
      if (nextWait == null) {
        // Hint already fired and no timeout — just wait for the chunk.
        result = await readP;
        break;
      }
      let timer;
      const wakeP = new Promise((resolve) => {
        timer = setTimeout(() => resolve(_STREAM_STALL), nextWait);
        if (timer && typeof timer.unref === "function") timer.unref();
      });
      let r;
      try {
        r = await Promise.race([readP, wakeP]);
      } finally {
        clearTimeout(timer);
      }
      if (r === _STREAM_STALL) {
        // A timer woke us. Fire the one-shot hint if we've crossed stallMs; the
        // loop re-evaluates `elapsed` to decide hint-vs-hard-timeout next tick.
        if (onStall && !notified && Date.now() - start >= stallMs) {
          notified = true;
          try {
            // 2.1.185: pass the hard-timeout deadline so the hint can tell the
            // user when the dead-but-open stream will be auto-retried (0 = no
            // timeout configured → caller shows no retry deadline).
            onStall(Date.now() - start, timeoutMs || 0);
          } catch {
            /* stall hint is best-effort — never break the stream over it */
          }
        }
        continue; // keep awaiting the SAME read() against a fresh timer
      }
      result = r;
      break;
    }
    if (result.done) return;
    yield result.value;
  }
}

async function _chatOllamaStreaming(
  apiUrl,
  body,
  onToken,
  signal,
  onStall,
  stallMs,
  stallTimeoutMs,
) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!response.ok) {
    throw new Error(formatProviderHttpError("ollama", response.status));
  }
  const state = _ollamaInitState();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const value of _iterateStreamWithStall(reader, {
      onStall,
      stallMs,
      stallTimeoutMs,
    })) {
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        _ollamaReduceLine(state, buf.slice(0, idx), onToken);
        buf = buf.slice(idx + 1);
      }
    }
    if (buf.trim()) _ollamaReduceLine(state, buf, onToken);
  } catch (err) {
    if (_streamErrorDisposition(err, signal, state.content) === "rethrow")
      throw err;
    return _finalizeTruncatedStream(_ollamaFinalize, state);
  }
  return _ollamaFinalize(state);
}

// ─── Anthropic streaming (SSE → {message, usage}, tool_use reassembled) ──────
//
// Anthropic /messages with stream:true emits SSE: message_start (input usage),
// content_block_start (text or tool_use header), content_block_delta
// (text_delta → onToken, or input_json_delta accumulating a tool's JSON args),
// message_delta (output usage). We reduce per `data:` line and finalize into
// the same shape chatWithTools returns non-streamed.

function _anthropicInitState() {
  return {
    text: "",
    blocks: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function _anthropicReduceLine(state, raw, onToken, onThinking) {
  const line = (raw || "").trim();
  if (!line.startsWith("data:")) return state;
  const payload = line.slice(5).trim();
  if (!payload) return state;
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    return state;
  }
  if (obj.type === "message_start") {
    const u = obj.message?.usage || {};
    state.inputTokens = Number(u.input_tokens) || state.inputTokens;
    // Prompt-cache token counts ride message_start.usage (Anthropic caching).
    state.cacheReadTokens =
      Number(u.cache_read_input_tokens) || state.cacheReadTokens;
    state.cacheCreationTokens =
      Number(u.cache_creation_input_tokens) || state.cacheCreationTokens;
  } else if (obj.type === "content_block_start") {
    const cb = obj.content_block || {};
    state.blocks[obj.index] =
      cb.type === "tool_use"
        ? { type: "tool_use", id: cb.id, name: cb.name, json: "" }
        : cb.type === "thinking"
          ? { type: "thinking", thinking: "", signature: "" }
          : cb.type === "redacted_thinking"
            ? { type: "redacted_thinking", data: cb.data || "" }
            : { type: "text" };
  } else if (obj.type === "content_block_delta") {
    const d = obj.delta || {};
    if (d.type === "text_delta" && d.text) {
      state.text += d.text;
      if (typeof onToken === "function") {
        try {
          onToken(d.text);
        } catch {
          // a failing UI hook must never break the run
        }
      }
    } else if (d.type === "input_json_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].json += d.partial_json || "";
    } else if (d.type === "thinking_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].thinking =
        (state.blocks[obj.index].thinking || "") + (d.thinking || "");
      if (typeof onThinking === "function" && d.thinking) {
        try {
          onThinking(d.thinking);
        } catch {
          // a failing UI hook must never break the run
        }
      }
    } else if (d.type === "signature_delta" && state.blocks[obj.index]) {
      state.blocks[obj.index].signature =
        (state.blocks[obj.index].signature || "") + (d.signature || "");
    }
  } else if (obj.type === "message_delta") {
    state.outputTokens = Number(obj.usage?.output_tokens) || state.outputTokens;
  }
  return state;
}

function _anthropicFinalize(state) {
  const toolCalls = [];
  const thinkingBlocks = [];
  for (const k of Object.keys(state.blocks).sort(
    (a, b) => Number(a) - Number(b),
  )) {
    const b = state.blocks[k];
    if (b.type === "tool_use") {
      let input = {};
      try {
        input = b.json ? JSON.parse(b.json) : {};
      } catch {
        input = {};
      }
      toolCalls.push({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(input) },
      });
    } else if (b.type === "thinking") {
      thinkingBlocks.push({
        type: "thinking",
        thinking: b.thinking || "",
        signature: b.signature || "",
      });
    } else if (b.type === "redacted_thinking") {
      thinkingBlocks.push({ type: "redacted_thinking", data: b.data || "" });
    }
  }
  const message = { role: "assistant", content: state.text };
  if (toolCalls.length) message.tool_calls = toolCalls;
  // Preserve thinking blocks verbatim (incl. signature) for replay on the next
  // tool turn — required by the API when extended thinking is on.
  if (thinkingBlocks.length) message._thinkingBlocks = thinkingBlocks;
  const out = { message };
  if (
    state.inputTokens ||
    state.outputTokens ||
    state.cacheReadTokens ||
    state.cacheCreationTokens
  ) {
    out.usage = {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens,
      cache_creation_input_tokens: state.cacheCreationTokens,
    };
  }
  return out;
}

/** Pure reducer over Anthropic SSE lines — exported for tests (no HTTP). */
export function _accumulateAnthropicStream(lines, onToken, onThinking) {
  const state = _anthropicInitState();
  for (const line of lines)
    _anthropicReduceLine(state, line, onToken, onThinking);
  return _anthropicFinalize(state);
}

async function _chatAnthropicStreaming(
  apiUrl,
  body,
  extraHeaders,
  onToken,
  signal,
  onThinking,
  onStall,
  stallMs,
  stallTimeoutMs,
) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(formatProviderHttpError("anthropic", response.status));
  }
  const state = _anthropicInitState();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const value of _iterateStreamWithStall(reader, {
      onStall,
      stallMs,
      stallTimeoutMs,
    })) {
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines)
        _anthropicReduceLine(state, line, onToken, onThinking);
    }
    if (buf.trim()) _anthropicReduceLine(state, buf, onToken, onThinking);
  } catch (err) {
    if (_streamErrorDisposition(err, signal, state.text) === "rethrow")
      throw err;
    return _finalizeTruncatedStream(_anthropicFinalize, state);
  }
  return _anthropicFinalize(state);
}

// ─── OpenAI-compatible streaming (SSE → {message, usage}) ────────────────────
//
// `data:` lines carry choices[0].delta.{content, tool_calls[]}; tool_calls
// arrive fragmented and keyed by `index` (name in the first chunk, arguments
// concatenated across chunks). usage rides the terminal chunk when
// stream_options.include_usage was requested. Terminator: `data: [DONE]`.

// OpenAI-compatible cached-prompt-token count. OpenAI / volcengine report it as
// usage.prompt_tokens_details.cached_tokens; DeepSeek as
// usage.prompt_cache_hit_tokens. In BOTH, prompt_tokens already INCLUDES the
// cached count (unlike Anthropic, where input_tokens is the uncached remainder)
// — so callers subtract it to recover the uncached input and avoid pricing the
// cached prefix twice. Verified live against volcengine (field present, 0 when
// the provider does not auto-cache).
function _openaiCachedTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const detailed = Number(usage.prompt_tokens_details?.cached_tokens);
  if (Number.isFinite(detailed) && detailed > 0) return detailed;
  const deepseek = Number(usage.prompt_cache_hit_tokens);
  if (Number.isFinite(deepseek) && deepseek > 0) return deepseek;
  return 0;
}

function _openaiInitState() {
  return {
    text: "",
    tools: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
}

function _openaiReduceLine(state, raw, onToken) {
  const line = (raw || "").trim();
  if (!line.startsWith("data:")) return state;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return state;
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    return state;
  }
  const delta = obj.choices?.[0]?.delta;
  if (delta?.content) {
    state.text += delta.content;
    if (typeof onToken === "function") {
      try {
        onToken(delta.content);
      } catch {
        // a failing UI hook must never break the run
      }
    }
  }
  if (Array.isArray(delta?.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (!state.tools[idx])
        state.tools[idx] = { id: undefined, name: "", args: "" };
      if (tc.id) state.tools[idx].id = tc.id;
      if (tc.function?.name) state.tools[idx].name = tc.function.name;
      if (tc.function?.arguments)
        state.tools[idx].args += tc.function.arguments;
    }
  }
  if (obj.usage) {
    const cached = _openaiCachedTokens(obj.usage);
    const prompt = Number(obj.usage.prompt_tokens);
    if (Number.isFinite(prompt))
      state.inputTokens = Math.max(0, prompt - cached);
    if (cached) state.cacheReadTokens = cached;
    state.outputTokens =
      Number(obj.usage.completion_tokens) || state.outputTokens;
  }
  return state;
}

function _openaiFinalize(state) {
  const toolCalls = state.tools.filter(Boolean).map((t) => ({
    id: t.id || `call_${t.name || "tool"}`,
    type: "function",
    function: { name: t.name, arguments: t.args || "{}" },
  }));
  const message = { role: "assistant", content: state.text };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const out = { message };
  if (state.inputTokens || state.outputTokens || state.cacheReadTokens) {
    out.usage = {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens || 0,
    };
  }
  return out;
}

/** Pure reducer over OpenAI-compatible SSE lines — exported for tests. */
export function _accumulateOpenAIStream(lines, onToken) {
  const state = _openaiInitState();
  for (const line of lines) _openaiReduceLine(state, line, onToken);
  return _openaiFinalize(state);
}

async function _chatOpenAIStreaming(
  apiUrl,
  body,
  apiKey,
  onToken,
  signal,
  provider,
  onStall,
  stallMs,
  stallTimeoutMs,
) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(formatProviderHttpError(provider, response.status));
  }
  const state = _openaiInitState();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const value of _iterateStreamWithStall(reader, {
      onStall,
      stallMs,
      stallTimeoutMs,
    })) {
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) _openaiReduceLine(state, line, onToken);
    }
    if (buf.trim()) _openaiReduceLine(state, buf, onToken);
  } catch (err) {
    if (_streamErrorDisposition(err, signal, state.text) === "rethrow")
      throw err;
    return _finalizeTruncatedStream(_openaiFinalize, state);
  }
  return _openaiFinalize(state);
}

/**
 * Convert cc's internal OpenAI-shaped messages into Anthropic content-block
 * messages. Internal shape: {role:"user"|"assistant"|"tool", content,
 * tool_calls?, _thinkingBlocks?}. Anthropic shape: {role:"user"|"assistant",
 * content: string | block[]} — assistant tool calls become {type:"tool_use"}
 * blocks; tool results become {type:"tool_result"} blocks inside a USER turn,
 * with consecutive results merged. Preserved thinking blocks (with signature)
 * are replayed FIRST in the assistant turn (the API requires them ahead of
 * tool_use when continuing a thinking+tool turn). Exported for tests.
 */
export function _toAnthropicMessages(msgs) {
  const out = [];
  let pendingResults = [];
  const flush = () => {
    if (pendingResults.length) {
      out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };
  for (const m of msgs || []) {
    if (!m) continue;
    if (m.role === "tool") {
      pendingResults.push({
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content ?? ""),
      });
      continue;
    }
    flush();
    if (m.role === "assistant") {
      const blocks = [];
      if (Array.isArray(m._thinkingBlocks)) {
        for (const tb of m._thinkingBlocks) blocks.push(tb);
      }
      if (typeof m.content === "string" && m.content.trim()) {
        blocks.push({ type: "text", text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) blocks.push(b);
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const raw = tc.function?.arguments;
          let input = {};
          try {
            input =
              typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name,
            input,
          });
        }
      }
      out.push({
        role: "assistant",
        content: blocks.length ? blocks : m.content || "",
      });
    } else {
      // user turn: pass content through (string or already-block array). When
      // it carries OpenAI-style `image_url` parts (`cc agent --image`), convert
      // them to Anthropic `image` blocks; text parts and any other blocks pass
      // through unchanged.
      let content = m.content;
      if (Array.isArray(content)) {
        content = content.map((b) =>
          b?.type === "image_url" ? imageUrlBlockToAnthropic(b) || b : b,
        );
      }
      out.push({ role: "user", content });
    }
  }
  flush();
  return out;
}

/** Map a Claude-Code-style intensity to an Anthropic effort level. */
function _intensityToEffort(want) {
  switch (String(want)) {
    case "ultra":
    case "ultrathink":
      return "xhigh";
    case "hard":
    case "think-hard":
    case "harder":
      return "high";
    case "think":
      return "medium";
    default:
      return "high"; // bare `true` → a sensible default for intelligence work
  }
}

/**
 * Decide the Anthropic `thinking` request params for a model. Returns null
 * (off) unless the caller opts in via options.thinking (true | "think" |
 * "hard" | "ultra"). Model-aware per the Claude API:
 *   - Opus 4.6/4.7/4.8, Sonnet 4.6 → adaptive thinking + output_config.effort
 *   - Sonnet 4.5 / Opus 4.0-4.5 / older → legacy enabled+budget (< max_tokens)
 *   - anything else (e.g. Haiku) → null (no thinking)
 * temperature is never added (it 400s on Opus 4.7/4.8). Note: `xhigh`/`max`
 * effort are Opus-tier — on Sonnet they may error; left to the caller's intent.
 * RUNTIME-UNVERIFIED — no Anthropic key to validate the wire shape live.
 * Exported for tests.
 */
export function _anthropicThinkingParams(
  model,
  options = {},
  maxTokens = 8192,
) {
  const want = options?.thinking;
  if (!want) return null; // off by default → request unchanged
  const m = String(model || "").toLowerCase();
  const adaptive = /opus-4-(6|7|8)/.test(m) || /sonnet-4-6/.test(m);
  const legacy =
    /sonnet-4-5/.test(m) ||
    /opus-4-(0|1|5)/.test(m) ||
    /sonnet-4-0/.test(m) ||
    /sonnet-3/.test(m) ||
    /opus-3/.test(m);
  if (adaptive) {
    const params = { thinking: { type: "adaptive" } };
    const effort =
      typeof options.thinkingEffort === "string"
        ? options.thinkingEffort
        : _intensityToEffort(want);
    if (effort) params.output_config = { effort };
    return params;
  }
  if (legacy) {
    let budget = Number(options.thinkingBudget) || 8000;
    // budget_tokens must be strictly < max_tokens (min 1024) on legacy models
    if (budget >= maxTokens) budget = Math.max(1024, Math.floor(maxTokens / 2));
    return { thinking: { type: "enabled", budget_tokens: budget } };
  }
  return null; // unknown / Haiku → no thinking
}

export function _normalizeAnthropicResponse(data) {
  const content = data.content || [];
  const textBlocks = content.filter((b) => b.type === "text");
  const toolBlocks = content.filter((b) => b.type === "tool_use");
  const thinkingBlocks = content.filter(
    (b) => b.type === "thinking" || b.type === "redacted_thinking",
  );

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

  // Preserve thinking blocks VERBATIM (incl. signature) so the agent loop can
  // replay them on the next tool turn — required when extended thinking is on,
  // harmless (absent) otherwise. _toAnthropicMessages re-emits them first.
  if (thinkingBlocks.length > 0) {
    message._thinkingBlocks = thinkingBlocks;
  }

  return { message };
}

// ─── Agent loop (async generator) ─────────────────────────────────────────

// Tools that never mutate the workspace — auto-checkpoint skips these.
const _CHECKPOINT_READ_ONLY = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "list_skills",
  "search_sessions",
]);

let _checkpointStoreP = null;
function _loadCheckpointStore() {
  if (!_checkpointStoreP) {
    _checkpointStoreP = import("../lib/checkpoint-store.js");
  }
  return _checkpointStoreP;
}

/**
 * Best-effort auto-checkpoint of the working tree BEFORE a mutating tool runs,
 * so a later `cc checkpoint restore` can roll back to just before that tool.
 * Enabled via toolContext.autoCheckpoint; uses the git engine only (no-op
 * outside a git work tree). Never throws — checkpointing must not block a tool.
 *
 * @returns {Promise<string|null>} the checkpoint id, or null when skipped
 */
async function _autoCheckpointBeforeTool(toolContext, toolName, toolArgs) {
  if (!toolContext?.autoCheckpoint) return null;
  if (_CHECKPOINT_READ_ONLY.has(toolName)) return null;
  const cwd = toolContext.cwd || process.cwd();
  try {
    const store = await _loadCheckpointStore();
    if (!store.isCheckpointAvailable(cwd)) return null;
    const res = store.createCheckpoint(cwd, {
      session: toolContext.checkpointSession || "agent",
      label: `before ${toolName}: ${formatToolArgs(toolName, toolArgs)}`.slice(
        0,
        120,
      ),
      skipIfUnchanged: true,
    });
    return res?.id || null;
  } catch {
    return null; // checkpoint failure must never block the tool
  }
}

/**
 * Async generator that drives the agentic tool-use loop.
 *
 * Yields events:
 *   { type: "slot-filling", slot, question }  — when asking user for missing info
 *   { type: "checkpoint", id, tool }          — auto-checkpoint before a mutating tool
 *   { type: "tool-executing", tool, args }
 *   { type: "tool-result", tool, result, error }
 *   { type: "response-complete", content }
 *
 * @param {Array} messages - mutable messages array (will be appended to)
 * @param {object} options - provider, model, baseUrl, apiKey, contextEngine, hookDb, skillLoader, cwd, slotFiller, interaction
 */
/**
 * Lazily build (and cache on `options`) the PromptCompressor used for in-loop
 * auto-compaction. Returns null when the feature is off or the module can't be
 * loaded — callers treat that as "don't compact". Cached (including null) so we
 * import once per run, not once per iteration.
 */
async function _getAutoCompactor(options) {
  if (Object.prototype.hasOwnProperty.call(options, "_autoCompactor")) {
    return options._autoCompactor;
  }
  let compressor = null;
  try {
    const { feature } = await import("../lib/feature-flags.js");
    if (feature("PROMPT_COMPRESSOR")) {
      const { PromptCompressor } =
        await import("../harness/prompt-compressor.js");
      compressor = new PromptCompressor({
        model: options.model,
        provider: options.provider,
      });
    }
  } catch {
    compressor = null;
  }
  try {
    options._autoCompactor = compressor;
  } catch {
    // options may be frozen — fine, we just re-import next iteration
  }
  return compressor;
}

export async function* agentLoop(messages, options) {
  // Shared iteration budget — replaces hardcoded MAX_ITERATIONS.
  // When options.iterationBudget is provided (e.g. from parent agent),
  // the same budget instance is shared, so parent+child consume from one pool.
  const { IterationBudget, WarningLevel } =
    await import("../lib/iteration-budget.js");
  const budget = options.iterationBudget || new IterationBudget();
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
    // Parent LLM config — forwarded to spawn_sub_agent so a delegated subagent
    // inherits the provider/key and can override just the model (cc agents `model:`).
    llmOptions: {
      provider: options.provider || null,
      model: options.model || null,
      baseUrl: options.baseUrl || null,
      apiKey: options.apiKey || null,
    },
    parentMessages: messages, // pass parent messages for sub-agent auto-condensation
    interaction: options.interaction || null,
    shellPolicyOverrides: options.shellPolicyOverrides || null,
    approvalGate: options.approvalGate || null,
    shellConfirm: options.shellConfirm || null,
    // Interactive sessions (the REPL) set this so run_code is gated through the
    // ApprovalGate like run_shell — a human can approve. Headless leaves it
    // false so run_code keeps its existing per-permission-mode behavior.
    interactiveApproval: options.interactiveApproval || false,
    additionalDirectories: options.additionalDirectories || null,
    permissionRules: options.permissionRules || null,
    permissionConfirm: options.permissionConfirm || null,
    settingsHooks: options.settingsHooks || null,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession:
      options.checkpointSession || options.sessionId || "agent",
    // Sub-agent nesting level (0 = main loop); spawn_sub_agent caps at
    // MAX_SUB_AGENT_DEPTH using this.
    subAgentDepth: options.subAgentDepth || 0,
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
  let llmCall = options.chatFn || chatWithTools;

  // Runnable-first auth recovery: if the resolved provider's key is missing /
  // wrong / expired, self-heal to a provider we can actually run (endpoint-
  // inferred, then env-keyed) instead of failing the turn. Opt out with
  // `runnableProviderFallback: false`. Transparent on the happy path.
  if (options.runnableProviderFallback !== false) {
    const { makeRunnableProviderFallback } =
      await import("../lib/runnable-provider.js");
    llmCall = makeRunnableProviderFallback(llmCall, {
      onFallback: ({ from, to, reason }) => {
        try {
          process.stderr.write(
            `\x1b[2m[provider] "${from}" auth failed (${reason}) — retrying with "${to}"\x1b[0m\n`,
          );
        } catch {
          /* notice is best-effort */
        }
      },
    });
  }

  // Phase 5 run bookends — a stable runId lets envelope subscribers correlate
  // every tool_call / tool_result / message / ended event back to one run.
  const runId =
    options.runId ||
    `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  yield {
    type: "run-started",
    runId,
    sessionId: options.sessionId || null,
  };

  // True once a Stop hook has forced a continuation — passed to the next Stop
  // hook as `stop_hook_active` so a well-behaved hook won't block forever.
  let stopHookActive = false;
  // True once we have already re-prompted a thinking-only turn (a turn that
  // produced extended-thinking but no visible text and no tool calls). The
  // one-shot guard means a model that keeps returning empty turns completes
  // rather than looping forever (the iteration budget is the hard backstop).
  let emptyThinkingReprompted = false;

  while (budget.hasRemaining()) {
    budget.consume();
    throwIfAborted(signal);

    // Emit progressive warnings (once per level)
    const level = budget.warningLevel();
    if (
      level === WarningLevel.WARNING &&
      !budget.hasWarned(WarningLevel.WARNING)
    ) {
      budget.recordWarning(WarningLevel.WARNING);
      yield {
        type: "iteration-warning",
        level,
        message: budget.toWarningMessage(),
        budget: budget.toSummary(),
      };
    } else if (
      level === WarningLevel.WRAPPING_UP &&
      !budget.hasWarned(WarningLevel.WRAPPING_UP)
    ) {
      budget.recordWarning(WarningLevel.WRAPPING_UP);
      yield {
        type: "iteration-warning",
        level,
        message: budget.toWarningMessage(),
        budget: budget.toSummary(),
      };
    }

    // Headless auto-compaction (Claude-Code `--print` parity). Keeps long
    // `-p` / `--resume` runs under the model's context window instead of
    // growing until the provider rejects the request. Opt-out with
    // `autoCompact: false` (the interactive REPL does this — it compacts on its
    // own schedule). Default-on, gated by the PROMPT_COMPRESSOR flag + a size
    // threshold inside the compressor, so it only fires for genuinely large
    // contexts. Safe to compact here: the previous iteration always finishes
    // its full tool_call→tool_result cycle before we loop, so `messages` has no
    // dangling call; `preserveToolPairs` then guarantees compaction never
    // orphans a tool result. Best-effort — a failure never aborts the run.
    if (options.autoCompact !== false && messages.length > 4) {
      try {
        const compactor = await _getAutoCompactor(options);
        if (compactor && compactor.shouldAutoCompact(messages)) {
          // Cheap surgical pre-pass (Claude-Code microcompact parity): trim old
          // large tool results IN PLACE before the disruptive full
          // summarization. If the trim brings the context back under threshold,
          // the full compaction below is skipped this round — so heavy-tool
          // conversations rarely hit a full summarize. Opt out:
          // autoMicroCompact: false.
          if (options.autoMicroCompact !== false) {
            try {
              const { microCompact } = await import("../lib/micro-compact.js");
              const mc = microCompact(messages);
              if (mc.stats.trimmed > 0) {
                messages.splice(0, messages.length, ...mc.messages);
                yield { type: "micro-compaction", runId, stats: mc.stats };
              }
            } catch {
              // microcompact is best-effort — never break the run
            }
          }
          // After the trim, is the full (disruptive) compaction still needed?
          const needFull = compactor.shouldAutoCompact(messages);
          // settings.json PreCompact hooks: a `block` decision SKIPS this
          // compaction round (e.g. the hook archived / owns the history). Fires
          // right before the history would be compacted.
          let preCompactBlocked = false;
          let preCompactReason = null;
          if (needFull && options.settingsHooks) {
            try {
              const pc = runObserveHooks(
                options.settingsHooks,
                "PreCompact",
                {
                  trigger: "auto",
                  message_count: messages.length,
                  session_id: options.sessionId || null,
                },
                { cwd: options.cwd || process.cwd() },
              );
              if (pc && pc.decision === "block") {
                preCompactBlocked = true;
                preCompactReason = pc.reason || null;
              }
            } catch (_err) {
              // observe-only
            }
          }
          if (preCompactBlocked) {
            yield {
              type: "compaction-skipped",
              runId,
              reason: preCompactReason,
            };
          }
          const { messages: compacted, stats } =
            !needFull || preCompactBlocked
              ? { messages, stats: { saved: 0 } }
              : await compactor.compress(messages, { preserveToolPairs: true });
          if (stats.saved > 0 && compacted.length < messages.length) {
            messages.splice(0, messages.length, ...compacted);
            // Persist the compaction so a later --resume rebuilds from the
            // shortened history. An explicit `onCompaction` hook (if a caller
            // provides one) takes precedence; otherwise self-persist a `compact`
            // event — but only when the session is already being persisted to
            // disk (the JSONL file exists), so a one-shot `cc agent -p` (which
            // never creates a session file) writes nothing. Opt out with
            // `persistCompaction: false`. Best-effort throughout.
            if (typeof options.onCompaction === "function") {
              try {
                options.onCompaction(stats, compacted);
              } catch {
                // persistence is best-effort
              }
            } else if (
              options.sessionId &&
              options.persistCompaction !== false
            ) {
              try {
                const store = await import("../harness/jsonl-session-store.js");
                if (store.sessionExists(options.sessionId)) {
                  store.appendCompactEvent(options.sessionId, {
                    ...stats,
                    messages: compacted,
                  });
                }
              } catch {
                // self-persist is best-effort
              }
            }
            yield { type: "compaction", stats, runId };
          }
        }
      } catch (_e) {
        if (isAbortError(_e) || signal?.aborted) throw _e;
        // Compaction is best-effort — proceed with the uncompacted messages.
      }
    }

    // Turn-scoped context injection (open-agents prepareCall parity).
    // prepareCall runs fresh each iteration and returns an ephemeral
    // system-message supplement that is NOT persisted to messages history.
    let callMessages = messages;
    if (typeof options.prepareCall === "function") {
      try {
        const hook = await options.prepareCall({
          iteration: budget.consumed,
          cwd: toolContext.cwd,
          sessionId: toolContext.sessionId,
        });
        if (
          hook &&
          typeof hook.systemSuffix === "string" &&
          hook.systemSuffix
        ) {
          callMessages = [
            ...messages,
            { role: "system", content: hook.systemSuffix },
          ];
        }
      } catch (_e) {
        // prepareCall failures are non-critical — proceed with original messages
      }
    }

    const result = await llmCall(callMessages, options);
    throwIfAborted(signal);
    const msg = result?.message;

    if (result?.usage) {
      yield {
        type: "token-usage",
        provider: options.provider || "ollama",
        model: options.model || "unknown",
        usage: result.usage,
      };
    }

    if (!msg) {
      yield { type: "response-complete", content: "(No response from LLM)" };
      yield { type: "run-ended", runId, reason: "no-response" };
      return;
    }

    const toolCalls = msg.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // Surface the final answer's extended-thinking reasoning (Anthropic, when
      // --think is on) so non-streaming consumers (the REPL) can show it. The
      // streaming path forwards reasoning live via onThinking instead.
      const _thinking = Array.isArray(msg._thinkingBlocks)
        ? msg._thinkingBlocks
            .map((b) => b.thinking || "")
            .join("")
            .trim()
        : "";
      // Claude Code 2.1.183 parity: a turn that produced ONLY extended-thinking
      // (no visible text, no tool calls) would otherwise complete silently with
      // an empty answer — the user sees nothing. Re-prompt the model ONCE to
      // surface its actual response. Mirrors the Stop-hook continuation path
      // below (push assistant turn + a user nudge, then continue). Scoped to the
      // thinking-only case so a genuinely empty completion (no thinking) still
      // ends instead of looping.
      const _contentEmpty = !String(msg.content || "").trim();
      if (_contentEmpty && _thinking && !emptyThinkingReprompted) {
        emptyThinkingReprompted = true;
        messages.push({ role: "assistant", content: "" });
        messages.push({
          role: "user",
          content:
            "You ended your turn with only internal reasoning and no visible " +
            "response. Please provide your actual answer now.",
        });
        yield { type: "empty-thinking-reprompt", runId };
        continue;
      }
      yield {
        type: "response-complete",
        content: msg.content || "",
        ...(_thinking ? { thinking: _thinking } : {}),
      };
      // settings.json Stop hooks: a `block` decision FORCES the agent to keep
      // going instead of stopping — the reason is injected as a new instruction.
      // `stop_hook_active` lets the hook avoid an infinite loop; the iteration
      // budget is the hard backstop.
      if (options.settingsHooks) {
        let stopOutcome = null;
        try {
          stopOutcome = runObserveHooks(
            options.settingsHooks,
            "Stop",
            {
              stop_hook_active: stopHookActive,
              final_response: String(msg.content || "").substring(0, 2000),
              session_id: options.sessionId || null,
            },
            { cwd: options.cwd || process.cwd() },
          );
        } catch (_err) {
          stopOutcome = null; // never affect the run outcome
        }
        if (stopOutcome && stopOutcome.decision === "block") {
          stopHookActive = true;
          messages.push({ role: "assistant", content: msg.content || "" });
          messages.push({
            role: "user",
            content:
              stopOutcome.reason ||
              "A Stop hook requested that you keep working.",
          });
          yield {
            type: "stop-hook-continue",
            runId,
            reason: stopOutcome.reason || null,
          };
          continue;
        }
      }
      yield { type: "run-ended", runId, reason: "complete" };
      return;
    }

    // Intermediate-step reasoning (Anthropic, --think): the model's reasoning
    // before it chose these tool calls. Streaming consumers already get it live
    // via onThinking, so only surface it as an event for non-streaming consumers
    // (the REPL) — keeps it out of the --include-partial-messages stream.
    if (!options.onThinking && Array.isArray(msg._thinkingBlocks)) {
      const _stepThinking = msg._thinkingBlocks
        .map((b) => b.thinking || "")
        .join("")
        .trim();
      if (_stepThinking) yield { type: "thinking", text: _stepThinking };
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

      // Auto-checkpoint the work tree before a mutating tool (opt-in), so the
      // user can `cc checkpoint restore` back to just before this call.
      const cpId = await _autoCheckpointBeforeTool(
        toolContext,
        toolName,
        toolArgs,
      );
      if (cpId) yield { type: "checkpoint", id: cpId, tool: toolName };

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

      // Append budget warning to tool result so the LLM sees it
      const warningMsg = budget.toWarningMessage();
      // Cap an individual tool result so one giant output can't blow the
      // context — but tell the model when we cut it (no more silent
      // mid-content slice). See MAX_TOOL_RESULT_CHARS / capToolResultString.
      const resultStr = capToolResultString(JSON.stringify(toolResult));
      const toolContent = warningMsg
        ? `${resultStr}\n\n${warningMsg}`
        : resultStr;

      yield {
        type: "tool-result",
        tool: toolName,
        result: toolResult,
        error: toolError,
      };

      messages.push({
        role: "tool",
        content: toolContent,
        tool_call_id: call.id,
      });
    }
  }

  // Budget exhausted — yield exhaustion event + final message
  yield { type: "iteration-budget-exhausted", budget: budget.toSummary() };
  yield {
    type: "response-complete",
    content: `(Iteration budget exhausted — ${budget.toSummary()})`,
  };
  yield { type: "run-ended", runId, reason: "budget-exhausted" };
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
      return args.run_in_background
        ? `${args.command} (background)`
        : args.command;
    case "check_shell":
      return args.task_id
        ? `${args.task_id}${args.kill ? " (kill)" : ""}`
        : "list";
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
    case "search_sessions":
      return `"${(args.query || "").substring(0, 60)}"`;
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
